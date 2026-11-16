/**
 * Reads a SynthDef's graph and finds its TidalJS equivalent: a sound (one of
 * TidalJS's synths), the effects after the oscillators (filters, the peak
 * equaliser, reverb, distortion, pan) as TidalJS controls, the amplitude and
 * pitch envelopes, and which TidalJS control each argument drives, so that
 * a Pbind key like \cutoff becomes .lpf().
 */
import { EnvSpec, GNode, Sym, type SynthDefV, type Value } from "./values.ts";
import type { Graph, Interpreter } from "./interpreter.ts";

/** How an argument of the SynthDef drives a TidalJS control. */
export interface Role {
  control: string;
  fn: (x: number) => number;
  js: (x: string) => string;
}

export interface Fixed {
  control: string;
  value: Value;
  arg?: string;
  /** An LFO inside the synth moves this control during each note (followNote). */
  lfo?: LfoSignal;
  /** An envelope (EnvGen, Line, XLine) inside the synth moves this control during each note (followNote). */
  env?: EnvSignal;
  /** TidalJS code for the value: a live input (MouseX: a slider) or a random value per note (Rand); `during`: it changes during the note (follow). */
  code?: string;
  during?: boolean;
}

/** An envelope as a TidalJS envelope(levels, times, curves): times in seconds. */
export interface EnvSignal {
  levels: number[];
  times: number[];
  curves: (number | string)[];
}

export interface SynthInfo {
  sound: string;
  /** TidalJS has this SynthDef itself (superhoover, supergabber): its internals are not repeated. */
  port: boolean;
  /** Controls with fixed values, in order; `arg` marks the default of an argument (events can change it). */
  fixed: Fixed[];
  /** SuperCollider argument -> TidalJS controls. */
  roles: Map<string, Role[]>;
  /** Argument defaults. */
  defaults: Map<string, Value>;
  /** The factor from SuperCollider's amp to TidalJS's amp. */
  ampScale: number;
  /** Arguments the analysis could not map. */
  unmapped: Set<string>;
  /** Two output channels that differ (SinOsc.ar([1, 3])): their controls, left and right. */
  channels: Fixed[][] | null;
  /** No envelope ends the sound: it plays until it is freed. */
  endless: boolean;
  /**
   * An effect: the signal comes in (In.ar(bus), a JITLib filter's input or \in.ar) instead of from oscillators.
   * `bus` is what In reads (a bus, a number or a control); null for a filter's input.
   */
  input: { bus: Value } | null;
  /** A sample player (PlayBuf, TGrains, GrainBuf, Warp1, BufRd): the buffer it plays (a control, a buffer or a number). */
  sample: { buf: Value; grains: boolean } | null;
  /** Where the main output goes (0, a bus, or the out control), and the other outputs (sends to buses) with their level. */
  mainBus: Value;
  sends: { bus: Value; gain: number }[];
  /** Every output is a control-rate signal (Out.kr): an LFO that writes a control bus, not a sound. */
  control: Value | null;
  summary: string;
  notes: string[];
}

/** TidalJS's own sounds: an instrument with one of these names plays it. */
export const TIDAL_SOUNDS = new Set([
  "bd", "sn", "hh", "oh", "ch", "cp", "cy", "arpy", "sine", "saw", "square", "tri", "noise", "pink",
  "supersaw", "supersquare", "superpwm", "superhoover", "superreese", "superzow", "superchip", "superfm", "superpiano",
  "supergong", "superstatic", "superkick", "super808", "supergabber", "superhat", "supersnare", "superclap", "superfb",
]);

const PORTS: [RegExp, string][] = [[/hoover/i, "superhoover"], [/gabber/i, "supergabber"]];

const BY_NAME: [RegExp, string][] = [
  [/808/, "super808"], [/kick|bassdrum|\bbd\b|kik/i, "superkick"], [/hi-?hat|\bhat|\bhh\b|cymbal/i, "superhat"],
  [/snare|\bsd\b/i, "supersnare"], [/clap/i, "superclap"], [/reese/i, "superreese"], [/piano|rhodes|epiano/i, "superpiano"],
  [/gong/i, "supergong"], [/bell|fm/i, "superfm"], [/pwm/i, "superpwm"], [/chip|8bit|nes/i, "superchip"],
  [/supersaw|trance|pad|string/i, "supersaw"], [/zow/i, "superzow"], [/static|crackle|vinyl/i, "superstatic"],
];

const OSC_SOUND: Record<string, string> = {
  Saw: "saw", LFSaw: "saw", VarSaw: "saw", SyncSaw: "saw", Pulse: "square", LFPulse: "square", Blip: "square",
  SinOsc: "sine", FSinOsc: "sine", LFPar: "sine", LFCub: "sine", LFTri: "tri", PMOsc: "superfm",
  WhiteNoise: "noise", ClipNoise: "noise", GrayNoise: "noise", PinkNoise: "pink", BrownNoise: "pink",
  Klank: "superfm", Ringz: "superfm", Formant: "superfm", Impulse: "noise", Dust: "superstatic",
  // A sine fed back into its phase: TidalJS's superfb.
  SinOscFB: "superfb", GrainSin: "sine", GrainFM: "superfm",
};

/** Controls TidalJS can change during a note (follow, followNote). */
export const FOLLOWABLE = new Set(["lpf", "hpf", "bpf", "resonance", "hpq", "bpq", "pan", "gain", "amp", "freq", "note", "speed", "vib"]);

/** UGens that play a buffer: they become a TidalJS sample bank. */
const SAMPLE_PLAYERS = new Set(["PlayBuf", "TGrains", "GrainBuf", "Warp1", "BufRd"]);

/** Fixed controls an effect synth hands on to the sounds that go through it (not their pitch, length or level). */
const EFFECT_CONTROLS = new Set([
  "lpf", "resonance", "hpf", "hpq", "bpf", "bpq", "peak", "peakq", "peakgain", "freeverb", "freeroom", "freedamp", "room", "size",
  "delay", "delaytime", "delayfeedback", "shape", "crush", "pan", "lpenv", "lpattack", "lpdecay", "lpsustain", "lprelease",
  "hpenv", "hpattack", "hpdecay", "hpsustain", "hprelease", "bpenv", "bpattack", "bpdecay", "bpsustain", "bprelease",
  "peakenv", "peakattack", "peakdecay", "peaksustain", "peakrelease",
]);
export function isEffectControl(control: string): boolean {
  return EFFECT_CONTROLS.has(control);
}

const DRIVE = new Set(["tanh", "distort", "softclip", "atan", "clip2"]);

/** The peak level of TidalJS's synths at amp 0.4 (tidal.js SAMPLE_DEFS), to match SuperCollider's levels. */
export const SOUND_LEVEL: Record<string, number> = {
  bd: 0.95, sn: 0.6, hh: 0.35, cp: 0.55, oh: 0.3, ch: 0.35, cy: 0.25, arpy: 0.35, sine: 0.45, saw: 0.3, square: 0.25,
  tri: 0.45, noise: 0.25, pink: 0.35, supersaw: 0.3, supersquare: 0.22, superpwm: 0.35, superreese: 0.35, superzow: 0.3,
  superchip: 0.3, superfm: 0.4, superstatic: 0.6, superpiano: 0.45, supergong: 0.35, superkick: 0.9, super808: 0.9,
  superhat: 0.3, supersnare: 0.55, superclap: 0.6, superfb: 0.45,
};

/** Low-frequency oscillators that can move a pitch (a vibrato). */
const LFO = new Set(["SinOsc", "FSinOsc", "LFTri", "LFSaw", "LFPar", "LFCub", "LFPulse", "LFNoise0", "LFNoise1", "LFNoise2", "Saw", "Pulse"]);

/** a * control + b, when the expression is that. */
interface Linear { ctrl: GNode; a: number; b: number }

function linear(v: Value): Linear | null {
  if (v instanceof GNode) {
    if (v.kind === "control") return { ctrl: v, a: 1, b: 0 };
    if (v.kind === "unop" && v.name === "neg") {
      const l = linear(v.inputs.a);
      return l && { ctrl: l.ctrl, a: -l.a, b: -l.b };
    }
    if (v.kind === "binop") {
      const { a, b } = v.inputs;
      const op = v.name;
      if (typeof b === "number") {
        const l = linear(a);
        if (!l) return null;
        if (op === "*") return { ctrl: l.ctrl, a: l.a * b, b: l.b * b };
        if (op === "/") return { ctrl: l.ctrl, a: l.a / b, b: l.b / b };
        if (op === "+") return { ctrl: l.ctrl, a: l.a, b: l.b + b };
        if (op === "-") return { ctrl: l.ctrl, a: l.a, b: l.b - b };
      }
      if (typeof a === "number") {
        const l = linear(b);
        if (!l) return null;
        if (op === "*") return { ctrl: l.ctrl, a: l.a * a, b: l.b * a };
        if (op === "+") return { ctrl: l.ctrl, a: l.a, b: l.b + a };
        if (op === "-") return { ctrl: l.ctrl, a: -l.a, b: a - l.b };
      }
    }
  }
  return null;
}

/** Does the signal carry audio (not a control, an envelope or a constant)? */
function audio(v: Value): boolean {
  if (Array.isArray(v)) return v.some(audio);
  if (!(v instanceof GNode)) return false;
  // An audio-rate control is a signal coming in (a filter's input, \in.ar).
  if (v.kind === "control") return v.rate === "ar";
  if (v.kind === "env" || v.kind === "rand") return false;
  if (v.kind === "ugen") {
    if (v.name === "EnvGen" || v.name === "Line" || v.name === "XLine") return false;
    if (v.rate === "kr" || v.rate === "ir") return false;
    return true;
  }
  if (v.kind === "binop") return audio(v.inputs.a) || audio(v.inputs.b);
  if (v.kind === "unop") return audio(v.inputs.a);
  return false;
}

/** The envelope of an envelope generator (possibly scaled by a constant). */
function envOf(v: Value): { env: EnvSpec; node: GNode } | null {
  if (!(v instanceof GNode)) return null;
  if ((v.kind === "env" || (v.kind === "ugen" && v.name === "EnvGen")) && v.inputs.envelope instanceof EnvSpec) return { env: v.inputs.envelope, node: v };
  if (v.kind === "binop" && v.name === "*") {
    if (typeof v.inputs.b === "number") return envOf(v.inputs.a);
    if (typeof v.inputs.a === "number") return envOf(v.inputs.b);
  }
  return null;
}

const first = (v: Value): Value => (Array.isArray(v) ? first(v[0] ?? null) : v);
const numOr = (v: Value, d: number) => (typeof v === "number" ? v : d);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(6))));

export function analyseSynthDef(interp: Interpreter, def: SynthDefV): SynthInfo {
  const port = PORTS.find(([re]) => re.test(def.name));
  const graph = interp.graphOf(def);
  if (!graph) {
    const info = emptyInfo(port);
    info.sound = port ? port[1] : soundByName(def.name) ?? "saw";
    info.summary = "its SynthDef could not be read, so it plays " + info.sound;
    return info;
  }
  const out = graph.output;
  // Only control-rate outputs (Out.kr): an LFO for a control bus.
  if (graph.outs.length > 0 && graph.outs.every((o) => !audio(o.channels))) {
    const info = emptyInfo(port);
    info.control = first(out);
    info.mainBus = graph.mainBus;
    for (const [name, c] of graph.controls) info.defaults.set(name, c.inputs.default ?? 0);
    info.summary = "a control signal";
    return info;
  }
  // Multichannel output: each channel is analysed; when they differ, both are written.
  const stereo = Array.isArray(out) && out.length >= 2 && !port;
  const left = analyseChannel(def, graph, stereo ? (out as Value[])[0] : out, port);
  left.mainBus = graph.mainBus;
  for (const o of graph.outs) {
    if (o.bus === graph.mainBus && o.channels === graph.output) continue;
    left.sends.push({ bus: o.bus, gain: gainOf(o.channels) / (gainOf(graph.output) || 1) });
  }
  if (stereo && !left.input) {
    const right = analyseChannel(def, graph, (out as Value[])[1], port);
    if (left.sound !== right.sound || JSON.stringify(left.fixed) !== JSON.stringify(right.fixed)) {
      left.channels = [left.fixed, right.fixed];
      left.fixed = [];
      left.summary += "; its two channels differ, so it plays twice, panned left and right";
    } else {
      // The same signal on both channels: TidalJS's centre pan is 3 dB down, so it is made up.
      left.ampScale *= Math.SQRT2;
    }
    if ((out as Value[]).length > 2) left.notes.push("\\" + def.name + " has more than two channels: as on a stereo system, only the first two (left and right) are heard");
  }
  // The level when the events do not set amp.
  if (!left.port && !left.input) {
    const ampDefault = left.roles.has("amp") ? numOr(first(left.defaults.get("amp") ?? 1), 1) : 1;
    const amp = round(ampDefault * left.ampScale);
    const where = left.channels ? left.channels : [left.fixed];
    for (const list of where) list.push(left.roles.has("amp") ? { control: "amp", value: amp, arg: "amp" } : { control: "amp", value: amp });
  }
  return left;
}

function emptyInfo(port: [RegExp, string] | undefined): SynthInfo {
  return {
    sound: port ? port[1] : "saw", port: !!port, fixed: [], roles: new Map(), defaults: new Map(), ampScale: 1,
    unmapped: new Set(), summary: "", notes: [], channels: null, endless: false, input: null, sample: null,
    mainBus: 0, sends: [], control: null,
  };
}

/** The constant level of an output: the numbers it is multiplied by. */
function gainOf(v: Value): number {
  v = first(v);
  if (typeof v === "number") return v;
  if (v instanceof GNode && v.kind === "binop" && v.name === "*") {
    if (typeof v.inputs.b === "number") return v.inputs.b * gainOf(v.inputs.a);
    if (typeof v.inputs.a === "number") return v.inputs.a * gainOf(v.inputs.b);
    const d = (x: Value) => (x instanceof GNode && x.kind === "control" && typeof first(x.inputs.default ?? null) === "number" ? first(x.inputs.default) as number : null);
    const k = d(v.inputs.b) ?? d(v.inputs.a);
    if (k !== null) return k;
  }
  return 1;
}

/** Is this where an effect's signal comes in? In.ar(bus), or an audio-rate control (a filter's input, \in.ar). */
function inputOf(v: Value): { bus: Value } | null {
  v = first(v);
  if (v instanceof GNode && v.kind === "ugen" && (v.name === "In" || v.name === "InFeedback")) return { bus: v.inputs.bus ?? 0 };
  if (v instanceof GNode && v.kind === "control" && v.rate === "ar") return { bus: null };
  return null;
}

/** The dry signal of an effect's mix (the input, scaled by constants), or null. */
function dryInput(v: Value): boolean {
  v = first(v);
  if (inputOf(v)) return true;
  if (v instanceof GNode && v.kind === "binop" && v.name === "*") {
    return (typeof v.inputs.b === "number" && dryInput(v.inputs.a)) || (typeof v.inputs.a === "number" && dryInput(v.inputs.b));
  }
  return false;
}

function analyseChannel(def: SynthDefV, graph: Graph, output: Value, port: [RegExp, string] | undefined): SynthInfo {
  const info = emptyInfo(port);
  for (const [name, c] of graph.controls) info.defaults.set(name, c.inputs.default ?? 0);
  let gain = 1;

  const role = (ctrlValue: Value, control: string, fn: (x: number) => number = (x) => x, js: (x: string) => string = (x) => x): boolean => {
    const l = linear(ctrlValue);
    if (!l) return false;
    const { a, b } = l;
    const lin = (x: number) => a * x + b;
    const linJs = (x: string) => (a === 1 && b === 0 ? x : `${a === 1 ? x : fmt(a) + " * " + x}${b ? " + " + fmt(b) : ""}`);
    const list = info.roles.get(l.ctrl.name) ?? [];
    list.push({ control, fn: (x) => fn(lin(x)), js: (x) => js(linJs(x)) });
    info.roles.set(l.ctrl.name, list);
    return true;
  };
  /** A fixed value, or a role with the argument's default as the fixed value. */
  const fix = (control: string, value: Value, arg?: string) => info.fixed.push(arg ? { control, value, arg } : { control, value });
  const set = (v: Value, control: string, fn: (x: number) => number = (x) => x, js?: (x: string) => string) => {
    v = first(v);
    if (typeof v === "number") {
      fix(control, round(fn(v)));
      return;
    }
    const l = linear(v);
    if (l && role(v, control, fn, js)) {
      const d = info.defaults.get(l.ctrl.name);
      if (typeof d === "number") fix(control, round(fn(l.a * d + l.b)), l.ctrl.name);
      return;
    }
    // An LFO (it restarts with each note): followed during the note.
    const lfo = lfoSignalOf(v, (x) => {
      const l = linear(x);
      const d = l ? info.defaults.get(l.ctrl.name) : undefined;
      return l && typeof first(d ?? null) === "number" ? l.a * (first(d ?? null) as number) + l.b : null;
    });
    if (lfo && FOLLOWABLE.has(control)) {
      info.fixed.push({ control, value: round(fn(lfo.exp ? Math.sqrt(lfo.lo * lfo.hi) : (lfo.lo + lfo.hi) / 2)), lfo: mapSignal(lfo, fn) });
      return;
    }
    const resolve = (x: Value) => {
      const l = linear(x);
      const d = l ? info.defaults.get(l.ctrl.name) : undefined;
      return l && typeof first(d ?? null) === "number" ? l.a * (first(d ?? null) as number) + l.b : null;
    };
    // An envelope, Line or XLine (it restarts with each note): followed during the note.
    const env = envSignalOf(v, resolve);
    if (env && FOLLOWABLE.has(control)) {
      const levels = env.levels.map((l) => round(fn(l)));
      if (levels.every(Number.isFinite)) {
        info.fixed.push({ control, value: levels[0], env: { ...env, levels } });
        return;
      }
    }
    // The mouse (MouseX, MouseY, MouseButton): a slider or a switch of the Controls panel.
    const mouse = mouseOf(v);
    if (mouse) {
      const lo = fn(mouse.lo), hi = fn(mouse.hi);
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        const a = round(Math.min(lo, hi)), b = round(Math.max(lo, hi));
        const code = mouse.name === "MouseButton"
          ? 'toggle("mouse button").range(' + fmt(round(lo)) + ", " + fmt(round(hi)) + ")"
          : "slider(" + JSON.stringify(mouse.name === "MouseX" ? "mouse x" : "mouse y") + ", " + fmt(a) + ", " + fmt(a) + ", " + fmt(b) + ")";
        info.fixed.push({ control, value: a, code, during: FOLLOWABLE.has(control) });
        info.notes.push("\\" + def.name + " reads the mouse (" + mouse.name + "): it becomes a " + (mouse.name === "MouseButton" ? "switch" : "slider") + " of the Controls panel" + (mouse.exp ? ", moving in a straight line" : ""));
        return;
      }
    }
    // A random value drawn when the note starts (Rand, ExpRand, IRand): a random value per note.
    const r = first(v);
    if (r instanceof GNode && r.kind === "rand") {
      const lo = typeof first(r.inputs.lo) === "number" ? first(r.inputs.lo) as number : resolve(r.inputs.lo);
      const hi = typeof first(r.inputs.hi) === "number" ? first(r.inputs.hi) as number : resolve(r.inputs.hi);
      if (lo !== null && hi !== null) {
        const a = round(fn(lo)), b = round(fn(hi));
        const code = r.name === "IRand" && Number.isInteger(a) && Number.isInteger(b) && a <= b
          ? "irand(" + fmt(b - a + 1) + ")" + (a ? ".add(" + fmt(a) + ")" : "")
          : r.name === "ExpRand" && a > 0 && b > 0 ? "rand.rangex(" + fmt(a) + ", " + fmt(b) + ")" : "rand.range(" + fmt(a) + ", " + fmt(b) + ")";
        info.fixed.push({ control, value: round((a + b) / 2), code });
        return;
      }
    }
    info.notes.push("the " + control + " of \\" + def.name + " moves in a way TidalJS cannot follow: its start value is used");
  };

  // Walk from the output back through the effects to the oscillators.
  let node: Value = first(output);
  const effects: string[] = [];
  let ampEnv: { env: EnvSpec; node: GNode } | null = null;
  for (let guard = 0; guard < 200; guard++) {
    let stop = false;
    node = first(node);
    if (!(node instanceof GNode)) break;
    const input = inputOf(node);
    if (input) {
      info.input = input;
      break;
    }
    // An effect's mix: the dry input plus the wet signal. The wet one is followed; its effects apply in full.
    if (node.kind === "binop" && node.name === "+" && (dryInput(node.inputs.a) || dryInput(node.inputs.b))) {
      const wet = dryInput(node.inputs.a) ? node.inputs.b : node.inputs.a;
      if (audio(wet)) {
        info.notes.push("\\" + def.name + " mixes its input with the effect: the effect is applied in full");
        node = wet;
        continue;
      }
    }
    if (node.kind === "ugen" && (node.name === "XFade2" || node.name === "LinXFade2")) {
      const [dry, wet] = dryInput(node.inputs.inA ?? null) ? [node.inputs.inA, node.inputs.inB] : [node.inputs.inB, node.inputs.inA];
      void dry;
      info.notes.push("\\" + def.name + " crossfades its input with the effect: the effect is applied in full");
      node = wet ?? null;
      continue;
    }
    if (node.kind === "binop" && node.name === "*") {
      const { a, b } = node.inputs;
      const [sig, mod] = audio(a) && !audio(b) ? [a, b] : audio(b) && !audio(a) ? [b, a] : [null, null];
      if (sig === null) break;
      const env = envOf(mod);
      if (env) {
        if (!ampEnv) ampEnv = env;
        else if (!info.port) info.notes.push("\\" + def.name + " has two amplitude envelopes: the last one is used");
      } else if (typeof mod === "number") {
        gain *= mod;
      } else if (linear(mod)) {
        const l = linear(mod) as Linear;
        if (/^(amp|vol|volume|level|gain)$/.test(l.ctrl.name)) {
          role(l.ctrl, "amp");
          gain *= l.a;
        }
      }
      node = sig;
      continue;
    }
    if (node.kind === "unop" && DRIVE.has(node.name)) {
      if (!info.port) {
        const inner = first(node.inputs.a);
        let drive = 1;
        if (inner instanceof GNode && inner.kind === "binop" && inner.name === "*") drive = numOr(inner.inputs.b, numOr(inner.inputs.a, 1));
        fix("shape", round(Math.min(0.95, drive / (drive + 2))));
        effects.push(node.name);
      }
      node = node.inputs.a;
      continue;
    }
    if (node.kind !== "ugen") break;
    const inp = node.inputs;
    const name = node.name;
    const skipForPort = info.port && (name === "FreeVerb2" || name === "FreeVerb") && /hoover/i.test(def.name);
    if (!skipForPort) {
      switch (name) {
        case "LPF": filter(inp.freq, "lp", "lpf"); break;
        case "RLPF": case "BLowPass": case "BLowPass4":
          filter(inp.freq, "lp", "lpf");
          set(inp.rq ?? 1, "resonance", (rq) => round(Math.log10(1 / rq) / 3), (x) => `Math.log10(1 / ${x}) / 3`);
          break;
        case "MoogFF": filter(inp.freq, "lp", "lpf"); set(inp.gain ?? 2, "resonance", (g) => Math.max(0, Math.min(1, g / 4))); break;
        case "DFM1": filter(inp.freq, "lp", "lpf"); set(inp.res ?? 0.1, "resonance"); break;
        case "HPF": filter(inp.freq, "hp", "hpf"); break;
        case "RHPF": case "BHiPass": case "BHiPass4":
          filter(inp.freq, "hp", "hpf");
          set(inp.rq ?? 1, "hpq", (rq) => round(Math.log10(1 / rq) / 3), (x) => `Math.log10(1 / ${x}) / 3`);
          break;
        case "BPF": case "Resonz":
          filter(inp.freq, "bp", "bpf");
          set(inp.rq ?? inp.bwr ?? 1, "bpq", (rq) => round(1 / rq), (x) => `1 / ${x}`);
          break;
        case "BPeakEQ":
          filter(inp.freq ?? 1200, "peak", "peak");
          set(inp.rq ?? 1, "peakq", (rq) => round(1 / rq), (x) => `1 / ${x}`);
          set(inp.db ?? 0, "peakgain");
          break;
        case "FreeVerb": case "FreeVerb2":
          set(inp.mix ?? 0.33, "freeverb");
          set(inp.room ?? 0.5, "freeroom");
          set(inp.damp ?? 0.5, "freedamp");
          break;
        case "GVerb":
          fix("room", 0.4);
          fix("size", round(Math.min(1, numOr(first(inp.revtime ?? 3), 3) / 10)));
          info.notes.push("GVerb becomes the orbit's reverb (room and size)");
          break;
        case "CombN": case "CombL": case "CombC": {
          const dt = numOr(first(inp.delaytime ?? 0.2), 0.2);
          const decay = numOr(first(inp.decaytime ?? 1), 1);
          fix("delay", 0.5);
          fix("delaytime", round(dt));
          fix("delayfeedback", round(Math.min(0.95, Math.pow(0.001, dt / Math.max(1e-3, decay)))));
          info.notes.push(name + " becomes the orbit's delay");
          break;
        }
        case "Pan2": case "LinPan2": set(inp.pos ?? 0, "pan"); break;
        case "Decimator": set(inp.bits ?? 24, "crush"); break;
        case "Limiter": case "LeakDC": case "Compander": case "OnePole": case "Lag": case "Splay": case "DelayN": case "DelayL": case "DelayC":
        case "AllpassN": case "AllpassL": case "AllpassC": case "Balance2":
          break;
        default:
          // Not an effect: the oscillators start here.
          stop = true;
      }
    }
    if (stop) break;
    if (!skipForPort && !["Limiter", "LeakDC", "Compander", "OnePole", "Lag", "Splay", "DelayN", "DelayL", "DelayC", "AllpassN", "AllpassL", "AllpassC", "Balance2"].includes(name)) effects.push(name);
    node = inp.in ?? inp.inArray ?? inp.left ?? null;
  }

  // The oscillators.
  const oscs = new Map<string, number>();
  let detuned = false;
  let modulated = false;
  const seen = new Set<unknown>();
  const visit = (v: Value) => {
    if (seen.has(v) || v === null || typeof v !== "object") return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach(visit); if (v.filter((x) => x instanceof GNode && x.kind === "ugen" && OSC_SOUND[x.name]).length > 1) detuned = true; return; }
    if (v instanceof GNode) {
      if (v.kind === "ugen" && OSC_SOUND[v.name] && v.rate !== "kr") {
        oscs.set(v.name, (oscs.get(v.name) ?? 0) + 1);
        if (Array.isArray(v.inputs.freq)) detuned = true;
        if ((v.name === "SinOsc" || v.name === "Pulse") && containsOsc(v.name === "Pulse" ? v.inputs.width : v.inputs.freq)) modulated = true;
      }
      Object.values(v.inputs).forEach(visit);
    } else if (v instanceof EnvSpec) {
      Object.values(v.params).forEach(visit);
    }
  };
  visit(node);
  const player = findUgen(node, (g) => SAMPLE_PLAYERS.has(g.name));
  if (info.input) {
    info.sound = "";
  } else if (player && !info.port) {
    // A buffer player: the buffer becomes a sample bank; its rate is the speed, its start the begin.
    const buf = player.inputs.bufnum ?? player.inputs.sndbuf ?? 0;
    info.sample = { buf: first(buf), grains: player.name !== "PlayBuf" && player.name !== "BufRd" };
    info.sound = "";
    if (player.inputs.rate !== undefined) set(player.inputs.rate, "speed");
    const start = first(player.inputs.startPos ?? player.inputs.centerPos ?? player.inputs.pos ?? player.inputs.pointer ?? 0);
    const frac = startFraction(start);
    if (frac) { if (!role(frac.ctrl, "begin", (x) => x * frac.k, (x) => frac.k === 1 ? x : `${x} * ${fmt(frac.k)}`)) info.notes.push("the start of \\" + def.name + " is not converted"); }
    else if (typeof start === "number" && start !== 0) info.notes.push("\\" + def.name + " starts " + fmt(start) + " frames into its buffer: the file's length is not known, so it starts at the beginning");
    if (info.sample.grains) info.notes.push("\\" + def.name + " is granular (" + player.name + "): it plays its buffer as a sample");
    if (numOr(first(player.inputs.loop ?? 0), 0) >= 1) info.notes.push("\\" + def.name + " loops its buffer: here the sample plays once per note");
  } else if (!info.port) info.sound = soundByName(def.name) ?? soundByOscillators(oscs, detuned, modulated);
  if (!info.port && !info.input && !info.sample) fm(node);
  if (info.sound === "superfb") {
    // SinOscFB's feedback (0 to about 1.5) is superfb's voice (0 to 1).
    const fb = findUgen(node, (g) => g.name === "SinOscFB");
    if (fb) set(fb.inputs.feedback ?? 0, "voice", (x) => Math.max(0, Math.min(1, x / 1.5)), (x) => `Math.max(0, Math.min(1, ${x} / 1.5))`);
  }
  if (findUgen(node, (g) => g.name === "LocalIn" || g.name === "InFeedback")) info.notes.push("\\" + def.name + " feeds its output back into itself (LocalIn): the feedback is left out");

  // The pitch: how the freq argument reaches the oscillators.
  if ((!info.port || /gabber/i.test(def.name)) && !info.input && !info.sample) pitch(output);

  // The amplitude envelope; without one that ends, the synth plays until it is freed.
  if (ampEnv && !info.port) envelope(ampEnv);
  const done = (e: { node: GNode } | null) => e !== null && numOr(first(e.node.inputs.doneAction ?? 0), 0) >= 2;
  // A sustaining envelope (asr, adsr, a release node) opened by a gate argument also plays until something closes it.
  const gate = ampEnv ? first(ampEnv.node.inputs.gate ?? null) : null;
  const sustaining = ampEnv !== null && (["asr", "adsr", "dadsr"].includes(ampEnv.env.shape) || (ampEnv.env.releaseNode !== null && ampEnv.env.releaseNode !== undefined))
    && gate instanceof GNode && gate.kind === "control";
  info.endless = !info.port && !info.input && ((!done(ampEnv) && !hasDoneAction(output)) || sustaining);

  // SuperCollider's level, as TidalJS's amp for this synth (a sample plays at amp 1 at full level).
  if (!info.port) info.ampScale = info.sample ? gain * 0.4 : (gain * 0.4) / (SOUND_LEVEL[info.sound] ?? 0.35);

  // Arguments nothing uses as a TidalJS control.
  for (const name of graph.controls.keys()) {
    if (!info.roles.has(name) && !["freq", "gate", "out", "amp", "pan", "sustain", "dur", "bus", "outBus", "i_out"].includes(name)) info.unmapped.add(name);
  }
  if (info.roles.has("amp") === false && graph.controls.has("amp")) info.roles.set("amp", [{ control: "amp", fn: (x) => x, js: (x) => x }]);

  const list = unique(effects.reverse());
  const named = list.length > 1 ? list.slice(0, -1).join(", ") + " and " + list[list.length - 1] : list[0];
  if (info.input) {
    info.summary = "an effect" + (list.length ? ": its " + named + (list.length > 1 ? " become" : " becomes") + " effects of what goes through it" : " TidalJS has nothing for");
    return info;
  }
  info.summary = (info.sample ? "a sample player" : info.sound + ", " + (info.port ? "TidalJS's port of this SynthDef" : "the closest TidalJS synth"))
    + (list.length ? "; its " + named + (list.length > 1 ? " become" : " becomes") + " effects" : "");
  return info;

  /** Two-operator FM (a sine whose frequency a sine moves): superfm, with the ratio as semitone and the index as voice. */
  function fm(signal: Value) {
    const pm = findUgen(signal, (g) => g.name === "PMOsc" && g.rate !== "kr");
    if (pm) {
      const car = linear(first(pm.inputs.carfreq ?? null));
      const mod = linear(first(pm.inputs.modfreq ?? null));
      const ratio = car && mod && car.ctrl === mod.ctrl && car.b === 0 && mod.b === 0 ? mod.a / car.a : null;
      if (ratio && ratio > 0) fix("semitone", round(12 * Math.log2(ratio)));
      const index = first(pm.inputs.pmindex ?? 0);
      if (typeof index === "number") fix("voice", round(Math.min(1, index / 8)));
      else set(index, "voice", (x) => Math.min(1, x / 8), (x) => `Math.min(1, ${x} / 8)`);
      info.sound = "superfm";
      return;
    }
    const carrier = findUgen(signal, (g) => (g.name === "SinOsc" || g.name === "FSinOsc") && g.rate !== "kr" && first(g.inputs.freq ?? null) instanceof GNode && (first(g.inputs.freq ?? null) as GNode).kind === "binop" && (first(g.inputs.freq ?? null) as GNode).name === "+");
    if (!carrier) return;
    const sum = first(carrier.inputs.freq ?? null) as GNode;
    const [base, mod] = linear(sum.inputs.a) ? [linear(sum.inputs.a)!, first(sum.inputs.b)] : linear(sum.inputs.b) ? [linear(sum.inputs.b)!, first(sum.inputs.a)] : [null, null];
    if (!base || !(mod instanceof GNode) || mod.kind !== "binop" || mod.name !== "*") return;
    // The modulator times its depth: a sine, numbers, and at most the freq control.
    const factors = productFactors(mod);
    const oscSide = factors.find(isAudioSine);
    if (!(oscSide instanceof GNode)) return;
    const others = factors.filter((f) => f !== oscSide);
    let k = 1;
    let byFreq = false;
    for (const f of others) {
      const x = first(f);
      const l = linear(x);
      if (typeof x === "number") k *= x;
      else if (l && l.ctrl === base.ctrl && l.b === 0 && !byFreq) { k *= l.a; byFreq = true; }
      else return;
    }
    const modFreq = linear(first(oscSide.inputs.freq ?? null));
    if (!modFreq || modFreq.ctrl !== base.ctrl || modFreq.b !== 0) return;
    const ratio = modFreq.a / base.a;
    const freqDefault = numOr(first(info.defaults.get(base.ctrl.name) ?? 440), 440);
    // The index is the depth in Hz over the modulator's frequency.
    const index = byFreq ? k / base.a / ratio : k / (freqDefault * ratio);
    info.sound = "superfm";
    if (ratio > 0) fix("semitone", round(12 * Math.log2(ratio)));
    fix("voice", round(Math.max(0, Math.min(1, index / 8))));
    if (index > 8) info.notes.push("the FM index of \\" + def.name + " (" + fmt(index) + ") is above what superfm reaches (8)");
    if (!byFreq) info.notes.push("the FM depth of \\" + def.name + " is fixed in Hz: its index is taken at the default frequency");
  }

  // ---- helpers that write into info

  function filter(freq: Value, prefix: string, control: string) {
    freq = first(freq);
    const env = filterEnv(freq);
    if (env) {
      set(env.base, control);
      fix(prefix + "env", round(env.amount));
      fix(prefix + "attack", round(env.attack));
      if (env.decay !== null) {
        fix(prefix + "decay", round(env.decay));
        fix(prefix + "sustain", round(env.sustain));
      }
      fix(prefix + "release", round(env.release));
      return;
    }
    set(freq, control);
  }

  function pitch(out: Value) {
    const oscFreq = findOscFreq(out);
    if (!oscFreq) {
      // No freq argument: an oscillator at a fixed frequency, or one an LFO moves.
      const osc = findOsc(out);
      const f = osc ? first(osc.inputs.freq ?? osc.inputs.carfreq ?? null) : null;
      if (info.port) return;
      if (typeof f === "number") { fix("freq", round(f)); return; }
      const lfo = lfoSweep(f);
      if (lfo) {
        fix("freq", round(lfo.center));
        if (lfo.rateMod) info.fixed.push({ control: "vib", value: round(lfo.rate), lfo: lfo.rateMod });
        else fix("vib", round(lfo.rate));
        fix("vibmod", round(lfo.depth));
        if (lfo.note) info.notes.push(lfo.note);
      }
      return;
    }
    const f = first(oscFreq);
    if (!(f instanceof GNode) || f.kind !== "binop" || f.name !== "*") return;
    const [base, mult] = linear(f.inputs.a) ? [f.inputs.a, f.inputs.b] : linear(f.inputs.b) ? [f.inputs.b, f.inputs.a] : [null, null];
    if (base === null) return;
    const m = first(mult);
    // freq * Rand(lo, hi): each note slightly out of tune, at random.
    if (!info.port && m instanceof GNode && m.kind === "rand" && m.name !== "IRand") {
      const lo = numOr(first(m.inputs.lo ?? 1), 1), hi = numOr(first(m.inputs.hi ?? 1), 1);
      if (lo > 0 && hi > 0) fix("pitchrand", [round(12 * Math.log2(lo)), round(12 * Math.log2(hi))]);
      return;
    }
    // freq * lfo.exprange(a, b), freq * (lfo * k).midiratio: a vibrato around the note.
    const ratio = lfoSweep(m) ?? lfoMidiratio(m);
    if (ratio && !info.port) {
      if (ratio.rateMod) info.fixed.push({ control: "vib", value: round(ratio.rate), lfo: ratio.rateMod });
      else fix("vib", round(ratio.rate));
      fix("vibmod", round(ratio.depth));
      if (Math.abs(ratio.center - 1) > 1e-6) info.notes.push("\\" + def.name + " moves its pitch around " + fmt(12 * Math.log2(ratio.center)) + " semitones from the note: the vibrato is centred on the note");
      if (ratio.note) info.notes.push(ratio.note);
      return;
    }
    if (m instanceof GNode && m.kind === "unop" && m.name === "midiratio") {
      // freq * (Env(...) * depth).midiratio
      const { env, depth, ctrl } = scaledEnv(m.inputs.a);
      if (!env) return;
      if (env.env.shape === "perc") {
        const depthValue = depth;
        if (ctrl) {
          role(ctrl.value, "penv", (x) => x * depthValue, (x) => `${x} * ${fmt(depthValue)}`);
          const d = info.defaults.get(ctrl.name);
          // A port has the same sweep built in: only what the events change is written.
          if (typeof d === "number" && !info.port) fix("penv", round(d * depth), ctrl.name);
        } else if (!info.port) fix("penv", round(depth));
        if (!info.port) {
          fix("pattack", round(numOr(first(env.env.params.attackTime), 0.01)));
          fix("pdecay", round(numOr(first(env.env.params.releaseTime), 1)));
          const c = env.env.params.curve;
          if (typeof c === "number") fix("pcurve", c);
        }
        return;
      }
      if (!info.port && depth !== 0) {
        const levels = env.env.levels.map((l) => round(numOr(first(l), 0) * depth));
        const times = env.env.times.map((t) => round(numOr(first(t), 0)));
        const curves = Array.isArray(env.env.curves) ? env.env.curves.map(curveName) : [curveName(env.env.curves)];
        fix("pitchenv", [levels, times, curves]);
      }
      return;
    }
    if (!info.port && m instanceof GNode && m.kind === "ugen" && (m.name === "XLine" || m.name === "Line")) {
      const a = numOr(first(m.inputs.start ?? 1), 1);
      const b = numOr(first(m.inputs.end ?? 1), 1);
      const t = numOr(first(m.inputs.dur ?? 1), 1);
      if (a > 0 && b > 0) fix("pitchenv", [[round(12 * Math.log2(a)), round(12 * Math.log2(b))], [round(t)], ["lin"]]);
      return;
    }
    // freq * an envelope of ratios (Env([2, 1], [0.1])): a pitch envelope in semitones.
    const ratioEnv = !info.port ? envSignalOf(m, () => null) : null;
    if (ratioEnv && ratioEnv.levels.every((l) => l > 0)) {
      fix("pitchenv", [ratioEnv.levels.map((l) => round(12 * Math.log2(l))), ratioEnv.times.map(round), ratioEnv.curves.map((c) => (c === "exp" ? "lin" : c))]);
    }
  }

  function envelope({ env, node: envNode }: { env: EnvSpec; node: GNode }) {
    const p = env.params;
    if (envNode.inputs.timeScale instanceof GNode) info.notes.push("the envelope of \\" + def.name + " is scaled by an argument: its default is used");
    switch (env.shape) {
      case "perc": case "triangle": case "sine":
        set(p.attackTime, "attack");
        fix("hold", 0);
        set(p.releaseTime, "release");
        break;
      case "adsr":
        set(p.attackTime, "attack");
        set(p.decayTime, "decay");
        set(p.sustainLevel, "sustainlevel");
        set(p.releaseTime, "release");
        break;
      case "asr":
        set(p.attackTime, "attack");
        set(p.releaseTime, "release");
        break;
      case "linen":
        set(p.attackTime, "attack");
        set(p.sustainTime, "hold");
        set(p.releaseTime, "release");
        break;
      default: {
        const times = env.times.map((t) => numOr(first(t), 0));
        if (times.length === 0) break;
        fix("attack", round(times[0]));
        if (env.releaseNode === null) {
          fix("hold", 0);
          fix("release", round(times.slice(1).reduce((s, t) => s + t, 0)));
        } else fix("release", round(times[times.length - 1]));
        info.notes.push("the envelope of \\" + def.name + " is approximated by attack and release");
      }
    }
  }
}

/** An oscillator's frequency swept by an LFO: its centre (geometric), rate and depth in semitones each way. */
function lfoSweep(v: Value): { center: number; rate: number; depth: number; note?: string; rateMod?: LfoSignal } | null {
  v = first(v);
  if (!(v instanceof GNode)) return null;
  const lfoOf = (x: Value): { rate: number; shape: string; rateMod?: LfoSignal } | null => {
    x = first(x);
    if (x instanceof GNode && x.kind === "ugen" && LFO.has(x.name)) {
      const rate = first(x.inputs.freq ?? null);
      if (typeof rate === "number" && rate < 50) return { rate, shape: x.name };
      // A vibrato whose speed an LFO moves.
      const mod = lfoSignalOf(x.inputs.freq ?? null, () => null);
      if (mod && mod.hi < 50 && mod.lo >= 0) return { rate: meanOf(mod), shape: x.name, rateMod: mod };
    }
    return null;
  };
  let lo: number | null = null;
  let hi: number | null = null;
  let lfo: { rate: number; shape: string; rateMod?: LfoSignal } | null = null;
  let linearSweep = false;
  if (v.kind === "unop" && (v.name === "exprange" || v.name === "range")) {
    lfo = lfoOf(v.inputs.a);
    lo = numOr(first(v.inputs.lo), NaN);
    hi = numOr(first(v.inputs.hi), NaN);
    linearSweep = v.name === "range";
  } else if (v.kind === "binop" && v.name === "+") {
    // centre + lfo * depth (SinOsc.kr(rate, 0, depth, centre))
    for (const [c, rest] of [[v.inputs.a, v.inputs.b], [v.inputs.b, v.inputs.a]] as [Value, Value][]) {
      const r = first(rest);
      if (typeof c !== "number" || !(r instanceof GNode) || r.kind !== "binop" || r.name !== "*") continue;
      const k = typeof r.inputs.b === "number" ? r.inputs.b : typeof r.inputs.a === "number" ? r.inputs.a : null;
      const l = lfoOf(typeof r.inputs.b === "number" ? r.inputs.a : r.inputs.b);
      if (k !== null && l) { lfo = l; lo = c - Math.abs(k); hi = c + Math.abs(k); linearSweep = true; }
    }
  }
  if (!lfo || lo === null || hi === null || !(lo > 0) || !(hi > lo)) return null;
  const notes: string[] = [];
  if (lfo.shape !== "SinOsc" && lfo.shape !== "FSinOsc") notes.push("a " + lfo.shape + " moving the pitch becomes a sine vibrato");
  if (linearSweep) notes.push("a pitch sweep that is linear in Hz becomes a vibrato in semitones (the same range, a slightly different curve)");
  return { center: Math.sqrt(lo * hi), rate: lfo.rate, depth: (12 * Math.log2(hi / lo)) / 2, note: notes.join("; ") || undefined, rateMod: lfo.rateMod };
}

/** (lfo * k).midiratio: a vibrato of k semitones. */
function lfoMidiratio(v: Value): { center: number; rate: number; depth: number; note?: string; rateMod?: LfoSignal } | null {
  if (!(v instanceof GNode) || v.kind !== "unop" || v.name !== "midiratio") return null;
  const x = first(v.inputs.a);
  if (!(x instanceof GNode) || x.kind !== "binop" || x.name !== "*") return null;
  const k = typeof x.inputs.b === "number" ? x.inputs.b : typeof x.inputs.a === "number" ? x.inputs.a : null;
  const l = first(typeof x.inputs.b === "number" ? x.inputs.a : x.inputs.b);
  if (k === null || !(l instanceof GNode) || l.kind !== "ugen" || !LFO.has(l.name)) return null;
  const rate = first(l.inputs.freq ?? null);
  if (typeof rate !== "number") {
    const mod = lfoSignalOf(l.inputs.freq ?? null, () => null);
    return mod && mod.lo >= 0 ? { center: 1, rate: meanOf(mod), depth: Math.abs(k), rateMod: mod } : null;
  }
  return { center: 1, rate, depth: Math.abs(k) };
}

/** The first UGen of a signal that matches. */
function findUgen(v: Value, test: (g: GNode) => boolean, seen = new Set<unknown>()): GNode | null {
  if (v === null || typeof v !== "object" || seen.has(v)) return null;
  seen.add(v);
  if (Array.isArray(v)) {
    for (const x of v) { const r = findUgen(x, test, seen); if (r) return r; }
    return null;
  }
  if (v instanceof GNode) {
    if (v.kind === "ugen" && test(v)) return v;
    for (const x of Object.values(v.inputs)) { const r = findUgen(x, test, seen); if (r) return r; }
  }
  return null;
}

/** The factors of a product (a * b * c). */
function productFactors(v: Value): Value[] {
  v = first(v);
  if (v instanceof GNode && v.kind === "binop" && v.name === "*") return [...productFactors(v.inputs.a), ...productFactors(v.inputs.b)];
  return [v];
}

function isAudioSine(v: Value): boolean {
  const x = first(v);
  return x instanceof GNode && x.kind === "ugen" && (x.name === "SinOsc" || x.name === "FSinOsc") && x.rate !== "kr";
}

/** control * BufFrames.kr(buf) (a start as a fraction of the buffer): the control and its factor. */
function startFraction(v: Value): { ctrl: GNode; k: number } | null {
  if (!(v instanceof GNode) || v.kind !== "binop" || v.name !== "*") return null;
  const frames = (x: Value) => { x = first(x); return x instanceof GNode && x.kind === "ugen" && (x.name === "BufFrames" || x.name === "BufSamples"); };
  const other = frames(v.inputs.a) ? v.inputs.b : frames(v.inputs.b) ? v.inputs.a : null;
  if (other === null) return null;
  const l = linear(first(other));
  return l && l.b === 0 ? { ctrl: l.ctrl, k: l.a } : null;
}

/** A control signal (an LFO), as a TidalJS signal: its shape, rate in Hz and range. */
export interface LfoSignal {
  shape: string;
  /** Hz; when another LFO moves it (rateMod), its average. */
  rate: number;
  /** The range; when an LFO moves a bound (loMod, hiMod), its average. */
  lo: number;
  hi: number;
  exp: boolean;
  /** An LFO that moves this one's speed (Hz) or the bounds of its range. */
  rateMod?: LfoSignal;
  loMod?: LfoSignal;
  hiMod?: LfoSignal;
}

/** The average of a signal: the middle of its range (geometric for an exponential one). */
export function meanOf(l: LfoSignal): number {
  return l.exp && l.lo > 0 && l.hi > 0 ? Math.sqrt(l.lo * l.hi) : (l.lo + l.hi) / 2;
}

/** A signal with its values passed through fn (its moving bounds too); lo stays below hi. */
export function mapSignal(l: LfoSignal, fn: (x: number) => number): LfoSignal {
  const a = fn(l.lo), b = fn(l.hi);
  const swap = a > b;
  const loMod = l.loMod ? mapSignal(l.loMod, fn) : undefined;
  const hiMod = l.hiMod ? mapSignal(l.hiMod, fn) : undefined;
  const out: LfoSignal = { shape: l.shape, rate: l.rate, lo: round(Math.min(a, b)), hi: round(Math.max(a, b)), exp: l.exp };
  if (l.rateMod) out.rateMod = l.rateMod;
  const lm = swap ? hiMod : loMod, hm = swap ? loMod : hiMod;
  if (lm) out.loMod = lm;
  if (hm) out.hiMod = hm;
  return out;
}

/** Reads an LFO: lfo.range(lo, hi), lfo.exprange(lo, hi), centre + lfo * depth, or lfo * k + c; `value` resolves arguments. */
export function lfoSignalOf(v: Value, value: (x: Value) => number | null, depth = 0): LfoSignal | null {
  v = first(v);
  if (depth > 4) return null;
  const num = (x: Value) => (typeof first(x) === "number" ? first(x) as number : value(first(x)));
  const lfoOf = (x: Value): { shape: string; rate: number; rateMod?: LfoSignal } | null => {
    x = first(x);
    if (x instanceof GNode && x.kind === "ugen" && LFO.has(x.name)) {
      const rate = num(x.inputs.freq ?? 1);
      if (rate !== null) return { shape: x.name, rate };
      // Its speed moved by another LFO (SinOsc.kr(LFTri.kr(0.1).range(1, 8))).
      const mod = lfoSignalOf(x.inputs.freq ?? null, value, depth + 1);
      if (mod && mod.lo >= 0) return { shape: x.name, rate: meanOf(mod), rateMod: mod };
    }
    return null;
  };
  /** A bound of a range: a number, or an LFO that moves it (its average, and the LFO). */
  const bound = (x: Value, d: number): { n: number; mod?: LfoSignal } | null => {
    const n = num(x ?? d);
    if (n !== null) return { n };
    const mod = lfoSignalOf(x, value, depth + 1);
    return mod ? { n: meanOf(mod), mod } : null;
  };
  const ranged = (l: { shape: string; rate: number; rateMod?: LfoSignal }, lo: { n: number; mod?: LfoSignal } | null, hi: { n: number; mod?: LfoSignal } | null, exp: boolean): LfoSignal | null => {
    if (!lo || !hi) return null;
    const out: LfoSignal = { ...l, lo: lo.n, hi: hi.n, exp };
    if (lo.mod) out.loMod = lo.mod;
    if (hi.mod) out.hiMod = hi.mod;
    return out;
  };
  const bare = lfoOf(v);
  if (bare) return { ...bare, lo: -1, hi: 1, exp: false };
  if (!(v instanceof GNode)) return null;
  if (v.kind === "unop" && ["range", "exprange", "unipolar", "bipolar", "linlin", "linexp"].includes(v.name)) {
    const l = lfoOf(v.inputs.a);
    if (!l) return null;
    if (v.name === "unipolar") return { ...l, lo: 0, hi: num(v.inputs.lo) ?? 1, exp: false };
    if (v.name === "bipolar") return { ...l, lo: -(num(v.inputs.lo) ?? 1), hi: num(v.inputs.lo) ?? 1, exp: false };
    if (v.name === "linlin" || v.name === "linexp") return ranged(l, bound(v.inputs.outMin ?? 0, 0), bound(v.inputs.outMax ?? 1, 1), v.name === "linexp");
    return ranged(l, bound(v.inputs.lo ?? 0, 0), bound(v.inputs.hi ?? 1, 1), v.name === "exprange");
  }
  if (v.kind === "binop" && (v.name === "+" || v.name === "*")) {
    // lfo * k + c, or k * lfo
    const parts = (x: Value): { lfo: LfoSignal; k: number; c: number } | null => {
      x = first(x);
      const l = lfoSignalOf(x, value, depth + 1);
      if (l && !l.exp) return { lfo: l, k: 1, c: 0 };
      if (x instanceof GNode && x.kind === "binop" && x.name === "*") {
        const k = num(x.inputs.b) ?? num(x.inputs.a);
        const inner = num(x.inputs.b) !== null ? x.inputs.a : x.inputs.b;
        const p = k !== null ? parts(inner) : null;
        return p && k !== null ? { lfo: p.lfo, k: p.k * k, c: p.c * k } : null;
      }
      if (x instanceof GNode && x.kind === "binop" && x.name === "+") {
        const c = num(x.inputs.b) ?? num(x.inputs.a);
        const inner = num(x.inputs.b) !== null ? x.inputs.a : x.inputs.b;
        const p = c !== null ? parts(inner) : null;
        return p && c !== null ? { lfo: p.lfo, k: p.k, c: p.c + c } : null;
      }
      return null;
    };
    const p = parts(v);
    if (!p) return null;
    const k = p.k, c = p.c;
    return mapSignal(p.lfo, (x) => x * k + c);
  }
  return null;
}

/** The mouse as a UGen: MouseX.kr(lo, hi, warp), MouseY, MouseButton.kr(lo, hi). */
function mouseOf(v: Value): { name: string; lo: number; hi: number; exp: boolean } | null {
  v = first(v);
  if (!(v instanceof GNode) || v.kind !== "ugen" || !["MouseX", "MouseY", "MouseButton"].includes(v.name)) return null;
  const lo = numOr(first(v.inputs.minval ?? 0), 0);
  const hi = numOr(first(v.inputs.maxval ?? 1), 1);
  const warp = first(v.inputs.warp ?? 0);
  const exp = warp === 1 || (warp instanceof Sym && warp.name.startsWith("exp"));
  return { name: v.name, lo, hi, exp };
}

/** A curve of an envelope as TidalJS's envelope() takes it: a number or a name. */
function envCurve(c: Value): number | string {
  c = first(c);
  if (typeof c === "number") return c;
  if (c instanceof Sym || typeof c === "string") {
    const name = c instanceof Sym ? c.name : c;
    const names: Record<string, string> = { linear: "lin", lin: "lin", exponential: "exp", exp: "exp", sine: "sin", sin: "sin", step: "step", welch: "wel", wel: "wel", squared: "sqr", sqr: "sqr", cubed: "cub", cub: "cub", hold: "hold" };
    return names[name] ?? "lin";
  }
  return "lin";
}

/**
 * An envelope that moves a control during each note, as levels, times (seconds) and curves: EnvGen of an Env
 * (up to its release node: TidalJS cannot know when the note is let go), Line and XLine, scaled and offset
 * by numbers (or arguments, through `value`), or put in a range (range, exprange, linlin, linexp).
 */
export function envSignalOf(v: Value, value: (x: Value) => number | null): EnvSignal | null {
  v = first(v);
  const num = (x: Value) => (typeof first(x) === "number" ? first(x) as number : value(first(x)));
  if (!(v instanceof GNode)) return null;
  if (v.kind === "ugen" && (v.name === "Line" || v.name === "XLine")) {
    const a = num(v.inputs.start ?? (v.name === "XLine" ? 1 : 0)), b = num(v.inputs.end ?? (v.name === "XLine" ? 2 : 1)), d = num(v.inputs.dur ?? 1);
    if (a === null || b === null || d === null) return null;
    const exp = v.name === "XLine" && a * b > 0;
    return { levels: [a, b], times: [Math.max(0, d)], curves: [exp ? "exp" : "lin"] };
  }
  if ((v.kind === "env" || (v.kind === "ugen" && v.name === "EnvGen")) && v.inputs.envelope instanceof EnvSpec) {
    const env = v.inputs.envelope;
    let levels = env.levels.map(num);
    let times = env.times.map(num);
    if (levels.some((l) => l === null) || times.some((t) => t === null) || levels.length < 2) return null;
    const curves = Array.isArray(env.curves) ? env.curves.map(envCurve) : [envCurve(env.curves ?? null)];
    if (env.releaseNode !== null && env.releaseNode !== undefined && env.releaseNode >= 0 && env.releaseNode < levels.length - 1) {
      levels = levels.slice(0, env.releaseNode + 1);
      times = times.slice(0, env.releaseNode);
    }
    const scale = num(v.inputs.levelScale ?? 1) ?? 1, bias = num(v.inputs.levelBias ?? 0) ?? 0, ts = num(v.inputs.timeScale ?? 1) ?? 1;
    const ls = (levels as number[]).map((l) => l * scale + bias);
    const tt = (times as number[]).map((t) => Math.max(0, t * ts));
    if (ls.length === 1) return { levels: [ls[0], ls[0]], times: [0], curves: ["lin"] };
    return { levels: ls, times: tt, curves: tt.map((_, i) => curves[i % curves.length]) };
  }
  if (v.kind === "unop" && ["range", "exprange", "linlin", "linexp", "unipolar", "bipolar"].includes(v.name)) {
    const inner = envSignalOf(v.inputs.a, value);
    if (!inner) return null;
    const map = (fn: (l: number) => number) => ({ ...inner, levels: inner.levels.map(fn) });
    if (v.name === "unipolar" || v.name === "bipolar") return inner;
    if (v.name === "linlin" || v.name === "linexp") {
      const i0 = num(v.inputs.inMin ?? 0), i1 = num(v.inputs.inMax ?? 1), o0 = num(v.inputs.outMin ?? 0), o1 = num(v.inputs.outMax ?? 1);
      if (i0 === null || i1 === null || o0 === null || o1 === null || i1 === i0) return null;
      return map((l) => {
        const u = (l - i0) / (i1 - i0);
        return v.name === "linexp" && o0 > 0 && o1 > 0 ? o0 * Math.pow(o1 / o0, u) : o0 + u * (o1 - o0);
      });
    }
    const lo = num(v.inputs.lo ?? 0), hi = num(v.inputs.hi ?? 1);
    if (lo === null || hi === null) return null;
    return map((l) => (v.name === "exprange" && lo > 0 && hi > 0 ? lo * Math.pow(hi / lo, l) : lo + l * (hi - lo)));
  }
  if (v.kind === "binop" && ["*", "+", "-", "/"].includes(v.name)) {
    for (const [e, k, left] of [[v.inputs.a, v.inputs.b, true], [v.inputs.b, v.inputs.a, false]] as [Value, Value, boolean][]) {
      const c = num(k);
      if (c === null) continue;
      const inner = envSignalOf(e, value);
      if (!inner) continue;
      const fn = v.name === "*" ? (l: number) => l * c : v.name === "+" ? (l: number) => l + c
        : v.name === "-" ? (left ? (l: number) => l - c : (l: number) => c - l) : left ? (l: number) => l / c : (l: number) => (l === 0 ? NaN : c / l);
      const levels = inner.levels.map(fn);
      if (!levels.every(Number.isFinite)) return null;
      return { ...inner, levels };
    }
  }
  return null;
}

/** The first audio-rate oscillator of a signal. */
function findOsc(v: Value, seen = new Set<unknown>()): GNode | null {
  if (v === null || typeof v !== "object" || seen.has(v)) return null;
  seen.add(v);
  if (Array.isArray(v)) {
    for (const x of v) { const r = findOsc(x, seen); if (r) return r; }
    return null;
  }
  if (v instanceof GNode) {
    if (v.kind === "ugen" && OSC_SOUND[v.name] && v.rate !== "kr") return v;
    for (const x of Object.values(v.inputs)) { const r = findOsc(x, seen); if (r) return r; }
  }
  return null;
}

/** Does any envelope, Line or XLine free the synth (doneAction 2 or more)? */
function hasDoneAction(v: Value, seen = new Set<unknown>()): boolean {
  if (v === null || typeof v !== "object" || seen.has(v)) return false;
  seen.add(v);
  if (Array.isArray(v)) return v.some((x) => hasDoneAction(x, seen));
  if (v instanceof GNode) {
    if ((v.kind === "env" || v.kind === "ugen") && numOr(first(v.inputs.doneAction ?? 0), 0) >= 2) return true;
    return Object.values(v.inputs).some((x) => hasDoneAction(x, seen));
  }
  return false;
}

function scaledEnv(v: Value): { env: { env: EnvSpec; node: GNode } | null; depth: number; ctrl: { name: string; value: Value } | null } {
  // Products of an envelope, constants and at most one control.
  let depth = 1;
  let env: { env: EnvSpec; node: GNode } | null = null;
  let ctrl: { name: string; value: Value } | null = null;
  const walk = (x: Value): boolean => {
    x = first(x);
    if (typeof x === "number") { depth *= x; return true; }
    if (x instanceof GNode && x.kind === "binop" && x.name === "*") return walk(x.inputs.a) && walk(x.inputs.b);
    const e = envOf(x);
    if (e && !env) { env = e; return true; }
    if (x instanceof GNode && x.kind === "control" && !ctrl) { ctrl = { name: x.name, value: x }; return true; }
    return false;
  };
  if (!walk(v)) return { env: null, depth: 0, ctrl: null };
  return { env, depth, ctrl };
}

/** The base frequency and envelope of a filter whose frequency moves. */
function filterEnv(v: Value): { base: Value; amount: number; attack: number; decay: number | null; sustain: number; release: number } | null {
  if (!(v instanceof GNode)) return null;
  // base * XLine(start, end, dur) or base * Line(...)
  if (v.kind === "binop" && v.name === "*") {
    for (const [base, mod] of [[v.inputs.a, v.inputs.b], [v.inputs.b, v.inputs.a]] as [Value, Value][]) {
      const m = first(mod);
      if (m instanceof GNode && m.kind === "ugen" && (m.name === "XLine" || m.name === "Line")) {
        const a = numOr(first(m.inputs.start ?? 1), 1);
        const b = numOr(first(m.inputs.end ?? 1), 1);
        const t = numOr(first(m.inputs.dur ?? 1), 1);
        if (a <= 0 || b <= 0) return null;
        // XLine stays at its end: the release is long enough not to come back during the note.
        const startBase = typeof base === "number" ? base * a : a === 1 ? base : null;
        if (startBase === null) return null;
        return { base: startBase, amount: Math.log2(b / a), attack: t, decay: null, sustain: 1, release: 60 };
      }
    }
  }
  // env.range(lo, hi) / env.exprange(lo, hi)
  if (v.kind === "unop" && (v.name === "range" || v.name === "exprange")) {
    const e = envOf(v.inputs.a);
    const lo = numOr(first(v.inputs.lo), 0);
    const hi = numOr(first(v.inputs.hi), 1);
    if (e && lo > 0 && hi > 0) return envShape(e.env, lo, Math.log2(hi / lo));
  }
  // lo + (env * k)
  if (v.kind === "binop" && v.name === "+") {
    for (const [lo, rest] of [[v.inputs.a, v.inputs.b], [v.inputs.b, v.inputs.a]] as [Value, Value][]) {
      if (typeof lo !== "number" || lo <= 0) continue;
      const r = first(rest);
      if (r instanceof GNode && r.kind === "binop" && r.name === "*") {
        const k = typeof r.inputs.b === "number" ? r.inputs.b : typeof r.inputs.a === "number" ? r.inputs.a : null;
        const e = envOf(typeof r.inputs.b === "number" ? r.inputs.a : r.inputs.b);
        if (k !== null && e) return envShape(e.env, lo, Math.log2((lo + k) / lo));
      }
    }
  }
  return null;
}

function envShape(env: EnvSpec, base: number, amount: number) {
  const p = env.params;
  const n = (v: Value, d: number) => numOr(first(v ?? d), d);
  switch (env.shape) {
    case "perc": return { base, amount, attack: n(p.attackTime, 0.01), decay: n(p.releaseTime, 1), sustain: 0, release: n(p.releaseTime, 1) };
    case "adsr": return { base, amount, attack: n(p.attackTime, 0.01), decay: n(p.decayTime, 0.3), sustain: n(p.sustainLevel, 0.5), release: n(p.releaseTime, 1) };
    case "asr": return { base, amount, attack: n(p.attackTime, 0.01), decay: null, sustain: 1, release: n(p.releaseTime, 1) };
    default: {
      const times = env.times.map((t) => numOr(first(t), 0));
      return { base, amount, attack: times[0] ?? 0.01, decay: times[1] ?? null, sustain: 0, release: times[times.length - 1] ?? 0.1 };
    }
  }
}

function findOscFreq(v: Value, seen = new Set<unknown>()): Value | null {
  if (v === null || typeof v !== "object" || seen.has(v)) return null;
  seen.add(v);
  if (Array.isArray(v)) {
    for (const x of v) { const r = findOscFreq(x, seen); if (r) return r; }
    return null;
  }
  if (v instanceof GNode) {
    if (v.kind === "ugen" && OSC_SOUND[v.name] && v.rate !== "kr") {
      const f = v.inputs.freq ?? v.inputs.carfreq;
      if (f !== undefined && mentionsControl(f, "freq")) return f;
    }
    for (const x of Object.values(v.inputs)) { const r = findOscFreq(x, seen); if (r) return r; }
  }
  return null;
}

function mentionsControl(v: Value, name: string, seen = new Set<unknown>()): boolean {
  if (v === null || typeof v !== "object" || seen.has(v)) return false;
  seen.add(v);
  if (Array.isArray(v)) return v.some((x) => mentionsControl(x, name, seen));
  if (v instanceof GNode) {
    if (v.kind === "control") return v.name === name;
    return Object.values(v.inputs).some((x) => mentionsControl(x, name, seen));
  }
  return false;
}

function containsOsc(v: Value | undefined, seen = new Set<unknown>()): boolean {
  if (v === undefined || v === null || typeof v !== "object" || seen.has(v)) return false;
  seen.add(v);
  if (Array.isArray(v)) return v.some((x) => containsOsc(x, seen));
  if (v instanceof GNode) {
    if (v.kind === "ugen" && OSC_SOUND[v.name] && v.rate !== "kr") return true;
    return Object.values(v.inputs).some((x) => containsOsc(x, seen));
  }
  return false;
}

export function soundByName(name: string): string | null {
  if (TIDAL_SOUNDS.has(name)) return name;
  for (const [re, sound] of BY_NAME) if (re.test(name)) return sound;
  return null;
}

function soundByOscillators(oscs: Map<string, number>, detuned: boolean, modulated: boolean): string {
  let best = "";
  let count = 0;
  for (const [name, n] of oscs) if (n > count) { best = name; count = n; }
  const base = OSC_SOUND[best] ?? "saw";
  const many = count > 1 || detuned;
  if (base === "saw" && many) return "supersaw";
  if (base === "square") return modulated ? "superpwm" : many ? "supersquare" : "square";
  if (base === "sine" && modulated) return "superfm";
  return base;
}

function curveName(c: Value): Value {
  if (c instanceof Sym) return c.name === "linear" ? "lin" : c.name;
  return typeof c === "number" ? c : "lin";
}

function round(x: number): number {
  return Number(x.toPrecision(6));
}

function unique<T>(list: T[]): T[] {
  return [...new Set(list)];
}
