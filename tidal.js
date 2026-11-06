/**
 * TidalJS - live coding music in the browser.
 *
 * A JavaScript take on TidalCycles. As in Tidal, a pattern is a function of
 * cyclic time: it can be queried for the events whose onset falls inside a
 * time span measured in cycles. A look-ahead scheduler queries the active
 * patterns slightly ahead of the audio clock and renders every event with the
 * Web Audio API (or sends it to MIDI / OSC), so timing is sample-accurate and
 * independent of the UI.
 *
 * Usage:
 *   const tidal = new TidalJS();
 *   await tidal.init();                 // call from a user gesture (click)
 *   sound("bd [sn sn] <hh cp>").every(4, x => x.fast(2)).play();
 *
 * In the live editor, tidal.eval(code) plays every top-level expression that
 * evaluates to a pattern, replacing whatever was playing before.
 */
(function (root) {
    'use strict';

    // ==================================================================
    // Helpers
    // ==================================================================

    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    const mod = (a, n) => ((a % n) + n) % n;
    const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
    const cyclePos = (t) => t - Math.floor(t);

    function toNumber(v) {
        const x = typeof v === 'number' ? v : parseFloat(v);
        return Number.isFinite(x) ? x : undefined;
    }

    function requireNumber(fname, v) {
        const x = toNumber(v);
        if (x === undefined) {
            throw new TypeError(`${fname}() expects a number, got ${JSON.stringify(v)}`);
        }
        return x;
    }

    function requireFunction(fname, fn) {
        if (typeof fn !== 'function') {
            throw new TypeError(`${fname}() expects a function, e.g. x => x.fast(2)`);
        }
    }

    /**
     * Deterministic pseudo-random number in [0, 1) for a point in time.
     * Seeding by time (instead of Math.random) means the same event always
     * gets the same decision, however many times a span is queried.
     */
    function timeRand(t, seed) {
        let x = (Math.floor(t * 16777216) ^ Math.imul(seed + 1, 0x9e3779b1)) | 0;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
        x ^= x >>> 16;
        return (x >>> 0) / 4294967296;
    }

    let seedCounter = 0;
    const nextSeed = () => seedCounter++;

    /** Runs fn(cycle, spanBegin, spanEnd) for every cycle touched by [b, e). */
    function eachCycle(b, e, fn) {
        const out = [];
        for (let c = Math.floor(b); c < e; c++) {
            const s = Math.max(b, c);
            const t = Math.min(e, c + 1);
            if (s < t) {
                for (const ev of fn(c, s, t)) out.push(ev);
            }
        }
        return out;
    }

    // ==================================================================
    // Music theory
    // ==================================================================

    const NOTE_BASE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

    /**
     * Note name to MIDI number. Accepts c, c4, c#4, cs4, eb3, ef3, ...
     * Sharps: # or s. Flats: b or f. Default octave is 4, so "c" = 60.
     */
    function noteNameToMidi(name) {
        const m = /^([a-g])((?:#|s|b|f)*)(-?\d+)?$/i.exec(String(name).trim());
        if (!m) return undefined;
        let semitones = NOTE_BASE[m[1].toLowerCase()];
        for (const acc of m[2].toLowerCase()) {
            semitones += (acc === '#' || acc === 's') ? 1 : -1;
        }
        const octave = m[3] !== undefined ? parseInt(m[3], 10) : 4;
        return (octave + 1) * 12 + semitones;
    }

    const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
    const freqToMidi = (freq) => 69 + 12 * Math.log2(freq / 440);

    const SCALES = {
        major: [0, 2, 4, 5, 7, 9, 11],
        ionian: [0, 2, 4, 5, 7, 9, 11],
        minor: [0, 2, 3, 5, 7, 8, 10],
        aeolian: [0, 2, 3, 5, 7, 8, 10],
        dorian: [0, 2, 3, 5, 7, 9, 10],
        phrygian: [0, 1, 3, 5, 7, 8, 10],
        lydian: [0, 2, 4, 6, 7, 9, 11],
        mixolydian: [0, 2, 4, 5, 7, 9, 10],
        locrian: [0, 1, 3, 5, 6, 8, 10],
        majpent: [0, 2, 4, 7, 9],
        minpent: [0, 3, 5, 7, 10],
        harmonicminor: [0, 2, 3, 5, 7, 8, 11],
        melodicminor: [0, 2, 3, 5, 7, 9, 11],
        whole: [0, 2, 4, 6, 8, 10],
        wholetone: [0, 2, 4, 6, 8, 10],
        chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        blues: [0, 3, 5, 6, 7, 10],
        ritusen: [0, 2, 5, 7, 9],
        egyptian: [0, 2, 5, 7, 10],
        hexmajor7: [0, 2, 4, 7, 9, 11],
        hexdorian: [0, 2, 3, 5, 7, 10],
        hexphrygian: [0, 1, 3, 5, 8, 10],
        bhairav: [0, 1, 4, 5, 7, 8, 11],
        diminished: [0, 2, 3, 5, 6, 8, 9, 11],
        augmented: [0, 3, 4, 7, 8, 11],
        hungarianminor: [0, 2, 3, 6, 7, 8, 11],
        pelog: [0, 1, 3, 7, 8],
        hirajoshi: [0, 2, 3, 7, 8],
        iwato: [0, 1, 5, 6, 10],
        kumai: [0, 2, 3, 7, 9],
    };

    const CHORDS = {
        major: [0, 4, 7], maj: [0, 4, 7], M: [0, 4, 7],
        aug: [0, 4, 8], plus: [0, 4, 8],
        six: [0, 4, 7, 9], 6: [0, 4, 7, 9],
        sixNine: [0, 4, 7, 9, 14], six9: [0, 4, 7, 9, 14],
        major7: [0, 4, 7, 11], maj7: [0, 4, 7, 11],
        major9: [0, 4, 7, 11, 14], maj9: [0, 4, 7, 11, 14],
        add9: [0, 4, 7, 14],
        major11: [0, 4, 7, 11, 14, 17], maj11: [0, 4, 7, 11, 14, 17],
        add11: [0, 4, 7, 17],
        major13: [0, 4, 7, 11, 14, 21], maj13: [0, 4, 7, 11, 14, 21],
        add13: [0, 4, 7, 21],
        dom7: [0, 4, 7, 10], dom9: [0, 4, 7, 14], dom11: [0, 4, 7, 17], dom13: [0, 4, 7, 21],
        sevenFlat5: [0, 4, 6, 10], sevenSharp5: [0, 4, 8, 10], sevenFlat9: [0, 4, 7, 10, 13],
        nine: [0, 4, 7, 10, 14], eleven: [0, 4, 7, 10, 14, 17], thirteen: [0, 4, 7, 10, 14, 17, 21],
        minor: [0, 3, 7], min: [0, 3, 7], m: [0, 3, 7],
        diminished: [0, 3, 6], dim: [0, 3, 6],
        minorSharp5: [0, 3, 8], msharp5: [0, 3, 8],
        minor6: [0, 3, 7, 9], min6: [0, 3, 7, 9], m6: [0, 3, 7, 9],
        minorSixNine: [0, 3, 9, 7, 14], minor69: [0, 3, 9, 7, 14],
        minor7flat5: [0, 3, 6, 10], m7flat5: [0, 3, 6, 10],
        minorMajor7: [0, 3, 7, 11], mmaj7: [0, 3, 7, 11],
        diminished7: [0, 3, 6, 9], dim7: [0, 3, 6, 9],
        minor7: [0, 3, 7, 10], min7: [0, 3, 7, 10], m7: [0, 3, 7, 10],
        minor9: [0, 3, 7, 10, 14], min9: [0, 3, 7, 10, 14], m9: [0, 3, 7, 10, 14],
        minor11: [0, 3, 7, 10, 14, 17], min11: [0, 3, 7, 10, 14, 17], m11: [0, 3, 7, 10, 14, 17],
        minor13: [0, 3, 7, 10, 14, 17, 21], min13: [0, 3, 7, 10, 14, 17, 21], m13: [0, 3, 7, 10, 14, 17, 21],
        one: [0], 1: [0], five: [0, 7], 5: [0, 7],
        sus2: [0, 2, 7], sus4: [0, 5, 7],
        sevenSus2: [0, 2, 7, 10], sevenSus4: [0, 5, 7, 10],
        nineSus4: [0, 5, 7, 10, 14],
    };

    function rootOffset(root) {
        const n = toNumber(root);
        if (n !== undefined && /^-?\d+(\.\d+)?$/.test(String(root))) return n;
        const midi = noteNameToMidi(root);
        return midi === undefined ? undefined : midi - 60;
    }

    /**
     * Parses chord names like "c'maj", "e4'min7'ii", "0'major'5", "a'm9'o".
     * Modifiers: a number sets how many notes, "i" inverts (repeatable),
     * "o" opens the voicing, "d1" drops the top note an octave.
     * Returns semitones from middle C, or null if it is not a chord.
     */
    function parseChord(word) {
        const parts = String(word).split("'");
        if (parts.length < 2) return null;
        const root = rootOffset(parts[0] || 'c');
        const shape = CHORDS[parts[1] || 'major'];
        if (root === undefined || !shape) return null;
        let notes = shape.slice();
        for (const modifier of parts.slice(2)) {
            if (/^\d+$/.test(modifier)) {
                const count = parseInt(modifier, 10);
                const base = notes;
                notes = [];
                for (let i = 0; i < count; i++) {
                    notes.push(base[i % base.length] + 12 * Math.floor(i / base.length));
                }
            } else if (/^i+$/.test(modifier) || /^i\d+$/.test(modifier)) {
                const times = /^i\d+$/.test(modifier) ? parseInt(modifier.slice(1), 10) : modifier.length;
                for (let i = 0; i < times; i++) {
                    notes.sort((a, b) => a - b);
                    notes.push(notes.shift() + 12);
                }
            } else if (modifier === 'o') {
                if (notes.length > 2) {
                    notes.sort((a, b) => a - b);
                    notes[0] -= 12;
                    notes[2] -= 12;
                }
            } else if (/^d\d+$/.test(modifier)) {
                const which = parseInt(modifier.slice(1), 10);
                notes.sort((a, b) => a - b);
                const index = notes.length - which;
                if (which >= 1 && index >= 0) notes[index] -= 12;
            } else {
                return null;
            }
        }
        return notes.sort((a, b) => a - b).map((n) => root + n);
    }

    /** Scale degree to semitones from middle C. Name: "major", "e:minor", "a3:blues". */
    function scaleNote(name, degree, tidal) {
        const parts = String(name).split(':');
        const scaleName = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase();
        const root = parts.length > 1 ? rootOffset(parts[0]) : 0;
        const steps = SCALES[scaleName];
        if (!steps || root === undefined) {
            if (tidal) tidal._warnOnce(`Unknown scale "${name}"`);
            return undefined;
        }
        const d = Math.floor(degree);
        return root + steps[mod(d, steps.length)] + 12 * Math.floor(d / steps.length);
    }

    /** Pitch of an event value, used to sort chord notes. */
    function pitchOf(v) {
        if (isNum(v)) return v;
        if (typeof v === 'string') return toNumber(v) ?? 0;
        if (v && typeof v === 'object') {
            if (isNum(v.note)) return v.note;
            if (isNum(v.midinote)) return v.midinote;
            if (isNum(v.freq)) return freqToMidi(v.freq);
            if (isNum(v.n)) return v.n;
        }
        return 0;
    }

    function transposeValue(v, semitones) {
        if (isNum(v)) return v + semitones;
        if (typeof v === 'string' && toNumber(v) !== undefined) return toNumber(v) + semitones;
        if (v && typeof v === 'object') {
            if (isNum(v.note)) return { ...v, note: v.note + semitones };
            if (isNum(v.midinote)) return { ...v, midinote: v.midinote + semitones };
            return { ...v, up: (isNum(v.up) ? v.up : 0) + semitones };
        }
        return v;
    }

    // Euclidean rhythm (Bjorklund): k onsets spread over n steps.
    function bjorklund(k, n) {
        n = Math.floor(n);
        k = clamp(Math.round(k), 0, n);
        if (n <= 0) return [];
        if (k === 0) return new Array(n).fill(false);
        if (k === n) return new Array(n).fill(true);
        let a = Array.from({ length: k }, () => [true]);
        let b = Array.from({ length: n - k }, () => [false]);
        while (b.length > 1) {
            const count = Math.min(a.length, b.length);
            const merged = [];
            for (let i = 0; i < count; i++) merged.push(a[i].concat(b[i]));
            const restA = a.slice(count);
            const restB = b.slice(count);
            a = merged;
            b = restA.length ? restA : restB;
        }
        return a.concat(b).flat();
    }

    // ==================================================================
    // Pattern
    // ==================================================================

    /**
     * A pattern: a query function (begin, end) => [{ begin, end, value }]
     * returning the events whose onset is in [begin, end), in cycles.
     * Continuous patterns (signals such as sine or rand) have no events of
     * their own; they provide a value at any time and are sampled by the
     * events of the pattern they are applied to.
     * Patterns are immutable: every method returns a new pattern.
     */
    class PatternBuilder {
        constructor(tidal, query) {
            this.tidal = tidal || null;
            this._query = typeof query === 'function' ? query : () => [];
            this._signal = null;
        }

        /** Events whose onset falls in [begin, end), measured in cycles. */
        query(begin, end) {
            return this._query(begin, end);
        }

        /** Events of the first cycle, handy for debugging in the console. */
        firstCycle() {
            return this.query(0, 1);
        }

        _derive(query) {
            return new PatternBuilder(this.tidal, query);
        }

        withValue(fn) {
            if (this._signal) {
                const sig = this._signal;
                return signal(this.tidal, (t) => fn(sig(t)));
            }
            return this._derive((b, e) => this.query(b, e).map(
                (ev) => ({ begin: ev.begin, end: ev.end, value: fn(ev.value) })
            ));
        }

        _filter(keep) {
            return this._derive((b, e) => this.query(b, e).filter(keep));
        }

        // --- Time transformations --------------------------------------

        // Numeric arguments of these transformations may also be patterns,
        // e.g. .fast("<1 2>") or .ply("2 3").

        /** Plays the pattern `factor` times per cycle. */
        fast(factor) {
            return patterned(this, 'fast', factor, (p, f) => fastPattern(p, f));
        }

        /** Stretches the pattern over `factor` cycles. */
        slow(factor) {
            return patterned(this, 'slow', factor, (p, f) => (f > 0 ? fastPattern(p, 1 / f) : silence(p.tidal)));
        }

        /** Same as fast(). */
        density(factor) {
            return patterned(this, 'density', factor, (p, f) => fastPattern(p, f));
        }

        /** Same as slow(), as in Tidal. */
        sparsity(factor) {
            return patterned(this, 'sparsity', factor, (p, f) => (f > 0 ? fastPattern(p, 1 / f) : silence(p.tidal)));
        }

        /** fast() that also raises the playback speed (and pitch). */
        hurry(factor) {
            return patterned(this, 'hurry', factor, (p, f) => fastPattern(p, f).withValue((v) => (v && typeof v === 'object'
                ? { ...v, speed: (isNum(v.speed) ? v.speed : 1) * f }
                : v)));
        }

        /** Repeats each event n times within its span. */
        ply(n) {
            return patterned(this, 'ply', n, plyPattern);
        }

        /** Starts each cycle one nth further into the pattern, cycling through n starts. */
        iter(n) {
            return patterned(this, 'iter', n, (p, x) => iterPattern(p, x, false));
        }

        /** Like iter(), moving backwards. */
        iterBack(n) {
            return patterned(this, 'iterBack', n, (p, x) => iterPattern(p, x, true));
        }

        /** Repeats the first part of each cycle (e.g. 0.25 for a quarter); negative takes the end. */
        linger(fraction) {
            return patterned(this, 'linger', fraction, lingerPattern);
        }

        /** Shifts values n steps along the events of each cycle, keeping the rhythm. */
        rot(n) {
            return patterned(this, 'rot', n, rotPattern);
        }

        /** Reverses every cycle. */
        rev() {
            if (this._signal) {
                const sig = this._signal;
                return signal(this.tidal, (t) => sig(2 * Math.floor(t) + 1 - t));
            }
            return this._derive((b, e) => eachCycle(b, e, (c, s, t) => {
                const out = [];
                // Look one cycle back so events that started earlier but
                // overlap this cycle are mirrored too.
                for (const ev of this.query(c - 1, c + 1)) {
                    if (ev.end <= c) continue;
                    const begin = 2 * c + 1 - ev.end;
                    const end = 2 * c + 1 - ev.begin;
                    if (begin >= s && begin < t) out.push({ begin, end, value: ev.value });
                }
                return out;
            }));
        }

        /** Shifts the pattern later in time by `cycles` (Tidal's ~>). */
        late(cycles) {
            return patterned(this, 'late', cycles, (p, x) => shiftPattern(p, x));
        }

        /** Shifts the pattern earlier in time by `cycles` (Tidal's <~). */
        early(cycles) {
            return patterned(this, 'early', cycles, (p, x) => shiftPattern(p, -x));
        }

        /** Plays the pattern, then its reverse, alternating every cycle. */
        palindrome() {
            return slowcat(this.tidal, [this, this.rev()]);
        }

        /** Squeezes each cycle into the span [begin, end) of the cycle. */
        compress(begin, end) {
            const a = clamp(requireNumber('compress', begin), 0, 1);
            const z = clamp(requireNumber('compress', end), 0, 1);
            if (z <= a) return silence(this.tidal);
            return compressPattern(this, a, z);
        }

        /** Zooms each cycle so its events fill the whole cycle. */
        stretch() {
            return this._derive((b, e) => eachCycle(b, e, (c, s, t) => {
                const evs = this.query(c, c + 1);
                if (evs.length === 0) return [];
                const lo = Math.min(...evs.map((ev) => ev.begin));
                const hi = Math.min(c + 1, Math.max(...evs.map((ev) => ev.end)));
                const span = hi - lo;
                if (!(span > 0)) return [];
                const out = [];
                for (const ev of evs) {
                    const begin = c + (ev.begin - lo) / span;
                    if (begin >= s && begin < t) {
                        out.push({ begin, end: c + (ev.end - lo) / span, value: ev.value });
                    }
                }
                return out;
            }));
        }

        /** Delays events in the second half of each 1/n slice by x/n. */
        swingBy(x, n) {
            const amount = requireNumber('swingBy', x);
            const slices = requireNumber('swingBy', n);
            if (!(slices > 0)) return this;
            const shift = amount / slices;
            return this._derive((b, e) => {
                const out = [];
                for (const ev of this.query(b - Math.max(0, shift), e - Math.min(0, shift))) {
                    const late = cyclePos(ev.begin * slices) >= 0.5 - 1e-9;
                    const begin = late ? ev.begin + shift : ev.begin;
                    if (begin >= b && begin < e) {
                        out.push(late ? { begin, end: ev.end + shift, value: ev.value } : ev);
                    }
                }
                return out;
            });
        }

        /** Swing with a third of a slice, like Tidal's swing. */
        swing(n) {
            return patterned(this, 'swing', n, (p, x) => p.swingBy(1 / 3, x));
        }

        /** Applies fn on cycles 0, n, 2n, ... (n may be a pattern, e.g. "<2 4>"). */
        every(n, fn) {
            const transformed = applyTransform('every', fn, this);
            return patterned(this, 'every', n, (p, x) => {
                const period = Math.floor(x);
                if (period < 1) throw new RangeError('every() expects n >= 1');
                return p._derive((b, e) => eachCycle(b, e, (c, s, t) =>
                    (mod(c, period) === 0 ? transformed : p).query(s, t)
                ));
            });
        }

        /** Plays fn(pattern) shifted later by `time` cycles on top of the pattern. */
        off(time, fn) {
            const shifted = patterned(this, 'off', time, (p, x) => shiftPattern(p, x));
            return stackPatterns(this.tidal, [this, applyTransform('off', fn, shifted)]);
        }

        /** The pattern panned left and fn(pattern) panned right. */
        jux(fn) {
            return this.juxBy(1, fn);
        }

        /** Like jux(), panned by `amount` (0 to 1) instead of fully left and right. */
        juxBy(amount, fn) {
            const width = clamp(requireNumber('juxBy', amount), 0, 1);
            const right = applyTransform('jux', fn, this);
            return stackPatterns(this.tidal, [this.pan(-width), right.pan(width)]);
        }

        /** Plays the pattern on k of n evenly spread steps (Euclidean rhythm), rotated by `rotation`. */
        euclid(k, n, rotation = 0) {
            return this.struct(euclidBools(this.tidal, requireNumber('euclid', k), requireNumber('euclid', n), requireNumber('euclid', rotation), false));
        }

        /** Plays the pattern on the steps a Euclidean rhythm leaves empty. */
        euclidInv(k, n, rotation = 0) {
            return this.struct(euclidBools(this.tidal, requireNumber('euclidInv', k), requireNumber('euclidInv', n), requireNumber('euclidInv', rotation), true));
        }

        /** The pattern on the hits of a Euclidean rhythm and `other` on its rests. */
        euclidFull(k, n, other, rotation = 0) {
            const rest = toPattern(this.tidal, other, 'euclidFull');
            return stackPatterns(this.tidal, [this.euclid(k, n, rotation), rest.euclidInv(k, n, rotation)]);
        }

        /**
         * Gives each played event the next value of `list` as its n, keeping
         * count under `name` across cycles and code changes (Tidal's nTake).
         */
        nTake(name, list) {
            if (!Array.isArray(list) || list.length === 0 || !list.every((x) => toNumber(x) !== undefined)) {
                throw new TypeError('nTake() expects a name and a list of numbers, e.g. nTake("a", [0, 2, 4])');
            }
            const take = { name: String(name), list: list.map(toNumber) };
            return this.withValue((v) => ({ ...asObject(v), nTake: take }));
        }

        /** Applies fn when (cycle mod n) >= offset, like Tidal's whenmod. */
        whenmod(n, offset, fn) {
            const period = Math.floor(requireNumber('whenmod', n));
            const from = Math.floor(requireNumber('whenmod', offset));
            if (period < 1) throw new RangeError('whenmod() expects n >= 1');
            const transformed = applyTransform('whenmod', fn, this);
            return this._derive((b, e) => eachCycle(b, e, (c, s, t) =>
                (mod(c, period) >= from ? transformed : this).query(s, t)
            ));
        }

        /** Applies fn to the part of each cycle between begin and end (0 to 1). */
        within(begin, end, fn) {
            if (Array.isArray(begin)) {
                fn = end;
                [begin, end] = begin;
            }
            const a = requireNumber('within', begin);
            const z = requireNumber('within', end);
            const transformed = applyTransform('within', fn, this);
            const inside = (ev) => {
                const p = cyclePos(ev.begin);
                return p >= a && p < z;
            };
            return this._derive((b, e) => [
                ...this.query(b, e).filter((ev) => !inside(ev)),
                ...transformed.query(b, e).filter(inside),
            ]);
        }

        /** Divides cycles into n parts and applies fn to one part per cycle, in turn. */
        chunk(n, fn) {
            const parts = Math.floor(requireNumber('chunk', n));
            if (parts < 1) throw new RangeError('chunk() expects n >= 1');
            const transformed = applyTransform('chunk', fn, this);
            return this._derive((b, e) => eachCycle(b, e, (c, s, t) => {
                const k = mod(c, parts);
                const lo = c + k / parts;
                const hi = c + (k + 1) / parts;
                const inside = (ev) => ev.begin >= lo && ev.begin < hi;
                return [
                    ...this.query(s, t).filter((ev) => !inside(ev)),
                    ...transformed.query(s, t).filter(inside),
                ];
            }));
        }

        /** Applies fn where a boolean pattern is true, e.g. .while("1 0", x => x.fast(2)). */
        while(booleans, fn) {
            const bools = toRaw(this.tidal, booleans, 'while');
            const transformed = applyTransform('while', fn, this);
            const on = (ev) => {
                const hit = eventAt(bools, ev.begin);
                return !!hit && isTruthy(hit.value);
            };
            return this._derive((b, e) => [
                ...this.query(b, e).filter((ev) => !on(ev)),
                ...transformed.query(b, e).filter(on),
            ]);
        }

        /** Applies fn until cycle n, then plays the pattern unchanged. */
        until(n, fn) {
            const limit = requireNumber('until', n);
            const transformed = applyTransform('until', fn, this);
            return this._derive((b, e) => eachCycle(b, e, (c, s, t) =>
                (c < limit ? transformed : this).query(s, t)
            ));
        }

        /** Only plays between cycle `begin` and cycle `end`. */
        playFor(begin, end) {
            const a = requireNumber('playFor', begin);
            const z = requireNumber('playFor', end);
            return this._filter((ev) => ev.begin >= a && ev.begin < z);
        }

        /** Silent between cycle `begin` and cycle `end`. */
        stopFor(begin, end) {
            const a = requireNumber('stopFor', begin);
            const z = requireNumber('stopFor', end);
            return this._filter((ev) => ev.begin < a || ev.begin >= z);
        }

        /** Applies fn to each event with probability `prob`. */
        sometimesBy(prob, fn) {
            const p = clamp(requireNumber('sometimesBy', prob), 0, 1);
            const transformed = applyTransform('sometimesBy', fn, this);
            const seed = nextSeed();
            return this._derive((b, e) => {
                const out = [];
                for (const ev of this.query(b, e)) {
                    if (timeRand(ev.begin, seed) >= p) out.push(ev);
                }
                for (const ev of transformed.query(b, e)) {
                    if (timeRand(ev.begin, seed) < p) out.push(ev);
                }
                return out;
            });
        }

        sometimes(fn, prob = 0.5) { return this.sometimesBy(prob, fn); }
        often(fn) { return this.sometimesBy(0.75, fn); }
        rarely(fn) { return this.sometimesBy(0.25, fn); }
        almostNever(fn) { return this.sometimesBy(0.1, fn); }
        almostAlways(fn) { return this.sometimesBy(0.9, fn); }

        /** Randomly removes events with probability `amount`. */
        degradeBy(amount) {
            return patterned(this, 'degradeBy', amount, (p, x) => degradePattern(p, clamp(x, 0, 1), nextSeed()));
        }

        /** Randomly removes half of the events. */
        degrade() {
            return this.degradeBy(0.5);
        }

        /** Keeps only the events that degradeBy(amount) would remove. */
        unDegradeBy(amount) {
            const p = clamp(requireNumber('unDegradeBy', amount), 0, 1);
            const seed = nextSeed();
            return this._filter((ev) => timeRand(ev.begin, seed) < p);
        }

        /** Splits cycles into n parts and plays n randomly chosen parts (with repeats). */
        scramble(n) {
            const parts = Math.floor(requireNumber('scramble', n));
            if (parts < 1) throw new RangeError('scramble() expects n >= 1');
            const seed = nextSeed();
            return rearrange(this, parts, (c, i) => Math.floor(timeRand(c + i / parts, seed) * parts));
        }

        /** Splits cycles into n parts and plays them in a random order (no repeats). */
        shuffle(n) {
            const parts = Math.floor(requireNumber('shuffle', n));
            if (parts < 1) throw new RangeError('shuffle() expects n >= 1');
            const seed = nextSeed();
            let lastCycle = null;
            let order = null;
            return rearrange(this, parts, (c, i) => {
                if (c !== lastCycle) {
                    order = Array.from({ length: parts }, (_, k) => k);
                    for (let k = parts - 1; k > 0; k--) {
                        const j = Math.floor(timeRand(c + k / parts, seed) * (k + 1));
                        [order[k], order[j]] = [order[j], order[k]];
                    }
                    lastCycle = c;
                }
                return order[i];
            });
        }

        /**
         * Splits cycles into n slices and plays them in the order of an index
         * pattern, e.g. .bite(4, "0 2 1 3"). Also available as fitment().
         */
        bite(n, indices) {
            const parts = Math.floor(requireNumber('bite', n));
            if (parts < 1) throw new RangeError('bite() expects n >= 1');
            const index = toRaw(this.tidal, indices, 'bite');
            return this._derive((b, e) => eachCycle(b, e, (c, s, t) => {
                const out = [];
                for (const iev of index.query(c, c + 1)) {
                    const lo = Math.max(s, iev.begin);
                    const hi = Math.min(t, iev.end);
                    const i = toNumber(iev.value);
                    if (lo >= hi || i === undefined) continue;
                    const srcBegin = c + mod(Math.floor(i), parts) / parts;
                    const scale = (1 / parts) / (iev.end - iev.begin);
                    const toSrc = (x) => srcBegin + (x - iev.begin) * scale;
                    const fromSrc = (x) => iev.begin + (x - srcBegin) / scale;
                    for (const ev of this.query(toSrc(lo), toSrc(hi))) {
                        out.push({ begin: fromSrc(ev.begin), end: fromSrc(ev.end), value: ev.value });
                    }
                }
                return out;
            }));
        }

        fitment(n, indices) {
            return this.bite(n, indices);
        }

        /** Cuts each event into n parts, each playing a slice of the sound. */
        chop(n) {
            return patterned(this, 'chop', n, (p, x) => p._chop(x));
        }

        _chop(n) {
            const parts = Math.floor(n);
            if (parts < 1) throw new RangeError('chop() expects n >= 1');
            return this._derive((b, e) => {
                const out = [];
                // Parts of events that started up to a cycle earlier may land here.
                for (const ev of this.query(Math.floor(b) - 1, e)) {
                    const v = ev.value && typeof ev.value === 'object' ? ev.value : { s: ev.value };
                    const b0 = isNum(v.begin) ? v.begin : 0;
                    const e0 = isNum(v.end) ? v.end : 1;
                    const step = (ev.end - ev.begin) / parts;
                    for (let i = 0; i < parts; i++) {
                        const begin = ev.begin + i * step;
                        if (begin < b || begin >= e) continue;
                        out.push({
                            begin,
                            end: begin + step,
                            value: { ...v, begin: b0 + ((e0 - b0) * i) / parts, end: b0 + ((e0 - b0) * (i + 1)) / parts },
                        });
                    }
                }
                return out;
            });
        }

        /** Plays the pattern n times per cycle, each time a different slice of every sound. */
        striate(n) {
            return patterned(this, 'striate', n, (p, x) => p._striate(x));
        }

        _striate(n) {
            const parts = Math.floor(n);
            if (parts < 1) throw new RangeError('striate() expects n >= 1');
            const slices = [];
            for (let i = 0; i < parts; i++) {
                slices.push(this.withValue((v) => ({
                    ...(v && typeof v === 'object' ? v : { s: v }),
                    begin: i / parts,
                    end: (i + 1) / parts,
                })));
            }
            return fastcat(this.tidal, slices);
        }

        // --- Composition -----------------------------------------------

        /** Plays the pattern and fn(pattern) at the same time. */
        superimpose(fn) {
            return stackPatterns(this.tidal, [this, applyTransform('superimpose', fn, this)]);
        }

        /** Plays another pattern at the same time. */
        overlay(other) {
            return stackPatterns(this.tidal, [this, toPattern(this.tidal, other, 'overlay')]);
        }

        /** Plays another pattern in the next cycle (one pattern per cycle). */
        append(other) {
            const items = [...(this._catItems || [this]), toPattern(this.tidal, other, 'append')];
            const result = slowcat(this.tidal, items);
            result._catItems = items;
            return result;
        }

        /**
         * Keeps the values of this pattern (or of `source`) but takes the
         * rhythm from a boolean pattern: "x ~ x x", "t f t t", "t(3,8)".
         */
        struct(structure, source) {
            const src = source === undefined ? this : toPattern(this.tidal, source, 'struct');
            const bools = toRaw(this.tidal, structure, 'struct');
            return new PatternBuilder(this.tidal, (b, e) => {
                const out = [];
                for (const ev of bools.query(b, e)) {
                    if (!isTruthy(ev.value)) continue;
                    const hit = eventAt(src, ev.begin);
                    if (hit) out.push({ begin: ev.begin, end: ev.end, value: hit.value });
                }
                return out;
            });
        }

        /** Samples the pattern (or a signal such as sine) n times per cycle. */
        segment(n) {
            return patterned(this, 'segment', n, (p, x) => {
                const steps = Math.floor(x);
                if (steps < 1) throw new RangeError('segment() expects n >= 1');
                return p.struct(fastPattern(pure(p.tidal, true), steps));
            });
        }

        // --- Values ----------------------------------------------------

        /** Scales values from 0..1 to lo..hi (for signals and numeric patterns). */
        range(lo, hi) {
            const a = requireNumber('range', lo);
            const z = requireNumber('range', hi);
            return this.withValue((v) => {
                const x = toNumber(v);
                return x === undefined ? v : a + x * (z - a);
            });
        }

        /** Rounds numeric values to the nearest integer. */
        quantise() {
            return this.withValue((v) => {
                const x = toNumber(v);
                return x === undefined ? v : Math.round(x);
            });
        }

        quantize() {
            return this.quantise();
        }

        /** Turns a numeric pattern into a continuous one by gliding between values. */
        smooth() {
            const source = this;
            return signal(this.tidal, (t) => {
                const cur = eventAt(source, t);
                const after = source.query(t + 1e-7, Math.floor(t) + 2)
                    .filter((ev) => ev.begin > t)
                    .sort((x, y) => x.begin - y.begin)[0];
                const a = cur ? toNumber(cur.value) : undefined;
                const z = after ? toNumber(after.value) : undefined;
                if (a === undefined) return z;
                if (z === undefined || !cur) return a;
                return a + ((z - a) * (t - cur.begin)) / (after.begin - cur.begin);
            });
        }

        /**
         * Plays the notes of each chord one after another.
         * Modes: up, down, updown, downup, up&down, down&up, converge,
         * diverge, disconverge, pinkyup, thumbup. The mode can be a pattern.
         */
        arp(mode = 'up') {
            const modes = toRaw(this.tidal, mode, 'arp');
            return this._derive((b, e) => eachCycle(b, e, (c, s, t) => {
                const groups = new Map();
                for (const ev of this.query(c, c + 1)) {
                    const key = `${ev.begin}:${ev.end}`;
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(ev);
                }
                const out = [];
                for (const group of groups.values()) {
                    const { begin, end } = group[0];
                    const hit = eventAt(modes, begin);
                    const name = hit ? String(hit.value) : 'up';
                    const arrange = ARP_MODES[name];
                    if (!arrange) {
                        if (this.tidal) this.tidal._warnOnce(`Unknown arp mode "${name}"`);
                        continue;
                    }
                    const order = arrange(group.slice().sort((x, y) => pitchOf(x.value) - pitchOf(y.value)));
                    const step = (end - begin) / order.length;
                    order.forEach((ev, i) => {
                        const nb = begin + i * step;
                        if (nb >= s && nb < t) out.push({ begin: nb, end: nb + step, value: ev.value });
                    });
                }
                return out;
            }));
        }

        arpeggiate(mode = 'up') {
            return this.arp(mode);
        }

        /** Raises the lowest note of each chord by an octave, n times. */
        inversion(n = 1) {
            const times = Math.floor(requireNumber('inversion', n));
            return this._derive((b, e) => {
                const groups = new Map();
                for (const ev of this.query(b, e)) {
                    const key = `${ev.begin}:${ev.end}`;
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(ev);
                }
                const out = [];
                for (const group of groups.values()) {
                    const notes = group.map((ev) => ({ ...ev })).sort((x, y) => pitchOf(x.value) - pitchOf(y.value));
                    for (let i = 0; i < times && notes.length > 0; i++) {
                        const low = notes.shift();
                        low.value = transposeValue(low.value, 12);
                        notes.push(low);
                        notes.sort((x, y) => pitchOf(x.value) - pitchOf(y.value));
                    }
                    out.push(...notes);
                }
                return out;
            });
        }

        /**
         * Sets a control (note, gain, lpf, ...) from a constant or a pattern.
         * Each event takes the control value active at its onset. If the
         * control pattern is denser than this one (more events in a cycle),
         * it provides the rhythm instead, so sound("arpy").note("c e g")
         * plays three notes. Chords in the control produce one event per note.
         */
        _control(name, input, coerce) {
            const tidal = this.tidal;
            if (input === undefined || input === null) {
                throw new TypeError(`${name}() needs a value`);
            }
            if (typeof input === 'number' || typeof input === 'boolean') {
                const v = coerce(input, tidal);
                if (v === undefined) throw new TypeError(`${name}(): invalid value ${input}`);
                return this.withValue((val) => ({ ...asObject(val), [name]: v }));
            }

            const ctrl = toRaw(tidal, input, name);

            // Control provides the rhythm: one event per control event.
            const fromControl = (b, e) => {
                const out = [];
                for (const cev of ctrl.query(b, e)) {
                    const base = eventAt(this, cev.begin);
                    if (!base) continue;
                    const v = coerce(cev.value, tidal);
                    const value = asObject(base.value);
                    out.push({
                        begin: cev.begin,
                        end: cev.end,
                        value: v === undefined ? value : { ...value, [name]: v },
                    });
                }
                return out;
            };
            // This pattern provides the rhythm. As with Tidal's #, an event
            // is dropped where the control has a rest.
            const fromThis = (b, e) => {
                const out = [];
                for (const ev of this.query(b, e)) {
                    for (const hit of eventsAt(ctrl, ev.begin)) {
                        const v = coerce(hit.value, tidal);
                        out.push(v === undefined
                            ? ev
                            : { begin: ev.begin, end: ev.end, value: { ...asObject(ev.value), [name]: v } });
                    }
                }
                return out;
            };
            if (ctrl._signal) return this._derive(fromThis);

            // Decide per cycle which side is denser, so rests or busy bars
            // later in a pattern are handled like the first one.
            const denser = new Map();
            const controlLeads = (c) => {
                if (!denser.has(c)) {
                    if (denser.size > 256) denser.clear();
                    denser.set(c, onsetCount(ctrl, c) > onsetCount(this, c));
                }
                return denser.get(c);
            };
            return this._derive((b, e) => eachCycle(b, e, (c, s, t) =>
                (controlLeads(c) ? fromControl : fromThis)(s, t)
            ));
        }

        // --- Output targets --------------------------------------------

        /** Sends the events to a Web MIDI output (index or name) instead of the synths. */
        midi(output = 0) {
            if (this.tidal) this.tidal.enableMidi();
            return this.withValue((v) => ({ ...asObject(v), midi: output }));
        }

        /** Sends the events as OSC messages over a WebSocket (see setOscUrl). */
        osc(address = '/dirt/play') {
            return this.withValue((v) => ({ ...asObject(v), osc: address }));
        }

        // --- Tempo (kept chainable for backwards compatibility) --------

        setCPS(cps) {
            if (this.tidal) this.tidal.setCPS(cps);
            return this;
        }

        setTempo(bpm) {
            if (this.tidal) this.tidal.setTempo(bpm);
            return this;
        }

        // --- Playback --------------------------------------------------

        /** Starts playing this pattern (alongside any others). */
        play() {
            if (!this.tidal) throw new Error('This pattern is not attached to a TidalJS instance');
            this.tidal._playPattern(this);
            return this;
        }

        /** Stops this pattern. */
        stop() {
            if (this.tidal) this.tidal._stopPattern(this);
            return this;
        }
    }

    const ARP_MODES = {
        up: (x) => x,
        down: (x) => x.slice().reverse(),
        updown: (x) => x.concat(x.slice(1, -1).reverse()),
        downup: (x) => x.slice().reverse().concat(x.slice(1, -1)),
        'up&down': (x) => x.concat(x.slice().reverse()),
        'down&up': (x) => x.slice().reverse().concat(x),
        converge: (x) => {
            const out = [];
            for (let i = 0, j = x.length - 1; i <= j; i++, j--) {
                out.push(x[i]);
                if (i !== j) out.push(x[j]);
            }
            return out;
        },
        diverge: (x) => ARP_MODES.converge(x).reverse(),
        disconverge: (x) => {
            const c = ARP_MODES.converge(x);
            return c.concat(c.slice(0, -1).reverse().slice(0, -1));
        },
        pinkyup: (x) => x.slice(0, -1).flatMap((n) => [n, x[x.length - 1]]),
        thumbup: (x) => x.slice(1).flatMap((n) => [x[0], n]),
    };

    // Control methods: each one sets a value on every event.
    const coerceNumber = (v) => toNumber(v);
    const CONTROLS = {
        s: (v) => (v === undefined || v === null || v === '~' ? undefined : String(v)),
        n: coerceNumber,
        note: (v, tidal) => {
            const x = typeof v === 'number' ? v : (/^-?\d+(\.\d+)?$/.test(String(v)) ? parseFloat(v) : undefined);
            if (x !== undefined) return 60 + x; // numbers are semitones from middle C
            const midi = noteNameToMidi(v);
            if (midi === undefined && tidal) tidal._warnOnce(`Unknown note "${v}"`);
            return midi;
        },
        up: coerceNumber,
        freq: coerceNumber,
        midinote: coerceNumber,
        gain: coerceNumber,
        pan: coerceNumber,
        lpf: coerceNumber,
        hpf: coerceNumber,
        bpf: coerceNumber,
        resonance: coerceNumber,
        delay: coerceNumber,
        reverb: coerceNumber,
        size: coerceNumber,
        orbit: coerceNumber,
        distortion: coerceNumber,
        crush: coerceNumber,
        vowel: (v, tidal) => {
            const key = String(v).toLowerCase();
            if (VOWELS[key]) return key;
            if (tidal) tidal._warnOnce(`Unknown vowel "${v}" (use a, e, i, o or u)`);
            return undefined;
        },
        speed: coerceNumber,
        begin: coerceNumber,
        end: coerceNumber,
        loop: coerceNumber,
        legato: coerceNumber,
        sustain: coerceNumber,
        attack: coerceNumber,
        release: coerceNumber,
        nudge: coerceNumber,
        vel: coerceNumber,
        ccn: coerceNumber,
        ccv: coerceNumber,
        pgm: coerceNumber,
        midichan: coerceNumber,
    };
    const CONTROL_ALIASES = {
        sound: 's',
        cutoff: 'lpf',
        hcutoff: 'hpf',
        bandf: 'bpf',
        room: 'reverb',
        velocity: 'vel',
    };

    for (const [name, coerce] of Object.entries(CONTROLS)) {
        PatternBuilder.prototype[name] = function (value) {
            return this._control(name, value, coerce);
        };
    }
    for (const [alias, name] of Object.entries(CONTROL_ALIASES)) {
        PatternBuilder.prototype[alias] = PatternBuilder.prototype[name];
    }

    function asObject(v) {
        return v && typeof v === 'object' ? v : { s: v === undefined || v === null ? v : String(v) };
    }

    // ==================================================================
    // Pattern constructors and combinators
    // ==================================================================

    function silence(tidal) {
        return new PatternBuilder(tidal, () => []);
    }

    /** One event per cycle carrying `value`. */
    function pure(tidal, value) {
        return new PatternBuilder(tidal, (b, e) => {
            const out = [];
            for (let c = Math.ceil(b); c < e; c++) out.push({ begin: c, end: c + 1, value });
            return out;
        });
    }

    /** A continuous pattern: fn(time) gives the value at any time. */
    function signal(tidal, fn) {
        const p = new PatternBuilder(tidal, () => []);
        p._signal = fn;
        return p;
    }

    function fastPattern(pattern, f) {
        if (!(f > 0)) return silence(pattern.tidal);
        if (f === 1) return pattern;
        if (pattern._signal) {
            const sig = pattern._signal;
            return signal(pattern.tidal, (t) => sig(t * f));
        }
        return pattern._derive((b, e) => pattern.query(b * f, e * f).map(
            (ev) => ({ begin: ev.begin / f, end: ev.end / f, value: ev.value })
        ));
    }

    function shiftPattern(pattern, offset) {
        if (offset === 0) return pattern;
        if (pattern._signal) {
            const sig = pattern._signal;
            return signal(pattern.tidal, (t) => sig(t - offset));
        }
        return pattern._derive((b, e) => pattern.query(b - offset, e - offset).map(
            (ev) => ({ begin: ev.begin + offset, end: ev.end + offset, value: ev.value })
        ));
    }

    /**
     * Calls apply(pattern, x) with a number argument, or, for a pattern of
     * numbers such as "<1 2>" or "1 [2 4]", with each of its values over the
     * part of the cycle where that value holds (as Tidal's patterned
     * arguments do). Transformed patterns are cached per value, so random
     * functions keep their seeds.
     */
    function patterned(pattern, fname, arg, apply) {
        const plain = typeof arg === 'number' || (typeof arg === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(arg));
        if (plain || !(typeof arg === 'string' || arg instanceof PatternBuilder || Array.isArray(arg))) {
            return apply(pattern, requireNumber(fname, arg));
        }
        const values = toRaw(pattern.tidal, arg, fname);
        if (!values._signal) {
            for (const ev of values.query(0, 4)) {
                if (toNumber(ev.value) === undefined) {
                    throw new TypeError(`${fname}() expects a number or a pattern of numbers, got "${ev.value}"`);
                }
            }
        }
        const cache = new Map();
        const at = (x) => {
            if (!cache.has(x)) {
                if (cache.size > 64) cache.clear();
                cache.set(x, apply(pattern, x));
            }
            return cache.get(x);
        };
        return pattern._derive((b, e) => eachCycle(b, e, (c, s, t) => {
            // The parts of this cycle where the argument has one value.
            const parts = values._signal
                ? [{ begin: c, end: c + 1, value: values._signal(c) }]
                : values.query(c - 1, c + 1).filter((ev) => ev.end > c && ev.begin < c + 1);
            const out = [];
            for (const part of parts) {
                const lo = Math.max(s, part.begin);
                const hi = Math.min(t, part.end);
                const x = toNumber(part.value);
                if (lo >= hi || x === undefined) continue;
                for (const ev of at(x).query(lo, hi)) out.push(ev);
            }
            return out;
        }));
    }

    /** Repeats each event n times within its own span. */
    function plyPattern(pattern, n) {
        const times = Math.round(n);
        if (times < 1) return silence(pattern.tidal);
        if (times === 1) return pattern;
        return pattern._derive((b, e) => {
            const out = [];
            // Repeats of events that started up to a cycle earlier may land here.
            for (const ev of pattern.query(Math.floor(b) - 1, e)) {
                const step = (ev.end - ev.begin) / times;
                for (let i = 0; i < times; i++) {
                    const begin = ev.begin + i * step;
                    if (begin >= b && begin < e) out.push({ begin, end: begin + step, value: ev.value });
                }
            }
            return out;
        });
    }

    /** Starts each cycle (cycle mod n)/n later into the pattern; backwards the other way. */
    function iterPattern(pattern, n, backwards) {
        const parts = Math.floor(n);
        if (parts < 1) return pattern;
        return pattern._derive((b, e) => eachCycle(b, e, (c, s, t) => {
            const shift = (mod(c, parts) / parts) * (backwards ? -1 : 1);
            return pattern.query(s + shift, t + shift).map(
                (ev) => ({ begin: ev.begin - shift, end: ev.end - shift, value: ev.value })
            );
        }));
    }

    /** Repeats the first `fraction` of each cycle to fill it; a negative fraction takes the end. */
    function lingerPattern(pattern, fraction) {
        const len = Math.abs(fraction);
        if (len === 0) return silence(pattern.tidal);
        if (len >= 1) return pattern;
        return pattern._derive((b, e) => eachCycle(b, e, (c, s, t) => {
            const source = fraction > 0 ? c : c + 1 - len;
            const out = [];
            for (let slot = c; slot < c + 1 - 1e-9; slot += len) {
                const lo = Math.max(s, slot);
                const hi = Math.min(t, slot + len, c + 1);
                if (lo >= hi) continue;
                const offset = slot - source;
                for (const ev of pattern.query(lo - offset, hi - offset)) {
                    out.push({ begin: ev.begin + offset, end: ev.end + offset, value: ev.value });
                }
            }
            return out;
        }));
    }

    /** Keeps the rhythm of each cycle but gives every event the value of the event n steps later. */
    function rotPattern(pattern, n) {
        const steps = Math.round(n);
        if (steps === 0) return pattern;
        return pattern._derive((b, e) => eachCycle(b, e, (c, s, t) => {
            const events = pattern.query(c, c + 1).slice().sort((x, y) => x.begin - y.begin);
            const out = [];
            events.forEach((ev, i) => {
                if (ev.begin >= s && ev.begin < t) {
                    out.push({ begin: ev.begin, end: ev.end, value: events[mod(i + steps, events.length)].value });
                }
            });
            return out;
        }));
    }

    /** A boolean pattern with k hits spread over n steps, rotated left by `rotation`. */
    function euclidBools(tidal, k, n, rotation, invert) {
        const steps = Math.floor(n);
        if (steps < 1) return silence(tidal);
        let bools = bjorklund(Math.abs(k), steps);
        if (k < 0) bools = bools.map((x) => !x);
        if (invert) bools = bools.map((x) => !x);
        const r = mod(Math.floor(rotation), steps);
        bools = bools.slice(r).concat(bools.slice(0, r));
        return fastcat(tidal, bools.map((on) => pure(tidal, on)));
    }

    /** Maps each cycle c of the pattern into [c + a, c + z). */
    function compressPattern(pattern, a, z) {
        const span = z - a;
        return pattern._derive((b, e) => eachCycle(b, e, (c, s, t) => {
            const lo = Math.max(s, c + a);
            const hi = Math.min(t, c + z);
            if (lo >= hi) return [];
            const toSrc = (x) => c + (x - c - a) / span;
            const fromSrc = (x) => c + a + (x - c) * span;
            return pattern.query(toSrc(lo), toSrc(hi)).map(
                (ev) => ({ begin: fromSrc(ev.begin), end: fromSrc(ev.end), value: ev.value })
            );
        }));
    }

    function degradePattern(pattern, amount, seed) {
        return pattern._filter((ev) => timeRand(ev.begin, seed) >= amount);
    }

    /** Plays slice pick(cycle, i) of each cycle in slot i (n slots per cycle). */
    function rearrange(pattern, n, pick) {
        return pattern._derive((b, e) => eachCycle(b, e, (c, s, t) => {
            const out = [];
            for (let i = 0; i < n; i++) {
                const slotBegin = c + i / n;
                const lo = Math.max(s, slotBegin);
                const hi = Math.min(t, c + (i + 1) / n);
                if (lo >= hi) continue;
                const j = pick(c, i);
                if (j === undefined || j === null) continue;
                const offset = slotBegin - (c + j / n);
                for (const ev of pattern.query(lo - offset, hi - offset)) {
                    out.push({ begin: ev.begin + offset, end: ev.end + offset, value: ev.value });
                }
            }
            return out;
        }));
    }

    function stackPatterns(tidal, patterns) {
        if (patterns.length === 1) return patterns[0];
        return new PatternBuilder(tidal, (b, e) => {
            const out = [];
            for (const p of patterns) {
                for (const ev of p.query(b, e)) out.push(ev);
            }
            return out;
        });
    }

    /** One pattern per cycle; each pattern keeps its own cycle count. */
    function slowcat(tidal, patterns) {
        const n = patterns.length;
        if (n === 0) return silence(tidal);
        if (n === 1) return patterns[0];
        return new PatternBuilder(tidal, (b, e) => eachCycle(b, e, (c, s, t) => {
            const offset = c - Math.floor(c / n);
            return patterns[mod(c, n)].query(s - offset, t - offset).map(
                (ev) => ({ begin: ev.begin + offset, end: ev.end + offset, value: ev.value })
            );
        }));
    }

    /** All patterns squeezed into one cycle. */
    function fastcat(tidal, patterns) {
        return fastPattern(slowcat(tidal, patterns), patterns.length);
    }

    /** Like fastcat, but each step has a relative length: [{ pattern, weight }]. */
    function timecat(tidal, steps) {
        if (steps.length === 0) return silence(tidal);
        if (steps.every((s) => s.weight === 1)) return fastcat(tidal, steps.map((s) => s.pattern));
        const total = steps.reduce((sum, s) => sum + s.weight, 0);
        let pos = 0;
        const parts = steps.map((s) => {
            const a = pos / total;
            pos += s.weight;
            return compressPattern(s.pattern, a, pos / total);
        });
        return stackPatterns(tidal, parts);
    }

    /** Picks one of the patterns at random every cycle. */
    function randcat(tidal, patterns, seed = nextSeed()) {
        const n = patterns.length;
        if (n === 0) return silence(tidal);
        return new PatternBuilder(tidal, (b, e) => eachCycle(b, e, (c, s, t) =>
            patterns[Math.floor(timeRand(c + 0.5, seed) * n)].query(s, t)
        ));
    }

    function euclidPattern(tidal, pattern, k, n, rotation = 0) {
        const steps = Math.floor(n);
        if (steps < 1) return silence(tidal);
        let bools = bjorklund(Math.abs(k), steps);
        if (k < 0) bools = bools.map((x) => !x);
        const r = mod(Math.floor(rotation), steps);
        bools = bools.slice(r).concat(bools.slice(0, r));
        return fastcat(tidal, bools.map((on) => (on ? pattern : silence(tidal))));
    }

    // ==================================================================
    // Mini-notation
    // ==================================================================
    //
    //   "bd sn"        steps share the cycle       "bd . hh hh"  groups
    //   "~"            rest                        "bd _ sn"     "_" lengthens
    //   "[bd sn]"      subsequence in one step     "bd@3 sn"     relative length
    //   "<bd sn>"      one per cycle               "bd!3 sn"     repeat ("bd !" too)
    //   "{a b, c d e}" polymeter (steps of first)  "{a b c}%4"   steps per cycle
    //   "[bd, hh hh]"  play at the same time       "[bd | sn]"   random choice
    //   "bd*2" "bd/2"  faster / slower             "bd?" "bd?0.3" random removal
    //   "bd:3"         sound variation (n)         "bd(3,8,2)"   euclidean rhythm
    //   "c'maj'ii"     chords in note patterns

    const MINI_SYMBOLS = '[]<>{}(),*/!@?%|~';

    function tokenizeMini(src) {
        const tokens = [];
        let i = 0;
        let space = true;
        while (i < src.length) {
            const ch = src[i];
            if (/\s/.test(ch)) {
                space = true;
                i++;
                continue;
            }
            if (MINI_SYMBOLS.includes(ch)) {
                tokens.push({ v: ch, type: 'sym', spaceBefore: space });
                space = false;
                i++;
                continue;
            }
            let j = i;
            while (j < src.length && !/\s/.test(src[j]) && !MINI_SYMBOLS.includes(src[j])) j++;
            const word = src.slice(i, j);
            if (word === '.') {
                tokens.push({ v: '.', type: 'sym', spaceBefore: space });
            } else if (/^_+$/.test(word)) {
                for (let k = 0; k < word.length; k++) tokens.push({ v: '_', type: 'sym', spaceBefore: space || k > 0 });
            } else {
                tokens.push({ v: word, type: 'word', spaceBefore: space });
            }
            space = false;
            i = j;
        }
        return tokens;
    }

    /** Expands "0 .. 3" and "0..3" into the steps 0 1 2 3 (descending ranges too). */
    function expandRanges(tokens) {
        const isInt = (t) => t && t.type === 'word' && /^-?\d+$/.test(t.v);
        const range = (from, to, spaceBefore) => {
            const out = [];
            const step = from <= to ? 1 : -1;
            for (let x = from; out.length <= 1000; x += step) {
                out.push({ v: String(x), type: 'word', spaceBefore: out.length ? true : spaceBefore });
                if (x === to) break;
            }
            return out;
        };
        const out = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            const joined = t.type === 'word' ? /^(-?\d+)\.\.(-?\d+)$/.exec(t.v) : null;
            if (joined) {
                out.push(...range(parseInt(joined[1], 10), parseInt(joined[2], 10), t.spaceBefore));
            } else if (t.type === 'word' && t.v === '..' && isInt(out[out.length - 1]) && isInt(tokens[i + 1])) {
                const start = out.pop();
                out.push(...range(parseInt(start.v, 10), parseInt(tokens[i + 1].v, 10), start.spaceBefore));
                i++;
            } else {
                out.push(t);
            }
        }
        return out;
    }

    function parseMini(tidal, source) {
        const src = String(source);
        const tokens = expandRanges(tokenizeMini(src));
        let pos = 0;
        const peek = () => tokens[pos];
        const next = () => tokens[pos++];
        const fail = (message) => {
            throw new SyntaxError(`Mini-notation "${src}": ${message}`);
        };
        const expect = (v) => {
            const t = next();
            if (!t || t.v !== v) fail(`expected "${v}"`);
        };
        const number = () => {
            const t = next();
            const x = t && t.type === 'word' ? toNumber(t.v) : undefined;
            if (x === undefined) fail('expected a number');
            return x;
        };
        const attachedNumber = () => {
            const t = peek();
            return t && t.type === 'word' && !t.spaceBefore && toNumber(t.v) !== undefined;
        };

        function word(w) {
            if (w.includes("'")) {
                const notes = parseChord(w);
                if (notes) return stackPatterns(tidal, notes.map((n) => pure(tidal, n)));
            }
            return pure(tidal, w);
        }

        function parseAtom() {
            const t = next();
            if (!t) fail('unexpected end');
            if (t.v === '~') return silence(tidal);
            if (t.v === '[') {
                const layers = parseLayers(']');
                expect(']');
                return combine(layers, (groups) => sequence(groups));
            }
            if (t.v === '<') {
                const layers = parseLayers('>');
                expect('>');
                return combine(layers, (groups) => slowcat(tidal, flatSteps(groups).map((s) => s.pattern)));
            }
            if (t.v === '{') {
                const layers = parseLayers('}');
                expect('}');
                let steps;
                if (peek() && peek().v === '%' && !peek().spaceBefore) {
                    next();
                    steps = number();
                }
                const seqs = layers.items.map((groups) => flatSteps(groups).map((s) => s.pattern));
                const base = steps || seqs[0].length || 1;
                return stackPatterns(tidal, seqs.filter((q) => q.length).map(
                    (q) => fastPattern(fastcat(tidal, q), base / q.length)
                ));
            }
            if (t.type === 'word') return word(t.v);
            return fail(`unexpected "${t.v}"`);
        }

        function parseTerm() {
            let p = parseAtom();
            let weight = 1;
            let copies = 1;
            while (peek() && !peek().spaceBefore && '*/!@?('.includes(peek().v)) {
                const op = next().v;
                if (op === '*') p = fastPattern(p, number());
                else if (op === '/') {
                    const f = number();
                    p = f > 0 ? fastPattern(p, 1 / f) : silence(tidal);
                } else if (op === '!') copies += attachedNumber() ? number() - 1 : 1;
                else if (op === '@') weight = number();
                else if (op === '?') p = degradePattern(p, attachedNumber() ? number() : 0.5, nextSeed());
                else if (op === '(') {
                    const k = number();
                    expect(',');
                    const n = number();
                    let rotation = 0;
                    if (peek() && peek().v === ',') {
                        next();
                        rotation = number();
                    }
                    expect(')');
                    p = euclidPattern(tidal, p, k, n, rotation);
                }
            }
            const steps = [];
            for (let i = 0; i < copies; i++) steps.push({ pattern: p, weight });
            return steps;
        }

        // Returns an array of groups (split by "."), each an array of steps.
        function parseSequence(closer) {
            const groups = [[]];
            while (peek() && peek().v !== closer && peek().v !== ',' && peek().v !== '|') {
                const t = peek();
                if ((closer === undefined && ']>})'.includes(t.v) && t.type === 'sym')) fail(`unexpected "${t.v}"`);
                const current = groups[groups.length - 1];
                if (t.v === '.') {
                    next();
                    groups.push([]);
                    continue;
                }
                if (t.v === '_') {
                    next();
                    if (!current.length) fail('"_" needs a step before it');
                    current[current.length - 1] = { ...current[current.length - 1], weight: current[current.length - 1].weight + 1 };
                    continue;
                }
                if (t.v === '!' && t.spaceBefore) {
                    next();
                    if (!current.length) fail('"!" needs a step before it');
                    current.push({ ...current[current.length - 1] });
                    continue;
                }
                current.push(...parseTerm());
            }
            return groups;
        }

        function parseLayers(closer) {
            const items = [parseSequence(closer)];
            let mode = null;
            while (peek() && (peek().v === ',' || peek().v === '|')) {
                const sep = next().v;
                if (mode && mode !== sep) fail('cannot mix "," and "|" in one group');
                mode = sep;
                items.push(parseSequence(closer));
            }
            return { items, mode };
        }

        function flatSteps(groups) {
            if (groups.length > 1) {
                return groups.filter((g) => g.length).map((g) => ({ pattern: timecat(tidal, g), weight: 1 }));
            }
            return groups[0];
        }

        function sequence(groups) {
            return timecat(tidal, flatSteps(groups));
        }

        function combine(layers, build) {
            const patterns = layers.items.map(build);
            if (layers.mode === '|') return randcat(tidal, patterns);
            return stackPatterns(tidal, patterns);
        }

        const top = parseLayers(undefined);
        if (pos < tokens.length) fail(`unexpected "${tokens[pos].v}"`);
        return combine(top, (groups) => sequence(groups));
    }

    // ==================================================================
    // Conversions
    // ==================================================================

    /** Converts strings, arrays, functions or patterns to a raw value pattern. */
    function toRaw(tidal, input, fname) {
        if (input instanceof PatternBuilder) {
            return input.withValue((v) => (v && typeof v === 'object' ? v.s : v));
        }
        if (typeof input === 'string') return parseMini(tidal, input);
        if (Array.isArray(input)) {
            return fastcat(tidal, input.map((item) => {
                if (item === null || item === undefined || item === '~') return silence(tidal);
                if (typeof item === 'string') return parseMini(tidal, item);
                if (item instanceof PatternBuilder) return toRaw(tidal, item, fname);
                return pure(tidal, item);
            }));
        }
        if (typeof input === 'function') {
            // fn(position, cycle) is called for 16 steps per cycle and returns
            // a value, or null / '~' for a rest.
            const steps = 16;
            return new PatternBuilder(tidal, (b, e) => eachCycle(b, e, (c, s, t) => {
                const out = [];
                for (let i = 0; i < steps; i++) {
                    const onset = c + i / steps;
                    if (onset < s || onset >= t) continue;
                    const v = input(i / steps, c);
                    if (v === null || v === undefined || v === false || v === '~' || v === '') continue;
                    out.push({ begin: onset, end: c + (i + 1) / steps, value: v });
                }
                return out;
            }));
        }
        if (typeof input === 'number' || typeof input === 'boolean') return pure(tidal, input);
        throw new TypeError(`${fname}() expects a mini-notation string, an array, a function or a pattern`);
    }

    function soundValue(v) {
        const str = String(v);
        const colon = str.indexOf(':');
        if (colon > 0) {
            const n = toNumber(str.slice(colon + 1));
            if (n !== undefined) return { s: str.slice(0, colon), n };
        }
        return { s: str };
    }

    function soundPattern(tidal, input) {
        return toRaw(tidal, input, 'sound').withValue(soundValue);
    }

    function toPattern(tidal, input, fname) {
        if (input instanceof PatternBuilder) return input;
        if (typeof input === 'string' || Array.isArray(input) || typeof input === 'function') {
            return soundPattern(tidal, input);
        }
        throw new TypeError(`${fname}() expects a pattern, a mini-notation string or an array`);
    }

    function applyTransform(fname, fn, pattern) {
        requireFunction(fname, fn);
        const result = fn(pattern);
        if (!(result instanceof PatternBuilder)) {
            throw new TypeError(`${fname}(): the function must return a pattern, e.g. x => x.fast(2)`);
        }
        return result;
    }

    /** All events of `pattern` that start together and are sounding at time t. */
    function eventsAt(pattern, t) {
        if (pattern._signal) {
            const value = pattern._signal(t);
            return value === undefined ? [] : [{ begin: t, end: t, value }];
        }
        const probe = t + 1e-7;
        for (const back of [0, 7]) {
            let latest = -Infinity;
            let found = [];
            for (const ev of pattern.query(Math.floor(t) - back, probe)) {
                if (ev.begin <= probe && ev.end > probe) {
                    if (ev.begin > latest + 1e-9) {
                        latest = ev.begin;
                        found = [ev];
                    } else if (Math.abs(ev.begin - latest) <= 1e-9) {
                        found.push(ev);
                    }
                }
            }
            if (found.length) return found;
        }
        return [];
    }

    /** The event of `pattern` that is sounding at time t, if any. */
    function eventAt(pattern, t) {
        return eventsAt(pattern, t)[0] || null;
    }

    /** Number of distinct onsets in cycle c (a chord counts once). */
    function onsetCount(pattern, c = 0) {
        return new Set(pattern.query(c, c + 1).map((ev) => Math.round(ev.begin * 1e6))).size;
    }

    function isTruthy(v) {
        return !(v === false || v === 0 || v === '~' || v === '0' || v === 'f' || v === 'false');
    }

    const flatArgs = (args) => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args);

    // ==================================================================
    // Live code evaluation
    // ==================================================================

    const CONTINUES_LINE = '.,([{=+-*/%&|^?:<>!';
    const CONTINUES_NEXT = '.?:+*/%&|^=,)]}';
    const DECLARATION = /^(?:const|let|var|function|async\s+function|class|if|for|while|do|switch|try|return|throw|import|export)(?![\w$])/;

    function nextSignificantChar(code, i) {
        while (i < code.length) {
            const ch = code[i];
            if (/\s/.test(ch)) { i++; continue; }
            if (ch === '/' && code[i + 1] === '/') {
                while (i < code.length && code[i] !== '\n') i++;
                continue;
            }
            if (ch === '/' && code[i + 1] === '*') {
                const j = code.indexOf('*/', i + 2);
                i = j < 0 ? code.length : j + 2;
                continue;
            }
            return ch;
        }
        return '';
    }

    /**
     * Splits code into top-level statements. Comments are removed, strings
     * and brackets are respected, and a newline only ends a statement when
     * the code around it cannot continue (so method chains on new lines
     * starting with "." stay together).
     */
    function splitStatements(code) {
        return splitStatementRanges(code).map((s) => s.text);
    }

    /** Like splitStatements, with each statement's [start, end) offsets in the source. */
    function splitStatementRanges(code) {
        const statements = [];
        let current = '';
        let start = -1;  // offset of the first character of the statement
        let end = -1;    // offset just after its last character
        let depth = 0;
        let i = 0;
        const flush = () => {
            const s = current.trim();
            if (s) statements.push({ text: s, start, end });
            current = '';
            start = -1;
        };
        const mark = (from, to) => {
            if (start < 0) start = from;
            end = to;
        };

        while (i < code.length) {
            const ch = code[i];
            const next = code[i + 1];

            if (ch === '/' && next === '/') {
                while (i < code.length && code[i] !== '\n') i++;
                continue;
            }
            if (ch === '/' && next === '*') {
                const j = code.indexOf('*/', i + 2);
                i = j < 0 ? code.length : j + 2;
                current += ' ';
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                let j = i + 1;
                while (j < code.length && code[j] !== ch) {
                    if (code[j] === '\\') j++;
                    j++;
                }
                current += code.slice(i, j + 1);
                mark(i, Math.min(code.length, j + 1));
                i = j + 1;
                continue;
            }
            if ('([{'.includes(ch)) depth++;
            else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);

            if (depth === 0 && ch === ';') {
                flush();
                i++;
                continue;
            }
            if (depth === 0 && ch === '\n') {
                const trimmed = current.trimEnd();
                const last = trimmed[trimmed.length - 1];
                const upcoming = nextSignificantChar(code, i + 1);
                if (trimmed && !CONTINUES_LINE.includes(last) && !(upcoming && CONTINUES_NEXT.includes(upcoming))) {
                    flush();
                    i++;
                    continue;
                }
            }
            current += ch;
            if (!/\s/.test(ch)) mark(i, i + 1);
            i++;
        }
        flush();
        return statements;
    }

    function compiles(statement) {
        try {
            new Function(`"use strict";\n${statement}\n`);
            return true;
        } catch (err) {
            return false;
        }
    }

    /** Line (1-based) of an offset in the source. */
    function lineOf(code, offset) {
        return code.slice(0, offset).split('\n').length;
    }

    function isExpression(statement) {
        if (statement[0] === '{' || DECLARATION.test(statement)) return false;
        try {
            // Compiles only; nothing is executed here.
            new Function('__out', `"use strict";__out.push((${statement}\n));`);
            return true;
        } catch (err) {
            return false;
        }
    }

    // ==================================================================
    // Synth definitions
    // ==================================================================

    const SAMPLE_DEFS = {
        bd: { type: 'kick', freq: 60, decay: 0.35, variations: 3, level: 0.95 },
        sn: { type: 'snare', freq: 200, decay: 0.16, variations: 4, level: 0.6 },
        hh: { type: 'hihat', freq: 8000, decay: 0.1, variations: 2, level: 0.35 },
        cp: { type: 'clap', freq: 1000, decay: 0.15, variations: 2, level: 0.55 },
        oh: { type: 'hihat', freq: 8000, decay: 0.3, variations: 2, level: 0.3 },
        ch: { type: 'hihat', freq: 10000, decay: 0.05, variations: 2, level: 0.35 },
        cy: { type: 'hihat', freq: 5000, decay: 0.8, variations: 3, level: 0.25 },
        arpy: { type: 'pluck', freq: 440, decay: 0.3, variations: 5, level: 0.35 },
        sine: { type: 'osc', wave: 'sine', freq: 440, decay: 0.5, variations: 1, level: 0.45 },
        saw: { type: 'osc', wave: 'sawtooth', freq: 440, decay: 0.5, variations: 1, level: 0.3 },
        square: { type: 'osc', wave: 'square', freq: 440, decay: 0.5, variations: 1, level: 0.25 },
        tri: { type: 'osc', wave: 'triangle', freq: 440, decay: 0.5, variations: 1, level: 0.45 },
        noise: { type: 'noise', color: 'white', freq: 440, decay: 0.3, variations: 1, level: 0.25 },
        pink: { type: 'noise', color: 'pink', freq: 440, decay: 0.3, variations: 1, level: 0.35 },
    };

    // Sounds that hold for their whole sustain/legato length (like a synth)
    // instead of decaying (like a drum sample cut short).
    const SUSTAINED_TYPES = new Set(['osc', 'noise']);

    // General MIDI drum notes, used when exporting or sending drums to MIDI.
    const GM_DRUMS = { bd: 36, sn: 38, hh: 42, ch: 42, oh: 46, cp: 39, cy: 49 };

    // Formant frequencies (F1, F2, F3) for each vowel.
    const VOWELS = {
        a: [730, 1090, 2440],
        e: [530, 1840, 2480],
        i: [270, 2290, 3010],
        o: [570, 840, 2410],
        u: [300, 870, 2240],
    };

    // ==================================================================
    // OSC and MIDI file encoding
    // ==================================================================

    function oscString(str) {
        const bytes = new TextEncoder().encode(str);
        const out = new Uint8Array(Math.ceil((bytes.length + 1) / 4) * 4);
        out.set(bytes);
        return out;
    }

    function oscMessage(address, args) {
        let tags = ',';
        const parts = [];
        for (const arg of args) {
            if (typeof arg === 'string') {
                tags += 's';
                parts.push(oscString(arg));
            } else if (Number.isInteger(arg)) {
                tags += 'i';
                const b = new Uint8Array(4);
                new DataView(b.buffer).setInt32(0, arg);
                parts.push(b);
            } else {
                tags += 'f';
                const b = new Uint8Array(4);
                new DataView(b.buffer).setFloat32(0, arg);
                parts.push(b);
            }
        }
        return concatBytes([oscString(address), oscString(tags), ...parts]);
    }

    function oscBundle(timeSeconds, message) {
        // NTP time: seconds since 1900 as a 32.32 fixed-point number.
        const ntp = timeSeconds + 2208988800;
        const head = new Uint8Array(8);
        const view = new DataView(head.buffer);
        view.setUint32(0, Math.floor(ntp));
        view.setUint32(4, Math.floor((ntp % 1) * 4294967296));
        const size = new Uint8Array(4);
        new DataView(size.buffer).setInt32(0, message.length);
        return concatBytes([oscString('#bundle'), head, size, message]);
    }

    function concatBytes(chunks) {
        const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let at = 0;
        for (const c of chunks) {
            out.set(c, at);
            at += c.length;
        }
        return out;
    }

    function midiVarLen(n) {
        const bytes = [n & 0x7f];
        while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
        return bytes;
    }

    function midiNoteOf(v) {
        if (isNum(v.midinote)) return v.midinote;
        if (isNum(v.note)) return v.note;
        if (isNum(v.freq)) return freqToMidi(v.freq);
        if (v.s && GM_DRUMS[v.s] !== undefined) return GM_DRUMS[v.s];
        return 60;
    }

    // ==================================================================
    // Engine
    // ==================================================================

    class TidalJS {
        constructor() {
            this.audioContext = null;
            this.masterGain = null;
            this.cps = 0.8;              // cycles per second
            this.isPlaying = false;      // true while the clock runs
            this.channels = new Map();   // id -> pattern
            this.channelCounter = 0;
            this.samples = new Map(Object.entries(SAMPLE_DEFS).map(([k, v]) => [k, { ...v }]));
            this.lookahead = 0.1;        // seconds scheduled ahead of the clock
            this.tickInterval = 25;      // scheduler tick in ms
            this.onError = null;         // called with runtime pattern errors
            this.buses = new Map();      // values set with setBus()
            this.oscUrl = 'ws://localhost:8080';
            this.midiAccess = null;

            this._anchorTime = 0;        // audio time at which _anchorCycle starts
            this._anchorCycle = 0;
            this._nextCycle = 0;         // scheduled up to this cycle
            this._session = null;        // output node and effect buses of the current run
            this._collecting = null;     // patterns that call .play() during eval()
            this._warnings = null;
            this._warned = new Set();
            this._noise = {};
            this._impulses = new Map();
            this._curves = new Map();
            this._worker = null;
            this._timer = null;
            this._socket = null;
            this._socketQueue = [];
            this._recorder = null;
            this._midiRequest = null;

            // Loaded sample banks: name -> list of file URLs (see samples()).
            this.sampleBanks = new Map();
            this._sampleManifests = new Map(); // source -> promise
            this._sampleBuffers = new Map();   // url -> { buffer, reversed, promise }
            this._sampleLoads = new Set();     // promises still loading
            this._nTakeCounters = new Map();   // nTake name -> next index
        }

        // --- Setup -----------------------------------------------------

        /**
         * Creates the audio graph and the global functions. Call it from a
         * user gesture so the browser lets audio start. Returns true on success.
         */
        async init() {
            try {
                if (!this.audioContext) {
                    const Ctx = root.AudioContext || root.webkitAudioContext;
                    if (!Ctx) throw new Error('The Web Audio API is not supported in this browser');
                    const ctx = new Ctx();
                    this.audioContext = ctx;

                    this.masterGain = ctx.createGain();
                    this.masterGain.gain.value = 0.8;
                    const limiter = ctx.createDynamicsCompressor();
                    limiter.threshold.value = -8;
                    limiter.knee.value = 8;
                    limiter.ratio.value = 6;
                    limiter.attack.value = 0.003;
                    limiter.release.value = 0.2;
                    this.masterGain.connect(limiter);
                    limiter.connect(ctx.destination);
                    this.output = limiter;

                    this.setupGlobalFunctions();
                }
                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume();
                }
                return true;
            } catch (error) {
                console.error('TidalJS: audio initialisation failed:', error);
                this.lastError = error.message;
                return false;
            }
        }

        /** Installs sound(), stack(), cat() and friends on the global object. */
        setupGlobalFunctions() {
            const g = root;
            const patternsOf = (args, name) => flatArgs(args).map((p) => toPattern(this, p, name));
            g.tidal = this;
            g.sound = (pattern) => soundPattern(this, pattern);
            g.s = g.sound;
            g.stack = (...patterns) => stackPatterns(this, patternsOf(patterns, 'stack'));
            g.layer = (...patterns) => stackPatterns(this, patternsOf(patterns, 'layer'));
            g.cat = (...patterns) => slowcat(this, patternsOf(patterns, 'cat'));
            g.slowcat = g.cat;
            g.fastcat = (...patterns) => fastcat(this, patternsOf(patterns, 'fastcat'));
            g.randcat = (...patterns) => randcat(this, patternsOf(patterns, 'randcat'));
            g.euclidFull = (k, n, pattern, other, rotation = 0) =>
                toPattern(this, pattern, 'euclidFull').euclidFull(k, n, other, rotation);
            g.samples = (source, base) => this.loadSamples(source, base);
            g.struct = (structure, pattern) => {
                if (pattern === undefined) throw new TypeError('struct() expects a structure and a pattern');
                return toPattern(this, pattern, 'struct').struct(structure);
            };
            g.silence = silence(this);

            // Continuous patterns (signals), from 0 to 1 over each cycle.
            g.sine = signal(this, (t) => (Math.sin(2 * Math.PI * t) + 1) / 2);
            g.cosine = signal(this, (t) => (Math.sin(2 * Math.PI * (t + 0.25)) + 1) / 2);
            g.saw = signal(this, (t) => cyclePos(t));
            g.isaw = signal(this, (t) => 1 - cyclePos(t));
            g.tri = signal(this, (t) => {
                const x = cyclePos(t);
                return x < 0.5 ? x * 2 : 2 - x * 2;
            });
            g.square = signal(this, (t) => (cyclePos(t) < 0.5 ? 0 : 1));
            g.rand = signal(this, (t) => timeRand(t, 1013));
            g.irand = (n) => {
                const max = requireNumber('irand', n);
                return signal(this, (t) => Math.floor(timeRand(t, 1013) * max));
            };
            g.perlin = signal(this, (t) => {
                const i = Math.floor(t);
                const f = t - i;
                const a = timeRand(i, 2027);
                const b = timeRand(i + 1, 2027);
                const w = f * f * f * (f * (f * 6 - 15) + 10);
                return a + w * (b - a);
            });

            // Harmony
            g.scale = (name, degrees) => {
                if (degrees === undefined) throw new TypeError('scale() expects a scale name and degrees, e.g. scale("major", "0 2 4")');
                const names = toRaw(this, name, 'scale');
                const steps = toRaw(this, degrees, 'scale');
                return new PatternBuilder(this, (b, e) => {
                    const out = [];
                    for (const ev of steps.query(b, e)) {
                        const nameEvent = eventAt(names, ev.begin);
                        const degree = toNumber(ev.value);
                        if (!nameEvent || degree === undefined) continue;
                        const note = scaleNote(nameEvent.value, degree, this);
                        if (note !== undefined) out.push({ begin: ev.begin, end: ev.end, value: note });
                    }
                    return out;
                });
            };
            g.scaleP = g.scale;
            g.scaleList = () => Object.keys(SCALES);
            g.chord = (pattern) => toRaw(this, pattern, 'chord');
            g.chordList = () => Object.keys(CHORDS);
            g.arp = (mode, pattern) => toRaw(this, pattern, 'arp').arp(mode);

            /** fit(step, list, indices): values from list, shifted by step every cycle. */
            g.fit = (step, list, indices) => {
                const shift = requireNumber('fit', step);
                if (!Array.isArray(list) || list.length === 0) throw new TypeError('fit() expects a non-empty list');
                const index = toRaw(this, indices, 'fit');
                return new PatternBuilder(this, (b, e) => {
                    const out = [];
                    for (const ev of index.query(b, e)) {
                        const i = toNumber(ev.value);
                        if (i === undefined) continue;
                        const pick = list[mod(Math.floor(i) + shift * Math.floor(ev.begin), list.length)];
                        out.push({ begin: ev.begin, end: ev.end, value: pick });
                    }
                    return out;
                });
            };

            // Buses: values that can be changed from outside while playing.
            g.setBus = (name, value) => {
                this.buses.set(String(name), value);
                return value;
            };
            g.bus = (name, fallback = 0) => signal(this, () => {
                const v = this.buses.get(String(name));
                return v === undefined ? fallback : v;
            });

            g.setCPS = (cps) => this.setCPS(cps);
            g.setcps = g.setCPS;
            g.setTempo = (bpm) => this.setTempo(bpm);
            g.stopAll = () => this.stopAll();
            g.hush = g.stopAll;

            // Value helpers, evaluated when the code runs.
            g.choose = (options) => {
                if (!Array.isArray(options) || options.length === 0) {
                    throw new TypeError('choose() expects a non-empty array');
                }
                return options[Math.floor(Math.random() * options.length)];
            };
            g.wchoose = (pairs) => {
                if (!Array.isArray(pairs) || pairs.length === 0 || !pairs.every((p) => Array.isArray(p) && isNum(p[1]))) {
                    throw new TypeError('wchoose() expects pairs of [value, weight], e.g. wchoose([["bd", 3], ["sn", 1]])');
                }
                const total = pairs.reduce((sum, p) => sum + Math.max(0, p[1]), 0);
                let r = Math.random() * total;
                for (const [value, weight] of pairs) {
                    r -= Math.max(0, weight);
                    if (r < 0) return value;
                }
                return pairs[pairs.length - 1][0];
            };
            g.cycleChoose = (options) => {
                if (!Array.isArray(options) || options.length === 0) {
                    throw new TypeError('cycleChoose() expects a non-empty array');
                }
                return options[this.getCurrentCycle() % options.length];
            };

            // Output, recording and export
            g.setOscUrl = (url) => {
                this.oscUrl = String(url);
                if (this._socket) this._socket.close();
                this._socket = null;
                return this.oscUrl;
            };
            g.midiOutputs = () => this.midiOutputs();
            g.record = () => this.startRecording();
            g.stopRecording = () => this.stopRecording();
            g.exportPattern = (pattern, cycles, format) => this.exportPattern(pattern, cycles, format);

            // Plays a short 440 Hz beep to check that audio output works.
            g.testAudio = () => {
                const ctx = this.audioContext;
                const osc = ctx.createOscillator();
                const env = ctx.createGain();
                const t = ctx.currentTime + 0.01;
                osc.frequency.value = 440;
                env.gain.setValueAtTime(0, t);
                env.gain.linearRampToValueAtTime(0.3, t + 0.01);
                env.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
                osc.connect(env);
                env.connect(this.masterGain);
                osc.start(t);
                osc.stop(t + 0.5);
            };
        }

        // --- Clock -----------------------------------------------------

        cycleAt(time) {
            return this._anchorCycle + (time - this._anchorTime) * this.cps;
        }

        timeAt(cycle) {
            return this._anchorTime + (cycle - this._anchorCycle) / this.cps;
        }

        /** Current position in cycles (fractional), 0 when stopped. */
        getCyclePosition() {
            if (!this.isPlaying || !this.audioContext) return 0;
            return Math.max(0, this.cycleAt(this.audioContext.currentTime));
        }

        getCurrentCycle() {
            return Math.floor(this.getCyclePosition());
        }

        /** Position inside the current cycle, from 0 to 1. */
        getCycleProgress() {
            return this.getCyclePosition() % 1;
        }

        isPlayingAny() {
            return this.channels.size > 0;
        }

        /** Sets the tempo in cycles per second. Changes apply seamlessly. */
        setCPS(cps) {
            const value = toNumber(cps);
            if (value === undefined || value <= 0) {
                console.warn('TidalJS: setCPS() expects a positive number');
                return this.cps;
            }
            if (this.isPlaying) {
                // Re-anchor at the scheduling frontier so already scheduled
                // events keep their times and new ones follow the new tempo.
                this._anchorTime = this.timeAt(this._nextCycle);
                this._anchorCycle = this._nextCycle;
            }
            this.cps = clamp(value, 0.05, 10);
            return this.cps;
        }

        /** Sets the tempo in beats per minute, assuming 4 beats per cycle. */
        setTempo(bpm) {
            const value = toNumber(bpm);
            if (value === undefined || value <= 0) {
                console.warn('TidalJS: setTempo() expects a positive number');
                return this.cps;
            }
            return this.setCPS(clamp(value, 20, 300) / 240);
        }

        // --- Transport -------------------------------------------------

        _start() {
            if (this.isPlaying) return;
            const ctx = this.audioContext;
            if (!ctx) throw new Error('Call tidal.init() before playing patterns');
            if (ctx.state === 'suspended') ctx.resume();
            this._session = this._createSession();
            this._anchorTime = ctx.currentTime + 0.05;
            this._anchorCycle = 0;
            this._nextCycle = 0;
            this.isPlaying = true;
            this._startTimer();
        }

        _halt() {
            this.isPlaying = false;
            this._stopTimer();
            const session = this._session;
            this._session = null;
            if (session && this.audioContext) {
                // Fade out quickly, then tear down everything of this run,
                // including events already scheduled and effect tails.
                const t = this.audioContext.currentTime;
                const g = session.out.gain;
                g.cancelScheduledValues(t);
                g.setValueAtTime(g.value, t);
                g.linearRampToValueAtTime(0, t + 0.04);
                setTimeout(() => session.nodes.forEach((node) => {
                    try { node.disconnect(); } catch (e) { /* already disconnected */ }
                }), 150);
            }
            this._allNotesOff();
        }

        _playPattern(pattern) {
            if (this._collecting) {
                this._collecting.push(pattern);
                return;
            }
            for (const p of this.channels.values()) {
                if (p === pattern) return;
            }
            this.channels.set(this.channelCounter++, pattern);
            this._start();
        }

        _stopPattern(pattern) {
            for (const [id, p] of this.channels) {
                if (p === pattern) this.channels.delete(id);
            }
            if (this.channels.size === 0) this._halt();
        }

        /** Stops every pattern and silences the output. */
        stopAll() {
            this.channels.clear();
            this.channelCounter = 0;
            this._halt();
        }

        _startTimer() {
            this._stopTimer();
            const tick = () => this._tick();
            // A worker keeps ticking when the tab is in the background, where
            // timers on the main thread are heavily throttled.
            try {
                if (!this._worker && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
                    const src = 'let id=null;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data);};';
                    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
                    this._worker = new Worker(url);
                    URL.revokeObjectURL(url);
                    this._worker.onerror = () => {
                        this._worker = null;
                        if (this.isPlaying) this._timer = setInterval(tick, this.tickInterval);
                    };
                }
            } catch (err) {
                this._worker = null;
            }
            if (this._worker) {
                this._worker.onmessage = tick;
                this._worker.postMessage(this.tickInterval);
            } else {
                this._timer = setInterval(tick, this.tickInterval);
            }
            tick();
        }

        _stopTimer() {
            if (this._worker) this._worker.postMessage(0);
            if (this._timer) clearInterval(this._timer);
            this._timer = null;
        }

        _tick() {
            const ctx = this.audioContext;
            if (!this.isPlaying || !ctx) return;
            const now = ctx.currentTime;
            let from = this._nextCycle;
            // After a long stall (e.g. a suspended tab) skip ahead instead of
            // firing a burst of late events.
            if (this.timeAt(from) < now - 0.5) from = this.cycleAt(now);
            const to = this.cycleAt(now + this.lookahead);
            if (to <= from) return;
            this._nextCycle = to;

            for (const [id, pattern] of this.channels) {
                let events;
                try {
                    events = pattern.query(from, to);
                } catch (error) {
                    console.error('TidalJS: pattern error, removing pattern:', error);
                    this.channels.delete(id);
                    if (typeof this.onError === 'function') this.onError(error);
                    continue;
                }
                for (const ev of events) {
                    const v = asObject(ev.value);
                    const time = this.timeAt(ev.begin) + (isNum(v.nudge) ? v.nudge : 0);
                    if (time < now - 0.02) continue;
                    try {
                        this.playEvent(v, Math.max(time, now), (ev.end - ev.begin) / this.cps);
                    } catch (error) {
                        console.error('TidalJS: could not play event:', error);
                    }
                }
            }
        }

        /** Events of all playing patterns in [begin, end), for visualisation. */
        queryActive(begin, end) {
            const out = [];
            for (const pattern of this.channels.values()) {
                try {
                    for (const ev of pattern.query(begin, end)) out.push(ev);
                } catch (e) { /* reported by the scheduler */ }
            }
            return out;
        }

        // --- Evaluation ------------------------------------------------

        /**
         * Runs live code. Every top-level expression that evaluates to a
         * pattern (or calls .play()) is played. If the code fails, the
         * patterns that were already playing keep playing.
         * Returns { success, activePatterns, error?, warnings }.
         *
         * options.keepOnWarnings: if the new code produces warnings (such as
         * an unknown sound while a name is still being typed), keep the old
         * patterns playing and return { success: false, pending: true }.
         */
        eval(code, options = {}) {
            if (typeof code !== 'string') {
                return { success: false, error: 'Code must be a string', activePatterns: this.channels.size, warnings: [] };
            }
            const warnings = new Set();
            const collected = []; // [statement index, value]
            const statements = splitStatementRanges(code);
            let current = -1;     // statement being run or checked

            // Where an error happened: the statement, or the mini-notation
            // string inside it when the error comes from the parser.
            const locate = (index, error) => {
                const s = statements[index];
                if (!s) return null;
                let start = s.start;
                let end = s.end;
                const mini = /^Mini-notation "([\s\S]*?)":/.exec((error && error.message) || '');
                if (mini) {
                    const at = code.indexOf(mini[1], start);
                    if (at >= 0 && at < end) {
                        start = at;
                        end = at + mini[1].length;
                    }
                }
                return { start, end, line: lineOf(code, start) };
            };
            const fail = (error, index) => {
                console.error('TidalJS:', error);
                return {
                    success: false,
                    error: error && error.message ? error.message : String(error),
                    location: locate(index, error),
                    activePatterns: this.channels.size,
                    warnings: [...warnings],
                };
            };

            this._warnings = warnings;
            this._collecting = { push: (pattern) => collected.push([current, pattern]) };
            try {
                const body = statements
                    .map((s, k) => `__at(${k});\n` + (isExpression(s.text) ? `__out(${k}, (${s.text}\n));` : `${s.text}\n;`))
                    .join('\n');
                let run;
                try {
                    run = new Function('__out', '__at', `"use strict";\n${body}`);
                } catch (error) {
                    return fail(error, statements.findIndex((s) => !compiles(s.text)));
                }
                run((k, value) => collected.push([k, value]), (k) => { current = k; });

                const patterns = [];
                const origin = new Map();
                for (const [k, p] of collected) {
                    if (p instanceof PatternBuilder && !patterns.includes(p)) {
                        patterns.push(p);
                        origin.set(p, k);
                    }
                }
                // Query a few cycles up front: surfaces errors and unknown
                // sounds now instead of in the middle of playback.
                // Sample files used early on start loading now. Unknown
                // names are not reported while sample banks are still loading:
                // they may be in them.
                for (const p of patterns) {
                    current = origin.get(p);
                    for (const ev of p.query(0, 4)) {
                        const v = asObject(ev.value);
                        if (v.midi !== undefined || v.osc !== undefined || !v.s) continue;
                        const bank = this.sampleBanks.get(v.s);
                        if (bank) {
                            if (this.audioContext) this._sampleBuffer(this._sampleUrl(bank, v), false);
                        } else if (!this.samples.has(v.s) && !this.isLoadingSamples()) {
                            warnings.add(`Unknown sound "${v.s}"`);
                        }
                    }
                }

                if (options.keepOnWarnings && warnings.size > 0) {
                    return { success: false, pending: true, activePatterns: this.channels.size, warnings: [...warnings] };
                }

                this.channels = new Map();
                for (const p of patterns) this.channels.set(this.channelCounter++, p);
                this._collecting = null;
                if (patterns.length > 0) this._start();
                else this._halt();

                return { success: true, activePatterns: patterns.length, warnings: [...warnings] };
            } catch (error) {
                return fail(error, current);
            } finally {
                this._collecting = null;
                this._warnings = null;
            }
        }

        _warnOnce(message) {
            if (this._warnings) this._warnings.add(message);
            if (!this._warned.has(message)) {
                this._warned.add(message);
                console.warn('TidalJS:', message);
            }
        }

        // --- Utilities kept from the original API ----------------------

        noteToMidi(name) {
            const midi = noteNameToMidi(name);
            return midi === undefined ? 60 : clamp(midi, 0, 127);
        }

        midiToFreq(midi) {
            return midiToFreq(clamp(midi, 0, 127));
        }

        /** Parses mini-notation and returns the first cycle as plain events. */
        parseMiniNotation(notation) {
            return parseMini(this, notation).query(0, 1).map((ev) => ({
                sample: ev.value,
                time: ev.begin,
                duration: ev.end - ev.begin,
            }));
        }

        // --- Audio graph -----------------------------------------------

        _createSession() {
            const out = this.audioContext.createGain();
            out.connect(this.masterGain);
            return { out, nodes: [out], delays: new Map(), reverbs: new Map() };
        }

        _noiseBuffer(color = 'white') {
            if (!this._noise[color]) {
                const ctx = this.audioContext;
                const length = Math.floor(ctx.sampleRate * 2);
                const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                if (color === 'pink') {
                    // Paul Kellet's refined pink noise filter.
                    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
                    for (let i = 0; i < length; i++) {
                        const w = Math.random() * 2 - 1;
                        b0 = 0.99886 * b0 + w * 0.0555179;
                        b1 = 0.99332 * b1 + w * 0.0750759;
                        b2 = 0.969 * b2 + w * 0.153852;
                        b3 = 0.8665 * b3 + w * 0.3104856;
                        b4 = 0.55 * b4 + w * 0.5329522;
                        b5 = -0.7616 * b5 - w * 0.016898;
                        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
                        b6 = w * 0.115926;
                    }
                } else {
                    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
                }
                this._noise[color] = buffer;
            }
            return this._noise[color];
        }

        _impulseResponse(size) {
            const key = Math.round(clamp(size, 0, 1) * 20);
            if (!this._impulses.has(key)) {
                const ctx = this.audioContext;
                const seconds = 0.5 + (key / 20) * 5.5;
                const length = Math.floor(ctx.sampleRate * seconds);
                const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
                for (let ch = 0; ch < 2; ch++) {
                    const data = buffer.getChannelData(ch);
                    for (let i = 0; i < length; i++) {
                        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
                    }
                }
                this._impulses.set(key, buffer);
            }
            return this._impulses.get(key);
        }

        _curve(kind, amount) {
            const key = `${kind}:${amount}`;
            if (this._curves.has(key)) return this._curves.get(key);
            const size = 8192;
            const curve = new Float32Array(size);
            for (let i = 0; i < size; i++) {
                const x = (i * 2) / (size - 1) - 1;
                if (kind === 'distortion') {
                    const k = amount * 4;
                    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
                } else {
                    const step = Math.pow(0.5, amount - 1);
                    curve[i] = Math.round(x / step) * step;
                }
            }
            this._curves.set(key, curve);
            return curve;
        }

        _delayBus(time, orbit) {
            const session = this._session;
            const ms = Math.round(time * 1000);
            const key = `${orbit}:${ms}`;
            if (session.delays.has(key)) return session.delays.get(key);
            const ctx = this.audioContext;
            const input = ctx.createGain();
            const delay = ctx.createDelay(2);
            const feedback = ctx.createGain();
            const wet = ctx.createGain();
            delay.delayTime.value = ms / 1000;
            feedback.gain.value = 0.35;
            wet.gain.value = 0.6;
            input.connect(delay);
            delay.connect(feedback);
            feedback.connect(delay);
            delay.connect(wet);
            wet.connect(session.out);
            session.nodes.push(input, delay, feedback, wet);
            session.delays.set(key, input);
            return input;
        }

        _reverbBus(size, orbit) {
            const session = this._session;
            const key = `${orbit}:${Math.round(clamp(size, 0, 1) * 20)}`;
            if (!session.reverbs.has(key)) {
                const convolver = this.audioContext.createConvolver();
                convolver.buffer = this._impulseResponse(size);
                convolver.connect(session.out);
                session.nodes.push(convolver);
                session.reverbs.set(key, convolver);
            }
            return session.reverbs.get(key);
        }

        /**
         * Sends a voice through its effects: filters, vowel, distortion,
         * crush and pan in series, then to the output and to the delay and
         * reverb buses of its orbit. The voice nodes are released when the
         * sources end; the effect tails live on in the buses.
         */
        _route(input, v, sources, extraNodes) {
            const ctx = this.audioContext;
            const session = this._session;
            const nodes = [...sources, ...extraNodes, input];
            const orbit = isNum(v.orbit) ? Math.floor(v.orbit) : 0;
            let node = input;
            const add = (next) => {
                node.connect(next);
                node = next;
                nodes.push(next);
            };
            const filter = (type, freq, q) => {
                const f = ctx.createBiquadFilter();
                f.type = type;
                f.frequency.value = clamp(freq, 20, 20000);
                f.Q.value = q;
                add(f);
            };

            const q = isNum(v.resonance) ? clamp(v.resonance, 0.0001, 40) : 1;
            if (isNum(v.lpf) && v.lpf > 0) filter('lowpass', v.lpf, q);
            if (isNum(v.hpf) && v.hpf > 0) filter('highpass', v.hpf, 1);
            if (isNum(v.bpf) && v.bpf > 0) filter('bandpass', v.bpf, 1.5);

            if (v.vowel && VOWELS[v.vowel]) {
                const vin = ctx.createGain();
                const vout = ctx.createGain();
                vout.gain.value = 2;
                VOWELS[v.vowel].forEach((freq, i) => {
                    const f = ctx.createBiquadFilter();
                    const g = ctx.createGain();
                    f.type = 'bandpass';
                    f.frequency.value = freq;
                    f.Q.value = [8, 4, 2][i];
                    g.gain.value = [0.8, 0.6, 0.4][i];
                    vin.connect(f);
                    f.connect(g);
                    g.connect(vout);
                    nodes.push(f, g);
                });
                node.connect(vin);
                nodes.push(vin, vout);
                node = vout;
            }

            if (isNum(v.distortion) && v.distortion > 0) {
                const shaper = ctx.createWaveShaper();
                shaper.curve = this._curve('distortion', Math.round(clamp(v.distortion, 1, 100)));
                shaper.oversample = '4x';
                add(shaper);
            }

            if (isNum(v.crush)) {
                const shaper = ctx.createWaveShaper();
                shaper.curve = this._curve('crush', Math.floor(clamp(v.crush, 1, 16)));
                add(shaper);
            }

            if (isNum(v.pan) && typeof ctx.createStereoPanner === 'function') {
                const panner = ctx.createStereoPanner();
                panner.pan.value = clamp(v.pan, -1, 1);
                add(panner);
            }

            node.connect(session.out);

            if (isNum(v.delay) && v.delay > 0) {
                const send = ctx.createGain();
                send.gain.value = 0.5;
                node.connect(send);
                send.connect(this._delayBus(clamp(v.delay, 0.01, 2), orbit));
                nodes.push(send);
            }

            if (isNum(v.reverb) && v.reverb > 0) {
                const send = ctx.createGain();
                send.gain.value = clamp(v.reverb, 0, 1);
                node.connect(send);
                send.connect(this._reverbBus(isNum(v.size) ? v.size : 0.4, orbit));
                nodes.push(send);
            }

            sources[0].onended = () => {
                for (const n of nodes) {
                    try { n.disconnect(); } catch (e) { /* already disconnected */ }
                }
            };
        }

        // --- Samples ---------------------------------------------------

        /**
         * Loads banks of audio samples. A loaded bank is played instead of
         * the synthesised sound of the same name, with n choosing the file.
         *
         *   samples('github:tidalcycles/dirt-samples')   // a repo's strudel.json
         *   samples('https://example.com/strudel.json')   // a manifest URL
         *   samples({ kick: ['kick1.wav', 'kick2.wav'] }, 'https://example.com/samples/')
         *
         * A manifest maps bank names to file lists, with an optional _base
         * URL. Returns a promise of the number of banks loaded. Loading the
         * same source again reuses the first load.
         */
        loadSamples(source, base = '') {
            const key = typeof source === 'string' ? source + '|' + base : null;
            if (key && this._sampleManifests.has(key)) return this._sampleManifests.get(key);

            const job = (async () => {
                let map = source;
                let root = base;
                if (typeof source === 'string') {
                    const url = manifestUrl(source);
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Could not load samples from ${url} (HTTP ${response.status})`);
                    map = await response.json();
                    if (!root) root = typeof map._base === 'string' ? map._base : url.slice(0, url.lastIndexOf('/') + 1);
                } else if (!source || typeof source !== 'object') {
                    throw new TypeError('samples() expects "github:user/repo", a manifest URL or { name: [files] }');
                } else if (!root && typeof source._base === 'string') {
                    root = source._base;
                }
                let banks = 0;
                for (const [name, files] of Object.entries(map)) {
                    if (name.startsWith('_')) continue;
                    const list = (Array.isArray(files) ? files : typeof files === 'string' ? [files] : Object.values(files || {}))
                        .filter((f) => typeof f === 'string');
                    if (list.length === 0) continue;
                    this.sampleBanks.set(name, list.map((f) => (/^(https?:|data:|blob:)/.test(f) ? f : root + f)));
                    banks++;
                }
                return banks;
            })();

            if (key) this._sampleManifests.set(key, job);
            this._trackLoad(job.catch((err) => {
                if (key) this._sampleManifests.delete(key); // allow a retry
                console.error('TidalJS:', err);
                this._warnOnce(err.message);
            }));
            return job;
        }

        /** True while sample banks or files are still loading. */
        isLoadingSamples() {
            return this._sampleLoads.size > 0;
        }

        /** Resolves once every sample load started so far has finished. */
        async whenSamplesLoaded() {
            while (this._sampleLoads.size > 0) await Promise.all([...this._sampleLoads]);
        }

        _trackLoad(promise) {
            const tracked = Promise.resolve(promise).finally(() => this._sampleLoads.delete(tracked));
            this._sampleLoads.add(tracked);
            return tracked;
        }

        /** The decoded buffer of a sample file (reversed if asked), or null while it loads. */
        _sampleBuffer(url, reversed) {
            let entry = this._sampleBuffers.get(url);
            if (!entry) {
                entry = { buffer: null, reversed: null, failed: false };
                entry.promise = this._trackLoad(fetch(url)
                    .then((response) => {
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        return response.arrayBuffer();
                    })
                    .then((data) => this.audioContext.decodeAudioData(data))
                    .then((buffer) => { entry.buffer = buffer; })
                    .catch((err) => {
                        entry.failed = true;
                        this._warnOnce(`Could not load sample ${url} (${err.message})`);
                    }));
                this._sampleBuffers.set(url, entry);
            }
            if (!entry.buffer) return null;
            if (!reversed) return entry.buffer;
            if (!entry.reversed) {
                const src = entry.buffer;
                const copy = this.audioContext.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
                for (let ch = 0; ch < src.numberOfChannels; ch++) {
                    copy.getChannelData(ch).set(src.getChannelData(ch).slice().reverse());
                }
                entry.reversed = copy;
            }
            return entry.reversed;
        }

        /** The file of a bank that n selects (wrapping around). */
        _sampleUrl(bank, v) {
            return bank[isNum(v.n) ? mod(Math.floor(v.n), bank.length) : 0];
        }

        /**
         * Plays a sample: speed and note/up change the playback rate (a
         * negative speed plays it backwards), begin/end play part of it,
         * legato/sustain cut it, loop repeats it, attack/release fade it.
         */
        _playSample(v, time, duration, bank) {
            const gain = isNum(v.gain) ? clamp(v.gain, 0, 2) : 1;
            if (gain <= 0) return;
            const speed = isNum(v.speed) && v.speed !== 0 ? clamp(v.speed, -16, 16) : 1;
            let semitones = isNum(v.note) ? v.note - 60 : isNum(v.midinote) ? v.midinote - 60 : 0;
            if (isNum(v.up)) semitones += v.up;
            const rate = Math.abs(speed) * Math.pow(2, clamp(semitones, -48, 48) / 12);
            const buffer = this._sampleBuffer(this._sampleUrl(bank, v), speed < 0);
            if (!buffer) return; // still loading: it plays from the next event on

            const begin = isNum(v.begin) ? clamp(v.begin, 0, 1) : 0;
            const end = isNum(v.end) ? clamp(v.end, 0, 1) : 1;
            if (end <= begin) return;
            let window = ((end - begin) * buffer.duration) / rate;
            if (isNum(v.sustain) && v.sustain > 0) window = Math.min(window, v.sustain);
            else if (isNum(v.legato) && v.legato > 0) window = Math.min(window, v.legato * duration);

            const loops = isNum(v.loop) ? clamp(Math.floor(v.loop), 1, 32) : 1;
            for (let i = 0; i < loops; i++) {
                this._sampleVoice(v, time + i * window, buffer, rate, begin * buffer.duration, window, gain * 0.8);
            }
        }

        _sampleVoice(v, time, buffer, rate, offset, window, level) {
            const ctx = this.audioContext;
            const attack = isNum(v.attack) ? clamp(v.attack, 0, 10) : 0;
            const release = isNum(v.release) ? clamp(v.release, 0.001, 10) : 0.005;
            const holdEnd = time + Math.max(window, attack);
            const stopAt = holdEnd + release + 0.02;

            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.playbackRate.value = rate;
            const amp = ctx.createGain();
            amp.gain.value = level;
            const gate = ctx.createGain();
            gate.gain.setValueAtTime(attack > 0 ? 0 : 1, time);
            if (attack > 0) gate.gain.linearRampToValueAtTime(1, time + attack);
            gate.gain.setValueAtTime(1, holdEnd);
            gate.gain.linearRampToValueAtTime(0, holdEnd + release);
            src.connect(amp);
            amp.connect(gate);
            src.start(time, Math.min(offset, buffer.duration));
            src.stop(stopAt);
            this._route(gate, v, [src], [amp]);
        }

        // --- Events ----------------------------------------------------

        /**
         * Renders one event (a map of controls) at an audio time.
         * duration is the event length in seconds (used by legato and MIDI).
         */
        playEvent(v, time, duration = 0.25) {
            if (!this.audioContext || !this._session) return;
            if (v.nTake) {
                // The next value of the list, counted per name across cycles.
                const { name, list } = v.nTake;
                const index = this._nTakeCounters.get(name) || 0;
                this._nTakeCounters.set(name, index + 1);
                v = { ...v, n: list[index % list.length] };
                delete v.nTake;
            }
            if (v.midi !== undefined) {
                this._sendMidi(v, time, duration);
                return;
            }
            if (v.osc !== undefined) {
                this._sendOsc(v, time, duration);
                return;
            }
            const name = v.s;
            if (!name || name === '~') return;
            // A loaded sample bank wins over the synthesised sound of the same name.
            const bank = this.sampleBanks.get(name);
            if (bank) {
                this._playSample(v, time, duration, bank);
                return;
            }
            const def = this.samples.get(name);
            if (!def) {
                if (!this.isLoadingSamples()) this._warnOnce(`Unknown sound "${name}"`);
                return;
            }

            const gain = isNum(v.gain) ? clamp(v.gain, 0, 2) : 1;
            if (gain <= 0) return;
            const level = gain * (def.level ?? 0.5);

            let freq = def.freq;
            if (isNum(v.freq)) freq = clamp(v.freq, 20, 20000);
            else if (isNum(v.midinote)) freq = midiToFreq(clamp(v.midinote, 0, 127));
            else if (isNum(v.note)) freq = midiToFreq(clamp(v.note, 0, 127));
            if (isNum(v.up)) freq *= Math.pow(2, clamp(v.up, -48, 48) / 12);
            const speed = isNum(v.speed) && v.speed !== 0 ? clamp(Math.abs(v.speed), 0.01, 16) : 1;
            freq = clamp(freq * speed, 10, 20000);

            const variation = isNum(v.n) && def.variations ? Math.abs(Math.floor(v.n)) % def.variations : 0;

            // Length of the sound: sustain (seconds) or legato (fraction of
            // the event) override the natural decay.
            let held = null;
            if (isNum(v.sustain) && v.sustain > 0) held = v.sustain;
            else if (isNum(v.legato) && v.legato > 0) held = v.legato * duration;

            const begin = isNum(v.begin) ? clamp(v.begin, 0, 1) : 0;
            const end = isNum(v.end) ? clamp(v.end, 0, 1) : 1;
            if (end <= begin) return;

            const sustained = SUSTAINED_TYPES.has(def.type);
            const natural = this._naturalLength(def, variation) / speed;
            const length = sustained && held ? held : natural;
            let window = (end - begin) * length;
            if (!sustained && held) window = Math.min(window, held);

            const loops = isNum(v.loop) ? clamp(Math.floor(v.loop), 1, 32) : 1;
            for (let i = 0; i < loops; i++) {
                this._voice(def, v, time + i * window, {
                    level, freq, variation, speed, length, window, sustained: sustained && !!held,
                    start: time + i * window - begin * length,
                });
            }
        }

        _naturalLength(def, variation) {
            switch (def.type) {
                case 'kick': return def.decay + variation * 0.1;
                case 'snare': return def.decay + variation * 0.03;
                case 'clap': return def.decay + variation * 0.03;
                case 'hihat': return def.decay + variation * 0.02;
                default: return def.decay;
            }
        }

        /**
         * Builds one voice. Automation is laid out from the virtual start
         * `o.start` (earlier than `time` when begin > 0), while the gate
         * opens at `time` and closes after `o.window`, which implements
         * begin, end, legato, sustain, attack and release for every sound.
         */
        _voice(def, v, time, o) {
            const ctx = this.audioContext;
            const attack = isNum(v.attack) ? clamp(v.attack, 0, 10) : 0;
            const release = isNum(v.release) ? clamp(v.release, 0.001, 10) : (o.sustained ? 0.03 : 0.005);
            const gate = ctx.createGain();
            const holdEnd = time + Math.max(o.window, attack);
            gate.gain.setValueAtTime(attack > 0 ? 0 : 1, time);
            if (attack > 0) gate.gain.linearRampToValueAtTime(1, time + attack);
            gate.gain.setValueAtTime(1, holdEnd);
            gate.gain.linearRampToValueAtTime(0, holdEnd + release);
            const stopAt = holdEnd + release + 0.02;

            const voice = this._generate(def, o, time);
            voice.output.connect(gate);
            for (const src of voice.sources) src.stop(stopAt);
            this._route(gate, v, voice.sources, voice.nodes);
        }

        /** Creates the sound source of a voice. Returns { output, sources, nodes }. */
        _generate(def, o, time) {
            const ctx = this.audioContext;
            const t0 = o.start;
            const nodes = [];
            const sources = [];

            // Percussive envelope: instant attack, exponential decay.
            const decayEnv = (peak, decay, at = t0) => {
                const env = ctx.createGain();
                env.gain.setValueAtTime(0, at);
                env.gain.linearRampToValueAtTime(peak, at + 0.001);
                env.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.011, decay));
                nodes.push(env);
                return env;
            };
            const noiseSource = (color, rate = 1) => {
                const src = ctx.createBufferSource();
                src.buffer = this._noiseBuffer(color);
                src.loop = true;
                src.playbackRate.value = rate;
                src.start(time, Math.random() * 1.5);
                sources.push(src);
                return src;
            };
            const filterNode = (type, freq, q) => {
                const f = ctx.createBiquadFilter();
                f.type = type;
                f.frequency.value = clamp(freq, 20, 20000);
                f.Q.value = q;
                nodes.push(f);
                return f;
            };
            const mix = ctx.createGain();
            nodes.push(mix);

            switch (def.type) {
                case 'kick': {
                    const osc = ctx.createOscillator();
                    const base = o.freq + o.variation * 10;
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(base * 2.5, t0);
                    osc.frequency.exponentialRampToValueAtTime(Math.max(20, base * 0.75), t0 + 0.12 / o.speed);
                    const env = decayEnv(o.level, o.length);
                    osc.connect(env);
                    env.connect(mix);
                    osc.start(time);
                    sources.push(osc);
                    break;
                }
                case 'snare': {
                    const noise = noiseSource('white', o.speed);
                    const hp = filterNode('highpass', (1200 + o.variation * 300) * o.speed, 0.7);
                    const nEnv = decayEnv(o.level, o.length);
                    noise.connect(hp);
                    hp.connect(nEnv);
                    nEnv.connect(mix);
                    const osc = ctx.createOscillator();
                    const body = o.freq + o.variation * 20;
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(body, t0);
                    osc.frequency.exponentialRampToValueAtTime(Math.max(20, body * 0.7), t0 + 0.08 / o.speed);
                    const bEnv = decayEnv(o.level * 0.6, Math.min(o.length, 0.09 / o.speed));
                    osc.connect(bEnv);
                    bEnv.connect(mix);
                    osc.start(time);
                    sources.push(osc);
                    break;
                }
                case 'clap': {
                    const noise = noiseSource('white', o.speed);
                    const bp = filterNode('bandpass', o.freq + o.variation * 200, 1.2);
                    const env = ctx.createGain();
                    nodes.push(env);
                    const g = env.gain;
                    g.setValueAtTime(0, t0);
                    [0, 0.011, 0.022].forEach((offset, i) => {
                        const at = t0 + offset / o.speed;
                        const peak = o.level * [1, 0.8, 0.65][i];
                        g.setValueAtTime(0.0001, at);
                        g.linearRampToValueAtTime(peak, at + 0.001);
                        g.exponentialRampToValueAtTime(peak * 0.1, at + 0.01 / o.speed);
                    });
                    const tail = t0 + 0.03 / o.speed;
                    g.linearRampToValueAtTime(o.level * 0.7, tail + 0.001);
                    g.exponentialRampToValueAtTime(0.0001, tail + Math.max(0.02, o.length - 0.03));
                    noise.connect(bp);
                    bp.connect(env);
                    env.connect(mix);
                    break;
                }
                case 'hihat': {
                    const noise = noiseSource('white', o.speed);
                    const hp = filterNode('highpass', Math.max(1000, o.freq + o.variation * 1000), 0.8);
                    const env = decayEnv(o.level, o.length);
                    noise.connect(hp);
                    hp.connect(env);
                    env.connect(mix);
                    break;
                }
                case 'pluck': {
                    const osc = ctx.createOscillator();
                    const soften = filterNode('lowpass', clamp(o.freq * 8, 200, 18000), 1);
                    osc.type = 'sawtooth';
                    osc.frequency.value = o.freq;
                    const env = decayEnv(o.level, o.length);
                    osc.connect(soften);
                    soften.connect(env);
                    env.connect(mix);
                    osc.start(time);
                    sources.push(osc);
                    break;
                }
                case 'noise':
                case 'osc':
                default: {
                    let src;
                    if (def.type === 'noise') {
                        src = noiseSource(def.color, o.speed);
                    } else {
                        src = ctx.createOscillator();
                        src.type = def.wave || 'sawtooth';
                        src.frequency.value = o.freq;
                        src.start(time);
                        sources.push(src);
                    }
                    const env = ctx.createGain();
                    nodes.push(env);
                    env.gain.setValueAtTime(0, t0);
                    env.gain.linearRampToValueAtTime(o.level, t0 + 0.005);
                    if (!o.sustained) {
                        env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.02, o.length));
                    }
                    src.connect(env);
                    env.connect(mix);
                }
            }
            return { output: mix, sources, nodes };
        }

        // --- MIDI --------------------------------------------------------

        /** Asks the browser for MIDI access (needed once before .midi()). */
        enableMidi() {
            if (this.midiAccess || this._midiRequest) return this._midiRequest || Promise.resolve(this.midiAccess);
            if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
                this._warnOnce('Web MIDI is not available in this browser');
                return Promise.resolve(null);
            }
            this._midiRequest = navigator.requestMIDIAccess({ sysex: false }).then((access) => {
                this.midiAccess = access;
                return access;
            }, (err) => {
                this._midiRequest = null;
                console.warn('TidalJS: MIDI access was refused:', err);
                return null;
            });
            return this._midiRequest;
        }

        /** Names of the available MIDI outputs. */
        midiOutputs() {
            if (!this.midiAccess) {
                this.enableMidi();
                return [];
            }
            return [...this.midiAccess.outputs.values()].map((o) => o.name);
        }

        _midiOutput(selector) {
            if (!this.midiAccess) {
                this.enableMidi();
                this._warnOnce('Waiting for MIDI access; events are skipped until it is granted');
                return null;
            }
            const outputs = [...this.midiAccess.outputs.values()];
            const out = typeof selector === 'number'
                ? outputs[selector]
                : outputs.find((o) => o.name === selector || o.id === selector)
                    || outputs.find((o) => String(o.name).toLowerCase().includes(String(selector).toLowerCase()));
            if (!out) this._warnOnce(`MIDI output ${JSON.stringify(selector)} not found`);
            return out || null;
        }

        _sendMidi(v, time, duration) {
            const out = this._midiOutput(v.midi);
            if (!out) return;
            const ctx = this.audioContext;
            const toPerf = (t) => performance.now() + (t - ctx.currentTime) * 1000;
            const channel = clamp(isNum(v.midichan) ? Math.floor(v.midichan) : 0, 0, 15);
            const at = toPerf(time);
            if (isNum(v.pgm)) out.send([0xc0 | channel, clamp(Math.floor(v.pgm), 0, 127)], at);
            if (isNum(v.ccn) && isNum(v.ccv)) {
                out.send([0xb0 | channel, clamp(Math.floor(v.ccn), 0, 127), clamp(Math.floor(v.ccv), 0, 127)], at);
            }
            if (!v.s && !isNum(v.note) && !isNum(v.midinote) && !isNum(v.freq)) return;
            let note = midiNoteOf(v) + (isNum(v.up) ? v.up : 0);
            note = clamp(Math.round(note), 0, 127);
            let velocity = isNum(v.vel) ? (v.vel <= 1 ? v.vel * 127 : v.vel) : (isNum(v.gain) ? v.gain : 1) * 100;
            velocity = clamp(Math.round(velocity), 1, 127);
            const length = isNum(v.sustain) ? v.sustain : duration * (isNum(v.legato) ? v.legato : 1);
            out.send([0x90 | channel, note, velocity], at);
            out.send([0x80 | channel, note, 0], toPerf(time + Math.max(0.01, length)));
        }

        _allNotesOff() {
            if (!this.midiAccess) return;
            for (const out of this.midiAccess.outputs.values()) {
                for (let ch = 0; ch < 16; ch++) out.send([0xb0 | ch, 123, 0]);
            }
        }

        // --- OSC -------------------------------------------------------

        _sendOsc(v, time, duration) {
            if (typeof WebSocket === 'undefined') return;
            if (!this._socket) {
                try {
                    this._socket = new WebSocket(this.oscUrl);
                    this._socket.binaryType = 'arraybuffer';
                    this._socket.onopen = () => {
                        for (const msg of this._socketQueue) this._socket.send(msg);
                        this._socketQueue = [];
                    };
                    this._socket.onerror = () => this._warnOnce(`Could not connect to the OSC bridge at ${this.oscUrl}`);
                    this._socket.onclose = () => { this._socket = null; };
                } catch (err) {
                    this._warnOnce(`Invalid OSC WebSocket URL ${this.oscUrl}`);
                    return;
                }
            }
            const args = ['cps', this.cps, 'cycle', this.cycleAt(time), 'delta', duration];
            for (const [key, value] of Object.entries(v)) {
                if (key === 'osc' || value === undefined || value === null) continue;
                if (typeof value === 'number' || typeof value === 'string') args.push(key, value);
            }
            const wall = Date.now() / 1000 + (time - this.audioContext.currentTime);
            const packet = oscBundle(wall, oscMessage(String(v.osc), args));
            if (this._socket.readyState === 1) this._socket.send(packet);
            else if (this._socketQueue.length < 256) this._socketQueue.push(packet);
        }

        // --- Recording and export --------------------------------------

        /** Starts recording the audio output. */
        startRecording() {
            if (!this.audioContext) throw new Error('Call tidal.init() before recording');
            if (this._recorder) return false;
            if (typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser');
            const dest = this.audioContext.createMediaStreamDestination();
            this.output.connect(dest);
            const chunks = [];
            const recorder = new MediaRecorder(dest.stream);
            recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
            this._recorder = { recorder, chunks, dest };
            recorder.start();
            return true;
        }

        get isRecording() {
            return !!this._recorder;
        }

        /** Stops recording, downloads the file and resolves with the Blob. */
        stopRecording(filename = 'tidaljs-recording') {
            const rec = this._recorder;
            if (!rec) return Promise.resolve(null);
            this._recorder = null;
            return new Promise((resolve) => {
                rec.recorder.onstop = () => {
                    try { this.output.disconnect(rec.dest); } catch (e) { /* already disconnected */ }
                    const type = rec.recorder.mimeType || 'audio/webm';
                    const blob = new Blob(rec.chunks, { type });
                    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
                    downloadBlob(blob, `${filename}.${ext}`);
                    resolve(blob);
                };
                rec.recorder.stop();
            });
        }

        /**
         * Exports `cycles` cycles of a pattern as 'json' (events) or 'midi'
         * (a Standard MIDI File). Downloads the file in the browser and
         * returns the data.
         */
        exportPattern(pattern, cycles = 4, format = 'json') {
            const p = toPattern(this, pattern, 'exportPattern');
            const n = clamp(Math.floor(requireNumber('exportPattern', cycles)), 1, 1024);
            const events = p.query(0, n)
                .map((ev) => ({ begin: ev.begin, end: ev.end, value: asObject(ev.value) }))
                .sort((a, b) => a.begin - b.begin);
            if (format === 'midi') {
                const bytes = this._midiFile(events);
                if (typeof document !== 'undefined') downloadBlob(new Blob([bytes], { type: 'audio/midi' }), 'tidaljs-pattern.mid');
                return bytes;
            }
            const data = { cps: this.cps, cycles: n, events };
            if (typeof document !== 'undefined') {
                downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'tidaljs-pattern.json');
            }
            return data;
        }

        _midiFile(events) {
            const ppq = 480;
            const ticksPerCycle = ppq * 4;
            const messages = [];
            for (const ev of events) {
                const v = ev.value;
                const drum = v.s && GM_DRUMS[v.s] !== undefined && !isNum(v.note) && !isNum(v.midinote) && !isNum(v.freq);
                const channel = drum ? 9 : clamp(isNum(v.midichan) ? Math.floor(v.midichan) : 0, 0, 15);
                const note = clamp(Math.round(midiNoteOf(v) + (isNum(v.up) ? v.up : 0)), 0, 127);
                const velocity = clamp(Math.round(isNum(v.vel) ? (v.vel <= 1 ? v.vel * 127 : v.vel) : (isNum(v.gain) ? v.gain : 1) * 100), 1, 127);
                const on = Math.round(ev.begin * ticksPerCycle);
                const off = Math.max(on + 1, Math.round(ev.end * ticksPerCycle));
                messages.push({ tick: on, order: 1, data: [0x90 | channel, note, velocity] });
                messages.push({ tick: off, order: 0, data: [0x80 | channel, note, 0] });
            }
            messages.sort((a, b) => a.tick - b.tick || a.order - b.order);

            const track = [];
            const tempo = Math.round(1e6 / (4 * this.cps)); // microseconds per beat
            track.push(0, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff);
            let last = 0;
            for (const m of messages) {
                track.push(...midiVarLen(m.tick - last), ...m.data);
                last = m.tick;
            }
            track.push(0, 0xff, 0x2f, 0x00);

            const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff];
            const len = track.length;
            const trackHeader = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
            return new Uint8Array([...header, ...trackHeader, ...track]);
        }
    }

    /**
     * URL of a sample manifest: "github:user/repo" (or "github:user/repo/branch")
     * is that repository's strudel.json; a folder URL gets /strudel.json added.
     */
    function manifestUrl(source) {
        const github = /^github:([^/\s]+)\/([^/\s]+)(?:\/([^\s]+))?$/.exec(source.trim());
        if (github) {
            const [, user, repo, branch] = github;
            return `https://raw.githubusercontent.com/${user}/${repo}/${branch || 'main'}/strudel.json`;
        }
        if (/\.json(\?.*)?$/.test(source)) return source;
        return source.replace(/\/?$/, '/') + 'strudel.json';
    }

    function downloadBlob(blob, filename) {
        if (typeof document === 'undefined') return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    // Exports
    TidalJS.PatternBuilder = PatternBuilder;
    TidalJS.splitStatements = splitStatements;
    TidalJS.splitStatementRanges = splitStatementRanges;
    TidalJS.parseChord = parseChord;
    TidalJS.bjorklund = bjorklund;
    // Name lists, used by the editor's autocomplete.
    TidalJS.soundNames = Object.keys(SAMPLE_DEFS);
    TidalJS.scaleNames = Object.keys(SCALES);
    TidalJS.chordNames = Object.keys(CHORDS).filter((name) => !/^\d+$/.test(name));
    TidalJS.arpModes = Object.keys(ARP_MODES);
    TidalJS.vowels = Object.keys(VOWELS);
    root.TidalJS = TidalJS;
    root.PatternBuilder = PatternBuilder;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { TidalJS, PatternBuilder };
    }
})(typeof window !== 'undefined' ? window : globalThis);
