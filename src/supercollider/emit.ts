/**
 * Plays what the SuperCollider program plays, on a virtual clock, and writes
 * it as TidalJS code. Each Pbind (or routine instrument) becomes one part:
 * its rhythm (dur, rests) as a structure, each key as a TidalJS control, its
 * SynthDef as a TidalJS synth with effects. Parts loop over their shortest
 * period; one cycle is the period most parts share.
 */
import { CONTROL_NAMES } from "../data/signatures.ts";
import { describeText, degreeToKey, gcd, SCALES, type Interpreter, type PlayRecord } from "./interpreter.ts";
import { advanceOf, DONE, ownDelta, Stream } from "./patterns.ts";
import { analyseSynthDef, soundByName, TIDAL_SOUNDS, type Fixed, type SynthInfo } from "./synthdef.ts";
import { RandToken, RestV, SCEvent, ScaleV, Sym, isPattern, type Value } from "./values.ts";

/** How far the program is played to find its loops, in beats. */
const HORIZON = 512;
const MAX_EVENTS = 6000;
/** What loops when something never repeats, in beats. */
const FALLBACK = 16;

interface SimEvent {
  t: number;
  src: string;
  line: number;
  delta: number;
  sustain: number;
  instrument: string;
  ev: SCEvent;
}

interface Part {
  name: string;
  line: number;
  instrument: string;
  events: SimEvent[];
  /** The time the stream ended (finite patterns), or null. */
  end: number | null;
  /** One synth that plays until it is stopped. */
  drone: boolean;
}

const CONTROLS = new Set(CONTROL_NAMES);
const EVENT_KEYS = new Set([
  "dur", "delta", "stretch", "legato", "sustain", "instrument", "type", "amp", "db", "pan", "degree", "scale", "octave", "root",
  "mtranspose", "gtranspose", "ctranspose", "note", "midinote", "freq", "detune", "harmonic", "stepsPerOctave", "strum", "lag",
  "timingOffset", "out", "group", "addAction", "id", "server", "tempo", "velocity", "hasGate", "isRest", "s", "orbit", "latency",
  "sendGate", "midicmd", "chan", "midiout", "ctlNum", "control", "bufnum", "buf",
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
  const tempo = firstClock.tempo;

  // Play everything.
  const events: SimEvent[] = [];
  let finiteEnd: number | null = null;
  let anyInfinite = false;
  for (const rec of played) {
    const scale = tempo / (rec.clock.tempo || 1);
    const sim = simulate(interp, rec, scale);
    if (rec.endless) sim.end = null;
    events.push(...sim.events);
    if (sim.end === null) anyInfinite = true;
    else finiteEnd = Math.max(finiteEnd ?? 0, sim.end);
  }
  if (played.length === 0) {
    note("Nothing in the file plays (no .play, Pdef(...).play, Synth or routine): the patterns it defines are shown.");
  }

  // One part per source (Pbind, or routine and instrument).
  const bySrc = new Map<string, SimEvent[]>();
  for (const e of events) {
    const list = bySrc.get(e.src) ?? [];
    list.push(e);
    bySrc.set(e.src, list);
  }
  // Synths.
  const synthCache = new Map<string, SynthInfo | null>();
  const synthFor = (name: string): SynthInfo | null => {
    if (!synthCache.has(name)) {
      const def = interp.synthDefs.get(name);
      synthCache.set(name, def ? analyseSynthDef(interp, def) : null);
    }
    return synthCache.get(name) ?? null;
  };

  // A synth started once that nothing ends ({ ... }.play, Synth(\default)) plays until it is stopped.
  const isDrone = (list: SimEvent[]) => list.length === 1 && list[0].ev.get("__top") === true
    && (list[0].instrument === "default" || synthFor(list[0].instrument)?.endless === true);

  const parts: Part[] = [];
  let finiteParts = 0;
  for (const [src, list] of bySrc) {
    list.sort((a, b) => a.t - b.t);
    const instruments = new Set(list.map((e) => e.instrument));
    const instrument = instruments.size === 1 ? list[0].instrument : "";
    const drone = isDrone(list);
    if (!drone) finiteParts++;
    parts.push({ name: src, line: list[0].line, instrument, events: list, end: anyInfinite ? null : finiteEnd, drone });
  }
  if (!anyInfinite && finiteEnd !== null && finiteParts > 0) {
    note("In SuperCollider this plays once (" + fmt(finiteEnd) + (finiteEnd === 1 ? " beat" : " beats") + "); in TidalJS it loops.");
  }
  if (parts.some((p) => p.drone)) {
    note("A synth that nothing stops plays until you stop it in SuperCollider; here its note restarts every cycle.");
  }

  // Write each part.
  const written = parts.map((part) => writePart(part, synthFor, note, tempo));
  const valid = written.filter((w): w is WrittenPart => w !== null);

  // Beats per cycle: the period most parts share (4, a bar, when it fits).
  const periods = valid.map((w) => w.period);
  const beatsPerCycle = chooseCycle(periods);

  const usedNames = new Set<string>();
  const blocks: string[] = [];
  const names: string[] = [];
  for (const w of valid) {
    const name = uniqueName(w.label, usedNames);
    names.push(name);
    const span = w.period / beatsPerCycle;
    let body = w.body;
    if (Math.abs(span - 1) > 1e-9) {
      body += span > 1 ? "\n  .slow(" + fmt(span) + ")" : "\n  .fast(" + fmt(1 / span) + ")";
    }
    blocks.push(w.comment.map((c) => "// " + c).join("\n") + "\n" + (valid.length > 1 ? "const " + name + " = " : "") + body);
  }

  for (const n of interp.notes) note(n);
  const header: string[] = [];
  header.push("// " + (sourceName ? sourceName + ": c" : "C") + "onverted from SuperCollider by TidalJS.");
  if (notes.length) {
    header.push("// Notes on the conversion:");
    for (const n of notes) header.push("// - " + n);
  }
  const tempoComment = (firstClock.explicit || tempo !== 1 ? "tempo " + fmt(tempo) + " beats per second" : "SuperCollider's default tempo, 1 beat per second")
    + ", " + fmt(beatsPerCycle) + " beat" + (beatsPerCycle === 1 ? "" : "s") + " per cycle";
  const lines = [
    header.join("\n"),
    tempoLine(tempo, beatsPerCycle) + " // " + tempoComment,
    "setOutput(1, false) // as SuperCollider: no master volume and no limiter",
  ];
  if (valid.length === 0) {
    lines.push("", "// Nothing to play was found.");
    return { code: lines.join("\n") + "\n", parts: 0 };
  }
  lines.push("", blocks.join("\n\n"));
  if (valid.length > 1) lines.push("", "stack([" + names.join(", ") + "])");
  return { code: lines.join("\n") + "\n", parts: valid.length };
}

/** The tempo as TidalJS code: setTempo(bpm) for 4 beats per cycle, else setCPS. */
function tempoLine(tempo: number, beats: number): string {
  const bpm = tempo * 60;
  const exact = (x: number) => Math.abs(Number(fmt(x)) - x) < 1e-12 * Math.max(1, Math.abs(x));
  if (beats === 4 && exact(bpm)) return "setTempo(" + fmt(bpm) + ")";
  const cps = tempo / beats;
  if (exact(cps)) return "setCPS(" + fmt(cps) + ")";
  if (exact(tempo)) return "setCPS(" + fmt(tempo) + " / " + fmt(beats) + ")";
  if (exact(bpm)) return "setCPS(" + fmt(bpm) + " / 60 / " + fmt(beats) + ")";
  return "setCPS(" + String(cps) + ")";
}

// ---------------------------------------------------------------- simulation

function simulate(interp: Interpreter, rec: PlayRecord, scale: number): { events: SimEvent[]; end: number | null } {
  const out: SimEvent[] = [];
  if (rec.kind === "event" && rec.event) {
    const ev = rec.event;
    out.push(resolve(ev, 0, ownDelta(ev), "e" + rec.line + ":" + describeText(ev.get("instrument") ?? new Sym("default")), rec.line, scale));
    return { events: out, end: ownDelta(ev) * scale };
  }
  const source = rec.pattern;
  if (!isPattern(source)) return { events: out, end: 0 };
  return run(interp, source, rec.start, rec.line, scale, out, 0);
}

function run(interp: Interpreter, source: Value, start: number, line: number, scale: number, out: SimEvent[], depth: number): { events: SimEvent[]; end: number | null } {
  const stream = new Stream(source, { host: interp });
  let t = start;
  let count = 0;
  for (;;) {
    if (t * scale >= HORIZON || count++ > MAX_EVENTS) return { events: out, end: null };
    interp.time = t;
    const ev = stream.next(new SCEvent());
    if (ev === DONE) return { events: out, end: t * scale };
    if (!(ev instanceof SCEvent)) return { events: out, end: t * scale };
    const sub = ev.get("__pattern");
    if (sub !== undefined && depth < 4) {
      // A pattern a routine started: played from now.
      run(interp, sub, t, numOf(ev.get("__line"), line), scale, out, depth + 1);
    } else if (!isRest(ev)) {
      const offset = numOf(ev.get("timingOffset"), 0);
      const src = String(ev.get("__src") ?? "p" + line);
      out.push(resolve(ev, (t + offset) * scale, ownDelta(ev) * scale, src, numOf(ev.get("__line"), line), scale));
    }
    const adv = advanceOf(ev);
    t += adv > 0 || adv === 0 ? adv : 0;
  }
}

function resolve(ev: SCEvent, t: number, delta: number, src: string, line: number, scale: number): SimEvent {
  const dirt = ev.get("type") instanceof Sym && (ev.get("type") as Sym).name === "dirt";
  const instrument = describeText((dirt ? ev.get("s") : ev.get("instrument")) ?? new Sym("default"));
  let sustain: number;
  const sus = ev.get("sustain");
  if (typeof sus === "number") sustain = sus * scale;
  else if (ev.get("__synth")) sustain = delta;
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
}

type Cell = Value | RandToken;

/** A step of a part: an event (with its controls) or a gap. */
interface Step {
  t: number;
  width: number;
  event: SimEvent | null;
}

function writePart(part: Part, synthFor: (name: string) => SynthInfo | null, note: (s: string) => void, tempo: number): WrittenPart | null {
  let evs = part.events;
  if (evs.length === 0) return null;
  if (part.drone) {
    // One long note per loop, as long as the loop; LFOs line up again where it restarts.
    const length = droneBeats(synthFor(part.instrument), tempo);
    evs = [{ ...evs[0], t: 0, delta: length, sustain: length }];
    part = { ...part, events: evs, end: length };
  }
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
  const comment: string[] = [];
  const label = varying ? "part" : /^anonymous/.test(part.instrument) ? "synth" : part.instrument;
  if (!varying) {
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
  const rows = evs.map((e) => controlsOf(e, infos.get(e.instrument) ?? null, note));
  const keys: string[] = [];
  for (const row of rows) for (const k of row.keys()) if (!keys.includes(k)) keys.push(k);

  // Rhythm: the times, own deltas and (when they vary) the sounds.
  const rhythmKey = (i: number) => fmtKey(evs[i].delta) + "|" + (varying ? evs[i].instrument : "");
  const cellKey = (c: Cell | undefined) => (c instanceof RandToken ? c.key() : JSON.stringify(c ?? null, jsonValue));
  const horizon = part.end ?? HORIZON;
  let period = findPeriod(evs, rhythmKey, horizon);
  const finite = part.end !== null;
  if (period === null) {
    period = finite ? Math.max(part.end ?? 0, lastEnd(evs)) : FALLBACK;
    if (!finite) note("The rhythm of line " + part.line + " never repeats: its first " + fmt(period) + " beats loop.");
  }
  if (finite && part.end !== null && part.end > 0 && Math.abs(part.end % period) > 1e-6 && part.end < period * 2) period = part.end;
  // When the whole part (rhythm and controls) repeats soon, write all of it in one loop.
  const fullKey = (i: number) => rhythmKey(i) + "|" + keys.map((k) => cellKey(rows[i].get(k))).join("|");
  const full = findPeriod(evs, fullKey, horizon);
  if (full !== null && full <= 16 + 1e-9 && full >= period - 1e-9) period = full;
  const start = Math.floor(evs[0].t / period + 1e-9) * period;
  if (start > 0) note("Line " + part.line + " starts after " + fmt(start) + " beats in SuperCollider; here it plays from the start.");

  const steps = stepsOf(evs, start, period);
  const weights = toWeights(steps.map((s) => s.width), note);

  // Structure.
  const lines: string[] = [];
  const allX = steps.every((s) => s.event);
  const equal = weights.every((w) => w === weights[0]);
  if (varying) {
    const tokens = steps.map((s) => (s.event ? miniName(soundOf(s.event.instrument)) : "~"));
    lines.push("sound(" + str(seq(tokens, weights)) + ")");
  } else {
    lines.push("sound(" + str(soundOf(part.instrument)) + ")");
    const n = steps.length;
    if (!(allX && equal && n === 1)) {
      lines.push(".struct(" + str(allX && equal ? "x*" + n : seq(steps.map((s) => (s.event ? "x" : "~")), weights)) + ")");
    }
  }

  // Controls: each over its own period (a multiple of the rhythm's).
  const order = ["note", "freq", "n", "legato"];
  keys.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  let tokenIndex = 0;
  for (const key of keys) {
    const valueAt = (i: number) => rows[i].get(key);
    const m = finite && period >= horizon - 1e-9 ? 1 : controlPeriod(evs, period, horizon, (i) => cellKey(valueAt(i)));
    if (m === null) note("The " + key + " of line " + part.line + " never repeats: its first " + fmt(FALLBACK) + " beats loop.");
    const mult = m ?? Math.max(1, Math.floor(FALLBACK / period));
    const cells: Cell[] = [];
    const cellWeights: number[] = [];
    for (let k = 0; k < mult; k++) {
      // The rhythm repeats, so each period has the same steps.
      const ks = k === 0 ? steps : stepsOf(evs, start + k * period, period);
      ks.forEach((s, j) => {
        cells.push(s.event ? rows[evs.indexOf(s.event)].get(key) ?? GAP : GAP);
        cellWeights.push(weights[j] ?? 1);
      });
    }
    const written = writeControl(key, cells, cellWeights, mult, () => tokenIndex++);
    if (written !== null) lines.push("." + key + "(" + written + ")");
  }

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
      for (const f of shared) lines.push("." + f.control + "(" + literal(f.value) + ")");
      channelFns = [[l, "-1"], [r, "1"]].map(([list, pan]) => "x => x" + (list as Fixed[]).filter((f) => !shared.some((g) => same(f, g)))
        .map((f) => "." + f.control + "(" + literal(f.value) + ")").join("") + ".pan(" + pan + ")");
    } else {
      for (const f of keep(mainInfo.fixed)) lines.push("." + f.control + "(" + literal(f.value) + ")");
    }
  } else if (!varying && part.instrument === "default") {
    if (!keys.includes("lpf")) lines.push(".lpf(4000)");
    // SuperCollider's default synth: three VarSaws at 0.3 times amp (0.1 by default).
    if (!keys.includes("amp")) lines.push(".amp(0.12)");
  }

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
    return { label, comment, body: "layer([\n  " + channelFns.join(",\n  ") + "\n], " + body.join("\n  ") + ")", period };
  }
  return { label, comment, body: body.join("\n  "), period };
}

/** A drone's loop, in beats: 4 or more, so that its LFOs (vib) complete whole cycles. */
function droneBeats(info: SynthInfo | null, tempo: number): number {
  const lists = info?.channels ?? [info?.fixed ?? []];
  const rates = lists.flat().filter((f) => f.control === "vib" && typeof f.value === "number").map((f) => f.value as number);
  for (let beats = 4; beats <= 64; beats += 4) {
    const seconds = beats / tempo;
    if (rates.every((r) => Math.abs(r * seconds - Math.round(r * seconds)) < 1e-6)) return beats;
  }
  return 4;
}

const GAP = Symbol("gap") as unknown as Value;

/** The TidalJS controls of one event. */
function controlsOf(e: SimEvent, info: SynthInfo | null, note: (s: string) => void): Map<string, Cell> {
  const ev = e.ev;
  const out = new Map<string, Cell>();
  const dirt = ev.get("type") instanceof Sym && (ev.get("type") as Sym).name === "dirt";

  // Pitch.
  const pitch = pitchOf(ev, note);
  if (pitch) out.set(pitch.control, pitch.value);

  // Length.
  const percussive = info?.fixed.some((f) => f.control === "hold") ?? false;
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
    if (value === null || value instanceof SCEvent) continue;
    const roles = info?.roles.get(key);
    if (roles && roles.length) {
      for (const role of roles) {
        if (role.control === "amp") continue;
        out.set(role.control, applyRole(value, role.fn, role.js));
      }
      continue;
    }
    if (CONTROLS.has(key)) {
      out.set(key, value);
      continue;
    }
    note("The key \\" + key + " is not a TidalJS control" + (info ? " and \\" + e.instrument + " does not use it in a way TidalJS knows" : "") + ": it is left out.");
  }
  return out;
}

function applyRole(value: Cell, fn: (x: number) => number, js: (x: string) => string): Cell {
  if (typeof value === "number") return round(fn(value));
  if (value instanceof RandToken) return value.map(fn, js("x"));
  if (Array.isArray(value)) return value.map((v) => (typeof v === "number" ? round(fn(v)) : v));
  return value;
}

function scaleCell(v: Cell, factor: number, offset = 0): Cell {
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

/** The shortest period (in beats) after which events repeat with the same key. */
function findPeriod(evs: SimEvent[], key: (i: number) => string, horizon: number): number | null {
  if (evs.length === 0) return null;
  const at = new Map<string, number[]>();
  evs.forEach((e, i) => {
    const k = fmtKey(e.t);
    const list = at.get(k) ?? [];
    list.push(i);
    at.set(k, list);
  });
  const k0 = key(0);
  const t0 = evs[0].t;
  const tried = new Set<string>();
  for (let j = 1; j < evs.length; j++) {
    const p = evs[j].t - t0;
    if (p <= 1e-9 || key(j) !== k0) continue;
    const pk = fmtKey(p);
    if (tried.has(pk)) continue;
    tried.add(pk);
    if (p > horizon / 2 + 1e-9) break;
    let ok = true;
    for (let i = 0; i < evs.length && ok; i++) {
      const t = evs[i].t + p;
      if (t > horizon - 1e-9) break;
      const there = at.get(fmtKey(t));
      if (!there || !there.some((x) => key(x) === key(i))) ok = false;
    }
    // And nothing extra in the next period.
    for (let i = 0; i < evs.length && ok; i++) {
      const t = evs[i].t - p;
      if (t < t0 - 1e-9) continue;
      const there = at.get(fmtKey(t));
      if (!there || !there.some((x) => key(x) === key(i))) ok = false;
    }
    if (ok) return p;
  }
  return null;
}

/** The smallest multiple of the rhythm's period over which a control repeats. */
function controlPeriod(evs: SimEvent[], period: number, horizon: number, key: (i: number) => string): number | null {
  const byTime = new Map(evs.map((e, i) => [fmtKey(e.t), i]));
  for (let m = 1; m * period <= horizon / 2 + 1e-9; m++) {
    const p = m * period;
    let ok = true;
    for (let i = 0; i < evs.length && ok; i++) {
      const t = evs[i].t + p;
      if (t > horizon - 1e-9) break;
      const j = byTime.get(fmtKey(t));
      if (j === undefined || key(j) !== key(i)) ok = false;
    }
    if (ok) return m;
  }
  return null;
}

function stepsOf(evs: SimEvent[], start: number, period: number): Step[] {
  const inWindow = evs.filter((e) => e.t >= start - 1e-9 && e.t < start + period - 1e-9);
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

function lastEnd(evs: SimEvent[]) {
  return evs.reduce((m, e) => Math.max(m, e.t + e.delta), 0);
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
  return widths.map((w) => Math.max(1, Math.round(w * 96)));
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

function writeControl(key: string, cells: Cell[], weights: number[], mult: number, nextToken: () => number): string | null {
  const real = cells.filter((c) => c !== GAP);
  if (real.length === 0) return null;
  if (real.every((c) => c === null)) return null;
  const isNote = key === "note";
  // One value throughout.
  const k0 = cellKey(real[0]);
  if (real.every((c) => cellKey(c) === k0)) {
    return valueCode(real[0], isNote, nextToken);
  }
  const hasToken = real.some((c) => c instanceof RandToken);
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
    const code = c instanceof RandToken ? valueCode(c, isNote, nextToken) : str(miniValue(c, isNote));
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
  return c instanceof RandToken ? c.key() : JSON.stringify(c, jsonValue);
}

function jsonValue(_k: string, v: unknown) {
  if (v instanceof Sym) return "\\" + v.name;
  if (v instanceof RandToken) return v.key();
  return v;
}

/** A value as TidalJS code: a number, a string, or a random signal. */
function valueCode(c: Cell, isNote: boolean, nextToken: () => number): string {
  if (c instanceof RandToken) return tokenCode(c, isNote, nextToken());
  if (typeof c === "number") return isNote ? str(noteName(c)) : fmt(c);
  if (Array.isArray(c)) return str(miniValue(c, isNote));
  if (c instanceof Sym || typeof c === "string") return str(describeText(c));
  if (typeof c === "boolean") return c ? "1" : "0";
  return literal(c);
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
  if (index > 0) base += ".late(" + fmt(index * 0.25) + ")";
  if (ops.length) {
    let expr = "x";
    for (const op of ops) expr = op.replace(/\bx\b/g, expr === "x" ? "x" : "(" + expr + ")");
    base += ".withValue((x) => " + expr + ")";
  }
  return base;
}

function listCode(items: Value[]) {
  return "[" + items.map(listItem).join(", ") + "]";
}

function listItem(v: Value) {
  if (typeof v === "number") return fmt(v);
  return JSON.stringify(describeText(v));
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
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return arrayLiteral(v);
  if (v instanceof Sym) return JSON.stringify(v.name);
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

function str(s: string) {
  return JSON.stringify(s);
}

function uniqueName(label: string, used: Set<string>) {
  let base = label.replace(/[^A-Za-z0-9_$]/g, "_").replace(/^([0-9])/, "_$1") || "part";
  base = base.charAt(0).toLowerCase() + base.slice(1);
  if (TAKEN.has(base)) base += "Part";
  let name = base;
  for (let i = 2; used.has(name); i++) name = base + i;
  used.add(name);
  return name;
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

