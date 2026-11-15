/**
 * Runs a SuperCollider program far enough to know what it would play: the
 * SynthDefs it defines, the patterns, routines, synths and events it plays,
 * and on which clock. Data (arrays, numbers, scales, envelopes) is computed
 * as sclang does; patterns become generators (patterns.ts); a SynthDef's
 * function runs with symbolic signals (GNode) so its graph can be analysed.
 */
import type { Node } from "./parser.ts";
import {
  DONE, Pattern, Pdraw, Pbind, Pbinop, Pbjorklund, Pbrown, Pchain, Pcollect, PdefRef, Pdup, Pfin, Pfindur, Pfunc,
  Pif, Pkey, Plazy, Plist, Pmath, Pn, Ppar, Ppatlace, Place, Prand, Pseg, Pseq, Pser, Pseries, Pshuf, Pslide, Pswitch,
  Psync, Punop, Pwhite, Stream, mod, type Host,
} from "./patterns.ts";
import {
  Assoc, ClockV, EnvSpec, GNode, Opaque, RandToken, RestV, RoutineV, SCClass, SCEvent, SCFunc, ScaleV, Scope, Sym,
  SynthDefV, SynthV, describe, isPattern, seededRandom, type Value,
} from "./values.ts";

/** Something the program plays. */
export interface PlayRecord {
  kind: "pattern" | "routine" | "synth" | "event";
  pattern?: Value;
  routine?: RoutineV;
  synth?: SynthV;
  event?: SCEvent;
  /** When it starts, in beats of its clock. */
  start: number;
  /** A routine that loops forever (it ran until the horizon). */
  endless?: boolean;
  clock: ClockV;
  line: number;
  label: string;
}

/** A timed event from a routine: Synth(...) or an event's play. */
export interface RoutineEvent {
  time: number;
  event: SCEvent;
}

class Horizon extends Error {}
class TooMuchWork extends Error {}
class StopCollect extends Error {}

/** SuperCollider's built-in scales (degrees in semitones). */
export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], ionian: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10], harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  harmonicMajor: [0, 2, 4, 5, 7, 8, 11], melodicMinor: [0, 2, 3, 5, 7, 9, 11], majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], whole: [0, 2, 4, 6, 8, 10],
  wholeTone: [0, 2, 4, 6, 8, 10], blues: [0, 3, 5, 6, 7, 10], ritusen: [0, 2, 5, 7, 9], egyptian: [0, 2, 5, 7, 10],
  hirajoshi: [0, 2, 3, 7, 8], iwato: [0, 1, 5, 6, 10], kumoi: [0, 2, 3, 7, 9], chinese: [0, 4, 6, 7, 11],
  indian: [0, 4, 5, 7, 10], pelog: [0, 1, 3, 7, 8], prometheus: [0, 2, 4, 6, 11], scriabin: [0, 1, 4, 7, 9],
  gong: [0, 2, 4, 7, 9], shang: [0, 2, 5, 7, 10], jiao: [0, 3, 5, 8, 10], zhi: [0, 2, 5, 7, 9], yu: [0, 3, 5, 7, 10],
  augmented: [0, 3, 4, 7, 8, 11], augmented2: [0, 1, 4, 5, 8, 9], diminished: [0, 2, 3, 5, 6, 8, 9, 11],
  diminished2: [0, 1, 3, 4, 6, 7, 9, 10], superLocrian: [0, 1, 3, 4, 6, 8, 10], spanish: [0, 1, 4, 5, 7, 8, 10],
  hungarianMinor: [0, 2, 3, 6, 7, 8, 11], neapolitanMinor: [0, 1, 3, 5, 7, 8, 11], neapolitanMajor: [0, 1, 3, 5, 7, 9, 11],
  bartok: [0, 2, 4, 5, 7, 8, 10], todi: [0, 1, 3, 6, 7, 8, 11], purvi: [0, 1, 4, 6, 7, 8, 11], marva: [0, 1, 4, 6, 7, 9, 11],
  bhairav: [0, 1, 4, 5, 7, 8, 11], ahirbhairav: [0, 1, 4, 5, 7, 9, 10], romanianMinor: [0, 2, 3, 6, 7, 9, 10],
  enigmatic: [0, 1, 4, 6, 8, 10, 11], leadingWhole: [0, 2, 4, 6, 8, 10, 11], lydianMinor: [0, 2, 4, 6, 7, 8, 10],
  locrianMajor: [0, 2, 4, 5, 6, 8, 10], minPent: [0, 3, 5, 7, 10], majPent: [0, 2, 4, 7, 9],
};

/** Unary math: the function and how to write it in JavaScript (for random tokens). */
const UNARY: Record<string, [(x: number) => number, (x: string) => string]> = {
  neg: [(x) => -x, (x) => `-${x}`],
  abs: [Math.abs, (x) => `Math.abs(${x})`],
  reciprocal: [(x) => 1 / x, (x) => `1 / ${x}`],
  sqrt: [Math.sqrt, (x) => `Math.sqrt(${x})`],
  squared: [(x) => x * x, (x) => `${x} * ${x}`],
  cubed: [(x) => x * x * x, (x) => `${x} ** 3`],
  exp: [Math.exp, (x) => `Math.exp(${x})`],
  log: [Math.log, (x) => `Math.log(${x})`],
  log2: [Math.log2, (x) => `Math.log2(${x})`],
  log10: [Math.log10, (x) => `Math.log10(${x})`],
  sin: [Math.sin, (x) => `Math.sin(${x})`],
  cos: [Math.cos, (x) => `Math.cos(${x})`],
  tan: [Math.tan, (x) => `Math.tan(${x})`],
  tanh: [Math.tanh, (x) => `Math.tanh(${x})`],
  atan: [Math.atan, (x) => `Math.atan(${x})`],
  floor: [Math.floor, (x) => `Math.floor(${x})`],
  ceil: [Math.ceil, (x) => `Math.ceil(${x})`],
  frac: [(x) => x - Math.floor(x), (x) => `${x} % 1`],
  sign: [Math.sign, (x) => `Math.sign(${x})`],
  midicps: [(m) => 440 * Math.pow(2, (m - 69) / 12), (x) => `440 * 2 ** ((${x} - 69) / 12)`],
  cpsmidi: [(f) => 69 + 12 * Math.log2(f / 440), (x) => `69 + 12 * Math.log2(${x} / 440)`],
  midiratio: [(x) => Math.pow(2, x / 12), (x) => `2 ** (${x} / 12)`],
  ratiomidi: [(x) => 12 * Math.log2(x), (x) => `12 * Math.log2(${x})`],
  dbamp: [(x) => Math.pow(10, x / 20), (x) => `10 ** (${x} / 20)`],
  ampdb: [(x) => 20 * Math.log10(x), (x) => `20 * Math.log10(${x})`],
  asInteger: [Math.trunc, (x) => `Math.trunc(${x})`],
  asInt: [Math.trunc, (x) => `Math.trunc(${x})`],
  asFloat: [(x) => x, (x) => x],
  half: [(x) => x / 2, (x) => `${x} / 2`],
  twice: [(x) => x * 2, (x) => `${x} * 2`],
  distort: [(x) => x / (1 + Math.abs(x)), (x) => `${x} / (1 + Math.abs(${x}))`],
  softclip: [(x) => (Math.abs(x) <= 0.5 ? x : (Math.abs(x) - 0.25) / x), (x) => x],
  isPositive: [(x) => (x >= 0 ? 1 : 0), (x) => x],
};

/** Binary operators on numbers. */
function numOp(op: string, a: number, b: number): Value {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return a / b;
    case "%": case "mod": return b === 0 ? a : a - b * Math.floor(a / b);
    case "**": case "pow": return Math.pow(a, b);
    case "div": return Math.floor(a / b);
    case "min": return Math.min(a, b);
    case "max": return Math.max(a, b);
    case "round": return b === 0 ? a : Math.round(a / b) * b;
    case "trunc": return b === 0 ? a : Math.trunc(a / b) * b;
    case "<": return a < b;
    case ">": return a > b;
    case "<=": return a <= b;
    case ">=": return a >= b;
    case "==": return a === b;
    case "!=": return a !== b;
    case "atan2": return Math.atan2(a, b);
    case "hypot": return Math.hypot(a, b);
    case "bitAnd": case "&": return a & b;
    case "bitOr": case "|": return a | b;
    case "clip2": return Math.max(-b, Math.min(b, a));
    case "lcm": return lcm(a, b);
    case "gcd": return gcd(a, b);
  }
  return null;
}

const OP_JS: Record<string, (x: string, y: string) => string> = {
  "+": (x, y) => `${x} + ${y}`, "-": (x, y) => `${x} - ${y}`, "*": (x, y) => `${x} * ${y}`, "/": (x, y) => `${x} / ${y}`,
  "**": (x, y) => `${x} ** ${y}`, pow: (x, y) => `${x} ** ${y}`, "%": (x, y) => `${x} % ${y}`, mod: (x, y) => `${x} % ${y}`,
  min: (x, y) => `Math.min(${x}, ${y})`, max: (x, y) => `Math.max(${x}, ${y})`,
  round: (x, y) => `Math.round(${x} / ${y}) * ${y}`, div: (x, y) => `Math.floor(${x} / ${y})`,
};

export function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
}
function lcm(a: number, b: number) {
  return a && b ? Math.abs(a * b) / gcd(a, b) : 0;
}

/** Input names of the UGens the analysis reads (after the rate method). */
export const UGEN_INPUTS: Record<string, string[]> = {
  SinOsc: ["freq", "phase", "mul", "add"], FSinOsc: ["freq", "iphase", "mul", "add"], Saw: ["freq", "mul", "add"],
  Pulse: ["freq", "width", "mul", "add"], LFSaw: ["freq", "iphase", "mul", "add"], LFPulse: ["freq", "iphase", "width", "mul", "add"],
  LFTri: ["freq", "iphase", "mul", "add"], LFCub: ["freq", "iphase", "mul", "add"], LFPar: ["freq", "iphase", "mul", "add"],
  VarSaw: ["freq", "iphase", "width", "mul", "add"], SyncSaw: ["syncFreq", "sawFreq", "mul", "add"], Blip: ["freq", "numharm", "mul", "add"],
  PMOsc: ["carfreq", "modfreq", "pmindex", "modphase", "mul", "add"], WhiteNoise: ["mul", "add"], PinkNoise: ["mul", "add"],
  BrownNoise: ["mul", "add"], GrayNoise: ["mul", "add"], ClipNoise: ["mul", "add"], Dust: ["density", "mul", "add"],
  Impulse: ["freq", "phase", "mul", "add"], LFNoise0: ["freq", "mul", "add"], LFNoise1: ["freq", "mul", "add"], LFNoise2: ["freq", "mul", "add"],
  LPF: ["in", "freq", "mul", "add"], HPF: ["in", "freq", "mul", "add"], RLPF: ["in", "freq", "rq", "mul", "add"],
  RHPF: ["in", "freq", "rq", "mul", "add"], BPF: ["in", "freq", "rq", "mul", "add"], BRF: ["in", "freq", "rq", "mul", "add"],
  Resonz: ["in", "freq", "bwr", "mul", "add"], Ringz: ["in", "freq", "decaytime", "mul", "add"], BPeakEQ: ["in", "freq", "rq", "db", "mul", "add"],
  BLowPass: ["in", "freq", "rq", "mul", "add"], BHiPass: ["in", "freq", "rq", "mul", "add"], BLowPass4: ["in", "freq", "rq", "mul", "add"],
  BHiPass4: ["in", "freq", "rq", "mul", "add"], MoogFF: ["in", "freq", "gain", "reset", "mul", "add"], DFM1: ["in", "freq", "res", "inputgain", "type", "noiselevel", "mul", "add"],
  OnePole: ["in", "coef", "mul", "add"], LeakDC: ["in", "coef", "mul", "add"], Limiter: ["in", "level", "dur"], Compander: ["in", "control", "thresh"],
  FreeVerb: ["in", "mix", "room", "damp", "mul", "add"], FreeVerb2: ["in", "in2", "mix", "room", "damp", "mul", "add"],
  GVerb: ["in", "roomsize", "revtime", "damping", "inputbw", "spread", "drylevel", "earlyreflevel", "taillevel", "maxroomsize", "mul", "add"],
  CombN: ["in", "maxdelaytime", "delaytime", "decaytime", "mul", "add"], CombL: ["in", "maxdelaytime", "delaytime", "decaytime", "mul", "add"],
  CombC: ["in", "maxdelaytime", "delaytime", "decaytime", "mul", "add"], AllpassN: ["in", "maxdelaytime", "delaytime", "decaytime", "mul", "add"],
  AllpassL: ["in", "maxdelaytime", "delaytime", "decaytime", "mul", "add"], AllpassC: ["in", "maxdelaytime", "delaytime", "decaytime", "mul", "add"],
  DelayN: ["in", "maxdelaytime", "delaytime", "mul", "add"], DelayL: ["in", "maxdelaytime", "delaytime", "mul", "add"],
  DelayC: ["in", "maxdelaytime", "delaytime", "mul", "add"], Pan2: ["in", "pos", "level"], LinPan2: ["in", "pos", "level"],
  Balance2: ["left", "right", "pos", "level"], Splay: ["inArray", "spread", "level", "center", "levelComp"], Out: ["bus", "channelsArray"],
  OffsetOut: ["bus", "channelsArray"], ReplaceOut: ["bus", "channelsArray"], Line: ["start", "end", "dur", "mul", "add", "doneAction"],
  XLine: ["start", "end", "dur", "mul", "add", "doneAction"], EnvGen: ["envelope", "gate", "levelScale", "levelBias", "timeScale", "doneAction"],
  Decay: ["in", "decayTime", "mul", "add"], Decay2: ["in", "attackTime", "decayTime", "mul", "add"], Lag: ["in", "lagTime", "mul", "add"],
  Klank: ["specificationsArrayRef", "input", "freqscale", "freqoffset", "decayscale"], Formant: ["fundfreq", "formfreq", "bwfreq", "mul", "add"],
  Decimator: ["in", "rate", "bits", "mul", "add"], PlayBuf: ["numChannels", "bufnum", "rate", "trigger", "startPos", "loop", "doneAction"],
  Rand: ["lo", "hi"], ExpRand: ["lo", "hi"], IRand: ["lo", "hi"], TRand: ["lo", "hi", "trig"], Mix: ["array"],
};

const PATTERN_CLASSES = new Set([
  "Pseq", "Pser", "Prand", "Pxrand", "Pwrand", "Pshuf", "Pwhite", "Pexprand", "Pbrown", "Pgbrown", "Pseries", "Pgeom", "Pn", "Pdup",
  "Pstutter", "Pkey", "Pfunc", "Pfuncn", "Pchain", "Pbind", "Pmono", "PmonoArtic", "Ppar", "Ptpar", "Pgpar", "Pbindf", "Pset", "Padd",
  "Pmul", "Pfindur", "Psync", "Pdef", "Pbindef", "Pdefn", "Plazy", "Pfin", "Pslide", "Place", "Ppatlace", "Pswitch", "Pswitch1", "Pif",
  "Pseg", "Pbjorklund", "Pbjorklund2", "Prout", "Pcollect", "Pselect", "Preject", "Pconst", "Pclutch", "Pgauss", "Pmeanrand", "Pevent",
  "Pfx", "Pfxb", "Pproto", "Pspawner", "Pwalk", "Pindex", "Ptuple", "Pstep", "Penv", "Pgate", "Psym", "Pnsym", "Pdict", "Ptime", "Pfset",
]);

export class Interpreter implements Host {
  readonly rng = seededRandom();
  time = 0;
  /** Notes for the user about what could not be converted exactly. */
  readonly notes = new Set<string>();
  readonly synthDefs = new Map<string, SynthDefV>();
  readonly played: PlayRecord[] = [];
  readonly defaultClock = new ClockV(1);
  private readonly global = new Scope();
  private readonly envir = new Map<string, Value>();
  private readonly pdefs = new Map<string, Value>();
  private readonly pdefns = new Map<string, Value>();
  private work = 0;
  /** While a routine runs: its time in beats and the events it plays. */
  private routine: { time: number; horizon: number; events: RoutineEvent[]; clock: ClockV } | null = null;
  /** While a Prout runs to collect its values. */
  private collecting: Value[] | null = null;
  /** Whether the bounds of the Pwhite being made were written as floats (1.0), as SuperCollider tells. */
  private floatArgs = false;
  /** While a SynthDef's function runs: the outputs it writes. */
  private graph: { outputs: Value[] } | null = null;

  note(text: string) {
    this.notes.add(text);
  }

  pdef(name: string): Value {
    return this.pdefs.get(name) ?? null;
  }

  pdefn(name: string): Value {
    return this.pdefns.get(name) ?? null;
  }

  /** Runs a program; a statement that fails is noted and skipped. */
  run(program: Node[]) {
    for (const node of program) {
      try {
        this.eval(node, this.global);
      } catch (err) {
        if (err instanceof Horizon || err instanceof TooMuchWork) continue;
        this.note("Line " + node.line + " could not be run: " + (err instanceof Error ? err.message : String(err)));
      }
    }
  }

  // ------------------------------------------------------------ evaluation

  eval(node: Node, scope: Scope): Value {
    if (++this.work > 2_000_000) throw new TooMuchWork("too much work");
    switch (node.t) {
      case "num": return node.v;
      case "str": return node.v;
      case "sym": return new Sym(node.v);
      case "char": return node.v;
      case "bool": return node.v;
      case "nil": return null;
      case "var": return this.lookup(node.name, scope);
      case "env": return this.envir.get(node.name) ?? null;
      case "class": return new SCClass(node.name);
      case "array": {
        const out: Value[] = [];
        for (const item of node.items) {
          if (item.t === "pair") out.push(new Sym(item.key), this.eval(item.value, scope));
          else if (item.t === "splat") out.push(...asList(this.eval(item.a, scope)));
          else out.push(this.eval(item, scope));
        }
        return out;
      }
      case "event": return new SCEvent(node.pairs.map(([k, v]) => [k, this.eval(v, scope)]));
      case "range": {
        const from = this.eval(node.from, scope);
        const to = node.to ? this.eval(node.to, scope) : null;
        const then = node.then ? this.eval(node.then, scope) : null;
        if (typeof from !== "number" || typeof to !== "number") throw new Error("an open range (a..) cannot be converted");
        const step = typeof then === "number" ? then - from : to >= from ? 1 : -1;
        const out: number[] = [];
        if (step === 0) return [from];
        for (let x = from; step > 0 ? x <= to + 1e-9 : x >= to - 1e-9; x += step) {
          out.push(x);
          if (out.length > 100000) break;
        }
        return out;
      }
      case "call": {
        const recv = this.eval(node.recv, scope);
        const args: Value[] = [];
        for (const a of node.args) {
          if (a.t === "splat") args.push(...asList(this.eval(a.a, scope)));
          else args.push(this.eval(a, scope));
        }
        const kwargs: Record<string, Value> = {};
        for (const [k, v] of node.kwargs) kwargs[k] = this.eval(v, scope);
        if (recv instanceof SCClass && (recv.name === "Pwhite" || recv.name === "Pexprand")) {
          this.floatArgs = node.args.some((a) => (a.t === "num" && a.float === true) || (a.t === "neg" && a.a.t === "num" && a.a.float === true));
        }
        return this.send(recv, node.method, args, kwargs, node.line);
      }
      case "binop": {
        // Short circuits.
        if (node.op === "??") {
          const a = this.eval(node.a, scope);
          return a === null ? this.eval(node.b, scope) : a;
        }
        return this.binop(node.op, this.eval(node.a, scope), this.eval(node.b, scope));
      }
      case "neg": return this.send(this.eval(node.a, scope), "neg", []);
      case "func": return new SCFunc(node, scope);
      case "assign": {
        const value = this.eval(node.value, scope);
        this.assign(node.target, value, scope);
        return value;
      }
      case "multi": {
        const value = asList(this.eval(node.value, scope));
        node.targets.forEach((t, i) => this.assign(t, value[i] ?? null, scope));
        if (node.rest) this.assign(node.rest, value.slice(node.targets.length), scope);
        return value;
      }
      case "vars":
        for (const d of node.decls) scope.vars.set(d.name, d.init ? this.eval(d.init, scope) : null);
        return null;
      case "block": {
        const inner = new Scope(scope);
        let last: Value = null;
        for (const st of node.body) {
          try {
            last = this.eval(st, inner);
          } catch (err) {
            if (err instanceof Horizon || err instanceof TooMuchWork || err instanceof StopCollect) throw err;
            this.note("Line " + st.line + " could not be run: " + (err instanceof Error ? err.message : String(err)));
          }
        }
        return last;
      }
      case "index": return this.send(this.eval(node.recv, scope), "at", [this.eval(node.index, scope)]);
      case "slice": {
        const recv = this.eval(node.recv, scope);
        const from = node.from ? this.eval(node.from, scope) : 0;
        const to = node.to ? this.eval(node.to, scope) : null;
        return this.send(recv, "copyRange", [from, to ?? (Array.isArray(recv) ? recv.length - 1 : 0)]);
      }
      case "splat": return this.eval(node.a, scope);
      case "pair": return [new Sym(node.key), this.eval(node.value, scope)];
    }
  }

  private lookup(name: string, scope: Scope): Value {
    const s = scope.lookup(name);
    if (s) return s.vars.get(name) ?? null;
    if (this.global.vars.has(name)) return this.global.vars.get(name) ?? null;
    switch (name) {
      case "s": return new Opaque("the server");
      case "thisThread": case "thisProcess": case "currentEnvironment": return new Opaque(name);
      case "this": return null;
    }
    return null;
  }

  private assign(target: Node, value: Value, scope: Scope) {
    if (target.t === "env") {
      this.envir.set(target.name, value);
      return;
    }
    if (target.t === "var") {
      const s = scope.lookup(target.name);
      (s ?? this.global).vars.set(target.name, value);
      return;
    }
    throw new Error("cannot assign to this");
  }

  call(fn: SCFunc, args: Value[], kwargs: Record<string, Value> = {}): Value {
    if (++this.work > 2_000_000) throw new TooMuchWork("too much work");
    const scope = new Scope(fn.scope);
    fn.params.forEach((p, i) => {
      let v: Value | undefined = i < args.length ? args[i] : kwargs[p.name];
      if (v === undefined || (v === null && p.init)) v = p.init ? this.eval(p.init, scope) : null;
      scope.vars.set(p.name, v);
    });
    if (fn.rest) scope.vars.set(fn.rest, args.slice(fn.params.length));
    for (const v of fn.vars) scope.vars.set(v.name, v.init ? this.eval(v.init, scope) : null);
    let last: Value = null;
    for (const st of fn.body) last = this.eval(st, scope);
    return last;
  }

  /** Calls a value as a function: a function runs, anything else is itself. */
  private value(v: Value, args: Value[]): Value {
    return v instanceof SCFunc ? this.call(v, args) : v;
  }

  // ------------------------------------------------------------ operators

  binop(op: string, a: Value, b: Value): Value {
    if (op === "<>") return new Pchain([a, b]);
    if (op === "->") return new Assoc(a, b);
    if (op === "!") return this.send(a, "dup", [b]);
    if (op === "?") return a === null ? b : a;
    if (op === "==") return equals(a, b);
    if (op === "!=") return !equals(a, b);
    if (op === "===") return a === b;
    if (op === "++") {
      if (Array.isArray(a)) return [...a, ...asList(b)];
      return describeText(a) + describeText(b);
    }
    if (op === "+/+") return describeText(a) + "/" + describeText(b);
    if (op === "&&") return a === true && b === true;
    if (op === "||") return a === true || b === true;
    if (a instanceof RestV || b instanceof RestV) return a instanceof RestV ? a : b;
    if (isPattern(a) || isPattern(b)) return new Pbinop(op, a, b);
    if (Array.isArray(a) || Array.isArray(b)) {
      const la = asList(a);
      const lb = asList(b);
      const n = Math.max(la.length, lb.length);
      return Array.from({ length: n }, (_, i) => this.binop(op, la[i % la.length], lb[i % lb.length]));
    }
    if (a instanceof GNode || b instanceof GNode || a instanceof EnvSpec || b instanceof EnvSpec) {
      return new GNode("binop", op, { a: toSignal(a), b: toSignal(b) });
    }
    if (a instanceof RandToken && typeof b === "number") {
      const js = OP_JS[op];
      if (!js) return a.realize(this.rng);
      const lin: [number, number] | undefined = op === "*" ? [b, 0] : op === "/" ? [1 / b, 0] : op === "+" ? [1, b] : op === "-" ? [1, -b] : undefined;
      return a.map((x) => numOp(op, x, b) as number, js("x", fmtJs(b)), lin);
    }
    if (typeof a === "number" && b instanceof RandToken) {
      const js = OP_JS[op];
      if (!js) return b.realize(this.rng);
      const lin: [number, number] | undefined = op === "*" ? [a, 0] : op === "+" ? [1, a] : op === "-" ? [-1, a] : undefined;
      return b.map((x) => numOp(op, a, x) as number, js(fmtJs(a), "x"), lin);
    }
    if (a instanceof RandToken || b instanceof RandToken) {
      this.note("Two random values combined: one of them is a fixed draw.");
      return this.binop(op, a instanceof RandToken ? a.realize(this.rng) : a, b instanceof RandToken ? b.realize(this.rng) : b);
    }
    if (typeof a === "boolean" && typeof b === "boolean") {
      if (op === "and") return a && b;
      if (op === "or") return a || b;
    }
    if (typeof a === "number" && typeof b === "number") {
      const r = numOp(op, a, b);
      if (r !== null) return r;
      if (op === "rrand") return this.drawn("rrand", a + this.rng() * (b - a));
      if (op === "exprand") return this.drawn("exprand", a * Math.pow(b / a, this.rng()));
    }
    if (a instanceof Opaque || b instanceof Opaque) return a instanceof Opaque ? a : b;
    if ((typeof a === "string" || a instanceof Sym) && (typeof b === "string" || b instanceof Sym)) {
      const x = describeText(a);
      const y = describeText(b);
      if (op === "<") return x < y;
      if (op === ">") return x > y;
    }
    return null;
  }

  private drawn(what: string, v: number) {
    this.note(what + " and other random calls in code are drawn once when the code runs: the TidalJS code keeps one draw.");
    return v;
  }

  // ------------------------------------------------------------ methods

  send(recv: Value, method: string, args: Value[], kwargs: Record<string, Value> = {}, line = 0): Value {
    // Methods every object answers.
    switch (method) {
      case "postln": case "post": case "postcs": case "debug": case "yourself": case "trace": case "printOn": case "cs":
        return recv;
      case "isNil": return recv === null;
      case "notNil": return recv !== null;
      case "isKindOf": case "isMemberOf": case "respondsTo": return false;
      case "asString": return describeText(recv);
      case "asSymbol": return new Sym(describeText(recv));
      case "isString": return typeof recv === "string";
      case "isNumber": return typeof recv === "number";
      case "isArray": return Array.isArray(recv);
      case "isFunction": return recv instanceof SCFunc;
    }
    if (recv instanceof SCClass) return this.classSend(recv.name, method, args, kwargs, line);
    if (typeof recv === "number") return this.numberSend(recv, method, args, kwargs);
    if (Array.isArray(recv)) return this.arraySend(recv, method, args, kwargs, line);
    if (recv instanceof SCFunc) return this.funcSend(recv, method, args, kwargs, line);
    if (typeof recv === "boolean") return this.boolSend(recv, method, args);
    if (recv === null) return this.nilSend(method, args);
    if (recv instanceof Sym) return this.symSend(recv, method, args, kwargs);
    if (typeof recv === "string") return this.stringSend(recv, method, args);
    if (recv instanceof SCEvent) return this.eventSend(recv, method, args, kwargs, line);
    if (isPattern(recv)) return this.patternSend(recv as Pattern, method, args, kwargs, line);
    if (recv instanceof GNode) return this.signalSend(recv, method, args, kwargs);
    if (recv instanceof EnvSpec) return this.envSend(recv, method, args, kwargs);
    if (recv instanceof RandToken) return this.tokenSend(recv, method, args);
    if (recv instanceof SynthDefV) return this.synthDefSend(recv, method, line);
    if (recv instanceof RoutineV) return this.routineSend(recv, method, args, kwargs, line);
    if (recv instanceof ClockV) return this.clockSend(recv, method, args);
    if (recv instanceof ScaleV) return this.scaleSend(recv, method, args);
    if (recv instanceof Assoc) return method === "key" ? recv.key : method === "value" ? recv.value : null;
    if (recv instanceof RestV) return method === "dur" ? recv.dur : recv;
    if (recv instanceof SynthV) return recv;
    if (recv instanceof Opaque) return this.opaqueSend(recv, method, args, line);
    return null;
  }

  private opaqueSend(recv: Opaque, method: string, args: Value[], line: number): Value {
    // s.waitForBoot { ... }, s.bind { ... }, s.makeBundle(t, { ... }): run the function.
    if (["waitForBoot", "doWhenBooted", "bind", "makeBundle", "sync"].includes(method)) {
      const fn = args.find((a) => a instanceof SCFunc);
      if (fn instanceof SCFunc) return this.call(fn, []);
      return recv;
    }
    if (method === "tempo" && recv.desc === "the server") return 1;
    void line;
    return new Opaque(recv.desc + "." + method);
  }

  private numberSend(x: number, method: string, args: Value[], kwargs: Record<string, Value>): Value {
    if (UNARY[method] && args.length === 0) return UNARY[method][0](x);
    const a0 = args[0];
    if (args.length >= 1 && (Array.isArray(a0) || isPattern(a0) || a0 instanceof GNode || a0 instanceof RandToken) && !["dup", "do", "collect", "series", "degreeToKey"].includes(method)) {
      if (["max", "min", "round", "pow", "mod", "div", "trunc", "clip2", "atan2", "rrand", "exprand"].includes(method)) return this.binop(method, x, a0);
    }
    switch (method) {
      case "value": case "next": case "copy": case "asStream": return x;
      case "round": return numOp("round", x, num(args[0], 1));
      case "trunc": return args.length ? numOp("trunc", x, num(args[0], 1)) : Math.trunc(x);
      case "max": case "min": case "pow": case "mod": case "div": case "atan2": case "hypot": case "clip2": case "lcm": case "gcd":
        return numOp(method, x, num(args[0], 0));
      case "clip": return Math.max(num(args[0], -Infinity), Math.min(num(args[1], Infinity), x));
      case "wrap": { const lo = num(args[0], 0), hi = num(args[1], 1); return lo + mod(x - lo, hi - lo); }
      case "fold": { const lo = num(args[0], 0), hi = num(args[1], 1); const r = hi - lo; let y = mod(x - lo, 2 * r); if (y > r) y = 2 * r - y; return lo + y; }
      case "linlin": return linlin(x, args);
      case "linexp": return linexp(x, args);
      case "explin": { const [a, b, c, d] = args.map((v) => num(v, 0)); return Math.log(x / a) / Math.log(b / a) * (d - c) + c; }
      case "expexp": { const [a, b, c, d] = args.map((v) => num(v, 1)); return Math.pow(d / c, Math.log(x / a) / Math.log(b / a)) * c; }
      case "rand": return this.drawn("rand", Number.isInteger(x) ? Math.floor(this.rng() * x) : this.rng() * x);
      case "rand2": return this.drawn("rand2", (this.rng() * 2 - 1) * x);
      case "rrand": return this.drawn("rrand", Number.isInteger(x) && Number.isInteger(num(args[0], 0)) ? x + Math.floor(this.rng() * (num(args[0], 0) - x + 1)) : x + this.rng() * (num(args[0], 0) - x));
      case "exprand": return this.drawn("exprand", x * Math.pow(num(args[0], 1) / x, this.rng()));
      case "coin": return this.drawn("coin", this.rng() < x ? 1 : 0) === 1;
      case "even": return mod(x, 2) === 0;
      case "odd": return mod(x, 2) === 1;
      case "isInteger": return Number.isInteger(x);
      case "dup": case "!": {
        const n = num(args[0] ?? kwargs.n, 2);
        return Array.from({ length: n }, () => x);
      }
      case "do": case "reverseDo": {
        const fn = args[0];
        if (!(fn instanceof SCFunc)) return x;
        const n = x === Infinity ? Infinity : Math.floor(x);
        for (let i = 0; i < n; i++) this.call(fn, [method === "reverseDo" ? n - 1 - i : i, i]);
        return x;
      }
      case "collect": {
        const fn = args[0];
        return Array.from({ length: Math.floor(x) }, (_, i) => (fn instanceof SCFunc ? this.call(fn, [i, i]) : i));
      }
      case "for": case "forBy": {
        const end = num(args[0], x);
        const step = method === "forBy" ? num(args[1], 1) : 1;
        const fn = args[method === "forBy" ? 2 : 1];
        if (fn instanceof SCFunc) for (let i = x, k = 0; step > 0 ? i <= end : i >= end; i += step, k++) this.call(fn, [i, k]);
        return x;
      }
      case "series": {
        const second = num(args[0], x + 1);
        const last = num(args[1], x);
        const step = second - x;
        const out: number[] = [];
        for (let v = x; step > 0 ? v <= last + 1e-9 : v >= last - 1e-9; v += step) { out.push(v); if (out.length > 100000) break; }
        return out;
      }
      case "wait": case "yield": case "sleep": case "embedInStream": return this.advance(x);
      case "degreeToKey": return degreeToKey(x, args[0], num(args[1], 12));
      case "asArray": return [x];
      case "midinote": return x;
      case "neg": return -x;
      case "squared": return x * x;
      case "lincurve": return linlin(x, args);
      case "nextPowerOfTwo": return Math.pow(2, Math.ceil(Math.log2(x)));
      case "sum3rand": return this.drawn("sum3rand", (this.rng() + this.rng() + this.rng() - 1.5) * x * 2 / 3);
    }
    if (OP_JS[method] || ["<", ">", "<=", ">=", "==", "!="].includes(method)) return this.binop(method, x, args[0] ?? null);
    return null;
  }

  private arraySend(arr: Value[], method: string, args: Value[], kwargs: Record<string, Value>, line: number): Value {
    const fn = args[0] instanceof SCFunc ? args[0] : null;
    switch (method) {
      case "size": return arr.length;
      case "at": {
        const i = args[0];
        if (Array.isArray(i)) return i.map((k) => arr[num(k, 0)] ?? null);
        return arr[num(i, 0)] ?? null;
      }
      case "clipAt": return arr[Math.max(0, Math.min(arr.length - 1, num(args[0], 0)))] ?? null;
      case "wrapAt": return arr[mod(num(args[0], 0), arr.length)] ?? null;
      case "foldAt": { const n = arr.length; const r = mod(num(args[0], 0), 2 * n - 2 || 1); return arr[r < n ? r : 2 * n - 2 - r] ?? null; }
      case "atAll": return asList(args[0]).map((k) => arr[num(k, 0)] ?? null);
      case "first": return arr[0] ?? null;
      case "last": return arr[arr.length - 1] ?? null;
      case "put": arr[num(args[0], 0)] = args[1] ?? null; return arr;
      case "add": arr.push(args[0] ?? null); return arr;
      case "addAll": arr.push(...asList(args[0])); return arr;
      case "insert": arr.splice(num(args[0], 0), 0, args[1] ?? null); return arr;
      case "removeAt": return arr.splice(num(args[0], 0), 1)[0] ?? null;
      case "copy": case "deepCopy": case "asArray": case "asList": case "array": return arr.slice();
      case "value": return arr;
      case "isEmpty": return arr.length === 0;
      case "notEmpty": return arr.length > 0;
      case "includes": return arr.some((v) => equals(v, args[0] ?? null));
      case "indexOf": return arr.findIndex((v) => equals(v, args[0] ?? null));
      case "reverse": return arr.slice().reverse();
      case "rotate": { const n = num(args[0], 1); return arr.map((_, i) => arr[mod(i - n, arr.length)]); }
      case "mirror": return [...arr, ...arr.slice(0, -1).reverse()];
      case "mirror1": return [...arr, ...arr.slice(1, -1).reverse()];
      case "mirror2": return [...arr, ...arr.slice().reverse()];
      case "stutter": case "dupEach": { const n = num(args[0], 2); return arr.flatMap((v) => Array.from({ length: n }, () => v)); }
      case "dup": case "!": { const n = num(args[0], 2); return Array.from({ length: n }, () => arr.slice()); }
      case "sum": return arr.reduce((s: Value, v) => this.binop("+", s, v), 0);
      case "mean": return num(this.arraySend(arr, "sum", [], {}, line), 0) / (arr.length || 1);
      case "maxItem": return Math.max(...arr.map((v) => num(v, -Infinity)));
      case "minItem": return Math.min(...arr.map((v) => num(v, Infinity)));
      case "normalize": {
        const lo = num(args[0], 0), hi = num(args[1], 1);
        const nums = arr.map((v) => num(v, 0));
        const min = Math.min(...nums), max = Math.max(...nums);
        return nums.map((v) => (max === min ? lo : lo + ((v - min) / (max - min)) * (hi - lo)));
      }
      case "normalizeSum": { const s = arr.reduce((t: number, v) => t + num(v, 0), 0); return arr.map((v) => num(v, 0) / s); }
      case "integrate": { let s = 0; return arr.map((v) => (s += num(v, 0))); }
      case "differentiate": return arr.map((v, i) => num(v, 0) - (i ? num(arr[i - 1], 0) : 0));
      case "sort": {
        const out = arr.slice();
        if (fn) out.sort((a, b) => (this.call(fn, [a, b]) === true ? -1 : 1));
        else out.sort((a, b) => num(a, 0) - num(b, 0));
        return out;
      }
      case "scramble": {
        this.note("scramble is random: the TidalJS code keeps one order.");
        const out = arr.slice();
        for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
        return out;
      }
      case "choose": return this.drawn("choose", 0) === 0 ? arr[Math.floor(this.rng() * arr.length)] ?? null : null;
      case "wchoose": {
        this.drawn("wchoose", 0);
        return new RandToken("wchoose", [arr, asList(args[0]).map((w) => num(w, 0))]).realize(this.rng);
      }
      case "collect": return arr.map((v, i) => (fn ? this.call(fn, [v, i]) : v));
      case "do": arr.forEach((v, i) => { if (fn) this.call(fn, [v, i]); }); return arr;
      case "reverseDo": arr.slice().reverse().forEach((v, i) => { if (fn) this.call(fn, [v, i]); }); return arr;
      case "select": return arr.filter((v, i) => fn && this.call(fn, [v, i]) === true);
      case "reject": return arr.filter((v, i) => !(fn && this.call(fn, [v, i]) === true));
      case "detect": return arr.find((v, i) => fn && this.call(fn, [v, i]) === true) ?? null;
      case "any": return arr.some((v, i) => fn !== null && this.call(fn, [v, i]) === true);
      case "every": return arr.every((v, i) => fn !== null && this.call(fn, [v, i]) === true);
      case "inject": return arr.reduce((acc: Value, v, i) => (args[1] instanceof SCFunc ? this.call(args[1], [acc, v, i]) : acc), args[0] ?? null);
      case "copyRange": return arr.slice(num(args[0], 0), num(args[1], arr.length - 1) + 1);
      case "copySeries": return arr.slice(num(args[0], 0), num(args[2], arr.length - 1) + 1);
      case "keep": { const n = num(args[0], 0); return n >= 0 ? arr.slice(0, n) : arr.slice(n); }
      case "drop": { const n = num(args[0], 0); return n >= 0 ? arr.slice(n) : arr.slice(0, n); }
      case "flat": case "flatten": return arr.flat(Infinity as 1) as Value[];
      case "lace": {
        const n = num(args[0], arr.length);
        return Array.from({ length: n }, (_, i) => { const item = arr[i % arr.length]; return Array.isArray(item) ? item[Math.floor(i / arr.length) % item.length] : item; });
      }
      case "wrapExtend": { const n = num(args[0], arr.length); return Array.from({ length: n }, (_, i) => arr[i % arr.length]); }
      case "clipExtend": { const n = num(args[0], arr.length); return Array.from({ length: n }, (_, i) => arr[Math.min(i, arr.length - 1)]); }
      case "foldExtend": { const n = num(args[0], arr.length); return Array.from({ length: n }, (_, i) => this.arraySend(arr, "foldAt", [i], {}, line)); }
      case "pyramid": { const out: Value[] = []; for (let i = 1; i <= arr.length; i++) out.push(...arr.slice(0, i)); return out; }
      case "join": return arr.map(describeText).join(typeof args[0] === "string" ? args[0] : "");
      case "asStream": case "iter": return new Pseq(arr, 1);
      case "keysValuesDo": case "pairsDo": {
        for (let i = 0; i + 1 < arr.length; i += 2) if (fn) this.call(fn, [arr[i], arr[i + 1], i]);
        return arr;
      }
      case "sum3rand": return arr;
      case "plot": case "play": return arr;
      case "midicps": case "dbamp": case "midiratio": case "ampdb": case "cpsmidi": case "ratiomidi": case "neg": case "abs":
      case "reciprocal": case "squared": case "sqrt": case "floor": case "ceil": case "asInteger": case "exp": case "log":
      case "round": case "linlin": case "linexp": case "explin": case "clip": case "wrap": case "fold": case "max": case "min":
      case "degreeToKey": case "tanh": case "distort": case "softclip": case "range": case "exprange": case "lag":
      case "trunc": case "pow": case "mod": case "rrand": case "rand": case "cubed": case "frac": case "log2": case "log10":
      case "sin": case "cos": case "atan": case "midinote": case "lincurve":
        return arr.map((v) => this.send(v, method, args, kwargs, line));
    }
    if (OP_JS[method] || ["<", ">"].includes(method)) return this.binop(method, arr, args[0] ?? null);
    // Multichannel signals: a method on an array of UGens applies to each.
    if (arr.some((v) => v instanceof GNode)) return arr.map((v) => this.send(v, method, args, kwargs, line));
    return null;
  }

  private funcSend(fn: SCFunc, method: string, args: Value[], kwargs: Record<string, Value>, line: number): Value {
    switch (method) {
      case "value": case "valueEnvir": return this.call(fn, args, kwargs);
      case "valueArray": return this.call(fn, asList(args[0] ?? []));
      case "dup": case "!": {
        const n = num(args[0], 2);
        return Array.from({ length: n }, (_, i) => this.call(fn, [i]));
      }
      case "fork": case "forkIfNeeded": case "r": case "asRoutine": case "routine":
        return this.startRoutine(new RoutineV(fn, line), args[0] instanceof ClockV ? args[0] : this.defaultClock, method === "fork" || method === "forkIfNeeded");
      case "loop": {
        // Inside a routine: runs until the routine reaches its horizon.
        if (!this.routine && !this.collecting) {
          this.note("A loop outside a routine was not run.");
          return null;
        }
        for (;;) {
          const before = this.routine?.time;
          this.call(fn, []);
          if (this.routine && this.routine.time === before) {
            // A loop that never waits would never end in SuperCollider either.
            if (++this.work > 2_000_000) throw new TooMuchWork("too much work");
          }
        }
      }
      case "while": {
        const body = args[0];
        let guard = 0;
        while (this.call(fn, []) === true && guard++ < 100000) if (body instanceof SCFunc) this.call(body, []);
        return null;
      }
      case "play": {
        // { ... }.play: an anonymous synth, played once.
        const def = new SynthDefV("anonymous" + line, fn, line);
        this.synthDefs.set(def.name, def);
        this.recordSynth(new SynthV(def.name, new SCEvent()), line);
        return new Opaque("a synth");
      }
      case "defer": case "inEnvir": case "protect": return this.call(fn, []);
      case "numArgs": return fn.params.length;
      case "if": return null;
    }
    return new Opaque("function." + method);
  }

  private boolSend(b: boolean, method: string, args: Value[]): Value {
    switch (method) {
      case "if": return b ? this.value(args[0] ?? null, []) : this.value(args[1] ?? null, []);
      case "and": return b && this.value(args[0] ?? null, []) === true;
      case "or": return b || this.value(args[0] ?? null, []) === true;
      case "not": return !b;
      case "xor": return b !== (args[0] === true);
      case "asInteger": return b ? 1 : 0;
    }
    return null;
  }

  private nilSend(method: string, args: Value[]): Value {
    if (method === "if") return null;
    if (method === "rand" || method === "rrand") return null;
    // Function-call syntax with no arguments: rrand(), thisThread.
    void args;
    return null;
  }

  private symSend(sym: Sym, method: string, args: Value[], kwargs: Record<string, Value>): Value {
    // \name.kr(default): a NamedControl in a SynthDef.
    if (method === "kr" || method === "ar" || method === "ir" || method === "tr") {
      const def = args[0] ?? kwargs.val ?? 0;
      return new GNode("control", sym.name, { default: def }, method);
    }
    if (method === "asString") return sym.name;
    if (method === "isRest") return sym.name === "" || sym.name === "rest" || sym.name === "r";
    return null;
  }

  private stringSend(s: string, method: string, args: Value[]): Value {
    if (method === "size") return s.length;
    if (method === "asInteger") return parseInt(s, 10);
    if (method === "asFloat") return parseFloat(s);
    if (method === "at") return s[num(args[0], 0)] ?? null;
    return s;
  }

  private eventSend(ev: SCEvent, method: string, args: Value[], kwargs: Record<string, Value>, line: number): Value {
    switch (method) {
      case "play":
        this.recordEvent(ev, line);
        return ev;
      case "at": return ev.get(describeText(args[0] ?? null)) ?? null;
      case "put": ev.set(describeText(args[0] ?? null), args[1] ?? null); return ev;
      case "copy": return ev.copy();
      case "keys": return [...ev.map.keys()].map((k) => new Sym(k));
      case "size": return ev.map.size;
      case "removeAt": { const k = describeText(args[0] ?? null); const v = ev.get(k) ?? null; ev.map.delete(k); return v; }
      case "keysValuesDo": case "pairsDo": {
        const fn = args[0];
        if (fn instanceof SCFunc) for (const [k, v] of ev.map) this.call(fn, [new Sym(k), v]);
        return ev;
      }
      case "use": return args[0] instanceof SCFunc ? this.call(args[0], []) : null;
    }
    if (method.endsWith("_")) {
      ev.set(method.slice(0, -1), args[0] ?? null);
      return ev;
    }
    void kwargs;
    return ev.get(method) ?? null;
  }

  private patternSend(p: Pattern, method: string, args: Value[], kwargs: Record<string, Value>, line: number): Value {
    switch (method) {
      case "play": {
        const clock = args.find((a) => a instanceof ClockV) ?? kwargs.clock;
        this.recordPattern(p, clock instanceof ClockV ? clock : this.defaultClock, line, labelOf(p));
        return p;
      }
      case "stop": {
        const i = this.played.findIndex((r) => r.pattern === p || (r.pattern instanceof PdefRef && p instanceof PdefRef && r.pattern.key === p.key));
        if (i >= 0) this.played.splice(i, 1);
        return p;
      }
      case "repeat": case "loop": return new Pn(p, method === "loop" ? Infinity : num(args[0], Infinity));
      case "stutter": case "dup": return new Pdup(args[0] ?? 2, p);
      case "collect": return args[0] instanceof SCFunc ? new Pcollect("Pcollect", args[0], p) : p;
      case "select": return args[0] instanceof SCFunc ? new Pcollect("Pselect", args[0], p) : p;
      case "reject": return args[0] instanceof SCFunc ? new Pcollect("Preject", args[0], p) : p;
      case "finDur": return new Pfindur(num(args[0], 4), p);
      case "fin": return new Pfin(args[0] ?? 1, p);
      case "asStream": case "iter": case "trace": case "quant_": case "fadeTime_": case "source": return p;
      case "embedInStream": return this.advance(0);
      case "asArray": case "all": {
        const s = new Stream(p, { host: this });
        const out: Value[] = [];
        for (let i = 0; i < 10000; i++) {
          const v = s.next(new SCEvent());
          if (v === DONE) break;
          out.push(v);
        }
        return out;
      }
      case "source_": {
        if (p instanceof PdefRef) this.pdefs.set(p.key, args[0] ?? null);
        return p;
      }
      case "set": return p;
      case "value": case "next": return p;
    }
    if (method.endsWith("_")) return p;
    // Unary and binary math become patterns too.
    if (UNARY[method] && args.length === 0) return new Punop(method, p, []);
    if (OP_JS[method] || ["<", ">", "<=", ">=", "linlin", "linexp", "explin", "clip", "wrap", "fold", "round", "degreeToKey", "midicps", "rrand"].includes(method)) {
      if (OP_JS[method] && args.length === 1) return new Pbinop(method, p, args[0]);
      return new Punop(method, p, args);
    }
    void line;
    return new Punop(method, p, args);
  }

  private tokenSend(t: RandToken, method: string, args: Value[]): Value {
    if (UNARY[method] && args.length === 0) {
      const [fn, js] = UNARY[method];
      return t.map(fn, js("x"));
    }
    if (args.every((a) => typeof a === "number")) {
      const nums = args as number[];
      switch (method) {
        case "linlin": return t.map((x) => linlin(x, nums), `(x - ${nums[0]}) / (${nums[1]} - ${nums[0]}) * (${nums[3]} - ${nums[2]}) + ${nums[2]}`);
        case "linexp": return t.map((x) => linexp(x, nums), `${nums[2]} * (${nums[3]} / ${nums[2]}) ** ((x - ${nums[0]}) / (${nums[1]} - ${nums[0]}))`);
        case "round": return t.map((x) => numOp("round", x, nums[0] ?? 1) as number, `Math.round(x / ${nums[0] ?? 1}) * ${nums[0] ?? 1}`);
        case "clip": return t.map((x) => Math.max(nums[0], Math.min(nums[1], x)), `Math.max(${nums[0]}, Math.min(${nums[1]}, x))`);
      }
      if (OP_JS[method] && nums.length === 1) return this.binop(method, t, nums[0]);
    }
    return this.send(t.realize(this.rng), method, args);
  }

  private clockSend(c: ClockV, method: string, args: Value[]): Value {
    switch (method) {
      case "tempo": return c.tempo;
      case "tempo_": c.tempo = num(args[0], c.tempo); c.explicit = true; return c;
      case "beats": return this.routine?.time ?? 0;
      case "play": case "sched": case "schedAbs": {
        const fn = args.find((a) => a instanceof SCFunc);
        if (fn instanceof SCFunc) this.startRoutine(new RoutineV(fn, 0), c, true);
        return c;
      }
      case "permanent_": case "clear": case "stop": return c;
    }
    return null;
  }

  private scaleSend(s: ScaleV, method: string, args: Value[]): Value {
    switch (method) {
      case "degrees": case "semitones": case "asArray": return s.degrees.slice();
      case "size": return s.degrees.length;
      case "at": case "wrapAt": return s.degrees[mod(num(args[0], 0), s.degrees.length)];
      case "degreeToKey": return degreeToKey(num(args[0], 0), s, s.stepsPerOctave);
      case "pitchesPerOctave": case "stepsPerOctave": return s.stepsPerOctave;
      case "name": return s.name;
    }
    return s;
  }

  private synthDefSend(def: SynthDefV, method: string, line: number): Value {
    if (["add", "store", "send", "load", "writeDefFile", "memStore", "draw", "dumpUGens"].includes(method)) {
      this.synthDefs.set(def.name, def);
      return def;
    }
    if (method === "play") {
      this.synthDefs.set(def.name, def);
      this.recordSynth(new SynthV(def.name, new SCEvent()), line);
      return new Opaque("a synth");
    }
    if (method === "name") return new Sym(def.name);
    return def;
  }

  private routineSend(r: RoutineV, method: string, args: Value[], kwargs: Record<string, Value>, line: number): Value {
    if (method === "play" || method === "start" || method === "fork") {
      const clock = args.find((a) => a instanceof ClockV) ?? kwargs.clock;
      return this.startRoutine(r, clock instanceof ClockV ? clock : this.defaultClock, true);
    }
    if (method === "next" || method === "value") return null;
    void line;
    return r;
  }

  private signalSend(n: GNode, method: string, args: Value[], kwargs: Record<string, Value>): Value {
    if (UNARY[method] || ["tanh", "distort", "softclip", "atan", "abs", "squared", "sqrt", "midiratio", "midicps", "dbamp", "neg", "sign", "exp", "cubed", "reciprocal", "sin", "cos"].includes(method)) {
      return new GNode("unop", method, { a: n });
    }
    switch (method) {
      case "range": case "exprange": case "unipolar": case "bipolar":
        return new GNode("unop", method, { a: n, lo: args[0] ?? kwargs.lo ?? (method === "bipolar" ? -1 : 0), hi: args[1] ?? kwargs.hi ?? 1 });
      case "madd": return this.binop("+", this.binop("*", n, args[0] ?? 1), args[1] ?? 0);
      case "dup": case "!": return Array.from({ length: num(args[0], 2) }, () => n);
      case "lag": case "lag2": case "lag3": case "varlag": case "lagud": return n;
      case "clip": case "fold": case "wrap": return new GNode("unop", method, { a: n, lo: args[0] ?? 0, hi: args[1] ?? 1 });
      case "clip2": case "fold2": case "wrap2": case "round": case "max": case "min": case "pow": case "lcm":
        return this.binop(method, n, args[0] ?? 1);
      case "linlin": case "linexp": case "lincurve":
        return new GNode("unop", method, { a: n, inMin: args[0] ?? 0, inMax: args[1] ?? 1, outMin: args[2] ?? 0, outMax: args[3] ?? 1 });
      case "sum": return n;
      case "value": case "kr": case "ar": case "ir": return n;
    }
    if (OP_JS[method]) return this.binop(method, n, args[0] ?? null);
    return new GNode("unop", method, { a: n });
  }

  private envSend(env: EnvSpec, method: string, args: Value[], kwargs: Record<string, Value>): Value {
    if (method === "ar" || method === "kr") {
      // Env(...).ar(doneAction, gate, timeScale, levelScale, levelBias)
      return new GNode("env", "EnvGen", {
        envelope: env,
        doneAction: args[0] ?? kwargs.doneAction ?? 0,
        gate: args[1] ?? kwargs.gate ?? 1,
        timeScale: args[2] ?? kwargs.timeScale ?? 1,
        levelScale: args[3] ?? kwargs.levelScale ?? 1,
        levelBias: args[4] ?? kwargs.levelBias ?? 0,
      }, method);
    }
    if (method === "duration" || method === "totalDuration") return env.times.reduce((s: number, t) => s + num(t, 0), 0);
    if (method === "plot" || method === "test") return env;
    return this.binop("*", env, args[0] ?? 1);
  }

  // ------------------------------------------------------------ classes

  private classSend(name: string, method: string, args: Value[], kwargs: Record<string, Value>, line: number): Value {
    if (PATTERN_CLASSES.has(name)) return this.makePattern(name, method, args, kwargs, line);
    switch (name) {
      case "Array": case "List": case "Set": case "Signal": case "OrderedIdentitySet": case "IdentitySet": case "FloatArray":
        return this.arrayClass(method, args);
      case "Event": case "Dictionary": case "IdentityDictionary": case "Environment": case "Library":
        return method === "default" ? new SCEvent() : new SCEvent();
      case "Rest": return new RestV(num(args[0], 1));
      case "SynthDef": {
        if (method === "new" || method === "") {
          const n = args[0] ?? kwargs.name;
          const fn = args[1] ?? kwargs.ugenGraphFunc;
          return new SynthDefV(describeText(n), fn instanceof SCFunc ? fn : null, line);
        }
        return null;
      }
      case "Synth": {
        // Synth(\name, [args]), Synth.new, Synth.head(target, \name, args), Synth.grain
        let defName: Value = args[0];
        let argList: Value = args[1];
        if (method === "head" || method === "tail" || method === "before" || method === "after" || method === "replace") {
          defName = args[1];
          argList = args[2];
        }
        const ev = new SCEvent();
        const list = asList(argList ?? kwargs.args ?? []);
        for (let i = 0; i + 1 < list.length; i += 2) ev.set(describeText(list[i]), list[i + 1]);
        const synth = new SynthV(describeText(defName ?? null), ev);
        this.recordSynth(synth, line);
        return synth;
      }
      case "TempoClock": {
        if (method === "default") return this.defaultClock;
        if (method === "tempo") return this.defaultClock.tempo;
        if (method === "tempo_") { this.defaultClock.tempo = num(args[0], 1); this.defaultClock.explicit = true; return this.defaultClock; }
        if (method === "new") return new ClockV(num(args[0] ?? kwargs.tempo, 1), true);
        return this.defaultClock;
      }
      case "SystemClock": case "AppClock": return method === "play" || method === "sched" ? this.clockSend(new ClockV(1, true), "play", args) : new ClockV(1, true);
      case "Routine": case "Task": case "Tdef": {
        const fn = args.find((a) => a instanceof SCFunc);
        if (name === "Tdef" && !(fn instanceof SCFunc)) return new Opaque("Tdef");
        return fn instanceof SCFunc ? new RoutineV(fn, line) : null;
      }
      case "Scale": {
        if (method === "new") {
          const deg = asList(args[0] ?? []).map((v) => num(v, 0));
          return new ScaleV("custom", deg, num(args[1], 12));
        }
        if (method === "at") return this.scale(describeText(args[0] ?? null));
        return this.scale(method);
      }
      case "Env": return this.makeEnv(method, args, kwargs);
      case "Server": return new Opaque("the server");
      case "Out": case "OffsetOut": case "ReplaceOut": case "XOut": {
        if (this.graph) this.graph.outputs.push(args[1] ?? kwargs.channelsArray ?? null);
        return 0;
      }
      case "Mix": {
        const items = asList(method === "fill" ? Array.from({ length: num(args[0], 1) }, (_, i) => this.value(args[1] ?? null, [i])) : args[0] ?? []);
        return items.reduce((s: Value, v) => this.binop("+", s, v), 0);
      }
      case "NamedControl": return new GNode("control", describeText(args[0] ?? null), { default: args[1] ?? 0 }, method);
      case "Rand": case "ExpRand": case "IRand": return new GNode("rand", name, { lo: args[0] ?? 0, hi: args[1] ?? 1 }, "ir");
      case "MIDIClient": case "MIDIOut": case "MIDIIn": case "MIDIdef": case "MIDIFunc":
        this.note("MIDI is not converted.");
        return new Opaque(name);
      case "Buffer":
        this.note("Buffers (sound files) are not loaded: load samples with samples() in TidalJS.");
        return new Opaque("a buffer");
      case "Ndef": case "ProxySpace": case "NodeProxy":
        this.note(name + " (JITLib proxies) is not converted.");
        return new Opaque(name);
      case "Quarks": case "Window": case "Slider": case "Button": case "View": case "ServerOptions": case "OSCdef": case "OSCFunc": case "NetAddr":
      case "Platform": case "CmdPeriod": case "Document": case "Bus": case "Group": case "FreqScope": case "Stethoscope":
        return new Opaque(name);
    }
    // A UGen: Saw.ar(...), LPF.ar(...)
    if (["ar", "kr", "ir", "new"].includes(method) && (UGEN_INPUTS[name] || this.graph)) {
      const names = UGEN_INPUTS[name] ?? [];
      // Multichannel expansion: an array input makes one UGen per element, as in SuperCollider.
      const arrayInputs = new Set(["inArray", "channelsArray", "specificationsArrayRef", "array", "envelope"]);
      const expandable = (v: Value, key: string) => Array.isArray(v) && !arrayInputs.has(key);
      const width = Math.max(0, ...args.map((a, i) => (expandable(a, names[i] ?? "in" + i) ? (a as Value[]).length : 0)),
        ...Object.entries(kwargs).map(([k, v]) => (expandable(v, k) ? (v as Value[]).length : 0)));
      if (width > 0) {
        const pick = (v: Value, key: string, i: number) => (expandable(v, key) ? (v as Value[])[i % (v as Value[]).length] : v);
        return Array.from({ length: width }, (_, i) => this.classSend(name, method,
          args.map((a, k) => pick(a, names[k] ?? "in" + k, i)),
          Object.fromEntries(Object.entries(kwargs).map(([k, v]) => [k, pick(v, k, i)])), line));
      }
      const inputs: Record<string, Value> = {};
      args.forEach((a, i) => { inputs[names[i] ?? "in" + i] = a; });
      for (const [k, v] of Object.entries(kwargs)) inputs[k] = v;
      const node = new GNode("ugen", name, inputs, method);
      // mul and add are arithmetic.
      let out: Value = node;
      if (inputs.mul !== undefined && inputs.mul !== 1) out = this.binop("*", out, inputs.mul);
      if (inputs.add !== undefined && inputs.add !== 0) out = this.binop("+", out, inputs.add);
      return out;
    }
    if (method === "new" || method === "ar" || method === "kr") {
      this.note(name + " is not supported.");
      return new Opaque(name);
    }
    return new Opaque(name + "." + method);
  }

  private scale(name: string): ScaleV {
    const degrees = SCALES[name];
    if (!degrees) {
      this.note("Scale." + name + " is not known: major is used.");
      return new ScaleV("major", SCALES.major);
    }
    return new ScaleV(name, degrees);
  }

  private arrayClass(method: string, args: Value[]): Value {
    switch (method) {
      case "series": { const n = num(args[0], 0), start = num(args[1], 0), step = num(args[2], 1); return Array.from({ length: n }, (_, i) => start + i * step); }
      case "geom": { const n = num(args[0], 0), start = num(args[1], 1), grow = num(args[2], 2); return Array.from({ length: n }, (_, i) => start * Math.pow(grow, i)); }
      case "fill": { const n = num(args[0], 0); return Array.from({ length: n }, (_, i) => this.value(args[1] ?? null, [i])); }
      case "interpolation": { const n = num(args[0], 2), a = num(args[1], 0), b = num(args[2], 1); return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1)); }
      case "rand": case "exprand": case "rand2": {
        this.note("Array." + method + " is random: the TidalJS code keeps one draw.");
        const n = num(args[0], 0), lo = num(args[1], 0), hi = num(args[2], 1);
        return Array.from({ length: n }, () => (method === "exprand" ? lo * Math.pow(hi / lo, this.rng()) : lo + this.rng() * (hi - lo)));
      }
      case "with": return args.slice();
      case "fib": { const n = num(args[0], 2); const out = [num(args[1], 0), num(args[2], 1)]; while (out.length < n) out.push(out[out.length - 1] + out[out.length - 2]); return out.slice(0, n); }
    }
    return [];
  }

  private makeEnv(method: string, args: Value[], kwargs: Record<string, Value>): Value {
    const get = (names: string[], defaults: Value[]) => {
      const out: Record<string, Value> = {};
      names.forEach((n, i) => { out[n] = args[i] ?? kwargs[n] ?? defaults[i]; });
      return out;
    };
    switch (method) {
      case "new": case "": {
        const p = get(["levels", "times", "curve", "releaseNode", "loopNode"], [[0, 1, 0], [1, 1], new Sym("lin"), null, null]);
        return new EnvSpec("new", p, asList(p.levels), asList(p.times), p.curve, typeof p.releaseNode === "number" ? p.releaseNode : null);
      }
      case "perc": {
        const p = get(["attackTime", "releaseTime", "level", "curve"], [0.01, 1, 1, -4]);
        return new EnvSpec("perc", p, [0, p.level, 0], [p.attackTime, p.releaseTime], p.curve, null);
      }
      case "adsr": {
        const p = get(["attackTime", "decayTime", "sustainLevel", "releaseTime", "peakLevel", "curve"], [0.01, 0.3, 0.5, 1, 1, -4]);
        return new EnvSpec("adsr", p, [0, p.peakLevel, this.binop("*", p.peakLevel, p.sustainLevel), 0], [p.attackTime, p.decayTime, p.releaseTime], p.curve, 2);
      }
      case "asr": {
        const p = get(["attackTime", "sustainLevel", "releaseTime", "curve"], [0.01, 1, 1, -4]);
        return new EnvSpec("asr", p, [0, p.sustainLevel, 0], [p.attackTime, p.releaseTime], p.curve, 1);
      }
      case "linen": {
        const p = get(["attackTime", "sustainTime", "releaseTime", "level", "curve"], [0.01, 1, 1, 1, new Sym("lin")]);
        return new EnvSpec("linen", p, [0, p.level, p.level, 0], [p.attackTime, p.sustainTime, p.releaseTime], p.curve, null);
      }
      case "triangle": case "sine": {
        const p = get(["dur", "level"], [1, 1]);
        const half = this.binop("*", p.dur, 0.5);
        return new EnvSpec(method, { attackTime: half, releaseTime: half, level: p.level }, [0, p.level, 0], [half, half], method === "sine" ? new Sym("sin") : new Sym("lin"), null);
      }
      case "dadsr": {
        const p = get(["delayTime", "attackTime", "decayTime", "sustainLevel", "releaseTime", "peakLevel", "curve"], [0.1, 0.01, 0.3, 0.5, 1, 1, -4]);
        return new EnvSpec("adsr", p, [0, 0, p.peakLevel, p.sustainLevel, 0], [p.delayTime, p.attackTime, p.decayTime, p.releaseTime], p.curve, 3);
      }
      case "cutoff": {
        const p = get(["releaseTime", "level", "curve"], [0.1, 1, new Sym("lin")]);
        return new EnvSpec("asr", { attackTime: 0, sustainLevel: p.level, releaseTime: p.releaseTime }, [p.level, 0], [p.releaseTime], p.curve, 0);
      }
    }
    return new Opaque("Env." + method);
  }

  private makePattern(name: string, method: string, a: Value[], kw: Record<string, Value>, line: number): Value {
    const arg = (i: number, key: string, def: Value): Value => (a[i] !== undefined ? a[i] : kw[key] !== undefined ? kw[key] : def);
    if (name === "Pdef" || name === "Pdefn") {
      const key = describeText(arg(0, "key", null));
      const def = arg(1, "item", undefined as unknown as Value);
      const store = name === "Pdef" ? this.pdefs : this.pdefns;
      if (def !== undefined && def !== null) store.set(key, def);
      return new PdefRef(key, name === "Pdefn");
    }
    if (name === "Pbindef") {
      const key = describeText(a[0] ?? null);
      const pairs = toPairs(a.slice(1), kw);
      const old = this.pdefs.get(key);
      if (old instanceof Pbind) {
        // Pbindef(\x, \freq, 300) changes one key and keeps the rest.
        for (const [k, v] of pairs) {
          const i = old.pairs.findIndex(([ok]) => ok instanceof Sym && k instanceof Sym && ok.name === k.name);
          if (i >= 0) old.pairs[i] = [k, v];
          else old.pairs.push([k, v]);
        }
      } else {
        this.pdefs.set(key, new Pbind(pairs, line));
      }
      return new PdefRef(key, false);
    }
    if (method !== "new") return new Opaque(name + "." + method);
    switch (name) {
      case "Pseq": return new Pseq(arg(0, "list", []), arg(1, "repeats", 1), arg(2, "offset", 0));
      case "Pser": return new Pser(arg(0, "list", []), arg(1, "repeats", 1), arg(2, "offset", 0));
      case "Prand": case "Pxrand": return new Prand(name, arg(0, "list", []), arg(1, "repeats", 1));
      case "Pwrand": return new Prand("Pwrand", arg(0, "list", []), arg(2, "repeats", 1), asList(arg(1, "weights", [])).map((w) => num(w, 0)));
      case "Pshuf": return new Pshuf(arg(0, "list", []), arg(1, "repeats", 1));
      case "Pwhite": {
        // Pwhite(0, 7) gives integers; Pwhite(0.0, 7) or Pwhite(-1.0, 1.0) gives floats.
        const p = new Pwhite("Pwhite", arg(0, "lo", 0), arg(1, "hi", 1), arg(2, "length", Infinity));
        p.floats = this.floatArgs;
        this.floatArgs = false;
        return p;
      }
      case "Pexprand": return new Pwhite("Pexprand", arg(0, "lo", 0.0001), arg(1, "hi", 1), arg(2, "length", Infinity));
      case "Pbrown": case "Pgbrown": return new Pbrown(num(arg(0, "lo", 0), 0), num(arg(1, "hi", 1), 1), num(arg(2, "step", 0.125), 0.125), arg(3, "length", Infinity));
      case "Pgauss": case "Pmeanrand": {
        this.note(name + " is drawn: TidalJS repeats fixed draws of it.");
        const lo = num(arg(0, "lo", 0), 0), hi = num(arg(1, "hi", 1), 1);
        return new Pdraw(name, () => (name === "Pgauss" ? lo + hi * gauss(this.rng) : lo + (this.rng() + this.rng()) / 2 * (hi - lo)), arg(2, "length", Infinity));
      }
      case "Pseries": return new Pseries("Pseries", arg(0, "start", 0), arg(1, "step", 1), arg(2, "length", Infinity));
      case "Pgeom": return new Pseries("Pgeom", arg(0, "start", 1), arg(1, "grow", 1), arg(2, "length", Infinity));
      case "Pn": return new Pn(arg(0, "pattern", null), arg(1, "repeats", Infinity));
      case "Pdup": case "Pstutter": return new Pdup(arg(0, "n", 2), arg(1, "pattern", null));
      case "Pkey": return new Pkey(describeText(arg(0, "key", null)));
      case "Pfunc": return new Pfunc("Pfunc", arg(0, "nextFunc", null), Infinity);
      case "Pfuncn": return new Pfunc("Pfuncn", arg(0, "func", null), arg(1, "repeats", 1));
      case "Plazy": return new Plazy(arg(0, "func", null));
      case "Pchain": return new Pchain(a.slice());
      case "Pfin": return new Pfin(arg(0, "count", 1), arg(1, "pattern", null));
      case "Pslide": return new Pslide(asList(arg(0, "list", [])), arg(1, "repeats", 1), num(arg(2, "len", 3), 3), num(arg(3, "step", 1), 1), num(arg(4, "start", 0), 0), arg(5, "wrapAtEnd", true) !== false);
      case "Place": return new Place(asList(arg(0, "list", [])), arg(1, "repeats", 1));
      case "Ppatlace": return new Ppatlace(asList(arg(0, "list", [])), arg(1, "repeats", 1));
      case "Pswitch": case "Pswitch1": return new Pswitch(name, asList(arg(0, "list", [])), arg(1, "which", 0));
      case "Pif": return new Pif(arg(0, "condition", null), arg(1, "iftrue", null), arg(2, "iffalse", null));
      case "Pseg": return new Pseg(asList(arg(0, "levels", [0])).map((v) => num(v, 0)), asList(arg(1, "durs", [1])).map((v) => num(v, 1)), arg(2, "curves", new Sym("lin")), arg(3, "repeats", 1));
      case "Pbjorklund": case "Pbjorklund2": return new Pbjorklund(name, num(arg(0, "k", 3), 3), num(arg(1, "n", 8), 8), arg(2, "length", Infinity), num(arg(3, "offset", 0), 0));
      case "Pcollect": case "Pselect": case "Preject": {
        const fn = arg(0, "func", null);
        return fn instanceof SCFunc ? new Pcollect(name, fn, arg(1, "pattern", null)) : new Pn(null, 0);
      }
      case "Prout": {
        const fn = arg(0, "routineFunc", null);
        return fn instanceof SCFunc ? new Plist("Prout", this.collect(fn)) : new Pn(null, 0);
      }
      case "Pbind": return new Pbind(toPairs(a, kw), line);
      case "Pmono": case "PmonoArtic": {
        const instrument = a[0] ?? kw.instrument ?? new Sym("default");
        this.note(name + " plays one synth that changes; TidalJS plays a note per event (legato 1).");
        return new Pbind([[new Sym("instrument"), instrument], [new Sym("legato"), 1], ...toPairs(a.slice(1), kw)], line, true);
      }
      case "Ppar": case "Pgpar": {
        const items = asList(arg(0, "list", []));
        return new Ppar("Ppar", items, items.map(() => 0), arg(1, "repeats", 1));
      }
      case "Ptpar": {
        const flat = asList(arg(0, "list", []));
        const offsets: number[] = [];
        const items: Value[] = [];
        for (let i = 0; i + 1 < flat.length; i += 2) { offsets.push(num(flat[i], 0)); items.push(flat[i + 1]); }
        return new Ppar("Ptpar", items, offsets, arg(1, "repeats", 1));
      }
      case "Pbindf": return new Pchain([new Pbind(toPairs(a.slice(1), kw), line), a[0] ?? null]);
      case "Pset": case "Padd": case "Pmul": return new Pmath(name, describeText(arg(0, "name", null)), arg(1, "value", null), arg(2, "pattern", null));
      case "Pfset": return a[1] ?? null;
      case "Pfindur": return new Pfindur(num(arg(0, "dur", 4), 4), arg(1, "pattern", null));
      case "Psync": return new Psync(arg(0, "pattern", null), num(arg(1, "quant", 1), 1), num(arg(2, "maxdur", 0), 0));
      case "Pconst": {
        this.note("Pconst is not modelled: its pattern plays as it is.");
        return arg(1, "pattern", null);
      }
      case "Pfx": case "Pfxb": case "Pproto": {
        this.note(name + " effects are not converted: its pattern plays dry.");
        return a[0] ?? null;
      }
    }
    this.note(name + " is not supported.");
    return new Pn(null, 0);
  }

  // ------------------------------------------------------------ playing

  private recordPattern(p: Value, clock: ClockV, line: number, label: string) {
    if (this.routine) {
      this.routine.events.push({ time: this.routine.time, event: new SCEvent([["__pattern", p as Value], ["__line", line]]) });
      return;
    }
    this.played.push({ kind: "pattern", pattern: p, start: 0, clock, line, label });
  }

  private recordSynth(synth: SynthV, line: number) {
    const ev = synth.args.copy();
    ev.set("instrument", new Sym(synth.name));
    ev.set("__synth", true);
    if (!this.routine) ev.set("__top", true);
    this.recordEvent(ev, line);
  }

  private recordEvent(ev: SCEvent, line: number) {
    if (this.routine) {
      this.routine.events.push({ time: this.routine.time, event: ev.copy() });
      return;
    }
    this.played.push({ kind: "event", event: ev.copy(), start: 0, clock: this.defaultClock, line, label: describeText(ev.get("instrument") ?? new Sym("default")) });
  }

  /** A routine's events, up to the horizon: they become a played pattern. */
  private startRoutine(r: RoutineV, clock: ClockV, play: boolean): Value {
    let endless = false;
    if (!play) return r;
    if (this.routine) {
      // A routine started from a routine: run it inline, at the current time.
      const saved = this.routine.time;
      try { this.call(r.fn, []); } catch (err) { if (!(err instanceof Horizon)) throw err; }
      this.routine.time = saved;
      return r;
    }
    const state = { time: 0, horizon: 512, events: [] as RoutineEvent[], clock };
    this.routine = state;
    try {
      this.call(r.fn, []);
    } catch (err) {
      if (err instanceof Horizon || err instanceof TooMuchWork) endless = true;
      else {
        this.note("Line " + r.line + ": a routine stopped: " + (err instanceof Error ? err.message : String(err)));
      }
    } finally {
      this.routine = null;
    }
    this.played.push({ kind: "routine", routine: r, start: 0, clock, line: r.line, label: "routine", endless, pattern: routinePattern(state.events, state.time, r.line) });
    return r;
  }

  /** n.wait inside a routine moves its clock; in a Prout, yield collects a value. */
  private advance(x: Value): Value {
    if (this.collecting) {
      this.collecting.push(x);
      if (this.collecting.length >= 2000) throw new StopCollect();
      return x;
    }
    if (this.routine && typeof x === "number") {
      this.routine.time += x;
      if (this.routine.time >= this.routine.horizon) throw new Horizon();
    }
    return x;
  }

  /** The values a Prout yields (up to 2000). */
  private collect(fn: SCFunc): Value[] {
    const saved = this.collecting;
    const out: Value[] = [];
    this.collecting = out;
    try {
      this.call(fn, [new SCEvent()]);
    } catch (err) {
      if (!(err instanceof StopCollect) && !(err instanceof TooMuchWork)) throw err;
    } finally {
      this.collecting = saved;
    }
    if (out.length >= 2000) this.note("A Prout that never ends: its first 2000 values loop.");
    return out;
  }

  /** Runs a SynthDef's function with symbolic signals; returns its output. */
  graphOf(def: SynthDefV): { output: Value; controls: Map<string, GNode> } | null {
    if (!def.fn) return null;
    const controls = new Map<string, GNode>();
    const saved = this.graph;
    this.graph = { outputs: [] };
    try {
      const args = def.fn.params.map((p) => {
        const init = p.init ? this.eval(p.init, def.fn!.scope) : 0;
        const c = new GNode("control", p.name, { default: init }, "kr");
        controls.set(p.name, c);
        return c;
      });
      const ret = this.call(def.fn, args);
      const output = this.graph.outputs.length ? this.graph.outputs[this.graph.outputs.length - 1] : ret;
      collectControls(output, controls);
      return { output, controls };
    } catch (err) {
      this.note("SynthDef \\" + def.name + " could not be analysed: " + (err instanceof Error ? err.message : String(err)));
      return null;
    } finally {
      this.graph = saved;
    }
  }
}

// ---------------------------------------------------------------- helpers

/** A routine's events as an event pattern: each event at its time, then rests. */
function routinePattern(events: RoutineEvent[], end: number, line: number): Value {
  const sorted = events.slice().sort((a, b) => a.time - b.time);
  const items: Value[] = [];
  let t = 0;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.time > t + 1e-9) {
      items.push(new SCEvent([["dur", new RestV(e.time - t)], ["__rest", true], ["__src", "r" + line]]));
      t = e.time;
    }
    // The last event lasts until the routine ends (a beat when it ends there).
    const next = i + 1 < sorted.length ? sorted[i + 1].time : end > e.time + 1e-9 ? end : e.time + 1;
    const ev = e.event.copy();
    ev.set("delta", next - e.time);
    if (!ev.has("__src")) ev.set("__src", "r" + line + ":" + describeText(ev.get("instrument") ?? null));
    if (!ev.has("__line")) ev.set("__line", line);
    items.push(ev);
    t = next;
  }
  return new Plist("Routine", items);
}

function collectControls(v: Value, out: Map<string, GNode>, seen = new Set<unknown>()) {
  if (seen.has(v)) return;
  if (typeof v === "object" && v !== null) seen.add(v);
  if (v instanceof GNode) {
    if (v.kind === "control" && !out.has(v.name)) out.set(v.name, v);
    for (const x of Object.values(v.inputs)) collectControls(x, out, seen);
  } else if (Array.isArray(v)) {
    for (const x of v) collectControls(x, out, seen);
  } else if (v instanceof EnvSpec) {
    for (const x of [...Object.values(v.params), ...v.levels, ...v.times]) collectControls(x, out, seen);
  }
}

function toSignal(v: Value): Value {
  return v;
}

export function asList(v: Value): Value[] {
  return Array.isArray(v) ? v : [v];
}

export function num(v: Value | undefined, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

function toPairs(args: Value[], kw: Record<string, Value>): [Value, Value][] {
  const out: [Value, Value][] = [];
  for (let i = 0; i + 1 < args.length; i += 2) out.push([args[i], args[i + 1]]);
  for (const [k, v] of Object.entries(kw)) out.push([new Sym(k), v]);
  return out;
}

function equals(a: Value, b: Value): boolean {
  if (a instanceof Sym && b instanceof Sym) return a.name === b.name;
  if (a instanceof Sym && typeof b === "string") return a.name === b;
  if (typeof a === "string" && b instanceof Sym) return a === b.name;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equals(x, b[i]));
  return a === b;
}

export function describeText(v: Value): string {
  if (v instanceof Sym) return v.name;
  if (typeof v === "string") return v;
  return describe(v);
}

function fmtJs(n: number) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(6)));
}

function linlin(x: number, args: Value[]) {
  const [a, b, c, d] = args.map((v) => num(v, 0));
  return ((x - a) / (b - a)) * (d - c) + c;
}

function linexp(x: number, args: Value[]) {
  const a = num(args[0], 0), b = num(args[1], 1), c = num(args[2], 1), d = num(args[3], 2);
  const y = Math.max(a, Math.min(b, x));
  return Math.pow(d / c, (y - a) / (b - a)) * c;
}

function gauss(rng: () => number) {
  return Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(2 * Math.PI * rng());
}

/** degree.degreeToKey(scale, stepsPerOctave), as sclang. */
export function degreeToKey(degree: number, scale: Value, stepsPerOctave = 12): number {
  const degrees = scale instanceof ScaleV ? scale.degrees : Array.isArray(scale) ? scale.map((v) => num(v, 0)) : SCALES.major;
  const steps = scale instanceof ScaleV ? scale.stepsPerOctave : stepsPerOctave;
  const size = degrees.length;
  const d = Math.round(degree);
  const accidental = (degree - d) * 10;
  const base = steps * Math.floor(d / size) + degrees[mod(d, size)];
  return accidental === 0 ? base : base + accidental * (steps / 12);
}

function labelOf(p: Pattern): string {
  if (p instanceof PdefRef) return p.key;
  return p.name;
}
