/**
 * Reads a SynthDef's graph and finds its TidalJS equivalent: a sound (one of
 * TidalJS's synths), the effects after the oscillators (filters, the peak
 * equaliser, reverb, distortion, pan) as TidalJS controls, the amplitude and
 * pitch envelopes, and which TidalJS control each argument drives, so that
 * a Pbind key like \cutoff becomes .lpf().
 */
import { EnvSpec, GNode, Sym, type SynthDefV, type Value } from "./values.ts";
import type { Interpreter } from "./interpreter.ts";

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
  summary: string;
  notes: string[];
}

/** TidalJS's own sounds: an instrument with one of these names plays it. */
export const TIDAL_SOUNDS = new Set([
  "bd", "sn", "hh", "oh", "ch", "cp", "cy", "arpy", "sine", "saw", "square", "tri", "noise", "pink",
  "supersaw", "supersquare", "superpwm", "superhoover", "superreese", "superzow", "superchip", "superfm", "superpiano",
  "supergong", "superstatic", "superkick", "super808", "supergabber", "superhat", "supersnare", "superclap",
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
};

const DRIVE = new Set(["tanh", "distort", "softclip", "atan", "clip2"]);

/** The peak level of TidalJS's synths at amp 0.4 (tidal.js SAMPLE_DEFS), to match SuperCollider's levels. */
export const SOUND_LEVEL: Record<string, number> = {
  bd: 0.95, sn: 0.6, hh: 0.35, cp: 0.55, oh: 0.3, ch: 0.35, cy: 0.25, arpy: 0.35, sine: 0.45, saw: 0.3, square: 0.25,
  tri: 0.45, noise: 0.25, pink: 0.35, supersaw: 0.3, supersquare: 0.22, superpwm: 0.35, superreese: 0.35, superzow: 0.3,
  superchip: 0.3, superfm: 0.4, superstatic: 0.6, superpiano: 0.45, supergong: 0.35, superkick: 0.9, super808: 0.9,
  superhat: 0.3, supersnare: 0.55, superclap: 0.6,
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
  if (v.kind === "control" || v.kind === "env" || v.kind === "rand") return false;
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
  // Multichannel output: each channel is analysed; when they differ, both are written.
  const stereo = Array.isArray(out) && out.length >= 2 && !port;
  const left = analyseChannel(def, graph, stereo ? (out as Value[])[0] : out, port);
  if (stereo) {
    const right = analyseChannel(def, graph, (out as Value[])[1], port);
    if (left.sound !== right.sound || JSON.stringify(left.fixed) !== JSON.stringify(right.fixed)) {
      left.channels = [left.fixed, right.fixed];
      left.fixed = [];
      left.summary += "; its two channels differ, so it plays twice, panned left and right";
    } else {
      // The same signal on both channels: TidalJS's centre pan is 3 dB down, so it is made up.
      left.ampScale *= Math.SQRT2;
    }
    if ((out as Value[]).length > 2) left.notes.push("\\" + def.name + " has more than two channels: the first two are used");
  }
  // The level when the events do not set amp.
  if (!left.port) {
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
    unmapped: new Set(), summary: "", notes: [], channels: null, endless: false,
  };
}

function analyseChannel(def: SynthDefV, graph: { output: Value; controls: Map<string, GNode> }, output: Value, port: [RegExp, string] | undefined): SynthInfo {
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
  if (!info.port) info.sound = soundByName(def.name) ?? soundByOscillators(oscs, detuned, modulated);

  // The pitch: how the freq argument reaches the oscillators.
  if (!info.port || /gabber/i.test(def.name)) pitch(output);

  // The amplitude envelope; without one that ends, the synth plays until it is freed.
  if (ampEnv && !info.port) envelope(ampEnv);
  const done = (e: { node: GNode } | null) => e !== null && numOr(first(e.node.inputs.doneAction ?? 0), 0) >= 2;
  info.endless = !info.port && !done(ampEnv) && !hasDoneAction(output);

  // SuperCollider's level, as TidalJS's amp for this synth.
  if (!info.port) info.ampScale = (gain * 0.4) / (SOUND_LEVEL[info.sound] ?? 0.35);

  // Arguments nothing uses as a TidalJS control.
  for (const name of graph.controls.keys()) {
    if (!info.roles.has(name) && !["freq", "gate", "out", "amp", "pan", "sustain", "dur", "bus", "outBus", "i_out"].includes(name)) info.unmapped.add(name);
  }
  if (info.roles.has("amp") === false && graph.controls.has("amp")) info.roles.set("amp", [{ control: "amp", fn: (x) => x, js: (x) => x }]);

  const list = unique(effects.reverse());
  const named = list.length > 1 ? list.slice(0, -1).join(", ") + " and " + list[list.length - 1] : list[0];
  info.summary = info.sound + ", " + (info.port ? "TidalJS's port of this SynthDef" : "the closest TidalJS synth")
    + (list.length ? "; its " + named + (list.length > 1 ? " become" : " becomes") + " effects" : "");
  return info;

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
        fix("vib", round(lfo.rate));
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
    // freq * lfo.exprange(a, b), freq * (lfo * k).midiratio: a vibrato around the note.
    const ratio = lfoSweep(m) ?? lfoMidiratio(m);
    if (ratio && !info.port) {
      fix("vib", round(ratio.rate));
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
function lfoSweep(v: Value): { center: number; rate: number; depth: number; note?: string } | null {
  v = first(v);
  if (!(v instanceof GNode)) return null;
  const lfoOf = (x: Value): { rate: number; shape: string } | null => {
    x = first(x);
    if (x instanceof GNode && x.kind === "ugen" && LFO.has(x.name)) {
      const rate = first(x.inputs.freq ?? null);
      if (typeof rate === "number" && rate < 50) return { rate, shape: x.name };
    }
    return null;
  };
  let lo: number | null = null;
  let hi: number | null = null;
  let lfo: { rate: number; shape: string } | null = null;
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
  return { center: Math.sqrt(lo * hi), rate: lfo.rate, depth: (12 * Math.log2(hi / lo)) / 2, note: notes.join("; ") || undefined };
}

/** (lfo * k).midiratio: a vibrato of k semitones. */
function lfoMidiratio(v: Value): { center: number; rate: number; depth: number; note?: string } | null {
  if (!(v instanceof GNode) || v.kind !== "unop" || v.name !== "midiratio") return null;
  const x = first(v.inputs.a);
  if (!(x instanceof GNode) || x.kind !== "binop" || x.name !== "*") return null;
  const k = typeof x.inputs.b === "number" ? x.inputs.b : typeof x.inputs.a === "number" ? x.inputs.a : null;
  const l = first(typeof x.inputs.b === "number" ? x.inputs.a : x.inputs.b);
  if (k === null || !(l instanceof GNode) || l.kind !== "ugen" || !LFO.has(l.name)) return null;
  const rate = first(l.inputs.freq ?? null);
  if (typeof rate !== "number") return null;
  return { center: 1, rate, depth: Math.abs(k) };
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
    if ((v.kind === "env" || v.name === "EnvGen" || v.name === "Line" || v.name === "XLine") && numOr(first(v.inputs.doneAction ?? 0), 0) >= 2) return true;
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
