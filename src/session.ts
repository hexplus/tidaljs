/**
 * App state and audio control: what plays, the status line, tempo, live
 * update and recording. Components read the signals and call the actions.
 */
import { effect, signal } from "sibujs";
import { EXAMPLES, type Example } from "./data/examples.ts";
import { SNIPPETS } from "./data/snippets.ts";
import { createEditor, type Editor } from "./editor/Editor.ts";
import { setSampleBanks } from "./editor/language.ts";
import { TidalJS, type ControlLayout, type LiveControl, type StreamInfo, type Tidal } from "./engine.ts";
import { DOCUMENT_KEY, LEGACY_KEYS, newDocumentId, readDocument, serializeDocument } from "./document.ts";
import { LOCAL, approve, describeOrigin, holds, isExternal, type Approval, type Provenance } from "./provenance.ts";
import { Tickets, singleFlight } from "./runs.ts";
import { scanCode, type CodeScan } from "./share.ts";

const KEYS = {
  live: "tidaljs:live",
  category: "tidaljs:snippetCategory",
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
  remove(key: string) {
    try {
      localStorage.removeItem(key);
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
  /** A button next to the message, e.g. Retry for samples that failed to load. */
  action?: { label: string; run: () => void };
}

export type Session = ReturnType<typeof createSession>;

/** What the person is asked before external code first runs: the scan is advice, the answer is theirs. */
export interface ExternalReview {
  provenance: Provenance;
  code: string;
  scan: CodeScan;
}

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
   * Where the editor's code came from (see provenance.ts). External code
   * opens for review and runs only after an explicit Play that the person
   * confirms for that exact text. Kept with the draft across reloads.
   */
  const restored = readDocument(storage.get);
  const [provenance, setProvenanceSignal] = signal<Provenance>(restored.provenance);
  /** Identifies the document in the editor (a new one for each sketch, example, import or link; typing keeps it). */
  const [documentId, setDocumentId] = signal(restored.id);
  /** The tempo an external song brought: applied when it first runs, never before (see play). */
  let pendingCps: number | null = restored.pendingCps;
  /** Writes the code, provenance, identity and pending tempo together (see document.ts). */
  const persistDocument = () => {
    clearTimeout(saveTimer);
    storage.set(DOCUMENT_KEY, serializeDocument({ code: editor.getValue(), provenance: provenance(), id: documentId(), pendingCps }));
    for (const key of Object.values(LEGACY_KEYS)) storage.remove(key);
  };
  const setProvenance = (p: Provenance) => {
    setProvenanceSignal(p);
    persistDocument();
  };
  /** Asks before external code first runs. Set by the sharing UI; until then external code does not run. */
  let confirmExternal: (review: ExternalReview) => Promise<boolean> = async () => false;

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
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Play requests: Stop, or a newer Play, makes an older one stale, so an
   * evaluation waiting for the audio to start (or for a confirmation) never
   * runs after it.
   */
  const plays = new Tickets();
  /** Counts the documents put in the editor (sketches, examples, imports, links); typing does not count. */
  let documentRevision = 0;
  /** The approval of the external code in the editor, for one text of one document. */
  let approval: Approval | null = null;
  /** Counts status messages, so a late message (samples loaded) does not replace a newer one. */
  let statusSeq = 0;
  /** The message the last run left; sample news is shown only while it is still the one shown. */
  let runStatus = -1;
  /** Sample loads already reported as failed, so each is reported once. */
  const reportedFailures = new Set<string>();

  const report = (kind: StatusKind, text: string, warnings: string[] = [], action?: Status["action"]) => {
    statusSeq++;
    setStatus({ kind, text, warnings, action });
  };

  const initialCode = restored.code; // an empty draft stays empty

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
    onChange() {
      setEdits((n) => n + 1);
      scheduleLiveUpdate();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persistDocument, SAVE_DELAY);
    },
  });

  /** Creates the engine on first use (browsers only allow audio after a user gesture); calls share one start. */
  const ensureTidal = singleFlight(async (): Promise<Tidal | null> => {
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
    instance.onError = (err, info) => {
      const where = info?.stream ? " in " + info.stream : "";
      syncPlaying();
      markPatternsChanged();
      report(info?.stopped ? "error" : "playing warn",
        "Runtime error" + where + ": " + err.message + (info?.stopped ? ". Playback stopped." : ". That pattern stopped; the others play on."));
    };
    instance.onSamples(() => samplesSettled(instance));
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
  });

  /** Sets a slider or toggle of the Controls panel. */
  function setControl(name: string, value: number | boolean) {
    tidal?.setControl(name, value);
  }

  /** True while the last run's "Loading samples" message is shown. */
  let waitingForSamples = false;

  /**
   * Sample loads finished (or failed, or were retried). Nothing runs again:
   * the banks are used by the events that need them. The autocomplete learns
   * the banks. The status changes only while the last run's message is still
   * the one shown (a Stop, an error or a newer run keep theirs): "Loading
   * samples" becomes the run's warnings, and failures are reported once, with
   * Retry; failures not shown wait for the next run.
   */
  function samplesSettled(engine: Tidal) {
    setSampleBanks(new Map([...engine.sampleBanks].map(([name, files]) => [name, files.length])));
    if (engine.isLoadingSamples() || statusSeq !== runStatus) return;
    const failures = engine.sampleFailures().filter((f) => !reportedFailures.has(f.source));
    if (failures.length) {
      for (const f of failures) reportedFailures.add(f.source);
      waitingForSamples = false;
      const all = engine.sampleFailures();
      report(engine.isPlaying ? "playing warn" : "warn",
        "Could not load " + (all.length === 1 ? "a sample source" : all.length + " sample sources") + ": " + all[0].message + ".",
        [], { label: "Retry", run: retrySamples });
      runStatus = statusSeq;
      return;
    }
    if (waitingForSamples) {
      waitingForSamples = false;
      const warnings = engine.soundWarnings();
      if (engine.isPlaying) report(warnings.length ? "playing warn" : "playing", warnings.length ? "" : "Samples loaded.", warnings);
      else report(warnings.length ? "warn" : "", warnings.length ? "" : "Samples loaded.", warnings);
      runStatus = statusSeq;
    }
  }

  /** Asks again for the samples that failed; the code that plays runs again so its samples() calls do too. */
  function retrySamples() {
    const engine = tidal;
    if (!engine) return;
    engine.retrySamples();
    reportedFailures.clear();
    if (engine.isPlaying && lastRunCode !== null && editor.getValue() === lastRunCode && !isExternal(provenance())) {
      runCode(engine, true, lastRunCode);
    } else {
      report(engine.isPlaying ? "playing" : "", "The samples will be asked for again the next time the code runs.");
    }
  }

  /** Runs `text` (the editor code) and remembers the message it leaves (see samplesSettled). */
  function runCode(engine: Tidal, live: boolean, text = editor.getValue()) {
    waitingForSamples = false;
    evaluate(engine, live, text);
    // While loads stay failed (they are not asked for again by themselves), every run says so and offers Retry.
    const failed = engine.sampleFailures();
    if (failed.length && !status().action) {
      const s = status();
      const note = "Samples failed to load: " + failed[0].message;
      setStatus({
        kind: s.kind === "error" ? "error" : engine.isPlaying ? "playing warn" : "warn",
        text: s.text,
        warnings: s.warnings.some((w) => failed.some((f) => w.includes(f.message))) ? s.warnings : [...s.warnings, note],
        action: { label: "Retry", run: retrySamples },
      });
      for (const f of failed) reportedFailures.add(f.source);
    }
    runStatus = statusSeq;
  }

  /** Evaluates the code and reports the result. Live updates keep the old music on warnings. */
  function evaluate(engine: Tidal, live: boolean, text: string) {
    // Live updates keep streams whose code has not changed (and their transitions) as they are.
    const result = engine.eval(text, { keepOnWarnings: live, keepUnchanged: live });
    lastRunCode = text;
    markPatternsChanged();
    syncPlaying();
    setTempo(+engine.cps.toFixed(3));
    if (editor.getValue() === text) editor.showProblems(result, text);
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
    if (engine.isLoadingSamples() && !result.warnings.length) {
      report(engine.isPlaying ? "playing" : "", "Loading samples...");
      waitingForSamples = true;
      return;
    }
    if (result.activePatterns === 0) {
      report(result.warnings.length ? "warn" : "", "Nothing to play: no expression returned a pattern.", result.warnings);
    } else {
      const n = result.activePatterns;
      const verb = live ? "Updated: playing " : "Playing ";
      // With warnings, the status line shows only them: "Playing n patterns" is no news there.
      const message = result.warnings.length ? "" : verb + n + " pattern" + (n === 1 ? "" : "s") + ".";
      report(result.warnings.length ? "playing warn" : "playing", message, result.warnings);
    }
  }

  /** The playing streams (d1, #1...) with their mute and solo state. */
  const [streams, setStreams] = signal<StreamInfo[]>([]);
  let streamsKey = "";

  /** Reads the engine's play, stream and recording state; cheap enough to call every frame. */
  function syncPlaying() {
    setPlaying(!!tidal && tidal.isPlaying);
    if (tidal && recording() !== tidal.isRecording) setRecording(tidal.isRecording);
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

  /** True when `text` of the current document may run: local code, or external code approved for exactly this text. */
  const mayRun = (text: string) => !isExternal(provenance()) || holds(approval, text, documentRevision);

  /**
   * Evaluates the editor's code. External code is shown for review first and
   * runs only if the person allows it; the approval is for the text they saw.
   * Whatever is awaited (that answer, the audio starting), the run happens
   * only if nothing changed meanwhile: no Stop or newer Play, the same
   * document, and for external code the same text.
   */
  async function play() {
    clearTimeout(liveTimer);
    const ticket = plays.take();
    const revision = documentRevision;
    let text = editor.getValue();
    if (isExternal(provenance()) && !mayRun(text)) {
      const allowed = await confirmExternal({ provenance: provenance(), code: text, scan: scanCode(text) });
      if (!allowed) {
        if (plays.current(ticket)) report("warn", "Not run. The code is still in the editor for you to read or change.");
        return;
      }
      if (!plays.current(ticket)) return;
      if (documentRevision !== revision || editor.getValue() !== text) {
        report("warn", "The code changed while you were deciding, so it was not run. Press Play to review it again.");
        return;
      }
      approval = approve(text, revision);
    }
    const engine = await ensureTidal();
    if (!engine || !plays.current(ticket)) return; // stopped (or played again) while the audio started
    if (documentRevision !== revision) {
      report("warn", "Another sketch was opened while the audio started: press Play to run it.");
      return;
    }
    if (isExternal(provenance())) {
      if (!mayRun(editor.getValue())) {
        report("warn", "The code changed after you allowed it, so it was not run. Press Play to review it again.");
        return;
      }
    } else {
      text = editor.getValue(); // local code: what is in the editor now
    }
    // The approved text runs: from now on it is the person's own code, and the tempo it came with applies.
    if (isExternal(provenance())) {
      if (pendingCps !== null) changeTempo(pendingCps);
      pendingCps = null;
      setProvenance(LOCAL);
      approval = null;
    }
    runCode(engine, false, text);
    setCurrentExample(exampleFor(text, currentExample()));
    syncPlaying();
  }

  function stop() {
    clearTimeout(liveTimer);
    plays.cancel();
    tidal?.stopAll();
    syncPlaying();
    report("", "Stopped.");
  }

  /** While music is playing, edits are evaluated once typing pauses (never external code that has not run). */
  function scheduleLiveUpdate() {
    clearTimeout(liveTimer);
    const engine = tidal;
    if (!liveEnabled() || !engine || !engine.isPlaying || isExternal(provenance())) return;
    const revision = documentRevision;
    liveTimer = setTimeout(() => {
      const text = editor.getValue();
      if (engine.isPlaying && revision === documentRevision && !isExternal(provenance()) && text !== lastRunCode) runCode(engine, true, text);
    }, LIVE_DELAY);
  }

  effect(() => {
    if (liveEnabled()) scheduleLiveUpdate();
    else clearTimeout(liveTimer);
  });

  async function toggleRecording() {
    const engine = await ensureTidal();
    if (!engine) return;
    // A recorder that fails while recording ends it: the button and the status follow.
    engine.onRecordingError = (err) => {
      setRecording(engine.isRecording);
      report("error", "Recording failed: " + err.message);
    };
    const busy = (): StatusKind => (engine.isPlaying ? "playing" : "");
    if (engine.isRecording) {
      try {
        const saving = engine.stopRecording();
        setRecording(engine.isRecording);
        const blob = await saving;
        if (blob && blob.size > 0) report(busy(), "Recording saved to your downloads.");
        else report("warn", "Nothing was recorded, so no file was saved.");
      } catch (err) {
        report("error", "Recording failed: " + (err as Error).message);
      } finally {
        setRecording(engine.isRecording);
      }
      return;
    }
    try {
      engine.startRecording();
      report(busy(), "Recording. Press Stop recording to save the file.");
    } catch (err) {
      report("error", "Recording failed: " + (err as Error).message);
    } finally {
      setRecording(engine.isRecording);
    }
  }

  function changeTempo(cps: number) {
    setTempo(cps);
    tidal?.setCPS(cps);
  }

  /**
   * Replaces the editor's document. A new document makes waiting Plays, live
   * updates and approvals stale. Local code plays at once if music is playing;
   * external code never does: it waits for a reviewed Play.
   */
  function replaceDocument(code: string, from: Provenance, cps?: number) {
    clearTimeout(liveTimer);
    documentRevision++;
    approval = null;
    plays.cancel();
    editor.setValue(code);
    // The tempo it came with: at once for local code; for external code only when it first runs, so
    // opening it never changes the music that plays.
    const tempoGiven = cps !== undefined && !/setCPS|setcps|setTempo|setbpm/.test(code) ? cps : null;
    pendingCps = isExternal(from) ? tempoGiven : null;
    if (!isExternal(from) && tempoGiven !== null) changeTempo(tempoGiven);
    setDocumentId(newDocumentId());
    setProvenance(from); // writes the new document's snapshot at once (code, provenance, identity, tempo)
    setCurrentExample(isExternal(from) ? null : exampleFor(code, null));
    setEdits((n) => n + 1);
  }

  function loadExample(example: Example) {
    replaceDocument(example.code, LOCAL);
    setCurrentExample(example);
    setExamplesLoaded((n) => n + 1);
    if (tidal?.isPlaying) void play();
    else report("", 'Loaded "' + example.title + '". Press Play or Ctrl+Enter.');
  }

  /**
   * Puts code in the editor: a saved sketch, an imported file or a new
   * sketch. Local code plays at once if music is playing; external code
   * opens for review and never runs by itself.
   */
  function openCode(code: string, title: string, cps?: number, from: Provenance = LOCAL) {
    replaceDocument(code, from, cps);
    if (isExternal(from)) {
      report(tidal?.isPlaying ? "playing warn" : "warn", "Opened " + describeOrigin(from) + " for review. It has not run"
        + (tidal?.isPlaying ? "; what was playing keeps playing" : "") + ". Read it, then press Play to run it.");
    } else if (tidal?.isPlaying) {
      void play();
    } else {
      report("", 'Opened "' + title + '". Press Play or Ctrl+Enter.');
    }
  }

  /** Puts code from a shared link in the editor, for review: it never plays here (see openCode). */
  function openSharedCode(code: string, title: string, cps: number) {
    openCode(code, title, cps, { origin: "shared", label: title });
  }

  /** Shows a message in the status line. */
  function notify(kind: "" | "warn" | "error", text: string) {
    const playingNow = tidal?.isPlaying ? "playing" : "";
    report(kind === "" ? playingNow : kind === "warn" ? (playingNow ? "playing warn" : "warn") : "error", text);
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
    retrySamples,
    /** Where the editor's code came from; external code waits for a reviewed Play. */
    provenance,
    /** Identifies the document in the editor; another sketch, example, import or link gets a new one. */
    documentId,
    /** True while the editor holds external code that has not run (shared, imported or converted). */
    reviewPending: () => isExternal(provenance()),
    /** Sets the question asked before external code first runs. */
    setExternalConfirm(fn: (review: ExternalReview) => Promise<boolean>) {
      confirmExternal = fn;
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
