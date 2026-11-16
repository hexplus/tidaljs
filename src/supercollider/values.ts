/**
 * The values the SuperCollider interpreter works with: numbers, strings,
 * symbols, arrays, functions, events, classes, patterns, synth graph nodes,
 * envelopes, random tokens (a random pattern that becomes a TidalJS random
 * signal), and opaque objects for what is not supported.
 */
import type { Node, Param } from "./parser.ts";

export class Sym {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  toString() { return "\\" + this.name; }
}

/** A function, with the scope it was made in. */
export class SCFunc {
  params: Param[];
  rest: string | null;
  vars: Param[];
  body: Node[];
  scope: Scope;
  constructor(node: Extract<Node, { t: "func" }>, scope: Scope) {
    this.params = node.params;
    this.rest = node.rest;
    this.vars = node.vars;
    this.body = node.body;
    this.scope = scope;
  }
}

/** An Event (key: value, ...) or a Dictionary. */
export class SCEvent {
  map: Map<string, Value>;
  constructor(entries?: Iterable<[string, Value]>) {
    this.map = new Map(entries ?? []);
  }
  get(key: string): Value | undefined { return this.map.get(key); }
  delete(key: string) { this.map.delete(key); }
  has(key: string) { return this.map.has(key); }
  set(key: string, value: Value) { this.map.set(key, value); }
  copy() { return new SCEvent(this.map); }
}

export class SCClass {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

/** Rest(dur): an event that plays nothing. */
export class RestV {
  dur: number;
  constructor(dur = 1) {
    this.dur = dur;
  }
}

/** A TempoClock: only its tempo matters here. */
export class ClockV {
  tempo: number;
  explicit: boolean;
  constructor(tempo = 1, explicit = false) {
    this.tempo = tempo;
    this.explicit = explicit;
  }
}

export class ScaleV {
  name: string;
  degrees: number[];
  stepsPerOctave: number;
  constructor(name: string, degrees: number[], stepsPerOctave = 12) {
    this.name = name;
    this.degrees = degrees;
    this.stepsPerOctave = stepsPerOctave;
  }
}

/** Anything the converter does not model: every method on it returns another one. */
export class Opaque {
  desc: string;
  constructor(desc: string) {
    this.desc = desc;
  }
}

/** A key -> value association (a -> b). */
export class Assoc {
  key: Value;
  value: Value;
  constructor(key: Value, value: Value) {
    this.key = key;
    this.value = value;
  }
}

/**
 * A node of a SynthDef's graph: a control (an argument), a UGen, an operator
 * on signals, or an envelope generator.
 */
export class GNode {
  kind: "control" | "ugen" | "binop" | "unop" | "env" | "rand";
  name: string;
  rate: string;
  inputs: Record<string, Value>;
  constructor(kind: GNode["kind"], name: string, inputs: Record<string, Value>, rate = "ar") {
    this.kind = kind;
    this.name = name;
    this.inputs = inputs;
    this.rate = rate;
  }
}

/** An envelope description: Env(levels, times, curves) or one of its shortcuts. */
export class EnvSpec {
  shape: string;
  params: Record<string, Value>;
  levels: Value[];
  times: Value[];
  curves: Value;
  releaseNode: number | null;
  constructor(shape: string, params: Record<string, Value>, levels: Value[], times: Value[], curves: Value, releaseNode: number | null) {
    this.shape = shape;
    this.params = params;
    this.levels = levels;
    this.times = times;
    this.curves = curves;
    this.releaseNode = releaseNode;
  }
}

/** A SynthDef: its name and its function, analysed when an event uses it. */
export class SynthDefV {
  name: string;
  fn: SCFunc | null;
  line: number;
  /** A JITLib filter (\filter -> { |in| ... }): its first argument is the input signal. */
  filter: boolean;
  constructor(name: string, fn: SCFunc | null, line: number, filter = false) {
    this.name = name;
    this.fn = fn;
    this.line = line;
    this.filter = filter;
  }
}

/** A bus: Bus.audio or Bus.control. A control bus can hold a value (bus.set) or be written by a synth. */
export class BusV {
  rate: "audio" | "control";
  index: number;
  channels: number;
  value: Value;
  constructor(rate: BusV["rate"], index: number, channels: number) {
    this.rate = rate;
    this.index = index;
    this.channels = channels;
    this.value = null;
  }
}

/** A buffer: Buffer.read (a sound file, which becomes a TidalJS sample bank) or Buffer.alloc. */
export class BufferV {
  path: string | null;
  bufnum: number;
  bank: string;
  constructor(path: string | null, bufnum: number, bank: string) {
    this.path = path;
    this.bufnum = bufnum;
    this.bank = bank;
  }
}

/** A JITLib proxy (Ndef, or ~x in a ProxySpace): its source, filters, settings and whether it plays. */
export class ProxyV {
  key: string;
  /** Source slots: 0 is the source; other slots add layers (proxy[1] = { ... }). */
  slots = new Map<number, Value>();
  /** Filter slots: index -> the filter's function. */
  filters = new Map<number, SCFunc>();
  /** proxy.set(\key, value) and map: arguments of its synth. */
  settings = new Map<string, Value>();
  playing = false;
  line = 0;
  constructor(key: string) {
    this.key = key;
  }
  get source(): Value {
    return this.slots.get(0) ?? null;
  }
}

/** A GUI control (Slider, Knob, Button, EZSlider...): it becomes a TidalJS slider or toggle. */
export class WidgetV {
  kind: "slider" | "toggle";
  label: string;
  value: number;
  min: number;
  max: number;
  exp: boolean;
  action: SCFunc | null = null;
  line: number;
  /** Set when the label was given (EZSlider's label, a StaticText next to it, a Button's state): kept by a layout's StaticText otherwise. */
  named = false;
  /** Its window (a GUI window's controls become one group of the Controls panel), and where it sits in it. */
  window: WindowV | null = null;
  bounds: [number, number, number, number] | null = null;
  /** A slider's step (PopUpMenu, a Button with several states: 1); 0 moves freely. */
  step = 0;
  /** Slider2D and RangeSlider: the second slider (y, or the high end), read with .y or .hi. */
  pair: WidgetV | null = null;
  constructor(kind: WidgetV["kind"], label: string, value: number, min: number, max: number, exp: boolean, line: number) {
    this.kind = kind;
    this.label = label;
    this.value = value;
    this.min = min;
    this.max = max;
    this.exp = exp;
    this.line = line;
  }
}

/** A GUI window (Window, View): its title, and how its controls are laid out (rows of controls and labels). */
export class WindowV {
  title: string;
  /** A layout given with .layout_ (HLayout, VLayout, GridLayout): nested rows and columns. */
  layout: LayoutV | null = null;
  /** Controls placed in it with bounds (Slider(w, Rect(...))), in order. */
  children: (WidgetV | TextV | WindowV)[] = [];
  /** A View inside a window: its window, and where it sits. */
  parent: WindowV | null = null;
  bounds: [number, number, number, number] | null = null;
  line: number;
  constructor(title: string, line: number) {
    this.title = title;
    this.line = line;
  }
}

/** HLayout(...), VLayout(...), GridLayout.rows(...): its items (controls, labels, nested layouts, nil for space). */
export class LayoutV {
  kind: "h" | "v" | "grid";
  items: Value[];
  constructor(kind: LayoutV["kind"], items: Value[]) {
    this.kind = kind;
    this.items = items;
  }
}

/** A StaticText: a label. */
export class TextV {
  text: string;
  bounds: [number, number, number, number] | null = null;
  window: WindowV | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

/** A MIDI output: MIDIOut(0) or MIDIOut.newByName(device, port). */
export class MidiOutV {
  selector: number | string;
  constructor(selector: number | string) {
    this.selector = selector;
  }
}

/** An OSC address: NetAddr(host, port). */
export class NetAddrV {
  host: string;
  port: number;
  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }
}

/** A Routine, Task or forked function: run on a virtual clock. */
export class RoutineV {
  fn: SCFunc;
  line: number;
  constructor(fn: SCFunc, line: number) {
    this.fn = fn;
    this.line = line;
  }
}

/** A Synth started from code: Synth(\name, [\freq, 440]). */
export class SynthV {
  name: string;
  args: SCEvent;
  /** The event it played (to end it on release or free), when it plays in a routine. */
  played: SCEvent | null = null;
  constructor(name: string, args: SCEvent) {
    this.name = name;
    this.args = args;
  }
}

/**
 * A random value from a pattern (Pwhite, Prand...), kept symbolic so that it
 * becomes a TidalJS random signal instead of one fixed draw. Operators on it
 * are recorded as a JavaScript function of x.
 */
export class RandToken {
  /**
   * Random kinds become TidalJS random signals; the input kinds read what the player does live:
   * slider and toggle (GUI controls), midicc, midinote, midivel, midibend, miditouch and keytouch (MIDI input), oscin (OSC input).
   */
  kind: "white" | "iwhite" | "exp" | "choose" | "wchoose" | "slider" | "toggle" | "midicc" | "midinote" | "midivel" | "midibend" | "miditouch" | "keytouch" | "oscin";
  args: Value[];
  /** Operators applied to the value; `lin` is [a, b] when the operator is a * x + b. */
  ops: { fn: (x: number) => number; js: string; lin?: [number, number] }[];
  constructor(kind: RandToken["kind"], args: Value[], ops: RandToken["ops"] = []) {
    this.kind = kind;
    this.args = args;
    this.ops = ops;
  }
  map(fn: (x: number) => number, js: string, lin?: [number, number]) {
    return new RandToken(this.kind, this.args, [...this.ops, lin ? { fn, js, lin } : { fn, js }]);
  }
  key(): string {
    return this.kind + ":" + JSON.stringify(this.args, (_k, v) => (v instanceof Sym ? "\\" + v.name : v)) + ":" + this.ops.map((o) => o.js).join("|");
  }
  /** One draw, for where a fixed value is needed (durations, instruments). */
  realize(rng: () => number): Value {
    let v: Value;
    const a = this.args;
    switch (this.kind) {
      case "white": v = (a[0] as number) + rng() * ((a[1] as number) - (a[0] as number)); break;
      case "iwhite": v = (a[0] as number) + Math.floor(rng() * ((a[1] as number) - (a[0] as number) + 1)); break;
      case "exp": v = (a[0] as number) * Math.pow((a[1] as number) / (a[0] as number), rng()); break;
      case "choose": {
        const list = a[0] as Value[];
        v = list[Math.floor(rng() * list.length)];
        break;
      }
      case "wchoose": {
        const list = a[0] as Value[];
        const weights = a[1] as number[];
        const total = weights.reduce((s, w) => s + w, 0);
        let r = rng() * total;
        let k = 0;
        while (k < list.length - 1 && r >= weights[k]) { r -= weights[k]; k++; }
        v = list[k];
        break;
      }
      // Live inputs: their starting value.
      case "slider": v = a[1] as number; break;
      case "toggle": v = a[1] === true || a[1] === 1 ? 1 : 0; break;
      case "midicc": v = 0; break;
      case "midinote": v = 60; break;
      case "midivel": v = 127; break;
      case "midibend": v = 8192; break;
      case "miditouch": case "keytouch": v = 0; break;
      case "oscin": v = 0; break;
    }
    for (const op of this.ops) if (typeof v === "number") v = op.fn(v);
    return v;
  }
  /** Its operators applied to an input value (what a live input gives at x). */
  at(x: number): number {
    let v = x;
    for (const op of this.ops) v = op.fn(v);
    return v;
  }
}

export type Value =
  | number | string | boolean | null
  | Sym | Value[] | SCFunc | SCEvent | SCClass | RestV | ClockV | ScaleV | Opaque | Assoc
  | GNode | EnvSpec | SynthDefV | RoutineV | SynthV | RandToken
  | BusV | BufferV | ProxyV | MidiOutV | NetAddrV | WidgetV | WindowV | LayoutV | TextV
  | PatternLike;

/** Patterns implement this (see patterns.ts). */
export interface PatternLike {
  readonly isPattern: true;
  readonly name: string;
}

export function isPattern(v: unknown): v is PatternLike {
  return typeof v === "object" && v !== null && (v as PatternLike).isPattern === true;
}

/** Variables: a chain of scopes. */
export class Scope {
  vars: Map<string, Value>;
  parent: Scope | null;
  constructor(parent: Scope | null = null) {
    this.vars = new Map();
    this.parent = parent;
  }
  lookup(name: string): Scope | null {
    let s: Scope | null = this;
    while (s) {
      if (s.vars.has(name)) return s;
      s = s.parent;
    }
    return null;
  }
}

/** A seeded random generator (mulberry32), so a conversion always gives the same code. */
export function seededRandom(seed = 0x5eed): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function describe(v: Value | undefined): string {
  if (v === undefined || v === null) return "nil";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return String(v);
  if (v instanceof Sym) return "\\" + v.name;
  if (Array.isArray(v)) return "[" + v.map(describe).join(", ") + "]";
  if (isPattern(v)) return v.name;
  if (v instanceof SCClass) return v.name;
  if (v instanceof Opaque) return v.desc;
  if (v instanceof RandToken) return "random(" + v.kind + ")";
  return v.constructor.name;
}
