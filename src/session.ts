/**
 * App state and audio control: what plays, the status line, tempo, live
 * update and recording. Components read the signals and call the actions.
 */
import { effect, signal } from "sibujs";
import { DEFAULT_CODE, type Example } from "./data/examples.ts";
import { SNIPPETS } from "./data/snippets.ts";
import { createEditor, type Editor } from "./editor/Editor.ts";
import { TidalJS, type Tidal } from "./engine.ts";

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

export function parseTempo(value: string): number {
  const v = parseFloat(value);
  return Number.isFinite(v) && v > 0 ? Math.min(10, Math.max(0.05, v)) : 0.8;
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
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const report = (kind: StatusKind, text: string, warnings: string[] = []) => setStatus({ kind, text, warnings });

  const savedCode = storage.get(KEYS.code);
  const editor: Editor = createEditor({
    initialCode: savedCode && savedCode.trim() ? savedCode : DEFAULT_CODE,
    onChange(text) {
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

  /** Runs the editor code. Live updates keep the old music on warnings. */
  function runCode(engine: Tidal, live: boolean) {
    const text = editor.getValue();
    const result = engine.eval(text, { keepOnWarnings: live });
    lastRunCode = text;
    setTempo(+engine.cps.toFixed(3));
    editor.showProblems(result, text);
    const where = result.location ? " (line " + result.location.line + ")" : "";

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

  async function play() {
    clearTimeout(liveTimer);
    const engine = await ensureTidal();
    if (engine) runCode(engine, false);
  }

  function stop() {
    clearTimeout(liveTimer);
    tidal?.stopAll();
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
    if (tidal?.isPlaying) void play();
    else report("", 'Loaded "' + example.title + '". Press Play or Ctrl+Enter.');
  }

  return {
    editor,
    status,
    tempo,
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
    /** The engine once audio has started, for the cycle view. */
    engine: () => tidal,
  };
}
