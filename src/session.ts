/**
 * App state and audio control: what plays, the status line, tempo, live
 * update and recording. Components read the signals and call the actions.
 */
import { effect, signal } from "sibujs";
import { DEFAULT_CODE, EXAMPLES, type Example } from "./data/examples.ts";
import { SNIPPETS } from "./data/snippets.ts";
import { createEditor, type Editor } from "./editor/Editor.ts";
import { setSampleBanks } from "./editor/language.ts";
import { TidalJS, type StreamInfo, type Tidal } from "./engine.ts";

const KEYS = { code: "tidaljs:code", live: "tidaljs:live", category: "tidaljs:snippetCategory" };
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

  let tidal: Tidal | null = null;
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
    tidal = instance;
    return tidal;
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
      report(result.warnings.length ? "playing warn" : "playing", verb + n + " pattern" + (n === 1 ? "" : "s") + ".", result.warnings);
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
    syncPlaying();
  }

  function toggleSolo(name: string) {
    if (!tidal) return;
    tidal.solo(name, !tidal.soloed.has(name));
    syncPlaying();
  }

  async function play() {
    clearTimeout(liveTimer);
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
    if (!liveEnabled() || !engine || !engine.isPlaying) return;
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
    editor.setValue(example.code);
    setCurrentExample(example);
    setEdits((n) => n + 1);
    setExamplesLoaded((n) => n + 1);
    if (tidal?.isPlaying) void play();
    else report("", 'Loaded "' + example.title + '". Press Play or Ctrl+Enter.');
  }

  /** Puts code in the editor (a saved sketch or an imported file); plays it if music is playing. */
  function openCode(code: string, title: string, cps?: number) {
    editor.setValue(code);
    setCurrentExample(exampleFor(code, null));
    setEdits((n) => n + 1);
    if (cps !== undefined && !/setCPS|setcps|setTempo/.test(code)) changeTempo(cps);
    if (tidal?.isPlaying) void play();
    else report("", 'Opened "' + title + '". Press Play or Ctrl+Enter.');
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
    notify,
    edits,
    examplesLoaded,
    /** The engine once audio has started, for the cycle view. */
    engine: () => tidal,
  };
}
