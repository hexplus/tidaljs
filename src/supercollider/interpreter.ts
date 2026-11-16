/**
 * Runs a SuperCollider program far enough to know what it would play: the
 * SynthDefs it defines, the patterns, routines, synths and events it plays,
 * and on which clock. Data (arrays, numbers, scales, envelopes) is computed
 * as sclang does; patterns become generators (patterns.ts); a SynthDef's
 * function runs with symbolic signals (GNode) so its graph can be analysed.
 */
import { ConversionLimit, sized, tick } from "./budget.ts";
import type { Node } from "./parser.ts";
import {
  DONE, Pattern, Pdraw, Pbind, Pbinop, Pbjorklund, Pbrown, Pchain, Pcollect, Pconst, PdefRef, Pdup, Pfin, Pfindur,
  Pfunc, Pfx, Pif, Pkey, Plazy, Plist, Pmath, Pn, Ppar, Ppatlace, Place, Prand, Pseg, Pseq, Pser, Pseries, Pshuf, Pslide,
  Pswitch, Psync, Punop, Pwhite, Stream, mod, type Host,
} from "./patterns.ts";
import {
  Assoc, BufferV, BusV, ClockV, EnvSpec, GNode, MidiOutV, NetAddrV, Opaque, ProxyV, RandToken, RestV, RoutineV, SCClass,
  SCEvent, SCFunc, ScaleV, Scope, Sym, SynthDefV, SynthV, WidgetV, WindowV, LayoutV, TextV, describe, isPattern, seededRandom, type Value,
} from "./values.ts";

/** A SynthDef's graph: its main output, its controls, and every Out with its bus. */
export interface Graph {
  output: Value;
  controls: Map<string, GNode>;
  outs: { bus: Value; channels: Value }[];
  mainBus: Value;
}

/** Something the program plays. */
export interface PlayRecord {
  kind: "pattern" | "routine" | "synth" | "event" | "midikeys" | "oscplay";
  pattern?: Value;
  routine?: RoutineV;
  synth?: SynthV;
  event?: SCEvent;
  /** When it starts, in beats of its clock. */
  start: number;
  /** A routine that loops forever (it ran until the horizon). */
  endless?: boolean;
  /** midikeys: the MIDI channel its notes come from (null: any). */
  channel?: number | null;
  /** midikeys: how far the pitch-bend wheel bends the held notes, in semitones (0: not at all). */
  bendRange?: number;
  /** oscplay: the OSC address whose messages start the synth. */
  path?: string;
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
/** A statement, routine or pattern did too much work without getting anywhere (an endless loop that never waits). */
export class TooMuchWork extends Error {}
/** The most work one statement, routine or pattern event may do. */
const MAX_WORK = 2_000_000;
/** The most events a routine may start at one instant (a loop that starts synths without waiting). */
const MAX_SAME_TIME = 10_000;
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
  XLine: ["start", "end", "dur", "mul", "add", "doneAction"],
  MouseX: ["minval", "maxval", "warp", "lag"], MouseY: ["minval", "maxval", "warp", "lag"], MouseButton: ["minval", "maxval", "lag"],
  EnvGen: ["envelope", "gate", "levelScale", "levelBias", "timeScale", "doneAction"],
  Decay: ["in", "decayTime", "mul", "add"], Decay2: ["in", "attackTime", "decayTime", "mul", "add"], Lag: ["in", "lagTime", "mul", "add"],
  Klank: ["specificationsArrayRef", "input", "freqscale", "freqoffset", "decayscale"], Formant: ["fundfreq", "formfreq", "bwfreq", "mul", "add"],
  Decimator: ["in", "rate", "bits", "mul", "add"], PlayBuf: ["numChannels", "bufnum", "rate", "trigger", "startPos", "loop", "doneAction"],
  Rand: ["lo", "hi"], ExpRand: ["lo", "hi"], IRand: ["lo", "hi"], TRand: ["lo", "hi", "trig"], Mix: ["array"],
  In: ["bus", "numChannels"], InFeedback: ["bus", "numChannels"], LocalIn: ["numChannels", "default"], LocalOut: ["channelsArray"],
  XFade2: ["inA", "inB", "pan", "level"], LinXFade2: ["inA", "inB", "pan", "level"],
  SinOscFB: ["freq", "feedback", "mul", "add"], BufFrames: ["bufnum"], BufDur: ["bufnum"], BufSamples: ["bufnum"],
  GrainSin: ["numChannels", "trigger", "dur", "freq", "pan", "envbufnum", "maxGrains", "mul", "add"],
  GrainFM: ["numChannels", "trigger", "dur", "carfreq", "modfreq", "index", "pan", "envbufnum", "maxGrains", "mul", "add"],
  GrainBuf: ["numChannels", "trigger", "dur", "sndbuf", "rate", "pos", "interp", "pan", "envbufnum", "maxGrains", "mul", "add"],
  TGrains: ["numChannels", "trigger", "bufnum", "rate", "centerPos", "dur", "pan", "amp", "interp"],
  Warp1: ["numChannels", "bufnum", "pointer", "freqScale", "windowSize", "envbufnum", "overlaps", "windowRandRatio", "interp", "mul", "add"],
  BufRd: ["numChannels", "bufnum", "phase", "loop", "interpolation"],
};

/** GUI classes: they make no sound, so they are left out (their values keep their starting values). */
const GUI_CLASSES = new Set([
  "Window", "Slider", "Knob", "Button", "View", "CompositeView", "UserView", "EZSlider", "EZKnob", "EZNumber", "NumberBox",
  "StaticText", "TextField", "Slider2D", "RangeSlider", "MultiSliderView", "PopUpMenu", "ListView", "CheckBox", "FreqScope",
  "Stethoscope", "ServerMeter", "ServerMeterView", "HLayout", "VLayout", "GridLayout", "QWindow", "SCWindow", "Pen",
  "Color", "Font", "Rect", "Point", "LevelIndicator", "EnvelopeView", "SoundFileView", "ScopeView", "QtGUI", "GUI",
]);

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
  /** While a routine runs: its time in beats, the events it plays, and the work done when it last waited. */
  private routine: { time: number; horizon: number; events: RoutineEvent[]; clock: ClockV; waited: number; sameTime: number } | null = null;
  /** While a Prout runs to collect its values. */
  private collecting: Value[] | null = null;
  /** Whether the bounds of the Pwhite being made were written as floats (1.0), as SuperCollider tells. */
  private floatArgs = false;
  /** While a SynthDef's function runs: the outputs it writes (and to which bus). */
  private graph: { outputs: { bus: Value; channels: Value }[] } | null = null;
  /** Buses (audio buses after the 16 hardware channels) and buffers. */
  readonly buses: BusV[] = [];
  private audioBuses = 16;
  private controlBuses = 0;
  readonly buffers: BufferV[] = [];
  /** JITLib proxies (Ndef, NodeProxy, ~x in a ProxySpace) and Tdefs. */
  readonly proxies = new Map<string, ProxyV>();
  private proxySpace = false;
  private readonly tdefs = new Map<string, Value>();
  /** Synths started from code: the event each one plays, to end it on release, free or set(\gate, 0). */
  private readonly synthPlays = new Map<SynthV, { ev: SCEvent; time: number; inRoutine: boolean; line: number }>();
  /** MIDI notes started with noteOn in a routine and not ended yet. */
  private readonly midiNotes = new Map<string, { ev: SCEvent; time: number }>();
  /** True while patterns are played for the conversion: random values in code stay random there. */
  inPattern = false;
  /** GUI controls, and the functions MIDI and OSC input call. */
  private readonly widgets: WidgetV[] = [];
  private readonly inputs: { kind: "cc" | "noteOn" | "bend" | "touch" | "polytouch" | "osc"; fn: SCFunc; num: Value; chan: Value; path: string; line: number; order?: string }[] = [];
  /** GUI windows and views: their controls become groups of the Controls panel (controlLayout). */
  readonly windows: WindowV[] = [];
  /** Slider2D and RangeSlider: the words after the label of their two sliders. */
  private readonly pairParts = new WeakMap<WidgetV, [string, string]>();
  /** While a MIDI note function runs for the conversion: the synths it starts (they become midikeys). */
  private capture: SynthV[] | null = null;
  /** The synths MIDI note functions start (midikeys), and while a pitch-bend function runs, how far it bends them. */
  private keySynths = new Set<SynthV>();
  private bendSeen: number[] | null = null;
  /** The synth a note function keeps, and the copy of it that becomes the midikeys template. */
  private keyCopies = new Map<SynthV, SynthV>();
  /** While a polyphonic aftertouch function runs: whether it changed the held notes (each key's own pressure). */
  private polyTouch: { keys: boolean } | null = null;
  /** Synths in routines get a tie id (1 to 8), so a synth that changes (synth.set) continues its note. */
  private tieCount = 0;

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
      // Each statement has its own allowance of work.
      this.work = 0;
      try {
        this.eval(node, this.global);
      } catch (err) {
        if (err instanceof ConversionLimit) throw err;
        if (err instanceof Horizon) continue;
        if (err instanceof TooMuchWork) {
          this.note("Line " + node.line + " never finishes (a loop that does not end?): SuperCollider would hang there, so it was stopped.");
          continue;
        }
        this.note("Line " + node.line + " could not be run: " + (err instanceof Error ? err.message : String(err)));
      }
    }
    this.work = 0;
    this.finishInputs();
    this.work = 0;
    this.finishProxies();
  }

  /** A fresh allowance of work (each event the conversion plays has its own). */
  resetWork() {
    this.work = 0;
  }

  /** A step of work (a pattern's step too): an endless loop stops here. */
  tick() {
    if (++this.work > MAX_WORK) throw new TooMuchWork("too much work");
    tick();
  }

  // ------------------------------------------------------------ evaluation

  eval(node: Node, scope: Scope): Value {
    this.tick();
    switch (node.t) {
      case "num": return node.v;
      case "str": return node.v;
      case "sym": return new Sym(node.v);
      case "char": return node.v;
      case "bool": return node.v;
      case "nil": return null;
      case "var": return this.lookup(node.name, scope);
      case "env": return this.proxySpace ? this.proxy(node.name) : this.envir.get(node.name) ?? null;
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
          // a ?? b, a ?? { b }: b (the function's value) when a is nil.
          const a = this.eval(node.a, scope);
          if (a !== null) return a;
          const b = this.eval(node.b, scope);
          return b instanceof SCFunc ? this.call(b, []) : b;
        }
        if (node.op === "!?") {
          // a !? { |x| ... }: the function of a when a is not nil.
          const a = this.eval(node.a, scope);
          if (a === null) return null;
          const b = this.eval(node.b, scope);
          return b instanceof SCFunc ? this.call(b, [a]) : b;
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
            if (err instanceof Horizon || err instanceof TooMuchWork || err instanceof StopCollect || err instanceof ConversionLimit) throw err;
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
      if (this.proxySpace) this.setProxySource(this.proxy(target.name), 0, value, target.line);
      else this.envir.set(target.name, value);
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
    this.tick();
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
    // JITLib routing: fx <<> source and source <>> fx feed the source into the effect's \in.
    if (op === "<<>" && a instanceof ProxyV) { a.settings.set("in", b); return a; }
    if (op === "<>>" && b instanceof ProxyV) { b.settings.set("in", a); return b; }
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
      if (!js) return this.binop(op, a.realize(this.rng), b);
      const lin: [number, number] | undefined = op === "*" ? [b, 0] : op === "/" ? [1 / b, 0] : op === "+" ? [1, b] : op === "-" ? [1, -b] : undefined;
      return a.map((x) => numOp(op, x, b) as number, js("x", fmtJs(b)), lin);
    }
    if (typeof a === "number" && b instanceof RandToken) {
      const js = OP_JS[op];
      if (!js) return this.binop(op, a, b.realize(this.rng));
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
      if (op === "rrand") return this.rrand(a, b);
      if (op === "exprand") return this.random("exp", [a, b], "exprand", () => a * Math.pow(b / a, this.rng()));
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
    this.note(what + " and other random calls run once, when the file runs, are drawn once as in SuperCollider: the TidalJS code keeps that draw.");
    return v;
  }

  /** Code that runs again and again (a routine, a Pfunc, a Prout): random values there become TidalJS random signals. */
  private get repeating(): boolean {
    return (this.routine !== null || this.inPattern || this.collecting !== null) && this.graph === null;
  }

  /** A random value: a random signal where the code repeats, else one draw (as SuperCollider draws it once). */
  private random(kind: RandToken["kind"], args: Value[], what: string, draw: () => Value): Value {
    if (this.repeating) return new RandToken(kind, args);
    this.drawn(what, 0);
    return draw();
  }

  private rrand(a: number, b: number): Value {
    const ints = Number.isInteger(a) && Number.isInteger(b);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return this.random(ints ? "iwhite" : "white", [lo, hi], "rrand", () => (ints ? lo + Math.floor(this.rng() * (hi - lo + 1)) : lo + this.rng() * (hi - lo)));
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
    if (recv instanceof SynthV) return this.synthSend(recv, method, args, line);
    if (recv instanceof BusV) return this.busSend(recv, method, args);
    if (recv instanceof BufferV) return this.bufferSend(recv, method, line);
    if (recv instanceof ProxyV) return this.proxySend(recv, method, args, kwargs, line);
    if (recv instanceof MidiOutV) return this.midiSend(recv, method, args, line);
    if (recv instanceof NetAddrV) return this.oscSend(method, args, line, false);
    if (recv instanceof WidgetV) return this.widgetSend(recv, method, args);
    if (recv instanceof WindowV) return this.windowSend(recv, method, args);
    if (recv instanceof LayoutV) return this.layoutSend(recv, method, args);
    if (recv instanceof TextV) {
      if (method === "string_" || method === "object_") recv.text = describeText(args[0] ?? null);
      if (method === "string" || method === "object") return recv.text;
      if (method === "bounds_") recv.bounds = rectOf(args[0] ?? null);
      return recv;
    }
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
    if (recv.desc === "the server") {
      if (method === "sendMsg" || method === "sendBundle" || method === "listSendMsg" || method === "listSendBundle") return this.oscSend(method, args, line, true);
      if (["meter", "scope", "plotTree", "makeGui", "makeWindow", "freqscope", "volume"].includes(method)) this.gui();
    }
    if (recv.desc === "a ProxySpace") {
      if (method === "push") this.proxySpace = true;
      if (method === "pop" || method === "clear") this.proxySpace = method !== "pop" && this.proxySpace;
      return recv;
    }
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
      case "rand": return Number.isInteger(x)
        ? this.random("iwhite", [0, x - 1], "rand", () => Math.floor(this.rng() * x))
        : this.random("white", [0, x], "rand", () => this.rng() * x);
      case "rand2": return Number.isInteger(x)
        ? this.random("iwhite", [-x, x], "rand2", () => -x + Math.floor(this.rng() * (2 * x + 1)))
        : this.random("white", [-x, x], "rand2", () => (this.rng() * 2 - 1) * x);
      case "rrand": return this.rrand(x, num(args[0], 0));
      case "exprand": { const hi = num(args[0], 1); return this.random("exp", [x, hi], "exprand", () => x * Math.pow(hi / x, this.rng())); }
      case "coin": return this.drawn("coin", this.rng() < x ? 1 : 0) === 1;
      case "even": return mod(x, 2) === 0;
      case "odd": return mod(x, 2) === 1;
      case "isInteger": return Number.isInteger(x);
      case "dup": case "!": {
        const n = sized(num(args[0] ?? kwargs.n, 2));
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
        return Array.from({ length: sized(x) }, (_, i) => (fn instanceof SCFunc ? this.call(fn, [i, i]) : i));
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
        let i = args[0];
        if (i instanceof RandToken) i = i.realize(this.rng);
        if (Array.isArray(i)) return i.map((k) => arr[num(k, 0)] ?? null);
        return arr[num(i, 0)] ?? null;
      }
      case "clipAt": return arr[Math.max(0, Math.min(arr.length - 1, num(args[0], 0)))] ?? null;
      case "wrapAt": return arr[mod(num(args[0], 0), arr.length)] ?? null;
      case "foldAt": { const n = arr.length; const r = mod(num(args[0], 0), 2 * n - 2 || 1); return arr[r < n ? r : 2 * n - 2 - r] ?? null; }
      case "atAll": return asList(args[0]).map((k) => arr[num(k, 0)] ?? null);
      case "first": return arr[0] ?? null;
      case "last": return arr[arr.length - 1] ?? null;
      case "put": {
        // An index from a live input (a MIDI note) takes its starting value, as at() does.
        const i = args[0] instanceof RandToken ? args[0].realize(this.rng) : args[0];
        arr[num(i ?? null, 0)] = args[1] ?? null;
        return arr;
      }
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
      case "stutter": case "dupEach": { const n = sized(num(args[0], 2)); sized(n * arr.length); return arr.flatMap((v) => Array.from({ length: n }, () => v)); }
      case "dup": case "!": { const n = sized(num(args[0], 2)); sized(n * arr.length); return Array.from({ length: n }, () => arr.slice()); }
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
      case "choose": {
        const simple = arr.length > 0 && arr.every((v) => typeof v === "number" || v instanceof Sym || typeof v === "string");
        if (!simple) return this.drawn("choose", 0) === 0 ? arr[Math.floor(this.rng() * arr.length)] ?? null : null;
        return this.random("choose", [arr.slice()], "choose", () => arr[Math.floor(this.rng() * arr.length)] ?? null);
      }
      case "wchoose": {
        const token = new RandToken("wchoose", [arr.slice(), asList(args[0]).map((w) => num(w, 0))]);
        const simple = arr.every((v) => typeof v === "number" || v instanceof Sym || typeof v === "string");
        return simple ? this.random("wchoose", token.args, "wchoose", () => token.realize(this.rng)) : (this.drawn("wchoose", 0), token.realize(this.rng));
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
        const n = sized(num(args[0], arr.length));
        return Array.from({ length: n }, (_, i) => { const item = arr[i % arr.length]; return Array.isArray(item) ? item[Math.floor(i / arr.length) % item.length] : item; });
      }
      case "wrapExtend": { const n = sized(num(args[0], arr.length)); return Array.from({ length: n }, (_, i) => arr[i % arr.length]); }
      case "clipExtend": { const n = sized(num(args[0], arr.length)); return Array.from({ length: n }, (_, i) => arr[Math.min(i, arr.length - 1)]); }
      case "foldExtend": { const n = sized(num(args[0], arr.length)); return Array.from({ length: n }, (_, i) => this.arraySend(arr, "foldAt", [i], {}, line)); }
      case "pyramid": { const out: Value[] = []; for (let i = 1; i <= arr.length; i++) out.push(...arr.slice(0, i)); return out; }
      case "asSpec": return this.spec(arr[0] ?? 0, arr[1] ?? 1, arr[2] ?? new Sym("lin"), arr[4] ?? null);
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
        const n = sized(num(args[0], 2));
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
            this.tick();
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
    if (method === "asSpec") {
      const specs: Record<string, [number, number, string]> = {
        freq: [20, 20000, "exp"], lofreq: [0.1, 100, "exp"], midfreq: [25, 4200, "exp"], widefreq: [0.1, 20000, "exp"], amp: [0, 1, "amp"],
        pan: [-1, 1, "lin"], bipolar: [-1, 1, "lin"], unipolar: [0, 1, "lin"], midi: [0, 127, "lin"], midinote: [0, 127, "lin"],
        midivelocity: [1, 127, "lin"], db: [-100, 0, "db"], delay: [0.0001, 1, "exp"], rate: [0.125, 8, "exp"], detune: [-20, 20, "lin"], phase: [0, 6.283185, "lin"],
      };
      const sp = specs[sym.name] ?? [0, 1, "lin"];
      return this.spec(sp[0], sp[1], new Sym(sp[2]), null);
    }
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
      case "map": case "unmap": {
        // A ControlSpec maps 0..1 to its range.
        if (!ev.has("__spec")) break;
        const lo = ev.get("minval") ?? 0, hi = ev.get("maxval") ?? 1;
        const exp = ev.get("warp") instanceof Sym && (ev.get("warp") as Sym).name === "exp";
        return method === "map"
          ? this.send(args[0] ?? 0, exp ? "linexp" : "linlin", [0, 1, lo, hi])
          : this.send(args[0] ?? 0, exp ? "explin" : "linlin", [lo, hi, 0, 1]);
      }
      case "asSpec": return ev;
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
    if (method === "wait" || method === "yield" || method === "sleep") return this.advance(t);
    if (UNARY[method] && args.length === 0) {
      const [fn, js] = UNARY[method];
      return t.map(fn, js("x"));
    }
    if (args.every((a) => typeof a === "number")) {
      const nums = args as number[];
      switch (method) {
        case "linlin": {
          // A straight line (without the clipping at the ends, which live inputs never pass).
          const k = (nums[3] - nums[2]) / (nums[1] - nums[0] || 1);
          return t.map((x) => linlin(x, nums), `(x - ${nums[0]}) / (${nums[1]} - ${nums[0]}) * (${nums[3]} - ${nums[2]}) + ${nums[2]}`, [k, nums[2] - nums[0] * k]);
        }
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
      case "dup": case "!": return Array.from({ length: sized(num(args[0], 2)) }, () => n);
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
      case "Routine": case "Task": {
        const fn = args.find((a) => a instanceof SCFunc);
        return fn instanceof SCFunc ? new RoutineV(fn, line) : null;
      }
      case "Tdef": {
        // Tdef(\name, { ... }) defines (the last definition wins), Tdef(\name) refers to it.
        const key = describeText(args[0] ?? null);
        const fn = args.find((a) => a instanceof SCFunc);
        if (fn instanceof SCFunc) this.tdefs.set(key, new RoutineV(fn, line));
        return this.tdefs.get(key) ?? new Opaque("Tdef");
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
        // XOut(bus, xfade, channels): the others are Out(bus, channels).
        const channels = name === "XOut" ? args[2] ?? kwargs.channelsArray ?? null : args[1] ?? kwargs.channelsArray ?? null;
        if (this.graph) this.graph.outputs.push({ bus: args[0] ?? kwargs.bus ?? 0, channels });
        return 0;
      }
      case "Mix": {
        const items = asList(method === "fill" ? Array.from({ length: sized(num(args[0], 1)) }, (_, i) => this.value(args[1] ?? null, [i])) : args[0] ?? []);
        return items.reduce((s: Value, v) => this.binop("+", s, v), 0);
      }
      case "NamedControl": return new GNode("control", describeText(args[0] ?? null), { default: args[1] ?? 0 }, method);
      case "Rand": case "ExpRand": case "IRand": return new GNode("rand", name, { lo: args[0] ?? 0, hi: args[1] ?? 1 }, "ir");
      case "MIDIClient": return new Opaque("MIDIClient");
      case "MIDIOut": {
        if (method === "newByName") return new MidiOutV(describeText(args[0] ?? null));
        return new MidiOutV(num(args[0] ?? kwargs.port, 0));
      }
      case "MIDIIn": {
        // MIDIIn.connectAll; the old MIDIIn.control = { |src, chan, num, val| } and noteOn = { |src, chan, num, vel| }.
        const fn = args[0];
        const kinds: Record<string, "cc" | "noteOn" | "bend" | "touch" | "polytouch"> = { control_: "cc", noteOn_: "noteOn", bend_: "bend", touch_: "touch", polytouch_: "polytouch" };
        if (kinds[method] && fn instanceof SCFunc) {
          const kind = kinds[method];
          this.inputs.push({ kind, fn, num: null, chan: null, path: "", line, order: kind === "bend" || kind === "touch" ? "src,chan,val" : "src,chan,num,val" });
        }
        return new Opaque("MIDIIn");
      }
      case "MIDIdef": case "MIDIFunc": case "CCResponder": case "NoteOnResponder": {
        // MIDIdef.cc(\key, func, ccNum, chan), MIDIFunc.cc(func, ccNum, chan); noteOn alike.
        const rest = name === "MIDIdef" ? args.slice(1) : args;
        let type = method;
        if (method === "new" || method === "") type = name === "CCResponder" ? "cc" : name === "NoteOnResponder" ? "noteOn" : describeText(rest[4] ?? kwargs.msgType ?? new Sym("noteOn"));
        if (type === "control") type = "cc";
        const fn = rest[0] ?? kwargs.func;
        if (fn instanceof SCFunc && (type === "cc" || type === "noteOn" || type === "polytouch")) {
          this.inputs.push({ kind: type, fn, num: rest[1] ?? kwargs.ccNum ?? kwargs.noteNum ?? kwargs.msgNum ?? null, chan: rest[2] ?? kwargs.chan ?? null, path: "", line });
        } else if (fn instanceof SCFunc && (type === "bend" || type === "touch")) {
          // MIDIdef.bend(\key, func, chan): no message number.
          this.inputs.push({ kind: type, fn, num: null, chan: rest[1] ?? kwargs.chan ?? null, path: "", line });
        } else if (type !== "noteOff" && type !== "freeAll" && type !== "free") {
          this.note("MIDI " + type + " input is left out: TidalJS reads control changes (midicc), notes (midikeys), pitch bend (midibend) and aftertouch (miditouch).");
        }
        return new Opaque(name);
      }
      case "MIDIresponder": return new Opaque(name);
      case "OSCdef": case "OSCFunc": case "OSCresponder": case "OSCresponderNode": {
        // OSCdef(\key, func, path), OSCFunc(func, path): the values it reads become oscIn(path, index).
        const rest = name === "OSCdef" ? args.slice(1) : args;
        const fn = rest[0] ?? kwargs.func;
        const path = describeText(rest[1] ?? kwargs.path ?? null);
        if (fn instanceof SCFunc && path) this.inputs.push({ kind: "osc", fn, num: null, chan: null, path: path.startsWith("/") ? path : "/" + path, line });
        return new Opaque(name);
      }
      case "NetAddr": {
        if (method === "localAddr") return new NetAddrV("127.0.0.1", 57120);
        return new NetAddrV(describeText(args[0] ?? kwargs.hostname ?? "127.0.0.1"), num(args[1] ?? kwargs.port, 57120));
      }
      case "Bus": {
        const rate = method === "control" ? "control" : "audio";
        const channels = num(args[1] ?? kwargs.numChannels, 1);
        const index = rate === "audio" ? this.audioBuses : this.controlBuses;
        if (rate === "audio") this.audioBuses += channels;
        else this.controlBuses += channels;
        const bus = new BusV(rate, index, channels);
        this.buses.push(bus);
        return bus;
      }
      case "Buffer": {
        if (["read", "readChannel", "cueSoundFile", "readNoUpdate", "readWithInfo"].includes(method)) {
          const path = describeText(args[1] ?? kwargs.path ?? null);
          return this.buffer(path);
        }
        return this.buffer(null);
      }
      case "BufRateScale": return 1;
      case "BufSampleRate": case "SampleRate": return 44100;
      case "BufChannels": return 2;
      case "Ndef": {
        const key = describeText(args[0] ?? kwargs.key ?? null);
        const proxy = this.proxy(key);
        if (method === "ar" || method === "kr") return this.proxySignal(proxy);
        const source = args[1] ?? kwargs.object;
        if (source !== undefined) this.setProxySource(proxy, 0, source, line);
        return proxy;
      }
      case "NodeProxy": {
        const proxy = this.proxy("nodeproxy" + line);
        if (args[1] !== undefined && !(args[1] instanceof Opaque)) this.setProxySource(proxy, 0, args[1], line);
        return proxy;
      }
      case "ProxySpace": {
        if (method === "push") this.proxySpace = true;
        if (method === "pop") this.proxySpace = false;
        return new Opaque("a ProxySpace");
      }
      case "Group": case "ParGroup": case "RootNode":
        // Groups only order synths on the server; the order is kept by the effects (In.ar) here.
        return new Opaque("a group");
      case "Platform": return new Opaque("Platform." + method);
      case "Quarks": case "ServerOptions": case "CmdPeriod": case "Document": case "ServerTree": case "ServerBoot":
        return new Opaque(name);
    }
    if (name === "ControlSpec") return this.spec(args[0] ?? 0, args[1] ?? 1, args[2] ?? new Sym("lin"), args[4] ?? null);
    const gui = this.guiClass(name, method, args, kwargs, line);
    if (gui !== undefined) return gui;
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
      case "series": { const n = sized(num(args[0], 0)), start = num(args[1], 0), step = num(args[2], 1); return Array.from({ length: n }, (_, i) => start + i * step); }
      case "geom": { const n = sized(num(args[0], 0)), start = num(args[1], 1), grow = num(args[2], 2); return Array.from({ length: n }, (_, i) => start * Math.pow(grow, i)); }
      case "fill": { const n = sized(num(args[0], 0)); return Array.from({ length: n }, (_, i) => this.value(args[1] ?? null, [i])); }
      case "interpolation": { const n = sized(num(args[0], 2)), a = num(args[1], 0), b = num(args[2], 1); return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1)); }
      case "rand": case "exprand": case "rand2": {
        this.note("Array." + method + " is random: the TidalJS code keeps one draw.");
        const n = sized(num(args[0], 0)), lo = num(args[1], 0), hi = num(args[2], 1);
        return Array.from({ length: n }, () => (method === "exprand" ? lo * Math.pow(hi / lo, this.rng()) : lo + this.rng() * (hi - lo)));
      }
      case "with": return args.slice();
      case "fib": { const n = sized(num(args[0], 2)); const out = [num(args[1], 0), num(args[2], 1)]; while (out.length < n) out.push(out[out.length - 1] + out[out.length - 2]); return out.slice(0, n); }
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
        if (name === "PmonoArtic") this.note("PmonoArtic's articulations are slurred: every note continues the synth (tie).");
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
      case "Pconst": return new Pconst(num(arg(0, "sum", 1), 1), arg(1, "pattern", null), num(arg(2, "tollerance", 0.001), 0.001));
      case "Pfx": case "Pfxb": {
        // Pfx(pattern, \fx, args...): the pattern's events go through the effect synth.
        const fx = new SynthV(describeText(arg(1, "fxname", null)), new SCEvent(toPairs(a.slice(2), {}).map(([k, v]) => [describeText(k), v])));
        return new Pfx(name, arg(0, "pattern", null), fx);
      }
      case "Pproto": return this.pproto(arg(0, "makeFunction", null), arg(1, "pattern", null));
    }
    this.note(name + " is not supported.");
    return new Pn(null, 0);
  }

  /** Pproto(makeFunction, pattern): its \\on events start effect synths (applied to the pattern), \\audioBus events make buses. */
  private pproto(make: Value, pattern: Value): Value {
    if (!(make instanceof SCFunc)) return pattern;
    const before = new Map(this.envir);
    this.call(make, []);
    let out = pattern;
    for (const [key, value] of this.envir) {
      if (before.get(key) === value || !(value instanceof SCEvent)) continue;
      const type = value.get("type");
      const typeName = type instanceof Sym ? type.name : "";
      if (typeName === "audioBus" || typeName === "controlBus") {
        this.envir.set(key, this.classSend("Bus", typeName === "audioBus" ? "audio" : "control", [null, value.get("channels") ?? 2], {}, 0));
      } else if (typeName === "on" || typeName === "note") {
        const args = value.copy();
        const instrument = describeText(args.get("instrument") ?? new Sym("default"));
        args.map.delete("type");
        args.map.delete("instrument");
        out = new Pfx("Pproto", out, new SynthV(instrument, args));
      }
    }
    return out;
  }

  /** Notes once what happens to GUIs. */
  private gui() {
    this.note("GUI sliders, knobs, buttons and menus become TidalJS sliders and toggles; each window becomes a group of the Controls panel, laid out as in SuperCollider (controlLayout).");
  }

  /** GUI classes: windows, views, layouts, labels and controls; other GUI classes are left out. Undefined when the class is not a GUI one. */
  private guiClass(name: string, method: string, args: Value[], kwargs: Record<string, Value>, line: number): Value | undefined {
    const creating = method === "new" || method === "";
    switch (name) {
      case "Rect": return creating ? [num(args[0] ?? kwargs.left, 0), num(args[1] ?? kwargs.top, 0), num(args[2] ?? kwargs.width, 0), num(args[3] ?? kwargs.height, 0)] : new Opaque("Rect." + method);
      case "Window": case "QWindow": case "SCWindow": {
        if (!creating) return new Opaque(name + "." + method);
        const w = new WindowV(describeText(args[0] ?? kwargs.name ?? null), line);
        this.windows.push(w);
        return w;
      }
      case "View": case "CompositeView": case "UserView": case "ScrollView": case "HLayoutView": case "VLayoutView": {
        if (!creating) return new Opaque(name + "." + method);
        const v = new WindowV("", line);
        const parent = args[0] ?? kwargs.parent ?? null;
        if (parent instanceof WindowV) { v.parent = parent; parent.children.push(v); }
        v.bounds = rectOf(args[1] ?? kwargs.bounds ?? null);
        if (name === "HLayoutView" || name === "VLayoutView") v.layout = new LayoutV(name === "HLayoutView" ? "h" : "v", []);
        this.windows.push(v);
        return v;
      }
      case "HLayout": case "VLayout": return new LayoutV(name === "HLayout" ? "h" : "v", args.slice());
      case "GridLayout": {
        if (method === "rows") return new LayoutV("grid", args.map((r) => (Array.isArray(r) ? r.slice() : [r])));
        if (method === "columns") {
          const cols = args.map((c) => (Array.isArray(c) ? c : [c]));
          const n = Math.max(0, ...cols.map((c) => c.length));
          return new LayoutV("grid", Array.from({ length: n }, (_, i) => cols.map((c) => c[i] ?? null)));
        }
        return new LayoutV("grid", []);
      }
      case "StaticText": {
        const t = new TextV("");
        const parent = args[0] ?? kwargs.parent ?? null;
        t.bounds = rectOf(args[1] ?? kwargs.bounds ?? null);
        if (parent instanceof WindowV) { t.window = parent; parent.children.push(t); }
        return t;
      }
      case "Slider": case "Knob": case "Button": case "EZSlider": case "EZKnob": case "EZNumber": case "NumberBox": case "CheckBox":
      case "PopUpMenu": case "EZPopUpMenu": case "Slider2D": case "RangeSlider": case "EZRanger": case "ListView":
        if (!creating) return new Opaque(name + "." + method);
        this.gui();
        return this.widget(name, args, kwargs, line);
    }
    if (GUI_CLASSES.has(name)) {
      this.gui();
      return new Opaque(name);
    }
    return undefined;
  }

  private windowSend(w: WindowV, method: string, args: Value[]): Value {
    switch (method) {
      case "layout_": if (args[0] instanceof LayoutV) w.layout = args[0]; return w;
      case "layout": return w.layout;
      case "name_": w.title = describeText(args[0] ?? null); return w;
      case "name": return w.title;
      case "bounds_": w.bounds = rectOf(args[0] ?? null); return w;
      case "addFlowLayout": w.layout = new LayoutV("h", []); return w;
      case "decorator_": if (!w.layout) w.layout = new LayoutV("h", []); return w;
      case "children": return w.children;
    }
    // view, front, alwaysOnTop_, background_, onClose_, refresh...: the window itself.
    return w;
  }

  private layoutSend(l: LayoutV, method: string, args: Value[]): Value {
    switch (method) {
      case "add": case "addSpanning": {
        const item = args[0] ?? null;
        if (l.kind === "grid" && typeof args[1] === "number") {
          const row = args[1], col = num(args[2] ?? 0, 0);
          while (l.items.length <= row) l.items.push([]);
          const r = l.items[row] as Value[];
          r[col] = item;
        } else l.items.push(item);
        return l;
      }
      case "insert": l.items.splice(num(args[1] ?? 0, 0), 0, args[0] ?? null); return l;
    }
    return l;
  }

  /** A ControlSpec, as an event with minval, maxval and warp. */
  private spec(lo: Value, hi: Value, warp: Value, def: Value): SCEvent {
    const w = warp instanceof Sym ? warp.name : typeof warp === "string" ? warp : "lin";
    return new SCEvent([["__spec", true], ["minval", num(lo, 0)], ["maxval", num(hi, 1)], ["warp", new Sym(w)], ["default", typeof def === "number" ? def : num(lo, 0)]]);
  }

  /** Slider, Knob, Button, EZSlider, PopUpMenu...: a TidalJS slider or toggle with the GUI's range, label and value. */
  private widget(name: string, args: Value[], kwargs: Record<string, Value>, line: number): WidgetV {
    const n = this.widgets.length + 1;
    let w: WidgetV;
    const labelArg = args[2] ?? kwargs.label ?? null;
    const named = typeof labelArg === "string" || labelArg instanceof Sym;
    const specOf = (sp: Value): SCEvent => {
      if (sp instanceof Sym || Array.isArray(sp)) sp = this.send(sp, "asSpec", []);
      return sp instanceof SCEvent ? sp : this.spec(0, 1, new Sym("lin"), null);
    };
    if (name === "Button") w = new WidgetV("toggle", "button" + n, 0, 0, 1, false, line);
    else if (name === "CheckBox") {
      w = new WidgetV("toggle", named ? describeText(labelArg) : "checkbox" + n, 0, 0, 1, false, line);
      w.named = named;
    } else if (name === "PopUpMenu" || name === "ListView" || name === "EZPopUpMenu") {
      w = new WidgetV("slider", name === "EZPopUpMenu" && named ? describeText(labelArg) : "menu" + n, 0, 0, 1, false, line);
      w.step = 1;
      w.named = name === "EZPopUpMenu" && named;
      const items = name === "EZPopUpMenu" ? args[3] ?? kwargs.items : null;
      if (Array.isArray(items)) w.max = Math.max(0, items.length - 1);
    } else if (name === "Slider2D" || name === "RangeSlider" || name === "EZRanger") {
      const ranger = name !== "Slider2D";
      const base = name === "EZRanger" && named ? describeText(labelArg) : (ranger ? "range" : "xy") + n;
      const parts: [string, string] = ranger ? ["lo", "hi"] : ["x", "y"];
      const spec = name === "EZRanger" ? specOf(args[3] ?? kwargs.controlSpec ?? null) : this.spec(0, 1, new Sym("lin"), null);
      const lo = num(spec.get("minval"), 0), hi = num(spec.get("maxval"), 1);
      const init = name === "EZRanger" ? args[5] ?? kwargs.initVal : null;
      w = new WidgetV("slider", base + " " + parts[0], Array.isArray(init) ? num(init[0] ?? null, lo) : lo, lo, hi, false, line);
      w.pair = new WidgetV("slider", base + " " + parts[1], Array.isArray(init) ? num(init[1] ?? null, hi) : ranger ? hi : lo, lo, hi, false, line);
      w.named = name === "EZRanger" && named;
      this.pairParts.set(w, parts);
      if (name === "EZRanger") { const action = args[4] ?? kwargs.action; if (action instanceof SCFunc) w.action = action; }
    } else if (name.startsWith("EZ")) {
      // EZSlider(parent, bounds, label, controlSpec, action, initVal)
      const spec = specOf(args[3] ?? kwargs.controlSpec ?? null);
      const lo = num(spec.get("minval"), 0), hi = num(spec.get("maxval"), 1);
      const exp = spec.get("warp") instanceof Sym && (spec.get("warp") as Sym).name === "exp";
      w = new WidgetV("slider", named ? describeText(labelArg) : (name === "EZKnob" ? "knob" : "slider") + n, num(args[5] ?? kwargs.initVal, num(spec.get("default"), lo)), lo, hi, exp, line);
      w.named = named;
      const action = args[4] ?? kwargs.action;
      if (action instanceof SCFunc) w.action = action;
    } else w = new WidgetV("slider", (name === "Knob" ? "knob" : name === "NumberBox" ? "number" : "slider") + n, 0, 0, 1, false, line);
    // Its window and where it sits: Slider(parent, bounds).
    const parent = args[0] ?? kwargs.parent ?? null;
    if (parent instanceof WindowV) { w.window = parent; parent.children.push(w); }
    w.bounds = rectOf(args[1] ?? kwargs.bounds ?? null);
    this.widgets.push(w);
    return w;
  }

  private widgetSend(w: WidgetV, method: string, args: Value[]): Value {
    const read = (x: WidgetV) => (this.widgetToken ? this.widgetToken(x) : this.repeating ? this.liveToken(x) : x.value);
    switch (method) {
      case "action_": if (args[0] instanceof SCFunc) w.action = args[0]; return w;
      case "value_": case "valueAction_": case "x_": case "lo_": case "activex_": case "activeLo_":
        w.value = num(args[0], w.value); return w;
      case "y_": case "hi_": case "activey_": case "activeHi_": if (w.pair) w.pair.value = num(args[0], w.pair.value); return w;
      case "setXY": case "setSpan": case "setSpanActive": case "setXYActive":
        w.value = num(args[0], w.value);
        if (w.pair) w.pair.value = num(args[1] ?? null, w.pair.value);
        return w;
      case "value": case "x": case "lo": return read(w);
      case "y": case "hi": return w.pair ? read(w.pair) : 0;
      case "range": return w.pair ? this.binop("-", read(w.pair), read(w)) : 0;
      case "label_": case "string_":
        w.label = describeText(args[0] ?? null) || w.label;
        w.named = true;
        return w;
      case "clipLo_": w.min = num(args[0], w.min); return w;
      case "clipHi_": w.max = num(args[0], w.max); return w;
      case "step_": w.step = Math.max(0, num(args[0], 0)); return w;
      case "items_": {
        if (Array.isArray(args[0])) { w.max = Math.max(0, args[0].length - 1); w.step = 1; w.kind = "slider"; }
        return w;
      }
      case "states_": {
        // [["Off"], ["On"]]: a switch named after its first state; more states: a slider over them.
        const states = Array.isArray(args[0]) ? args[0] : [];
        const first = Array.isArray(states[0]) ? states[0][0] : states[0];
        if (!w.named && (typeof first === "string" || first instanceof Sym) && describeText(first).trim()) {
          w.label = describeText(first).trim();
          w.named = true;
        }
        if (states.length > 2) { w.kind = "slider"; w.min = 0; w.max = states.length - 1; w.step = 1; }
        return w;
      }
      case "bounds_": w.bounds = rectOf(args[0] ?? null); return w;
    }
    return w;
  }

  /** A widget read where the code repeats (a Pfunc, a routine): its live value, a TidalJS slider or toggle. */
  private liveToken(x: WidgetV): RandToken {
    return x.kind === "toggle" ? new RandToken("toggle", [x.label, x.value !== 0]) : new RandToken("slider", [x.label, x.value, x.min, x.max, x.step]);
  }

  /** Set while the GUI's actions run for the conversion: what a widget's value becomes. */
  private widgetToken: ((w: WidgetV) => Value) | null = null;

  /**
   * After the program: the GUI actions, MIDI and OSC functions run once with live values (sliders, midicc,
   * midibend, miditouch, oscIn), so what they change (synth.set, a proxy's set, Pdefn...) follows the player.
   * MIDI note functions that start synths become midikeys; OSC functions that start synths become oscplay.
   */
  private finishInputs() {
    const run = (fn: SCFunc, args: Value[], line: number) => {
      try {
        this.call(fn, args);
      } catch (err) {
        if (err instanceof ConversionLimit) throw err;
        if (!(err instanceof Horizon || err instanceof TooMuchWork)) this.note("Line " + line + ": an input function could not be run: " + (err instanceof Error ? err.message : String(err)));
      }
    };
    this.labelWidgets();
    for (const w of this.widgets) {
      if (!w.action) continue;
      const label = w.label;
      this.widgetToken = (x) => this.liveToken(x);
      run(w.action, [w], w.line);
      this.widgetToken = null;
      if (w.exp) this.note("The GUI control " + label + " moves exponentially in SuperCollider; its TidalJS slider moves in a straight line over the same range.");
    }
    // Note functions first: a pitch-bend function bends the synths they start.
    const keyRecords: PlayRecord[] = [];
    for (const input of this.inputs) {
      if (input.kind !== "noteOn") continue;
      const chan = typeof input.chan === "number" ? input.chan : null;
      const vel = new RandToken("midivel", []), note = new RandToken("midinote", []);
      this.capture = [];
      run(input.fn, input.order ? [null, chan ?? 0, note, vel] : [vel, note, chan ?? 0, null], input.line);
      const synths = this.capture;
      this.capture = null;
      for (const synth of synths) {
        this.keySynths.add(synth);
        const rec: PlayRecord = { kind: "midikeys", synth, start: 0, clock: this.defaultClock, line: input.line, label: synth.name, channel: chan };
        this.played.push(rec);
        keyRecords.push(rec);
      }
      if (synths.length === 0) this.note("Line " + input.line + ": a MIDI note function that starts no synth is left out (TidalJS plays MIDI keys with midikeys).");
    }
    for (const input of this.inputs) {
      const chan = typeof input.chan === "number" ? input.chan : null;
      if (input.kind === "cc") {
        const ccNum = typeof input.num === "number" ? input.num : 0;
        if (typeof input.num !== "number") this.note("A MIDI function for every controller reads controller 0 here (midicc takes one controller).");
        const val = new RandToken("midicc", [ccNum, chan]);
        run(input.fn, input.order ? [null, chan ?? 0, ccNum, val] : [val, ccNum, chan ?? 0, null], input.line);
      } else if (input.kind === "bend") {
        // MIDIdef.bend: { |val, chan, src| }; the wheel's value is 0 to 16383 (8192 in the middle).
        const val = new RandToken("midibend", [chan]);
        this.bendSeen = [];
        run(input.fn, input.order ? [null, chan ?? 0, val] : [val, chan ?? 0, null], input.line);
        const ranges = this.bendSeen;
        this.bendSeen = null;
        if (ranges.length) {
          const range = Math.max(...ranges);
          for (const rec of keyRecords) if (chan === null || rec.channel === null || rec.channel === chan) rec.bendRange = range;
        }
      } else if (input.kind === "touch" || input.kind === "polytouch") {
        // MIDIdef.touch: { |val, chan, src| }; polytouch: { |val, num, chan, src| }. Both become miditouch (0 to 127 here).
        const val = new RandToken("miditouch", [chan]);
        if (input.kind === "touch") run(input.fn, input.order ? [null, chan ?? 0, val] : [val, chan ?? 0, null], input.line);
        else {
          const note = new RandToken("midinote", []);
          this.polyTouch = { keys: false };
          run(input.fn, input.order ? [null, chan ?? 0, note, val] : [val, note, chan ?? 0, null], input.line);
          const keys = this.polyTouch.keys;
          this.polyTouch = null;
          if (!keys) this.note("Line " + input.line + ": polyphonic aftertouch that does not change the held notes becomes miditouch, the pressure of the last key pressed.");
        }
      } else if (input.kind === "osc") {
        const msg: Value[] = [new Sym(input.path), ...Array.from({ length: 8 }, (_, i) => new RandToken("oscin", [input.path, i]))];
        this.capture = [];
        run(input.fn, [msg, 0, new NetAddrV("127.0.0.1", 57120), 57120], input.line);
        for (const synth of this.capture) {
          this.played.push({ kind: "oscplay", synth, start: 0, clock: this.defaultClock, line: input.line, label: synth.name, path: input.path });
        }
        this.capture = null;
      }
    }
  }

  /**
   * Labels for the GUI's controls that have none: the StaticText next to (or above) each one, in a layout or
   * by position. Then names are made unique, as TidalJS controls are found by name.
   */
  private labelWidgets() {
    const label = (w: WidgetV, text: string) => {
      const t = text.trim().replace(/[:=]\s*$/, "").trim();
      if (!t || w.named) return;
      const parts = this.pairParts.get(w);
      w.label = parts ? t + " " + parts[0] : t;
      if (w.pair && parts) w.pair.label = t + " " + parts[1];
      w.named = true;
    };
    const inLayout = (l: LayoutV, seen: Set<unknown>) => {
      if (seen.has(l)) return;
      seen.add(l);
      const lists: Value[][] = l.kind === "grid" ? l.items.map((r) => (Array.isArray(r) ? r : [r])) : [l.items];
      for (const list of lists) {
        const items = list.map(guiItem);
        items.forEach((item, i) => {
          if (item instanceof TextV) {
            const next = items[i + 1];
            if (next instanceof WidgetV) label(next, item.text);
          } else if (item instanceof LayoutV) inLayout(item, seen);
          else if (item instanceof WindowV && item.layout) inLayout(item.layout, seen);
        });
      }
    };
    const seen = new Set<unknown>();
    for (const win of this.windows) {
      if (win.layout) inLayout(win.layout, seen);
      // Placed by bounds: the label on the left in the same row, or just above.
      const texts = win.children.filter((c): c is TextV => c instanceof TextV && c.bounds !== null && c.text.trim() !== "");
      for (const w of win.children) {
        if (!(w instanceof WidgetV) || w.named || !w.bounds) continue;
        const [x, y, , h] = w.bounds;
        let best: TextV | null = null;
        let dist = Infinity;
        for (const t of texts) {
          const [tx, ty, tw, th] = t.bounds!;
          const left = Math.abs(ty + th / 2 - (y + h / 2)) <= Math.max(h, th) / 2 && tx + tw <= x + 4;
          const above = ty + th <= y + 4 && ty + th >= y - 40 && tx < x + Math.max(40, tw) && tx + tw > x - 4;
          if (!left && !above) continue;
          // Not when another control sits between the label and this one.
          const between = left && win.children.some((o) => o !== w && o instanceof WidgetV && o.bounds !== null
            && o.bounds[0] >= tx + tw - 4 && o.bounds[0] + o.bounds[2] <= x + 4 && Math.abs(o.bounds[1] - y) < Math.max(h, o.bounds[3]) / 2);
          if (between) continue;
          const d = left ? x - (tx + tw) : y - (ty + th) + 1;
          if (d < dist) { dist = d; best = t; }
        }
        if (best) label(w, best.text);
      }
    }
    // Unique names.
    const used = new Map<string, number>();
    for (const w of this.widgets.flatMap((x) => (x.pair ? [x, x.pair] : [x]))) {
      const n = (used.get(w.label) ?? 0) + 1;
      used.set(w.label, n);
      if (n > 1) w.label = w.label + " " + n;
    }
  }

  /**
   * The GUI's windows as groups of TidalJS's Controls panel: a title and rows of control names, as SuperCollider
   * lays them out (an HLayout is a row, a VLayout stacks rows, controls placed with bounds make rows by height).
   */
  windowLayouts(): { title: string; rows: string[][] }[] {
    const names = (w: WidgetV) => (w.pair ? [w.label, w.pair.label] : [w.label]);
    const rowsOf = (item: Value, depth: number): string[][] => {
      item = guiItem(item);
      if (depth > 20) return [];
      if (item instanceof WidgetV) return [names(item)];
      if (item instanceof WindowV) return windowRows(item, depth + 1);
      if (item instanceof LayoutV) {
        if (item.kind === "h") return [item.items.flatMap((x) => rowsOf(x, depth + 1).flat())].filter((r) => r.length);
        if (item.kind === "v") return item.items.flatMap((x) => rowsOf(x, depth + 1));
        return item.items.map((r) => (Array.isArray(r) ? r : [r]).flatMap((x) => rowsOf(x, depth + 1).flat())).filter((r) => r.length);
      }
      return [];
    };
    const contains = (l: LayoutV | null, v: WindowV, depth = 0): boolean => !!l && depth < 20 && l.items.some((x) => {
      const y = guiItem(x);
      return y === v || (y instanceof LayoutV && contains(y, v, depth + 1)) || (Array.isArray(y) && y.some((z) => guiItem(z) === v));
    });
    const windowRows = (win: WindowV, depth: number): string[][] => {
      const rows: string[][] = win.layout ? rowsOf(win.layout, depth) : [];
      const listed = new Set(rows.flat());
      const free = win.children.filter((c): c is WidgetV => c instanceof WidgetV && !listed.has(c.label));
      if (win.layout && win.layout.items.length === 0) {
        // A flow layout (addFlowLayout, FlowLayout): the controls one after another, wrapping.
        if (free.length) rows.push(free.flatMap(names));
      } else {
        const placed = free.filter((w) => w.bounds).sort((a, b) => a.bounds![1] - b.bounds![1] || a.bounds![0] - b.bounds![0]);
        let current: WidgetV[] = [];
        let top = -Infinity, height = 0;
        const flush = () => { if (current.length) rows.push(current.sort((a, b) => a.bounds![0] - b.bounds![0]).flatMap(names)); };
        for (const w of placed) {
          const [, y, , h] = w.bounds!;
          if (current.length && Math.abs(y - top) < Math.max(height, h, 1) / 2) current.push(w);
          else {
            flush();
            current = [w];
            top = y;
            height = h;
          }
        }
        flush();
        const rest = free.filter((w) => !w.bounds);
        if (rest.length) rows.push(rest.flatMap(names));
      }
      for (const v of win.children) if (v instanceof WindowV && !contains(win.layout, v)) rows.push(...windowRows(v, depth + 1));
      return rows;
    };
    const out: { title: string; rows: string[][] }[] = [];
    for (const win of this.windows) {
      if (win.parent) continue;
      const rows = windowRows(win, 0).filter((r) => r.length);
      if (rows.length) out.push({ title: win.title.trim() || "Controls", rows });
    }
    return out;
  }

  // ------------------------------------------------------------ buses, buffers, MIDI and OSC

  private buffer(path: string | null): BufferV {
    const bufnum = this.buffers.length;
    const base = path ? path.split(/[\\/]/).pop()!.replace(/\.[^.]*$/, "") : "buffer" + bufnum;
    let bank = base.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "buffer";
    if (/^[0-9]/.test(bank)) bank = "b" + bank;
    const taken = new Set(this.buffers.map((b) => b.bank));
    for (let i = 2, base2 = bank; taken.has(bank); i++) bank = base2 + i;
    const buf = new BufferV(path, bufnum, bank);
    this.buffers.push(buf);
    return buf;
  }

  private busSend(b: BusV, method: string, args: Value[]): Value {
    switch (method) {
      case "index": return b.index;
      case "numChannels": return b.channels;
      case "rate": return new Sym(b.rate);
      case "set": case "setSynchronous": case "setn": case "value_":
        b.value = Array.isArray(args[0]) ? args[0][0] ?? null : args[0] ?? null;
        return b;
      case "get": case "getSynchronous": case "value": return b.value;
      case "asMap": case "asBus": return b;
      case "ar": case "kr": return new GNode("ugen", "In", { bus: b, numChannels: b.channels }, method);
      case "subBus": return new BusV(b.rate, b.index + num(args[0], 0), num(args[1], 1));
    }
    return b;
  }

  private bufferSend(b: BufferV, method: string, line: number): Value {
    switch (method) {
      case "bufnum": return b.bufnum;
      case "path": return b.path;
      case "numChannels": return 2;
      case "sampleRate": return 44100;
      case "numFrames": case "duration":
        this.note("Buffer lengths are not known before the files load: a buffer is taken as 1 second long.");
        return method === "duration" ? 1 : 44100;
      case "play": {
        // b.play: the whole file, once.
        this.recordEvent(new SCEvent([["instrument", new Sym("__buffer")], ["buf", b], ["__synth", true], ["__top", !this.routine]]), line);
        return new Opaque("a synth");
      }
    }
    return b;
  }

  private midiSend(m: MidiOutV, method: string, args: Value[], line: number): Value {
    const chan = num(args[0], 0);
    const base = (): SCEvent => new SCEvent([["type", new Sym("midi")], ["midiout", m], ["chan", chan], ["instrument", new Sym("__midi")], ["__synth", true]]);
    const key = (n: Value) => String(m.selector) + ":" + chan + ":" + describeText(n);
    switch (method) {
      case "noteOn": {
        const ev = base();
        ev.set("midinote", args[1] ?? 60);
        ev.set("amp", this.binop("/", args[2] ?? 64, 127));
        const stored = this.recordEvent(ev, line);
        if (this.routine) this.midiNotes.set(key(args[1] ?? 60), { ev: stored, time: this.routine.time });
        return m;
      }
      case "noteOff": {
        const on = this.midiNotes.get(key(args[1] ?? 60));
        if (on && this.routine) {
          on.ev.set("sustain", this.routine.time - on.time);
          this.midiNotes.delete(key(args[1] ?? 60));
        }
        return m;
      }
      case "control": {
        const ev = base();
        ev.set("midicmd", new Sym("control"));
        ev.set("ctlNum", args[1] ?? 0);
        ev.set("control", args[2] ?? 0);
        this.recordEvent(ev, line);
        return m;
      }
      case "program": {
        const ev = base();
        ev.set("midicmd", new Sym("program"));
        ev.set("progNum", args[1] ?? 0);
        this.recordEvent(ev, line);
        return m;
      }
      case "bend": case "touch": case "polyTouch": case "sysex":
        this.note("MIDI " + method + " messages are not converted: TidalJS sends notes, control changes and program changes.");
        return m;
    }
    return m;
  }

  /** sendMsg and sendBundle, to a NetAddr or to the server. */
  private oscSend(method: string, args: Value[], line: number, server: boolean): Value {
    const messages: Value[][] = [];
    if (method === "sendMsg") messages.push(args);
    else if (method === "listSendMsg") messages.push(asList(args[0] ?? []));
    else if (method === "sendBundle") for (const m of args.slice(1)) messages.push(asList(m));
    else if (method === "listSendBundle") for (const m of asList(args[1] ?? [])) messages.push(asList(m));
    else return null;
    for (const msg of messages) this.oscMessage(describeText(msg[0] ?? null), msg.slice(1), line, server);
    return null;
  }

  private oscMessage(path: string, list: Value[], line: number, server: boolean) {
    const pairs = (from: Value[]): [string, Value][] | null => {
      if (from.length % 2 !== 0) return null;
      const out: [string, Value][] = [];
      for (let i = 0; i < from.length; i += 2) {
        if (!(from[i] instanceof Sym) && typeof from[i] !== "string") return null;
        out.push([describeText(from[i]), from[i + 1]]);
      }
      return out;
    };
    if (path === "/s_new") {
      const kv = pairs(list.slice(4)) ?? [];
      this.recordSynth(new SynthV(describeText(list[0] ?? null), new SCEvent(kv)), line);
      return;
    }
    if (path === "/dirt/play") {
      const kv = pairs(list);
      if (!kv) { this.note("An OSC message to /dirt/play without key-value pairs is left out."); return; }
      const ev = new SCEvent(kv);
      ev.set("type", new Sym("dirt"));
      this.recordEvent(ev, line);
      return;
    }
    if (server || /^\/(n_|g_|b_|c_|d_|s_|notify|status|quit|sync|dumpOSC|clearSched)/.test(path)) return;
    const kv = pairs(list);
    if (!kv) {
      this.note("The OSC message " + path + " has values without names: TidalJS sends name-value pairs (.osc()), so it is left out.");
      return;
    }
    const ev = new SCEvent(kv);
    ev.set("__osc", path);
    ev.set("instrument", new Sym("__osc" + path));
    ev.set("__synth", true);
    this.recordEvent(ev, line);
  }

  // ------------------------------------------------------------ synths started from code

  private synthSend(s: SynthV, method: string, args: Value[], line: number): Value {
    const play = this.synthPlays.get(s);
    const end = () => {
      if (play && play.inRoutine && this.routine) play.ev.set("sustain", Math.max(0, this.routine.time - play.time));
      this.synthPlays.delete(s);
    };
    switch (method) {
      case "release": case "free": case "run":
        if (method !== "run" || args[0] === false) end();
        return s;
      case "set": case "setn": case "map": {
        const list = asList(args.length === 1 ? args[0] : args);
        const changes: [string, Value][] = [];
        for (let i = 0; i + 1 < list.length; i += 2) changes.push([describeText(list[i]), list[i + 1]]);
        if (changes.some(([k, v]) => k === "gate" && v === 0)) { end(); return s; }
        if (this.bendSeen && this.keySynths.has(s)) {
          // A pitch-bend function bending the held notes: how many semitones the wheel moves them.
          for (const [, v] of changes) {
            if (!(v instanceof RandToken) || v.kind !== "midibend") continue;
            const mid = v.at(8192), top = v.at(16383), bottom = v.at(0);
            const ratio = Math.abs(mid - 1) < 1e-6 && top > 0 && bottom > 0;
            const range = ratio ? 12 * Math.max(Math.abs(Math.log2(top)), Math.abs(Math.log2(bottom))) : Math.max(Math.abs(top - mid), Math.abs(bottom - mid));
            if (Number.isFinite(range) && range > 0 && range <= 48) this.bendSeen.push(Math.round(range * 1000) / 1000);
          }
          return s;
        }
        if (!this.capture && this.keySynths.has(s)) {
          // An input function changing the held notes (aftertouch, a controller): their template follows it.
          // Polyphonic aftertouch is each key's own pressure (keytouch).
          const copy = this.keyCopies.get(s) ?? s;
          for (const [k, v] of changes) {
            if (!(v instanceof RandToken) || !["miditouch", "midicc", "slider", "toggle", "oscin", "midibend"].includes(v.kind)) continue;
            const live = this.polyTouch && v.kind === "miditouch" ? new RandToken("keytouch", [], v.ops) : v;
            if (this.polyTouch && live.kind === "keytouch") this.polyTouch.keys = true;
            copy.args.set(k, live);
          }
          return s;
        }
        if (!play) return s;
        if (!play.inRoutine || !this.routine || this.routine.time === play.time) {
          // Before the synth has played a moment: it starts with these values.
          for (const [k, v] of changes) play.ev.set(k, v);
          return s;
        }
        // A running synth that changes: a new note tied to the running one (the same voice goes on with the new values).
        end();
        const tie = play.ev.get("__tie");
        play.ev.set("__tied", true);
        const next = new SynthV(s.name, s.args.copy());
        for (const [k, v] of changes) next.args.set(k, v);
        s.args = next.args;
        this.recordSynth(s, line, typeof tie === "number" ? tie : undefined);
        const now = this.synthPlays.get(s);
        if (now) now.ev.set("__tied", true);
        return s;
      }
      case "nodeID": return 1000;
    }
    return s;
  }

  // ------------------------------------------------------------ JITLib

  private proxy(key: string): ProxyV {
    let p = this.proxies.get(key);
    if (!p) {
      p = new ProxyV(key);
      this.proxies.set(key, p);
    }
    return p;
  }

  private setProxySource(p: ProxyV, slot: number, value: Value, line: number) {
    if (!p.line) p.line = line;
    if (value instanceof Assoc && value.key instanceof Sym) {
      const role = value.key.name;
      if ((role === "filter" || role === "filterIn") && value.value instanceof SCFunc) {
        p.filters.set(slot, value.value);
        return;
      }
      if (role === "pset" || role === "set" || role === "xset") {
        // \pset -> Pbind(...): the source's arguments change per event; their first values are used.
        const s = new Stream(value.value, { host: this });
        const ev = s.next(new SCEvent());
        if (ev instanceof SCEvent) for (const [k, v] of ev.map) if (!k.startsWith("__")) p.settings.set(k, v);
        this.note("A \\" + role + " slot of a proxy keeps its first values.");
        return;
      }
      this.note("A \\" + role + " slot of a proxy is not converted.");
      return;
    }
    if (value === null) {
      p.slots.delete(slot);
      p.filters.delete(slot);
      return;
    }
    p.slots.set(slot, value);
  }

  private proxySend(p: ProxyV, method: string, args: Value[], kwargs: Record<string, Value>, line: number): Value {
    switch (method) {
      case "play": case "playN": case "monitor": case "send": case "resume":
        p.playing = true;
        p.line = p.line || line;
        return p;
      case "stop": case "end": case "free": case "pause": p.playing = false; return p;
      case "clear": p.playing = false; p.slots.clear(); p.filters.clear(); return p;
      case "source_": this.setProxySource(p, 0, args[0] ?? null, line); return p;
      case "put": this.setProxySource(p, num(args[0], 0), args[1] ?? null, line); return p;
      case "add": this.setProxySource(p, p.slots.size ? Math.max(...p.slots.keys()) + 1 : 0, args[0] ?? null, line); return p;
      case "at": return p.slots.get(num(args[0], 0)) ?? null;
      case "source": return p.source;
      case "set": case "xset": case "setn": case "map": case "xmap": case "setRates": {
        const list = args.length ? args : Object.entries(kwargs).flatMap(([k, v]) => [new Sym(k), v]);
        for (let i = 0; i + 1 < list.length; i += 2) p.settings.set(describeText(list[i]), list[i + 1]);
        return p;
      }
      case "ar": case "kr": case "value": return this.proxySignal(p);
      case "numChannels": return 2;
      case "key": return new Sym(p.key);
      case "isPlaying": case "isMonitoring": return p.playing;
    }
    return p;
  }

  /** A proxy read as a signal: inside a SynthDef its function's graph; elsewhere the proxy itself (a map). */
  private proxySignal(p: ProxyV): Value {
    const src = p.source;
    if (typeof src === "number" || Array.isArray(src)) return src;
    if (this.graph && src instanceof SCFunc) return this.call(src, []);
    if (this.graph && src instanceof ProxyV) return this.proxySignal(src);
    return p;
  }

  /** The proxies that play: each becomes a synth (or pattern) with its filters and the effects it is routed into. */
  private finishProxies() {
    for (const p of this.proxies.values()) {
      if (!p.playing) continue;
      // An effect proxy fed by another one (\in): the source's sound through this proxy's function.
      const fx: SynthV[] = [];
      let sound = p;
      const chain: ProxyV[] = [p];
      for (let guard = 0; guard < 8; guard++) {
        const input = sound.settings.get("in");
        if (!(input instanceof ProxyV) || chain.includes(input)) break;
        chain.unshift(input);
        sound = input;
      }
      chain.forEach((proxy, i) => {
        if (i > 0 && proxy.source instanceof SCFunc) fx.push(this.filterDef(proxy.key + "_fx", proxy.source, proxy.line, "in"));
        [...proxy.filters.entries()].sort((a, b) => a[0] - b[0]).forEach(([slot, fn]) => fx.push(this.filterDef(proxy.key + "_filter" + slot, fn, proxy.line, null)));
      });
      for (const [slot, value] of [...sound.slots.entries()].sort((a, b) => a[0] - b[0])) {
        const label = sound.key + (slot ? "_" + slot : "");
        if (value instanceof SCFunc) {
          const def = new SynthDefV(label, value, sound.line);
          this.synthDefs.set(def.name, def);
          const ev = new SCEvent([["instrument", new Sym(def.name)], ["__synth", true], ["__top", true], ["__proxy", true]]);
          for (const [k, v] of sound.settings) if (k !== "in") ev.set(k, v);
          if (fx.length) ev.set("__fx", fx.slice());
          this.played.push({ kind: "event", event: ev, start: 0, clock: this.defaultClock, line: p.line, label });
        } else if (isPattern(value)) {
          let pattern: Value = value;
          for (const f of fx) pattern = new Pfx("Pfx", pattern, f);
          this.played.push({ kind: "pattern", pattern, start: 0, clock: this.defaultClock, line: p.line, label });
        } else if (value instanceof RoutineV) {
          this.startRoutine(value, this.defaultClock, true);
        }
      }
    }
  }

  /** A filter function as an effect synth: its input is its first argument, or the named control. */
  private filterDef(name: string, fn: SCFunc, line: number, input: string | null): SynthV {
    const def = new SynthDefV(name, fn, line, input === null);
    this.synthDefs.set(name, def);
    return new SynthV(name, new SCEvent());
  }

  // ------------------------------------------------------------ playing

  private recordPattern(p: Value, clock: ClockV, line: number, label: string) {
    if (this.routine) {
      this.routine.events.push({ time: this.routine.time, event: new SCEvent([["__pattern", p as Value], ["__line", line]]) });
      return;
    }
    this.played.push({ kind: "pattern", pattern: p, start: 0, clock, line, label });
  }

  private recordSynth(synth: SynthV, line: number, tie?: number) {
    if (this.capture) {
      const copy = new SynthV(synth.name, synth.args.copy());
      this.capture.push(copy);
      // The synth the code keeps (to bend, press or release it later) stands for the captured one.
      this.keySynths.add(synth);
      this.keyCopies.set(synth, copy);
      return;
    }
    const ev = synth.args.copy();
    ev.set("instrument", new Sym(synth.name));
    ev.set("__synth", true);
    if (!this.routine) ev.set("__top", true);
    else {
      if (tie === undefined) { this.tieCount = (this.tieCount % 8) + 1; tie = this.tieCount; }
      ev.set("__tie", tie);
    }
    const stored = this.recordEvent(ev, line);
    this.synthPlays.set(synth, { ev: stored, time: this.routine?.time ?? 0, inRoutine: this.routine !== null, line });
  }

  /** Records an event and returns the stored copy (a synth's release changes it later). */
  private recordEvent(ev: SCEvent, line: number): SCEvent {
    const stored = ev.copy();
    if (this.routine) {
      const last = this.routine.events[this.routine.events.length - 1];
      this.routine.sameTime = last && Math.abs(last.time - this.routine.time) < 1e-9 ? this.routine.sameTime + 1 : 1;
      if (this.routine.sameTime > MAX_SAME_TIME) throw new TooMuchWork("too many events at once");
      this.routine.events.push({ time: this.routine.time, event: stored });
      return stored;
    }
    this.played.push({ kind: "event", event: stored, start: 0, clock: this.defaultClock, line, label: describeText(ev.get("instrument") ?? new Sym("default")) });
    return stored;
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
    const state = { time: 0, horizon: 512, events: [] as RoutineEvent[], clock, waited: this.work, sameTime: 0 };
    this.routine = state;
    try {
      this.call(r.fn, []);
    } catch (err) {
      if (err instanceof ConversionLimit) throw err;
      if (err instanceof TooMuchWork && (this.work - state.waited > MAX_WORK / 2 || state.sameTime > MAX_SAME_TIME)) {
        // It went round and round without waiting: SuperCollider would hang there (its clock never moves on).
        // What it played before is kept; what it started at that instant is not.
        this.note("Line " + r.line + ": the routine loops without waiting (no wait or yield in the loop): SuperCollider would hang there, so it stops at "
          + (state.time === 0 ? "the start" : "beat " + +state.time.toPrecision(6)) + ".");
        const stuck = state.time;
        state.events = state.events.filter((e) => e.time < stuck - 1e-9);
      } else if (err instanceof Horizon || err instanceof TooMuchWork) endless = true;
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
    if (x instanceof RandToken) {
      const token = x;
      x = x.realize(this.rng);
      // A random wait in a routine: the events just played get the random duration (TidalJS's rhythm()).
      if (this.routine && typeof x === "number") {
        const now = this.routine.time;
        let marked = false;
        for (let i = this.routine.events.length - 1; i >= 0 && Math.abs(this.routine.events[i].time - now) < 1e-9; i--) {
          const ev = this.routine.events[i].event;
          if (ev.has("__pattern")) continue;
          ev.set("__randtime", true);
          ev.set("__durtoken", token);
          ev.set("__durvalue", x);
          marked = true;
        }
        // No event now (a second random wait, or one after a fixed wait): the event before it lasts a sum of
        // waits, which no single random duration gives.
        if (!marked) {
          const last = [...this.routine.events].reverse().find((e) => !e.event.has("__pattern"));
          if (last) {
            last.event.set("__randtime", true);
            last.event.set("__randgap", true);
          }
        }
      }
    }
    if (this.routine && typeof x === "number") {
      this.routine.time += x;
      this.routine.waited = this.work;
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
  graphOf(def: SynthDefV): Graph | null {
    if (!def.fn) return null;
    const controls = new Map<string, GNode>();
    const saved = this.graph;
    this.graph = { outputs: [] };
    try {
      const args = def.fn.params.map((p, i) => {
        const init = p.init ? this.eval(p.init, def.fn!.scope) : 0;
        // A filter's first argument is its input: an audio signal.
        const c = new GNode("control", p.name, { default: init }, def.filter && i === 0 ? "ar" : "kr");
        controls.set(p.name, c);
        return c;
      });
      const ret = this.call(def.fn, args);
      const outs = this.graph.outputs;
      // The main output goes to out (or 0); the others are sends to buses.
      const isMain = (b: Value) => b === null || b === 0 || (b instanceof GNode && b.kind === "control" && /^(i_)?out(_?bus)?$/i.test(b.name));
      const main = [...outs].reverse().find((o) => isMain(o.bus)) ?? outs[outs.length - 1];
      const output = main ? main.channels : ret;
      collectControls(output, controls);
      for (const o of outs) { collectControls(o.channels, controls); collectControls(o.bus, controls); }
      return { output, controls, outs, mainBus: main ? main.bus : 0 };
    } catch (err) {
      if (err instanceof ConversionLimit) throw err;
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
    if (next - e.time < 1e-9) {
      // Started together with the next one (no wait between them): it lasts, as they do, until the routine moves on.
      let j = i + 1;
      while (j < sorted.length && sorted[j].time - e.time < 1e-9) j++;
      const moved = j < sorted.length ? sorted[j].time : end > e.time + 1e-9 ? end : e.time + 1;
      ev.set("__hold", moved - e.time);
    }
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

/** Rect(x, y, width, height) as [x, y, width, height], or null. */
function rectOf(v: Value): [number, number, number, number] | null {
  if (Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === "number")) return v as [number, number, number, number];
  return null;
}

/** An item of a layout: [view, stretch: 1] is the view. */
function guiItem(v: Value): Value {
  if (Array.isArray(v) && v.length > 0 && (v[0] instanceof WidgetV || v[0] instanceof TextV || v[0] instanceof LayoutV || v[0] instanceof WindowV)) return v[0];
  return v;
}
