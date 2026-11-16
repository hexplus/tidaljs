/**
 * Plays what the SuperCollider program plays, on a virtual clock, and writes
 * it as TidalJS code. Each Pbind (or routine instrument) becomes one part:
 * its rhythm (dur, rests) as a structure, each key as a TidalJS control, its
 * SynthDef as a TidalJS synth with effects. Parts loop over their shortest
 * period; one cycle is the period most parts share.
 */
import { CONTROL_NAMES } from "../data/signatures.ts";
import { phase, tick } from "./budget.ts";
import { describeText, degreeToKey, gcd, SCALES, TooMuchWork, type Interpreter, type Playback, type PlayRecord } from "./interpreter.ts";
import { advanceOf, DONE, ownDelta, PdefRef, Stream } from "./patterns.ts";
import { analyseSynthDef, envSignalOf, FOLLOWABLE, isEffectControl, lfoSignalOf, mapSignal, soundByName, TIDAL_SOUNDS, type EnvSignal, type Fixed, type LfoSignal, type SynthInfo } from "./synthdef.ts";
import {
  BufferV, BusV, GNode, MidiOutV, NetAddrV, ProxyV, RandToken, RestV, SCEvent, SCFunc, ScaleV, Sym, SynthDefV, SynthV, isPattern, type Value,
} from "./values.ts";

/**
 * A control that moves on its own (a control bus an LFO or an envelope writes, a JITLib proxy read as a control):
 * a TidalJS signal. An envelope runs once, from `start` seconds.
 */
export class SigCell {
  lfo: LfoSignal | null;
  env: { sig: EnvSignal; start: number } | null;
  constructor(lfo: LfoSignal | null, env: { sig: EnvSignal; start: number } | null = null) {
    this.lfo = lfo;
    this.env = env;
  }
  key() { return "sig:" + JSON.stringify(this.lfo ?? this.env); }
  map(fn: (x: number) => number): SigCell {
    if (this.env) return new SigCell(null, { start: this.env.start, sig: { ...this.env.sig, levels: this.env.sig.levels.map((l) => round(fn(l))) } });
    return new SigCell(mapSignal(this.lfo as LfoSignal, fn));
  }
  /** As code for follow(): an LFO at its rate in Hz, an envelope from its start (a held first level until then). */
  followCode(): string {
    if (this.lfo) return followCode(this.lfo);
    const { sig, start } = this.env!;
    if (start <= 1e-9) return envelopeCode(sig);
    return envelopeCode({ levels: [sig.levels[0], ...sig.levels], times: [start, ...sig.times], curves: ["lin", ...sig.curves] });
  }
}

/** What a part needs from the whole conversion. */
interface Context {
  interp: Interpreter;
  synthFor: (name: string) => SynthInfo | null;
  note: (s: string) => void;
  tempo: number;
  /** Audio buses: the effect synths that read each one (In.ar), with their arguments and where they write. */
  fx: Map<number, { info: SynthInfo; args: SCEvent; out: number | null; name: string }[]>;
  /** Control buses an LFO synth writes (Out.kr): their signal. */
  lfos: Map<number, SigCell>;
  /** Buffers the parts play: they become sample banks. */
  banks: Set<BufferV>;
  /** Tie ids handed to Pmono parts. */
  ties: number;
}

/** How far the program is played to find its loops, in beats. */
const HORIZON = 512;
/** The most events one played pattern or routine gives (dense material stops earlier than the horizon). */
const MAX_EVENTS = 6000;
/** What loops when something never repeats, in beats. */
const FALLBACK = 16;
/** The most synths a part starts at one instant that are written (each one a voice of its own). */
const MAX_VOICES = 16;

interface SimEvent {
  t: number;
  src: string;
  line: number;
  delta: number;
  sustain: number;
  instrument: string;
  ev: SCEvent;
  /** A rest: it plays nothing, but takes its time (a random duration draws for it too). */
  rest?: boolean;
}

interface Part {
  name: string;
  line: number;
  instrument: string;
  events: SimEvent[];
  /** The rests between the events, for random durations (rhythm() gives each its own step). */
  rests?: SimEvent[];
  /** When it starts, in beats (its first event or rest). */
  start: number;
  /** When it ends (a part that stops: a finite pattern, an intro), or null when it plays on. */
  end: number | null;
  /** How far it was played: its loops are looked for up to here (dense material stops before the horizon). */
  horizon: number;
  /** Why it was not played further: the horizon (512 beats), or the most events a pattern may give. */
  cap: Cap;
  /** One synth that plays until it is stopped. */
  drone: boolean;
}

const CONTROLS = new Set(CONTROL_NAMES);
const EVENT_KEYS = new Set([
  "dur", "delta", "stretch", "legato", "sustain", "instrument", "type", "amp", "db", "pan", "degree", "scale", "octave", "root",
  "mtranspose", "gtranspose", "ctranspose", "note", "midinote", "freq", "detune", "harmonic", "stepsPerOctave", "strum", "lag",
  "timingOffset", "out", "group", "addAction", "id", "server", "tempo", "velocity", "hasGate", "isRest", "s", "orbit", "latency",
  "sendGate", "midicmd", "chan", "midiout", "ctlNum", "control", "bufnum", "buf", "progNum", "in", "send", "uid", "hasGate",
]);

const NAMES = ["c", "c#", "d", "eb", "e", "f", "f#", "g", "ab", "a", "bb", "b"];
/** Names TidalJS uses for its own functions: a part named like one gets a suffix. */
const TAKEN = new Set([
  "saw", "sine", "tri", "square", "cosine", "isaw", "rand", "irand", "perlin", "silence", "note", "sound", "s", "n", "stack",
  "cat", "default", "scale", "chord", "run", "scan", "fit", "struct", "layer", "squeeze", "choose", "noise", "pink", "arpy",
  "bd", "sn", "hh", "cp", "oh", "ch", "cy", "new", "delete", "function", "var", "let", "const", "class", "this", "in", "do",
  "if", "for", "while", "switch", "case", "return", "with", "time", "steps", "seq", "p",
]);

export interface EmitResult {
  code: string;
  parts: number;
}

export function emitTidal(interp: Interpreter, sourceName: string): EmitResult {
  const notes: string[] = [];
  const note = (text: string) => { if (!notes.includes(text)) notes.push(text); };

  // The tempo: the first explicit clock, or the default clock.
  const played = interp.played;
  const firstClock = played.find((r) => r.clock.explicit)?.clock ?? interp.defaultClock;
  let tempo = firstClock.tempo;
  if (!(tempo > 0) || !Number.isFinite(tempo)) {
    note("The clock's tempo (" + String(tempo) + ") is not a positive number: SuperCollider's default, 1 beat per second, is used.");
    tempo = 1;
  }

  // Play everything, on one timeline (beats at `tempo`). Each source is a pattern (a Pbind, a routine's instrument)
  // in one playback (each .play, a routine's included): it keeps when it starts, how far it was played and whether
  // the stream that played it ended there, so a pattern played, stopped and played again keeps the gap between,
  // and a routine that ends does not end the patterns it started.
  phase("playing the patterns");
  const events: SimEvent[] = [];
  const restsBySrc = new Map<string, SimEvent[]>();
  const reach = new Map<string, Reach>();
  const simCtx: SimCtx = { interp, tempo, note, streams: new Map(), pdefs: new Map() };
  // Whether something plays on past where it was followed (a routine that loops forever, even when each pattern
  // it starts ends): then the piece does not end.
  let open = false;
  for (const [index, rec] of played.entries()) {
    const scale = tempo / (rec.clock.tempo > 0 ? rec.clock.tempo : 1);
    const sim = simulate(simCtx, rec, index, scale);
    if (sim.open) open = true;
    for (const [src, r] of sim.reach) mergeReach(reach, src, r);
    for (const e of sim.events) {
      if (!e.rest) { events.push(e); continue; }
      const list = restsBySrc.get(e.src) ?? [];
      list.push(e);
      restsBySrc.set(e.src, list);
    }
  }
  if (played.length === 0) {
    note("Nothing in the file plays (no .play, Pdef(...).play, Synth or routine): the patterns it defines are shown.");
  }

  // Synths.
  phase("reading the SynthDefs");
  const synthCache = new Map<string, SynthInfo | null>();
  const synthFor = (name: string): SynthInfo | null => {
    if (!synthCache.has(name)) {
      const def = interp.synthDefs.get(name);
      synthCache.set(name, def ? analyseSynthDef(interp, def) : null);
    }
    return synthCache.get(name) ?? null;
  };

  // Effect synths (they read a bus with In.ar) and LFO synths (they write a control bus) are not parts:
  // the effects go onto the parts that play into their bus, the LFOs become signals where their bus is read.
  const ctx: Context = { interp, synthFor, note, tempo, fx: new Map(), lfos: new Map(), banks: new Set(), ties: 0 };
  const parts0: SimEvent[] = [];
  for (const e of events) {
    const info = synthFor(e.instrument);
    if (info?.input) {
      const from = info.input.bus === null ? null : busIndex(info.input.bus, e.ev, info);
      if (from === null) note("The effect \\" + e.instrument + " (line " + e.line + ") reads a bus that could not be found: it is left out.");
      else {
        const list = ctx.fx.get(from) ?? [];
        if (!list.some((f) => f.args === e.ev)) list.push({ info, args: e.ev, out: busIndex(info.mainBus, e.ev, info), name: e.instrument });
        ctx.fx.set(from, list);
      }
      continue;
    }
    if (info?.control) {
      const to = busIndex(info.mainBus, e.ev, info);
      const lfo = lfoSignalOf(info.control, (x) => argNumber(x, e.ev, info));
      const env = lfo ? null : envSignalOf(info.control, (x) => argNumber(x, e.ev, info));
      if (to !== null && lfo) ctx.lfos.set(to, new SigCell(lfo));
      // An envelope that writes the bus: it runs once, from when the synth starts.
      else if (to !== null && env) ctx.lfos.set(to, new SigCell(null, { sig: env, start: e.t / tempo }));
      else note("The control synth \\" + e.instrument + " (line " + e.line + ") moves in a way TidalJS cannot follow: it is left out.");
      continue;
    }
    parts0.push(e);
  }

  // One part per source (Pbind, or routine and instrument).
  const bySrc = new Map<string, SimEvent[]>();
  for (const e of parts0) {
    const list = bySrc.get(e.src) ?? [];
    list.push(e);
    bySrc.set(e.src, list);
  }

  // A synth started once that nothing ends ({ ... }.play, Synth(\default)) plays until it is stopped.
  const isDrone = (list: SimEvent[]) => list.length === 1 && list[0].ev.get("__top") === true
    && (list[0].instrument === "default" || synthFor(list[0].instrument)?.endless === true);

  const parts: Part[] = [];
  for (const [src, list] of bySrc) {
    list.sort((a, b) => a.t - b.t);
    const rests = (restsBySrc.get(src) ?? []).sort((a, b) => a.t - b.t);
    const drone = isDrone(list);
    const played = reach.get(src) ?? { horizon: HORIZON, ended: false, cap: "horizon" };
    const life = lifetime(list, rests, played);
    const base = { line: list[0].line, start: drone ? 0 : life.start, end: drone ? null : life.end, horizon: life.horizon, cap: played.cap, drone };
    const instruments = [...new Set(list.map((e) => e.instrument))];
    // Events that take turns between SynthDefs: one part per SynthDef, so each event keeps its own SynthDef's
    // sound, fixed controls, envelopes and effects. The other SynthDefs' events are rests there (for random durations).
    if (instruments.length > 1 && instruments.every((i) => !i.startsWith("__")) && instruments.some((i) => synthFor(i) !== null)) {
      note("Line " + base.line + " plays " + instruments.map((i) => "\\" + i).join(", ") + " in turn: each becomes a part of its own, with its own SynthDef's sound and effects.");
      for (const inst of instruments) {
        const own = list.filter((e) => e.instrument === inst);
        const others = list.filter((e) => e.instrument !== inst).map((e) => ({ ...e, rest: true }));
        parts.push({ ...base, name: src + ":" + inst, instrument: inst, events: own, rests: [...rests, ...others].sort((a, b) => a.t - b.t) });
      }
      continue;
    }
    parts.push({ ...base, name: src, instrument: instruments.length === 1 ? instruments[0] : "", events: list, rests });
  }
  // Everything stops (no endless pattern, routine or synth): SuperCollider plays it once, and the TidalJS code
  // loops the whole piece, as a preview, every `loopLength` beats.
  const loopLength = !open && parts.length && parts.every((p) => !p.drone && p.end !== null) ? Math.max(...parts.map((p) => p.end as number)) : null;
  if (loopLength !== null) {
    note("In SuperCollider this plays once (" + fmt(loopLength) + (loopLength === 1 ? " beat" : " beats") + "); here the whole piece loops, every "
      + fmt(loopLength) + (loopLength === 1 ? " beat" : " beats") + ", as a preview.");
  }
  if (parts.some((p) => p.drone)) {
    note("A synth that nothing stops plays until you stop it in SuperCollider; here its note restarts every cycle.");
  }

  // Write each part.
  phase("finding the loops and writing the parts");
  const written = parts.map((part) => ({ part, w: writePart(part, ctx) }));
  const valid = written.filter((x): x is { part: Part; w: WrittenPart } => x.w !== null);
  const keys = played.filter((r) => (r.kind === "midikeys" || r.kind === "oscplay") && r.synth).map((r) => writeMidiKeys(r, ctx));
  if (played.some((r) => r.kind === "midikeys")) note("MIDI keys play through midikeys(): the browser asks for permission to use MIDI input.");
  if (played.some((r) => r.kind === "oscplay")) note("Synths started by OSC messages play through oscplay(): the messages come in over TidalJS's OSC bridge (setOscUrl() sets its address).");

  // Beats per cycle: the period most parts share (4, a bar, when it fits).
  const periods = valid.filter(({ w }) => !w.rhythm).map(({ w }) => w.period);
  let beatsPerCycle = chooseCycle(periods);
  // TidalJS plays 0.05 to 10 cycles per second: outside that, a cycle of more (or fewer) beats keeps the tempo exact.
  const chosen = beatsPerCycle;
  while (tempo / beatsPerCycle > MAX_CPS && beatsPerCycle < 2 ** 20) beatsPerCycle *= 2;
  while (tempo / beatsPerCycle < MIN_CPS && beatsPerCycle > 2 ** -20) beatsPerCycle /= 2;
  if (beatsPerCycle !== chosen) {
    note("At " + fmt(tempo * 60) + " beats per minute, one cycle is " + fmt(beatsPerCycle) + (beatsPerCycle === 1 ? " beat" : " beats")
      + ", so that the tempo stays within what TidalJS plays (" + MIN_CPS + " to " + MAX_CPS + " cycles per second) and is kept exactly.");
  }
  const cps = tempo / beatsPerCycle;
  if (cps > MAX_CPS || cps < MIN_CPS) {
    note("The tempo (" + fmt(tempo * 60) + " beats per minute) is outside what TidalJS plays: it plays at " + (cps > MAX_CPS ? MAX_CPS : MIN_CPS) + " cycles per second instead.");
  }
  const cycles = (beats: number) => ratioCode(beats / beatsPerCycle);

  const usedNames = new Set<string>();
  const blocks: string[] = [];
  const names: string[] = [];
  let loopNeeded = false;
  for (const { part, w } of valid) {
    const name = uniqueName(w.label, usedNames);
    names.push(name);
    const span = w.period / beatsPerCycle;
    let body = w.body;
    const comment = [...w.comment];
    if (w.rhythm) {
      // One event per cycle (the k-th at cycle k), which rhythm() spreads over its random durations, in cycles.
      if (w.rhythm.steps !== 1) body += "\n  .slow(" + fmt(w.rhythm.steps) + ")";
      body += "\n  .rhythm(" + durationsCode(w.rhythm.durs, 1 / beatsPerCycle) + ")";
    } else if (Math.abs(span - 1) > 1e-9) {
      body += span > 1 ? "\n  .slow(" + ratioCode(span) + ")" : "\n  .fast(" + ratioCode(1 / span) + ")";
    }
    // The written loop starts at w.start: shifted there when that is not where its loops fall anyway.
    const late = w.rhythm ? w.start : mod(w.start, w.period);
    if (late > 1e-9 && (w.rhythm || w.period - late > 1e-9)) body += "\n  .late(" + cycles(late) + ")";
    // When it plays: from its start (its first event or rest), until it stops.
    const from = part.drone ? 0 : Math.max(0, part.start);
    if (part.end !== null) {
      const whole = loopLength !== null && Math.abs(loopLength / w.period - Math.round(loopLength / w.period)) < 1e-6;
      if (loopLength === null || from > 1e-9 || part.end < loopLength - 1e-9 || !whole) {
        body += "\n  .playFor(" + cycles(from) + ", " + cycles(part.end) + ")";
        if (loopLength !== null) loopNeeded = true;
      }
      comment.push(loopLength === null
        ? "It plays once, from beat " + fmt(from) + " to beat " + fmt(part.end) + ", as in SuperCollider."
        : "It plays from beat " + fmt(from) + " to beat " + fmt(part.end) + " of the piece.");
    } else if (from > 1e-9) {
      body += "\n  .stopFor(0, " + cycles(from) + ")";
      comment.push("It starts at beat " + fmt(from) + ", as in SuperCollider.");
    }
    blocks.push(comment.map(commentLine).join("\n") + "\n" + (valid.length > 1 ? "const " + name + " = " : "") + body);
  }

  for (const n of interp.notes) note(n);
  const header: string[] = [];
  header.push(commentLine((sourceName ? sourceName + ": c" : "C") + "onverted from SuperCollider by TidalJS."));
  if (notes.length) {
    header.push("// Notes on the conversion:");
    for (const n of notes) header.push(commentLine("- " + n));
  }
  const tempoComment = (firstClock.explicit || tempo !== 1 ? "tempo " + fmt(tempo) + " beats per second" : "SuperCollider's default tempo, 1 beat per second")
    + ", " + fmt(beatsPerCycle) + " beat" + (beatsPerCycle === 1 ? "" : "s") + " per cycle";
  const lines = [
    header.join("\n"),
    tempoLine(tempo, beatsPerCycle) + " " + commentLine(tempoComment),
    "setOutput(1, false) // as SuperCollider: no master volume and no limiter",
  ];
  if (ctx.banks.size) {
    // The sound files the SuperCollider code reads with Buffer.read, as TidalJS sample banks.
    const banks = [...ctx.banks].map((b) => "  " + (/^[a-z_$][\w$]*$/i.test(b.bank) ? b.bank : str(b.bank)) + ": [" + str(webPath(b.path ?? "")) + "],");
    lines.push("samples({\n" + banks.join("\n") + "\n}) // the files SuperCollider reads with Buffer.read: they must be reachable from the browser (a URL or a path next to the page)");
  }
  for (const k of keys) {
    const name = uniqueName(k.label, usedNames);
    names.push(name);
    blocks.push(k.comment.map(commentLine).join("\n") + "\n" + (valid.length + keys.length > 1 ? "const " + name + " = " : "") + k.body);
  }
  // The GUI's windows: groups of the Controls panel, laid out as in SuperCollider (only controls the code uses).
  const code = blocks.join("\n");
  const inCode = (name: string) => code.includes("slider(" + str(name) + ",") || code.includes("toggle(" + str(name) + ")") || code.includes("toggle(" + str(name) + ",");
  for (const win of interp.windowLayouts()) {
    const rows = win.rows.map((r) => r.filter(inCode)).filter((r) => r.length);
    if (rows.length) lines.push("controlLayout(" + str(win.title) + ", [" + rows.map((r) => "[" + r.map((n) => str(n)).join(", ") + "]").join(", ") + "]) " + commentLine("the window " + str(win.title) + " of the SuperCollider GUI"));
  }
  const total = valid.length + keys.length;
  if (total === 0) {
    lines.push("", "// Nothing to play was found.");
    return { code: checked(lines.join("\n") + "\n"), parts: 0 };
  }
  lines.push("", blocks.join("\n\n"));
  const preview = loopNeeded && loopLength !== null
    ? ".timeLoop(" + cycles(loopLength) + ") " + commentLine("a preview: SuperCollider plays this once (" + fmt(loopLength) + " beats); here it loops")
    : "";
  if (total > 1) lines.push("", "stack([" + names.join(", ") + "])" + preview);
  else if (preview) lines[lines.length - 1] += "\n  " + preview;
  return { code: checked(lines.join("\n") + "\n"), parts: total };
}

/** Why a pattern was not played further, when it did not end: the horizon, or MAX_EVENTS events. */
type Cap = "horizon" | "events" | null;

/**
 * How far a source was played, whether the stream that played it really ended (its pattern ran out, or it was
 * stopped: then it has an end), and if not, why it was not played further (the horizon or the most events: an
 * observation limit, not an end).
 */
interface Reach {
  horizon: number;
  ended: boolean;
  cap: Cap;
  /** Where it was stopped (.stop), in beats: it ends there, even with a note still sounding. */
  stop?: number;
}

/** A source a playback gives more than once (a Pbind twice in a Ppar or a Pseq) ends only when every one of its streams ended. */
function mergeReach(reach: Map<string, Reach>, src: string, r: Reach) {
  const old = reach.get(src);
  if (!old) { reach.set(src, r); return; }
  const ended = old.ended && r.ended;
  const stop = ended && old.stop !== undefined && r.stop !== undefined ? Math.max(old.stop, r.stop) : undefined;
  reach.set(src, { horizon: Math.min(old.horizon, r.horizon), ended, cap: ended ? null : r.horizon < old.horizon ? r.cap : old.cap, ...(stop === undefined ? {} : { stop }) });
}

/**
 * When a source starts and ends. It ends where its last event (or rest) ends when what played it ended (a finite
 * pattern), or when it stopped long before the others did (an intro beside a part that plays on, a section):
 * still playing, its last event reaches the horizon, or the time since it is no longer than its own longest gap.
 */
function lifetime(list: SimEvent[], rests: SimEvent[], reach: Reach): { start: number; end: number | null; horizon: number } {
  let start = Infinity, last = -Infinity;
  const times: number[] = [];
  for (const e of [...list, ...rests]) {
    start = Math.min(start, e.t);
    last = Math.max(last, e.t + Math.max(0, e.delta));
    times.push(e.t);
  }
  if (!Number.isFinite(start)) return { start: 0, end: null, horizon: reach.horizon };
  if (reach.ended) return { start, end: reach.stop ?? Math.max(last, start), horizon: reach.horizon };
  times.sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < times.length; i++) gap = Math.max(gap, times[i] - times[i - 1]);
  const playing = last >= reach.horizon - 1e-6 || reach.horizon - last <= gap + 1e-6;
  return { start, end: playing ? null : last, horizon: reach.horizon };
}

/** What TidalJS's setCPS accepts, in cycles per second (it clamps other values). */
const MIN_CPS = 0.05;
const MAX_CPS = 10;
/** What TidalJS's setTempo accepts, in beats per minute (4 beats per cycle; it clamps other values). */
const MIN_BPM = 20;
const MAX_BPM = 300;

/** The tempo as TidalJS code: setTempo(bpm) for 4 beats per cycle within its range, else setCPS. */
function tempoLine(tempo: number, beats: number): string {
  const bpm = tempo * 60;
  const exact = (x: number) => Math.abs(Number(fmt(x)) - x) < 1e-12 * Math.max(1, Math.abs(x));
  if (beats === 4 && exact(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM) return "setTempo(" + fmt(bpm) + ")";
  const cps = Math.min(MAX_CPS, Math.max(MIN_CPS, tempo / beats));
  if (cps !== tempo / beats) return "setCPS(" + fmt(cps) + ")";
  if (exact(cps)) return "setCPS(" + fmt(cps) + ")";
  if (exact(tempo) && exact(beats)) return "setCPS(" + fmt(tempo) + " / " + fmt(beats) + ")";
  if (exact(bpm) && exact(beats)) return "setCPS(" + fmt(bpm) + " / 60 / " + fmt(beats) + ")";
  return "setCPS(" + String(cps) + ")";
}

// ---------------------------------------------------------------- simulation

/**
 * What a played pattern gave: its events, where its own stream ended (null: it plays on), how far it was played,
 * why not further, each source's own reach (the patterns it started have theirs), and whether it, or a pattern it
 * started, plays on past where it was followed.
 */
interface Sim {
  events: SimEvent[];
  end: number | null;
  horizon: number;
  cap: Cap;
  reach: Map<string, Reach>;
  open: boolean;
}

/** What every playback is simulated with: the common tempo (beats per second), and the streams playbacks stopped. */
interface SimCtx {
  interp: Interpreter;
  tempo: number;
  note: (s: string) => void;
  /** Each playback's stream where it stopped: x.resume (or x.play) after x.stop goes on from there. */
  streams: Map<number, Stream>;
  /** When each Pdef played (from, to: null while it plays on), in beats of the common timeline. */
  pdefs: Map<string, [number, number | null][]>;
}

/**
 * Whether a Pdef plays already at `at` (in beats of the common timeline): then its play does nothing, as in
 * SuperCollider. Otherwise `played` notes when this playback plays (once it was played).
 */
function pdefPlaying(ctx: SimCtx, pattern: Value | undefined, at: number): ((sim: Sim) => void) | null | undefined {
  if (!(pattern instanceof PdefRef)) return undefined;
  const list = ctx.pdefs.get(pattern.key) ?? [];
  if (list.some(([from, to]) => at >= from - 1e-9 && (to === null || at < to - 1e-9))) return null;
  return (sim) => {
    list.push([at, sim.end]);
    ctx.pdefs.set(pattern.key, list);
  };
}

/** Where a playback is stopped, in beats of the common timeline: the first stop at or after its start. */
function stopOf(pb: Playback, start: number, tempo: number): number | undefined {
  let stop: number | undefined;
  for (const s of pb.stops) {
    const at = s.beats * tempo / (s.clock.tempo > 0 ? s.clock.tempo : 1);
    if (at >= start - 1e-9 && (stop === undefined || at < stop)) stop = at;
  }
  return stop === undefined ? undefined : Math.max(start, stop);
}

function simulate(ctx: SimCtx, rec: PlayRecord, index: number, scale: number): Sim {
  const { interp } = ctx;
  const out: SimEvent[] = [];
  if (rec.kind === "event" && rec.event) {
    const ev = rec.event;
    const src = "e" + rec.line + ":" + describeText(ev.get("instrument") ?? new Sym("default"));
    out.push(resolve(ev, 0, ownDelta(ev), src, rec.line, scale));
    const end = ownDelta(ev) * scale;
    return { events: out, end, horizon: end, cap: null, reach: new Map([[src, { horizon: end, ended: true, cap: null }]]), open: false };
  }
  const source = rec.pattern;
  if (!isPattern(source)) return { events: out, end: 0, horizon: 0, cap: null, reach: new Map(), open: false };
  const pb = rec.playback === undefined ? undefined : interp.playbacks[rec.playback];
  const until = pb ? stopOf(pb, rec.start * scale, ctx.tempo) : undefined;
  const pdef = pdefPlaying(ctx, pb?.pattern, rec.start * scale);
  if (pdef === null) return { events: out, end: 0, horizon: 0, cap: null, reach: new Map(), open: false };
  const sim = run(ctx, source, rec.start, rec.line, scale, out, 0, { endless: rec.endless, ...(until === undefined ? {} : { until: until / scale }) },
    (rec.kind === "routine" ? "R" : "P") + index, rec.playback);
  pdef?.(sim);
  return sim;
}

/** One playback a routine started, while the routine is played: its own key, which pattern, its events (out[from..to)). */
interface Launch {
  key: string;
  group: string;
  from: number;
  to: number;
  sim: Sim;
}

/** The most playbacks of one pattern a routine that loops forever starts that are written each as a part of its own. */
const MAX_SPLIT = 16;

/**
 * How a playback ends besides its pattern running out: `endless`, a routine that was cut at the horizon (its
 * stream ends there, but only because it was not played further); `until`, where it is stopped, in beats of its clock.
 */
interface Life {
  endless?: boolean;
  until?: number;
}

/**
 * Plays a pattern from `start` (in beats of its clock; `scale` turns them into beats of the common timeline) until
 * it ends, reaches the horizon (512 beats) or has given MAX_EVENTS events. A pattern that stops giving events (an
 * empty pattern repeated forever: SuperCollider hangs there) ends where it stopped, with a note; so do events that
 * take no time, again and again. `key` names this playback: its sources are its patterns in it (`src@key`).
 * `playback`: the pattern's playback (where it is stopped; a resumed one goes on with the stream it continues).
 */
function run(ctx: SimCtx, source: Value, start: number, line: number, scale: number, out: SimEvent[], depth: number, life: Life, key: string, playback?: number): Sim {
  const { interp, note } = ctx;
  const resumes = playback === undefined ? undefined : interp.playbacks[playback]?.resumes;
  const stream = (resumes !== undefined ? ctx.streams.get(resumes) : undefined) ?? new Stream(source, { host: interp });
  if (playback !== undefined) ctx.streams.set(playback, stream);
  const first = out.length;
  let t = start;
  let count = 0;
  // Events a negative timingOffset moves earlier are known only up to that much before where it stopped.
  let earliest = 0;
  const known = () => (t + earliest) * scale;
  // The sources this stream plays itself, and whether the stream that gave each one ended (a Ppar's pattern that
  // ran out while the others play on); the patterns it starts (a routine's) are playbacks of their own.
  const own = new Map<string, boolean>();
  const reach = new Map<string, Reach>();
  // Whether a pattern it started plays on past where it was followed, and the playbacks it started.
  let open = false;
  const launches: Launch[] = [];
  const groups = new Map<Value, string>();
  // Where the playback ends (null: it plays on), how far it was played, and why not further. A routine cut at the
  // horizon has not ended: it was not played further.
  const finish = (end: number | null, horizon: number, cap: Cap): Sim => {
    const ended = end !== null && !life.endless;
    const stopped = end !== null && ended && life.until !== undefined && Math.abs(end - life.until * scale) < 1e-9;
    const why: Cap = end !== null ? "horizon" : cap;
    for (const [src, marked] of own) {
      const r: Reach = end !== null && ended ? { horizon: end, ended: true, cap: null, ...(stopped ? { stop: end } : {}) }
        : marked ? { horizon, ended: true, cap: null }
        : { horizon, ended: false, cap: why };
      mergeReach(reach, src, r);
    }
    if (series(launches, groups.size, key, horizon, life, out, reach)) {
      note("Line " + line + ": the routine loops forever; the patterns it starts are followed for its first " + fmt(horizon) + " beats: the new ones it would start after that are not written.");
    }
    return { events: out, end: ended ? end : null, horizon, cap: ended ? null : why, reach, open: open || !ended };
  };
  for (;;) {
    if (life.until !== undefined && t >= life.until - 1e-9) return finish(life.until * scale, life.until * scale, null);
    if (t * scale >= HORIZON) return finish(null, known(), "horizon");
    if (count++ > MAX_EVENTS) {
      if (t <= start + 1e-9) {
        // No time passed: in SuperCollider the clock never moves on.
        note("Line " + line + " plays events that take no time (dur 0), one after another forever: SuperCollider would hang there, so they are left out.");
        out.length = first;
        return finish(t * scale, t * scale, null);
      }
      return finish(null, known(), "events");
    }
    interp.time = t;
    interp.inPattern = true;
    // Each event has its own allowance of work: a pattern that never yields is stopped (TooMuchWork).
    interp.resetWork();
    let ev;
    try {
      ev = stream.next(new SCEvent());
    } catch (err) {
      if (!(err instanceof TooMuchWork)) throw err;
      note("Line " + line + ": a pattern stops giving values (an empty pattern repeated forever, such as Pn(Pseq([], inf))): SuperCollider would hang there, so it ends "
        + (t <= 1e-9 ? "at the start" : "after " + fmt(t * scale) + " beats") + ".");
      return finish(t * scale, t * scale, null);
    } finally {
      interp.inPattern = false;
    }
    tick();
    if (ev === DONE || !(ev instanceof SCEvent)) return finish(t * scale, t * scale, null);
    const sub = ev.get("__pattern");
    if (sub !== undefined && depth < 4) {
      // A pattern a routine started: a playback of its own, from now (on the next multiple of its quant), on its own
      // clock (the default clock unless it was given one), until it ends or is stopped (it outlives the routine).
      const index = ev.get("__playback");
      const pb = typeof index === "number" ? interp.playbacks[index] : undefined;
      const own = pb ? ctx.tempo / (pb.clock.tempo > 0 ? pb.clock.tempo : 1) : scale;
      let at = (t * scale) / own;
      if (pb && pb.quant > 0) at = Math.ceil((at - pb.phase) / pb.quant - 1e-9) * pb.quant + pb.phase;
      const until = pb ? stopOf(pb, at * own, ctx.tempo) : undefined;
      const pattern = pb?.pattern ?? sub;
      const pdef = pdefPlaying(ctx, pattern, at * own);
      if (pdef !== null) {
        const id = pattern instanceof PdefRef ? "pdef:" + pattern.key : pattern;
        if (!groups.has(id)) groups.set(id, String(groups.size));
        const launchKey = key + "/" + launches.length;
        const from = out.length;
        const inner = run(ctx, sub, at, numOf(ev.get("__line"), line), own, out, depth + 1, until === undefined ? {} : { until: until / own }, launchKey, typeof index === "number" ? index : undefined);
        launches.push({ key: launchKey, group: groups.get(id) as string, from, to: out.length, sim: inner });
        pdef?.(inner);
        if (inner.open) open = true;
      }
    } else {
      const offset = numOf(ev.get("timingOffset"), 0);
      earliest = Math.min(earliest, offset);
      const src = String(ev.get("__src") ?? "p" + line) + "@" + key;
      const delta = ownDelta(ev) * scale;
      // A Ppar marks the last event of a pattern of its that ran out; a later event of that source plays on.
      own.set(src, ev.get("__srcEnd") === true);
      if (!isRest(ev)) out.push(resolve(ev, (t + offset) * scale, delta, src, numOf(ev.get("__line"), line), scale));
      else if (delta > 1e-9) out.push({ ...resolve(ev, (t + offset) * scale, delta, src, numOf(ev.get("__line"), line), scale), rest: true });
    }
    const adv = advanceOf(ev);
    t += adv > 0 || adv === 0 ? adv : 0;
  }
}

/**
 * The playbacks a routine started, as sources: each its own (with its own start and end), except the playbacks of
 * one pattern that a routine that loops forever starts again and again, or that all end, which are one source (a
 * series: their loop holds the gaps between them). The playbacks of one pattern a looping routine starts that do
 * not repeat (one that plays on while the next starts) stay apart, unless there are more than MAX_SPLIT of them.
 * Returns whether some playback is its own source in a routine that loops forever (the new patterns it would start
 * after the horizon are not written).
 */
function series(launches: Launch[], count: number, key: string, horizon: number, life: Life, out: SimEvent[], reach: Map<string, Reach>): boolean {
  let single = false;
  for (let g = 0; g < count; g++) {
    const list = launches.filter((l) => l.group === String(g));
    const ended = list.every((l) => [...l.sim.reach.values()].every((r) => r.ended));
    // The events of a playback's own patterns (not those of the playbacks it started in turn).
    const ownEvents = (l: Launch) => out.slice(l.from, l.to).filter((e) => e.src.endsWith("@" + l.key));
    let merge = list.length > 1 && ended && !life.endless;
    // The window the series was followed in: up to where the routine, or a playback of it that plays on, was cut.
    let until = horizon;
    for (const l of list) for (const r of l.sim.reach.values()) if (!r.ended) until = Math.min(until, r.horizon);
    if (list.length > 1 && life.endless) {
      const evs = list.flatMap(ownEvents).filter((e) => !e.rest).sort((a, b) => a.t - b.t);
      const keys = evs.map((e) => fmtKey(e.delta) + "|" + e.src.slice(0, e.src.lastIndexOf("@")) + "|" + e.instrument);
      merge = list.length > MAX_SPLIT || findPeriod(evs, keys, until) !== null;
    }
    if (!merge) {
      for (const l of list) for (const [src, r] of l.sim.reach) mergeReach(reach, src, r);
      if (life.endless) single = true;
      continue;
    }
    // One source per pattern of the series: `src@key/g` (named after the routine's playback and the pattern).
    const name = key + "/s" + g;
    const merged = new Map<string, { ends: number[]; open: boolean }>();
    for (const l of list) {
      for (const [src, r] of l.sim.reach) {
        if (!src.endsWith("@" + l.key)) { mergeReach(reach, src, r); continue; }
        const base = src.slice(0, src.length - l.key.length - 1);
        const m = merged.get(base) ?? { ends: [], open: false };
        if (!r.ended) m.open = true;
        else m.ends.push(r.stop ?? Math.max(0, ...out.slice(l.from, l.to).filter((e) => e.src === src).map((e) => e.t + Math.max(0, e.delta))));
        merged.set(base, m);
      }
      for (const e of ownEvents(l)) e.src = e.src.slice(0, e.src.length - l.key.length) + name;
    }
    for (const [base, m] of merged) {
      const src = base + "@" + name;
      // A routine that loops forever plays the series on; one that ends, until the last of its playbacks ends.
      reach.set(src, m.open || life.endless ? { horizon: until, ended: false, cap: "horizon" } : { horizon: Math.max(...m.ends), ended: true, cap: null, stop: Math.max(...m.ends) });
    }
  }
  return single;
}

function resolve(ev: SCEvent, t: number, delta: number, src: string, line: number, scale: number): SimEvent {
  const type = ev.get("type") instanceof Sym ? (ev.get("type") as Sym).name : "";
  const dirt = type === "dirt";
  let instrument = describeText((dirt ? ev.get("s") : ev.get("instrument")) ?? new Sym("default"));
  if (type === "midi") instrument = "__midi";
  // A synth a routine started together with others (no wait between them) has no time of its own before the
  // next one starts; it lasts, as they do, until the routine moves on.
  const hold = ev.get("__hold");
  if (ev.get("__synth") && delta < 1e-9 && typeof hold === "number" && hold > 0) delta = hold * scale;
  let sustain: number;
  const sus = ev.get("sustain");
  if (typeof sus === "number") sustain = sus * scale;
  else if (ev.get("__synth") || type === "midi") sustain = delta * (type === "midi" && !ev.get("__synth") ? numOf(ev.get("legato"), 0.8) : 1);
  else {
    let dur: Value = ev.get("dur") ?? 1;
    if (Array.isArray(dur)) dur = dur[0] ?? 1;
    const legato = numOf(ev.get("legato"), 0.8);
    const stretch = numOf(ev.get("stretch"), 1);
    sustain = numOf(dur, 1) * legato * stretch * scale;
  }
  return { t, src, line, delta, sustain, instrument, ev };
}

function isRest(ev: SCEvent): boolean {
  if (ev.get("__rest")) return true;
  if (ev.get("dur") instanceof RestV || ev.get("delta") instanceof RestV) return true;
  const type = ev.get("type");
  if (type instanceof Sym && type.name === "rest") return true;
  for (const key of ["freq", "midinote", "note", "degree", "instrument", "s", "dur", "amp"]) {
    const v = ev.get(key);
    if (v instanceof RestV) return true;
    if (v instanceof Sym && ["freq", "midinote", "note", "degree"].includes(key)) return true;
    if (v instanceof Sym && (v.name === "" || v.name === "rest" || v.name === "r")) return true;
  }
  return false;
}

// ---------------------------------------------------------------- one part

interface WrittenPart {
  label: string;
  comment: string[];
  body: string;
  /** The part's loop, in beats. */
  period: number;
  /** Where the written loop starts, in beats (with random durations: where the first step starts). */
  start: number;
  /**
   * Random durations: the body plays one step per beat (its values in order, a rest a silent step), and rhythm()
   * plays them one after another, step k as long as `durs[k % durs.length]` (a random duration or a number, in
   * beats, before it is put in cycles). `steps`: steps in the body's loop.
   */
  rhythm?: { durs: (RandToken | number)[]; steps: number };
}

/**
 * The step lengths for rhythm(), in cycles (k cycles a beat): one random duration as a signal; a loop of them
 * as cat(), where a random duration is one value per step (segment(1)) and a number is written as text.
 */
function durationsCode(durs: (RandToken | number)[], k: number): string {
  const cell = (d: RandToken | number, alone: boolean) => {
    if (typeof d === "number") return alone ? fmt(d * k) : str(fmt(d * k));
    const code = tokenCode(d.map((x) => x * k, "x * " + fmt(k), [k, 0]), false, 0);
    return alone ? code : code + ".segment(1)";
  };
  return durs.length === 1 ? cell(durs[0], true) : "cat(" + durs.map((d) => cell(d, false)).join(", ") + ")";
}

type Cell = Value | RandToken | SigCell;

/** Where a value is written: the part's loop (in beats) and the tempo, for signals. */
interface WriteCtx {
  period: number;
  tempo: number;
}

/** A step of a part: an event (with its controls) or a gap. */
interface Step {
  t: number;
  width: number;
  event: SimEvent | null;
}

/**
 * Writes one part. `forced` gives its loop and where the loop starts (each voice of a part that starts several
 * synths at once is written over the loop of the whole part).
 */
function writePart(part: Part, ctx: Context, forced?: { period: number; start: number; loops: boolean }): WrittenPart | null {
  const { synthFor, note, tempo } = ctx;
  let evs = part.events;
  if (evs.length === 0) return null;
  if (part.drone) {
    // One long note per loop, as long as the loop; LFOs line up again where it restarts.
    const length = droneBeats(synthFor(part.instrument), tempo);
    evs = [{ ...evs[0], t: 0, delta: length, sustain: length }];
    part = { ...part, events: evs, start: 0, end: length };
  }
  // Each event's index (steps refer to their events).
  const index = new Map(evs.map((e, i) => [e, i]));
  const varying = part.instrument === "";
  const instruments = [...new Set(evs.map((e) => e.instrument))];
  const infos = new Map(instruments.map((i) => [i, synthFor(i)]));
  const soundOf = (instrument: string) => {
    const info = infos.get(instrument);
    if (info) return info.sound;
    if (TIDAL_SOUNDS.has(instrument)) return instrument;
    if (instrument === "default") return "saw";
    return soundByName(instrument) ?? instrument;
  };
  const mainInfo = varying ? null : infos.get(part.instrument) ?? null;
  const midi = part.instrument === "__midi";
  const osc = part.instrument.startsWith("__osc");
  // Each event's sound: the synth, or for a sample player the bank of the buffer it plays.
  const tokens = evs.map((e) => soundToken(e, infos.get(e.instrument) ?? null, ctx, soundOf));
  const soundsVary = new Set(tokens).size > 1;
  const comment: string[] = [];
  const label = varying ? "part" : midi ? "midi" : osc ? "osc" : part.instrument === "__buffer" ? "buffer" : /^anonymous/.test(part.instrument) ? "synth" : part.instrument;
  if (midi) {
    comment.push("MIDI notes (line " + part.line + "): sent to a Web MIDI output.");
    note("MIDI goes to the browser's Web MIDI outputs (the browser asks for permission); .midi() picks the output by number or name.");
  } else if (osc) {
    comment.push("OSC messages to " + part.instrument.slice(5) + " (line " + part.line + "): sent through TidalJS's OSC bridge.");
    note("OSC goes over a WebSocket to a WebSocket-to-UDP bridge (setOscUrl() sets its address): browsers cannot send UDP themselves.");
  } else if (part.instrument === "__buffer") {
    comment.push("A buffer played at line " + part.line + ": its file as a sample.");
  } else if (!varying) {
    const inst = part.instrument;
    if (mainInfo && /^anonymous/.test(inst)) comment.push("The function played at line " + part.line + ": " + mainInfo.summary + ".");
    else if (mainInfo) comment.push("\\" + inst + " (played at line " + part.line + "): " + mainInfo.summary + ".");
    else if (inst === "default") {
      comment.push("SuperCollider's \\default synth (played at line " + part.line + "): a saw with a low-pass filter here.");
    } else if (TIDAL_SOUNDS.has(inst)) comment.push("\\" + inst + " (played at line " + part.line + ").");
    else if (soundByName(inst)) {
      comment.push("\\" + inst + " (played at line " + part.line + "): no SynthDef for it in the file, so the TidalJS synth " + soundByName(inst) + " plays it.");
    } else {
      comment.push("\\" + inst + " (played at line " + part.line + "): no SynthDef for it in the file; it plays the sample bank or synth of that name.");
      note("\\" + inst + " has no SynthDef in the file: load a sample bank of that name with samples(), or change the sound.");
    }
    for (const n of mainInfo?.notes ?? []) note(n);
  } else {
    comment.push("Line " + part.line + ": several instruments (" + instruments.map((i) => "\\" + i).join(", ") + ").");
  }

  // The controls of every event, as TidalJS sees them.
  const rows = evs.map((e) => controlsOf(e, infos.get(e.instrument) ?? null, ctx));
  const keys: string[] = [];
  for (const row of rows) for (const k of row.keys()) if (!keys.includes(k)) keys.push(k);
  // A synth that changes while it plays (synth.set): its notes are tied; without that, no tie.
  if (keys.includes("tie") && !evs.some((e) => e.ev.get("__tied"))) {
    keys.splice(keys.indexOf("tie"), 1);
    for (const row of rows) row.delete("tie");
  }
  const oscHead = osc ? keys[0] ?? null : null;
  // A control some events leave out has its default there (legato 1, or the SynthDef's value), not the last value.
  for (const key of keys) {
    const fixed = [...(mainInfo?.fixed ?? []), ...(mainInfo?.channels?.[0] ?? [])].find((f) => f.control === key);
    const fallback: Value | undefined = key === "legato" ? 1 : fixed && typeof fixed.value === "number" ? fixed.value : undefined;
    if (fallback === undefined) continue;
    for (const row of rows) if (!row.has(key)) row.set(key, fallback);
  }

  // Rhythm: the times, own deltas and (when they vary) the sounds. Each event's signature is worked out once.
  const cellKey = (c: Cell | undefined) => (c instanceof RandToken || c instanceof SigCell ? c.key() : JSON.stringify(c ?? null, jsonValue));
  const rhythmKeys = evs.map((e, i) => fmtKey(e.delta) + "|" + (varying || soundsVary ? tokens[i] : ""));
  const cellKeys = new Map(keys.map((k) => [k, rows.map((row) => cellKey(row.get(k)))]));
  // Loops are looked for as far as the part was played; one that stops, up to its end.
  const finite = part.end !== null;
  const horizon = part.end ?? part.horizon;
  // How long a part that stops plays, from its start.
  const life = finite ? Math.max(1e-9, (part.end as number) - part.start) : 0;
  if (evs[0].t < -1e-9) {
    note("A timingOffset moves events of line " + part.line + " before the start: SuperCollider plays those late, at once; here the first ones are left out (the later ones play early, as in SuperCollider).");
  }
  let period: number;
  let start: number;
  // Whether the material repeats over the loop (not when the first beats of material that never repeats loop).
  let loops = true;
  if (forced) {
    ({ period, start, loops } = forced);
  } else {
    let found = findPeriod(evs, rhythmKeys, horizon);
    if (found === null && !finite && evs.some((e) => e.ev.get("__randtime"))) {
      const random = randomRhythm(part, ctx, label, comment);
      if (random) return random;
    }
    // A part that stops and never repeats within its life: all of it, once.
    let whole = false;
    if (found === null) {
      if (finite) whole = true;
      else if (part.cap === "events") {
        note("The rhythm of line " + part.line + " does not repeat within its first " + MAX_EVENTS + " events (" + fmt(horizon) + " beats): its first " + fmt(FALLBACK) + " beats loop.");
      } else note("The rhythm of line " + part.line + " never repeats: its first " + fmt(FALLBACK) + " beats loop.");
    }
    period = found ?? (finite ? life : FALLBACK);
    loops = found !== null || finite;
    if (finite && !whole && Math.abs(life % period) > 1e-6 && life < period * 2) { period = life; whole = true; }
    // When the whole part (rhythm and controls) repeats soon, write all of it in one loop.
    if (!whole) {
      const fullKeys = rhythmKeys.map((k, i) => k + "|" + keys.map((key) => (cellKeys.get(key) as string[])[i]).join("|"));
      found = findPeriod(evs, fullKeys, horizon, 16);
      if (found !== null && found <= 16 + 1e-9 && found >= period - 1e-9) period = found;
    }
    // The loop starts where the part's loops fall (a multiple of the period), or for a part written whole, at its start.
    start = whole ? part.start : Math.floor(evs[0].t / period + 1e-9) * period;
    // The loop from `start` must hold every event of a loop. When the part begins after `start`, the events of
    // the loop before its first one are those one period later: if there are any, the loop starts at the first
    // event instead (and is shifted there when it is written).
    const first = evs[0].t;
    if (!whole && first > start + 1e-9 && evs.some((e) => e.t >= start + period - 1e-9 && e.t < first + period - 1e-9)) start = first;
  }

  // Synths started at the same instant: each is a voice of its own, with its own controls and length, over the
  // loop of the whole part.
  if (!forced && evs.some((e, i) => i > 0 && Math.abs(e.t - evs[i - 1].t) < 1e-9)) {
    return writeVoices(part, evs, ctx, period, start, loops);
  }

  const steps = stepsOf(evs, start, period);
  const weights = toWeights(steps.map((s) => s.width), note);
  // Each note keeps its own length (its sustain), whatever the width of its step: a step that a timingOffset, an
  // early next onset or the end of the loop makes shorter than the event's delta holds a longer legato. (Material
  // that never repeats is cut off at the end of the loop it is written in: there the next onset counts only.)
  const widths = stepWidths(evs, start, loops ? period : Infinity);
  let refit = false;
  evs.forEach((e, i) => {
    if (!(e.delta > 1e-9) || Math.abs(widths[i] - e.delta) < 1e-9 || !holdsLength(e, infos.get(e.instrument) ?? null)) return;
    const legato = round(e.sustain / widths[i]);
    if (Math.abs(legato - numOf(rows[i].get("legato") as Value, 1)) < 1e-9) return;
    rows[i].set("legato", legato);
    refit = true;
  });
  if (refit) {
    if (!keys.includes("legato")) keys.push("legato");
    for (const row of rows) if (!row.has("legato")) row.set("legato", 1);
    cellKeys.set("legato", rows.map((row) => cellKey(row.get("legato"))));
  }

  // Structure.
  const lines: string[] = [];
  const allX = steps.every((s) => s.event);
  const equal = weights.every((w) => w === weights[0]);
  if (midi || osc) {
    // MIDI and OSC events play no sound of TidalJS's: the first control starts the pattern.
    const first = rows[0];
    const chan = evs[0].ev.get("chan");
    if (midi) lines.push("midichan(" + fmt(numOf(chan, 0)) + ")");
    else lines.push(oscHead ? oscHead + "(" + valueCode(first.get(oscHead) as Cell, oscHead === "note", () => 0, { period: 1, tempo }) + ")" : "orbit(0)");
    const n = steps.length;
    if (!(allX && equal && n === 1)) lines.push(".struct(" + str(allX && equal ? "x*" + n : seq(steps.map((s) => (s.event ? "x" : "~")), weights)) + ")");
  } else if (varying || soundsVary) {
    const names = steps.map((s) => (s.event ? miniName(tokens[index.get(s.event) as number]) : "~"));
    lines.push("sound(" + str(seq(names, weights)) + ")");
  } else {
    lines.push("sound(" + str(tokens[0]) + ")");
    const n = steps.length;
    if (!(allX && equal && n === 1)) {
      lines.push(".struct(" + str(allX && equal ? "x*" + n : seq(steps.map((s) => (s.event ? "x" : "~")), weights)) + ")");
    }
  }

  if (midi || osc) {
    const headKey = midi ? "midichan" : keys[0];
    if (headKey && rows.every((row) => cellKey(row.get(headKey)) === cellKey(rows[0].get(headKey)))) {
      const at = keys.indexOf(headKey);
      if (at >= 0) keys.splice(at, 1);
    }
  }

  // Controls: each over its own period (a multiple of the rhythm's).
  const order = ["note", "freq", "n", "legato"];
  keys.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  let tokenIndex = 0;
  const cellsOf = (key: string, k: number) => {
    const ks = k === 0 ? steps : stepsOf(evs, start + k * period, period);
    return ks.map((s) => (s.event ? rows[index.get(s.event) as number].get(key) ?? GAP : GAP));
  };
  const extra: string[] = [];
  if (evs.some((e) => e.ev.get("__mono"))) extra.push(".tie(" + ++ctx.ties + ")");
  for (const key of keys) {
    const valueAt = (i: number) => rows[i].get(key);
    // A bus or proxy an LFO moves: followed during each note.
    const all = evs.map((_, i) => valueAt(i));
    if (all[0] instanceof SigCell && all.every((c) => c instanceof SigCell && c.key() === (all[0] as SigCell).key())) {
      if (FOLLOWABLE.has(key)) {
        lines.push(".follow(" + str(key) + ", " + (all[0] as SigCell).followCode() + ")");
        continue;
      }
      note("The " + key + " of line " + part.line + " follows a control bus that TidalJS reads at the start of each note.");
    } else if (all.some((c) => c instanceof SigCell)) {
      note("The " + key + " of line " + part.line + " follows a control bus in some notes only: it is read at the start of each note.");
    }
    // A live input (a GUI control, MIDI, OSC) that sets a running synth: it changes the sounding note too.
    const t0 = all[0];
    if (t0 instanceof RandToken && LIVE_KINDS.has(t0.kind) && FOLLOWABLE.has(key) && all.every((c) => c instanceof RandToken && c.key() === t0.key())) {
      lines.push(".follow(" + str(key) + ", " + tokenCode(t0, key === "note", 0) + ")");
      continue;
    }
    const valueKeys = cellKeys.get(key) as string[];
    // One value throughout repeats however the rhythm goes.
    let m = evs.length === 1 || (finite && period >= life - 1e-9) || valueKeys.every((k) => k === valueKeys[0]) ? 1 : controlPeriod(evs, period, horizon, valueKeys);
    // A part that stops: a value that does not repeat within its life is written for all of it.
    if (m === null && finite) m = Math.max(1, Math.ceil(((part.end as number) - start) / period - 1e-9));
    if (m === null) {
      // A value that never repeats: a series that grows by the same step each loop, or a list shuffled each loop.
      const loops = Math.min(64, Math.floor((horizon - start) / period + 1e-9));
      const byLoop = Array.from({ length: loops }, (_, k) => cellsOf(key, k));
      const grows = growth(byLoop, key === "note");
      if (grows) {
        const w = writeControl(key, byLoop[0], weights, 1, () => tokenIndex++, { period, tempo });
        if (w !== null) lines.push("." + key + "(" + w + ")");
        // In the loop's own time each loop is one cycle: floor(t) counts the loops.
        extra.push(grows.op === "add"
          ? ".add(" + key + "(sig((t) => Math.floor(t)" + (grows.d === 1 ? "" : " * " + fmt(grows.d)) + ")))"
          : ".mul(" + key + "(sig((t) => " + fmt(grows.d) + " ** Math.floor(t))))");
        continue;
      }
      // A list shuffled again each time (Pn(Pshuf(list))): it may span several loops of the rhythm.
      let shuffledOver = 0;
      if (allX && equal) {
        for (let m = 1; m <= 16 && !shuffledOver; m++) {
          const groups: Cell[][] = [];
          for (let k = 0; k + m <= byLoop.length; k += m) groups.push(byLoop.slice(k, k + m).flat());
          if (isShuffle(groups)) {
            shuffledOver = m;
            const list = groups[0];
            lines.push("." + key + "(fastcat(" + str(list.map((c) => miniValue(c, key === "note")).join(" ")) + ").shuffle(" + list.length + ")" + (m > 1 ? ".slow(" + m + ")" : "") + ")");
          }
        }
      }
      if (shuffledOver) continue;
      note("The " + key + " of line " + part.line + " never repeats: its first " + fmt(FALLBACK) + " beats loop.");
    }
    const mult = m ?? Math.max(1, Math.floor(FALLBACK / period));
    const cells: Cell[] = [];
    const cellWeights: number[] = [];
    for (let k = 0; k < mult; k++) {
      // The rhythm repeats, so each period has the same steps.
      const ks = k === 0 ? steps : stepsOf(evs, start + k * period, period);
      ks.forEach((s, j) => {
        cells.push(s.event ? rows[index.get(s.event) as number].get(key) ?? GAP : GAP);
        cellWeights.push(weights[j] ?? 1);
      });
    }
    const written = writeControl(key, cells, cellWeights, mult, () => tokenIndex++, { period, tempo });
    if (written !== null) lines.push("." + key + "(" + written + ")");
  }
  lines.push(...extra);

  // A drone holds for the whole loop (TidalJS's synths fade out on their own without a length).
  if (part.drone && !keys.includes("legato")) lines.push(".legato(1)");
  // Where the note restarts, the old one fades out as the new one fades in (Function.play fades in over 0.02 s too).
  const fixedControls = new Set([...(mainInfo?.fixed ?? []), ...(mainInfo?.channels?.flat() ?? [])].map((f) => f.control));
  if (part.drone && !fixedControls.has("attack")) lines.push(".attack(0.02)");
  if (part.drone && !fixedControls.has("release")) lines.push(".release(0.02)");

  // The SynthDef's effects; with two different channels, what they share, then each one.
  let channelFns: string[] | null = null;
  if (mainInfo) {
    const fromEvents = new Set(keys);
    const byFreq = keys.includes("freq");
    const keep = (list: Fixed[]) => {
      const done = new Set<string>();
      return list.filter((f) => {
        if (fromEvents.has(f.control) || done.has(f.control)) return false;
        if (f.arg && evs.some((e) => e.ev.has(f.arg as string))) return false;
        done.add(f.control);
        return true;
      });
    };
    const same = (a: Fixed, b: Fixed) => a.control === b.control && JSON.stringify(a.value) === JSON.stringify(b.value);
    if (mainInfo.channels) {
      const [l, r] = mainInfo.channels.map(keep);
      const shared = l.filter((f) => r.some((g) => same(f, g)));
      for (const f of shared) lines.push(fixedCode(f, byFreq));
      channelFns = [[l, "-1"], [r, "1"]].map(([list, pan]) => "x => x" + (list as Fixed[]).filter((f) => !shared.some((g) => same(f, g)))
        .map((f) => fixedCode(f, byFreq)).join("") + ".pan(" + pan + ")");
    } else {
      for (const f of keep(mainInfo.fixed)) lines.push(fixedCode(f, byFreq));
    }
  } else if (!varying && part.instrument === "default") {
    if (!keys.includes("lpf")) lines.push(".lpf(4000)");
    // SuperCollider's default synth: three VarSaws at 0.3 times amp (0.1 by default).
    if (!keys.includes("amp")) lines.push(".amp(0.12)");
  }
  // Effects the part goes through: Pfx, JITLib filters, effect synths on the bus it plays into, sends.
  const { controls: effects, names: fxNames } = effectsFor(evs[0], mainInfo, ctx, part.line);
  if (fxNames.length) comment.push("It goes through " + fxNames.map((n) => "\\" + n).join(", then ") + (effects.length ? ": " + unique(effects.map((f) => f.control)).join(", ") + "." : ", which TidalJS has no effect for."));
  if (effects.length) {
    const present = new Set([...keys, ...lines.map((l) => /^\.(\w+)\(/.exec(l)?.[1] ?? "")]);
    for (const f of effects) {
      if (present.has(f.control)) {
        note("Line " + part.line + " already has " + f.control + ": the " + f.control + " of its effect is left out (TidalJS has one per sound).");
        continue;
      }
      present.add(f.control);
      lines.push(fixedCode(f));
    }
  }
  if (midi) {
    const out = evs[0].ev.get("midiout");
    lines.push(".midi(" + (out instanceof MidiOutV ? (typeof out.selector === "number" ? fmt(out.selector) : str(out.selector)) : "0") + ")");
  }
  if (osc) lines.push(".osc(" + str(part.instrument.slice(5)) + ")");

  // Group the controls: up to four per line.
  const body = [lines[0]];
  let cur = "";
  for (const l of lines.slice(1)) {
    if (l.length > 60 || cur.length + l.length > 70) {
      if (cur) body.push(cur);
      if (l.length > 60) { body.push(l); cur = ""; continue; }
      cur = l;
    } else cur += l;
  }
  if (cur) body.push(cur);
  if (channelFns) {
    // layer applies each function to the pattern: the left channel and the right one.
    return { label, comment, body: "layer([\n  " + channelFns.join(",\n  ") + "\n], " + body.join("\n  ") + ")", period, start };
  }
  return { label, comment, body: body.join("\n  "), period, start };
}

/**
 * A part that starts several synths at the same instant (a routine's Synth calls with no wait between them,
 * events of no length): each is a voice of its own, the first started at each instant in the first voice, the
 * second in the second, and so on, each with its own controls and length, all over the loop of the whole part.
 */
function writeVoices(part: Part, evs: SimEvent[], ctx: Context, period: number, start: number, loops: boolean): WrittenPart | null {
  const voices: SimEvent[][] = [];
  let at = -Infinity;
  let k = 0;
  for (const e of evs) {
    if (Math.abs(e.t - at) < 1e-9) k++;
    else { at = e.t; k = 0; }
    if (!voices[k]) voices[k] = [];
    voices[k].push(e);
  }
  if (voices.length > MAX_VOICES) {
    ctx.note("Line " + part.line + " starts " + voices.length + " synths at the same instant: the first " + MAX_VOICES + " of them are written.");
    voices.length = MAX_VOICES;
  }
  const written = voices.map((list) => writePart({ ...part, events: list, rests: [] }, ctx, { period, start, loops })).filter((w): w is WrittenPart => w !== null);
  if (written.length === 0) return null;
  if (written.length === 1) return written[0];
  const comment = [...written[0].comment, written.length + " synths start at the same time: each is a voice of its own, with its own values and length."];
  return { label: written[0].label, comment, body: "stack([\n  " + written.map((w) => w.body.split("\n").join("\n  ")).join(",\n  ") + "\n])", period, start };
}

/** A drone's loop, in beats: 4 or more, so that its LFOs (vib) complete whole cycles. */
function droneBeats(info: SynthInfo | null, tempo: number): number {
  const lists = info?.channels ?? [info?.fixed ?? []];
  const rates = [
    ...lists.flat().filter((f) => f.control === "vib" && typeof f.value === "number").map((f) => f.value as number),
    ...lists.flat().filter((f) => f.lfo).map((f) => (f.lfo as LfoSignal).rate),
  ];
  for (let beats = 4; beats <= 64; beats += 4) {
    const seconds = beats / tempo;
    if (rates.every((r) => Math.abs(r * seconds - Math.round(r * seconds)) < 1e-6)) return beats;
  }
  return 4;
}

const GAP = Symbol("gap") as unknown as Value;

/** The TidalJS controls of one event. */
function controlsOf(e: SimEvent, info: SynthInfo | null, ctx: Context): Map<string, Cell> {
  const note = ctx.note;
  const ev = e.ev;
  const out = new Map<string, Cell>();
  const dirt = ev.get("type") instanceof Sym && (ev.get("type") as Sym).name === "dirt";
  const midi = e.instrument === "__midi";
  const osc = e.instrument.startsWith("__osc");
  if (midi) return midiControls(e, note);
  if (osc) {
    for (const [key, value] of ev.map) {
      if (key.startsWith("__") || EVENT_KEYS.has(key)) continue;
      if (CONTROLS.has(key)) out.set(key, value);
      else note("The OSC value " + key + " is not a TidalJS control, so it cannot be sent: it is left out.");
    }
    return out;
  }
  const sampleArg = info?.sample?.buf instanceof GNode ? info.sample.buf.name : null;

  // Pitch.
  const pitch = pitchOf(ev, note);
  if (pitch) out.set(pitch.control, pitch.value);
  // A synth that changes while it plays continues its voice (writePart keeps this only where notes are tied).
  const tie = ev.get("__tie");
  if (typeof tie === "number") out.set("tie", tie);

  // Length.
  const percussive = (info?.fixed.some((f) => f.control === "hold") ?? false) || (info?.sample !== null && info?.sample !== undefined && !info.fixed.some((f) => f.control === "release"));
  if (!percussive && !info?.port && !dirt) {
    const legato = e.delta > 0 ? e.sustain / e.delta : 1;
    if (Math.abs(legato - 1) > 1e-6) out.set("legato", round(legato));
  } else if (info?.port) {
    const legato = e.delta > 0 ? e.sustain / e.delta : 1;
    if (Math.abs(legato - 1) > 1e-6) out.set("legato", round(legato));
  }
  if (dirt && ev.has("legato")) out.set("legato", ev.get("legato") ?? 1);

  // Volume.
  let amp: Cell | undefined = ev.get("amp");
  const db = ev.get("db");
  if (amp === undefined && typeof db === "number") amp = Math.pow(10, db / 20);
  if (amp === undefined && db instanceof RandToken) amp = db.map((x) => Math.pow(10, x / 20), "10 ** (x / 20)");
  if (amp !== undefined && amp !== null) {
    const factor = dirt ? 1 : info ? info.ampScale : TIDAL_SOUNDS.has(e.instrument) ? 1 : e.instrument === "default" ? 1.2 : 4;
    out.set("amp", scaleCell(amp, factor));
  }
  const pan = ev.get("pan");
  if (pan !== undefined && pan !== null) out.set("pan", dirt ? scaleCell(scaleCell(pan, 2), 1, -1) : pan);
  const lag = ev.get("lag");
  if (typeof lag === "number" && lag !== 0) out.set("nudge", lag);
  if (ev.has("strum")) note("strum is not converted.");
  if (ev.has("detune") && numOf(ev.get("detune"), 0) !== 0) note("detune (in Hz) is not converted.");

  // The other keys: the SynthDef's arguments, or TidalJS controls of the same name.
  for (const [key, value] of ev.map) {
    if (key.startsWith("__") || EVENT_KEYS.has(key)) {
      if (dirt && key === "orbit") out.set("orbit", value);
      continue;
    }
    if (value === null || value instanceof SCEvent || key === sampleArg) continue;
    if (value instanceof BufferV || value instanceof MidiOutV || value instanceof NetAddrV) continue;
    // A control bus or a JITLib proxy mapped to an argument: its value, or the LFO that writes it.
    let v: Cell = value;
    if (value instanceof BusV || value instanceof ProxyV || (value instanceof Sym && /^c[0-9]+$/.test(value.name))) {
      const mapped = mappedValue(value, ctx);
      if (mapped === null) {
        if (!(value instanceof BusV && value.rate === "audio")) note("The bus mapped to \\" + key + " has no value TidalJS can follow: it is left out.");
        continue;
      }
      v = mapped;
    }
    const roles = info?.roles.get(key);
    if (roles && roles.length) {
      for (const role of roles) {
        if (role.control === "amp") continue;
        out.set(role.control, applyRole(v, role.fn, role.js));
      }
      continue;
    }
    if (CONTROLS.has(key)) {
      out.set(key, v);
      continue;
    }
    note("The key \\" + key + " is not a TidalJS control" + (info ? " and \\" + e.instrument + " does not use it in a way TidalJS knows" : "") + ": it is left out.");
  }
  return out;
}

function applyRole(value: Cell, fn: (x: number) => number, js: (x: string) => string): Cell {
  if (value instanceof SigCell) return value.map(fn);
  if (typeof value === "number") return round(fn(value));
  if (value instanceof RandToken) return value.map(fn, js("x"));
  if (Array.isArray(value)) return value.map((v) => (typeof v === "number" ? round(fn(v)) : v));
  return value;
}

function scaleCell(v: Cell, factor: number, offset = 0): Cell {
  if (v instanceof SigCell) return v.map((x) => x * factor + offset);
  if (typeof v === "number") return round(v * factor + offset);
  if (v instanceof RandToken) return factor === 1 && offset === 0 ? v : v.map((x) => x * factor + offset, `x * ${fmt(factor)}${offset ? " + " + fmt(offset) : ""}`, [factor, offset]);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "number" ? round(x * factor + offset) : x));
  return v;
}

/** The pitch of an event, as TidalJS's note (MIDI) or freq, following SuperCollider's Event. */
function pitchOf(ev: SCEvent, note: (s: string) => void): { control: string; value: Cell } | null {
  const freq = ev.get("freq");
  if (freq !== undefined && freq !== null) return { control: "freq", value: freq };
  const keys = ["midinote", "note", "degree", "scale", "octave", "root", "mtranspose", "gtranspose", "ctranspose"];
  if (!keys.some((k) => ev.has(k))) return null;
  const midinote = ev.get("midinote");
  if (midinote !== undefined && midinote !== null) return { control: "note", value: midinote };
  const octave = numOf(ev.get("octave"), 5);
  const root = numOf(ev.get("root"), 0);
  const ctr = numOf(ev.get("ctranspose"), 0);
  const gtr = numOf(ev.get("gtranspose"), 0);
  const mtr = numOf(ev.get("mtranspose"), 0);
  const scaleV = ev.get("scale") ?? new ScaleV("major", SCALES.major);
  const spo = numOf(ev.get("stepsPerOctave"), scaleV instanceof ScaleV ? scaleV.stepsPerOctave : 12);
  const fromNote = (n: number) => ((n + gtr + root) / spo + octave) * 12 + ctr;
  const nt = ev.get("note");
  const compute = (v: Value | RandToken, f: (x: number) => number, js: string): Cell => {
    if (typeof v === "number") return round(f(v));
    if (Array.isArray(v)) return v.map((x) => compute(x, f, js) as Value);
    if (v instanceof RandToken) return v.map(f, js);
    if (v instanceof Sym) return null;
    return null;
  };
  if (nt !== undefined && nt !== null) {
    return { control: "note", value: compute(nt, fromNote, `((x + ${fmt(gtr + root)}) / ${fmt(spo)} + ${fmt(octave)}) * 12 + ${fmt(ctr)}`) };
  }
  const degree = ev.get("degree") ?? 0;
  const degrees = scaleV instanceof ScaleV ? scaleV.degrees : Array.isArray(scaleV) ? scaleV.map((v) => numOf(v, 0)) : SCALES.major;
  const toMidi = (d: number) => fromNote(degreeToKey(d + mtr, degrees, spo));
  const js = `((${JSON.stringify(degrees)}[(((Math.round(x + ${fmt(mtr)})) % ${degrees.length}) + ${degrees.length}) % ${degrees.length}] + ${spo} * Math.floor(Math.round(x + ${fmt(mtr)}) / ${degrees.length}) + ${fmt(gtr + root)}) / ${fmt(spo)} + ${fmt(octave)}) * 12 + ${fmt(ctr)}`;
  if (spo !== 12) note("A scale with " + spo + " steps per octave is converted to MIDI notes (microtones are kept as decimals).");
  return { control: "note", value: compute(degree, toMidi, js) };
}

// ---------------------------------------------------------------- periods

/** A time as a whole number of millionths of a beat, to find events at a time. */
function timeKey(t: number): number {
  return Math.round(t * 1e6);
}

/**
 * The shortest period (in beats, up to `longest`) after which the events repeat with the same signatures
 * (`keys[i]` is event i's), checked up to the horizon (as far as the part was played).
 */
function findPeriod(evs: SimEvent[], keys: string[], horizon: number, longest = Infinity): number | null {
  if (evs.length === 0) return null;
  const at = new Map<number, number[]>();
  evs.forEach((e, i) => {
    const k = timeKey(e.t);
    const list = at.get(k);
    if (list) list.push(i);
    else at.set(k, [i]);
  });
  const has = (t: number, key: string) => at.get(timeKey(t))?.some((x) => keys[x] === key) ?? false;
  const k0 = keys[0];
  const t0 = evs[0].t;
  const tried = new Set<number>();
  for (let j = 1; j < evs.length; j++) {
    const p = evs[j].t - t0;
    if (p <= 1e-9 || keys[j] !== k0) continue;
    // The events are in order, so the candidates only grow from here.
    if (p > horizon / 2 + 1e-9 || p > longest + 1e-9) break;
    const pk = timeKey(p);
    if (tried.has(pk)) continue;
    tried.add(pk);
    let ok = true;
    for (let i = 0; i < evs.length && ok; i++) {
      tick();
      const t = evs[i].t + p;
      if (t > horizon - 1e-9) break;
      if (!has(t, keys[i])) ok = false;
    }
    // And nothing extra in the next period.
    for (let i = 0; i < evs.length && ok; i++) {
      tick();
      const t = evs[i].t - p;
      if (t < t0 - 1e-9) continue;
      if (!has(t, keys[i])) ok = false;
    }
    if (ok) return p;
  }
  return null;
}

/** The smallest multiple of the rhythm's period over which a control repeats (`keys[i]`: its value at event i). */
function controlPeriod(evs: SimEvent[], period: number, horizon: number, keys: string[]): number | null {
  const byTime = new Map(evs.map((e, i) => [timeKey(e.t), i]));
  for (let m = 1; m * period <= horizon / 2 + 1e-9; m++) {
    const p = m * period;
    let ok = true;
    for (let i = 0; i < evs.length && ok; i++) {
      tick();
      const t = evs[i].t + p;
      if (t > horizon - 1e-9) break;
      const j = byTime.get(timeKey(t));
      if (j === undefined || keys[j] !== keys[i]) ok = false;
    }
    if (ok) return m;
  }
  return null;
}

/** The steps of one loop from `start`: each event (a chord, or events at one time: the first) and the gaps. */
function stepsOf(evs: SimEvent[], start: number, period: number): Step[] {
  // The events are in order of time: the first in the window by bisection.
  let lo = 0, hi = evs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (evs[mid].t < start - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  const inWindow: SimEvent[] = [];
  for (let i = lo; i < evs.length && evs[i].t < start + period - 1e-9; i++) inWindow.push(evs[i]);
  tick(inWindow.length + 1);
  const steps: Step[] = [];
  let cursor = start;
  inWindow.forEach((e, i) => {
    if (i > 0 && Math.abs(e.t - inWindow[i - 1].t) < 1e-9) return; // a chord: one step
    if (e.t > cursor + 1e-9) steps.push({ t: cursor, width: e.t - cursor, event: null });
    let j = i + 1;
    while (j < inWindow.length && Math.abs(inWindow[j].t - e.t) < 1e-9) j++;
    const next = j < inWindow.length ? inWindow[j].t : start + period;
    const width = Math.max(1e-9, Math.min(e.delta > 0 ? e.delta : next - e.t, next - e.t));
    steps.push({ t: e.t, width, event: e });
    cursor = e.t + width;
  });
  if (cursor < start + period - 1e-9) steps.push({ t: cursor, width: start + period - cursor, event: null });
  return steps;
}

/**
 * The width of each event's step, as stepsOf gives it in the loop (from `start`, `period` long) that holds the
 * event: its delta, cut at the next onset or at the end of that loop (no end when `period` is Infinity).
 */
function stepWidths(evs: SimEvent[], start: number, period: number): number[] {
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (j <= i) j = i + 1;
    while (j < evs.length && Math.abs(evs[j].t - e.t) < 1e-9) j++;
    const loopEnd = Number.isFinite(period) ? start + period * (Math.floor((e.t - start) / period + 1e-9) + 1) : Infinity;
    const next = Math.min(j < evs.length ? evs[j].t : Infinity, loopEnd);
    out.push(Math.max(1e-9, Math.min(e.delta > 0 ? e.delta : next - e.t, next - e.t)));
  }
  return out;
}

/** Whether an event's length is written as a legato (its sustain over its step): not for percussive sounds. */
function holdsLength(e: SimEvent, info: SynthInfo | null): boolean {
  if (e.instrument.startsWith("__osc")) return false;
  if (e.instrument === "__midi") {
    const cmd = e.ev.get("midicmd");
    return !(cmd instanceof Sym) || cmd.name === "noteOn";
  }
  if (e.ev.get("type") instanceof Sym && (e.ev.get("type") as Sym).name === "dirt") return false;
  const percussive = (info?.fixed.some((f) => f.control === "hold") ?? false) || (info?.sample !== null && info?.sample !== undefined && !info.fixed.some((f) => f.control === "release"));
  return !percussive || !!info?.port;
}

/** Widths as whole numbers (the smallest that keep them exact). */
function toWeights(widths: number[], note: (s: string) => void): number[] {
  for (let d = 1; d <= 192; d++) {
    if (widths.every((w) => Math.abs(w * d - Math.round(w * d)) < 1e-6)) {
      const ints = widths.map((w) => Math.max(1, Math.round(w * d)));
      const g = ints.reduce((a, b) => gcd(a, b));
      return ints.map((x) => x / (g || 1));
    }
  }
  note("Some durations are not simple fractions of a beat: they are rounded to 1/96 beat.");
  // Each step ends at its time rounded, so the rounding does not add up over a long loop.
  let at = 0, done = 0;
  return widths.map((w) => {
    at += w;
    const step = Math.max(1, Math.round(at * 96) - done);
    done += step;
    return step;
  });
}

function chooseCycle(periods: number[]): number {
  if (periods.length === 0) return 4;
  const fits = (c: number) => periods.filter((p) => isWholeRatio(p, c)).length;
  const candidates = [4, ...[...new Set(periods.map((p) => round(p)))].sort((a, b) => a - b)];
  let best = candidates[0];
  let score = fits(best);
  for (const c of candidates.slice(1)) {
    const s = fits(c);
    if (s > score) { best = c; score = s; }
  }
  return best;
}

function isWholeRatio(a: number, b: number) {
  const r = a > b ? a / b : b / a;
  return Math.abs(r - Math.round(r)) < 1e-6;
}

// ---------------------------------------------------------------- writing values

function writeControl(key: string, cells: Cell[], weights: number[], mult: number, nextToken: () => number, wctx: WriteCtx): string | null {
  const real = cells.filter((c) => c !== GAP);
  if (real.length === 0) return null;
  if (real.every((c) => c === null)) return null;
  const isNote = key === "note";
  // One value throughout.
  const k0 = cellKey(real[0]);
  if (real.every((c) => cellKey(c) === k0)) {
    return valueCode(real[0], isNote, nextToken, wctx);
  }
  const hasToken = real.some((c) => c instanceof RandToken || c instanceof SigCell);
  // Gaps take the value before them, so runs can merge.
  const filled: Cell[] = [];
  let last: Cell = real[0];
  for (const c of cells) {
    if (c === GAP) filled.push(last);
    else { filled.push(c); last = c; }
  }
  if (!hasToken) {
    const items: string[] = [];
    const ws: number[] = [];
    filled.forEach((c, i) => {
      const text = miniValue(c, isNote);
      if (items.length && items[items.length - 1] === text) ws[ws.length - 1] += weights[i];
      else { items.push(text); ws.push(weights[i]); }
    });
    const g = ws.map((w) => Math.round(w * 1000)).reduce((a, b) => gcd(a, b));
    const ints = ws.map((w) => Math.round((w * 1000) / (g || 1)));
    const body = seq(items, ints);
    return str(mult > 1 ? "[" + body + "]/" + mult : body);
  }
  // Random values mixed with fixed ones: squeeze picks one of them per step.
  const choices: string[] = [];
  const index: string[] = [];
  const ws: number[] = [];
  filled.forEach((c, i) => {
    const code = c instanceof RandToken || c instanceof SigCell ? valueCode(c, isNote, nextToken, wctx) : str(miniValue(c, isNote));
    let k = choices.indexOf(code);
    if (k < 0 || c instanceof RandToken) { choices.push(code); k = choices.length - 1; }
    index.push(String(k));
    ws.push(weights[i]);
  });
  const g = ws.map((w) => Math.round(w * 1000)).reduce((a, b) => gcd(a, b));
  const ints = ws.map((w) => Math.round((w * 1000) / (g || 1)));
  const body = seq(index, ints);
  return "squeeze(" + str(mult > 1 ? "[" + body + "]/" + mult : body) + ", [" + choices.join(", ") + "])";
}

function cellKey(c: Cell): string {
  return c instanceof RandToken || c instanceof SigCell ? c.key() : JSON.stringify(c, jsonValue);
}

function jsonValue(_k: string, v: unknown) {
  if (v instanceof Sym) return "\\" + v.name;
  if (v instanceof RandToken || v instanceof SigCell) return v.key();
  if (v instanceof BusV || v instanceof BufferV) return "bus:" + v.constructor.name + (v instanceof BusV ? v.index : v.bufnum);
  return v;
}

/** A value as TidalJS code: a number, a string, or a random signal. */
function valueCode(c: Cell, isNote: boolean, nextToken: () => number, wctx: WriteCtx): string {
  if (c instanceof SigCell) return sigCode(c, wctx);
  if (c instanceof RandToken) return tokenCode(c, isNote, nextToken());
  if (typeof c === "number") return isNote ? str(noteName(c)) : fmt(c);
  if (Array.isArray(c)) return str(miniValue(c, isNote));
  if (c instanceof Sym || typeof c === "string") return str(describeText(c));
  if (typeof c === "boolean") return c ? "1" : "0";
  return literal(c as Value);
}

/** An LFO as a TidalJS signal, at its rate: LFO cycles per cycle of the part's own loop. */
function sigCode(c: SigCell, { period, tempo }: WriteCtx): string {
  if (!c.lfo) return c.followCode();
  // An LFO moved by another: a function of time, in seconds (the part's loop is period / tempo seconds).
  if (moves(c.lfo)) return movingSignalCode(c.lfo, "t * " + fmt(round(period / tempo)));
  const { shape, rate, lo, hi, exp } = c.lfo;
  const base = shape === "LFSaw" || shape === "Saw" ? "saw" : shape === "LFTri" ? "tri" : shape === "LFPulse" || shape === "Pulse" ? "square"
    : shape === "LFNoise0" ? "rand.segment(1)" : shape.startsWith("LFNoise") ? "perlin" : "sine";
  let code = base + (exp && lo > 0 && hi > 0 ? ".rangex(" : ".range(") + fmt(lo) + ", " + fmt(hi) + ")";
  const speed = (rate * period) / tempo;
  if (speed > 0 && Math.abs(speed - 1) > 1e-9) code += speed > 1 ? ".fast(" + fmt(speed) + ")" : ".slow(" + fmt(1 / speed) + ")";
  return code;
}

function tokenCode(t: RandToken, isNote: boolean, index: number): string {
  const a = t.args;
  let base: string;
  let all = isNote ? [...t.ops, { fn: (x: number) => x - 60, js: "x - 60", lin: [1, -60] as [number, number] }] : t.ops;
  let lo = a[0] as number;
  let hi = a[1] as number;
  // Linear operators on a uniform or exponential range fold into its bounds.
  if (t.kind === "white" || t.kind === "exp") {
    while (all.length && all[0].lin && (t.kind === "white" || all[0].lin[1] === 0)) {
      const [k, b] = all[0].lin;
      lo = lo * k + b;
      hi = hi * k + b;
      all = all.slice(1);
    }
  }
  // Operators that change nothing (an argument passed on as it is) are left out.
  all = all.filter((o) => o.js.trim() !== "x");
  let ops = all.map((o) => o.js);
  switch (t.kind) {
    case "white": base = "rand.range(" + fmt(lo) + ", " + fmt(hi) + ")"; break;
    case "exp": base = "rand.rangex(" + fmt(lo) + ", " + fmt(hi) + ")"; break;
    case "iwhite": {
      const lo = a[0] as number;
      base = "irand(" + fmt((a[1] as number) - lo + 1) + ")";
      if (lo !== 0) ops = ["x + " + fmt(lo), ...ops];
      break;
    }
    case "slider": base = "slider(" + str(String(a[0])) + ", " + fmt(a[1] as number) + ", " + fmt(a[2] as number) + ", " + fmt(a[3] as number) + (typeof a[4] === "number" && a[4] > 0 ? ", " + fmt(a[4]) : "") + ")"; break;
    case "toggle": base = "toggle(" + str(String(a[0])) + (a[1] === true ? ", true" : "") + ")"; break;
    // SuperCollider's controller and aftertouch values are 0 to 127; midicc and miditouch give 0 to 1.
    // Straight-line operators on them fold into the range.
    case "midicc": case "miditouch": case "keytouch": {
      const head = t.kind + "(" + (t.kind === "midicc" ? fmt(a[0] as number) + (typeof a[1] === "number" ? ", " + fmt(a[1]) : "") : typeof a[0] === "number" ? fmt(a[0]) : "") + ")";
      const lin = linearOf(all);
      if (lin) { base = head + ".range(" + fmt(round(lin[1])) + ", " + fmt(round(lin[0] * 127 + lin[1])) + ")"; ops = []; }
      else base = head + ".range(0, 127)";
      break;
    }
    // The pitch-bend wheel is 0 to 16383 in SuperCollider (8192 in the middle); midibend gives -1 to 1.
    case "midibend": {
      const head = "midibend(" + (typeof a[0] === "number" ? fmt(a[0]) : "") + ")";
      const lin = linearOf(all);
      if (lin) {
        const v0 = lin[1], v1 = lin[0] * 16383 + lin[1];
        const m = round((v1 - v0) / 2), c = round((v1 + v0) / 2);
        base = head + (m === 1 && c === 0 ? "" : ".withValue((x) => " + (m === 1 ? "x" : fmt(m) + " * x") + (c ? (c > 0 ? " + " + fmt(c) : " - " + fmt(-c)) : "") + ")");
        ops = [];
      } else base = head + ".withValue((x) => (x + 1) * 8191.5)";
      break;
    }
    case "oscin": base = "oscIn(" + str(String(a[0])) + (a[1] ? ", " + fmt(a[1] as number) : "") + ")"; break;
    case "midinote": case "midivel": return fmt(t.realize(() => 0) as number);
    case "choose": case "wchoose": {
      // Operators on a random choice apply to each item of the list.
      const items = (a[0] as Value[]).map((v) => (typeof v === "number" ? all.reduce((x, op) => op.fn(x), v) : v));
      if (items.every((v) => typeof v === "number") || all.length === 0) ops = [];
      if (t.kind === "choose") { base = "choose(" + listCode(items) + ")"; break; }
      const w = a[1] as number[];
      base = "wchoose([" + items.map((v, i) => "[" + listItem(v) + ", " + fmt(w[i] ?? 0) + "]").join(", ") + "])";
      break;
    }
  }
  // A different stretch of the random stream for each random control, as SuperCollider's are independent.
  const live = LIVE_KINDS.has(t.kind);
  if (index > 0 && !live) base += ".late(" + fmt(index * 0.25) + ")";
  // Several straight-line operators on a live input: one.
  const lin = live && ops.length >= 1 && ops.length === all.length ? linearOf(all) : null;
  if (lin) {
    const [k, c] = [round(lin[0]), round(lin[1])];
    ops = [(k === 1 ? "x" : fmt(k) + " * x") + (c ? (c > 0 ? " + " + fmt(c) : " - " + fmt(-c)) : "")];
  }
  if (ops.length) {
    let expr = "x";
    for (const op of ops) expr = op.replace(/\bx\b/g, expr === "x" ? "x" : "(" + expr + ")");
    base += ".withValue((x) => " + expr + ")";
  }
  return base;
}

/** Values the player changes live: the GUI's controls, MIDI and OSC input. */
const LIVE_KINDS = new Set(["slider", "toggle", "midicc", "miditouch", "keytouch", "midibend", "oscin"]);

/** Operators that are all straight lines (a * x + b), composed into one [a, b]; null otherwise. */
function linearOf(ops: RandToken["ops"]): [number, number] | null {
  let a = 1, b = 0;
  for (const op of ops) {
    if (!op.lin) return null;
    a = op.lin[0] * a;
    b = op.lin[0] * b + op.lin[1];
  }
  return [a, b];
}

function listCode(items: Value[]) {
  return "[" + items.map(listItem).join(", ") + "]";
}

function listItem(v: Value) {
  if (typeof v === "number") return fmt(v);
  return str(describeText(v));
}

/** A value inside a mini-notation string. */
function miniValue(c: Cell, isNote: boolean): string {
  if (c === null || c === GAP) return "~";
  if (Array.isArray(c)) return "[" + c.map((x) => miniValue(x, isNote)).join(",") + "]";
  if (typeof c === "number") return isNote ? noteName(c) : fmt(c);
  if (c instanceof Sym || typeof c === "string") return miniName(describeText(c));
  if (typeof c === "boolean") return c ? "1" : "0";
  return "~";
}

function miniName(name: string) {
  return /^[A-Za-z0-9_.:#-]+$/.test(name) ? name : name.replace(/[^A-Za-z0-9_.:#-]/g, "_");
}

/** A MIDI note as a TidalJS note name (c4 is 60); microtones as numbers from c4. */
function noteName(m: number): string {
  if (Math.abs(m - Math.round(m)) > 1e-6) return fmt(m - 60);
  const r = Math.round(m);
  return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

function literal(v: Value): string {
  if (typeof v === "number") return fmt(v);
  if (typeof v === "string") return str(v);
  if (Array.isArray(v)) return arrayLiteral(v);
  if (v instanceof Sym) return str(v.name);
  return "0";
}

function arrayLiteral(v: Value[]): string {
  // pitchenv takes three arrays as separate arguments.
  if (v.length === 3 && v.every(Array.isArray)) return v.map((a) => "[" + (a as Value[]).map(literal).join(", ") + "]").join(", ");
  return "[" + v.map(literal).join(", ") + "]";
}

/** Steps with weights, as mini-notation: "a@3 b ~@2". */
function seq(items: string[], weights: number[]): string {
  return items.map((it, i) => (weights[i] === 1 ? it : it + "@" + fmt(weights[i]))).join(" ");
}

/** A string literal: JSON's, with the line and paragraph separators escaped too. */
function str(s: string) {
  return JSON.stringify(s).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * A line comment. Line breaks (including U+2028 and U+2029, which end a JavaScript comment), other control
 * characters and invisible or direction-changing characters become spaces, so the text cannot end the comment
 * and become code, or hide what follows it.
 */
function commentLine(text: string): string {
  return "// " + text.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g, " ");
}

/**
 * The words a binding may not be called: JavaScript's reserved words (strict mode, in which the editor runs the
 * code), names the evaluator uses, and globals the code may use itself.
 */
const RESERVED = new Set((
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if "
  + "import in instanceof new null return super switch this throw true try typeof var void while with yield let static "
  + "implements interface package private protected public await async of arguments eval undefined NaN Infinity "
  + "globalThis window self document Math Number String Object Array JSON Symbol Date console Error Function Promise "
  + "Reflect Proxy Map Set WeakMap BigInt RegExp parseInt parseFloat isNaN isFinite"
).split(" "));

/**
 * The globals TidalJS defines (setupGlobalFunctions and _setupTidalLibrary in tidal.js): a binding with one of
 * these names would hide it from the code after it. The test suite checks that this list has every one.
 */
export const TIDAL_GLOBALS: ReadonlySet<string> = new Set((
  "TidalJS PatternBuilder tidal sound s stack layer cat slowcat fastcat randcat euclidFull samples struct silence sine cosine "
  + "saw isaw tri square rand irand perlin scale scaleList chord chordList arp fit setBus bus slider toggle midicc midibend "
  + "miditouch keytouch midikeys oscIn oscplay envelope controlLayout setCPS setcps setTempo stopAll hush choose wchoose "
  + "cycleChoose setOscUrl midiOutputs record stopRecording exportPattern n note freq midinote gain pan lpf hpf bpf "
  + "resonance delay reverb size orbit distortion crush vowel speed begin end loop legato sustain attack release nudge vel "
  + "ccn ccv pgm midichan delaytime delayfeedback lock shape coarse cut accelerate djf hpq bpq amp octave unit distort "
  + "tremolorate tremolodepth phaserrate phaserdepth ring ringf hold decay sustainlevel penv pattack pdecay pcurve peak "
  + "peakq peakgain vib vibmod portamento voice detune semitone rate lfo squiz waveloss krush kcutoff triode octer octersub "
  + "octersubsub fshift fshiftnote fshiftphase leslie lrate lsize freeze comb smear scram binshift hbrick lbrick dry "
  + "freeverb freeroom freedamp cps nrpn nrpnn nrpnv tie lpenv lpattack lpdecay lpsustain lprelease hpenv hpattack hpdecay "
  + "hpsustain hprelease bpenv bpattack bpdecay bpsustain bprelease peakenv peakattack peakdecay peaksustain peakrelease "
  + "cutoff ctf hcutoff bandf room sz velocity lpq hresonance bandq delayt delayfb dfb sus att rel tremr tremdp phasr "
  + "phasdp vibrato up glide run scan toScale markovPat lindenmayer fromList fastFromList listToPat fromMaybes timeCat "
  + "timecat wrandcat binaryN binary ascii necklace brand brandBy chooseBy wchooseBy select squeeze pickF selectF sew "
  + "stitch wedge spread fastspread sine2 cosine2 saw2 isaw2 tri2 square2 envL envLR envEq envEqR stepcat s_cat stepalt "
  + "stepzip ur inhabit swap weaveWith weave snowball sig perlinWith perlin2With perlin2 interlace seqP seqPLoop "
  + "fastAppend slowAppend spreadf toScaleBy fitSlices resetCycles setOutput first once asap only panic setbpm getcps "
  + "getnow setCycle d1 d2 d3 d4 d5 d6 d7 d8 d9 d10 d11 d12 d13 d14 d15 d16 p xfadeIn xfade jumpIn jump jumpMod jumpInNext "
  + "jumpModOffset histpan waitT clutchIn clutch anticipateIn anticipate interpolateIn interpolate wait mortal mute unmute "
  + "solo unsolo unmuteAll unsoloAll testAudio"
).split(" "));

/** Can the converted code declare a binding with this name? */
export function isSafeBinding(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name) && !name.startsWith("__") && !RESERVED.has(name) && !TIDAL_GLOBALS.has(name) && !TAKEN.has(name);
}

/** A binding for a part, from its label (an instrument's name): always a safe identifier, never one used before. */
function uniqueName(label: string, used: Set<string>) {
  let base = label.replace(/[^A-Za-z0-9_$]/g, "_").replace(/^([0-9])/, "_$1").replace(/^__+/, "_") || "part";
  base = base.charAt(0).toLowerCase() + base.slice(1);
  if (!isSafeBinding(base)) base += "Part";
  let name = base;
  for (let i = 2; used.has(name) || !isSafeBinding(name); i++) name = base + i;
  used.add(name);
  return name;
}

/**
 * The converted code, checked to parse as the editor runs it (a strict function body beside the evaluator's own
 * names): a mistake of the converter is a clear error, never code that breaks in the editor. Where the page
 * forbids compiling code (a Content Security Policy), the check is left out.
 */
function checked(code: string): string {
  let error: unknown = null;
  try {
    new Function("__out", "__at", "\"use strict\";\n" + code);
  } catch (err) {
    error = err;
  }
  if (error instanceof SyntaxError) {
    throw new Error("The importer wrote TidalJS code that does not parse (" + error.message + "): please report the SuperCollider file that caused it.");
  }
  return code;
}

/** a mod n, from 0 to n. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** A value as a bus index: a bus, a number, or an argument of the synth (the event's value, else its default). */
function busIndex(v: Value | undefined, args: SCEvent | null, info: SynthInfo | null): number | null {
  if (v === undefined || v === null) return 0;
  if (v instanceof BusV) return v.index;
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return busIndex(v[0] ?? null, args, info);
  if (v instanceof GNode && v.kind === "control") {
    const given = args?.get(v.name);
    if (given !== undefined) return busIndex(given, null, null);
    const d = info?.defaults.get(v.name) ?? v.inputs.default ?? 0;
    return busIndex(d, null, null);
  }
  return null;
}

/** An argument's value as a number (the event's value, else the default), for reading an LFO. */
function argNumber(v: Value, args: SCEvent | null, info: SynthInfo | null): number | null {
  if (typeof v === "number") return v;
  if (v instanceof GNode && v.kind === "control") {
    const given = args?.get(v.name);
    if (typeof given === "number") return given;
    const d = info?.defaults.get(v.name) ?? v.inputs.default;
    const x = Array.isArray(d) ? d[0] : d;
    return typeof x === "number" ? x : null;
  }
  return null;
}

/** The value a mapped control bus or proxy gives: a number (bus.set), or a signal (an LFO writes it). */
function mappedValue(v: Value, ctx: Context): Cell | null {
  if (v instanceof Sym) {
    const index = Number(v.name.slice(1));
    const bus = ctx.interp.buses.find((b) => b.rate === "control" && b.index === index);
    return bus ? mappedValue(bus, ctx) : ctx.lfos.get(index) ?? null;
  }
  if (v instanceof BusV) {
    if (v.rate !== "control") return null;
    if (typeof v.value === "number") return v.value;
    // A value a GUI control, MIDI or OSC sets (bus.set in its function): live.
    if (v.value instanceof RandToken) return v.value;
    return ctx.lfos.get(v.index) ?? null;
  }
  if (v instanceof ProxyV) {
    const src = v.source;
    if (typeof src === "number") return src;
    if (src instanceof SCFunc) {
      const graph = ctx.interp.graphOf(new SynthDefV("__map_" + v.key, src, v.line));
      const lfo = graph ? lfoSignalOf(graph.output, (x) => argNumber(x, null, null)) : null;
      if (lfo) return new SigCell(lfo);
      const env = graph ? envSignalOf(graph.output, (x) => argNumber(x, null, null)) : null;
      return env ? new SigCell(null, { sig: env, start: 0 }) : null;
    }
  }
  return null;
}

/** An event's sound: the synth's, or for a sample player the bank of the buffer it plays. */
function soundToken(e: SimEvent, info: SynthInfo | null, ctx: Context, soundOf: (instrument: string) => string): string {
  if (e.instrument === "__midi") return "__midi";
  if (e.instrument.startsWith("__osc")) return e.instrument;
  if (e.instrument === "__buffer" || info?.sample) {
    const buf = info?.sample?.buf ?? null;
    let v: Value | undefined = e.instrument === "__buffer" ? e.ev.get("buf") : buf;
    if (buf instanceof GNode && buf.kind === "control") v = e.ev.get(buf.name) ?? info?.defaults.get(buf.name) ?? buf.inputs.default;
    if (Array.isArray(v)) v = v[0];
    const b = v instanceof BufferV ? v : typeof v === "number" ? ctx.interp.buffers[v] ?? null : null;
    if (b && b.path) {
      ctx.banks.add(b);
      return b.bank;
    }
    ctx.note("\\" + e.instrument + " plays a buffer that is not read from a file (Buffer.read) in the code: it plays the sample bank \"" + (b?.bank ?? "buffer") + "\", which you can load with samples().");
    return b?.bank ?? "buffer";
  }
  return soundOf(e.instrument);
}

/** The effects a part goes through: Pfx and JITLib filters (__fx), the effect synths on its bus, and sends. */
function effectsFor(e: SimEvent, info: SynthInfo | null, ctx: Context, line: number): { controls: Fixed[]; names: string[] } {
  const chain: { info: SynthInfo; args: SCEvent; name: string; gain: number }[] = [];
  const fxList = e.ev.get("__fx");
  for (const s of Array.isArray(fxList) ? fxList : []) {
    if (!(s instanceof SynthV)) continue;
    const fi = ctx.synthFor(s.name);
    if (fi?.input) chain.push({ info: fi, args: s.args, name: s.name, gain: 1 });
    else ctx.note("\\" + s.name + " is used as an effect but does not read its input (In.ar): it is left out.");
  }
  const follow = (bus: number | null, gain: number) => {
    for (let guard = 0; guard < 8 && bus !== null && bus >= 16; guard++) {
      const list = ctx.fx.get(bus);
      if (!list || !list.length) {
        const known = ctx.interp.buses.some((b) => b.index === bus && b.rate === "audio");
        if (known) ctx.note("Line " + line + " plays into a bus nothing reads: SuperCollider would not be heard; here it plays dry.");
        return;
      }
      for (const f of list) chain.push({ info: f.info, args: f.args, name: f.name, gain });
      bus = list[list.length - 1].out;
    }
  };
  const mainName = info && info.mainBus instanceof GNode && info.mainBus.kind === "control" ? info.mainBus.name : "out";
  follow(info ? busIndex(info.mainBus, e.ev, info) : busIndex(e.ev.get(mainName) ?? 0, null, null), 1);
  for (const s of info?.sends ?? []) {
    const before = chain.length;
    follow(busIndex(s.bus, e.ev, info), s.gain);
    if (chain.length > before) ctx.note("Line " + line + " sends part of its sound to an effect: here the whole sound goes through it" + (s.gain < 1 ? " (the reverb's mix is scaled by the send level)" : "") + ".");
  }
  const out: Fixed[] = [];
  const seen = new Set<string>();
  for (const f of chain) {
    for (const fixed of f.info.fixed) {
      if (!isEffectControl(fixed.control) || seen.has(fixed.control)) continue;
      let value: Value = fixed.value;
      if (fixed.arg && f.args.has(fixed.arg)) {
        const role = f.info.roles.get(fixed.arg)?.find((ro) => ro.control === fixed.control);
        const given = f.args.get(fixed.arg);
        if (role && typeof given === "number") value = round(role.fn(given));
      }
      if (fixed.control === "freeverb" && typeof value === "number" && f.gain < 1) value = round(value * f.gain);
      seen.add(fixed.control);
      out.push({ ...fixed, value, arg: undefined });
    }
  }
  return { controls: out, names: unique(chain.map((f) => (/_(fx|filter[0-9]+)$/.test(f.name) ? "filter of " + f.name.replace(/_(fx|filter[0-9]+)$/, "") : f.name))) };
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}

/** The controls of a MIDI event: note, velocity (amp), channel, control and program changes, length. */
function midiControls(e: SimEvent, note: (s: string) => void): Map<string, Cell> {
  const ev = e.ev;
  const out = new Map<string, Cell>();
  const cmd = ev.get("midicmd") instanceof Sym ? (ev.get("midicmd") as Sym).name : "noteOn";
  if (cmd === "control") {
    out.set("ccn", ev.get("ctlNum") ?? 0);
    out.set("ccv", ev.get("control") ?? 0);
  } else if (cmd === "program") {
    out.set("pgm", ev.get("progNum") ?? 0);
  } else if (cmd === "noteOn") {
    const pitch = pitchOf(ev, note);
    if (pitch) out.set("note", pitch.control === "freq" ? applyRole(pitch.value, (f) => 69 + 12 * Math.log2(f / 440), (x) => `69 + 12 * Math.log2(${x} / 440)`) : pitch.value);
    else out.set("note", 60);
    // SuperCollider's MIDI velocity is amp * 127 (amp is 0.1 when the event does not set it).
    out.set("vel", ev.get("amp") ?? 0.1);
    const legato = e.delta > 0 ? e.sustain / e.delta : 1;
    if (Math.abs(legato - 1) > 1e-6) out.set("legato", round(legato));
  } else {
    note("The MIDI command \\" + cmd + " is not converted: TidalJS sends notes, control changes and program changes.");
  }
  const chan = ev.get("chan");
  if (typeof chan === "number" || chan instanceof RandToken) out.set("midichan", chan);
  return out;
}

/** v(k, j) = v(0, j) + k * d (or * d ** k) for every loop k and step j: a series that never repeats. */
function growth(byLoop: Cell[][], isNote: boolean): { op: "add" | "mul"; d: number } | null {
  if (byLoop.length < 3) return null;
  const base = byLoop[0];
  const nums = byLoop.every((cells) => cells.length === base.length && cells.every((c, j) => (c === GAP) === (base[j] === GAP) && (c === GAP || typeof c === "number")));
  if (!nums) return null;
  const j0 = base.findIndex((c) => c !== GAP);
  if (j0 < 0) return null;
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  const d = (byLoop[1][j0] as number) - (base[j0] as number);
  if (d !== 0 && byLoop.every((cells, k) => cells.every((c, j) => c === GAP || close(c as number, (base[j] as number) + k * d)))) return { op: "add", d };
  if (isNote || base[j0] === 0) return null;
  const r = (byLoop[1][j0] as number) / (base[j0] as number);
  if (r !== 1 && r > 0 && byLoop.every((cells, k) => cells.every((c, j) => c === GAP || close(c as number, (base[j] as number) * Math.pow(r, k))))) return { op: "mul", d: r };
  return null;
}

/** Each loop plays the same values in another order (Pn(Pshuf(list))). */
function isShuffle(byLoop: Cell[][]): boolean {
  if (byLoop.length < 3 || byLoop[0].length < 2) return false;
  const sorted = (cells: Cell[]) => cells.map((c) => cellKey(c)).sort().join("|");
  const s0 = sorted(byLoop[0]);
  return byLoop.every((cells) => cells.every((c) => c !== GAP && (typeof c === "number" || c instanceof Sym || typeof c === "string")) && sorted(cells) === s0)
    && new Set(byLoop.map((cells) => cells.map((c) => cellKey(c)).join("|"))).size > 1;
}

/** A path SuperCollider reads, as a path a browser can fetch (forward slashes, no drive letter guessing). */
function webPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** A fixed control: a value, or an LFO of the synth followed during each note. */
function fixedCode(f: Fixed, byFreq = false): string {
  if (f.control === "pitchrand" && Array.isArray(f.value)) {
    // A random detune per note: added to the note, or the frequency multiplied.
    const [lo, hi] = f.value as number[];
    return byFreq ? ".mul(freq(rand.range(" + fmt(round(2 ** (lo / 12))) + ", " + fmt(round(2 ** (hi / 12))) + ")))" : ".add(note(rand.range(" + fmt(lo) + ", " + fmt(hi) + ")))";
  }
  if (f.lfo) return ".followNote(" + str(f.control) + ", " + followCode(f.lfo) + ")";
  if (f.env) return ".followNote(" + str(f.control) + ", " + envelopeCode(f.env) + ")";
  if (f.code) return f.during ? ".follow(" + str(f.control) + ", " + f.code + ")" : "." + f.control + "(" + f.code + ")";
  return "." + f.control + "(" + literal(f.value) + ")";
}

/** Does another LFO move this one's speed or range? */
function moves(l: LfoSignal): boolean {
  return !!(l.rateMod || l.loMod || l.hiMod);
}

/**
 * An LFO whose speed or range other LFOs move, as sig((t) => ...): s is the time in seconds, the phase is the
 * integral of the speed (so the LFO speeds up and slows down smoothly, as in SuperCollider), and the bounds
 * are the moving LFOs' values.
 */
function movingSignalCode(l: LfoSignal, seconds: string): string {
  const helpers = new Set<string>();
  const value = signalJs(l, "s", helpers, 0);
  const lines = ["const s = " + seconds + ";"];
  if (helpers.has("noise")) lines.push("const noise = (x) => { const h = (n) => { const r = Math.sin(n * 12.9898) * 43758.5453; return r - Math.floor(r); }; const i = Math.floor(x), f = x - i; return h(i) + (h(i + 1) - h(i)) * f * f * (3 - 2 * f); };");
  if (helpers.has("step")) lines.push("const step = (x) => { const r = Math.sin(Math.floor(x) * 12.9898) * 43758.5453; return r - Math.floor(r); };");
  return "sig((t) => { " + lines.join(" ") + " return " + value + "; })";
}

/** The value of an LFO at s seconds, as JavaScript (unipolar shape u, put in its range). */
function signalJs(l: LfoSignal, s: string, helpers: Set<string>, depth: number): string {
  const lo = l.loMod && depth < 3 ? "(" + signalJs(l.loMod, s, helpers, depth + 1) + ")" : fmt(round(l.lo));
  const hi = l.hiMod && depth < 3 ? "(" + signalJs(l.hiMod, s, helpers, depth + 1) + ")" : fmt(round(l.hi));
  const u = unitJs(l.shape, phaseJs(l, s), helpers);
  return l.exp && l.lo > 0 && l.hi > 0 ? lo + " * (" + hi + " / " + lo + ") ** " + u : lo + " + (" + hi + " - " + lo + ") * " + u;
}

/** How many cycles an LFO has run after s seconds: its speed, integrated (exactly for a sine, saw, triangle or square that moves it). */
function phaseJs(l: LfoSignal, s: string): string {
  const m = l.rateMod;
  if (!m || m.shape.startsWith("LFNoise") || moves(m) || !(m.rate > 0)) return fmt(round(l.rate)) + " * " + s;
  const a = round(m.lo), span = round((m.hi - m.lo) / m.rate);
  const x = fmt(round(m.rate)) + " * " + s;
  return "(" + fmt(a) + " * " + s + " + " + fmt(span) + " * " + integralJs(m.shape, x) + ")";
}

/** A shape from 0 to 1 at phase x (cycles), like TidalJS's sine, saw, tri, square, perlin and stepped random. */
function unitJs(shape: string, x: string, helpers: Set<string>): string {
  const f = "(((" + x + ") % 1 + 1) % 1)";
  if (shape === "LFSaw" || shape === "Saw") return f;
  if (shape === "LFTri") return "(1 - Math.abs(2 * " + f + " - 1))";
  if (shape === "LFPulse" || shape === "Pulse") return "(" + f + " < 0.5 ? 0 : 1)";
  if (shape === "LFNoise0") { helpers.add("step"); return "step(" + x + ")"; }
  if (shape.startsWith("LFNoise")) { helpers.add("noise"); return "noise(" + x + ")"; }
  return "(Math.sin(2 * Math.PI * (" + x + ")) + 1) / 2";
}

/** The integral of a shape from phase 0 to x (each cycle adds 1/2). */
function integralJs(shape: string, x: string): string {
  const fl = "Math.floor(" + x + ")";
  const f = "(" + x + " - " + fl + ")";
  if (shape === "LFSaw" || shape === "Saw") return "(" + fl + " / 2 + " + f + " ** 2 / 2)";
  if (shape === "LFTri") return "(" + fl + " / 2 + (" + f + " < 0.5 ? " + f + " ** 2 : 2 * " + f + " - " + f + " ** 2 - 0.5))";
  if (shape === "LFPulse" || shape === "Pulse") return "(" + fl + " / 2 + Math.max(0, " + f + " - 0.5))";
  return "((" + x + ") / 2 + (1 - Math.cos(2 * Math.PI * (" + x + "))) / (4 * Math.PI))";
}

/** An envelope as TidalJS's envelope(levels, times, curves) (times in seconds); curves left out when all are straight. */
function envelopeCode(e: EnvSignal): string {
  const curves = e.curves.every((c) => c === "lin" || c === 0) ? "" : ", [" + e.curves.map((c) => (typeof c === "number" ? fmt(c) : str(c))).join(", ") + "]";
  return "envelope([" + e.levels.map((l) => fmt(round(l))).join(", ") + "], [" + e.times.map((t) => fmt(round(t))).join(", ") + "]" + curves + ")";
}

/** An LFO as a signal for follow / followNote: its rate in Hz is rate / cps cycles per cycle. */
function followCode(lfo: LfoSignal): string {
  if (moves(lfo)) return movingSignalCode(lfo, "t / getcps()");
  const { shape, rate, lo, hi, exp } = lfo;
  const base = shape === "LFSaw" || shape === "Saw" ? "saw" : shape === "LFTri" ? "tri" : shape === "LFPulse" || shape === "Pulse" ? "square"
    : shape === "LFNoise0" ? "rand.segment(1)" : shape.startsWith("LFNoise") ? "perlin" : "sine";
  const code = base + (exp && lo > 0 && hi > 0 ? ".rangex(" : ".range(") + fmt(lo) + ", " + fmt(hi) + ")";
  return rate > 0 ? code + ".fast(" + fmt(rate) + " / getcps())" : code;
}

/** The most step lengths rhythm() is given in a loop (`cat` of this many items). */
const MAX_DURATION_LOOP = 64;

/**
 * Random durations never loop. The part is cut into steps, one per time something starts: the events there (a
 * chord, or synths a routine starts together) or a rest. Each step has its length: a random duration (scaled by
 * stretch and tempo) or a fixed one. When the steps follow one another and their lengths repeat, the steps are
 * written in order, one per beat, and rhythm() plays them, each as long as its length: rhythm(d) for one random
 * duration, rhythm(cat(...)) for a loop of lengths. Otherwise eight random stretches of the part (4 beats each)
 * are written, and randcat picks one of them each cycle.
 */
function randomRhythm(part: Part, ctx: Context, label: string, comment: string[]): WrittenPart | null {
  const steps = rhythmSteps(part);
  if (steps) {
    // Events of step k at beat k, one beat long; their length relative to the step is kept (legato).
    // A synth a routine starts lasts until the routine moves on: its delta, 0 for all but the last started together.
    const sustainOf = (e: SimEvent, s: RhythmStep) => (e.ev.get("__synth") && e.delta < 1e-9 ? s.length : e.sustain);
    const placed = steps.flatMap((s, k) => s.events.map((e) => ({ ...e, t: k, delta: 1, sustain: s.length > 0 ? sustainOf(e, s) / s.length : 1 })));
    const loop = durationLoop(steps.map((s) => s.dur));
    const w = loop && placed.length ? writePart({ ...part, events: placed, rests: [], start: 0, end: null, horizon: steps.length }, ctx) : null;
    if (w && loop) {
      ctx.note("Line " + part.line + " has random durations: rhythm() plays its " + (steps.some((s) => !s.events.length) ? "events and rests" : "events")
        + " one after another, each with a new random duration (TidalJS's random values repeat after 300 steps).");
      // The first step starts where the part starts.
      return { ...w, label, comment: [...comment, ...w.comment.filter((c) => !comment.includes(c))], rhythm: { durs: loop, steps: w.period }, start: part.start };
    }
  }
  return randomStretches(part, ctx, label, comment);
}

interface RhythmStep {
  /** What plays at the step's start (none for a rest). */
  events: SimEvent[];
  /** How long the step lasts, in beats, as SuperCollider played it. */
  length: number;
  /** Its length as written: a random duration or a number of beats. */
  dur: RandToken | number;
}

/** The part's steps, in order; null when a step's length is not one random duration or a fixed one. */
function rhythmSteps(part: Part): RhythmStep[] | null {
  const all = [...part.events, ...(part.rests ?? [])].sort((a, b) => a.t - b.t || Number(!!a.rest) - Number(!!b.rest));
  if (all.some((e) => e.ev.has("__stretchtoken") || e.ev.has("__randgap") || numOf(e.ev.get("timingOffset"), 0) !== 0)) return null;
  // One group per start time.
  const groups: SimEvent[][] = [];
  for (const e of all) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[0].t - e.t) < 1e-6) last.push(e);
    else groups.push([e]);
  }
  if (groups.length < 4) return null;
  const steps: RhythmStep[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const events = group.filter((e) => !e.rest);
    // A rest at the same time as an event takes no time of its own.
    if (events.length && events.length < group.length) return null;
    // How far the group moves time: its longest delta (a routine's synths started together have 0 but the last).
    const length = Math.max(...group.map((e) => e.delta));
    // Each step must start where the one before it ends.
    if (i + 1 < groups.length && Math.abs(groups[i + 1][0].t - (group[0].t + length)) > 1e-6) return null;
    const timed = group.find((e) => e.ev.get("__durtoken") instanceof RandToken);
    let dur: RandToken | number = length;
    if (timed) {
      const token = timed.ev.get("__durtoken") as RandToken;
      if (group.some((e) => { const t = e.ev.get("__durtoken"); return !(t instanceof RandToken) || t.key() !== token.key(); })) return null;
      // The step's length over the value drawn: stretch and tempo.
      const drawn = timed.ev.get("__durvalue");
      if (typeof drawn !== "number" || !(drawn > 0)) return null;
      const factor = Number((length / drawn).toPrecision(10));
      dur = factor === 1 ? token : token.map((x) => x * factor, "x * " + fmt(factor), [factor, 0]);
    }
    steps.push({ events, length, dur });
  }
  return steps;
}

/** The shortest loop of step lengths, from the first step (the last few may be cut off by the horizon). */
function durationLoop(durs: (RandToken | number)[]): (RandToken | number)[] | null {
  const key = (d: RandToken | number) => (d instanceof RandToken ? "r" + d.key() : fmtKey(d));
  const keys = durs.map(key);
  for (let q = 1; q <= MAX_DURATION_LOOP && q * 2 <= keys.length; q++) {
    let ok = true;
    for (let i = q; i < keys.length && ok; i++) ok = keys[i] === keys[i - q];
    if (ok) return durs.slice(0, q);
  }
  return null;
}

function randomStretches(part: Part, ctx: Context, label: string, comment: string[]): WrittenPart | null {
  const W = 4, K = 8;
  const start = part.events[0].t;
  const bodies: string[] = [];
  for (let k = 0; k < K; k++) {
    const from = start + k * W;
    const evs = part.events.filter((e) => e.t >= from - 1e-9 && e.t < from + W - 1e-9).map((e) => ({ ...e, t: e.t - from }));
    if (evs.length === 0) { bodies.push("silence"); continue; }
    const w = writePart({ ...part, events: evs, start: 0, end: W, horizon: W, drone: false }, ctx);
    if (w) bodies.push(w.body.split("\n").join("\n  "));
  }
  if (bodies.every((b) => b === "silence")) return null;
  ctx.note("Line " + part.line + " has random durations: " + K + " random " + W + "-beat stretches of it are written, and randcat picks one each cycle (SuperCollider never repeats).");
  // The stretches start at the part's first event.
  return { label, comment, body: "randcat(\n  " + bodies.join(",\n  ") + "\n)", period: W, start };
}

/**
 * A MIDI note function that starts a synth: midikeys(template), the synth's sound and controls at full velocity;
 * an OSC function that starts one: oscplay(address, template), its values read from the message with oscIn.
 */
function writeMidiKeys(rec: PlayRecord, ctx: Context): { comment: string[]; body: string; label: string } {
  const osc = rec.kind === "oscplay";
  const synth = rec.synth as SynthV;
  const info = ctx.synthFor(synth.name);
  const ev = synth.args.copy();
  ev.set("instrument", new Sym(synth.name));
  ev.set("__synth", true);
  let transposed = false;
  for (const [k, v] of [...ev.map]) {
    if (!(v instanceof RandToken)) continue;
    if (v.kind === "midinote") {
      // midikeys sets the note from the key.
      ev.delete(k);
      const at60 = v.realize(() => 0) as number;
      const m = k === "freq" ? 69 + 12 * Math.log2(at60 / 440) : at60;
      if (Math.abs(m - 60) > 1e-6) transposed = true;
    } else if (v.kind === "midivel") ev.set(k, v.realize(() => 0));
  }
  if (transposed) ctx.note("Line " + rec.line + " transposes the key it plays: midikeys plays the key itself.");
  const e: SimEvent = { t: 0, src: "keys", line: rec.line, delta: 1, sustain: 1, instrument: synth.name, ev };
  const controls = controlsOf(e, info, ctx);
  controls.delete("legato");
  if (!osc) {
    controls.delete("note");
    controls.delete("freq");
  }
  const soundName = info?.sample ? "buffer" : info ? info.sound : TIDAL_SOUNDS.has(synth.name) ? synth.name : soundByName(synth.name) ?? (synth.name === "default" ? "saw" : synth.name);
  const lines = ["sound(" + str(soundName) + ")"];
  for (const [k, v] of controls) {
    // A live input (each key's pressure, a controller) moves the held note: followed. The values an OSC message
    // carries start its synth and stay (oscplay reads them when the message comes).
    if (v instanceof RandToken && LIVE_KINDS.has(v.kind) && FOLLOWABLE.has(k) && !(osc && v.kind === "oscin")) lines.push(".follow(" + str(k) + ", " + tokenCode(v, k === "note", 0) + ")");
    else lines.push("." + k + "(" + valueCode(v, false, () => 0, { period: 1, tempo: ctx.tempo }) + ")");
  }
  const present = new Set(controls.keys());
  for (const f of info?.fixed ?? []) {
    if (present.has(f.control) || (f.arg && ev.has(f.arg))) continue;
    present.add(f.control);
    lines.push(fixedCode(f));
  }
  if (!info && synth.name === "default") { if (!present.has("lpf")) lines.push(".lpf(4000)"); if (!present.has("amp")) lines.push(".amp(0.12)"); }
  if (osc) {
    if (info?.endless) ctx.note("Line " + rec.line + ": \\" + synth.name + " has no envelope that ends it; started by OSC, it plays for one cycle here.");
    return {
      label: "osc",
      comment: ["OSC (line " + rec.line + "): each message to " + rec.path + " plays \\" + synth.name + (info ? " (" + info.summary + ")" : "") + " with the values it carries."],
      body: "oscplay(" + str(rec.path ?? "/") + ", " + lines.join("") + ")",
    };
  }
  const bend = rec.bendRange && rec.bendRange > 0 ? ", " + (typeof rec.channel === "number" ? fmt(rec.channel) : "null") + ", " + fmt(rec.bendRange) : "";
  const chan = bend ? "" : typeof rec.channel === "number" ? ", " + fmt(rec.channel) : "";
  return {
    label: "keys",
    comment: ["MIDI keys (line " + rec.line + "): each key played on a MIDI keyboard plays \\" + synth.name + (info ? " (" + info.summary + ")" : "") + ", held until the key is let go"
      + (bend ? "; the pitch-bend wheel bends the held notes up to " + fmt(rec.bendRange as number) + " semitones." : ".")],
    body: "midikeys(" + lines.join("") + chan + bend + ")",
  };
}

/** A ratio as exact code: 8 / 3 rather than 2.66667, so long loops do not drift. */
function ratioCode(x: number): string {
  if (Math.abs(Number(fmt(x)) - x) < 1e-12 * Math.max(1, x)) return fmt(x);
  for (let d = 2; d <= 192; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < 1e-9 * Math.max(1, x)) return n + " / " + d;
  }
  return String(x);
}

function numOf(v: Value | undefined, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(6)));
}

function fmtKey(n: number) {
  return (Math.round(n * 1e6) / 1e6).toFixed(6);
}

function round(x: number) {
  return Number(x.toPrecision(10));
}

