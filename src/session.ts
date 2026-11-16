/**
 * App state and audio control: what plays, the status line, tempo, live
 * update and recording. Components read the signals and call the actions.
 */
import { effect, signal } from "sibujs";
import { DEFAULT_CODE, EXAMPLES, type Example } from "./data/examples.ts";
import { SNIPPETS } from "./data/snippets.ts";
import { createEditor, type Editor } from "./editor/Editor.ts";
import { setSampleBanks } from "./editor/language.ts";
import { TidalJS, type ControlLayout, type LiveControl, type StreamInfo, type Tidal } from "./engine.ts";
import { scanCode, type CodeScan } from "./share.ts";

const KEYS = {
  code: "tidaljs:code",
  live: "tidaljs:live",
  category: "tidaljs:snippetCategory",
  shared: "tidaljs:sharedUnplayed",
  controls: "tidaljs:controls",
};
const LIVE_DELAY = 700; // ms of quiet before a live update
const SAVE_DELAY = 300;

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};

/** CSS classes of the status line: "", "playing", "warn", "error" or "playing warn". */
export type StatusKind = "" | "playing" | "warn" | "error" | "playing warn";

export interface Status {
  kind: StatusKind;
  text: string;
  warnings: string[];
}

export type Session = ReturnType<typeof createSession>;

export const TEMPO_MIN = 0.05;
export const TEMPO_MAX = 10;

/** Tempo in cycles per second from typed text ("0.8" or "0,8"), within limits; 0.8 when unreadable. */
export function parseTempo(value: string): number {
  const v = parseFloat(String(value).replace(",", "."));
  return Number.isFinite(v) && v > 0 ? clampTempo(v) : 0.8;
}

export function clampTempo(cps: number): number {
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(cps * 1000) / 1000));
}

/**
 * The example the code comes from: one whose whole code is in it (the longest
 * such), or else `current` if its first line, the title comment of songs and
 * grooves, is still there after editing.
 */
function exampleFor(text: string, current: Example | null): Example | null {
  let best: Example | null = null;
  for (const example of EXAMPLES) {
    if (text.includes(example.code) && (!best || example.code.length > best.code.length)) best = example;
  }
  if (best) return best;
  const firstLine = current?.code.split("\n")[0].trim();
  return current && firstLine && firstLine.startsWith("//") && text.includes(firstLine) ? current : null;
}

export function createSession() {
  const [status, setStatus] = signal<Status>({ kind: "", text: "Ready. Press Play or Ctrl+Enter to start.", warnings: [] });
  const [tempo, setTempo] = signal(0.8); // cycles per second
  const [recording, setRecording] = signal(false);
  const [liveEnabled, setLiveEnabled] = signal(storage.get(KEYS.live) !== "off");
  const savedCategory = storage.get(KEYS.category);
  const [category, setCategory] = signal(savedCategory && SNIPPETS[savedCategory] ? savedCategory : Object.keys(SNIPPETS)[0]);

  effect(() => storage.set(KEYS.live, liveEnabled() ? "on" : "off"));
  effect(() => storage.set(KEYS.category, category()));

  /**
   * True while the editor holds code opened from a shared link that has not
   * been played yet. Kept across reloads with the code itself, so reloading
   * the page does not skip the check before the first Play.
   */
  const [sharedUnplayed, setSharedUnplayed] = signal(storage.get(KEYS.shared) === "1");
  effect(() => storage.set(KEYS.shared, sharedUnplayed() ? "1" : "0"));
  /**
   * Asks before the first Play of shared code that the scan flags. Set by the
   * sharing UI; until then risky shared code does not play.
   */
  let confirmRiskyShared: (scan: CodeScan) => Promise<boolean> = async () => false;

  let tidal: Tidal | null = null;
  /** The sliders and toggles (slider(), toggle()) of the code that plays, for the Controls panel. */
  const [controls, setControls] = signal<LiveControl[]>([]);
  /** How the code arranges them (controlLayout()), in call order. */
  const [controlLayouts, setControlLayouts] = signal<ControlLayout[]>([]);
  /** Their last values by name, kept in this browser (the most recent 100). */
  const savedControls: Record<string, number> = (() => {
    try {
      const parsed = JSON.parse(storage.get(KEYS.controls) || "{}");
      const out: Record<string, number> = {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [name, value] of Object.entries(parsed)) if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
      }
      return out;
    } catch {
      return {};
    }
  })();
  let controlsTimer: ReturnType<typeof setTimeout> | undefined;
  const saveControls = () => {
    const names = Object.keys(savedControls);
    for (const name of names.slice(0, Math.max(0, names.length - 100))) delete savedControls[name];
    storage.set(KEYS.controls, JSON.stringify(savedControls));
  };
  let lastRunCode: string | null = null;
  let loadingSamples = false;
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const report = (kind: StatusKind, text: string, warnings: string[] = []) => setStatus({ kind, text, warnings });

  const savedCode = storage.get(KEYS.code);
  const initialCode = savedCode && savedCode.trim() ? savedCode : DEFAULT_CODE;

  /** True while the engine plays (kept in sync after every action and by syncPlaying()). */
  const [playing, setPlaying] = signal(false);
  /** The example in the editor: clicked in the list, or recognised from the code. */
  const [currentExample, setCurrentExample] = signal<Example | null>(exampleFor(initialCode, null));

  /** Counts edits, so views can react to the text changing (the text itself lives in the editor). */
  const [edits, setEdits] = signal(0);
  /** Counts changes to what plays (code run, mute, solo), so the cycle view queries the patterns again. */
  const [patternsChanged, setPatternsChanged] = signal(0);
  const markPatternsChanged = () => setPatternsChanged((n) => n + 1);
  /** Counts examples loaded from the list, so the library knows the editor holds a new, unsaved sketch. */
  const [examplesLoaded, setExamplesLoaded] = signal(0);

  const editor: Editor = createEditor({
    initialCode,
    onChange(text) {
      setEdits((n) => n + 1);
      scheduleLiveUpdate();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => storage.set(KEYS.code, text), SAVE_DELAY);
    },
  });

  /** Creates the engine on first use; browsers only allow audio after a user gesture. */
  async function ensureTidal(): Promise<Tidal | null> {
    if (tidal) {
      await tidal.init(); // resumes a suspended context
      return tidal;
    }
    const instance = new TidalJS();
    if (!(await instance.init())) {
      report("error", "Audio could not start: " + (instance.lastError || "unknown error"));
      return null;
    }
    instance.setCPS(tempo());
    instance.onError = (err) => report("error", "Runtime error: " + err.message + " (pattern stopped)");
    // Sliders and toggles start where they were left in this browser.
    instance.restoreControls(savedControls);
    instance.onControls((list, layouts) => {
      setControls(list);
      // Only a new arrangement replaces the groups (moving a slider keeps them as they are).
      if (JSON.stringify(layouts) !== JSON.stringify(controlLayouts())) setControlLayouts(layouts);
      for (const c of list) {
        delete savedControls[c.name]; // moves it to the end: the most recent
        savedControls[c.name] = c.value;
      }
      clearTimeout(controlsTimer);
      controlsTimer = setTimeout(saveControls, SAVE_DELAY);
    });
    tidal = instance;
    return tidal;
  }

  /** Sets a slider or toggle of the Controls panel. */
  function setControl(name: string, value: number | boolean) {
    tidal?.setControl(name, value);
  }

  /**
   * After code that calls samples(), waits for the banks and files to load,
   * then runs the same code again so the real samples play.
   */
  async function afterSamplesLoad(engine: Tidal, text: string, live: boolean) {
    if (!engine.isLoadingSamples() || loadingSamples) return;
    loadingSamples = true;
    report(engine.isPlaying ? "playing" : "", "Loading samples...");
    try {
      await engine.whenSamplesLoaded();
    } finally {
      loadingSamples = false;
    }
    setSampleBanks(new Map([...engine.sampleBanks].map(([name, files]) => [name, files.length])));
    if (editor.getValue() === text) runCode(engine, live);
  }

  /** Runs the editor code. Live updates keep the old music on warnings. */
  function runCode(engine: Tidal, live: boolean) {
    const text = editor.getValue();
    // Live updates keep streams whose events have not changed (and their transitions) as they are.
    const result = engine.eval(text, { keepOnWarnings: live, keepUnchanged: live });
    lastRunCode = text;
    markPatternsChanged();
    syncPlaying();
    setTempo(+engine.cps.toFixed(3));
    editor.showProblems(result, text);
    const where = result.location ? " (line " + result.location.line + ")" : "";
    void afterSamplesLoad(engine, text, live);
    if (loadingSamples) return;

    if (result.pending) {
      report("playing warn", "Waiting for valid code; the previous patterns keep playing.", result.warnings);
      return;
    }
    if (!result.success) {
      if (!live) editor.flash("flash-error");
      const keeping = result.activePatterns ? " Previous patterns keep playing." : "";
      report("error", "Error" + where + ": " + result.error + "." + keeping, result.warnings);
      return;
    }
    if (!live) editor.flash("flash");
    if (result.activePatterns === 0) {
      report(result.warnings.length ? "warn" : "", "Nothing to play: no expression returned a pattern.", result.warnings);
    } else {
      const n = result.activePatterns;
      const verb = live ? "Updated: playing " : "Playing ";
      // With warnings, the status line shows only them: "Playing n patterns" is no news there.
      const text = result.warnings.length ? "" : verb + n + " pattern" + (n === 1 ? "" : "s") + ".";
      report(result.warnings.length ? "playing warn" : "playing", text, result.warnings);
    }
  }

  /** The playing streams (d1, #1...) with their mute and solo state. */
  const [streams, setStreams] = signal<StreamInfo[]>([]);
  let streamsKey = "";

  /** Reads the engine's play state and streams; cheap enough to call every frame. */
  function syncPlaying() {
    setPlaying(!!tidal && tidal.isPlaying);
    const list = tidal && tidal.isPlaying ? tidal.streamInfo() : [];
    const key = JSON.stringify(list);
    if (key !== streamsKey) {
      streamsKey = key;
      setStreams(list);
    }
  }

  function toggleMute(name: string) {
    if (!tidal) return;
    tidal.mute(name, !tidal.muted.has(name));
    markPatternsChanged();
    syncPlaying();
  }

  function toggleSolo(name: string) {
    if (!tidal) return;
    tidal.solo(name, !tidal.soloed.has(name));
    markPatternsChanged();
    syncPlaying();
  }

  /**
   * Before the first Play of shared code: scans the code as it is now (it may
   * have been edited) and, if anything is flagged, asks for confirmation.
   * Returns true when the code may run.
   */
  async function checkShared(): Promise<boolean> {
    if (!sharedUnplayed()) return true;
    const scan = scanCode(editor.getValue());
    if (scan.risks.length && !(await confirmRiskyShared(scan))) {
      report("warn", "Not played. The shared code is still in the editor: change it or press Play again when you are sure.");
      return false;
    }
    setSharedUnplayed(false);
    return true;
  }

  async function play() {
    clearTimeout(liveTimer);
    if (!(await checkShared())) return;
    const engine = await ensureTidal();
    if (!engine) return;
    runCode(engine, false);
    setCurrentExample(exampleFor(editor.getValue(), currentExample()));
    syncPlaying();
  }

  function stop() {
    clearTimeout(liveTimer);
    tidal?.stopAll();
    syncPlaying();
    report("", "Stopped.");
  }

  /** While music is playing, edits are evaluated once typing pauses. */
  function scheduleLiveUpdate() {
    clearTimeout(liveTimer);
    const engine = tidal;
    // Shared code waits for a Play (and its check) before any live update runs it.
    if (!liveEnabled() || !engine || !engine.isPlaying || sharedUnplayed()) return;
    liveTimer = setTimeout(() => {
      if (engine.isPlaying && editor.getValue() !== lastRunCode) runCode(engine, true);
    }, LIVE_DELAY);
  }

  effect(() => {
    if (liveEnabled()) scheduleLiveUpdate();
    else clearTimeout(liveTimer);
  });

  async function toggleRecording() {
    const engine = await ensureTidal();
    if (!engine) return;
    const busy: StatusKind = engine.isPlaying ? "playing" : "";
    if (engine.isRecording) {
      await engine.stopRecording();
      setRecording(false);
      report(busy, "Recording saved to your downloads.");
      return;
    }
    try {
      engine.startRecording();
      setRecording(true);
      report(busy, "Recording. Press Stop recording to save the file.");
    } catch (err) {
      report("error", "Recording failed: " + (err as Error).message);
    }
  }

  function changeTempo(cps: number) {
    setTempo(cps);
    tidal?.setCPS(cps);
  }

  function loadExample(example: Example) {
    setSharedUnplayed(false);
    editor.setValue(example.code);
    setCurrentExample(example);
    setEdits((n) => n + 1);
    setExamplesLoaded((n) => n + 1);
    if (tidal?.isPlaying) void play();
    else report("", 'Loaded "' + example.title + '". Press Play or Ctrl+Enter.');
  }

  /** Puts code in the editor (a saved sketch or an imported file); plays it if music is playing. */
  function openCode(code: string, title: string, cps?: number) {
    setSharedUnplayed(false);
    editor.setValue(code);
    setCurrentExample(exampleFor(code, null));
    setEdits((n) => n + 1);
    if (cps !== undefined && !/setCPS|setcps|setTempo/.test(code)) changeTempo(cps);
    if (tidal?.isPlaying) void play();
    else report("", 'Opened "' + title + '". Press Play or Ctrl+Enter.');
  }

  /**
   * Puts code from a shared link in the editor. It never plays here: the music
   * stops (so live update cannot run it either), and the first Play checks it.
   */
  function openSharedCode(code: string, title: string, cps: number) {
    clearTimeout(liveTimer);
    if (tidal?.isPlaying) tidal.stopAll();
    syncPlaying();
    setSharedUnplayed(true);
    editor.setValue(code);
    setCurrentExample(exampleFor(code, null));
    setEdits((n) => n + 1);
    if (!/setCPS|setcps|setTempo/.test(code)) changeTempo(cps);
    report("warn", 'Opened "' + title + '" from a link. Read the code before you press Play: it runs in your browser.');
  }

  /** Shows a message in the status line. */
  function notify(kind: "" | "warn" | "error", text: string) {
    const playing = tidal?.isPlaying ? "playing" : "";
    report(kind === "" ? playing : kind === "warn" ? (playing ? "playing warn" : "warn") : "error", text);
  }

  return {
    editor,
    status,
    tempo,
    playing,
    syncPlaying,
    streams,
    toggleMute,
    toggleSolo,
    currentExample,
    recording,
    liveEnabled,
    setLiveEnabled,
    category,
    setCategory,
    play,
    stop,
    toggleRecording,
    changeTempo,
    loadExample,
    openCode,
    openSharedCode,
    /** True while shared code waits for its first Play. */
    sharedUnplayed,
    /** Sets the confirmation asked before the first Play of shared code that the scan flags. */
    setRiskyConfirm(fn: (scan: CodeScan) => Promise<boolean>) {
      confirmRiskyShared = fn;
    },
    notify,
    edits,
    examplesLoaded,
    patternsChanged,
    controls,
    controlLayouts,
    setControl,
    /** The engine once audio has started, for the cycle view. */
    engine: () => tidal,
  };
}
