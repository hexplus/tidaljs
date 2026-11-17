/**
 * SuperCollider's patterns as generators. A value pattern yields values; an
 * event pattern yields events. As in SuperCollider, `yield` hands back the
 * next input value (the event being built, for Pkey), and an embedded
 * pattern returns the last input value when it ends.
 */
import {
  RandToken, RestV, SCEvent, SCFunc, Sym, isPattern, type PatternLike, type Value,
} from "./values.ts";

export type Gen = Generator<Value, Value, Value>;

/** What patterns need from the interpreter. */
export interface Host {
  rng: () => number;
  call(fn: SCFunc, args: Value[]): Value;
  binop(op: string, a: Value, b: Value): Value;
  send(recv: Value, method: string, args: Value[]): Value;
  note(text: string): void;
  pdef(name: string): Value;
  pdefn(name: string): Value;
  /** The current time of the simulation, in beats (for Pseg). */
  time: number;
  /**
   * A step of work. Patterns call it as they go, so one that never yields (an empty pattern repeated forever,
   * which hangs SuperCollider) is stopped instead of hanging the conversion.
   */
  tick?(): void;
}

export interface Ctx {
  host: Host;
}

export abstract class Pattern implements PatternLike {
  readonly isPattern = true as const;
  abstract readonly name: string;
  abstract embed(inval: Value, ctx: Ctx): Gen;
}

/** Embeds an item of a list pattern: a pattern plays through, a value plays once. */
export function* embedItem(item: Value, inval: Value, ctx: Ctx): Gen {
  ctx.host.tick?.();
  if (isPattern(item)) return yield* (item as Pattern).embed(inval, ctx);
  if (item instanceof SCFunc) return yield ctx.host.call(item, [inval]);
  return yield item;
}

/** A stream: next(inval) gives the next value, or DONE. */
export const DONE = Symbol("done");
export type Next = Value | typeof DONE;

export class Stream {
  private source: Value;
  private gen: Gen | null = null;
  private ended = false;
  private ctx: Ctx;
  constructor(source: Value, ctx: Ctx) {
    this.source = source;
    this.ctx = ctx;
  }
  next(inval: Value): Next {
    if (this.ended) return DONE;
    this.ctx.host.tick?.();
    const src = this.source;
    if (isPattern(src)) {
      let r: IteratorResult<Value, Value>;
      if (!this.gen) {
        this.gen = (src as Pattern).embed(inval, this.ctx);
        r = this.gen.next(inval);
      } else {
        r = this.gen.next(inval);
      }
      if (r.done) {
        this.ended = true;
        return DONE;
      }
      return r.value;
    }
    if (src instanceof SCFunc) return this.ctx.host.call(src, [inval]);
    return src;
  }
}

const num = (v: Value, fallback: number) => (typeof v === "number" ? v : fallback);
const list = (v: Value): Value[] => (Array.isArray(v) ? v : [v]);

/** A list item that can become part of a TidalJS random choice. */
const simple = (v: Value) => typeof v === "number" || v instanceof Sym || typeof v === "string";

// ---------------------------------------------------------------- list patterns

export class Pseq extends Pattern {
  readonly name = "Pseq";
  items: Value[]; repeats: Value; offset: number;
  constructor(items: Value, repeats: Value = 1, offset: Value = 0) {
    super();
    this.items = list(items);
    this.repeats = repeats;
    this.offset = num(offset, 0);
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const reps = repeatsOf(this.repeats, ctx, inval);
    const n = this.items.length;
    for (let r = 0; r < reps && n > 0; r++) {
      for (let i = 0; i < n; i++) inval = yield* embedItem(this.items[mod(i + this.offset, n)], inval, ctx);
    }
    return inval;
  }
}

export class Pser extends Pattern {
  readonly name = "Pser";
  items: Value[]; repeats: Value; offset: number;
  constructor(items: Value, repeats: Value = 1, offset: Value = 0) {
    super();
    this.items = list(items);
    this.repeats = repeats;
    this.offset = num(offset, 0);
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const count = repeatsOf(this.repeats, ctx, inval);
    const n = this.items.length;
    for (let i = 0; i < count && n > 0; i++) inval = yield* embedItem(this.items[mod(i + this.offset, n)], inval, ctx);
    return inval;
  }
}

export class Prand extends Pattern {
  readonly name: string;
  items: Value[]; repeats: Value; weights: number[] | null;
  constructor(name: string, items: Value, repeats: Value = 1, weights: number[] | null = null) {
    super();
    this.name = name;
    this.items = list(items);
    this.repeats = repeats;
    this.weights = weights;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const reps = repeatsOf(this.repeats, ctx, inval);
    const symbolic = this.items.every(simple) && this.items.length > 0;
    if (this.name === "Pxrand" && symbolic) ctx.host.note("Pxrand never repeats a value twice in a row; TidalJS's choose can.");
    let last = -1;
    for (let r = 0; r < reps; r++) {
      if (symbolic) {
        const token = this.weights
          ? new RandToken("wchoose", [this.items, this.weights])
          : new RandToken("choose", [this.items]);
        inval = yield token;
        continue;
      }
      let k: number;
      if (this.weights) k = new RandToken("wchoose", [this.items.map((_, i) => i), this.weights]).realize(ctx.host.rng) as number;
      else {
        do k = Math.floor(ctx.host.rng() * this.items.length);
        while (this.name === "Pxrand" && this.items.length > 1 && k === last);
      }
      last = k;
      inval = yield* embedItem(this.items[k], inval, ctx);
    }
    return inval;
  }
}

export class Pshuf extends Pattern {
  readonly name = "Pshuf";
  items: Value[]; repeats: Value;
  constructor(items: Value, repeats: Value = 1) {
    super();
    this.items = list(items);
    this.repeats = repeats;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    // As SuperCollider: one shuffle each time the pattern starts (the emitter turns Pn(Pshuf(...)) into shuffle).
    const order = this.items.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.host.rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const reps = repeatsOf(this.repeats, ctx, inval);
    for (let r = 0; r < reps; r++) for (const item of order) inval = yield* embedItem(item, inval, ctx);
    return inval;
  }
}

export class Pslide extends Pattern {
  readonly name = "Pslide";
  items: Value[];
  repeats: Value;
  len: number;
  step: number;
  start: number;
  wrap: boolean;
  constructor(items: Value[], repeats: Value, len: number, step: number, start: number, wrap: boolean) {
    super();
    this.items = items;
    this.repeats = repeats;
    this.len = len;
    this.step = step;
    this.start = start;
    this.wrap = wrap;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const reps = repeatsOf(this.repeats, ctx, inval);
    const n = this.items.length;
    let pos = this.start;
    for (let r = 0; r < reps; r++) {
      for (let j = 0; j < this.len; j++) {
        const k = pos + j;
        if (!this.wrap && (k < 0 || k >= n)) return inval;
        inval = yield* embedItem(this.items[mod(k, n)], inval, ctx);
      }
      pos += this.step;
    }
    return inval;
  }
}

export class Place extends Pattern {
  readonly name = "Place";
  items: Value[];
  repeats: Value;
  constructor(items: Value[], repeats: Value) {
    super();
    this.items = items;
    this.repeats = repeats;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const reps = repeatsOf(this.repeats, ctx, inval);
    for (let r = 0; r < reps; r++) {
      for (const item of this.items) {
        const v = Array.isArray(item) ? item[mod(r, item.length)] : item;
        inval = yield* embedItem(v, inval, ctx);
      }
    }
    return inval;
  }
}

export class Ppatlace extends Pattern {
  readonly name = "Ppatlace";
  items: Value[];
  repeats: Value;
  constructor(items: Value[], repeats: Value) {
    super();
    this.items = items;
    this.repeats = repeats;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const reps = repeatsOf(this.repeats, ctx, inval);
    const streams = this.items.map((p) => new Stream(isPattern(p) ? p : new Pn(p, Infinity), ctx));
    for (let r = 0; r < reps; r++) {
      for (const s of streams) {
        const v = s.next(inval);
        if (v === DONE) return inval;
        inval = yield v;
      }
    }
    return inval;
  }
}

export class Pswitch extends Pattern {
  readonly name: string;
  items: Value[];
  which: Value;
  constructor(name: string, items: Value[], which: Value) {
    super();
    this.items = items;
    this.which = which;
    this.name = name;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const which = new Stream(this.which, ctx);
    if (this.name === "Pswitch1") {
      const streams = this.items.map((p) => new Stream(isPattern(p) ? p : new Pn(p, Infinity), ctx));
      for (;;) {
        const i = which.next(inval);
        if (i === DONE || typeof i !== "number") return inval;
        const v = streams[mod(Math.floor(i), streams.length)].next(inval);
        if (v === DONE) return inval;
        inval = yield v;
      }
    }
    for (;;) {
      const i = which.next(inval);
      if (i === DONE || typeof i !== "number") return inval;
      inval = yield* embedItem(this.items[mod(Math.floor(i), this.items.length)], inval, ctx);
    }
  }
}

// ---------------------------------------------------------------- generators

export class Pwhite extends Pattern {
  readonly name: string;
  /** The bounds were written as floats: draw floats even when they are whole. */
  floats = false;
  lo: Value;
  hi: Value;
  length: Value;
  constructor(name: string, lo: Value, hi: Value, length: Value = Infinity) {
    super();
    this.lo = lo;
    this.hi = hi;
    this.length = length;
    this.name = name;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const count = repeatsOf(this.length, ctx, inval);
    const lo = new Stream(this.lo, ctx);
    const hi = new Stream(this.hi, ctx);
    for (let i = 0; i < count; i++) {
      const a = lo.next(inval);
      const b = hi.next(inval);
      if (a === DONE || b === DONE) return inval;
      if (typeof a !== "number" || typeof b !== "number") return inval;
      let token: RandToken;
      if (this.name === "Pexprand") token = new RandToken("exp", [a, b]);
      else if (!this.floats && Number.isInteger(a) && Number.isInteger(b) && !isPattern(this.lo) && !isPattern(this.hi)) token = new RandToken("iwhite", [a, b]);
      else token = new RandToken("white", [a, b]);
      // Bounds that change per event cannot be one TidalJS signal: draw them.
      inval = yield isPattern(this.lo) || isPattern(this.hi) ? token.realize(ctx.host.rng) : token;
    }
    return inval;
  }
}

export class Pbrown extends Pattern {
  readonly name = "Pbrown";
  lo: number;
  hi: number;
  step: number;
  length: Value;
  constructor(lo: number, hi: number, step: number, length: Value = Infinity) {
    super();
    this.lo = lo;
    this.hi = hi;
    this.step = step;
    this.length = length;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    ctx.host.note("Pbrown is a random walk: these are fixed draws of it.");
    const count = repeatsOf(this.length, ctx, inval);
    let x = this.lo + ctx.host.rng() * (this.hi - this.lo);
    for (let i = 0; i < count; i++) {
      inval = yield x;
      x = fold(x + (ctx.host.rng() * 2 - 1) * this.step, this.lo, this.hi);
    }
    return inval;
  }
}

export class Pseries extends Pattern {
  readonly name: string;
  start: Value;
  step: Value;
  length: Value;
  constructor(name: string, start: Value, step: Value, length: Value = Infinity) {
    super();
    this.start = start;
    this.step = step;
    this.length = length;
    this.name = name;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const count = repeatsOf(this.length, ctx, inval);
    const step = new Stream(this.step, ctx);
    let x = this.start;
    for (let i = 0; i < count; i++) {
      inval = yield x;
      const s = step.next(inval);
      if (s === DONE) return inval;
      x = ctx.host.binop(this.name === "Pgeom" ? "*" : "+", x, s);
    }
    return inval;
  }
}

export class Pbjorklund extends Pattern {
  readonly name: string;
  k: number;
  n: number;
  length: Value;
  offset: number;
  constructor(name: string, k: number, n: number, length: Value = Infinity, offset = 0) {
    super();
    this.offset = offset;
    this.k = k;
    this.n = n;
    this.length = length;
    this.name = name;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const bits = bjorklund(this.k, this.n);
    const rotated = bits.map((_, i) => bits[mod(i + this.offset, bits.length)]);
    const count = repeatsOf(this.length, ctx, inval);
    if (this.name === "Pbjorklund2") {
      // Durations between the hits, in steps.
      const durs: number[] = [];
      for (let i = 0; i < rotated.length; i++) {
        if (rotated[i]) {
          let d = 1;
          while (i + d < rotated.length && !rotated[i + d]) d++;
          durs.push(d);
        }
      }
      for (let r = 0; r < count; r++) for (const d of durs) inval = yield d;
      return inval;
    }
    for (let r = 0; r < count; r++) for (const b of rotated) inval = yield b;
    return inval;
  }
}

/** Bjorklund's algorithm, as in SuperCollider's Bjorklund quark. */
export function bjorklund(k: number, n: number): number[] {
  k = Math.max(0, Math.min(Math.floor(k), Math.floor(n)));
  n = Math.floor(n);
  if (n <= 0) return [];
  let a: number[][] = Array.from({ length: k }, () => [1]);
  let b: number[][] = Array.from({ length: n - k }, () => [0]);
  while (b.length > 1 && a.length > 0) {
    const m = Math.min(a.length, b.length);
    const na: number[][] = [];
    for (let i = 0; i < m; i++) na.push([...a[i], ...b[i]]);
    const rest = a.length > m ? a.slice(m) : b.slice(m);
    a = na;
    b = rest;
  }
  return [...a.flat(), ...b.flat()];
}

export class Pseg extends Pattern {
  readonly name = "Pseg";
  levels: number[];
  durs: number[];
  curve: Value;
  repeats: Value;
  constructor(levels: number[], durs: number[], curve: Value, repeats: Value = 1) {
    super();
    this.levels = levels;
    this.durs = durs;
    this.curve = curve;
    this.repeats = repeats;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const start = ctx.host.time;
    const total = this.durs.reduce((s, d) => s + d, 0);
    const reps = repeatsOf(this.repeats, ctx, inval);
    const exp = this.curve instanceof Sym && this.curve.name === "exp";
    for (;;) {
      const elapsed = ctx.host.time - start;
      if (total <= 0 || elapsed >= total * reps) return inval;
      let t = elapsed % total;
      let i = 0;
      while (i < this.durs.length - 1 && t >= this.durs[i]) { t -= this.durs[i]; i++; }
      const a = this.levels[i];
      const b = this.levels[Math.min(i + 1, this.levels.length - 1)];
      const x = this.durs[i] > 0 ? t / this.durs[i] : 1;
      inval = yield exp && a > 0 && b > 0 ? a * Math.pow(b / a, x) : a + (b - a) * x;
    }
  }
}

// ---------------------------------------------------------------- filters and functions

export class Pn extends Pattern {
  readonly name = "Pn";
  pattern: Value;
  repeats: Value;
  constructor(pattern: Value, repeats: Value = Infinity) {
    super();
    this.pattern = pattern;
    this.repeats = repeats;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const reps = repeatsOf(this.repeats, ctx, inval);
    for (let r = 0; r < reps; r++) inval = yield* embedItem(this.pattern, inval, ctx);
    return inval;
  }
}

export class Pdup extends Pattern {
  readonly name = "Pdup";
  n: Value;
  pattern: Value;
  constructor(n: Value, pattern: Value) {
    super();
    this.n = n;
    this.pattern = pattern;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const counts = new Stream(this.n, ctx);
    const values = new Stream(this.pattern, ctx);
    for (;;) {
      const v = values.next(inval);
      const c = counts.next(inval);
      if (v === DONE || c === DONE) return inval;
      for (let i = 0; i < num(c, 1); i++) inval = yield v;
    }
  }
}

export class Pkey extends Pattern {
  readonly name = "Pkey";
  key: string;
  constructor(key: string) {
    super();
    this.key = key;
  }
  *embed(inval: Value, _ctx: Ctx): Gen {
    for (;;) {
      const v = inval instanceof SCEvent ? inval.get(this.key) ?? null : null;
      inval = yield v;
    }
  }
}

export class Pfunc extends Pattern {
  readonly name: string;
  fn: Value;
  repeats: Value;
  constructor(name: string, fn: Value, repeats: Value = Infinity) {
    super();
    this.fn = fn;
    this.repeats = repeats;
    this.name = name;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const reps = repeatsOf(this.repeats, ctx, inval);
    for (let r = 0; r < reps; r++) {
      const v = this.fn instanceof SCFunc ? ctx.host.call(this.fn, [inval]) : this.fn;
      if (v === null) return inval;
      inval = yield v;
    }
    return inval;
  }
}

/** Values drawn by a JavaScript function (Pgauss, Pmeanrand). */
export class Pdraw extends Pattern {
  readonly name: string;
  fn: () => Value;
  length: Value;
  constructor(name: string, fn: () => Value, length: Value = Infinity) {
    super();
    this.name = name;
    this.fn = fn;
    this.length = length;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const n = repeatsOf(this.length, ctx, inval);
    for (let i = 0; i < n; i++) inval = yield this.fn();
    return inval;
  }
}

/** Plazy: a function that makes the pattern when it starts. */
export class Plazy extends Pattern {
  readonly name = "Plazy";
  fn: Value;
  constructor(fn: Value) {
    super();
    this.fn = fn;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const p = this.fn instanceof SCFunc ? ctx.host.call(this.fn, [inval]) : this.fn;
    return yield* embedItem(p, inval, ctx);
  }
}

/** A fixed list of values (from a Prout or a Routine that yields values). */
export class Plist extends Pattern {
  readonly name: string;
  values: Value[];
  constructor(name: string, values: Value[]) {
    super();
    this.values = values;
    this.name = name;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    for (const v of this.values) inval = yield* embedItem(v, inval, ctx);
    return inval;
  }
}

/** a <> b: b's values (or events) are the input of a. */
export class Pchain extends Pattern {
  readonly name = "Pchain";
  patterns: Value[];
  constructor(patterns: Value[]) {
    super();
    this.patterns = patterns;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const streams = this.patterns.map((p) => new Stream(p, ctx));
    for (;;) {
      let v: Value = inval;
      for (let i = streams.length - 1; i >= 0; i--) {
        const input = v instanceof SCEvent ? v.copy() : v;
        const out = streams[i].next(input);
        if (out === DONE) return inval;
        // A value pattern on the left of an event pattern merges into it.
        v = out;
      }
      inval = yield v;
    }
  }
}

export class Pbinop extends Pattern {
  readonly name = "Pbinop";
  op: string;
  a: Value;
  b: Value;
  constructor(op: string, a: Value, b: Value) {
    super();
    this.op = op;
    this.a = a;
    this.b = b;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const a = new Stream(this.a, ctx);
    const b = new Stream(this.b, ctx);
    for (;;) {
      const x = a.next(inval);
      const y = b.next(inval);
      if (x === DONE || y === DONE) return inval;
      inval = yield ctx.host.binop(this.op, x, y);
    }
  }
}

export class Punop extends Pattern {
  readonly name = "Punop";
  method: string;
  a: Value;
  args: Value[];
  constructor(method: string, a: Value, args: Value[]) {
    super();
    this.method = method;
    this.a = a;
    this.args = args;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const a = new Stream(this.a, ctx);
    const args = this.args.map((x) => new Stream(x, ctx));
    for (;;) {
      const x = a.next(inval);
      if (x === DONE) return inval;
      const ys: Value[] = [];
      for (const s of args) {
        const y = s.next(inval);
        if (y === DONE) return inval;
        ys.push(y);
      }
      inval = yield ctx.host.send(x, this.method, ys);
    }
  }
}

export class Pcollect extends Pattern {
  readonly name: string;
  fn: SCFunc;
  pattern: Value;
  constructor(name: string, fn: SCFunc, pattern: Value) {
    super();
    this.fn = fn;
    this.pattern = pattern;
    this.name = name;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const s = new Stream(this.pattern, ctx);
    for (;;) {
      const v = s.next(inval);
      if (v === DONE) return inval;
      if (this.name === "Pselect" || this.name === "Preject") {
        const keep = ctx.host.call(this.fn, [v]) === true;
        if (keep === (this.name === "Pselect")) inval = yield v;
        continue;
      }
      inval = yield ctx.host.call(this.fn, [v]);
    }
  }
}

export class Pfin extends Pattern {
  readonly name = "Pfin";
  count: Value;
  pattern: Value;
  constructor(count: Value, pattern: Value) {
    super();
    this.count = count;
    this.pattern = pattern;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const n = repeatsOf(this.count, ctx, inval);
    const s = new Stream(this.pattern, ctx);
    for (let i = 0; i < n; i++) {
      const v = s.next(inval);
      if (v === DONE) return inval;
      inval = yield v;
    }
    return inval;
  }
}

/** Pconst(sum, pattern): values that add up to sum; the last one is cut to fit. */
export class Pconst extends Pattern {
  readonly name = "Pconst";
  sum: number;
  pattern: Value;
  tolerance: number;
  constructor(sum: number, pattern: Value, tolerance = 0.001) {
    super();
    this.sum = sum;
    this.pattern = pattern;
    this.tolerance = tolerance;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const s = new Stream(this.pattern, ctx);
    let total = 0;
    for (;;) {
      const v = s.next(inval);
      if (v === DONE || typeof v !== "number") {
        // As SuperCollider: a stream that ends early is padded to the sum.
        if (this.sum - total > this.tolerance) inval = yield this.sum - total;
        return inval;
      }
      if (total + v >= this.sum - this.tolerance) {
        inval = yield this.sum - total;
        return inval;
      }
      total += v;
      inval = yield v;
    }
  }
}

/** Pfx and Pfxb: the events of a pattern go through an effect synth (it reads its input with In.ar). */
export class Pfx extends Pattern {
  readonly name: string;
  pattern: Value;
  fx: Value;
  constructor(name: string, pattern: Value, fx: Value) {
    super();
    this.name = name;
    this.pattern = pattern;
    this.fx = fx;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const s = new Stream(this.pattern, ctx);
    for (;;) {
      const ev = s.next(inval);
      if (ev === DONE) return inval;
      if (!(ev instanceof SCEvent)) { inval = yield ev; continue; }
      const out = ev.copy();
      const before = out.get("__fx");
      out.set("__fx", [...(Array.isArray(before) ? before : []), this.fx]);
      inval = yield out;
    }
  }
}

export class Pif extends Pattern {
  readonly name = "Pif";
  cond: Value;
  a: Value;
  b: Value;
  constructor(cond: Value, a: Value, b: Value) {
    super();
    this.cond = cond;
    this.a = a;
    this.b = b;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const c = new Stream(this.cond, ctx);
    const a = new Stream(this.a, ctx);
    const b = new Stream(this.b, ctx);
    for (;;) {
      const t = c.next(inval);
      if (t === DONE) return inval;
      const v = (t === true ? a : b).next(inval);
      if (v === DONE) return inval;
      inval = yield v;
    }
  }
}

export class PdefRef extends Pattern {
  readonly name: string;
  key: string;
  value: boolean;
  constructor(key: string, value: boolean) {
    super();
    this.key = key;
    this.value = value;
    this.name = (value ? "Pdefn(\\" : "Pdef(\\") + key + ")";
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const p = this.value ? ctx.host.pdefn(this.key) : ctx.host.pdef(this.key);
    if (p === null || p === undefined) return inval;
    return yield* embedItem(p, inval, ctx);
  }
}

// ---------------------------------------------------------------- event patterns

let nextSource = 1;

/** Keys whose random values must be drawn (they shape time or choose a synth). */
const FIXED_KEYS = new Set(["dur", "delta", "stretch", "legato", "sustain", "instrument", "type", "s"]);

export class Pbind extends Pattern {
  readonly name = "Pbind";
  pairs: [Value, Value][];
  id: number;
  line: number;
  mono: boolean;
  constructor(pairs: [Value, Value][], line: number, mono = false) {
    super();
    this.pairs = pairs;
    this.line = line;
    this.mono = mono;
    this.id = nextSource++;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const streams = this.pairs.map(([key, value]) => ({ key, stream: new Stream(value, ctx) }));
    for (;;) {
      const ev = inval instanceof SCEvent ? inval.copy() : new SCEvent();
      for (const { key, stream } of streams) {
        let v = stream.next(ev);
        if (v === DONE) return inval;
        if (Array.isArray(key)) {
          // #[\freq, \dur]: one array value per key.
          const values = list(v);
          key.forEach((k, i) => ev.set(k instanceof Sym ? k.name : String(k), values[mod(i, values.length)]));
          continue;
        }
        const name = key instanceof Sym ? key.name : String(key);
        if (v instanceof RandToken && FIXED_KEYS.has(name)) {
          if (name === "dur" || name === "delta" || name === "stretch") {
            ev.set("__randtime", true);
            // The random duration itself, for TidalJS's rhythm().
            ev.set(name === "stretch" ? "__stretchtoken" : "__durtoken", v);
          }
          else if (!["slider", "toggle", "midicc", "oscin"].includes(v.kind)) ctx.host.note("A random " + name + " is drawn for each event.");
          else ctx.host.note("A live " + name + " (a slider, MIDI or OSC value) takes its starting value: TidalJS's rhythm cannot follow it.");
          v = v.realize(ctx.host.rng);
          // The draw, to tell the event's length (scaled by stretch and tempo) from the duration it drew.
          if (name === "dur" || name === "delta") ev.set("__durvalue", v);
        }
        ev.set(name, v);
      }
      if (!ev.has("__src")) {
        ev.set("__src", this.id);
        ev.set("__line", this.line);
      }
      if (this.mono) ev.set("__mono", true);
      inval = yield ev;
    }
  }
}

/** How far an event moves time: its own delta (dur * stretch), or the gap Ppar gave it. */
export function ownDelta(ev: SCEvent): number {
  const d = ev.get("delta");
  if (typeof d === "number") return d;
  let dur: Value = ev.get("dur") ?? 1;
  if (dur instanceof RestV) dur = dur.dur;
  if (Array.isArray(dur)) dur = dur[0] ?? 1;
  const stretch = ev.get("stretch");
  return (typeof dur === "number" ? dur : 1) * (typeof stretch === "number" ? stretch : 1);
}

export function advanceOf(ev: SCEvent): number {
  const gap = ev.get("__gap");
  return typeof gap === "number" ? gap : ownDelta(ev);
}

/** Ppar and Ptpar: several event streams at once. */
export class Ppar extends Pattern {
  readonly name: string;
  items: Value[];
  offsets: number[];
  repeats: Value;
  constructor(name: string, items: Value[], offsets: number[], repeats: Value = 1) {
    super();
    this.items = items;
    this.offsets = offsets;
    this.repeats = repeats;
    this.name = name;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const reps = repeatsOf(this.repeats, ctx, inval);
    for (let r = 0; r < reps; r++) {
      ctx.host.tick?.();
      const base = inval instanceof SCEvent ? inval : new SCEvent();
      type Entry = { t: number; stream: Stream; ev: SCEvent | null; order: number };
      const entries: Entry[] = this.items.map((p, i) => {
        const stream = new Stream(p, ctx);
        const first = stream.next(base.copy());
        return { t: this.offsets[i] ?? 0, stream, ev: first === DONE || !(first instanceof SCEvent) ? null : first, order: i };
      });
      let end = Math.max(0, ...entries.map((e) => e.t));
      let live = entries.filter((e) => e.ev);
      let now = 0;
      if (live.length === 0) {
        if (end > 0) inval = yield restEvent(end);
        continue;
      }
      // A first gap (Ptpar offsets) is a rest.
      const firstT = Math.min(...live.map((e) => e.t));
      if (firstT > 0) { inval = yield restEvent(firstT); now = firstT; }
      while (live.length > 0) {
        live.sort((a, b) => a.t - b.t || a.order - b.order);
        const e = live[0];
        const out = (e.ev as SCEvent).copy();
        const tOut = e.t;
        e.t += advanceOf(e.ev as SCEvent);
        const next = e.stream.next(base.copy());
        e.ev = next === DONE || !(next instanceof SCEvent) ? null : next;
        // The last event of a pattern that ran out: its source ends there, whatever the others do.
        if (!e.ev) { end = Math.max(end, e.t); out.set("__srcEnd", true); }
        live = live.filter((x) => x.ev);
        const nextT = live.length ? Math.min(...live.map((x) => x.t)) : Math.max(end, tOut);
        out.set("__gap", nextT - tOut);
        now = nextT;
        inval = yield out;
      }
      void now;
    }
    return inval;
  }
}

export function restEvent(dur: number): SCEvent {
  return new SCEvent([["dur", new RestV(dur)], ["__rest", true]]);
}

/** Pfindur: stops after `dur` beats, cutting the last event short. */
export class Pfindur extends Pattern {
  readonly name = "Pfindur";
  dur: number;
  pattern: Value;
  constructor(dur: number, pattern: Value) {
    super();
    this.dur = dur;
    this.pattern = pattern;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const s = new Stream(this.pattern, ctx);
    let t = 0;
    for (;;) {
      if (t >= this.dur - 1e-9) return inval;
      const ev = s.next(inval);
      if (ev === DONE || !(ev instanceof SCEvent)) return inval;
      const adv = advanceOf(ev);
      if (t + adv > this.dur + 1e-9) {
        const cut = ev.copy();
        cut.set("__gap", this.dur - t);
        inval = yield cut;
        return inval;
      }
      t += adv;
      inval = yield ev;
    }
  }
}

/** Psync: rounds the length up to a multiple of quant (and stops at maxdur). */
export class Psync extends Pattern {
  readonly name = "Psync";
  pattern: Value;
  quant: number;
  maxdur: number;
  constructor(pattern: Value, quant: number, maxdur: number) {
    super();
    this.pattern = pattern;
    this.quant = quant;
    this.maxdur = maxdur;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const s = new Stream(this.pattern, ctx);
    let t = 0;
    for (;;) {
      if (this.maxdur > 0 && t >= this.maxdur - 1e-9) return inval;
      const ev = s.next(inval);
      if (ev === DONE || !(ev instanceof SCEvent)) break;
      t += advanceOf(ev);
      inval = yield ev;
    }
    const q = this.quant > 0 ? Math.ceil(t / this.quant - 1e-9) * this.quant : t;
    if (q > t + 1e-9) inval = yield restEvent(q - t);
    return inval;
  }
}

/** Padd and Pmul: change a key of every event. */
export class Pmath extends Pattern {
  readonly name: string;
  key: string;
  value: Value;
  pattern: Value;
  constructor(name: string, key: string, value: Value, pattern: Value) {
    super();
    this.key = key;
    this.value = value;
    this.pattern = pattern;
    this.name = name;
  }
  *embed(inval: Value, ctx: Ctx): Gen {
    const s = new Stream(this.pattern, ctx);
    const v = new Stream(this.value, ctx);
    for (;;) {
      const ev = s.next(inval);
      if (ev === DONE || !(ev instanceof SCEvent)) return inval;
      const x = v.next(ev);
      if (x === DONE) return inval;
      const out = ev.copy();
      const old = out.get(this.key);
      out.set(this.key, this.name === "Pset" || old === undefined ? x : ctx.host.binop(this.name === "Padd" ? "+" : "*", old, x));
      inval = yield out;
    }
  }
}

// ---------------------------------------------------------------- helpers

function repeatsOf(v: Value, ctx: Ctx, inval: Value): number {
  if (typeof v === "number") return v;
  if (isPattern(v)) {
    const n = new Stream(v, ctx).next(inval);
    return typeof n === "number" ? n : 1;
  }
  return 1;
}

export function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}

function fold(x: number, lo: number, hi: number) {
  const range = hi - lo;
  if (range <= 0) return lo;
  let y = mod(x - lo, range * 2);
  if (y > range) y = range * 2 - y;
  return lo + y;
}
