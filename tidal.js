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
 *
 * Author:     hexplus
 * Repository: https://github.com/hexplus/tidaljs
 * License:    MIT. Copyright (c) 2025 TidalJS Contributors. See LICENSE.md.
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

    // Tidal's ratio shorthands: w = 1, h = 1/2, q = 1/4, e = 1/8, s = 1/16, t = 1/3, f = 1/5, x = 1/6.
    const RATIO_CHARS = { w: 1, h: 1 / 2, q: 1 / 4, e: 1 / 8, s: 1 / 16, t: 1 / 3, f: 1 / 5, x: 1 / 6 };

    /** A number as Tidal reads one in mini-notation: 0.5, 1%3, q, 3e, or anything toNumber reads. */
    function ratioValue(v) {
        if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
        const str = String(v).trim();
        let m = /^(-?\d+(?:\.\d+)?)%(\d+(?:\.\d+)?)$/.exec(str);
        if (m) return parseFloat(m[2]) === 0 ? undefined : parseFloat(m[1]) / parseFloat(m[2]);
        m = /^(-?)(\d+(?:\.\d+)?)?([whqestfx])$/.exec(str);
        if (m) return (m[1] ? -1 : 1) * (m[2] ? parseFloat(m[2]) : 1) * RATIO_CHARS[m[3]];
        return toNumber(str);
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

    // Random numbers exactly as Tidal makes them (Sound.Tidal.UI): the
    // time's position in a 300-cycle loop, stretched to 29 bits and put
    // through an xorshift. Seeding by time (instead of Math.random) means
    // the same event always gets the same decision, however many times a
    // span is queried, and the same numbers as in Tidal.

    /** Tidal's xorwise, on 64-bit Ints as in Haskell. */
    function xorwise(x) {
        const a = BigInt.asIntN(64, (x << 13n) ^ x);
        const b = BigInt.asIntN(64, (a >> 17n) ^ a);
        return BigInt.asIntN(64, (b << 5n) ^ b);
    }

    /** Tidal's timeToIntSeed: xorwise . truncate . (* 2^29) . snd . properFraction . (/ 300). */
    function timeToIntSeed(t) {
        const x = t / 300;
        return xorwise(BigInt(Math.trunc((x - Math.trunc(x)) * 536870912)));
    }

    /** Tidal's intSeedToRand: the seed mod 2^29, as a fraction of 2^29. */
    function intSeedToRand(seed) {
        const m = ((seed % 536870912n) + 536870912n) % 536870912n;
        return Number(m) / 536870912;
    }

    /** Tidal's timeToRand: a random number in [0, 1) for a time in cycles (0.5 at time 0). */
    function timeToRand(t) {
        if (t === 0) return 0.5;
        return intSeedToRand(timeToIntSeed(t));
    }

    /** Tidal's timeToRands: n random numbers from the seed of a time. */
    function timeToRands(t, n) {
        let seed = timeToIntSeed(t === 0 ? 9999999 : t);
        const out = [];
        for (let i = 0; i < n; i++) {
            out.push(intSeedToRand(seed));
            seed = xorwise(seed);
        }
        return out;
    }

    /**
     * Tidal's rand at time t, shifted earlier by 0.0001 * seed cycles as the
     * mini-notation's ? and | are (seed 0 is plain rand).
     */
    function timeRand(t, seed = 0) {
        return timeToRand(seed ? t + 0.0001 * seed : t);
    }

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

    // Scales from Tidal (Sound.Tidal.Scales), by lower-case name.
    const SCALES = {
        minpent: [0, 3, 5, 7, 10],
        majpent: [0, 2, 4, 7, 9],
        ritusen: [0, 2, 5, 7, 9],
        egyptian: [0, 2, 5, 7, 10],
        kumai: [0, 2, 3, 7, 9],
        hirajoshi: [0, 2, 3, 7, 8],
        iwato: [0, 1, 5, 6, 10],
        chinese: [0, 4, 6, 7, 11],
        indian: [0, 4, 5, 7, 10],
        pelog: [0, 1, 3, 7, 8],
        prometheus: [0, 2, 4, 6, 11],
        scriabin: [0, 1, 4, 7, 9],
        gong: [0, 2, 4, 7, 9],
        shang: [0, 2, 5, 7, 10],
        jiao: [0, 3, 5, 8, 10],
        zhi: [0, 2, 5, 7, 9],
        yu: [0, 3, 5, 7, 10],
        augmented: [0, 3, 4, 7, 8, 11],
        augmented2: [0, 1, 4, 5, 8, 9],
        hexmajor7: [0, 2, 4, 7, 9, 11],
        hexdorian: [0, 2, 3, 5, 7, 10],
        hexphrygian: [0, 1, 3, 5, 8, 10],
        hexsus: [0, 2, 5, 7, 9, 10],
        hexmajor6: [0, 2, 4, 5, 7, 9],
        hexaeolian: [0, 3, 5, 7, 8, 10],
        major: [0, 2, 4, 5, 7, 9, 11],
        ionian: [0, 2, 4, 5, 7, 9, 11],
        dorian: [0, 2, 3, 5, 7, 9, 10],
        phrygian: [0, 1, 3, 5, 7, 8, 10],
        lydian: [0, 2, 4, 6, 7, 9, 11],
        mixolydian: [0, 2, 4, 5, 7, 9, 10],
        aeolian: [0, 2, 3, 5, 7, 8, 10],
        minor: [0, 2, 3, 5, 7, 8, 10],
        locrian: [0, 1, 3, 5, 6, 8, 10],
        harmonicminor: [0, 2, 3, 5, 7, 8, 11],
        harmonicmajor: [0, 2, 4, 5, 7, 8, 11],
        melodicminor: [0, 2, 3, 5, 7, 9, 11],
        melodicminordesc: [0, 2, 3, 5, 7, 8, 10],
        melodicmajor: [0, 2, 4, 5, 7, 8, 10],
        bartok: [0, 2, 4, 5, 7, 8, 10],
        hindu: [0, 2, 4, 5, 7, 8, 10],
        todi: [0, 1, 3, 6, 7, 8, 11],
        purvi: [0, 1, 4, 6, 7, 8, 11],
        marva: [0, 1, 4, 6, 7, 9, 11],
        bhairav: [0, 1, 4, 5, 7, 8, 11],
        ahirbhairav: [0, 1, 4, 5, 7, 9, 10],
        superlocrian: [0, 1, 3, 4, 6, 8, 10],
        romanianminor: [0, 2, 3, 6, 7, 9, 10],
        hungarianminor: [0, 2, 3, 6, 7, 8, 11],
        neapolitanminor: [0, 1, 3, 5, 7, 8, 11],
        enigmatic: [0, 1, 4, 6, 8, 10, 11],
        spanish: [0, 1, 4, 5, 7, 8, 10],
        leadingwhole: [0, 2, 4, 6, 8, 10, 11],
        lydianminor: [0, 2, 4, 6, 7, 8, 10],
        neapolitanmajor: [0, 1, 3, 5, 7, 9, 11],
        locrianmajor: [0, 2, 4, 5, 6, 8, 10],
        diminished: [0, 1, 3, 4, 6, 7, 9, 10],
        octatonic: [0, 1, 3, 4, 6, 7, 9, 10],
        diminished2: [0, 2, 3, 5, 6, 8, 9, 11],
        octatonic2: [0, 2, 3, 5, 6, 8, 9, 11],
        messiaen3: [0, 2, 3, 4, 6, 7, 8, 10, 11],
        messiaen4: [0, 1, 2, 5, 6, 7, 8, 11],
        messiaen5: [0, 1, 5, 6, 7, 11],
        messiaen6: [0, 2, 4, 5, 6, 8, 10, 11],
        messiaen7: [0, 1, 2, 3, 5, 6, 7, 8, 9, 11],
        chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        bayati: [0, 1.5, 3, 5, 7, 8, 10],
        hijaz: [0, 1, 4, 5, 7, 8.5, 10],
        sikah: [0, 1.5, 3.5, 5.5, 7, 8.5, 10.5],
        rast: [0, 2, 3.5, 5, 7, 9, 10.5],
        saba: [0, 1.5, 3, 4, 6, 8, 10],
        iraq: [0, 1.5, 3.5, 5, 6.5, 8.5, 10.5],
        whole: [0, 2, 4, 6, 8, 10],
        wholetone: [0, 2, 4, 6, 8, 10],
        messiaen1: [0, 2, 4, 6, 8, 10],
        messiaen2: [0, 1, 3, 4, 6, 7, 9, 10],
        blues: [0, 3, 5, 6, 7, 10],
    };

    // Chords from Tidal (Sound.Tidal.Chords), with all their aliases.
    const CHORDS = {
        major: [0, 4, 7],
        maj: [0, 4, 7],
        M: [0, 4, 7],
        aug: [0, 4, 8],
        plus: [0, 4, 8],
        sharp5: [0, 4, 8],
        six: [0, 4, 7, 9],
        "6": [0, 4, 7, 9],
        sixNine: [0, 4, 7, 9, 14],
        six9: [0, 4, 7, 9, 14],
        sixby9: [0, 4, 7, 9, 14],
        "6by9": [0, 4, 7, 9, 14],
        major7: [0, 4, 7, 11],
        maj7: [0, 4, 7, 11],
        M7: [0, 4, 7, 11],
        major9: [0, 4, 7, 11, 14],
        maj9: [0, 4, 7, 11, 14],
        M9: [0, 4, 7, 11, 14],
        add9: [0, 4, 7, 14],
        major11: [0, 4, 7, 11, 14, 17],
        maj11: [0, 4, 7, 11, 14, 17],
        M11: [0, 4, 7, 11, 14, 17],
        add11: [0, 4, 7, 17],
        major13: [0, 4, 7, 11, 14, 21],
        maj13: [0, 4, 7, 11, 14, 21],
        M13: [0, 4, 7, 11, 14, 21],
        add13: [0, 4, 7, 21],
        dom7: [0, 4, 7, 10],
        dom9: [0, 4, 7, 14],
        dom11: [0, 4, 7, 17],
        dom13: [0, 4, 7, 21],
        sevenFlat5: [0, 4, 6, 10],
        "7f5": [0, 4, 6, 10],
        sevenSharp5: [0, 4, 8, 10],
        "7s5": [0, 4, 8, 10],
        sevenFlat9: [0, 4, 7, 10, 13],
        "7f9": [0, 4, 7, 10, 13],
        nine: [0, 4, 7, 10, 14],
        eleven: [0, 4, 7, 10, 14, 17],
        "11": [0, 4, 7, 10, 14, 17],
        thirteen: [0, 4, 7, 10, 14, 17, 21],
        "13": [0, 4, 7, 10, 14, 17, 21],
        minor: [0, 3, 7],
        min: [0, 3, 7],
        m: [0, 3, 7],
        diminished: [0, 3, 6],
        dim: [0, 3, 6],
        minorSharp5: [0, 3, 8],
        msharp5: [0, 3, 8],
        mS5: [0, 3, 8],
        minor6: [0, 3, 7, 9],
        min6: [0, 3, 7, 9],
        m6: [0, 3, 7, 9],
        minorSixNine: [0, 3, 9, 7, 14],
        minor69: [0, 3, 9, 7, 14],
        min69: [0, 3, 9, 7, 14],
        minSixNine: [0, 3, 9, 7, 14],
        m69: [0, 3, 9, 7, 14],
        mSixNine: [0, 3, 9, 7, 14],
        m6by9: [0, 3, 9, 7, 14],
        minor7flat5: [0, 3, 6, 10],
        minor7f5: [0, 3, 6, 10],
        min7flat5: [0, 3, 6, 10],
        min7f5: [0, 3, 6, 10],
        m7flat5: [0, 3, 6, 10],
        m7f5: [0, 3, 6, 10],
        minor7: [0, 3, 7, 10],
        min7: [0, 3, 7, 10],
        m7: [0, 3, 7, 10],
        minor7sharp5: [0, 3, 8, 10],
        minor7s5: [0, 3, 8, 10],
        min7sharp5: [0, 3, 8, 10],
        min7s5: [0, 3, 8, 10],
        m7sharp5: [0, 3, 8, 10],
        m7s5: [0, 3, 8, 10],
        minor7flat9: [0, 3, 7, 10, 13],
        minor7f9: [0, 3, 7, 10, 13],
        min7flat9: [0, 3, 7, 10, 13],
        min7f9: [0, 3, 7, 10, 13],
        m7flat9: [0, 3, 7, 10, 13],
        m7f9: [0, 3, 7, 10, 13],
        minor7sharp9: [0, 3, 7, 10, 15],
        minor7s9: [0, 3, 7, 10, 15],
        min7sharp9: [0, 3, 7, 10, 15],
        min7s9: [0, 3, 7, 10, 15],
        m7sharp9: [0, 3, 7, 10, 15],
        m7s9: [0, 3, 7, 10, 15],
        diminished7: [0, 3, 6, 9],
        dim7: [0, 3, 6, 9],
        minor9: [0, 3, 7, 10, 14],
        min9: [0, 3, 7, 10, 14],
        m9: [0, 3, 7, 10, 14],
        minor11: [0, 3, 7, 10, 14, 17],
        min11: [0, 3, 7, 10, 14, 17],
        m11: [0, 3, 7, 10, 14, 17],
        minor13: [0, 3, 7, 10, 14, 17, 21],
        min13: [0, 3, 7, 10, 14, 17, 21],
        m13: [0, 3, 7, 10, 14, 17, 21],
        minorMajor7: [0, 3, 7, 11],
        minMaj7: [0, 3, 7, 11],
        mmaj7: [0, 3, 7, 11],
        one: [0],
        "1": [0],
        five: [0, 7],
        "5": [0, 7],
        sus2: [0, 2, 7],
        sus4: [0, 5, 7],
        sevenSus2: [0, 2, 7, 10],
        "7sus2": [0, 2, 7, 10],
        sevenSus4: [0, 5, 7, 10],
        "7sus4": [0, 5, 7, 10],
        nineSus4: [0, 5, 7, 10, 14],
        ninesus4: [0, 5, 7, 10, 14],
        "9sus4": [0, 5, 7, 10, 14],
        sevenFlat10: [0, 4, 7, 10, 15],
        "7f10": [0, 4, 7, 10, 15],
        nineSharp5: [0, 1, 13],
        "9sharp5": [0, 1, 13],
        "9s5": [0, 1, 13],
        minor9sharp5: [0, 1, 14],
        minor9s5: [0, 1, 14],
        min9sharp5: [0, 1, 14],
        min9s5: [0, 1, 14],
        m9sharp5: [0, 1, 14],
        m9s5: [0, 1, 14],
        sevenSharp5flat9: [0, 4, 8, 10, 13],
        "7s5f9": [0, 4, 8, 10, 13],
        minor7sharp5flat9: [0, 3, 8, 10, 13],
        m7sharp5flat9: [0, 3, 8, 10, 13],
        elevenSharp: [0, 4, 7, 10, 14, 18],
        "11s": [0, 4, 7, 10, 14, 18],
        minor11sharp: [0, 3, 7, 10, 14, 18],
        m11sharp: [0, 3, 7, 10, 14, 18],
        m11s: [0, 3, 7, 10, 14, 18],
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
        if (root === undefined) return null;
        // As Tidal's chordToPatSeq: an unknown name is the root alone (fromMaybe [0]).
        const shape = CHORDS[parts[1] || 'major'];
        let notes = shape ? shape.slice() : [0];
        // Tidal's applyModifier works on the list as it is (no sorting).
        for (const modifier of parts.slice(2)) {
            if (/^\d+$/.test(modifier)) {
                // Range i: take i of the chord repeated up the octaves.
                const count = parseInt(modifier, 10);
                const base = notes;
                notes = [];
                for (let i = 0; i < count; i++) notes.push(base[i % base.length] + 12 * Math.floor(i / base.length));
            } else if (/^i+$/.test(modifier) || /^i\d+$/.test(modifier)) {
                // Invert: the first note goes up an octave, to the end.
                const times = /^i\d+$/.test(modifier) ? parseInt(modifier.slice(1), 10) : modifier.length;
                for (let i = 0; i < times && notes.length; i++) notes.push(notes.shift() + 12);
            } else if (/^o+$/.test(modifier)) {
                // Open: [d0 - 12, d2 - 12, d1] ++ the rest, once per "o".
                for (let k = 0; k < modifier.length; k++) {
                    if (notes.length > 2) notes = [notes[0] - 12, notes[2] - 12, notes[1], ...notes.slice(3)];
                }
            } else if (/^d\d+$/.test(modifier)) {
                // Drop i: the i-th note from the top goes down an octave, to the front.
                const which = parseInt(modifier.slice(1), 10);
                if (which >= 1 && notes.length >= which) {
                    const at = notes.length - which;
                    notes = [notes[at] - 12, ...notes.slice(0, at), ...notes.slice(at + 1)];
                }
            } else {
                return null;
            }
        }
        return notes.map((n) => root + n);
    }

    /** True if the chord name of a chord word is known (parseChord plays the root of unknown names). */
    function knownChord(word) {
        const name = String(word).split("'")[1];
        return !name || !!CHORDS[name];
    }

    /** Scale degree to semitones from middle C. Name: "major", "e:minor", "a3:blues". */
    function scaleNote(name, degree, tidal) {
        const parts = String(name).split(':');
        const scaleName = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase();
        const root = parts.length > 1 ? rootOffset(parts[0]) : 0;
        let steps = SCALES[scaleName];
        if (root === undefined) {
            if (tidal) tidal._warnOnce(`Unknown scale "${name}"`);
            return undefined;
        }
        if (!steps) {
            // Tidal: fromMaybe [0], so the degrees become octaves.
            if (tidal) tidal._warnOnce(`Unknown scale "${name}" (its degrees play as octaves, as in Tidal)`);
            steps = [0];
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
            const events = this._query(begin, end);
            // Controls that follow() changes during a note start at their
            // signal's value at the onset. Set at every level, so the outermost
            // (whose onsets are the times that play) has the last word.
            for (let i = 0; i < events.length; i++) {
                const v = events[i].value;
                if (v && v.follow instanceof Follows) return events.map(followOnset);
            }
            return events;
        }

        /** Events of the first cycle, handy for debugging in the console. */
        firstCycle() {
            return this.query(0, 1);
        }

        /** A pattern from a new query, keeping this pattern's steps (as Tidal's keepSteps). */
        _derive(query) {
            const p = new PatternBuilder(this.tidal, query);
            p._steps = this._steps;
            return p;
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
            return patterned(this, 'fast', factor, (p, f) => signedFast(p, f));
        }

        /** Stretches the pattern over `factor` cycles (a negative factor also reverses it). */
        slow(factor) {
            return patterned(this, 'slow', factor, (p, f) => (f === 0 ? silence(p.tidal) : signedFast(p, 1 / f)));
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

        /**
         * Swing, as Tidal's swingBy x n = inside n (within (0.5, 1) (x ~>)):
         * in each 1/n slice, the second half plays x/n of a slice later.
         */
        swingBy(x, n) {
            return patternedAll(this, 'swingBy', [x, n], (p, amount, slices) => {
                if (!(slices > 0)) return p;
                return p.inside(slices, (q) => q.within(0.5, 1, (r) => r.late(amount)));
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
                const period = Math.abs(Math.floor(x));
                if (period === 0) return p; // Tidal: _every 0 _ p = p
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
            return patternedAll(this, 'euclid', [k, n, rotation], (p, kk, nn, rr) => euclidPattern(p.tidal, p, kk, nn, rr));
        }

        /** Plays the pattern on the steps a Euclidean rhythm leaves empty. */
        euclidInv(k, n, rotation = 0) {
            return patternedAll(this, 'euclidInv', [k, n, rotation], (p, kk, nn, rr) => euclidPattern(p.tidal, p, -kk, nn, rr));
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
            const transformed = applyTransform('whenmod', fn, this);
            return patternedAll(this, 'whenmod', [n, offset], (p, a, o) => {
                if (!(a > 0)) throw new RangeError('whenmod() expects n > 0');
                return p._derive((b, e) => eachCycle(b, e, (c, s, t) =>
                    (mod(c, a) >= o ? transformed : p).query(s, t)
                ));
            });
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
            requireFunction('chunk', fn);
            return patterned(this, 'chunk', n, (p, x) => p._chunk(x, fn));
        }

        _chunk(n, fn) {
            const parts = Math.trunc(n);
            if (parts < 0) return this._chunkBack(-parts, fn);
            if (parts === 0) return silence(this.tidal);
            return slowcat(this.tidal, Array.from({ length: parts }, (_, i) => this.within(i / parts, (i + 1) / parts, fn)));
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

        /**
         * Applies fn to each event with probability `prob` (a number or a
         * pattern), as Tidal's sometimesBy: the events are picked first, then
         * fn changes them, so fn may change their rhythm (x => x.fast(2)).
         */
        sometimesBy(prob, fn) {
            requireFunction('sometimesBy', fn);
            return stackPatterns(this.tidal, [this.degradeBy(prob), applyTransform('sometimesBy', fn, this.unDegradeBy(prob))]);
        }

        /** Tidal's sometimesBy': applies fn first, then keeps the changed events with probability `prob`. */
        sometimesByAfter(prob, fn) {
            return stackPatterns(this.tidal, [this.degradeBy(prob), applyTransform('sometimesByAfter', fn, this).unDegradeBy(prob)]);
        }

        sometimes(fn, prob = 0.5) { return this.sometimesBy(prob, fn); }
        often(fn) { return this.sometimesBy(0.75, fn); }
        rarely(fn) { return this.sometimesBy(0.25, fn); }
        almostNever(fn) { return this.sometimesBy(0.1, fn); }
        almostAlways(fn) { return this.sometimesBy(0.9, fn); }

        /**
         * Randomly removes events with probability `amount` (a number, a
         * pattern or a signal, read at each event), as Tidal: an event goes
         * when rand at its start is below the amount.
         */
        degradeBy(amount) {
            return degradeWith(this, 'degradeBy', amount, (r, x) => r >= x);
        }

        /** Randomly removes half of the events. */
        degrade() {
            return this.degradeBy(0.5);
        }

        /** Keeps only the events that degradeBy(amount) would remove (the same random numbers). */
        unDegradeBy(amount) {
            return degradeWith(this, 'unDegradeBy', amount, (r, x) => r < x);
        }

        /** Splits cycles into n parts and plays n randomly chosen parts (with repeats). */
        scramble(n) {
            return patterned(this, 'scramble', n, (p, x) => p._scramble(x));
        }

        _scramble(n) {
            const parts = Math.floor(n);
            if (parts < 1) throw new RangeError('scramble() expects n >= 1');
            // Tidal: _segment n $ _irand n, the random number at the start of each slot.
            return rearrange(this, parts, (c, i) => Math.floor(timeRand(c + i / parts) * parts));
        }

        /** Splits cycles into n parts and plays them in a random order (no repeats). */
        shuffle(n) {
            return patterned(this, 'shuffle', n, (p, x) => p._shuffle(x));
        }

        _shuffle(n) {
            const parts = Math.floor(n);
            if (parts < 1) throw new RangeError('shuffle() expects n >= 1');
            let lastCycle = null;
            let order = null;
            return rearrange(this, parts, (c, i) => {
                if (c !== lastCycle) {
                    // Tidal's randrun: the parts sorted by n random numbers of the cycle.
                    const rands = timeToRands(c, parts);
                    order = rands.map((r, k) => [r, k]).sort((x, y) => x[0] - y[0]).map(([, k]) => k);
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
            return this._bite(n, indices, false, 'bite');
        }

        /** Like bite(), changing the speed of each sound to match how much its part was squeezed or stretched. */
        chew(n, indices) {
            return this._bite(n, indices, true, 'chew');
        }

        _bite(n, indices, chew, fname) {
            const parts = Math.floor(requireNumber(fname, n));
            if (parts < 1) throw new RangeError(`${fname}() expects n >= 1`);
            const index = toRaw(this.tidal, indices, fname);
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
                        let value = ev.value;
                        if (chew) {
                            const o = asObject(value);
                            value = { ...o, speed: (isNum(o.speed) ? o.speed : 1) * scale };
                        }
                        out.push({ begin: fromSrc(ev.begin), end: fromSrc(ev.end), value });
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
            // Tidal: squeezeJoin of n slices per event (however long the event).
            // An event's own begin and end are kept only when it has both.
            const p = squeezeJoin(this.tidal, this, (value) => {
                const v = asObject(value);
                const both = isNum(v.begin) && isNum(v.end);
                const b0 = both ? v.begin : 0;
                const d = both ? v.end - v.begin : 1;
                return fastcat(this.tidal, Array.from({ length: parts }, (_, i) =>
                    pure(this.tidal, { ...v, begin: b0 + (d * i) / parts, end: b0 + (d * (i + 1)) / parts })));
            });
            p._steps = this._steps > 0 ? this._steps * parts : undefined;
            return p;
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
                slices.push(this.withValue((v) => mergePlayRange(asObject(v), i / parts, (i + 1) / parts)));
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
            // Tidal: _segment n p = _fast n (pure id) <* p, with n steps (n may be a fraction).
            return patterned(this, 'segment', n, (p, x) => {
                if (!(x > 0)) throw new RangeError('segment() expects n > 0');
                return withSteps(p.struct(fastPattern(pure(p.tidal, true), x)), x);
            });
        }

        // --- Values ----------------------------------------------------

        /** Scales values from 0..1 to lo..hi (for signals and numeric patterns). */
        range(lo, hi) {
            if (toNumber(lo) !== undefined && toNumber(hi) !== undefined && !(lo instanceof PatternBuilder) && !(hi instanceof PatternBuilder)) {
                const a = requireNumber('range', lo);
                const z = requireNumber('range', hi);
                return this.withValue((v) => {
                    const x = toNumber(v);
                    return x === undefined ? v : a + x * (z - a);
                });
            }
            // Patterned bounds: read at each event (or each moment of a signal).
            const los = toRaw(this.tidal, lo, 'range');
            const his = toRaw(this.tidal, hi, 'range');
            const scale = (t, v) => {
                const x = toNumber(v);
                const a = numberAt(los, t);
                const z = numberAt(his, t);
                return x === undefined || a === undefined || z === undefined ? undefined : a + x * (z - a);
            };
            if (this._signal) {
                const sig = this._signal;
                return signal(this.tidal, (t) => scale(t, sig(t)));
            }
            return this._derive((b, e) => this.query(b, e).flatMap((ev) => {
                const v = scale(ev.begin, ev.value);
                return v === undefined ? [] : [{ begin: ev.begin, end: ev.end, value: v }];
            }));
        }

        /** Rounds numbers to steps of 1/n (n = 1: whole numbers), halves to even, as Haskell's round. */
        quantise(n = 1) {
            const steps = requireNumber('quantise', n);
            return this.withValue((v) => {
                const x = toNumber(v);
                return x === undefined ? v : roundHalfEven(x * steps) / steps;
            });
        }

        quantize(n = 1) {
            return this.quantise(n);
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
                    const order = arrange(group.slice());
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

        /** Same as arpeggiate(), as Tidal's arpg. */
        arpg(mode = 'up') {
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
            const result = this._derive((b, e) => eachCycle(b, e, (c, s, t) =>
                (controlLeads(c) ? fromControl : fromThis)(s, t)
            ));
            // The steps (for stepcat, pace...) come from the side that sets the
            // rhythm, decided on the first cycle, and only when they are asked for.
            const own = this._steps;
            let steps;
            Object.defineProperty(result, '_steps', {
                configurable: true,
                enumerable: true,
                get: () => {
                    if (steps === undefined) steps = { value: ctrl._steps !== undefined && controlLeads(0) ? ctrl._steps : own };
                    return steps.value;
                },
                set: (value) => { steps = { value }; },
            });
            return result;
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
        // Tidal: converge x ++ drop 1 (reverse $ converge x)
        disconverge: (x) => {
            const c = ARP_MODES.converge(x);
            return c.concat(c.slice().reverse().slice(1));
        },
        pinkyup: (x) => x.slice(0, -1).flatMap((n) => [n, x[x.length - 1]]),
        thumbup: (x) => x.slice(1).flatMap((n) => [x[0], n]),
        pinkyupdown: (x) => {
            const p = ARP_MODES.pinkyup(x);
            return p.slice(0, -1).concat(p.slice().reverse().slice(0, -1));
        },
        thumbupdown: (x) => {
            const p = ARP_MODES.thumbup(x);
            return p.slice(0, -1).concat(p.slice().reverse().slice(0, -1));
        },
    };

    // Control methods: each one sets a value on every event.
    const coerceNumber = (v) => toNumber(v);
    const CONTROLS = {
        s: (v) => (v === undefined || v === null || v === '~' ? undefined : String(v)),
        // A number, or a note name as semitones from c ("e" is 4), as in Tidal.
        n: (v) => {
            const x = toNumber(v);
            if (x !== undefined && /^-?\d*\.?\d+$/.test(String(v).trim())) return x;
            const midi = noteNameToMidi(v);
            return midi === undefined ? x : midi - 60;
        },
        note: (v, tidal) => {
            const x = typeof v === 'number' ? v : (/^-?\d+(\.\d+)?$/.test(String(v)) ? parseFloat(v) : undefined);
            if (x !== undefined) return 60 + x; // numbers are semitones from middle C
            const midi = noteNameToMidi(v);
            if (midi === undefined && tidal) tidal._warnOnce(`Unknown note "${v}"`);
            return midi;
        },
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
        // More of Tidal's (SuperDirt's) parameters
        delaytime: coerceNumber,
        delayfeedback: coerceNumber,
        lock: coerceNumber,
        shape: coerceNumber,
        coarse: coerceNumber,
        cut: coerceNumber,
        accelerate: coerceNumber,
        djf: coerceNumber,
        hpq: coerceNumber,
        bpq: coerceNumber,
        amp: coerceNumber,
        octave: coerceNumber,
        unit: (v) => ({ r: 'r', rate: 'r', c: 'c', cycle: 'c', s: 's', second: 's' }[String(v)]),
        distort: coerceNumber,
        tremolorate: coerceNumber,
        tremolodepth: coerceNumber,
        phaserrate: coerceNumber,
        phaserdepth: coerceNumber,
        ring: coerceNumber,
        ringf: coerceNumber,

        // Envelopes: hold (SuperDirt), decay and sustain level of the amplitude.
        hold: coerceNumber,
        decay: coerceNumber,
        sustainlevel: coerceNumber,
        // Pitch envelope, in semitones (synths with a built-in sweep use it as its depth).
        penv: coerceNumber,
        pattack: coerceNumber,
        pdecay: coerceNumber,
        pcurve: coerceNumber,
        // Peak (bell) equaliser.
        peak: coerceNumber,
        peakq: coerceNumber,
        peakgain: coerceNumber,
        // Vibrato and portamento.
        vib: coerceNumber,
        vibmod: coerceNumber,
        portamento: coerceNumber,
        // Parameters of the SuperDirt-style synths.
        voice: coerceNumber,
        detune: coerceNumber,
        semitone: coerceNumber,
        rate: coerceNumber,
        lfo: coerceNumber,
        // SuperDirt's effects.
        squiz: coerceNumber,
        waveloss: coerceNumber,
        krush: coerceNumber,
        kcutoff: coerceNumber,
        triode: coerceNumber,
        octer: coerceNumber,
        octersub: coerceNumber,
        octersubsub: coerceNumber,
        fshift: coerceNumber,
        fshiftnote: coerceNumber,
        fshiftphase: coerceNumber,
        leslie: coerceNumber,
        lrate: coerceNumber,
        lsize: coerceNumber,
        freeze: coerceNumber,
        comb: coerceNumber,
        smear: coerceNumber,
        scram: coerceNumber,
        binshift: coerceNumber,
        hbrick: coerceNumber,
        lbrick: coerceNumber,
        // The reverb's dry control (SuperDirt): 1 - the level of the orbit's reverb.
        dry: coerceNumber,
        // SuperCollider's FreeVerb2 on the voice: mix, room size and damping, 0 to 1.
        freeverb: coerceNumber,
        freeroom: coerceNumber,
        freedamp: coerceNumber,
        // Tempo, as a control (Tidal's cps): the event sets the cycles per second.
        cps: coerceNumber,
        // MIDI NRPN: nrpn("param:value"), or the number and value on their own.
        nrpn: (v) => (/^\s*\d+\s*:\s*\d+\s*$/.test(String(v)) ? String(v).replace(/\s/g, '') : undefined),
        nrpnn: coerceNumber,
        nrpnv: coerceNumber,
        // A monophonic slur, as SuperCollider's Pmono: an event whose tie equals
        // that of a synth voice still sounding (same orbit and sound) changes it.
        tie: (v) => (v === undefined || v === null || v === '~' || v === '' ? undefined : (typeof v === 'number' ? v : String(v))),
    };
    // Filter envelopes: lpenv, lpattack, lpdecay, lpsustain, lprelease and the
    // same for hp (high-pass), bp (band-pass) and peak (the peak equaliser).
    const FILTER_ENVELOPES = ['lp', 'hp', 'bp', 'peak'];
    const ENVELOPE_PARTS = ['env', 'attack', 'decay', 'sustain', 'release'];
    for (const prefix of FILTER_ENVELOPES) {
        for (const part of ENVELOPE_PARTS) CONTROLS[prefix + part] = coerceNumber;
    }
    const CONTROL_ALIASES = {
        sound: 's',
        cutoff: 'lpf',
        ctf: 'lpf',
        hcutoff: 'hpf',
        bandf: 'bpf',
        room: 'reverb',
        sz: 'size',
        velocity: 'vel',
        lpq: 'resonance',
        hresonance: 'hpq',
        bandq: 'bpq',
        delayt: 'delaytime',
        delayfb: 'delayfeedback',
        dfb: 'delayfeedback',
        sus: 'sustain',
        att: 'attack',
        rel: 'release',
        tremr: 'tremolorate',
        tremdp: 'tremolodepth',
        phasr: 'phaserrate',
        phasdp: 'phaserdepth',
        vibrato: 'vib',
        // Tidal: up = note
        up: 'note',
        glide: 'portamento',
    };

    for (const [name, coerce] of Object.entries(CONTROLS)) {
        PatternBuilder.prototype[name] = function (value) {
            return this._control(name, value, coerce);
        };
    }
    for (const [alias, name] of Object.entries(CONTROL_ALIASES)) {
        PatternBuilder.prototype[alias] = PatternBuilder.prototype[name];
    }

    // Tidal's *Take controls, one for every numeric control (nTake is above):
    // gainTake("g", [1, 0.8, 0.9]) gives each played event the next value.
    const TAKE_CONTROLS = Object.keys(CONTROLS).filter((name) => CONTROLS[name] === coerceNumber || name === 'note');
    for (const name of TAKE_CONTROLS) {
        PatternBuilder.prototype[name + 'Take'] = function (label, list) {
            if (!Array.isArray(list) || list.length === 0 || !list.every((x) => CONTROLS[name](x, null) !== undefined)) {
                throw new TypeError(`${name}Take() expects a name and a list of values, e.g. ${name}Take("a", [1, 2, 3])`);
            }
            const take = { key: name, name: String(label), list: list.map((x) => CONTROLS[name](x, null)) };
            return this.withValue((v) => {
                const o = asObject(v);
                return { ...o, takes: [...(o.takes || []), take] };
            });
        };
    }

    /** SuperCollider's envelope curve: 0 (or "lin") is a straight line, negative values move fast at first. */
    function envCurveValue(curve) {
        if (curve === undefined || curve === null || curve === 'lin' || curve === 'linear') return 0;
        if (curve === 'exp' || curve === 'exponential') return 'exp';
        const x = toNumber(curve);
        if (x === undefined) throw new TypeError(`pitchenv(): unknown curve ${JSON.stringify(curve)} (use a number, "lin" or "exp")`);
        return x;
    }

    // SuperCollider's named envelope curves (the shapes of Env), by name.
    const ENV_SHAPES = {
        lin: 0, linear: 0, exp: 'exp', exponential: 'exp', step: 'step', hold: 'hold',
        sin: 'sin', sine: 'sin', wel: 'wel', welch: 'wel', sqr: 'sqr', squared: 'sqr', cub: 'cub', cubed: 'cub',
    };

    /** The value of an envelope segment from a to b at x (0 to 1 through it), with a SuperCollider curve. */
    function envSegment(a, b, x, c) {
        if (c === 'step') return b;
        if (c === 'hold') return x < 1 ? a : b;
        if (c === 'exp') return a * b > 0 ? a * Math.pow(b / a, x) : a + (b - a) * x;
        if (c === 'sin') return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * x));
        if (c === 'wel') {
            return a < b ? a + (b - a) * Math.sin((Math.PI / 2) * x) : b - (b - a) * Math.sin((Math.PI / 2) * (1 - x));
        }
        if (c === 'sqr') {
            if (a < 0 || b < 0) return a + (b - a) * x;
            const s = Math.sqrt(a) + (Math.sqrt(b) - Math.sqrt(a)) * x;
            return s * s;
        }
        if (c === 'cub') {
            const s = Math.cbrt(a) + (Math.cbrt(b) - Math.cbrt(a)) * x;
            return s * s * s;
        }
        if (!isNum(c) || Math.abs(c) < 0.001) return a + (b - a) * x;
        return a + ((b - a) * (1 - Math.exp(c * x))) / (1 - Math.exp(c));
    }

    /**
     * The value at time t (seconds) of an envelope { levels, times, curves },
     * as SuperCollider's Env: levels[0] before 0, the last level after the
     * last segment; times and curves are cycled when shorter than the segments.
     */
    function envelopeValue(env, t) {
        const { levels, times, curves } = env;
        if (!(t > 0) || levels.length < 2) return levels[0];
        let start = 0;
        for (let i = 0; i < levels.length - 1; i++) {
            const dur = times.length ? times[i % times.length] : 0;
            if (t < start + dur) {
                const x = dur > 0 ? Math.max(0, (t - start) / dur) : 1;
                return envSegment(levels[i], levels[i + 1], x, curves.length ? curves[i % curves.length] : 0);
            }
            start += dur;
        }
        return levels[levels.length - 1];
    }

    /** One envelope curve for envelope(): a number or a SuperCollider shape name. */
    function envShape(curve) {
        if (isNum(curve)) return curve;
        if (typeof curve === 'string') {
            const key = curve.trim().toLowerCase();
            if (Object.prototype.hasOwnProperty.call(ENV_SHAPES, key)) return ENV_SHAPES[key];
            const x = toNumber(key);
            if (x !== undefined) return x;
        }
        throw new TypeError(`envelope(): unknown curve ${JSON.stringify(curve)} (use a number, or "lin", "exp", "step", "hold", "sin", "wel", "sqr" or "cub")`);
    }

    /** The checked { levels, times, curves } of envelope(levels, times, curves). */
    function makeEnvelope(levels, times, curves) {
        const example = 'e.g. envelope([0, 1, 0], [0.1, 0.5])';
        if (!Array.isArray(levels) || levels.length === 0 || !levels.every(isNum)) {
            throw new TypeError(`envelope() expects a list of levels (numbers), ${example}`);
        }
        const list = typeof times === 'number' ? [times] : times;
        if (!Array.isArray(list) || !list.every((x) => isNum(x) && x >= 0)) {
            throw new TypeError(`envelope() expects a list of times in seconds (numbers, 0 or more) after the levels, ${example}`);
        }
        if (levels.length > 1 && list.length === 0) {
            throw new TypeError(`envelope() needs a time for each segment between two levels, ${example}`);
        }
        const shapes = curves === undefined || curves === null ? [0] : Array.isArray(curves) ? curves : [curves];
        if (shapes.length === 0) throw new TypeError('envelope() expects a curve, or a list with one curve per segment');
        return { levels: levels.slice(), times: list.slice(), curves: shapes.map(envShape) };
    }

    // Controls that .follow() and .followNote() can change while a note
    // sounds, each through the AudioParam it drives (see _applyFollows).
    const FOLLOW_CONTROLS = [
        'lpf', 'hpf', 'bpf', 'resonance', 'hpq', 'bpq', 'pan', 'gain', 'amp', 'freq', 'note', 'speed',
        'peak', 'peakq', 'peakgain', 'djf', 'tremolorate', 'tremolodepth', 'phaserrate', 'phaserdepth',
        'ring', 'ringf', 'leslie', 'lrate', 'lsize', 'vib',
    ];

    /**
     * The signals of .follow() / .followNote() on an event, by control:
     * { pattern, note } (note: the signal's time starts at 0 at each note's
     * onset). Left out of JSON (exportPattern), never sent by OSC or MIDI.
     * playEvent binds it to the note's onset (cycle, audio time and tempo),
     * so at(name, time) reads the control at an audio time.
     */
    // While a hit is played (see _dispatch): the values its voice reads from its .follow()/.followNote() signals,
    // as [control, cycle, onset cycle, value], so the curves it rendered can be compared later at no extra cost.
    const FOLLOW_READS = { list: null };
    // While the scheduler plays a hit: the values it went out with (see playEvent), so its identity is read from
    // them rather than resolved again (takes would advance, a stateful signal could answer differently).
    const PLAYED = { on: false, v: null, takes: null };

    class Follows {
        constructor(entries, onset) {
            this.entries = entries;
            this.onset = onset || null;
        }
        with(name, entry) { return new Follows({ ...this.entries, [name]: entry }, this.onset); }
        names() { return Object.keys(this.entries); }
        has(name) { return Object.prototype.hasOwnProperty.call(this.entries, name); }
        /** This set of signals for a note that starts at `cycle` (audio time `time`, at `cps`). */
        bind(cycle, time, cps) { return new Follows(this.entries, { cycle, time, cps }); }
        /** The value of a control at cycle t, for a note that starts at cycle `onset`, or undefined. */
        valueAt(name, t, onset) {
            const entry = this.entries[name];
            if (!entry) return undefined;
            const hit = eventAt(entry.pattern, entry.note ? t - onset : t);
            if (!hit) return undefined;
            const v = hit.value;
            if (v && typeof v === 'object') return isNum(v[name]) ? v[name] : undefined;
            const x = CONTROLS[name](v, null);
            return isNum(x) ? x : undefined;
        }
        /** The value of a control at audio time `time` (once bound to a note). */
        at(name, time) {
            const o = this.onset;
            if (!o) return undefined;
            const t = o.cycle + (time - o.time) * o.cps;
            const x = this.valueAt(name, t, o.cycle);
            if (FOLLOW_READS.list) FOLLOW_READS.list.push([name, t, o.cycle, x]);
            return x;
        }
        /** The controls followed, and whether each is relative to the note (followNote). */
        shape() { return this.names().sort().map((name) => name + (this.entries[name].note ? '~' : '')).join(','); }
        /**
         * The curves over a note's nominal span (cycles `begin` to `end`, at
         * `cps`), sampled as densely as a voice lays them out (see
         * samplePoints), as [control, cycle, onset cycle, value] like the reads
         * of a voice (FOLLOW_READS), on the clock as it is.
         */
        samples(begin, end, cps) {
            const span = Math.max(0, end - begin);
            const count = clamp(Math.ceil(span / Math.max(cps, 1e-6) / 0.015), 1, 400);
            const out = [];
            for (const name of this.names().sort()) {
                for (let i = 0; i <= count; i++) {
                    const t = begin + (span * i) / count;
                    out.push([name, t, begin, this.valueAt(name, t, begin)]);
                }
            }
            return out;
        }
        toJSON() { return undefined; }
    }

    /** .follow() and .followNote(): a control that changes while each note sounds. */
    function followPattern(pattern, fname, control, sig, note) {
        if (typeof control !== 'string' || sig === undefined || sig === null) {
            throw new TypeError(`${fname}() expects a control name and a signal, e.g. ${fname}("lpf", sine.range(200, 2000))`);
        }
        const name = CONTROL_ALIASES[control] || control;
        if (!FOLLOW_CONTROLS.includes(name)) {
            if (pattern.tidal) pattern.tidal._warnOnce(`${fname}() cannot change ${control} during a note, so it is ignored (it can change ${FOLLOW_CONTROLS.join(', ')})`);
            return pattern;
        }
        const entry = { pattern: typeof sig === 'number' ? pure(pattern.tidal, sig) : toRaw(pattern.tidal, sig, fname), note };
        // Each event also carries the control's value at its onset (see query), for MIDI, OSC and the views.
        return pattern.withValue((v) => {
            const o = asObject(v);
            return { ...o, follow: o.follow instanceof Follows ? o.follow.with(name, entry) : new Follows({ [name]: entry }) };
        });
    }

    /** An event whose followed controls take their signals' values at its onset. */
    function followOnset(ev) {
        const v = ev.value;
        if (!v || !(v.follow instanceof Follows)) return ev;
        const value = { ...v };
        for (const name of v.follow.names()) {
            const x = v.follow.valueAt(name, ev.begin, ev.begin);
            if (x !== undefined) value[name] = x;
        }
        return { ...ev, value };
    }

    // Seconds a one-shot's session lives on after its last event, for delay and reverb tails.
    // How far a negative nudge can move an event earlier and still play on time: events are asked for
    // this many seconds before they are sent (see _tick). Earlier ones play this much early, with a warning.
    const NUDGE_EARLY = 0.2;
    // How far back (seconds) a replaced stream's new pattern is asked for, for onsets that a positive nudge
    // moves past what was already sent (see _tick).
    const NUDGE_LATE = 1;
    // Tempo requests in the order they apply: by cycle, then in the order they were asked for.
    const byTempoOrder = (a, b) => a.cycle - b.cycle || a.seq - b.seq;
    // Drops the earliest tempo segments of `history` (then the anchor at `anchorCycle`) that end at or before `floor`.
    const pruneSegments = (history, anchorCycle, floor) => {
        let n = 0;
        while (n < history.length && (n + 1 < history.length ? history[n + 1].cycle : anchorCycle) <= floor) n++;
        if (n) history.splice(0, n);
    };
    /**
     * What a hit plays, to tell whether a replacement's onset was already sent: { key, truncated }. The key
     * is its nominal span (cycles) and its controls but its nudge (where it sounds) and its tempo change
     * (which goes with the hit), in a fixed order; of .follow()/.followNote() only which controls follow
     * (their curves are compared apart, see _sameCurves). Read when the hit is sent, so an object changed
     * in place later does not change what was sent. Any value withValue() gives is read safely (BigInt,
     * symbols, functions, shared or circular objects, throwing getters): it never throws, and it reads at
     * most HIT_BUDGET values, counted before each read, enumeration included. A key cut short (too large
     * or too deep) is truncated: it cannot tell two hits apart, so it never matches (see _handoff).
     */
    const HIT_BUDGET = 4000;
    function hitFingerprint(v, ev) {
        const seen = new Set();
        let budget = HIT_BUDGET;
        let truncated = false;
        const spend = () => {
            if (budget <= 0) {
                truncated = true;
                return false;
            }
            budget--;
            return true;
        };
        const field = (x, k, depth) => {
            if (!spend()) return '';
            try { return walk(x[k], depth); } catch (e) { return '?'; }
        };
        // Own enumerable keys, sorted, each counted as it is found: enumeration stops when the budget is spent.
        const keysOf = (x, skip) => {
            const keys = [];
            if (Array.isArray(x)) {
                const n = x.length;
                for (let i = 0; i < n; i++) {
                    if (!spend()) break;
                    keys.push(i);
                }
                return keys;
            }
            for (const k in x) {
                if (!spend()) break;
                if (Object.prototype.hasOwnProperty.call(x, k) && !(skip && skip(k))) keys.push(k);
            }
            return keys.sort();
        };
        const walk = (x, depth) => {
            if (x === null) return 'null';
            switch (typeof x) {
                case 'string': return JSON.stringify(x);
                case 'number': return Object.is(x, -0) ? '-0' : String(x);
                case 'bigint': return x + 'n';
                case 'boolean': case 'undefined': return String(x);
                case 'symbol': return 'symbol(' + String(x.description) + ')';
                case 'function': return 'function ' + (x.name || '');
                default: break;
            }
            if (x instanceof Follows) return 'follow(' + x.shape() + ')';
            if (seen.has(x)) return '[circular]';
            if (depth > 8) {
                truncated = true;
                return '[deep]';
            }
            seen.add(x);
            const list = Array.isArray(x);
            const out = [];
            for (const k of keysOf(x)) {
                if (truncated) break;
                out.push(k + ':' + field(x, k, depth + 1));
            }
            seen.delete(x);
            return (list ? '[' : '{') + out.join(',') + (list ? ']' : '}');
        };
        let key = 'span:' + +(ev.end - ev.begin).toFixed(9);
        try {
            for (const k of keysOf(v, (name) => name === 'nudge' || name === 'cps')) {
                if (truncated) break;
                key += ',' + k + ':' + field(v, k, 1);
            }
        } catch (e) {
            truncated = true;
        }
        return { key, truncated };
    }
    const nudgeOf = (v) => (isNum(v.nudge) ? v.nudge : 0);
    // The followed curves a hit's output consumes: a voice moves its parameters along them; MIDI and OSC send
    // only the values at the onset (already among its controls), so for them the rest of a curve is not heard.
    const followOf = (v) => (v.follow instanceof Follows && v.midi === undefined && v.osc === undefined ? v.follow : null);
    const ONE_SHOT_TAIL = 8;

    // .rhythm(): the onsets kept per pattern (far into the future is fine), and the shortest step.
    const RHYTHM_MAX_STEPS = 2000000;
    const RHYTHM_MIN_STEP = 1 / 256;

    /** Every event of `pattern` sounding at cycle t (a chord gives several); a signal gives its value. */
    function eventsActiveAt(pattern, t) {
        if (pattern._signal) {
            const value = pattern._signal(t);
            return value === undefined ? [] : [{ begin: t, end: t, value }];
        }
        const probe = t + 1e-7;
        for (const back of [0, 7]) {
            const found = pattern.query(Math.floor(t) - back, probe).filter((ev) => ev.begin <= probe && ev.end > probe);
            if (found.length) return found;
        }
        return [];
    }

    /**
     * .rhythm(durations): the pattern one step at a time from cycle 0, never
     * looping. Step k starts where step k - 1 ends, lasts d(k) cycles (the
     * value of `durations` at cycle k) and plays what the pattern plays at
     * cycle k. The onsets are summed once and kept, so a span far into the
     * future is found by a binary search.
     */
    function rhythmPattern(pattern, durations) {
        const tidal = pattern.tidal;
        if (durations === undefined || durations === null || typeof durations === 'boolean') {
            throw new TypeError('rhythm() expects step lengths in cycles: a number or a pattern, e.g. .rhythm(choose([0.25, 0.5]))');
        }
        const fixed = typeof durations === 'number' ? durations : null;
        if (fixed !== null && !Number.isFinite(fixed)) throw new TypeError('rhythm() expects a finite number of cycles per step');
        const source = fixed === null ? toRaw(tidal, durations, 'rhythm') : null;
        const warn = (message) => {
            if (tidal) tidal._warnOnce(message);
            else console.warn('TidalJS:', message);
        };
        // onsets[k] is the start of step k; the first `known` are summed.
        let onsets = new Float64Array(1024);
        let known = 1;
        const length = (k) => {
            let x = fixed;
            if (source) {
                const hit = eventAt(source, k);
                const v = hit ? hit.value : undefined;
                x = typeof v === 'number' ? v : typeof v === 'string' ? ratioValue(v) : undefined;
            }
            if (!isNum(x)) {
                warn('rhythm(): a step length is not a number, so that step lasts 0.25 cycles');
                return 0.25;
            }
            return Math.max(RHYTHM_MIN_STEP, x);
        };
        // Sums onsets until one is at or past `until`; false once the cap is reached first.
        const extend = (until) => {
            while (onsets[known - 1] < until) {
                if (known > RHYTHM_MAX_STEPS) {
                    warn(`rhythm() keeps the first ${RHYTHM_MAX_STEPS} steps; later ones are silent`);
                    return false;
                }
                if (known === onsets.length) {
                    const grown = new Float64Array(Math.min(onsets.length * 2, RHYTHM_MAX_STEPS + 2));
                    grown.set(onsets);
                    onsets = grown;
                }
                onsets[known] = onsets[known - 1] + length(known - 1);
                known++;
            }
            return true;
        };
        return new PatternBuilder(tidal, (b, e) => {
            if (!(e > 0) || e <= b) return [];
            extend(e);
            // The first step starting at or after b (all known steps are in order).
            let lo = 0;
            let hi = known - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (onsets[mid] < b) lo = mid + 1;
                else hi = mid;
            }
            const out = [];
            for (let k = lo; k + 1 < known && onsets[k] < e; k++) {
                if (onsets[k] < b) continue;
                const begin = onsets[k];
                const end = onsets[k + 1];
                for (const ev of eventsActiveAt(pattern, k)) out.push({ begin, end, value: ev.value });
            }
            return out;
        });
    }

    /** [time, value] points of fn(time) from `from` to `to`: every 15 ms, at most 400; flat runs are left out. */
    function samplePoints(from, to, fn) {
        const span = Math.max(0, to - from);
        const count = clamp(Math.ceil(span / 0.015), 1, 400);
        const raw = [];
        let last;
        for (let i = 0; i <= count; i++) {
            const at = from + (span * i) / count;
            const x = fn(at);
            const y = isNum(x) ? x : last;
            if (y === undefined) continue;
            raw.push([at, y]);
            last = y;
        }
        // A point between two equal neighbours changes nothing on a straight line.
        return raw.filter((p, i) => i === 0 || i === raw.length - 1 || !(raw[i - 1][1] === p[1] && raw[i + 1][1] === p[1]));
    }

    /** Lays [time, value] points on an AudioParam as straight lines. */
    function automate(param, points) {
        if (!param || !points.length) return;
        param.setValueAtTime(points[0][1], points[0][0]);
        for (let i = 1; i < points.length; i++) param.linearRampToValueAtTime(points[i][1], points[i][0]);
    }

    /** Replaces a parameter's automation after `from` with straight lines to [time, value] points (from the value it has at `from`). */
    function automateFrom(param, from, points) {
        if (!param) return;
        holdParam(param, from);
        for (const [at, value] of points) param.linearRampToValueAtTime(value, Math.max(at, from));
    }

    // A live input re-lays follow() at most this often (milliseconds), gliding there over LIVE_GLIDE seconds.
    const LIVE_RELAY_MS = 20;
    const LIVE_GLIDE = 0.01;

    /** Stops a parameter's automation at `time`, holding the value it has there (or `fallback`). */
    function holdParam(param, time, fallback) {
        if (!param) return;
        if (typeof param.cancelAndHoldAtTime === 'function') {
            param.cancelAndHoldAtTime(time);
        } else {
            param.cancelScheduledValues(time);
            if (isNum(fallback)) param.setValueAtTime(fallback, time);
        }
    }

    /** Sets a parameter from `time` on, dropping what was scheduled after it (a tied event's new value). */
    function setAt(param, value, time) {
        if (!param || !isNum(value)) return;
        holdParam(param, time, value);
        param.setValueAtTime(value, time);
    }

    // SuperDirt's DJ filter cutoffs for djf 0 to 1: the low-pass closes below 0.5, the high-pass opens above it.
    const djfLow = (x) => 20 * Math.pow(500, Math.min(clamp(x, 0, 1), 0.5) / 0.5);
    const djfHigh = (x) => 20 * Math.pow(500, Math.max(clamp(x, 0, 1) - 0.5, 0) / 0.5);

    /**
     * SuperDirt's resonance and hresonance go from 0 to 1: RLPF / RHPF with
     * rq = resonance.linexp(0, 1, 1, 0.001), a peak of 60 * resonance dB
     * (Web Audio takes the Q of these filters in dB). Below 0 (an extension)
     * they damp the cutoff: -0.1 is SuperCollider's rq 2.
     */
    const resonanceDb = (r) => 60 * clamp(r, -1, 1);
    const bandQ = (q) => clamp(q, 0.0001, 1000);
    const cutoffHz = (f) => clamp(f, 20, 20000);

    // Tidal functions that the earlier sections lack: the primed versions
    // (every', within', toScale', fit'), and the rest of Sound.Tidal.UI.
    Object.assign(PatternBuilder.prototype, {
        /** Tidal's every': applies fn on the cycles where cycle mod n equals offset. */
        everyOffset(n, offset, fn) {
            const transformed = applyTransform('everyOffset', fn, this);
            return patternedAll(this, 'everyOffset', [n, offset], (p, x, o) => {
                const period = Math.abs(Math.floor(x));
                if (period === 0) return p;
                return perCycle(p, (c) => mod(c, period) === Math.floor(o), transformed);
            });
        },

        /** Tidal's within': applies fn to part of each cycle zoomed to a whole cycle, then fits it back. */
        withinZoom(begin, end, fn) {
            if (Array.isArray(begin)) {
                fn = end;
                [begin, end] = begin;
            }
            const a = clamp(requireNumber('withinZoom', begin), 0, 1);
            const z = clamp(requireNumber('withinZoom', end), 0, 1);
            if (z <= a) return this;
            requireFunction('withinZoom', fn);
            const inner = compressPattern(applyTransform('withinZoom', fn, zoomPattern(this, a, z)), a, z);
            const outside = (ev) => {
                const pos = cyclePos(ev.begin);
                return pos < a || pos >= z;
            };
            return this._derive((b, e) => [...this.query(b, e).filter(outside), ...inner.query(b, e)]);
        },

        /** Tidal's toScale': numbers to notes of a scale, with an octave of `octave` semitones. */
        toScaleBy(octave, steps) {
            const size = requireNumber('toScaleBy', octave);
            const list = checkNumbers('toScaleBy', steps);
            return this.withValue((v) => {
                const x = toNumber(v);
                if (x === undefined) return v;
                const d = Math.floor(x);
                return list[mod(d, list.length)] + size * Math.floor(d / list.length);
            });
        },

        /**
         * Tidal's fit': cuts the pattern (spread over `cycles` cycles) into n
         * parts named by the `from` pattern, then plays them in the order of
         * the `to` pattern, each part squeezed into its step.
         */
        fitSlices(cycles, n, from, to) {
            const cyc = requireNumber('fitSlices', cycles);
            const parts = Math.floor(requireNumber('fitSlices', n));
            if (!(cyc > 0) || parts < 1) throw new RangeError('fitSlices() expects cycles > 0 and n >= 1');
            const source = fastPattern(this, cyc);
            const names = fastPattern(toRaw(this.tidal, from, 'fitSlices'), cyc);
            const slices = Array.from({ length: parts }, (_, i) =>
                source.mask(names.withValue((v) => toNumber(v) === i)).stretch());
            return squeezeJoin(this.tidal, toRaw(this.tidal, to, 'fitSlices'), (v) => {
                const i = toNumber(v);
                return i === undefined ? null : slices[mod(Math.floor(i), parts)];
            });
        },

        /** Tidal's substruct: each true step of a boolean pattern plays a whole cycle of this pattern, squeezed in. */
        substruct(booleans) {
            const bools = toRaw(this.tidal, booleans, 'substruct');
            return squeezeJoin(this.tidal, bools, (v) => (isTruthy(v) ? this : null));
        },

        /** Tidal's whenT: applies fn to the events whose time (in cycles) passes the test. */
        whenT(test, fn) {
            requireFunction('whenT', test);
            const transformed = applyTransform('whenT', fn, this);
            return this._derive((b, e) => [
                ...this.query(b, e).filter((ev) => !test(ev.begin)),
                ...transformed.query(b, e).filter((ev) => !!test(ev.begin)),
            ]);
        },

        /** This pattern and `other` squeezed into one cycle (Tidal's fastAppend). */
        fastAppend(other) {
            return fastcat(this.tidal, [this, toPattern(this.tidal, other, 'fastAppend')]);
        },
        /** This pattern in one cycle, `other` in the next (Tidal's slowAppend, the same as append). */
        slowAppend(other) {
            return slowcat(this.tidal, [this, toPattern(this.tidal, other, 'slowAppend')]);
        },

        /** Tidal's jux4, made for four speakers: the pattern at 5/8 of the circle and fn(pattern) at 1/8. In stereo: a little right and mostly left. */
        jux4(fn) {
            return stackPatterns(this.tidal, [this.pan(0.25), applyTransform('jux4', fn, this).pan(-0.75)]);
        },
        /** Like jux, with each side in its own cut group (-1 and -2), so a sound only cuts sounds on its own side. */
        juxcut(fn) {
            return stackPatterns(this.tidal, [this.pan(-1).cut(-1), applyTransform('juxcut', fn, this).pan(1).cut(-2)]);
        },

        /** Applies the functions of a list in turn, one per cycle (Tidal's spreadf). */
        spreadf(fns) {
            const list = checkFunctions('spreadf', fns);
            return slowcat(this.tidal, list.map((f) => applyTransform('spreadf', f, this)));
        },

        /** Each step of the speed pattern plays a whole cycle of this pattern at that speed, squeezed in. */
        fastSqueeze(factors) {
            return squeezeJoin(this.tidal, toRaw(this.tidal, factors, 'fastSqueeze'), (v) => {
                const f = toNumber(v);
                return f === undefined ? null : fastPattern(this, f);
            });
        },
        /** Like fastSqueeze, slowing the pattern down instead. */
        slowSqueeze(factors) {
            return squeezeJoin(this.tidal, toRaw(this.tidal, factors, 'slowSqueeze'), (v) => {
                const f = toNumber(v);
                return f === undefined || !(f > 0) ? null : fastPattern(this, 1 / f);
            });
        },

        /** Makes the pattern monophonic: an event that starts while another sounds waits for it to end (or is dropped). */
        mono() {
            return this._derive((b, e) => {
                const events = this.query(Math.floor(b) - 1, e).slice().sort((x, y) => x.begin - y.begin || x.end - y.end);
                const out = [];
                let busyUntil = -Infinity;
                for (const ev of events) {
                    let begin = ev.begin;
                    if (begin < busyUntil - 1e-9) {
                        if (ev.end <= busyUntil + 1e-9) continue;
                        begin = busyUntil;
                    }
                    busyUntil = ev.end;
                    if (begin >= b && begin < e) out.push(begin === ev.begin ? ev : { begin, end: ev.end, value: ev.value });
                }
                return out;
            });
        },

        /** Loops the first n cycles of the pattern (Tidal's timeLoop). */
        timeLoop(n) {
            return this.outside(n, (x) => x.loopFirst());
        },

        /**
         * A pitch envelope with breakpoints, as SuperCollider's Env: levels in
         * semitones, times in seconds between them, and curves (0 or "lin"
         * straight, negative fast at first, positive slow at first, "exp").
         */
        pitchenv(levels, times, curves = 0) {
            if (!Array.isArray(levels) || levels.length < 2 || !levels.every((x) => toNumber(x) !== undefined)) {
                throw new TypeError('pitchenv() expects a list of levels in semitones, e.g. pitchenv([-5, 6, 0], [0.1, 1.7])');
            }
            if (!Array.isArray(times) || times.length !== levels.length - 1 || !times.every((x) => toNumber(x) >= 0)) {
                throw new TypeError('pitchenv() expects one time in seconds between each pair of levels, e.g. pitchenv([-5, 6, 0], [0.1, 1.7])');
            }
            const curveList = Array.isArray(curves) ? curves : times.map(() => curves);
            const env = {
                levels: levels.map(toNumber),
                times: times.map(toNumber),
                curves: times.map((_, i) => envCurveValue(curveList[i % Math.max(1, curveList.length)])),
            };
            return this.withValue((v) => ({ ...asObject(v), pitchenv: env }));
        },

        /**
         * Changes a control while each note sounds, from its onset through its
         * release: the signal is read at the cycle each moment falls on (the
         * value at the onset replaces the control's own). Several can be
         * chained; the last one for a control wins.
         */
        follow(control, sig) {
            return followPattern(this, 'follow', control, sig, false);
        },

        /** Like follow(), with the signal's time starting at 0 at each note's onset (an LFO that restarts with every note). */
        followNote(control, sig) {
            return followPattern(this, 'followNote', control, sig, true);
        },

        /**
         * Plays the pattern one step at a time from cycle 0, never looping:
         * step k starts where the one before ends, lasts `durations` cycles
         * (a number or a pattern, read at cycle k) and plays what this
         * pattern plays at cycle k (several events for a chord, none for a rest).
         */
        rhythm(durations) {
            return rhythmPattern(this, durations);
        },
    });

    // ==================================================================
    // More of Tidal's library
    // ==================================================================
    //
    // Functions from Sound.Tidal.UI, Core and Control, as methods. Where
    // Tidal takes a pattern as the first arguments (fast "<1 2>"), so do
    // these, through patterned().

    /** Calls apply(pattern, a, b, ...) with each argument patterned (nested). */
    function patternedAll(pattern, fname, args, apply) {
        const step = (p, i, values) => {
            if (i === args.length) return apply(p, ...values);
            return patterned(p, fname, args[i], (q, x) => step(q, i + 1, [...values, x]));
        };
        return step(pattern, 0, []);
    }

    /** The parts of cycle c where `values` (a pattern or signal) has one value. */
    function partsOf(values, c) {
        if (values._signal) return [{ begin: c, end: c + 1, value: values._signal(c) }];
        return values.query(c - 1, c + 1).filter((ev) => ev.end > c && ev.begin < c + 1);
    }

    /**
     * For each part of `selector` within a cycle, plays the pattern that
     * choose(value, part) returns over that part (Tidal's innerJoin).
     */
    function joinOver(tidal, selector, choose) {
        return new PatternBuilder(tidal, (b, e) => eachCycle(b, e, (c, s, t) => {
            const out = [];
            for (const part of partsOf(selector, c)) {
                const lo = Math.max(s, part.begin);
                const hi = Math.min(t, part.end);
                if (lo >= hi) continue;
                const chosen = choose(part.value, part, c);
                if (!chosen) continue;
                for (const ev of chosen.query(lo, hi)) out.push(ev);
            }
            return out;
        }));
    }

    /** Maps cycle c + [a, z) of the pattern onto the whole cycle c (Tidal's zoom). */
    function zoomPattern(pattern, a, z) {
        const d = z - a;
        if (!(d > 0)) return silence(pattern.tidal);
        return pattern._derive((b, e) => eachCycle(b, e, (c, s, t) => {
            const toSrc = (x) => c + a + (x - c) * d;
            const fromSrc = (y) => c + (y - c - a) / d;
            return pattern.query(toSrc(s), toSrc(t)).map(
                (ev) => ({ begin: fromSrc(ev.begin), end: fromSrc(ev.end), value: ev.value })
            );
        }));
    }

    /** Applies fn to the events of the cycles for which test(cycle) is true. */
    function perCycle(pattern, test, transformed, otherwise = pattern) {
        return pattern._derive((b, e) => eachCycle(b, e, (c, s, t) =>
            (test(c) ? transformed : otherwise).query(s, t)
        ));
    }

    /** Multiplies a numeric control of every event (missing values count as `fallback`). */
    function scaleControl(pattern, name, factor, fallback = 1) {
        return pattern.withValue((v) => {
            const o = asObject(v);
            return { ...o, [name]: (isNum(o[name]) ? o[name] : fallback) * factor };
        });
    }

    /** True if every key of `match` equals the event's value (arrays: any of them). */
    function matchesControls(value, match) {
        const o = asObject(value);
        return Object.entries(match).every(([key, want]) => {
            const options = Array.isArray(want) ? want : [want];
            return options.some((w) => {
                const got = o[key];
                if (key === 's' && typeof w === 'string' && w.includes(':')) {
                    const sv = soundValue(w);
                    return got === sv.s && o.n === sv.n;
                }
                if (isNum(got) && toNumber(w) !== undefined) {
                    return key === 'note' ? got === CONTROLS.note(w) : got === toNumber(w);
                }
                return String(got) === String(w);
            });
        });
    }

    /**
     * Combines two event values for set() and the arithmetic operators.
     * Control objects combine key by key (keys only on the right are added);
     * a plain number acts on note, else n. Notes are combined as semitones
     * from middle C, so note("0") .add(note("12")) is note("12").
     */
    function combineValues(a, b, op) {
        const num = (x) => toNumber(x);
        const onNote = (key, x, y) => (key === 'note' ? op(x - 60, y - 60) + 60 : op(x, y));
        if (op === SET) {
            if (b && typeof b === 'object') return { ...asObject(a), ...b };
            if (a && typeof a === 'object' && num(b) !== undefined) return { ...a, [Number.isInteger(num(b)) ? 'n' : 'speed']: num(b) };
            return a && typeof a === 'object' ? a : b;
        }
        if (a && typeof a === 'object') {
            if (b && typeof b === 'object') {
                const out = { ...a };
                for (const [key, y] of Object.entries(b)) {
                    const x = a[key];
                    if (x === undefined) out[key] = y;
                    else if (isNum(x) && isNum(y)) out[key] = onNote(key, x, y);
                    // Tidal keeps the left value of anything else (strings are not joined).
                }
                return out;
            }
            // Tidal: a bare number in a control pattern is n (fromInteger) or speed
            // (fromRational), combined key by key like any control.
            const y = num(b);
            if (y === undefined) return a;
            return combineValues(a, { [Number.isInteger(y) ? 'n' : 'speed']: y }, op);
        }
        if (b && typeof b === 'object') return combineValues(asObject(a), b, op);
        const x = num(a);
        const y = num(b);
        if (x !== undefined && y !== undefined) return op(x, y);
        if (op === ADD && typeof a === 'string' && typeof b === 'string') return a + b;
        return a;
    }
    const SET = () => undefined;
    const ADD = (x, y) => x + y;
    const OPS = {
        add: ADD,
        sub: (x, y) => x - y,
        mul: (x, y) => x * y,
        div: (x, y) => (y === 0 ? 0 : x / y),
        mod: (x, y) => (y === 0 ? 0 : mod(x, y)),
        pow: (x, y) => Math.pow(x, y),
    };

    // Tidal's |<: values from the left; keys only on the right are added.
    const KEEP = () => undefined;

    /** The right-hand side of an operator: a number, a mini-notation string, controls or a pattern. */
    function operand(tidal, other, fname) {
        if (other instanceof PatternBuilder) return other;
        if (typeof other === 'number' || typeof other === 'boolean') return pure(tidal, other);
        if (typeof other === 'string' || Array.isArray(other)) return toRaw(tidal, other, fname);
        if (other && typeof other === 'object') return pure(tidal, { ...other });
        throw new TypeError(`${fname}() expects a number, a mini-notation string or a pattern`);
    }

    /** Combines two values with an operator, or the keep/set rules. */
    function combineWith(a, b, op) {
        if (op === KEEP) {
            if (b && typeof b === 'object') return { ...b, ...asObject(a) };
            return a;
        }
        return combineValues(a, b, op);
    }

    /** Every event of `pattern` sounding at time t, whatever its onset (up to two cycles back). */
    function activeAt(pattern, t) {
        if (pattern._signal) {
            const value = pattern._signal(t);
            return value === undefined ? [] : [{ begin: t, end: t, value }];
        }
        const probe = t + 1e-7;
        return pattern.query(Math.floor(t) - 2, probe).filter((ev) => ev.begin <= probe && ev.end > probe);
    }

    /** The events of `pattern` sounding at some point of [b, e), whatever their onset (up to `back` cycles before b). */
    function soundingIn(pattern, b, e, back = 8) {
        return pattern.query(Math.floor(b) - back, e).filter((ev) => ev.end > b);
    }

    /**
     * Tidal's squeezeJoin: each event of `outer` plays a whole cycle of the
     * pattern pick(value) returns, squeezed into the event (Tidal's focus:
     * the cycle in which the event starts is stretched over the whole event,
     * however long it is). The events take the inner pattern's values,
     * combined with the outer value by merge.
     */
    function squeezeJoin(tidal, outer, pick, merge = (o, inner) => inner) {
        return new PatternBuilder(tidal, (b, e) => {
            const out = [];
            for (const oev of soundingIn(outer, b, e)) {
                const span = oev.end - oev.begin;
                if (!(span > 0)) continue;
                const inner = pick(oev.value, oev);
                if (!inner) continue;
                const lo = Math.max(b, oev.begin);
                const hi = Math.min(e, oev.end);
                if (lo >= hi) continue;
                if (inner._signal) {
                    const value = inner._signal(oev.begin);
                    if (oev.begin >= b && oev.begin < e && value !== undefined) out.push({ begin: oev.begin, end: oev.end, value: merge(oev.value, value) });
                    continue;
                }
                const c = Math.floor(oev.begin);
                const toInner = (x) => c + (x - oev.begin) / span;
                const toOuter = (u) => oev.begin + (u - c) * span;
                // Tidal keeps the intersection of the outer and inner wholes, so
                // an inner event is cut at the outer event's end, and one that
                // began before it (and still sounds) starts with it.
                const inners = inner.query(toInner(lo), toInner(hi));
                if (lo === oev.begin) {
                    for (const ev of activeAt(inner, c)) if (ev.begin < c - 1e-9) inners.push(ev);
                }
                for (const ev of inners) {
                    const begin = Math.max(oev.begin, toOuter(ev.begin));
                    const end = Math.min(oev.end, toOuter(ev.end));
                    if (end > begin && begin >= b && begin < e) out.push({ begin, end, value: merge(oev.value, ev.value) });
                }
            }
            return out;
        });
    }

    /** Tidal's op| : the rhythm comes from `other`, the values of this pattern are combined in. */
    function operateRight(pattern, other, fname, op) {
        const right = operand(pattern.tidal, other, fname);
        if (right._signal) return operatePattern(pattern, right, fname, op);
        return right._derive((b, e) => {
            const out = [];
            for (const rev of right.query(b, e)) {
                for (const hit of eventsAt(pattern, rev.begin)) {
                    out.push({ begin: rev.begin, end: rev.end, value: combineWith(hit.value, rev.value, op) });
                }
            }
            return out;
        });
    }

    /** Tidal's |op| : the rhythm comes from both sides, cut where their events meet. */
    function operateBoth(pattern, other, fname, op) {
        const right = operand(pattern.tidal, other, fname);
        if (right._signal) return operatePattern(pattern, right, fname, op);
        if (pattern._signal) return operateRight(pattern, right, fname, op);
        const p = new PatternBuilder(pattern.tidal, (b, e) => {
            const out = [];
            for (const lev of pattern.query(b, e)) {
                for (const rev of activeAt(right, lev.begin)) {
                    out.push({ begin: lev.begin, end: Math.min(lev.end, rev.end), value: combineWith(lev.value, rev.value, op) });
                }
            }
            for (const rev of right.query(b, e)) {
                for (const lev of activeAt(pattern, rev.begin)) {
                    if (lev.begin >= rev.begin - 1e-9) continue; // counted above
                    out.push({ begin: rev.begin, end: Math.min(lev.end, rev.end), value: combineWith(lev.value, rev.value, op) });
                }
            }
            return out;
        });
        return withSteps(p, lcmSteps([pattern._steps, right._steps].filter((x) => x !== undefined)));
    }

    /** Tidal's ||op : each event of this pattern plays a whole cycle of `other` squeezed into it. */
    function operateSqueeze(pattern, other, fname, op) {
        const right = operand(pattern.tidal, other, fname);
        if (pattern._signal) return operateRight(pattern, right, fname, op);
        return squeezeJoin(pattern.tidal, pattern, () => right, (a, b) => combineWith(a, b, op));
    }

    /** Values of `other` (a number, a mini-notation string or a pattern) at this pattern's events. */
    function operatePattern(pattern, other, fname, op) {
        const tidal = pattern.tidal;
        const right = operand(tidal, other, fname);

        if (pattern._signal) {
            const sig = pattern._signal;
            return signal(tidal, (t) => {
                const hit = eventAt(right, t);
                return hit ? combineWith(sig(t), hit.value, op) : sig(t);
            });
        }
        return pattern._derive((b, e) => {
            const out = [];
            for (const ev of pattern.query(b, e)) {
                for (const hit of eventsAt(right, ev.begin)) {
                    out.push({ begin: ev.begin, end: ev.end, value: combineWith(ev.value, hit.value, op) });
                }
            }
            return out;
        });
    }

    // Tidal's operators take the rhythm from the left (|+), the right (+|),
    // both sides (|+|) or squeeze the right into each event of the left (||+):
    // add, addRight, addBoth and addSqueeze, and the same for every operator.
    const OPERATORS = { set: SET, keep: KEEP, ...OPS };
    const OPERATOR_VARIANTS = { Right: operateRight, Both: operateBoth, Squeeze: operateSqueeze };
    for (const [base, op] of Object.entries(OPERATORS)) {
        for (const [suffix, operate] of Object.entries(OPERATOR_VARIANTS)) {
            const fname = base + suffix;
            PatternBuilder.prototype[fname] = function (other) { return operate(this, other, fname, op); };
        }
    }

    Object.assign(PatternBuilder.prototype, {
        // --- Combining patterns (Tidal's #, |+, |-, |*, |/, |%) -------------

        /** Tidal's #: the rhythm of this pattern, with the controls of `other` added or replaced. */
        set(other) { return operatePattern(this, other, 'set', SET); },
        /** Tidal's |+: adds numbers (or joins strings) key by key; the rhythm comes from this pattern. */
        add(other) { return operatePattern(this, other, 'add', OPS.add); },
        sub(other) { return operatePattern(this, other, 'sub', OPS.sub); },
        mul(other) { return operatePattern(this, other, 'mul', OPS.mul); },
        div(other) { return operatePattern(this, other, 'div', OPS.div); },
        mod(other) { return operatePattern(this, other, 'mod', OPS.mod); },
        pow(other) { return operatePattern(this, other, 'pow', OPS.pow); },
        /** Tidal's |<: the rhythm and the values of this pattern; controls only `other` has are added. */
        keep(other) { return operatePattern(this, other, 'keep', KEEP); },

        // --- Structure -----------------------------------------------------

        /** Squashes every other cycle into its first half and shifts it a quarter cycle (a breakbeat feel). */
        brak() {
            const squashed = shiftPattern(fastcat(this.tidal, [this, silence(this.tidal)]), 0.25);
            return perCycle(this, (c) => mod(c, 2) === 1, squashed);
        },

        /** Keeps only the events where a boolean pattern is true ("1 0 1 1", "t f"). */
        mask(booleans) {
            const bools = toRaw(this.tidal, booleans, 'mask');
            return this._filter((ev) => {
                const hit = eventAt(bools, ev.begin);
                return !!hit && isTruthy(hit.value);
            });
        },

        /** Inverts a boolean pattern: true becomes false and the other way round. */
        inv() {
            return this.withValue((v) => !isTruthy(v));
        },

        /** This pattern where the booleans are true, `other` where they are false. */
        sew(booleans, other) {
            const bools = toRaw(this.tidal, booleans, 'sew');
            return stackPatterns(this.tidal, [this.mask(bools), toPattern(this.tidal, other, 'sew').mask(bools.inv())]);
        },

        /** The rhythm of a boolean pattern: true steps take this pattern's value, false steps `other`'s. */
        stitch(booleans, other) {
            const bools = toRaw(this.tidal, booleans, 'stitch');
            const rest = toPattern(this.tidal, other, 'stitch');
            return stackPatterns(this.tidal, [
                this.struct(bools.withValue((v) => isTruthy(v))),
                rest.struct(bools.withValue((v) => !isTruthy(v))),
            ]);
        },

        /** Squashes this pattern into the first `time` of each cycle and `other` into the rest. */
        wedge(time, other) {
            const rest = toPattern(this.tidal, other, 'wedge');
            return patterned(this, 'wedge', time, (p, x) => {
                const t = clamp(x, 0, 1);
                if (t === 0) return rest;
                if (t === 1) return p;
                return stackPatterns(p.tidal, [compressPattern(p, 0, t), compressPattern(rest, t, 1)]);
            });
        },

        /** Euclidean rhythm with a rotation, as Tidal's euclidOff (same as euclid with three arguments). */
        euclidOff(k, n, rotation) { return this.euclid(k, n, rotation); },
        eoff(k, n, rotation) { return this.euclid(k, n, rotation); },
        euclidOffFull(k, n, rotation, other) { return this.euclidFull(k, n, other, rotation); },

        /** Zooms into part of each cycle: zoom(0.25, 0.75) plays the middle half, stretched to fill the cycle. */
        zoom(begin, end) {
            if (Array.isArray(begin)) [begin, end] = begin;
            const a = requireNumber('zoom', begin);
            const z = requireNumber('zoom', end);
            // Tidal: withSteps (* d), d the length of the zoomed part.
            return withSteps(new PatternBuilder(this.tidal, zoomPattern(this, a, z)._query), this._steps > 0 ? this._steps * (z - a) : undefined);
        },
        zoomArc(begin, end) { return this.zoom(begin, end); },

        /** Squashes each cycle into its first 1/n, leaving the rest silent. */
        fastGap(n) {
            return patterned(this, 'fastGap', n, (p, x) => (x > 0 ? compressPattern(p, 0, Math.min(1, 1 / Math.max(1, x))) : silence(p.tidal)));
        },
        densityGap(n) { return this.fastGap(n); },

        /** Plays only the first part of each cycle (trunc(0.75): the first three quarters). */
        trunc(fraction) {
            return patterned(this, 'trunc', fraction, (p, x) => {
                const len = clamp(x, 0, 1);
                return p._derive((b, e) => p.query(b, e)
                    .filter((ev) => cyclePos(ev.begin) < len - 1e-9)
                    .map((ev) => ({ ...ev, end: Math.min(ev.end, Math.floor(ev.begin) + len) })));
            });
        },

        /** Repeats each cycle n times before moving on. */
        repeatCycles(n) {
            return patterned(this, 'repeatCycles', n, (p, x) => {
                const times = Math.max(1, Math.floor(x));
                return p._derive((b, e) => eachCycle(b, e, (c, s, t) => {
                    const offset = c - Math.floor(c / times);
                    return p.query(s - offset, t - offset).map((ev) => ({ begin: ev.begin + offset, end: ev.end + offset, value: ev.value }));
                }));
            });
        },

        /** Plays the first cycle of the pattern over and over. */
        loopFirst() {
            return this._derive((b, e) => eachCycle(b, e, (c, s, t) =>
                this.query(s - c, t - c).map((ev) => ({ begin: ev.begin + c, end: ev.end + c, value: ev.value }))
            ));
        },

        /** Shifts each event later by `ratio` of its length, keeping its end: pressBy(0.5) plays on the off-beats. */
        pressBy(ratio) {
            return patterned(this, 'pressBy', ratio, (p, r) => p._derive((b, e) => {
                const out = [];
                for (const ev of p.query(Math.floor(b) - 1, e)) {
                    const begin = ev.begin + (ev.end - ev.begin) * clamp(r, 0, 1);
                    if (begin >= b && begin < e) out.push({ begin, end: ev.end, value: ev.value });
                }
                return out;
            }));
        },
        press() { return this.pressBy(0.5); },

        /** Repeats each event n times within its span; each repeat applies fn once more (Tidal's plyWith). */
        plyWith(n, fn) {
            requireFunction('plyWith', fn);
            // Tidal: arpeggiate $ compound n, where compound n = overlay p (f $ compound (n - 1)),
            // down to p at n <= 1 (so 2.4 makes three layers).
            return patterned(this, 'plyWith', n, (p, x) => {
                const compound = (k) => (k <= 1 ? p : stackPatterns(p.tidal, [p, applyTransform('plyWith', fn, compound(k - 1))]));
                return arpeggiateEvents(compound(x));
            });
        },

        /** Plays the notes of each chord one after another, like strumming: 1/4 of the event between the first and last. */
        rolled() { return this.rolledBy(0.25); },

        /** Strums chords: each note of a chord starts `amount` of the event later than the one below; negative strums down. */
        rolledBy(amount) {
            return patterned(this, 'rolledBy', amount, (p, t) => {
                if (t === 0) return p;
                return p._derive((b, e) => {
                    const groups = new Map();
                    for (const ev of p.query(Math.floor(b) - 1, e)) {
                        const key = `${ev.begin}:${ev.end}`;
                        if (!groups.has(key)) groups.set(key, []);
                        groups.get(key).push(ev);
                    }
                    const out = [];
                    for (const group of groups.values()) {
                        const notes = group.slice();
                        if (t < 0) notes.reverse();
                        const shift = ((group[0].end - group[0].begin) * Math.abs(t)) / notes.length;
                        notes.forEach((ev, i) => {
                            const begin = ev.begin + i * shift;
                            if (begin >= b && begin < e) out.push({ begin, end: ev.end, value: ev.value });
                        });
                    }
                    return out;
                });
            });
        },

        // --- Conditions ----------------------------------------------------

        /** Applies fn on the cycles for which test(cycle) is true. */
        when(test, fn) {
            requireFunction('when', test);
            return perCycle(this, (c) => !!test(c), applyTransform('when', fn, this));
        },

        /** Applies fa on the cycles for which test(cycle) is true, fb on the others. */
        ifp(test, fa, fb) {
            requireFunction('ifp', test);
            return perCycle(this, (c) => !!test(c), applyTransform('ifp', fa, this), applyTransform('ifp', fb, this));
        },

        /** Applies fn on the cycles divisible by any of the numbers: foldEvery([3, 5], f). */
        foldEvery(ns, fn) {
            requireFunction('foldEvery', fn);
            const list = Array.isArray(ns) ? ns : [ns];
            // Tidal: foldr (`_every` f) p ns
            return list.reduceRight((acc, n) => acc.every(n, fn), this);
        },

        /** Applies fn to whole cycles at random, each with probability `prob`. */
        someCyclesBy(prob, fn) {
            const transformed = applyTransform('someCyclesBy', fn, this);
            return patterned(this, 'someCyclesBy', prob, (p, x) =>
                perCycle(p, (c) => timeRand(c) < clamp(x, 0, 1), transformed));
        },
        someCycles(fn) { return this.someCyclesBy(0.5, fn); },
        somecyclesBy(prob, fn) { return this.someCyclesBy(prob, fn); },
        somecycles(fn) { return this.someCyclesBy(0.5, fn); },

        /** Always applies fn: the same as fn(pattern). */
        always(fn) { return applyTransform('always', fn, this); },
        /** Never applies fn: the pattern unchanged. */
        never(fn) { requireFunction('never', fn); return this; },

        /** Applies fn "inside" a cycle: inside(2, rev) reverses each half cycle. */
        inside(n, fn) {
            requireFunction('inside', fn);
            return patterned(this, 'inside', n, (p, x) => fastPattern(applyTransform('inside', fn, fastPattern(p, 1 / x)), x));
        },
        /** Applies fn over several cycles: outside(2, rev) reverses each pair of cycles. */
        outside(n, fn) {
            requireFunction('outside', fn);
            return patterned(this, 'outside', n, (p, x) => fastPattern(applyTransform('outside', fn, fastPattern(p, x)), 1 / x));
        },

        /** chunk with a negative n: moves backwards through the parts (Tidal's deprecated chunk'). */
        _chunkBack(parts, fn) {
            const transformed = applyTransform('chunk', fn, this);
            return this._derive((b, e) => eachCycle(b, e, (c, s, t) => {
                const k = mod(-c - 1, parts);
                const inside = (ev) => ev.begin >= c + k / parts && ev.begin < c + (k + 1) / parts;
                return [...this.query(s, t).filter((ev) => !inside(ev)), ...transformed.query(s, t).filter(inside)];
            }));
        },

        /** Applies fn to the events whose controls match: fix(x => x.fast(2), { s: "bd" }). */
        fix(fn, match) {
            return this.contrast(fn, (x) => x, match);
        },
        /** Applies fn to the events whose controls do not match. */
        unfix(fn, match) {
            return this.contrast((x) => x, fn, match);
        },
        /** Applies fa to the events that match the controls and fb to the others. */
        contrast(fa, fb, match) {
            if (!match || typeof match !== 'object') throw new TypeError('contrast() expects controls to match, e.g. { s: "bd" }');
            const hit = this._filter((ev) => matchesControls(ev.value, match));
            const miss = this._filter((ev) => !matchesControls(ev.value, match));
            return stackPatterns(this.tidal, [applyTransform('contrast', fa, hit), applyTransform('contrast', fb, miss)]);
        },

        /** Applies a function with each value of a list, one per cycle: spread((p, x) => p.fast(x), [1, 2]). */
        spread(fn, values) {
            requireFunction('spread', fn);
            if (!Array.isArray(values) || values.length === 0) throw new TypeError('spread() expects a function and a list, e.g. spread((p, x) => p.fast(x), [1, 2])');
            return slowcat(this.tidal, values.map((v) => spreadItem(fn, this, v)));
        },
        slowspread(fn, values) { return this.spread(fn, values); },
        /** Like spread, with all the values squeezed into one cycle. */
        fastspread(fn, values) {
            requireFunction('fastspread', fn);
            return fastcat(this.tidal, values.map((v) => spreadItem(fn, this, v)));
        },
        /** Like spread, picking a value at random each cycle. */
        spreadChoose(fn, values) {
            requireFunction('spreadChoose', fn);
            // Tidal: a value per cycle, chosen by rand at the cycle's start.
            return chooseCycle(this.tidal, values.map((v) => spreadItem(fn, this, v)), 0);
        },
        spreadr(fn, values) { return this.spreadChoose(fn, values); },

        /** Applies the function from a list that an index pattern picks: pickF("<0 1>", [x => x.rev(), x => x.fast(2)]). */
        pickF(indices, fns) {
            const list = checkFunctions('pickF', fns).map((f) => applyTransform('pickF', f, this));
            return joinOver(this.tidal, toRaw(this.tidal, indices, 'pickF'), (v) => {
                const i = toNumber(v);
                return i === undefined ? null : list[mod(Math.floor(i), list.length)];
            });
        },
        /** Like pickF, with a number from 0 to 1 choosing the function. */
        selectF(amount, fns) {
            const list = checkFunctions('selectF', fns).map((f) => applyTransform('selectF', f, this));
            return joinOver(this.tidal, toRaw(this.tidal, amount, 'selectF'), (v) => {
                const x = toNumber(v);
                return x === undefined ? null : list[clamp(Math.floor(x * list.length), 0, list.length - 1)];
            });
        },

        /**
         * Like soak, accumulating: each cycle combines the previous result with
         * fn applied once more, e.g. snowball(4, (a, b) => a.add(b), x => x.fast(2)).
         */
        snowball(depth, combine, fn) {
            requireFunction('snowball', combine);
            const n = Math.max(1, Math.floor(requireNumber('snowball', depth)));
            const layers = [this];
            let acc = this;
            let cur = this;
            for (let i = 1; i < n; i++) {
                cur = applyTransform('snowball', fn, cur);
                acc = combine(acc, cur);
                if (!(acc instanceof PatternBuilder)) throw new TypeError('snowball(): the combining function must return a pattern, e.g. (a, b) => a.add(b)');
                layers.push(acc);
            }
            return slowcat(this.tidal, layers);
        },

        /** Applies fn repeatedly, once more each cycle, for `depth` cycles (Tidal's soak). */
        soak(depth, fn) {
            const n = Math.max(1, Math.floor(requireNumber('soak', depth)));
            const layers = [this];
            for (let i = 1; i < n; i++) layers.push(applyTransform('soak', fn, layers[i - 1]));
            return slowcat(this.tidal, layers);
        },

        // --- Randomness ----------------------------------------------------

        /** Fades the pattern out over n cycles by removing more and more events. */
        fadeOut(n) {
            const cycles = requireNumber('fadeOut', n);
            return this._filter((ev) => timeRand(ev.begin) >= clamp(ev.begin / cycles, 0, 1));
        },
        /** Fades the pattern in over n cycles, from silence. */
        fadeIn(n) {
            const cycles = requireNumber('fadeIn', n);
            return this._filter((ev) => timeRand(ev.begin) >= 1 - clamp(ev.begin / cycles, 0, 1));
        },
        fadeOutFrom(from, n) { return this._afterCycle(requireNumber('fadeOutFrom', from), n, false); },
        fadeInFrom(from, n) { return this._afterCycle(requireNumber('fadeInFrom', from), n, true); },

        _afterCycle(from, n, fadeIn) {
            const cycles = requireNumber(fadeIn ? 'fadeInFrom' : 'fadeOutFrom', n);
            return this._filter((ev) => {
                const amount = clamp((ev.begin - from) / cycles, 0, 1);
                return timeRand(ev.begin) >= (fadeIn ? 1 - amount : amount);
            });
        },

        /** Plays each cycle as n segments of random length, each a whole cycle at a random speed. */
        stripe(n) {
            return patterned(this, 'stripe', n, (p, x) => stripePattern(p, Math.max(1, Math.floor(x))));
        },
        /** Like stripe, spread over n cycles. */
        slowstripe(n) {
            return patterned(this, 'slowstripe', n, (p, x) => fastPattern(p.stripe(1), 1 / Math.max(1, x)));
        },

        // --- Repeats and echoes --------------------------------------------

        /** Echoes: n copies, each `time` cycles later and with `feedback` times the gain of the one before. */
        echo(count, time, feedback) {
            return patternedAll(this, 'echo', [count, time, feedback], (p, n, t, fb) =>
                echoWithPattern(p, Math.floor(n), t, (x) => scaleControl(x, 'gain', fb)));
        },
        /** Echoes changed by a function: each copy is fn applied once more, `time` cycles later. */
        echoWith(count, time, fn) {
            requireFunction('echoWith', fn);
            return patternedAll(this, 'echoWith', [count, time], (p, n, t) => echoWithPattern(p, Math.floor(n), t, fn));
        },
        /**
         * Tidal's stut (deprecated there in favour of echo, so not public here):
         * anticipateIn uses it. count copies, `time` apart, getting quieter by `feedback`.
         */
        _stut(count, feedback, time) {
            const copies = Math.max(1, Math.floor(count));
            const layers = [this];
            for (let x = 1; x < copies; x++) {
                const level = feedback + (1 - feedback) * ((copies - x) / copies);
                layers.push(shiftPattern(scaleControl(this, 'gain', level), x * time));
            }
            return stackPatterns(this.tidal, layers);
        },
        /** n copies of each event, `time` apart: a stutter. */
        stutter(count, time) {
            return this.echoWith(count, time, (x) => x);
        },

        /** Adds two quieter, shorter, higher ghost notes after each event (drum ghost notes). */
        ghost() {
            return this.ghostWith(0.125, (x) => scaleControl(scaleControl(x, 'gain', 0.7), 'speed', 1.25).withValue((v) => ({ ...asObject(v), end: 0.2 })));
        },
        /** Ghost notes changed by fn, `time` * 1.5 and * 2.5 after each event. */
        ghostWith(time, fn) {
            const a = requireNumber('ghostWith', time);
            requireFunction('ghostWith', fn);
            const inner = stackPatterns(this.tidal, [this, shiftPattern(applyTransform('ghostWith', fn, this), a * 1.5)]);
            return stackPatterns(this.tidal, [inner, shiftPattern(applyTransform('ghostWith', fn, inner), a * 2.5)]);
        },

        // --- Values --------------------------------------------------------

        /** Scales values from 0..1 to lo..hi exponentially (good for frequencies). */
        rangex(lo, hi) {
            const a = Math.log(requireNumber('rangex', lo));
            const z = Math.log(requireNumber('rangex', hi));
            return this.withValue((v) => {
                const x = toNumber(v);
                return x === undefined ? v : Math.exp(a + x * (z - a));
            });
        },
        qfloor(n = 1) { const k = requireNumber('qfloor', n); return this.withValue((v) => (toNumber(v) === undefined ? v : Math.floor(toNumber(v) * k) / k)); },
        qceiling(n = 1) { const k = requireNumber('qceiling', n); return this.withValue((v) => (toNumber(v) === undefined ? v : Math.ceil(toNumber(v) * k) / k)); },
        qround(n = 1) { return this.quantise(n); },

        /** Turns numbers into notes of a scale given as semitones: toScale([0, 2, 4, 5, 7, 9, 11]). */
        toScale(steps) {
            const list = checkNumbers('toScale', steps);
            return this.withValue((v) => {
                const x = toNumber(v);
                if (x === undefined) return v;
                const d = Math.floor(x);
                return list[mod(d, list.length)] + 12 * Math.floor(d / list.length);
            });
        },

        // --- Samples -------------------------------------------------------

        /** Plays slices of each sample: slice(4, "0 2") plays the first and third quarters, in the rhythm of the index pattern. */
        slice(n, indices) {
            return patterned(this, 'slice', n, (p, x) => {
                const parts = Math.max(1, Math.floor(x));
                const index = toRaw(p.tidal, indices, 'slice');
                return p._derive((b, e) => {
                    const out = [];
                    for (const iev of index.query(b, e)) {
                        const i = toNumber(iev.value);
                        const base = eventAt(p, iev.begin);
                        if (i === undefined || !base) continue;
                        const k = mod(Math.floor(i), parts);
                        out.push({ begin: iev.begin, end: iev.end, value: { ...asObject(base.value), begin: k / parts, end: (k + 1) / parts } });
                    }
                    return out;
                });
            });
        },
        /** Like slice, with each slice sped up or slowed down to fill its step. */
        splice(n, indices) {
            return patterned(this, 'splice', n, (p, x) => {
                const parts = Math.max(1, Math.floor(x));
                const sliced = p.slice(parts, indices);
                return sliced._derive((b, e) => sliced.query(b, e).map((ev) => {
                    const v = asObject(ev.value);
                    const speed = (1 / parts) / (ev.end - ev.begin) * (isNum(v.speed) ? v.speed : 1);
                    return { ...ev, value: { ...v, speed, unit: 'c' } };
                }));
            });
        },
        /** Plays a random slice (of n) of each sample. */
        randslice(n) {
            return patterned(this, 'randslice', n, (p, x) => {
                const parts = Math.max(1, Math.floor(x));
                return p._derive((b, e) => p.query(b, e).map((ev) => {
                    const k = Math.floor(timeRand(ev.begin) * parts);
                    return { ...ev, value: { ...asObject(ev.value), begin: k / parts, end: (k + 1) / parts } };
                }));
            });
        },
        /** Stretches each sample to last n cycles and slows the pattern to match: for loops and breakbeats. */
        loopAt(n) {
            return patterned(this, 'loopAt', n, (p, x) => {
                if (!(x > 0)) return silence(p.tidal);
                return fastPattern(p, 1 / x).withValue((v) => {
                    const o = asObject(v);
                    return { ...o, speed: (isNum(o.speed) ? o.speed : 1) / x, unit: 'c' };
                });
            });
        },
        /** Cuts each sample into n slices with striate and plays them at the speeds of a list, one per cycle. */
        smash(n, factors) {
            const list = checkNumbers('smash', factors);
            const striated = this.striate(n);
            return slowcat(this.tidal, list.map((f) => fastPattern(striated, 1 / f)));
        },
        /** n copies, each shifted by 1/n of a cycle and panned across the stereo field. */
        spin(n) {
            return patterned(this, 'spin', n, (p, x) => {
                const copies = Math.max(1, Math.floor(x));
                const layers = [];
                for (let i = 0; i < copies; i++) {
                    layers.push(shiftPattern(p, -i / copies).withValue((v) => ({ ...asObject(v), pan: (2 * i) / copies - 1 + (copies === 1 ? 1 : 0) })));
                }
                return stackPatterns(p.tidal, layers);
            });
        },
        /** Like striate, with each slice overlapping by `length` (0 to 1) of the sample. */
        striateBy(n, length) {
            return patternedAll(this, 'striateBy', [n, length], (p, x, len) => {
                const parts = Math.max(1, Math.floor(x));
                const slices = [];
                for (let i = 0; i < parts; i++) {
                    const begin = parts > 1 ? ((1 - len) * i) / (parts - 1) : 0;
                    slices.push(p.withValue((v) => mergePlayRange(asObject(v), begin, begin + len)));
                }
                return fastcat(p.tidal, slices);
            });
        },

        // --- Triggers ------------------------------------------------------

        /** Restarts the pattern from its first cycle at the next cycle after the code runs. */
        qtrigger() {
            const at = this.tidal && this.tidal.isPlaying ? Math.ceil(this.tidal.getCyclePosition() - 1e-9) : 0;
            return at ? shiftPattern(this, at) : this;
        },
        qt() { return this.qtrigger(); },
        /** Tidal's triggerWith: restarts the pattern at fn(the cycle position when the code runs). */
        triggerWith(fn) {
            requireFunction('triggerWith', fn);
            const now = this.tidal && this.tidal.isPlaying ? this.tidal.getCyclePosition() : 0;
            const at = requireNumber('triggerWith', fn(now));
            return at ? shiftPattern(this, at) : this;
        },
        /** Restarts the pattern at the next cycle (Tidal's ctrigger, the same as qtrigger). */
        ctrigger() { return this.triggerWith((t) => Math.ceil(t)); },
        /** Restarts the pattern at the nearest cycle (Tidal's rtrigger). */
        rtrigger() { return this.triggerWith((t) => roundHalfEven(t)); },
        /** Restarts the pattern at the start of this cycle (Tidal's ftrigger). */
        ftrigger() { return this.triggerWith((t) => Math.floor(t)); },
        /** Restarts the pattern at the next cycle divisible by n (Tidal's mtrigger). */
        mtrigger(n) {
            const k = Math.max(1, Math.floor(requireNumber('mtrigger', n)));
            return this.triggerWith((t) => k * Math.ceil(t / k));
        },
        mt(n) { return this.mtrigger(n); },
        /** Restarts the pattern from its beginning at the moment the code runs. */
        trigger() {
            const at = this.tidal && this.tidal.isPlaying ? this.tidal.getCyclePosition() : 0;
            return at ? shiftPattern(this, at) : this;
        },
        /** Plays the first cycle of the pattern once, right away. */
        once() {
            if (this.tidal) this.tidal.playOnce(this);
            return undefined;
        },

        // --- Stepwise (Sound.Tidal.Stepwise) ---------------------------------
        //
        // Patterns know their steps: "bd sn hh" has 3, "bd@3 sn" 4, "<a b>" 1.
        // These functions work in steps instead of cycles.

        /** Keeps the first n steps (the last n if negative), stretched to fill the cycle. */
        steptake(n) {
            // Tidal's _take: zoomArc (0, n / steps), past the end of the cycle when n
            // is larger, with n steps (0 steps take no time in stepcat).
            return stepPatterned(this, 'steptake', n, (p, x) => {
                const t = p._steps;
                if (!(t > 0)) return p;
                if (x === 0) {
                    const none = silence(p.tidal);
                    none._steps = 0; // Tidal: zoom (0, 0) has 0 steps, so stepcat gives it no time
                    return none;
                }
                const b = x >= 0 ? 0 : 1 - Math.abs(x) / t;
                const e = x >= 0 ? x / t : 1;
                return withSteps(new PatternBuilder(p.tidal, zoomPattern(p, b, e)._query), Math.abs(x));
            });
        },
        /** Drops the first n steps (the last n if negative). */
        stepdrop(n) {
            return stepPatterned(this, 'stepdrop', n, (p, x) => {
                const t = p._steps;
                if (!(t > 0)) return p;
                return p.steptake(x >= 0 ? t - x : -(t + x));
            });
        },
        /** Multiplies the steps without changing the sound, so stepcat gives the pattern more room. */
        expand(factor) {
            return stepPatterned(this, 'expand', factor, (p, x) => withSteps(p._derive((b, e) => p.query(b, e)), p._steps * x));
        },
        /** Divides the steps without changing the sound. */
        contract(factor) {
            return stepPatterned(this, 'contract', factor, (p, x) => withSteps(p._derive((b, e) => p.query(b, e)), x ? p._steps / x : undefined));
        },
        /** Repeats the pattern n times within the cycle and multiplies its steps to match. */
        extend(factor) {
            return stepPatterned(this, 'extend', factor, (p, x) => {
                const sped = fastPattern(p, x);
                return withSteps(sped === p ? p._derive((b, e) => p.query(b, e)) : sped, p._steps * x);
            });
        },
        /** Changes the speed so the pattern plays `target` steps per cycle. */
        pace(target) {
            return stepPatterned(this, 'pace', target, (p, x) => {
                const t = p._steps;
                if (!(t > 0) || !(x > 0)) return p;
                const sped = fastPattern(p, x / t);
                return withSteps(sped === p ? p._derive((b, e) => p.query(b, e)) : sped, x);
            });
        },
        /** The number of steps of the pattern, or undefined if it has none. */
        steps() {
            return this._steps;
        },
    });

    /**
     * Tidal's ur: a pattern of pattern names, spread over `cycles` cycles.
     * Each name plays its pattern (at its normal speed, in time with the
     * clock) for as long as the name lasts; "name:fx" applies an effect from
     * fx, as if the name's span were one cycle.
     */
    function urPattern(tidal, cycles, structure, patterns, fx) {
        const t = requireNumber('ur', cycles);
        if (!(t > 0)) return silence(tidal);
        if (!patterns || typeof patterns !== 'object') throw new TypeError('ur() expects named patterns, e.g. { a: sound("bd*2"), b: sound("hh*4") }');
        const named = new Map(Object.entries(patterns).map(([k, p]) => [k, toPattern(tidal, p, 'ur')]));
        const effects = new Map(Object.entries(fx || {}));
        for (const [k, f] of effects) requireFunction('ur', f, k);
        const outer = fastPattern(toRaw(tidal, structure, 'ur'), 1 / t);
        const cache = new Map();
        const chosen = (word, begin, end) => {
            const [name, effect] = String(word).split(':');
            const p = named.get(name);
            if (!p) {
                tidal._warnOnce(`ur(): no pattern named "${name}"`);
                return null;
            }
            const f = effect ? effects.get(effect) : null;
            if (effect && !f) tidal._warnOnce(`ur(): no effect named "${effect}"`);
            if (!f) return p;
            const key = `${word}|${begin}|${end}`;
            if (!cache.has(key)) {
                if (cache.size > 256) cache.clear();
                // Tidal: s `rotR` inside (1 / (e - s)) f p, so the pattern starts again in its slot.
                const d = end - begin;
                const local = fastPattern(p, d);
                cache.set(key, shiftPattern(fastPattern(applyTransform('ur', f, local), 1 / d), begin));
            }
            return cache.get(key);
        };
        return new PatternBuilder(tidal, (b, e) => {
            const out = [];
            for (const ev of outer.query(b - t, e)) {
                const lo = Math.max(b, ev.begin);
                const hi = Math.min(e, ev.end);
                if (lo >= hi) continue;
                const p = chosen(ev.value, ev.begin, ev.end);
                if (p) for (const inner of p.query(lo, hi)) out.push(inner);
            }
            return out;
        });
    }

    /** Patterns in one cycle, each given time in proportion to its steps (Tidal's stepcat); 0 steps take none. */
    function stepcatPatterns(tidal, patterns) {
        return timecat(tidal, patterns.filter((p) => p._steps !== 0).map((p) => ({ pattern: p, weight: p._steps > 0 ? p._steps : 1 })));
    }

    /**
     * Tidal's stepJoin, for stepwise functions given a pattern: each part of
     * a cycle where the argument has a value plays the pattern it makes,
     * the parts taking time in proportion to their steps.
     */
    function stepJoin(tidal, args, make) {
        const cache = new Map();
        const cycle = (c) => {
            if (cache.has(c)) return cache.get(c);
            if (cache.size > 64) cache.clear();
            const evs = (args._signal ? [{ begin: c, end: c + 1, value: args._signal(c) }] : soundingIn(args, c, c + 1, 2))
                .map((ev) => ({ begin: Math.max(c, ev.begin) - c, end: Math.min(c + 1, ev.end) - c, value: ev.value }))
                .filter((ev) => ev.end > ev.begin);
            const points = [...new Set([0, 1, ...evs.flatMap((ev) => [ev.begin, ev.end])])].sort((x, y) => x - y);
            const slices = [];
            for (let i = 0; i + 1 < points.length; i++) {
                const [b, e] = [points[i], points[i + 1]];
                const active = evs.filter((ev) => ev.begin < e - 1e-9 && ev.end > b + 1e-9);
                const pattern = active.length ? stackPatterns(tidal, active.map((ev) => make(ev.value))) : silence(tidal);
                slices.push({ dur: e - b, pattern });
            }
            const counted = slices.filter((x) => x.pattern._steps > 0);
            const perc = counted.reduce((sum, x) => sum + x.dur, 0);
            const total = perc > 0 ? counted.reduce((sum, x) => sum + x.pattern._steps, 0) / perc : 1;
            const parts = slices.map((x) => ({ pattern: x.pattern, weight: x.pattern._steps > 0 ? x.pattern._steps : x.dur * total }))
                .filter((x) => x.weight > 0);
            const tc = parts.length ? timecat(tidal, parts) : silence(tidal);
            cache.set(c, tc);
            return tc;
        };
        const p = new PatternBuilder(tidal, (b, e) => eachCycle(b, e, (c, s, t) => cycle(c).query(s, t)));
        p._steps = cycle(0)._steps;
        return p;
    }

    /** A stepwise function with a number, or with a pattern of numbers joined stepwise (Tidal's s_patternify). */
    function stepPatterned(pattern, fname, arg, apply) {
        const plain = typeof arg === 'number' || (typeof arg === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(arg));
        if (plain) return apply(pattern, requireNumber(fname, arg));
        const values = toRaw(pattern.tidal, arg, fname);
        return stepJoin(pattern.tidal, values, (v) => {
            const x = ratioValue(v);
            if (x === undefined) throw new TypeError(`${fname}() expects a number or a pattern of numbers, got "${v}"`);
            return apply(pattern, x);
        });
    }

    /** spread() helper: fn(pattern, value), checked to return a pattern. */
    function spreadItem(fn, pattern, value) {
        const result = fn(pattern, value);
        if (!(result instanceof PatternBuilder)) throw new TypeError('spread(): the function must return a pattern, e.g. (p, x) => p.fast(x)');
        return result;
    }

    function checkFunctions(fname, fns) {
        if (!Array.isArray(fns) || fns.length === 0 || !fns.every((f) => typeof f === 'function')) {
            throw new TypeError(`${fname}() expects a list of functions, e.g. [x => x.rev(), x => x.fast(2)]`);
        }
        return fns;
    }

    function checkNumbers(fname, list) {
        if (!Array.isArray(list) || list.length === 0 || !list.every((x) => toNumber(x) !== undefined)) {
            throw new TypeError(`${fname}() expects a list of numbers, e.g. [0, 2, 4]`);
        }
        return list.map(toNumber);
    }

    /**
     * Tidal's _echoWith: overlay (f (time `rotR` _echoWith (count - 1) time f p)) p,
     * so each echo is shifted first and then changed by fn.
     */
    function echoWithPattern(pattern, count, time, fn) {
        let result = pattern;
        for (let i = 1; i < count; i++) {
            result = stackPatterns(pattern.tidal, [applyTransform('echoWith', fn, shiftPattern(result, time)), pattern]);
        }
        return result;
    }

    /**
     * Each cycle split into n segments of random length, each playing a whole
     * cycle squeezed into it (Tidal's stripe: randArcs weighs the segments
     * 1, 2 or 3, chosen by rand at c + j/n).
     */
    function stripePattern(pattern, n) {
        return pattern._derive((b, e) => eachCycle(b, e, (c, s, t) => {
            const weights = Array.from({ length: n }, (_, j) => 1 + Math.floor(timeRand(c + j / n) * 3));
            const total = weights.reduce((x, y) => x + y, 0);
            const out = [];
            let pos = 0;
            weights.forEach((w, j) => {
                const a = pos / total;
                pos += w;
                const z = pos / total;
                const lo = Math.max(s, c + a);
                const hi = Math.min(t, c + z);
                if (lo >= hi) return;
                // Tidal plays (inside (1/n) (rotR j) p) there: cycle c - j * n of the pattern.
                const src = c - j * n;
                const toSrc = (x) => src + (x - c - a) / (z - a);
                const fromSrc = (y) => c + a + (y - src) * (z - a);
                for (const ev of pattern.query(toSrc(lo), toSrc(hi))) {
                    out.push({ begin: fromSrc(ev.begin), end: fromSrc(ev.end), value: ev.value });
                }
            });
            return out;
        }));
    }

    /** Bits of n, most significant first. */
    function bitsOf(n, bits) {
        const out = [];
        for (let i = bits - 1; i >= 0; i--) out.push(Math.floor(n / Math.pow(2, i)) % 2 === 1);
        return out;
    }

    /** Applies L-system rules ("a:b,b:ab") n times to an axiom. */
    function lindenmayer(n, rules, axiom) {
        const table = {};
        for (const rule of String(rules).split(',')) {
            const [from, to] = rule.split(':');
            if (from !== undefined && to !== undefined && from.length === 1) table[from] = to;
        }
        let text = String(axiom);
        for (let i = 0; i < Math.floor(n) && text.length < 100000; i++) {
            text = [...text].map((ch) => (table[ch] !== undefined ? table[ch] : ch)).join('');
        }
        return text;
    }

    /** States of a Markov chain, n per cycle, starting from xi each cycle (Tidal's markovPat). */
    function markovPattern(tidal, n, xi, matrix) {
        const steps = Math.max(1, Math.floor(n));
        if (!Array.isArray(matrix) || !matrix.every((row) => Array.isArray(row) && row.length === matrix.length)) {
            throw new TypeError('markovPat() expects a square matrix, e.g. [[0.2, 0.8], [0.5, 0.5]]');
        }
        const chain = (c) => {
            const states = [mod(Math.floor(xi), matrix.length)];
            for (let k = 1; k < steps; k++) {
                const row = matrix[states[k - 1]].map((x) => Math.max(0, toNumber(x) || 0));
                const total = row.reduce((x, y) => x + y, 0) || 1;
                // Tidal's runMarkov: timeToRand (cycle + length of the chain so far / n).
                const r = timeRand(c + k / steps);
                let acc = 0;
                let next = row.length - 1;
                for (let i = 0; i < row.length; i++) {
                    acc += row[i] / total;
                    if (r <= acc) { next = i; break; }
                }
                states.push(next);
            }
            return states;
        };
        return new PatternBuilder(tidal, (b, e) => eachCycle(b, e, (c, s, t) => {
            const out = [];
            chain(c).forEach((state, k) => {
                const begin = c + k / steps;
                if (begin >= s && begin < t) out.push({ begin, end: c + (k + 1) / steps, value: state });
            });
            return out;
        }));
    }

    // ------------------------------------------------------------------
    // Streams and transitions (Sound.Tidal.Transition)
    // ------------------------------------------------------------------

    /** Name of a stream: 1 is "d1", other names are kept as they are. */
    function streamName(id) {
        if (typeof id === 'number' || /^\d+$/.test(String(id))) return 'd' + Math.floor(Number(id));
        return String(id);
    }

    /** A pattern playing in a named stream, optionally with a transition from the stream's last pattern. */
    function streamed(tidal, id, pattern, transition) {
        const p = toPattern(tidal, pattern, streamName(id));
        const s = new PatternBuilder(tidal, (b, e) => p.query(b, e));
        s._steps = p._steps;
        s._stream = streamName(id);
        if (transition) s._transition = transition;
        return s;
    }

    /**
     * The identifiers a statement mentions, outside string literals and
     * comments and not after a dot (property names). Template literals and
     * regular expressions count whole: mentioning too much only makes a
     * stream look changed, never unchanged.
     */
    function identifiersIn(text) {
        const ids = [];
        const n = text.length;
        let i = 0;
        let afterDot = false;
        while (i < n) {
            const c = text[i];
            if (c === '/' && text[i + 1] === '/') {
                while (i < n && text[i] !== '\n') i++;
            } else if (c === '/' && text[i + 1] === '*') {
                const close = text.indexOf('*/', i + 2);
                i = close < 0 ? n : close + 2;
            } else if (c === '"' || c === "'") {
                i++;
                while (i < n && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
                i++;
                afterDot = false;
            } else if (NAME_START.test(c) || /[\ud800-\udbff]/.test(c)) {
                NAME_AT.lastIndex = i;
                const m = NAME_AT.exec(text);
                const j = m && m[0].length ? i + m[0].length : i + 1;
                if (!afterDot) ids.push(text.slice(i, j));
                i = j;
                afterDot = false;
            } else if (/\d/.test(c)) {
                while (i < n && /[\w.]/.test(text[i])) i++;
                afterDot = false;
            } else {
                if (c === '.' && text[i + 1] !== '.') afterDot = true;
                else if (!/\s/.test(c)) afterDot = false;
                i++;
            }
        }
        return ids;
    }

    const BINDING = /^\s*(?:export\s+)?(?:const|let|var|class|function|async\s+function)\b/;
    // A JavaScript name, Unicode included (café, ñandú, 𝑥).
    const NAME_START = /[\p{ID_Start}$_]/u;
    const NAME_AT = /[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/uy;
    const NAME_HEAD = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/u;
    // Names that reach variables or code in ways no reading of the text can follow.
    const DYNAMIC_SCOPE = new Set(['eval', 'with', 'globalThis', 'window', 'self', 'Function', 'Reflect']);

    /**
     * The names a declaration statement binds: each declarator's name, every
     * name in a destructuring pattern, or the function's or class's name.
     * When the statement cannot be read for certain, every identifier in it,
     * so a dependency is never missed.
     */
    function declaredNames(text) {
        const all = identifiersIn(text);
        const fn = /^\s*(?:export\s+)?(?:async\s+)?(?:function\s*\*?|class)\s*([\p{ID_Start}$_][\p{ID_Continue}$‌‍]*)/u.exec(text);
        if (fn) return [fn[1]];
        const head = /^\s*(?:export\s+)?(?:const|let|var)\s+/.exec(text);
        if (!head) return all;
        // Walk the declarators at depth 0: a name (or a pattern) up to "=", then skip the initialiser up to ",".
        const names = [];
        let depth = 0;
        let i = head[0].length;
        let expectName = true;
        let quote = null;
        for (; i < text.length; i++) {
            const c = text[i];
            if (quote) {
                if (c === '\\') i++;
                else if (c === quote) quote = null;
                continue;
            }
            if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
            if ('([{'.includes(c)) {
                if (depth === 0 && expectName) {
                    // A destructuring pattern: every name in it.
                    const close = matchingBracket(text, i);
                    if (close < 0) return all;
                    names.push(...identifiersIn(text.slice(i, close + 1)));
                    i = close;
                    expectName = false;
                    continue;
                }
                depth++;
            } else if (')]}'.includes(c)) {
                depth--;
                if (depth < 0) return all;
            } else if (depth === 0 && c === ',') {
                expectName = true;
            } else if (depth === 0 && expectName && (NAME_START.test(c) || /[\ud800-\udbff]/.test(c))) {
                const m = NAME_HEAD.exec(text.slice(i));
                if (!m) return all;
                names.push(m[0]);
                i += m[0].length - 1;
                expectName = false;
            }
        }
        return depth === 0 && quote === null ? names : all;
    }

    // Global names TidalJS installs (gathered by setupGlobalFunctions): calls to them build patterns,
    // except the commands below, which change what plays or reach outside the music.
    const TIDAL_GLOBALS = new Set();
    const COMMAND_GLOBALS = new Set([
        'hush', 'stopAll', 'panic', 'setCPS', 'setcps', 'setTempo', 'setbpm', 'once', 'first', 'asap', 'samples', 'setBus',
        'record', 'stopRecording', 'exportPattern', 'setOscUrl', 'mute', 'unmute', 'solo', 'unsolo', 'unmuteAll', 'unsoloAll',
        'resetCycles', 'setCycle', 'setOutput', 'controlLayout', 'midikeys', 'oscplay', 'testAudio', 'only', 'p', 'jump',
        'jumpIn', 'jumpMod', 'jumpInNext', 'jumpModOffset', 'xfade', 'xfadeIn', 'clutch', 'clutchIn', 'anticipate',
        'anticipateIn', 'interpolate', 'interpolateIn', 'wait', 'waitT', 'mortal', 'histpan',
        ...Array.from({ length: 16 }, (_, i) => 'd' + (i + 1)),
    ]);
    // Pattern methods that do more than make a pattern.
    const COMMAND_METHODS = new Set(['play', 'stop', 'once', 'setCPS', 'setTempo']);
    // In a statement that makes a stream, making the stream itself is not a write.
    const STREAM_GLOBALS = new Set([
        'p', 'only', 'jump', 'jumpIn', 'jumpMod', 'jumpInNext', 'jumpModOffset', 'xfade', 'xfadeIn', 'clutch', 'clutchIn',
        'anticipate', 'anticipateIn', 'interpolate', 'interpolateIn', 'wait', 'waitT', 'mortal', 'histpan',
        ...Array.from({ length: 16 }, (_, i) => 'd' + (i + 1)),
    ]);
    const WRITES = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=', '++', '--']);

    /**
     * True when running a declaration can only define its names: a function
     * or class (without static parts), or initialisers that build values
     * from literals, TidalJS's pattern functions, pattern methods on those,
     * and functions (whose bodies run only when called). Anything else (a
     * call to another function, an assignment, new, delete, await...) may
     * write something a stream reads, so the declaration counts as a write
     * for every stream (see streamSources). When unsure: not pure.
     */
    function pureDeclaration(text, ctx = {}) {
        if (/^\s*(?:export\s+)?(?:async\s+)?function\b/.test(text)) return true;
        if (/^\s*(?:export\s+)?class\b/.test(text)) {
            // Its body only defines methods, but static parts, computed names and the extends
            // expression run when the class is defined.
            if (/\bstatic\b/.test(text) || text.includes('[')) return false;
            const ext = /\bextends\b([^{]*)\{/.exec(text);
            return !ext || /^\s*[\p{ID_Start}$_][\p{ID_Continue}$.]*\s*$/u.test(ext[1]);
        }
        const head = /^\s*(?:export\s+)?(?:const|let|var)\s+/.exec(text);
        if (!head) return false;
        const toks = scanTokens(text, head[0].length, false).tokens;
        // Each declarator: its binding (defaults in a pattern run too) and its initialiser.
        let depth = 0;
        let start = 0;
        const parts = [];
        for (let k = 0; k <= toks.length; k++) {
            const t = toks[k];
            if (k === toks.length || (depth === 0 && isPunct(t, ','))) {
                parts.push(toks.slice(start, k));
                start = k + 1;
                continue;
            }
            if (t.type === 'punct' && OPENERS.has(t.value)) depth++;
            else if (t.type === 'punct' && CLOSERS.has(t.value)) depth--;
            else if (depth === 0 && isPunct(t, ';')) { parts.push(toks.slice(start, k)); start = k + 1; }
        }
        return parts.every((part) => {
            const eq = part.findIndex((t, k) => isPunct(t, '=') && depthBefore(part, k) === 0);
            if (eq < 0) return pureExpression(part, false, ctx);
            return pureExpression(part.slice(0, eq), false, ctx) && pureExpression(part.slice(eq + 1), false, ctx);
        });
    }

    /**
     * The code's own functions that only compute (see pureExpression): a
     * function declaration, or a declaration of one function value, whose
     * body writes nothing outside itself (locals are fine) and calls only
     * TidalJS's pattern functions, pattern methods on its parameters, and
     * other such functions. Found from the bottom up, so a function calling
     * itself is not counted. Calling one is not a write.
     */
    function pureFunctions(texts) {
        const candidates = new Map(); // name -> { params, body }
        for (const text of texts) {
            const toks = scanTokens(text, 0, false).tokens;
            let k = 0;
            if (isWord(toks[k], 'export')) k++;
            let name = null;
            if (isWord(toks[k], 'async')) k++;
            if (isWord(toks[k], 'function')) {
                k++;
                if (isPunct(toks[k], '*')) continue; // generators: not counted
                if (!toks[k] || toks[k].type !== 'name') continue;
                name = toks[k++].value;
            } else if (isWord(toks[k], 'const') || isWord(toks[k], 'let') || isWord(toks[k], 'var')) {
                k++;
                if (!toks[k] || toks[k].type !== 'name' || !isPunct(toks[k + 1], '=')) continue;
                name = toks[k].value;
                k += 2;
                if (isWord(toks[k], 'async')) k++;
                if (isWord(toks[k], 'function')) {
                    k++;
                    if (toks[k] && toks[k].type === 'name') k++;
                }
            } else {
                continue;
            }
            // Parameters: one name, or a group.
            const params = new Set();
            if (toks[k] && toks[k].type === 'name' && isPunct(toks[k + 1], '=>')) {
                params.add(toks[k].value);
                k += 2;
            } else if (isPunct(toks[k], '(')) {
                const bindings = plainParameters(toks, k);
                if (!bindings) continue;
                for (const p of bindings.names) params.add(p);
                k = bindings.end;
                if (isPunct(toks[k], '=>')) k++;
            } else {
                continue;
            }
            let body = toks.slice(k);
            if (isPunct(body[0], '{') && isPunct(body[body.length - 1], '}')) body = body.slice(1, -1);
            // One function, nothing after it (a declaration list or a call on it is not a plain function).
            if (!body.length || depthBefore(toks, toks.length) !== 0) continue;
            candidates.set(name, { params, body });
        }
        const pure = new Set();
        for (let changed = true; changed;) {
            changed = false;
            for (const [name, fn] of candidates) {
                if (pure.has(name)) continue;
                if (pureExpression(fn.body, false, { fns: pure, params: fn.params, locals: true })) {
                    pure.add(name);
                    changed = true;
                }
            }
        }
        return pure;
    }

    /**
     * The names a parameter list starting at toks[open] ("(") binds, and the
     * index after its ")", when binding them runs no code: only names,
     * destructuring brackets, renames (key: name), rest (...) and commas.
     * A default value (x = ..., also inside a pattern) or a computed key
     * ({ [expr]: x }) runs when the function is called, and anything else
     * is not read here: then null, and the function is not counted as pure.
     */
    function plainParameters(toks, open) {
        const names = [];
        const stack = [];
        for (let k = open; k < toks.length; k++) {
            const t = toks[k];
            const prev = toks[k - 1];
            if (t.type === 'punct' && OPENERS.has(t.value)) {
                if (k > open && t.value === '(') return null;
                // [ directly after { or , in an object pattern opens a computed key.
                if (t.value === '[' && stack[stack.length - 1] === '{' && (isPunct(prev, '{') || isPunct(prev, ','))) return null;
                stack.push(t.value);
            } else if (t.type === 'punct' && CLOSERS.has(t.value)) {
                stack.pop();
                if (stack.length === 0) return { names, end: k + 1 };
            } else if (t.type === 'name' && !t.prop) {
                // In an object pattern, a name before ":" is the key read, not a binding.
                if (!(stack[stack.length - 1] === '{' && isPunct(toks[k + 1], ':'))) names.push(t.value);
            } else if (!(isPunct(t, ',') || isPunct(t, ':') || isPunct(t, '...'))) {
                return null;
            }
        }
        return null;
    }

    /** Bracket depth before token k. */
    function depthBefore(toks, k) {
        let depth = 0;
        for (let j = 0; j < k; j++) {
            if (toks[j].type !== 'punct') continue;
            if (OPENERS.has(toks[j].value)) depth++;
            else if (CLOSERS.has(toks[j].value)) depth--;
        }
        return depth;
    }

    /** See pureDeclaration: whether evaluating these tokens can only build a value. */
    function pureExpression(toks, streams = false, ctx = {}) {
        if (!toks.length) return true;
        // A function value: its body runs only when it is called.
        const f = isWord(toks[0], 'async') ? 1 : 0;
        if (isWord(toks[f], 'function')) return true;
        if (toks[f] && toks[f].type === 'name' && isPunct(toks[f + 1], '=>')) return true;
        if (isPunct(toks[f], '(')) {
            let depth = 0;
            let close = -1;
            for (let j = f; j < toks.length; j++) {
                if (toks[j].type !== 'punct') continue;
                if (OPENERS.has(toks[j].value)) depth++;
                else if (CLOSERS.has(toks[j].value) && --depth === 0) { close = j; break; }
            }
            // (params) => body: an arrow function's body reaches the end of the initialiser.
            if (close > 0 && isPunct(toks[close + 1], '=>')) return true;
        }
        // Parameters of arrow functions inside (x => x.fast(2)): pattern methods on them are fine.
        const params = new Set();
        for (let k = 0; k < toks.length; k++) {
            if (!isPunct(toks[k], '=>')) continue;
            if (toks[k - 1] && toks[k - 1].type === 'name') params.add(toks[k - 1].value);
            else if (isPunct(toks[k - 1], ')')) {
                for (let j = k - 2, d = 0; j >= 0; j--) {
                    if (isPunct(toks[j], ')')) d++;
                    else if (isPunct(toks[j], '(')) { if (d === 0) break; d--; }
                    else if (toks[j].type === 'name' && !toks[j].prop) params.add(toks[j].value);
                }
            }
        }
        const patternMethods = new Set(Object.getOwnPropertyNames(PatternBuilder.prototype));
        // ctx.fns: the code's own functions found pure (see pureFunctions); ctx.params: names a function body may use freely.
        if (ctx.params) for (const name of ctx.params) params.add(name);
        const callable = (name) => (ctx.fns && ctx.fns.has(name))
            || (TIDAL_GLOBALS.has(name) && (!COMMAND_GLOBALS.has(name) || (streams && STREAM_GLOBALS.has(name))));
        const allowedRoot = (name) => params.has(name) || callable(name);
        // The name a member chain starts from (a.b(c).d -> a), or null when it is not a plain name.
        const rootOf = (k) => {
            let j = k;
            for (;;) {
                if (!(isPunct(toks[j - 1], '.') || isPunct(toks[j - 1], '?.'))) return toks[j] && toks[j].type === 'name' ? toks[j].value : null;
                let r = j - 2;
                if (isPunct(toks[r], ')')) {
                    for (let d = 0; r >= 0; r--) {
                        if (isPunct(toks[r], ')')) d++;
                        else if (isPunct(toks[r], '(') && --d === 0) break;
                    }
                    r--;
                }
                if (!toks[r] || toks[r].type !== 'name') return null;
                j = r;
            }
        };
        for (let k = 0; k < toks.length; k++) {
            const t = toks[k];
            const prev = toks[k - 1];
            if (t.type === 'punct' && WRITES.has(t.value)) {
                // In a function body, declaring a local (const x = ...) is not a write outside it.
                const local = ctx.locals && isPunct(t, '=') && prev && prev.type === 'name' && !prev.prop
                    && (isWord(toks[k - 2], 'const') || isWord(toks[k - 2], 'let') || isWord(toks[k - 2], 'var'));
                if (!local) return false;
                params.add(prev.value);
                continue;
            }
            if (isWord(t) && ['new', 'delete', 'await', 'yield', 'import', 'eval'].includes(t.value)) return false;
            if (t.type === 'tpl' && (t.value.includes('${') || (prev && (prev.type === 'name' || isPunct(prev, ')') || isPunct(prev, ']'))))) return false;
            if (!isPunct(t, '(') || !prev) continue;
            if (prev.type === 'name' && !prev.prop) {
                if (['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'void', 'in', 'of', 'case'].includes(prev.value)) continue;
                if (!callable(prev.value)) return false; // another function: it may write
            } else if (prev.type === 'name' && prev.prop) {
                if (!patternMethods.has(prev.value) || (COMMAND_METHODS.has(prev.value) && !(streams && prev.value === 'play'))) return false;
                const root = rootOf(k - 1);
                if (!root || !allowedRoot(root)) return false; // a method of some object: it may write
            } else if (isPunct(prev, ')') || isPunct(prev, ']')) {
                return false; // calling what a call returned
            }
        }
        return true;
    }

    /** The index of the bracket closing the one at `open`, skipping strings; -1 if none. */
    function matchingBracket(text, open) {
        let depth = 0;
        let quote = null;
        for (let i = open; i < text.length; i++) {
            const c = text[i];
            if (quote) {
                if (c === '\\') i++;
                else if (c === quote) quote = null;
            } else if (c === '"' || c === "'" || c === '`') quote = c;
            else if ('([{'.includes(c)) depth++;
            else if (')]}'.includes(c) && --depth === 0) return i;
        }
        return -1;
    }

    /**
     * What a stream's code depends on, for live updates: a function giving,
     * for the statement that made a pattern, a key made of that statement,
     * every declaration it uses (and those they use, in turn), and every
     * statement that is neither a declaration nor makes a pattern (setCPS,
     * an assignment, a loop: any of them may change what the stream plays).
     * The same key means the stream is demonstrably unchanged.
     */
    function streamSources(statements, producing) {
        const info = statements.map((s) => {
            const decl = BINDING.test(s.text);
            return { text: s.text, decl, ids: identifiersIn(s.text), names: decl ? declaredNames(s.text) : [] };
        });
        // When the reading is not certain, no stream is kept: a declaration whose names were not
        // all found in it, escaped names (written with a backslash-u escape), or names that reach variables dynamically.
        const uncertain = info.some((s) => (s.decl && (!s.names.length || s.names.some((name) => !s.ids.includes(name))))
            || /\\u/.test(s.text) || s.ids.some((id) => DYNAMIC_SCOPE.has(id)));
        if (uncertain) return () => '\u0000uncertain' + Math.random();
        const declaredBy = new Map();
        info.forEach((s, j) => {
            for (const name of s.names) {
                if (!declaredBy.has(name)) declaredBy.set(name, []);
                declaredBy.get(name).push(j);
            }
        });
        const others = [];
        // A declaration whose initialiser may write (an unused one too) counts like any other statement, and so
        // does a statement making another stream when it may write something besides making its stream.
        // Calling one of the code's own functions that only compute is not a write.
        const fns = pureFunctions(info.filter((s) => s.decl).map((s) => s.text));
        info.forEach((s, j) => {
            if (!s.text.trim()) return;
            if (producing.has(j)) {
                if (!pureExpression(scanTokens(s.text, 0, false).tokens, true, { fns })) others.push(j);
            } else if (!s.decl || !pureDeclaration(s.text, { fns })) {
                others.push(j);
            }
        });
        const cache = new Map();
        return (k) => {
            if (cache.has(k)) return cache.get(k);
            if (!info[k]) return '\u0000unknown' + Math.random(); // never the same: such a stream always counts as changed
            // The statement, the others (each may write anything), and everything any of them uses.
            const seen = new Set([k, ...others]);
            const queue = [k, ...others];
            while (queue.length) {
                const j = queue.pop();
                for (const id of info[j].ids) {
                    for (const d of declaredBy.get(id) || []) {
                        if (!seen.has(d)) {
                            seen.add(d);
                            queue.push(d);
                        }
                    }
                }
            }
            const key = [...seen].sort((a, b) => a - b).map((j) => (j === k ? '\u0002' : '') + info[j].text.trim()).join('\u0000');
            cache.set(k, key);
            return key;
        };
    }

    /** Only the events that start before `end`; nothing is queried after it. */
    function eventsBefore(pattern, end) {
        return pattern._derive((b, e) => (b >= end ? [] : pattern.query(b, Math.min(e, end))));
    }

    /** Only the events that start at or after `start`. */
    function eventsFrom(pattern, start) {
        return pattern._derive((b, e) => (e <= start ? [] : pattern.query(Math.max(b, start), e)));
    }

    /** Multiplies each event's gain by gainAt(its onset). */
    function gainOver(pattern, gainAt) {
        return pattern._derive((b, e) => pattern.query(b, e).map((ev) => {
            const o = asObject(ev.value);
            return { ...ev, value: { ...o, gain: (isNum(o.gain) ? o.gain : 1) * gainAt(ev.begin) } };
        }));
    }

    /** Degrades events at random, keeping each with probability keepAt(its onset), as Tidal's fadeInFrom does. */
    function thinOver(pattern, keepAt) {
        return pattern._filter((ev) => timeRand(ev.begin) >= 1 - keepAt(ev.begin));
    }

    /** Tidal's filterWhen on onsets: only the events whose start passes test. */
    function filterWhen(pattern, test) {
        return pattern._filter((ev) => test(ev.begin));
    }

    /**
     * Tidal's _wash fout fin delay durin durout now (new : old): the old
     * pattern until now + delay, fout(old) for durin cycles, fin(new) for
     * durout cycles, then the new pattern.
     */
    function washPattern(fout, fin, delay, durin, durout, now, next, prev) {
        const a = now + delay;
        const b = a + durin;
        const c = b + durout;
        return stackPatterns(next.tidal, [
            filterWhen(prev, (t) => t < a),
            filterWhen(fout(prev), (t) => t >= a && t < b),
            filterWhen(fin(next), (t) => t >= b && t < c),
            filterWhen(next, (t) => t >= c),
        ]);
    }
    const nextSam = (t) => Math.floor(t) + 1;

    // Transitions: functions of (now, next, previous) giving the pattern to
    // play, as in Tidal's Transition.hs. A stream with no history starts from
    // silence, as Tidal's does.
    const TRANSITIONS = {
        /** Equal-power crossfade over t cycles: the new pattern's gain * envEqR, the old one's * envEq. */
        xfadeIn: (t) => (now, next, prev) => {
            const x = (c) => clamp((c - now) / t, 0, 1);
            return stackPatterns(next.tidal, [
                gainOver(next, (c) => Math.sqrt(Math.sin((Math.PI / 2) * x(c)))),
                gainOver(prev, (c) => Math.sqrt(Math.cos((Math.PI / 2) * x(c)))),
            ]);
        },
        /** Tidal's _jumpIn n = _wash id id n 0 0: switch exactly n cycles from now. */
        jumpIn: (n) => (now, next, prev) => washPattern((x) => x, (x) => x, n, 0, 0, now, next, prev),
        /** Tidal's jumpIn': switch n cycles after the next cycle starts. */
        jumpInNext: (n) => (now, next, prev) => washPattern((x) => x, (x) => x, nextSam(now) - now + n, 0, 0, now, next, prev),
        /** Tidal's jumpMod: jumpIn' ((n - 1) - (floor now mod n)), the next cycle divisible by n after this one. */
        jumpMod: (n, offset = 0) => (now, next, prev) =>
            TRANSITIONS.jumpInNext((n - 1) - mod(Math.floor(now), n) + offset)(now, next, prev),
        /** Tidal's clutchIn: overlay (fadeOutFrom now t old) (fadeInFrom now t new). */
        clutchIn: (t) => (now, next, prev) => stackPatterns(next.tidal, [prev.fadeOutFrom(now, t), next.fadeInFrom(now, t)]),
        /**
         * Tidal's anticipateIn: washIn over t cycles, the old pattern stuttered
         * (stut 8 0.2 v) with v falling from 1 to 0, then the new pattern.
         */
        anticipateIn: (t) => (now, next, prev) => {
            const cache = new Map();
            const stuttered = prev._derive((b, e) => eachCycle(b, e, (c, s, u) => {
                if (!cache.has(c)) {
                    if (cache.size > 64) cache.clear();
                    const v = 1 - clamp((c - now) / t, 0, 1);
                    cache.set(c, v > 0 ? prev._stut(8, 0.2, v) : prev);
                }
                return cache.get(c).query(s, u);
            }));
            return washPattern(() => stuttered, (x) => x, 0, t, 0, now, next, prev);
        },
        /** Tidal's _wait t: silence, then the new pattern from nextSam (now + t - 1). */
        waitIn: (t) => (now, next) => filterWhen(next, (c) => c >= nextSam(now + t - 1)),
        /** Tidal's waitT f t: like wait, then the transition f applied at now + t. */
        waitT: (t, transition) => (now, next, prev) => filterWhen(transition(now + t, next, prev), (c) => c >= nextSam(now + t - 1)),
        /** Tidal's mortal: the new pattern until now + life, then fadeOutFrom (now + life) release. */
        mortal: (life, release) => (now, next) => stackPatterns(next.tidal, [
            filterWhen(next, (c) => c < now + life),
            filterWhen(next.fadeOutFrom(now + life, release), (c) => c >= now + life),
        ]),
        /**
         * Tidal's interpolateIn: the new pattern's rhythm where the old one also
         * sounds, numeric controls gliding from the old values to the new over
         * t cycles; controls only the old pattern has are kept (Map.unionWith).
         */
        interpolateIn: (t) => (now, next, prev) => next._derive((b, e) => {
            const out = [];
            for (const ev of next.query(b, e)) {
                const x = clamp((ev.begin - now) / t, 0, 1);
                const olds = prev.query(ev.begin, ev.end).concat(activeAt(prev, ev.begin).filter((o) => o.begin < ev.begin));
                for (const old of olds) {
                    const a = asObject(old.value);
                    const v = { ...a, ...asObject(ev.value) };
                    for (const [key, y] of Object.entries(asObject(ev.value))) {
                        if (isNum(y) && isNum(a[key])) v[key] = y * x + a[key] * (1 - x);
                    }
                    out.push({ begin: ev.begin, end: ev.end, value: v });
                }
            }
            return out;
        }),
        /** Tidal's histpan n: the stream's last n patterns together, panned from left to right. */
        histpan: (n) => (now, next, prev, history) => {
            const list = [next, ...(history || [])].slice(0, Math.max(0, Math.floor(n)));
            if (!list.length) return silence(next.tidal);
            // Tidal pans pattern i at i / n (0 to 1); here pan goes from -1 to 1.
            return stackPatterns(next.tidal, list.map((p, i) => p.pan(2 * (i / list.length) - 1)));
        },
    };

    /** n steps: 0 1 ... n-1 in one cycle. */
    function runPattern(tidal, n) {
        const steps = Math.floor(n);
        if (steps < 1) return silence(tidal);
        return fastcat(tidal, Array.from({ length: steps }, (_, i) => pure(tidal, i)));
    }

    function asObject(v) {
        return v && typeof v === 'object' ? v : { s: v === undefined || v === null ? v : String(v) };
    }

    /**
     * A pattern of one control on its own, as Tidal's n "0 1" or speed 2:
     * each event's value is { [name]: value }. Rests and invalid values are dropped.
     */
    function controlPattern(tidal, name, input) {
        const coerce = CONTROLS[name];
        if (input === undefined || input === null) throw new TypeError(`${name}() needs a value`);
        const values = typeof input === 'number' || typeof input === 'boolean' ? pure(tidal, input) : toRaw(tidal, input, name);
        if (values._signal) {
            return values.withValue((v) => {
                const x = coerce(v, tidal);
                return x === undefined ? {} : { [name]: x };
            });
        }
        return values._derive((b, e) => {
            const out = [];
            for (const ev of values.query(b, e)) {
                const x = coerce(ev.value, tidal);
                if (x !== undefined) out.push({ begin: ev.begin, end: ev.end, value: { [name]: x } });
            }
            return out;
        });
    }

    /** SuperDirt's gain curve: pow(gain, 4), gain from 0 to 2. */
    function gainOf(v) {
        return isNum(v.gain) ? Math.pow(clamp(v.gain, 0, 2), 4) : 1;
    }

    /** Volume factor of SuperDirt's amp control, whose default is 0.4. */
    function ampOf(v) {
        return isNum(v.amp) ? clamp(v.amp, 0, 2) / 0.4 : 1;
    }

    /** SuperDirt's amp * gain^4 for an event, with the synth's own amp (superhoover's 0.1) as the default. */
    function levelOf(def, v) {
        return gainOf(v) * ampOf(isNum(v.amp) || !def || !isNum(def.amp) ? v : { amp: def.amp });
    }

    // How long a MIDI key (midikeys) can be held, in seconds.
    const MIDI_HOLD = 600;

    /** A value for a slider (within its range, on its step) or a toggle (0 or 1); the control's own value when unreadable. */
    function controlValue(c, value) {
        if (c.kind === 'toggle') return value === true || toNumber(value) > 0 ? 1 : 0;
        const x = typeof value === 'boolean' ? (value ? c.max : c.min) : toNumber(value);
        if (x === undefined) return c.value;
        let y = clamp(x, c.min, c.max);
        if (c.step > 0) y = clamp(c.min + Math.round((y - c.min) / c.step) * c.step, c.min, c.max);
        return +y.toFixed(10);
    }

    // ==================================================================
    // Pattern constructors and combinators
    // ==================================================================

    function silence(tidal) {
        const p = new PatternBuilder(tidal, () => []);
        p._steps = 1; // Tidal: silence has steps 1
        return p;
    }

    /** Tidal's ^name in mini-notation: one event per cycle with the value set by setBus(name), else silence. */
    function busValue(tidal, name) {
        const p = new PatternBuilder(tidal, (b, e) => {
            LIVE_READS.count++;
            const v = tidal ? tidal.buses.get(String(name)) : undefined;
            if (v === undefined) return [];
            const out = [];
            for (let c = Math.ceil(b); c < e; c++) out.push({ begin: c, end: c + 1, value: v });
            return out;
        });
        p._steps = 1;
        return p;
    }

    /** One event per cycle carrying `value`. */
    function pure(tidal, value) {
        const p = new PatternBuilder(tidal, (b, e) => {
            const out = [];
            for (let c = Math.ceil(b); c < e; c++) out.push({ begin: c, end: c + 1, value });
            return out;
        });
        p._steps = 1;
        return p;
    }

    /** Sets the steps of a pattern (Tidal's setSteps) and returns it. */
    function withSteps(pattern, steps) {
        pattern._steps = Number.isFinite(steps) && steps > 0 ? steps : undefined;
        return pattern;
    }

    const gcd = (a, b) => (b ? gcd(b, a % b) : a);

    /** Least common multiple of step counts, when all are whole numbers. */
    function lcmSteps(list) {
        if (!list.length || !list.every((x) => Number.isInteger(x) && x > 0)) return undefined;
        return list.reduce((a, b) => (a * b) / gcd(a, b));
    }

    /** A continuous pattern: fn(time) gives the value at any time. */
    function signal(tidal, fn) {
        const p = new PatternBuilder(tidal, () => []);
        p._signal = fn;
        return p;
    }

    // Reads of live inputs (sliders, toggles, MIDI, OSC, buses), counted so
    // that follow() can tell whether its signal depends on one: such voices
    // are laid out again when an input changes while they sound.
    const LIVE_READS = { count: 0 };

    // The MIDI key ("channel:note") of the midikeys() voice whose signals are
    // being read, so that keytouch() reads that key's own pressure.
    const KEY_CONTEXT = { key: null };

    /** Runs fn with KEY_CONTEXT set to `key`. */
    function withKey(key, fn) {
        const saved = KEY_CONTEXT.key;
        KEY_CONTEXT.key = key === undefined ? null : key;
        try {
            return fn();
        } finally {
            KEY_CONTEXT.key = saved;
        }
    }

    /** A signal of a live input (slider, toggle, midicc, midibend, miditouch, oscIn, bus). */
    function liveSignal(tidal, fn) {
        return signal(tidal, (t) => {
            LIVE_READS.count++;
            return fn(t);
        });
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
        if (typeof arg === 'string' && /^\s*[^\s<>\[\]{}]+\s*$/.test(arg) && ratioValue(arg) !== undefined) {
            return apply(pattern, ratioValue(arg));
        }
        const values = toRaw(pattern.tidal, arg, fname);
        if (!values._signal) {
            for (const ev of values.query(0, 4)) {
                if (ratioValue(ev.value) === undefined) {
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
                const x = ratioValue(part.value);
                if (lo >= hi || x === undefined) continue;
                for (const ev of at(x).query(lo, hi)) out.push(ev);
            }
            return out;
        }));
    }

    /** Repeats each event n times within its own span. */
    function plyPattern(pattern, n) {
        if (!(n > 0)) return silence(pattern.tidal);
        if (n === 1) return pattern;
        // Tidal: squeezeJoin $ _fast n . pure <$> pat (a last, partial repeat is cut at the event's end).
        const p = squeezeJoin(pattern.tidal, pattern, (v) => fastPattern(pure(pattern.tidal, v), n));
        p._steps = pattern._steps;
        return p;
    }

    /** Starts each cycle (cycle mod n)/n later into the pattern; backwards the other way. */
    function iterPattern(pattern, n, backwards) {
        const parts = Math.floor(n);
        if (parts < 1) return pattern;
        // Tidal: slowcat [rotL (i/n) p | i <- [0 .. n-1]] (rotR for iter'), so each
        // cycle of the pattern is heard n times, once per starting point.
        const p = slowcat(pattern.tidal, Array.from({ length: parts }, (_, i) =>
            shiftPattern(pattern, (backwards ? 1 : -1) * (i / parts))));
        p._steps = pattern._steps;
        return p;
    }

    /** Repeats the first `fraction` of each cycle to fill it; a negative fraction takes the end. */
    function lingerPattern(pattern, fraction) {
        if (fraction === 0) return silence(pattern.tidal);
        if (fraction === 1) return pattern;
        // Tidal: _linger n p | n < 0 = _fast (1/n) $ zoomArc (Arc (1 + n) 1) p
        //                    | otherwise = _fast (1/n) $ zoomArc (Arc 0 n) p
        const zoomed = fraction < 0 ? zoomPattern(pattern, 1 + fraction, 1) : zoomPattern(pattern, 0, fraction);
        const p = signedFast(zoomed, 1 / fraction);
        p._steps = pattern._steps;
        return p;
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
            // Position within the source cycle, 0 to 1. Rounding errors (in
            // cycle 1, 1 + 12/28 - 1 - 12/28 is not 0) are snapped to the
            // edges, so a step that starts exactly there is not lost, and no
            // event of the next cycle slips in.
            const rel = (x) => {
                const r = (x - c - a) / span;
                if (Math.abs(r) < 1e-9) return 0;
                if (Math.abs(r - 1) < 1e-9) return 1;
                return clamp(r, 0, 1);
            };
            const from = c + rel(lo);
            const to = c + rel(hi);
            if (from >= to) return [];
            const fromSrc = (x) => c + a + (x - c) * span;
            return pattern.query(from, to).map(
                (ev) => ({ begin: fromSrc(ev.begin), end: fromSrc(ev.end), value: ev.value })
            );
        }));
    }

    /** Removes events at random: an event goes when rand (shifted by seed, as ? does) at its start is below amount. */
    function degradePattern(pattern, amount, seed = 0) {
        return pattern._filter((ev) => timeRand(ev.begin, seed) >= amount);
    }

    /**
     * degradeBy and unDegradeBy: keep(r, x) decides from rand at each event's
     * start and the amount there (a number, a pattern or a signal).
     */
    function degradeWith(pattern, fname, amount, keep) {
        if (typeof amount === 'number' || (typeof amount === 'string' && toNumber(amount) !== undefined && /^\s*-?[\d.]+\s*$/.test(amount))) {
            const x = clamp(requireNumber(fname, amount), 0, 1);
            return pattern._filter((ev) => keep(timeRand(ev.begin), x));
        }
        const amounts = toRaw(pattern.tidal, amount, fname);
        return pattern._filter((ev) => {
            const hit = eventAt(amounts, ev.begin);
            const x = hit ? toNumber(hit.value) : undefined;
            return x !== undefined && keep(timeRand(ev.begin), clamp(x, 0, 1));
        });
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
        return withSteps(new PatternBuilder(tidal, (b, e) => {
            const out = [];
            for (const p of patterns) {
                for (const ev of p.query(b, e)) out.push(ev);
            }
            return out;
        }), lcmSteps(patterns.map((p) => p._steps)));
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
        if (patterns.length === 1) return patterns[0];
        const steps = patterns.every((p) => p._steps > 0) ? patterns.reduce((sum, p) => sum + p._steps, 0) : undefined;
        // fastPattern returns a new pattern here (n >= 2), so setting its steps is safe.
        return withSteps(fastPattern(slowcat(tidal, patterns), patterns.length), steps);
    }

    /** Like fastcat, but each step has a relative length: [{ pattern, weight }]. */
    function timecat(tidal, steps) {
        if (steps.length === 0) return silence(tidal);
        const total = steps.reduce((sum, s) => sum + s.weight, 0);
        if (steps.length === 1) return steps[0].pattern;
        if (steps.every((s) => s.weight === 1)) {
            const cat = fastPattern(slowcat(tidal, steps.map((s) => s.pattern)), steps.length);
            return withSteps(new PatternBuilder(tidal, (b, e) => cat.query(b, e)), total);
        }
        let pos = 0;
        const parts = steps.map((s) => {
            const a = pos / total;
            pos += s.weight;
            return compressPattern(s.pattern, a, pos / total);
        });
        // The steps of a timecat are the total of its weights.
        return withSteps(stackPatterns(tidal, parts), total);
    }

    /**
     * Tidal's randcat: each cycle, slowcat of the patterns shifted by a random
     * number of cycles (irand n at the cycle's start), so a pattern keeps
     * moving through its own cycles at random.
     */
    function randcat(tidal, patterns) {
        const n = patterns.length;
        if (n === 0) return silence(tidal);
        const cat = slowcat(tidal, patterns);
        return new PatternBuilder(tidal, (b, e) => eachCycle(b, e, (c, s, t) => {
            const i = Math.floor(timeRand(c) * n);
            return cat.query(s + i, t + i).map((ev) => ({ begin: ev.begin - i, end: ev.end - i, value: ev.value }));
        }));
    }

    /**
     * The mini-notation's | : one of the patterns per cycle, chosen by rand
     * (shifted by the seed) at the cycle's start; it plays its cycle c.
     */
    function chooseCycle(tidal, patterns, seed) {
        const n = patterns.length;
        if (n === 0) return silence(tidal);
        return new PatternBuilder(tidal, (b, e) => eachCycle(b, e, (c, s, t) =>
            patterns[mod(Math.floor(timeRand(c, seed) * n), n)].query(s, t)
        ));
    }

    function euclidPattern(tidal, pattern, k, n, rotation = 0) {
        const steps = Math.floor(n);
        if (steps < 1) return silence(tidal);
        let bools = bjorklund(Math.abs(k), steps);
        if (k < 0) bools = bools.map((x) => !x);
        // Tidal: _euclidOff n k s p = rotL (s % k) (_euclid n k p), with steps k.
        const p = shiftPattern(fastcat(tidal, bools.map((on) => (on ? pattern : silence(tidal)))), -Math.floor(rotation) / steps);
        return withSteps(new PatternBuilder(tidal, (b, e) => p.query(b, e)), steps);
    }

    /**
     * Tidal's arpeggiate: the events that share a whole (a chord) play one
     * after another across it, in the order the pattern gives them.
     */
    function arpeggiateEvents(pattern) {
        return pattern._derive((b, e) => {
            const groups = new Map();
            for (const ev of pattern.query(Math.floor(b) - 1, e)) {
                const key = `${ev.begin}:${ev.end}`;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(ev);
            }
            const out = [];
            for (const group of groups.values()) {
                const step = (group[0].end - group[0].begin) / group.length;
                group.forEach((ev, i) => {
                    const begin = ev.begin + i * step;
                    if (begin >= b && begin < e) out.push({ begin, end: begin + step, value: ev.value });
                });
            }
            return out;
        });
    }

    /** Tidal's mergePlayRange: a slice (b, e) taken within the event's own begin..end (0..1 when unset). */
    function mergePlayRange(v, b, e) {
        const b0 = isNum(v.begin) ? v.begin : 0;
        const e0 = isNum(v.end) ? v.end : 1;
        const d = e0 - b0;
        return { ...v, begin: b0 + b * d, end: b0 + e * d };
    }

    /** fast, with a negative factor reversing the pattern as in Tidal. */
    function signedFast(pattern, f) {
        if (f < 0) return fastPattern(pattern, -f).rev();
        return fastPattern(pattern, f);
    }

    /** Haskell's round: halves go to the even neighbour. */
    function roundHalfEven(x) {
        const r = Math.round(x);
        return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
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
        const tokens = tokenizeMini(src);
        let pos = 0;
        // As in Tidal, each ? and | of a string gets the next seed, from 0,
        // so the same string always makes the same random choices.
        let seeds = 0;
        const newSeed = () => seeds++;
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
            const x = t && t.type === 'word' ? ratioValue(t.v) : undefined;
            if (x === undefined) fail('expected a number');
            return x;
        };
        const attachedNumber = () => {
            const t = peek();
            return t && t.type === 'word' && !t.spaceBefore && ratioValue(t.v) !== undefined;
        };
        const isWord = (t) => t && t.type === 'word';

        function word(w) {
            // Tidal: "-" is a rest too, and ^name reads a value set from outside (setBus here).
            if (w === '-') return silence(tidal);
            if (w.length > 1 && w[0] === '^') return busValue(tidal, w.slice(1));
            const joined = /^([^.]+)\.\.([^.]+)$/.exec(w);
            if (joined) return rangePattern(joined[1], joined[2]);
            if (w.includes("'")) {
                const notes = parseChord(w);
                if (notes) {
                    if (!knownChord(w) && tidal) tidal._warnOnce(`Unknown chord "${w.split("'")[1]}" (its root plays alone, as in Tidal)`);
                    return stackPatterns(tidal, notes.map((n) => pure(tidal, n)));
                }
            }
            // Fractions such as 1%3 are numbers, as in Tidal.
            if (/^-?\d+(\.\d+)?%\d+(\.\d+)?$/.test(w)) return pure(tidal, ratioValue(w));
            return pure(tidal, w);
        }

        /**
         * Tidal's "a .. b": one step holding the values from a to b (note
         * names count in semitones from c, as n does); other words are just
         * the two of them.
         */
        function rangePattern(a, b) {
            const value = (x) => {
                if (/^-?\d+(\.\d+)?$/.test(x)) return parseFloat(x);
                const midi = noteNameToMidi(x);
                return midi === undefined ? undefined : midi - 60;
            };
            const lo = value(a);
            const hi = value(b);
            if (lo === undefined || hi === undefined) return fastcat(tidal, [pure(tidal, a), pure(tidal, b)]);
            // Haskell's enumFromTo, counting down by reversing when a > b.
            const up = (from, to) => {
                const out = [];
                for (let x = from; x <= to + (Number.isInteger(from) && Number.isInteger(to) ? 0 : 0.5) + 1e-9 && out.length < 1000; x++) out.push(x);
                return out;
            };
            const values = lo <= hi ? up(lo, hi) : up(hi, lo).reverse();
            return fastcat(tidal, values.map((x) => pure(tidal, x)));
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
                // Tidal: a polyrhythm with one step per cycle, so <a b c> plays one
                // step per cycle and its weights count (<a@3 b> is a for 3 cycles).
                const layers = parseLayers('>');
                expect('>');
                return polyrhythm(layers, () => 1);
            }
            if (t.v === '{') {
                // Tidal: the steps per cycle are %n, or the first layer's total weight.
                const layers = parseLayers('}');
                expect('}');
                let rate = null;
                if (peek() && peek().v === '%' && !peek().spaceBefore) {
                    next();
                    rate = numberOrPattern();
                }
                return polyrhythm(layers, (totals) => (rate === null ? totals[0] : rate));
            }
            if (t.type === 'word') return word(t.v);
            return fail(`unexpected "${t.v}"`);
        }

        // A number, or a pattern of numbers in < >, [ ] or { }, as in "bd*<2 3>" or "bd(<3 5>,8)".
        const numberOrPattern = () => {
            const t = peek();
            if (t && t.type === 'sym' && (t.v === '<' || t.v === '[' || t.v === '{')) return parseAtom();
            return number();
        };

        // An argument of ( , , ): a number, or a sequence of them ("bd(3 5,8)"), as in Tidal.
        const euclidArgument = () => {
            const t = peek();
            const after = tokens[pos + 1];
            if (isWord(t) && after && (after.v === ',' || after.v === ')')) return number();
            if (t && t.type === 'sym' && (t.v === '<' || t.v === '[' || t.v === '{') && after) {
                // a single bracketed pattern
                const start = pos;
                const atom = parseAtom();
                if (peek() && (peek().v === ',' || peek().v === ')')) return atom;
                pos = start;
            }
            const groups = parseSequence(')');
            return sequence(groups);
        };

        /** A polyrhythm (< > or { }): each layer's weighted steps, played at rate(totals) steps per cycle. */
        function polyrhythm(layers, rate) {
            const seqs = layers.items.map((groups) => flatSteps(groups)).filter((steps) => steps.length);
            if (!seqs.length) return silence(tidal);
            const totals = seqs.map((steps) => steps.reduce((sum, st) => sum + st.weight, 0));
            const r = rate(totals);
            const parts = seqs.map((steps, i) => {
                const q = timecat(tidal, steps);
                const pattern = typeof r === 'number'
                    ? fastPattern(q, r / totals[i])
                    : patterned(q, 'polymeter', r, (x, k) => fastPattern(x, k / totals[i]));
                return withSteps(wrap(pattern), totals[i]);
            });
            if (layers.mode === '|') return withSteps(wrap(chooseCycle(tidal, parts, newSeed())), 1);
            return withSteps(wrap(stackPatterns(tidal, parts)), lcmSteps(totals.map((x) => Math.round(x * 1e6) / 1e6)));
        }

        function parseTerm() {
            let p = parseAtom();
            let weight = 1;
            let copies = 1;
            while (peek() && !peek().spaceBefore && '*/!@?('.includes(peek().v)) {
                const op = next().v;
                if (op === '*') {
                    const f = numberOrPattern();
                    p = typeof f === 'number' ? fastPattern(p, f) : patterned(p, 'fast', f, fastPattern);
                } else if (op === '/') {
                    const f = numberOrPattern();
                    const slowBy = (q, x) => (x > 0 ? fastPattern(q, 1 / x) : silence(tidal));
                    p = typeof f === 'number' ? slowBy(p, f) : patterned(p, 'slow', f, slowBy);
                } else if (op === '!') copies += attachedNumber() ? number() - 1 : 1;
                else if (op === '@') weight += (attachedNumber() ? number() : 2) - 1;
                else if (op === '?') p = degradePattern(p, attachedNumber() ? number() : 0.5, newSeed());
                else if (op === '(') {
                    const k = euclidArgument();
                    expect(',');
                    const n = euclidArgument();
                    let rotation = 0;
                    if (peek() && peek().v === ',') {
                        next();
                        rotation = euclidArgument();
                    }
                    expect(')');
                    const args = [k, n, rotation];
                    p = args.every((a) => typeof a === 'number')
                        ? euclidPattern(tidal, p, k, n, rotation)
                        : patternedAll(p, 'euclid', args, (q, kk, nn, rr) => euclidPattern(tidal, q, kk, nn, rr));
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
                if (t.v === '_' || (t.v === '@' && (t.spaceBefore || (tokens[pos - 1] && tokens[pos - 1].v === '_')))) {
                    // Tidal's pElongate: "_", or "@n" after a space, lengthens the step before.
                    next();
                    if (!current.length) fail(`"${t.v}" needs a step before it`);
                    const extra = t.v === '@' ? (attachedNumber() ? number() : 2) - 1 : 1;
                    current[current.length - 1] = { ...current[current.length - 1], weight: current[current.length - 1].weight + extra };
                    continue;
                }
                if (t.v === '!' && t.spaceBefore) {
                    // Tidal's pRepeat: "!" or "!n" after a space repeats the step before.
                    next();
                    if (!current.length) fail('"!" needs a step before it');
                    const copies = attachedNumber() ? number() - 1 : 1;
                    for (let k = 0; k < copies; k++) current.push({ ...current[current.length - 1] });
                    continue;
                }
                // Tidal's pEnumeration: "a .. b" is one step.
                if (isWord(t) && tokens[pos + 1] && tokens[pos + 1].v === '..' && isWord(tokens[pos + 2])) {
                    const a = next().v;
                    next();
                    const b = next().v;
                    current.push({ pattern: rangePattern(a, b), weight: 1 });
                    continue;
                }
                // A chord whose name (or modifiers) is a pattern: "c'<maj min>", "<c e>'maj".
                if (isWord(t) && t.v.endsWith("'") && tokens[pos + 1] && !tokens[pos + 1].spaceBefore && '<[{'.includes(tokens[pos + 1].v)) {
                    next();
                    const names = parseAtom();
                    let rest = '';
                    if (isWord(peek()) && !peek().spaceBefore && peek().v.startsWith("'")) rest = next().v;
                    current.push({ pattern: chordOf(names, (name) => t.v + name + rest), weight: 1 });
                    continue;
                }
                const before = current.length;
                current.push(...parseTerm());
                // A pattern of roots followed by a chord: "<c e>'maj".
                if (current.length > before && isWord(peek()) && !peek().spaceBefore && peek().v.startsWith("'")) {
                    const suffix = next().v;
                    for (let k = before; k < current.length; k++) {
                        current[k] = { ...current[k], pattern: chordOf(current[k].pattern, (root) => root + suffix) };
                    }
                }
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
            if (layers.mode === '|') return withSteps(wrap(chooseCycle(tidal, patterns, newSeed())), 1);
            return stackPatterns(tidal, patterns);
        }

        /** Chords from a pattern of words: each value v becomes the chord make(v). */
        function chordOf(values, make) {
            return joinOver(tidal, values, (v) => {
                const w = make(String(v));
                const notes = parseChord(w);
                if (!notes) fail(`unknown chord "${w}"`);
                return stackPatterns(tidal, notes.map((n) => pure(tidal, n)));
            });
        }

        /** A new pattern with the same events, so its steps can be set without touching the original. */
        function wrap(p) {
            const w = new PatternBuilder(tidal, (b, e) => p.query(b, e));
            w._steps = p._steps;
            return w;
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

    const DECLARATION = /^(?:const|let|var|function|async\s+function|class|if|for|while|do|switch|try|return|throw|import|export)(?![\w$])/;

    // A small JavaScript tokenizer, enough to find where top-level statements
    // end: strings, template literals (with nested ${...}), regular
    // expressions, comments, numbers, names and punctuators.
    const LINE_BREAK = /[\n\r\u2028\u2029]/;
    const NUMBER = /(?:0[xXoObB][\da-fA-F_]*|\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?/y;
    const PUNCTUATORS = [
        ['>>>='],
        ['...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??='],
        ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'],
    ];
    const OPENERS = new Set(['(', '[', '{']);
    const CLOSERS = new Set([')', ']', '}']);
    // Words after which a "/" starts a regular expression, not a division.
    const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
    // Words that cannot end an expression: the next line continues it.
    const OPERAND_AFTER = new Set(['new', 'typeof', 'void', 'delete', 'await', 'in', 'instanceof', 'extends', 'var', 'let', 'const', 'case']);
    const CONDITION = new Set(['if', 'while', 'for', 'with']);
    const BLOCK_AFTER = new Set(['else', 'do', 'try', 'finally']);

    const isNameStart = (ch) => /[A-Za-z_$#\\]/.test(ch) || (ch > '\x7f' && !/\s/.test(ch));
    const isNamePart = (ch) => /[\w$\\]/.test(ch) || (ch > '\x7f' && !/\s/.test(ch));
    const isWord = (tok, value) => !!tok && tok.type === 'name' && !tok.prop && (value === undefined || tok.value === value);
    const isPunct = (tok, value) => !!tok && tok.type === 'punct' && tok.value === value;

    /**
     * Tokens of code from offset `from`. Each token is { type, value, start,
     * end, nl }: type is name, num, str, tpl, regex or punct, and nl tells
     * that a line break (or a comment spanning lines) comes before it. A
     * template literal is one token. With `nested`, scanning stops at the
     * "}" that closes a template's ${...}; `end` is where scanning stopped.
     */
    function scanTokens(code, from, nested) {
        const tokens = [];
        const stack = []; // open brackets: { value, kind, ctrl, fn }
        let i = from;
        let nl = false;
        // A function or class expression whose parameters or body come next: its body is a value, not a block.
        let pendingFunction = null; // { expr, depth } from "function" up to its "("
        let pendingClass = null;    // { expr, depth } from "class" up to its "{"
        while (i < code.length) {
            const ch = code[i];
            const next = code[i + 1];
            if (ch === '/' && next === '/') {
                while (i < code.length && !LINE_BREAK.test(code[i])) i++;
                continue;
            }
            if (ch === '/' && next === '*') {
                const close = code.indexOf('*/', i + 2);
                const stop = close < 0 ? code.length : close + 2;
                if (LINE_BREAK.test(code.slice(i, stop))) nl = true;
                i = stop;
                continue;
            }
            if (LINE_BREAK.test(ch)) { nl = true; i++; continue; }
            if (/\s/.test(ch)) { i++; continue; }
            if (nested && ch === '}' && stack.length === 0) return { tokens, end: i };

            const prev = tokens[tokens.length - 1];
            const before = tokens[tokens.length - 2];
            const tok = { type: 'punct', value: '', start: i, end: i, nl };
            nl = false;
            if (ch === '"' || ch === "'") {
                let j = i + 1;
                while (j < code.length && code[j] !== ch && !LINE_BREAK.test(code[j])) {
                    if (code[j] === '\\') j += code[j + 1] === '\r' && code[j + 2] === '\n' ? 2 : 1;
                    j++;
                }
                if (code[j] === ch) j++;
                tok.type = 'str';
                i = j;
            } else if (ch === '`') {
                let j = i + 1;
                while (j < code.length) {
                    if (code[j] === '\\') { j += 2; continue; }
                    if (code[j] === '`') { j++; break; }
                    if (code[j] === '$' && code[j + 1] === '{') {
                        j = Math.min(code.length, scanTokens(code, j + 2, true).end + 1);
                        continue;
                    }
                    j++;
                }
                tok.type = 'tpl';
                i = Math.min(j, code.length);
            } else if (ch === '/' && regexAllowed(prev)) {
                let j = i + 1;
                let inClass = false;
                while (j < code.length && !LINE_BREAK.test(code[j])) {
                    const c = code[j];
                    if (c === '\\') { j += 2; continue; }
                    if (c === '[') inClass = true;
                    else if (c === ']') inClass = false;
                    else if (c === '/' && !inClass) break;
                    j++;
                }
                if (code[j] === '/') {
                    j++;
                    while (j < code.length && /[\w$]/.test(code[j])) j++;
                }
                tok.type = 'regex';
                i = Math.min(j, code.length);
            } else if (/\d/.test(ch) || (ch === '.' && /\d/.test(next || ''))) {
                NUMBER.lastIndex = i;
                NUMBER.test(code);
                tok.type = 'num';
                i = Math.max(i + 1, NUMBER.lastIndex);
            } else if (isNameStart(ch)) {
                let j = i + 1;
                while (j < code.length && isNamePart(code[j])) j++;
                tok.type = 'name';
                tok.value = code.slice(i, j);
                // A property name (a.return) is never a keyword.
                tok.prop = isPunct(prev, '.') || isPunct(prev, '?.');
                i = j;
                if (!tok.prop && (tok.value === 'function' || tok.value === 'class')) {
                    // async function: what decides is the token before "async".
                    const lead = isWord(prev, 'async') && !tok.nl ? before : prev;
                    const pending = { expr: expressionPosition(lead), depth: stack.length };
                    if (tok.value === 'function') pendingFunction = pending;
                    else pendingClass = pending;
                }
            } else {
                let value = ch;
                for (const list of PUNCTUATORS) {
                    const candidate = code.slice(i, i + list[0].length);
                    if (list.includes(candidate)) { value = candidate; break; }
                }
                if (value === '?.' && /\d/.test(code[i + 2] || '')) value = '?'; // a ?.5 : b
                tok.value = value;
                i += value.length;
                if (OPENERS.has(value)) {
                    const open = { value, kind: 'expr', ctrl: false, fn: false };
                    if (value === '(') {
                        open.ctrl = (isWord(prev) && CONDITION.has(prev.value)) || (isWord(prev, 'await') && isWord(before, 'for'));
                        // The parameters of a function expression: the body after them is a value.
                        if (pendingFunction && pendingFunction.depth === stack.length) {
                            open.fn = pendingFunction.expr;
                            pendingFunction = null;
                        }
                    } else if (value === '{') {
                        if (pendingClass && pendingClass.depth === stack.length) {
                            open.kind = pendingClass.expr ? 'fexpr' : 'block';
                            pendingClass = null;
                        } else {
                            open.kind = braceKind(prev, before, tok.nl, nested, stack);
                        }
                    }
                    stack.push(open);
                } else if (CLOSERS.has(value)) {
                    const open = stack.pop();
                    if (open) { tok.kind = open.kind; tok.ctrl = open.ctrl; tok.fn = open.fn; }
                } else if (value === '++' || value === '--') {
                    // Postfix only right after an operand on the same line (a\n++b is a; ++b).
                    tok.postfix = !tok.nl && !!prev && ((prev.type === 'name' && !(isWord(prev) && REGEX_AFTER.has(prev.value))) ||
                        isPunct(prev, ')') || isPunct(prev, ']'));
                } else if (value === ':') {
                    const top = stack[stack.length - 1];
                    const statementLevel = top ? top.value === '{' && top.kind !== 'expr' : !nested;
                    tok.label = statementLevel && isWord(prev) && (!before || prev.nl || isPunct(before, ';') ||
                        ((isPunct(before, '{') || isPunct(before, '}')) && before.kind !== 'expr') ||
                        (isPunct(before, ':') && before.label) || (isPunct(before, ')') && before.ctrl));
                }
            }
            tok.end = i;
            if (tok.type !== 'name' && tok.type !== 'punct') tok.value = code.slice(tok.start, tok.end);
            tokens.push(tok);
        }
        return { tokens, end: i };
    }

    // Whether a "/" after the token `prev` starts a regular expression.
    function regexAllowed(prev) {
        if (!prev) return true;
        if (prev.type === 'name') return isWord(prev) && REGEX_AFTER.has(prev.value);
        if (prev.type !== 'punct') return false;
        if (prev.value === ')') return !!prev.ctrl;          // if (x) /re/.test(s)
        // After a block, not an object literal or a function or class expression's body.
        if (prev.value === '}') return prev.kind !== 'expr' && prev.kind !== 'fexpr';
        return !(prev.value === ']' || prev.value === '++' || prev.value === '--');
    }

    // Whether a "function" or "class" after the token `prev` is an expression (a value), not a declaration.
    function expressionPosition(prev) {
        if (!prev) return false;
        if (prev.type === 'punct') {
            if (prev.value === ';') return false;
            if (prev.value === '}') return prev.kind === 'expr' || prev.kind === 'fexpr';
            if (prev.value === '{') return prev.kind === 'expr';
            if (prev.value === ')') return !prev.ctrl;
            if (prev.value === ':') return !prev.label;
            return true; // = ( , [ ? => and operators
        }
        return isWord(prev) && prev.value !== 'else' && prev.value !== 'do' && (REGEX_AFTER.has(prev.value) || OPERAND_AFTER.has(prev.value));
    }

    // What a "{" opens: a block (or class/function body), an arrow
    // function's body, or an expression (object literal, pattern).
    function braceKind(prev, before, nl, nested, stack) {
        if (!prev) return nested ? 'expr' : 'block';
        if (prev.type === 'punct') {
            switch (prev.value) {
                case '=>': return 'arrow';
                case ')': return prev.fn ? 'fexpr' : 'block'; // a function expression's body is a value
                case ';': return 'block';
                case '}': return prev.kind === 'expr' && !nl ? 'expr' : 'block';
                case '{': return prev.kind === 'expr' ? 'expr' : 'block';
                case ':': return prev.label ? 'block' : 'expr';
                default: return 'expr';
            }
        }
        if (isWord(prev) && BLOCK_AFTER.has(prev.value)) return 'block';
        if (isWord(prev) && (REGEX_AFTER.has(prev.value) || OPERAND_AFTER.has(prev.value))) return 'expr';
        // After a name or value: a class body (class A {, extends B {) or a new statement.
        return 'block';
    }

    /**
     * Whether an expression statement goes on across a line break between
     * the tokens a and b, as JavaScript's automatic semicolon insertion
     * decides: it ends only when the line before is complete and the next
     * line cannot continue it.
     */
    function continues(a, b) {
        if (a.type === 'punct') {
            if (a.value === '++' || a.value === '--') {
                if (!a.postfix) return true;
            } else if (!CLOSERS.has(a.value)) {
                return true; // an operator, a comma, => ...
            }
        } else if (isWord(a) && OPERAND_AFTER.has(a.value)) {
            return true;
        }
        // A call, index or tagged template does not follow an arrow function's body.
        const afterArrow = isPunct(a, '}') && a.kind === 'arrow';
        if (b.type === 'tpl') return !afterArrow;
        if (b.type === 'name') return isWord(b, 'in') || isWord(b, 'instanceof');
        if (b.type !== 'punct') return false;
        switch (b.value) {
            case '++': case '--': // restricted: a\n++b is a; ++b
            case '!': case '~': case '{': case '...': case '@':
                return false;
            case '(': case '[':
                return !afterArrow;
            default:
                return true; // . ?. ? : , = and binary operators (also a stray closer)
        }
    }

    /**
     * Splits code into top-level statements, as JavaScript reads them:
     * strings, template literals, regular expressions, comments and
     * brackets are respected, control statements (if/else, loops, try,
     * do...while, labels, switch) and function and class declarations are
     * one statement each, and a line break ends a statement only where
     * JavaScript would insert a semicolon (method chains on new lines
     * starting with "." stay together). Comments between statements are
     * left out.
     */
    function splitStatements(code) {
        return splitStatementRanges(code).map((s) => s.text);
    }

    /**
     * Like splitStatements, with each statement's [start, end) offsets in
     * the source: text is exactly code.slice(start, end), from its first
     * token to its last, without the ";" that ends it.
     */
    function splitStatementRanges(code) {
        const toks = scanTokens(code, 0, false).tokens;
        const n = toks.length;
        const punct = (k, value) => k < n && isPunct(toks[k], value);
        const word = (k, value) => k < n && isWord(toks[k], value);
        // Index after the bracket group that opens at k.
        const group = (k) => {
            let depth = 0;
            for (; k < n; k++) {
                const t = toks[k];
                if (t.type !== 'punct') continue;
                if (OPENERS.has(t.value)) depth++;
                else if (CLOSERS.has(t.value) && --depth <= 0) return k + 1;
            }
            return n;
        };
        const paren = (k) => (punct(k, '(') ? group(k) : k);
        const block = (k) => (punct(k, '{') ? group(k) : k);
        const declaration = (k) => {
            let j = k;
            if (punct(j, '*')) j++;
            if (j < n && toks[j].type === 'name') j++;
            return block(paren(j));
        };
        // An expression statement: up to its ";" or to where a line break ends it.
        const expression = (k) => {
            let depth = 0;
            for (let j = k; j < n; j++) {
                const t = toks[j];
                if (depth === 0 && j > k && t.nl && !continues(toks[j - 1], t)) return j;
                if (t.type !== 'punct') continue;
                if (depth === 0 && t.value === ';') return j + 1;
                if (OPENERS.has(t.value)) depth++;
                else if (CLOSERS.has(t.value)) depth = Math.max(0, depth - 1);
            }
            return n;
        };
        // Index after the statement that starts at k (always more than k).
        const statement = (k) => {
            if (k >= n) return n;
            const t = toks[k];
            const next = k + 1;
            if (punct(k, ';')) return next;
            if (punct(k, '{')) return group(k);
            if (t.type === 'name') {
                switch (t.value) {
                    case 'if': {
                        let j = statement(paren(next));
                        if (word(j, 'else')) j = statement(j + 1);
                        return j;
                    }
                    case 'for':
                        return statement(paren(word(next, 'await') ? next + 1 : next));
                    case 'while':
                    case 'with':
                        return statement(paren(next));
                    case 'do': {
                        let j = statement(next);
                        if (word(j, 'while')) {
                            j = paren(j + 1);
                            if (punct(j, ';')) j++;
                        }
                        return j;
                    }
                    case 'try': {
                        let j = block(next);
                        if (word(j, 'catch')) j = block(paren(j + 1));
                        if (word(j, 'finally')) j = block(j + 1);
                        return j;
                    }
                    case 'switch':
                        return block(paren(next));
                    case 'function':
                        return declaration(next);
                    case 'async':
                        if (word(next, 'function') && !toks[next].nl) return declaration(next + 1);
                        break;
                    case 'class': {
                        let j = next;
                        while (j < n && !punct(j, '{') && !punct(j, ';')) j = OPENERS.has(toks[j].value) && toks[j].type === 'punct' ? group(j) : j + 1;
                        return block(j);
                    }
                    case 'return':
                    case 'throw':
                        // Restricted: a line break right after them ends the statement.
                        return next >= n || toks[next].nl ? next : expression(next);
                    case 'break':
                    case 'continue': {
                        let j = next;
                        if (j < n && toks[j].type === 'name' && !toks[j].nl) j++;
                        return punct(j, ';') ? j + 1 : j;
                    }
                    case 'debugger':
                        return punct(next, ';') ? next + 1 : next;
                    default:
                        if (punct(next, ':')) return statement(next + 1); // a label
                }
            }
            return expression(k);
        };

        const statements = [];
        let k = 0;
        while (k < n) {
            const j = Math.max(k + 1, statement(k));
            let last = j - 1;
            if (punct(last, ';')) last--;
            if (last >= k) {
                const start = toks[k].start;
                const end = toks[last].end;
                statements.push({ text: code.slice(start, end), start, end });
            }
            k = j;
        }
        return mergeWhereNeeded(code, statements);
    }

    /**
     * A safety net for the split: when the whole code is valid JavaScript
     * but a statement on its own is not, the split misread it (a "/" taken
     * for a regular expression, a line break taken for the end), so it is
     * joined with the statements after it until the piece compiles. Valid
     * code is never cut where JavaScript would not cut it; invalid code is
     * left as split, for the error to point at the right statement.
     */
    function mergeWhereNeeded(code, statements) {
        if (statements.every((s) => compiles(s.text)) || !compiles(code)) return statements;
        const out = [];
        for (let i = 0; i < statements.length; i++) {
            let { start, end } = statements[i];
            while (!compiles(code.slice(start, end)) && i + 1 < statements.length) end = statements[++i].end;
            out.push({ text: code.slice(start, end), start, end });
        }
        return out;
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

        // Synths in the style of SuperDirt's (default-synths.scd). The pitch
        // settings are the defaults of their built-in pitch sweep, which
        // penv, pattack, pdecay and pcurve change; pitchenv replaces it.
        supersaw: { type: 'supersaw', freq: 440, decay: 0.6, level: 0.3 },
        supersquare: { type: 'supersquare', freq: 440, decay: 0.6, level: 0.22 },
        superpwm: { type: 'superpwm', freq: 440, decay: 0.6, level: 0.35 },
        // superhoover and supergabber keep SuperCollider's levels: amp works
        // as in SuperCollider (0.1 by default), and curve is the curve of
        // their outer envelope (Env.asr). The hoover's reverb is part of it.
        superhoover: {
            type: 'superhoover', freq: 440, decay: 2, level: 0.4, amp: 0.1, attack: 0, release: 4, curve: 6,
            pitchenv: { levels: [-5, 6, 0], times: [0.1, 1.7], curves: [0, -4] },
            freeverb: { mix: 0.3, room: 0.9, damp: 0.5 },
        },
        superreese: { type: 'superreese', freq: 110, decay: 0.6, level: 0.35 },
        superzow: { type: 'superzow', freq: 440, decay: 0.6, level: 0.3, pitch: { penv: 2, pattack: 0.15, pdecay: 0.25, pcurve: -2 } },
        superchip: { type: 'superchip', freq: 440, decay: 0.4, level: 0.3 },
        superfm: { type: 'superfm', freq: 440, decay: 0.8, level: 0.4 },
        // SuperCollider's SinOscFB: voice is the feedback, from a sine (0) to saw-like (1).
        superfb: { type: 'superfb', freq: 440, decay: 0.6, level: 0.35 },
        superstatic: { type: 'superstatic', freq: 3000, decay: 0.4, level: 0.6 },
        superpiano: { type: 'superpiano', freq: 440, decay: 3, level: 0.45 },
        supergong: { type: 'supergong', freq: 220, decay: 5, level: 0.35 },
        superkick: { type: 'superkick', freq: 55, decay: 0.5, level: 0.9, pitch: { penv: 30, pattack: 0, pdecay: 0.06, pcurve: -4 } },
        super808: { type: 'super808', freq: 48, decay: 1.2, level: 0.9, pitch: { penv: 14, pattack: 0, pdecay: 0.12, pcurve: -3 } },
        superhat: { type: 'superhat', freq: 400, decay: 0.1, level: 0.3 },
        supersnare: { type: 'supersnare', freq: 180, decay: 0.2, level: 0.55 },
        superclap: { type: 'superclap', freq: 1100, decay: 0.3, level: 0.6 },
        // Nathan Ho's gabber kick: a saw falling 4 octaves in 80 ms, distorted,
        // with a chorused high band. freq is the end of the fall (60 Hz).
        supergabber: {
            type: 'supergabber', freq: 60, decay: 0.3, level: 0.4, amp: 0.1, attack: 0.001, release: 0.05, curve: -4,
            pitch: { penv: 48, pattack: 0.001, pdecay: 0.08, pcurve: -1 },
        },
    };

    // Sounds that hold for their whole sustain/legato length (like a synth)
    // instead of decaying (like a drum sample cut short).
    const SUSTAINED_TYPES = new Set([
        'osc', 'noise', 'supersaw', 'supersquare', 'superpwm', 'superhoover', 'superreese', 'superzow',
        'superchip', 'superfm', 'superfb', 'superstatic', 'supergabber',
    ]);

    // General MIDI drum notes, used when exporting or sending drums to MIDI.
    const GM_DRUMS = {
        bd: 36, sn: 38, hh: 42, ch: 42, oh: 46, cp: 39, cy: 49,
        superkick: 36, super808: 36, supergabber: 36, superhat: 42, supersnare: 38, superclap: 39,
    };

    // Controls handled by the AudioWorklet effects (see fxWorkletModule).
    const SPECTRAL_CONTROLS = ['freeze', 'comb', 'smear', 'scram', 'binshift', 'hbrick', 'lbrick'];
    // The spectral effects delay the sound by their analysis window; voices
    // that use them start this much earlier so they stay in time.
    const SPECTRAL_SIZE = 512;
    const SPECTRAL_HOP = 128;

    // Formant frequencies (F1, F2, F3) for each vowel.
    const VOWELS = {
        a: [730, 1090, 2440],
        e: [530, 1840, 2480],
        i: [270, 2290, 3010],
        o: [570, 840, 2410],
        u: [300, 870, 2240],
    };

    // ==================================================================
    // AudioWorklet effects
    // ==================================================================
    //
    // The SuperDirt effects that need sample-by-sample work. This function
    // is never called here: its source is loaded as an AudioWorklet module
    // (see _loadWorklet), where it registers the "tidal-fx" processor. Each
    // node runs one effect, given in processorOptions.kind, on each channel.

    /* global sampleRate, currentTime, registerProcessor, AudioWorkletProcessor */
    function fxWorkletModule() {
        const TAU = Math.PI * 2;
        const clampTo = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

        // SuperCollider's Squiz: each wave cycle (between rising zero
        // crossings) is played back `ratio` times faster, repeated to fill
        // the time of the next one, so the pitch rises and the timing stays.
        class Squiz {
            constructor(o) {
                this.set(o);
                this.rec = [];
                this.play = null;
                this.pos = 0;
                this.prev = 0;
            }
            set(o) {
                this.ratio = Math.max(1, o.squiz);
            }
            step(x) {
                if ((this.prev <= 0 && x > 0 && this.rec.length > 1) || this.rec.length >= 4096) {
                    this.play = Float32Array.from(this.rec);
                    this.rec.length = 0;
                    this.pos = 0;
                }
                this.prev = x;
                this.rec.push(x);
                const play = this.play;
                if (!play) return 0;
                const i = Math.floor(this.pos);
                const f = this.pos - i;
                const y = play[i % play.length] * (1 - f) + play[(i + 1) % play.length] * f;
                this.pos = (this.pos + this.ratio) % play.length;
                return y;
            }
        }

        // SuperCollider's WaveLoss (mode 2): drops `waveloss` out of 100
        // wave cycles at random.
        class WaveLoss {
            constructor(o) {
                this.set(o);
                this.prev = 0;
                this.drop = false;
            }
            set(o) {
                this.p = clampTo(o.waveloss, 0, 100) / 100;
            }
            step(x) {
                if (this.prev <= 0 && x > 0) this.drop = Math.random() < this.p;
                this.prev = x;
                return this.drop ? 0 : x;
            }
        }

        // Second-order all-pass section of a Hilbert transformer.
        class Allpass {
            constructor(a) {
                this.a2 = a * a;
                this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
            }
            step(x) {
                const y = this.a2 * (x + this.y2) - this.x2;
                this.x2 = this.x1; this.x1 = x;
                this.y2 = this.y1; this.y1 = y;
                return y;
            }
        }

        // SuperCollider's FreqShift: single-sideband modulation. Two all-pass
        // chains (Olli Niemitalo's coefficients) give signals 90 degrees
        // apart; mixing them with a quadrature oscillator moves every
        // frequency by `shift` Hz.
        class FreqShift {
            constructor(o) {
                this.set(o);
                this.phase = o.phase || 0;
                this.a = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737].map((c) => new Allpass(c));
                this.b = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278].map((c) => new Allpass(c));
                this.late = 0;
            }
            set(o) {
                this.inc = (TAU * o.shift) / sampleRate;
            }
            step(x) {
                let re = x;
                let im = x;
                for (const f of this.a) re = f.step(re);
                for (const f of this.b) im = f.step(im);
                const quadrature = this.late;
                this.late = im;
                const y = re * Math.cos(this.phase) + quadrature * Math.sin(this.phase);
                this.phase += this.inc;
                if (this.phase > TAU) this.phase -= TAU;
                else if (this.phase < -TAU) this.phase += TAU;
                return y;
            }
        }

        // SuperDirt's octer: the rectified sound (an octave up) crossfaded in
        // by octer, plus flip-flop sub-octaves (one and two octaves down).
        class Octer {
            constructor(o) {
                this.set(o);
                this.k = 1 - Math.exp((-TAU * 440) / sampleRate);
                this.lp = 0; this.prevLp = 0;
                this.ff2 = 0; this.ff3 = 0;
                this.r1 = 0; this.dc = 0;
            }
            set(o) {
                this.up = clampTo(o.octer || 0, 0, 1);
                this.sub = o.octersub || 0;
                this.subsub = o.octersubsub || 0;
            }
            step(x) {
                const r = Math.abs(x);
                this.dc = r - this.r1 + 0.995 * this.dc; // LeakDC
                this.r1 = r;
                const oct1 = 2 * this.dc;
                this.lp += this.k * (x - this.lp);
                if (this.prevLp <= 0 && this.lp > 0) {
                    this.ff2 = 1 - this.ff2;
                    if (this.ff2 === 1) this.ff3 = 1 - this.ff3;
                }
                this.prevLp = this.lp;
                const y = x * (1 - this.up) + this.up * this.up * oct1;
                return y + this.sub * this.ff2 * this.lp + this.subsub * this.ff3 * this.lp;
            }
        }

        // In-place radix-2 FFT (inverse when `inverse`, unscaled).
        function fft(re, im, inverse) {
            const n = re.length;
            for (let i = 1, j = 0; i < n; i++) {
                let bit = n >> 1;
                for (; j & bit; bit >>= 1) j ^= bit;
                j ^= bit;
                if (i < j) {
                    [re[i], re[j]] = [re[j], re[i]];
                    [im[i], im[j]] = [im[j], im[i]];
                }
            }
            for (let len = 2; len <= n; len <<= 1) {
                const ang = (TAU / len) * (inverse ? 1 : -1);
                const wr = Math.cos(ang);
                const wi = Math.sin(ang);
                for (let i = 0; i < n; i += len) {
                    let cr = 1;
                    let ci = 0;
                    for (let k = 0; k < len / 2; k++) {
                        const a = i + k;
                        const b = a + len / 2;
                        const tr = re[b] * cr - im[b] * ci;
                        const ti = re[b] * ci + im[b] * cr;
                        re[b] = re[a] - tr; im[b] = im[a] - ti;
                        re[a] += tr; im[a] += ti;
                        const nr = cr * wr - ci * wi;
                        ci = cr * wi + ci * wr;
                        cr = nr;
                    }
                }
            }
        }

        // SuperDirt's spectral effects (PV_ UGens) on a short-time Fourier
        // transform: freeze, binshift, comb, smear, scram, hbrick, lbrick.
        class Spectral {
            constructor(o) {
                const n = o.size;
                this.n = n;
                this.hop = o.hop;
                this.o = o;
                this.win = Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((TAU * i) / n));
                // Hann analysis and synthesis windows overlapping by n / hop.
                this.norm = 1 / (n * 0.375 * (n / this.hop));
                this.fifoIn = new Float32Array(n);
                this.fifoOut = new Float32Array(n);
                this.acc = new Float32Array(n * 2);
                this.rover = n - this.hop;
                this.re = new Float32Array(n);
                this.im = new Float32Array(n);
                this.half = n / 2;
                this.frozen = null;
                this.heard = 0;   // frames since the sound started (for freeze)
                this.count = 0;   // frames processed (for binshift's phases)
                this.set(o);
            }
            /** The settings that come from the controls (a tied event changes them, the buffers stay). */
            set(o) {
                this.o = o;
                const bins = this.half + 1;
                const binHz = sampleRate / this.n;
                this.shift = o.binshift ? Math.round((o.binshift * 1000) / binHz) : 0;
                this.teeth = o.comb ? Math.max(1, Math.round(1 + o.comb * 31)) : 0;
                this.smearBins = o.smear ? Math.max(1, Math.round(o.smear * 16)) : 0;
                this.lowCut = o.hbrick ? Math.floor(clampTo(o.hbrick, 0, 1) * bins) : 0;
                this.highCut = o.lbrick ? Math.ceil((1 - clampTo(o.lbrick, 0, 1)) * bins) : bins;
                this.perm = null;
                if (o.scram) {
                    // A fixed random swap of bins within a fifth of the spectrum.
                    this.perm = Int32Array.from({ length: bins }, (_, i) => i);
                    const width = Math.max(1, Math.floor(bins * 0.2));
                    for (let i = 0; i < bins; i++) {
                        if (Math.random() >= clampTo(o.scram, 0, 1)) continue;
                        const j = clampTo(i + Math.floor((Math.random() * 2 - 1) * width), 0, bins - 1);
                        [this.perm[i], this.perm[j]] = [this.perm[j], this.perm[i]];
                    }
                }
            }
            step(x) {
                this.fifoIn[this.rover] = x;
                const y = this.fifoOut[this.rover - (this.n - this.hop)];
                this.rover++;
                if (this.rover >= this.n) {
                    this.rover = this.n - this.hop;
                    this.frame();
                }
                return y;
            }
            frame() {
                const { n, hop, half, re, im, win } = this;
                for (let i = 0; i < n; i++) {
                    re[i] = this.fifoIn[i] * win[i];
                    im[i] = 0;
                }
                fft(re, im, false);
                const bins = half + 1;
                let mag = new Float32Array(bins);
                let ph = new Float32Array(bins);
                for (let k = 0; k < bins; k++) {
                    mag[k] = Math.hypot(re[k], im[k]);
                    ph[k] = Math.atan2(im[k], re[k]);
                }
                this.count++;
                if (this.o.freeze > 0) {
                    // Hold the first frame whose window is full of sound: its
                    // magnitudes stay, and each bin's phase keeps advancing by
                    // what it moved between that frame and the next.
                    if (this.heard > 0 || mag.some((m) => m > 1e-4)) this.heard++;
                    const at = this.n / this.hop;
                    if (this.heard === at) this.frozen = { mag: mag.slice(), ph: ph.slice(), step: null };
                    else if (this.heard === at + 1) {
                        this.frozen.step = ph.map((p, k) => p - this.frozen.ph[k]);
                        this.frozen.ph = ph.slice();
                    } else if (this.heard > at + 1) {
                        for (let k = 0; k < bins; k++) this.frozen.ph[k] += this.frozen.step[k];
                    }
                    if (this.heard > at) {
                        mag = this.frozen.mag.slice();
                        ph = this.frozen.ph.slice();
                    }
                }
                if (this.shift) {
                    // Moving a bin by `shift` bins also turns its phase by that
                    // many cycles per frame, so the shifted partial stays steady.
                    const m = new Float32Array(bins);
                    const p = new Float32Array(bins);
                    const turn = (this.count * this.shift * TAU * hop) / n;
                    for (let k = 0; k < bins; k++) {
                        const from = k - this.shift;
                        if (from >= 0 && from < bins) { m[k] = mag[from]; p[k] = ph[from] + turn; }
                    }
                    mag = m; ph = p;
                }
                if (this.teeth) {
                    for (let k = 0; k < bins; k++) if (Math.floor((k * this.teeth * 2) / bins) % 2 === 1) mag[k] = 0;
                }
                if (this.smearBins) {
                    const m = new Float32Array(bins);
                    const r = this.smearBins;
                    for (let k = 0; k < bins; k++) {
                        let sum = 0;
                        let count = 0;
                        for (let j = Math.max(0, k - r); j <= Math.min(bins - 1, k + r); j++) { sum += mag[j]; count++; }
                        m[k] = sum / count;
                    }
                    mag = m;
                }
                if (this.perm) {
                    const m = new Float32Array(bins);
                    const p = new Float32Array(bins);
                    for (let k = 0; k < bins; k++) { m[k] = mag[this.perm[k]]; p[k] = ph[this.perm[k]]; }
                    mag = m; ph = p;
                }
                for (let k = 0; k < bins; k++) {
                    const keep = k >= this.lowCut && k < this.highCut;
                    re[k] = keep ? mag[k] * Math.cos(ph[k]) : 0;
                    im[k] = keep ? mag[k] * Math.sin(ph[k]) : 0;
                }
                for (let k = 1; k < half; k++) {
                    re[n - k] = re[k];
                    im[n - k] = -im[k];
                }
                im[0] = 0; im[half] = 0;
                fft(re, im, true);
                const acc = this.acc;
                for (let i = 0; i < n; i++) acc[i] += re[i] * win[i] * this.norm;
                for (let i = 0; i < hop; i++) this.fifoOut[i] = acc[i];
                acc.copyWithin(0, hop, n + hop);
                acc.fill(0, n);
                this.fifoIn.copyWithin(0, hop, n);
            }
        }

        // SuperCollider's FreeVerb2 (Jezar's Freeverb): both inputs, summed
        // at 0.015, feed eight damped combs and four all-passes per side;
        // the right side's delays are 23 samples longer. room sets the comb
        // feedback (0.7 to 0.98), damp the damping (0 to 0.4), mix the
        // wet/dry balance. The delays are in samples, as in SuperCollider.
        class FreeVerb {
            constructor(o) {
                this.set(o);
                const line = (n) => ({ buf: new Float32Array(n), i: 0, store: 0 });
                const sides = [0, 23].map((spread) => ({
                    combs: [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => line(n + spread)),
                    passes: [556, 441, 341, 225].map((n) => line(n + spread)),
                }));
                this.sides = sides;
                this.out = [0, 0];
            }
            set(o) {
                this.wet = clampTo(o.mix, 0, 1);
                this.dry = 1 - this.wet;
                this.feedback = 0.7 + 0.28 * clampTo(o.room, 0, 1);
                this.damp = 0.4 * clampTo(o.damp, 0, 1);
            }
            side(s, input) {
                let out = 0;
                for (const c of s.combs) {
                    const y = c.buf[c.i];
                    c.store = y * (1 - this.damp) + c.store * this.damp;
                    c.buf[c.i] = input + c.store * this.feedback;
                    if (++c.i >= c.buf.length) c.i = 0;
                    out += y;
                }
                for (const a of s.passes) {
                    const b = a.buf[a.i];
                    a.buf[a.i] = out + b * 0.5;
                    if (++a.i >= a.buf.length) a.i = 0;
                    out = b - out;
                }
                return out;
            }
            step2(l, r) {
                const input = (l + r) * 0.015;
                this.out[0] = this.side(this.sides[0], input) * this.wet + l * this.dry;
                this.out[1] = this.side(this.sides[1], input) * this.wet + r * this.dry;
                return this.out;
            }
        }
        FreeVerb.stereo = true;

        class Coarse {
            constructor(o) {
                this.set(o);
                this.phase = 0;
                this.held = 0;
            }
            set(o) {
                this.period = Math.max(1, o.coarse);
            }
            step(x) {
                if (this.phase <= 0) {
                    this.held = x;
                    this.phase += this.period;
                }
                this.phase -= 1;
                return this.held;
            }
        }

        const KINDS = {
            coarse: Coarse,
            freeverb: FreeVerb,
            squiz: Squiz,
            waveloss: WaveLoss,
            fshift: FreqShift,
            octer: Octer,
            spectral: Spectral,
        };

        class TidalFx extends AudioWorkletProcessor {
            constructor(options) {
                super();
                this.options = options.processorOptions;
                this.Kind = KINDS[this.options.kind];
                this.chains = [];
                // New settings from a tied event: { at: audio time, options } (see _workletSet).
                this.pending = [];
                if (this.port) this.port.onmessage = (e) => { if (e.data && e.data.options) this.pending.push(e.data); };
            }
            applyPending() {
                const now = typeof currentTime === 'number' ? currentTime : Infinity;
                while (this.pending.length && !(this.pending[0].at > now)) {
                    this.options = { ...this.options, ...this.pending.shift().options };
                    for (let i = 0; i < this.chains.length; i++) {
                        const fx = this.chains[i];
                        if (fx && typeof fx.set === 'function') fx.set(this.options);
                        else if (fx) this.chains[i] = new this.Kind(this.options);
                    }
                }
            }
            process(inputs, outputs) {
                if (this.pending.length) this.applyPending();
                const input = inputs[0];
                const output = outputs[0];
                // No input left: the voice ended and was disconnected.
                if (!input || input.length === 0 || !this.Kind) return false;
                if (this.Kind.stereo) {
                    // Effects that mix the channels (FreeVerb2) see both at once.
                    if (!this.chains[0]) this.chains[0] = new this.Kind(this.options);
                    const fx = this.chains[0];
                    const left = input[0];
                    const right = input[1] || input[0];
                    for (let i = 0; i < left.length; i++) {
                        const [l, r] = fx.step2(left[i], right[i]);
                        output[0][i] = l;
                        if (output[1]) output[1][i] = r;
                    }
                    return true;
                }
                for (let ch = 0; ch < output.length; ch++) {
                    const out = output[ch];
                    if (input.length === 1 && ch > 0) {
                        out.set(output[0]);
                        continue;
                    }
                    const src = input[Math.min(ch, input.length - 1)];
                    if (!this.chains[ch]) this.chains[ch] = new this.Kind(this.options);
                    const fx = this.chains[ch];
                    for (let i = 0; i < src.length; i++) out[i] = fx.step(src[i]);
                }
                return true;
            }
        }
        registerProcessor('tidal-fx', TidalFx);

        // SuperCollider's SinOscFB: a sine whose phase is pushed by its own
        // output times `feedback` (radians; 0 is a pure sine, about 1.5 is
        // saw-like). The output fed back is averaged over two samples, which
        // keeps high feedback from breaking into noise. frequency (Hz) and
        // detune (cents) are a-rate, so pitch envelopes, vibrato and glides
        // drive it as they drive an oscillator. The input is the voice's
        // gate (a constant source at 1 while the note sounds): the oscillator
        // runs only where it is above 0, to the sample, and the node ends
        // once the source has stopped.
        class TidalFeedbackSine extends AudioWorkletProcessor {
            static get parameterDescriptors() {
                return [
                    { name: 'frequency', defaultValue: 440, minValue: 0, maxValue: 22000, automationRate: 'a-rate' },
                    { name: 'detune', defaultValue: 0, automationRate: 'a-rate' },
                    { name: 'feedback', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'a-rate' },
                ];
            }
            constructor() {
                super();
                this.phase = 0;
                this.y1 = 0;
                this.y2 = 0;
                this.started = false;
            }
            process(inputs, outputs, parameters) {
                const gate = inputs[0] && inputs[0][0];
                const out = outputs[0][0];
                if (!gate) {
                    // Before the voice starts there is no input yet; after it stops, the node is done.
                    out.fill(0);
                    return !this.started;
                }
                this.started = true;
                const { frequency, detune, feedback } = parameters;
                const at = (list, i) => (list.length > 1 ? list[i] : list[0]);
                for (let i = 0; i < out.length; i++) {
                    if (!(gate[i] > 0)) { out[i] = 0; continue; }
                    const y = Math.sin(this.phase + at(feedback, i) * 0.5 * (this.y1 + this.y2));
                    this.y2 = this.y1;
                    this.y1 = y;
                    out[i] = y;
                    const hz = at(frequency, i) * Math.pow(2, at(detune, i) / 1200);
                    this.phase += (TAU * hz) / sampleRate;
                    if (this.phase > TAU) this.phase -= TAU;
                }
                for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
                return true;
            }
        }
        registerProcessor('tidal-fb', TidalFeedbackSine);
    }

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

    /**
     * Reads an OSC packet (a message, or a bundle of them, nested) into
     * [{ address, args }]. Arguments: i, f, d, h (numbers), s and S (text),
     * b (a blob, as bytes), c, r and m (32 bits, as a number), t (a time tag,
     * as seconds), T and F (true, false), N (null), I (Infinity); array
     * brackets are skipped. Throws on a packet that is cut short.
     */
    function parseOsc(bytes, out = []) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const need = (at, n) => {
            if (at + n > bytes.length) throw new Error('the packet is cut short');
        };
        const text = (at) => {
            let end = at;
            while (end < bytes.length && bytes[end] !== 0) end++;
            need(end, 1);
            return [new TextDecoder().decode(bytes.subarray(at, end)), (end + 4) & ~3];
        };
        if (bytes.length >= 8 && text(0)[0] === '#bundle') {
            let at = 16; // "#bundle\0" and the time tag
            need(0, 16);
            while (at < bytes.length) {
                need(at, 4);
                const size = view.getInt32(at);
                at += 4;
                if (size < 0) throw new Error('a bundle element has a negative size');
                need(at, size);
                parseOsc(bytes.subarray(at, at + size), out);
                at += size;
            }
            return out;
        }
        const [address, afterAddress] = text(0);
        if (!address.startsWith('/')) throw new Error('an OSC address starts with /');
        const args = [];
        if (afterAddress < bytes.length && bytes[afterAddress] === 0x2c) { // ","
            const [tags, start] = text(afterAddress);
            let at = start;
            for (const tag of tags.slice(1)) {
                switch (tag) {
                    case 'i': need(at, 4); args.push(view.getInt32(at)); at += 4; break;
                    case 'f': need(at, 4); args.push(view.getFloat32(at)); at += 4; break;
                    case 'c': case 'r': case 'm': need(at, 4); args.push(view.getUint32(at)); at += 4; break;
                    case 'd': need(at, 8); args.push(view.getFloat64(at)); at += 8; break;
                    case 'h': need(at, 8); args.push(Number(view.getBigInt64(at))); at += 8; break;
                    case 't': need(at, 8); args.push(view.getUint32(at) - 2208988800 + view.getUint32(at + 4) / 4294967296); at += 8; break;
                    case 's': case 'S': { const [s, next] = text(at); args.push(s); at = next; break; }
                    case 'b': {
                        need(at, 4);
                        const size = view.getInt32(at);
                        need(at + 4, Math.max(0, size));
                        args.push(bytes.slice(at + 4, at + 4 + size));
                        at += 4 + ((Math.max(0, size) + 3) & ~3);
                        break;
                    }
                    case 'T': args.push(true); break;
                    case 'F': args.push(false); break;
                    case 'N': args.push(null); break;
                    case 'I': args.push(Infinity); break;
                    case '[': case ']': break;
                    default: throw new Error(`unknown OSC type "${tag}"`);
                }
            }
        }
        out.push({ address, args });
        return out;
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

    /**
     * How .midi() reads an event, shared by live output and MIDI file export:
     * the channel (midichan, 0 by default), the messages sent at the onset
     * (program change, control change, NRPN as CC 99/98/6/38) and the note,
     * which is null for a control-only event (no s, note, midinote or freq).
     * Named drums (bd, sn, hh...) play their General MIDI note. `duration` is
     * the event's length in seconds; the note lasts `sustain` seconds, else
     * duration * legato, and at least 10 ms.
     */
    function midiEventOf(v, duration, options = {}) {
        // MIDI files keep General MIDI's percussion channel (9) for a named drum with no channel or note given, as they always did.
        const drum = options.drumChannel && !isNum(v.midichan) && !isNum(v.midinote) && !isNum(v.note) && !isNum(v.freq)
            && !!v.s && GM_DRUMS[v.s] !== undefined;
        const channel = drum ? 9 : clamp(isNum(v.midichan) ? Math.floor(v.midichan) : 0, 0, 15);
        const cc = (number, value) => [0xb0 | channel, number, value];
        const controls = [];
        if (isNum(v.pgm)) controls.push([0xc0 | channel, clamp(Math.floor(v.pgm), 0, 127)]);
        if (isNum(v.ccn) && isNum(v.ccv)) controls.push(cc(clamp(Math.floor(v.ccn), 0, 127), clamp(Math.floor(v.ccv), 0, 127)));
        const [nrpnNumber, nrpnValue] = typeof v.nrpn === 'string' ? v.nrpn.split(':').map(Number) : [v.nrpnn, v.nrpnv];
        if (isNum(nrpnNumber) && isNum(nrpnValue)) {
            const param = clamp(Math.floor(nrpnNumber), 0, 16383);
            const value = clamp(Math.floor(nrpnValue), 0, 16383);
            controls.push(cc(99, param >> 7), cc(98, param & 127), cc(6, value >> 7), cc(38, value & 127));
        }
        if (!v.s && !isNum(v.note) && !isNum(v.midinote) && !isNum(v.freq)) return { channel, controls, note: null };
        const key = clamp(Math.round(midiNoteOf(v) + (isNum(v.up) ? v.up : 0)), 0, 127);
        const velocity = clamp(Math.round(isNum(v.vel) ? (v.vel <= 1 ? v.vel * 127 : v.vel) : (isNum(v.gain) ? v.gain : 1) * 100), 1, 127);
        const length = Math.max(0.01, isNum(v.sustain) ? v.sustain : duration * (isNum(v.legato) ? v.legato : 1));
        return { channel, controls, note: { key, velocity, length } };
    }

    /** Smootherstep, Perlin's fade curve: 6x^5 - 15x^4 + 10x^3. */
    const fade = (f) => f * f * f * (f * (f * 6 - 15) + 10);

    /** 1D Perlin-style noise from 0 to 1: random values at whole numbers, smoothly joined. */
    function perlinAt(t) {
        const i = Math.floor(t);
        const a = timeRand(i, 2027);
        const b = timeRand(i + 1, 2027);
        return a + fade(t - i) * (b - a);
    }

    /** Tidal's perlin2With: 2D gradient noise from 0 to 1. */
    function perlin2At(x, y) {
        const fx = Math.floor(x);
        const fy = Math.floor(y);
        const xf = x - fx;
        const yf = y - fy;
        const angle = (a, b) => 2 * Math.PI * timeRand(a + 0.0001 * b, 4051);
        const dot = (a, b, dx, dy) => Math.cos(angle(a, b)) * dx + Math.sin(angle(a, b)) * dy;
        const da = dot(fx, fy, xf, yf);
        const db = dot(fx + 1, fy, xf - 1, yf);
        const dc = dot(fx, fy + 1, xf, yf - 1);
        const dd = dot(fx + 1, fy + 1, xf - 1, yf - 1);
        const sx = fade(xf);
        const sy = fade(yf);
        const v = (1 - sx) * (1 - sy) * da + sx * (1 - sy) * db + (1 - sx) * sy * dc + sx * sy * dd;
        return (v + 1) / 2;
    }

    /** The numeric value of a pattern or signal at time t, or undefined. */
    function numberAt(pattern, t) {
        const hit = eventAt(pattern, t);
        return hit ? toNumber(hit.value) : undefined;
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
            this.channels = new Map();   // stream name (or id) -> pattern playing
            this.channelCounter = 0;
            this.streams = new Map();    // stream name -> { pattern, playing } from the last evaluation
            this.muted = new Set();      // stream names muted with mute()
            this.soloed = new Set();     // stream names soloed with solo()
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
            this.pitchedBanks = new Map();     // bank -> [{ midi, url }] for banks with one file per note
            this._fxState = 'none';            // the AudioWorklet effects: none, loading, ready or failed
            this._outputGain = 0.8;            // master volume (setOutput)
            this._limiterOn = true;            // master limiter (setOutput)
            this._lastFreq = new Map();        // orbit:sound -> frequency of its last note, for portamento

            // Live input: slider() / toggle(), midicc(), midikeys() and oscIn().
            this._controls = new Map();        // name -> { name, kind, value, min, max, step }
            this._controlPresets = new Map();  // name -> value restored before the control exists (restoreControls)
            this._controlListeners = new Set();
            this._live = null;                 // controls, layouts, midikeys and oscplays of the code being evaluated
            this._layouts = [];                // [{ title, rows }] from controlLayout()
            this._midiKeys = [];               // [{ pattern, channel, bendRange }] from midikeys()
            this._midiHeld = new Map();        // "channel:key" -> voices of the held key
            this._midiCC = new Map();          // "channel:cc" and "cc" -> last value, 0 to 1
            this._midiBend = new Map();        // "channel" and "*" -> last pitch bend, -1 to 1
            this._polyTouch = new Map();       // "channel:note" -> that key's pressure, 0 to 1 (keytouch)
            this._midiSeq = 0;                 // counts MIDI messages, to tell what came after a key went down
            this._touchSeq = new Map();        // "channel" and "*" -> the count of the last aftertouch
            this._keySeq = new Map();          // "channel:note" -> the count when the key went down
            this._midiTouch = new Map();       // "channel" and "*" -> last aftertouch, 0 to 1
            this._oscPlays = [];               // [{ address, pattern }] from oscplay()
            this._liveVoices = new Map();      // voice params -> what follow() lays out from live inputs (see _relayLive)
            this._liveFlushedAt = -Infinity;   // wall time (ms) of the last re-layout
            this._liveTimer = null;
            this._midiParsers = new Map();     // MIDI input -> running status and pending data bytes
            this._midiListening = false;
            this._oscValues = new Map();       // OSC address -> last numeric arguments
            this._oscListening = false;

            // Evaluation, one-shots and the clock.
            this._txn = null;                  // commands staged while eval() runs code (see _stage)
            this._txnCps = undefined;          // the tempo a staged setCPS() will set
            this._txnBanks = null;             // names of the banks samples() staged in that code
            this._oneShots = new Set();        // { session, timer } of first(), once() and asap()
            this._tempoHistory = [];           // earlier { time, cycle, cps } anchors, valid until the next one
            this._nudged = [];                 // events asked for but not sent yet (beyond the horizon), waiting for their tick
            this._queried = new Map();         // stream -> { pattern, to }: the cycle up to which it was asked for
            this._sentOnsets = new Map();      // stream -> Map(onset cycle -> { cycle, hits: [{ fp, nudge, follow, reads, ev }] }): sent lately (see _handoff)
            this._dispatchCycle = 0;           // events up to this cycle have been sent (see _dispatch)
            this._sentHorizon = -Infinity;     // the audible time up to which events have been sent
            this._tempoRequests = [];          // tempo changes events asked for ahead (see _reconcileTempo)
            this._tempoPast = null;            // while there are requests: the clock as sent (see _reconcileTempo)
            this._tempoPastCycle = 0;          // the cycle up to which it was sent
            this._tempoOrigin = 1;             // and the tempo there before the requests
            this._timelineStart = 0;           // the first cycle of this run of the transport (Play, resetCycles)
            this._eventSeq = 0;                // order of the events the scheduler has seen
            this._sampleFailures = new Map();  // manifest source or file URL -> why it failed (see retrySamples)
            this._sampleListeners = new Set(); // called when sample loads finish or fail
            this._bankSeq = 0;                 // numbers samples() registrations in the order they were made
            this._bankSeqs = new Map();        // bank -> the number of the registration that set it
            this._txnPendingLoads = [];        // the manifests code being evaluated asks for that have not arrived
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

                    // masterGain -> limiter (unless setOutput turns it off) -> output -> speakers
                    this.masterGain = ctx.createGain();
                    this.masterGain.gain.value = this._outputGain;
                    const limiter = ctx.createDynamicsCompressor();
                    limiter.threshold.value = -8;
                    limiter.knee.value = 8;
                    limiter.ratio.value = 6;
                    limiter.attack.value = 0.003;
                    limiter.release.value = 0.2;
                    this._limiter = limiter;
                    this.output = ctx.createGain();
                    this.output.connect(ctx.destination);
                    this._wireOutput();

                    this.setupGlobalFunctions();
                }
                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume();
                }
                await this._loadWorklet();
                return true;
            } catch (error) {
                console.error('TidalJS: audio initialisation failed:', error);
                this.lastError = error.message;
                return false;
            }
        }

        /**
         * Loads the AudioWorklet module of the sample-by-sample effects (squiz,
         * waveloss, fshift, octer and the spectral ones). Without it those
         * effects are skipped with a warning; everything else works.
         */
        _loadWorklet() {
            const ctx = this.audioContext;
            if (this._fxPromise) return this._fxPromise;
            if (!ctx || !ctx.audioWorklet || typeof Blob === 'undefined' || typeof URL === 'undefined') {
                this._fxState = 'failed';
                return Promise.resolve(false);
            }
            this._fxState = 'loading';
            const url = URL.createObjectURL(new Blob(['(' + fxWorkletModule.toString() + ')();'], { type: 'text/javascript' }));
            this._fxPromise = ctx.audioWorklet.addModule(url).then(() => {
                this._fxState = 'ready';
                return true;
            }, (error) => {
                this._fxState = 'failed';
                console.warn('TidalJS: the AudioWorklet effects could not be loaded:', error);
                return false;
            }).finally(() => URL.revokeObjectURL(url));
            return this._fxPromise;
        }

        /** Installs sound(), stack(), cat() and friends on the global object. */
        setupGlobalFunctions() {
            const g = root;
            const before = new Set(Object.keys(g));
            const patternsOf = (args, name) => flatArgs(args).map((p) => toPattern(this, p, name));
            g.tidal = this;
            g.sound = (pattern) => soundPattern(this, pattern);
            g.s = g.sound;
            g.stack = (...patterns) => stackPatterns(this, patternsOf(patterns, 'stack'));
            // Tidal's layer: layer [f, g] p = stack [f p, g p]. Given patterns, it stacks them.
            g.layer = (...args) => {
                if (Array.isArray(args[0]) && args[0].length && args[0].every((f) => typeof f === 'function')) {
                    const p = toPattern(this, args[1], 'layer');
                    return stackPatterns(this, args[0].map((f) => applyTransform('layer', f, p)));
                }
                return stackPatterns(this, patternsOf(args, 'layer'));
            };
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
            // Tidal's rand: timeToRand at the start of each event (see timeRand).
            g.rand = signal(this, (t) => timeRand(t));
            // irand n: whole numbers from 0 to n - 1; n may be a pattern.
            g.irand = (n) => {
                if (typeof n === 'number' || (typeof n === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(n))) {
                    const max = requireNumber('irand', n);
                    return signal(this, (t) => Math.floor(timeRand(t) * max));
                }
                const sizes = raw(n, 'irand');
                return signal(this, (t) => {
                    const max = numberAt(sizes, t);
                    return max === undefined ? undefined : Math.floor(timeRand(t) * max);
                });
            };
            g.perlin = signal(this, perlinAt);

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
            g.scaleList = () => Object.keys(SCALES);
            g.chord = (pattern) => toRaw(this, pattern, 'chord');
            g.chordList = () => Object.keys(CHORDS);
            g.arp = (mode, pattern) => toRaw(this, pattern, 'arp').arp(mode);

            /** fit(step, list, indices): values from list, shifted by step every cycle. */
            g.fit = (step, list, indices) => {
                if (!Array.isArray(list) || list.length === 0) throw new TypeError('fit() expects a non-empty list');
                const index = toRaw(this, indices, 'fit');
                // The step may be a pattern, as in Tidal (fit :: Pattern Int -> ...).
                return patterned(index, 'fit', step, (idx, shift) => new PatternBuilder(this, (b, e) => {
                    const out = [];
                    for (const ev of idx.query(b, e)) {
                        const i = toNumber(ev.value);
                        if (i === undefined) continue;
                        const pick = list[mod(Math.floor(i) + Math.floor(shift) * Math.floor(ev.begin), list.length)];
                        out.push({ begin: ev.begin, end: ev.end, value: pick });
                    }
                    return out;
                }));
            };

            // Buses: values that can be changed from outside while playing.
            g.setBus = (name, value) => {
                if (this._stage('setBus', () => g.setBus(name, value))) return value;
                this.buses.set(String(name), value);
                this._liveChanged();
                return value;
            };
            g.bus = (name, fallback = 0) => liveSignal(this, () => {
                const v = this.buses.get(String(name));
                return v === undefined ? fallback : v;
            });

            // Live controls: a slider or a switch in the editor's Controls panel,
            // read as a continuous pattern of its current value.
            g.slider = (name, value, min = 0, max = 1, step = 0) => {
                const c = this._registerControl('slider', name, value, min, max, step);
                return liveSignal(this, () => this._controlValue(c.name, c.value));
            };
            g.toggle = (name, on = false) => {
                const c = this._registerControl('toggle', name, on ? 1 : 0, 0, 1, 1);
                return liveSignal(this, () => this._controlValue(c.name, c.value));
            };

            // MIDI input: the last value of a control change (0 to 1), and a keyboard that plays a template.
            g.midicc = (cc, channel) => {
                const number = clamp(Math.floor(requireNumber('midicc', cc)), 0, 127);
                const ch = channel === undefined || channel === null ? null : clamp(Math.floor(requireNumber('midicc', channel)), 0, 15);
                this._listenMidi();
                const key = ch === null ? String(number) : `${ch}:${number}`;
                return liveSignal(this, () => this._midiCC.get(key) ?? 0);
            };
            // The pitch-bend wheel (-1 to 1, centre 0) and aftertouch (0 to 1) of a channel, or of any channel.
            const midiChannel = (fname, channel) => (channel === undefined || channel === null ? null
                : clamp(Math.floor(requireNumber(fname, channel)), 0, 15));
            g.midibend = (channel) => {
                const ch = midiChannel('midibend', channel);
                this._listenMidi();
                const key = ch === null ? '*' : String(ch);
                return liveSignal(this, () => this._midiBend.get(key) ?? 0);
            };
            g.miditouch = (channel) => {
                const ch = midiChannel('miditouch', channel);
                this._listenMidi();
                const key = ch === null ? '*' : String(ch);
                return liveSignal(this, () => {
                    // In a midikeys() voice: nothing (the note keeps its own value) until pressure comes after its key went down.
                    if (KEY_CONTEXT.key !== null) {
                        const down = this._keySeq.get(KEY_CONTEXT.key);
                        if (down !== undefined && !((this._touchSeq.get(key) ?? 0) > down)) return undefined;
                    }
                    return this._midiTouch.get(key) ?? 0;
                });
            };
            // The pressure of the key a midikeys() voice plays (polyphonic aftertouch), 0 to 1: nothing (the note
            // keeps its own value) until that key is pressed harder; 0 outside a midikeys() voice.
            g.keytouch = () => {
                this._listenMidi();
                return liveSignal(this, () => (KEY_CONTEXT.key === null ? 0 : this._polyTouch.get(KEY_CONTEXT.key)));
            };
            g.midikeys = (template, channel, bendRange) => {
                if (template === undefined || template === null) throw new TypeError('midikeys() expects a pattern to play, e.g. midikeys(sound("superpiano"))');
                const pattern = toPattern(this, template, 'midikeys');
                const ch = midiChannel('midikeys', channel);
                // The pitch-bend wheel bends the held keys by up to bendRange semitones (0: it does not).
                const range = bendRange === undefined || bendRange === null ? 0 : clamp(requireNumber('midikeys', bendRange), 0, 96);
                const entry = { pattern, channel: ch, bendRange: range };
                if (this._live) this._live.midiKeys.push(entry);
                else this._midiKeys.push(entry);
                this._listenMidi();
                return silence(this);
            };

            // OSC input through the WebSocket bridge: the last numeric argument at `index` of an address.
            const oscPath = (fname, address, example) => {
                if (typeof address !== 'string' || !address.trim()) throw new TypeError(`${fname}() expects an OSC address, e.g. ${example}`);
                return address.trim().startsWith('/') ? address.trim() : '/' + address.trim();
            };
            g.oscIn = (address, index = 0) => {
                const path = oscPath('oscIn', address, 'oscIn("/fader1")');
                const at = Math.max(0, Math.floor(requireNumber('oscIn', index)));
                this._oscListening = true;
                this._oscSocket();
                return liveSignal(this, () => {
                    const values = this._oscValues.get(path);
                    return values && isNum(values[at]) ? values[at] : 0;
                });
            };
            // Each OSC message on `address` plays the template once (as midikeys does for a key).
            g.oscplay = (address, template) => {
                const path = oscPath('oscplay', address, 'oscplay("/hit", sound("superpiano"))');
                if (template === undefined || template === null) throw new TypeError('oscplay() expects an OSC address and a pattern to play, e.g. oscplay("/hit", sound("superpiano"))');
                const entry = { address: path, pattern: toPattern(this, template, 'oscplay') };
                if (this._live) this._live.oscPlays.push(entry);
                else this._oscPlays.push(entry);
                this._oscListening = true;
                this._oscSocket();
                return silence(this);
            };

            // An envelope as SuperCollider's Env(levels, times, curves), times in seconds, read at cycle / cps.
            g.envelope = (levels, times, curves) => {
                const env = makeEnvelope(levels, times, curves);
                return signal(this, (t) => envelopeValue(env, t / this.cps));
            };

            // The Controls panel's layout: a titled group of rows of control names.
            g.controlLayout = (title, rows) => {
                this._registerLayout(title, rows);
                return undefined;
            };

            g.setCPS = (cps) => this.setCPS(cps);
            g.setcps = g.setCPS;
            g.setTempo = (bpm) => this.setTempo(bpm);
            g.stopAll = () => this.stopAll();
            g.hush = g.stopAll;

            // Random choices, as in Tidal: choose and wchoose are signals (a
            // new choice at every event), cycleChoose one choice per cycle.
            g.choose = (options) => {
                if (!Array.isArray(options) || options.length === 0) throw new TypeError('choose() expects a non-empty array');
                return g.chooseBy(g.rand, options);
            };
            g.wchoose = (pairs) => {
                if (!Array.isArray(pairs) || pairs.length === 0 || !pairs.every((p) => Array.isArray(p) && p.length === 2)) {
                    throw new TypeError('wchoose() expects pairs of [value, weight], e.g. wchoose([["bd", 3], ["sn", 1]])');
                }
                return g.wchooseBy(g.rand, pairs);
            };
            g.cycleChoose = (options) => {
                if (!Array.isArray(options) || options.length === 0) throw new TypeError('cycleChoose() expects a non-empty array');
                return g.choose(options).segment(1);
            };

            // Output, recording and export
            g.setOscUrl = (url) => {
                this.oscUrl = String(url);
                const old = this._socket;
                this._socket = null;
                this._socketQueue = []; // packets waiting for the old bridge are not sent to the new one
                if (old) {
                    try { old.close(); } catch (e) { /* already closed */ }
                }
                // oscIn() keeps listening, on the new bridge.
                if (this._oscListening) this._oscSocket();
                return this.oscUrl;
            };
            g.midiOutputs = () => this.midiOutputs();
            g.record = () => this.startRecording();
            g.stopRecording = () => this.stopRecording();
            g.exportPattern = (pattern, cycles, format) => this.exportPattern(pattern, cycles, format);

            this._setupTidalLibrary(g);

            // Commands with effects outside the music wait for the evaluation to commit (see _stage).
            // stopRecording's promise settles when it runs, or with null when the evaluation is dropped.
            for (const name of ['record', 'stopRecording', 'exportPattern', 'setOscUrl']) {
                const command = g[name];
                if (typeof command !== 'function') continue;
                g[name] = (...args) => {
                    if (!this._txn) return command(...args);
                    let settle;
                    const result = new Promise((resolve) => { settle = resolve; });
                    this._stage(name, () => settle(command(...args)), () => settle(null));
                    return name === 'stopRecording' ? result : name === 'setOscUrl' ? String(args[0]) : name === 'record' ? true : undefined;
                };
            }

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

            // The names installed here, for the live-update analysis (see pureDeclaration).
            for (const name of Object.keys(g)) if (!before.has(name)) TIDAL_GLOBALS.add(name);
        }

        // --- Clock -----------------------------------------------------

        /**
         * The cycle at an audio time. A tempo change moves the anchor to a
         * frontier (the scheduling frontier, or the onset of an event with a
         * cps control); times before it keep the mapping they had, so the
         * playhead and events already scheduled do not jump.
         */
        cycleAt(time) {
            if (time < this._anchorTime && this._tempoHistory.length) {
                const seg = this._tempoSegment((s) => s.time <= time);
                return seg.cycle + (time - seg.time) * seg.cps;
            }
            return this._anchorCycle + (time - this._anchorTime) * this.cps;
        }

        /** The audio time of a cycle, with the mapping in force at that cycle (see cycleAt). */
        timeAt(cycle) {
            if (cycle < this._anchorCycle && this._tempoHistory.length) {
                const seg = this._tempoSegment((s) => s.cycle <= cycle);
                return seg.time + (cycle - seg.cycle) / seg.cps;
            }
            return this._anchorTime + (cycle - this._anchorCycle) / this.cps;
        }

        /**
         * Tempo changes from events (a cps control) are asked for ahead of
         * time, when their events are, and stay requests until the event
         * carrying the control is sent (a nudge moves that earlier or later
         * than its onset); a request whose stream was not heard when it was
         * asked (no event to send) is settled when its onset is sent. Until
         * then it counts only while its stream still plays the pattern that
         * asked and is heard; once sent, it stays (mute, replacement, Stop).
         *
         * The clock is what was sent, which never changes (the mapping up to
         * _tempoPastCycle, the dispatch frontier of the last tick), then the
         * tempo in force there and the changes after it, from the requests
         * that count in cycle order (then in the order they were asked for):
         * so one asked for in a later tick at an earlier cycle (a stream
         * added meanwhile) goes before those after it, and one equal to the
         * tempo before it still counts (it matters again if an earlier one
         * goes). A request undone after its onset was passed (its control was
         * held by a positive nudge) ends at the frontier, not retroactively.
         * Recomputed whenever streams change (removed, replaced, muted,
         * soloed); events not yet sent get their times from the clock as it
         * is then.
         */
        _reconcileTempo() {
            if (!this._tempoPast) return;
            const at = this._tempoPastCycle;
            const counted = this._tempoRequests.filter((r) => this._tempoOwned(r)).sort(byTempoOrder);
            let cps = this._tempoOrigin;
            for (const r of counted) if (r.cycle <= at) cps = r.cps;
            this._restoreTempo(this._tempoPast);
            this._retempo(at, cps);
            for (const r of counted) if (r.cycle > at) this._retempo(r.cycle, r.cps);
        }

        /** True while a tempo request counts: sent, or its stream still plays that pattern, is heard, and its event was not dropped. */
        _tempoOwned(r) {
            if (r.committed) return true;
            if (r.item && r.item.dropped) return false;
            return this.channels.get(r.owner.id) === r.owner.pattern && this.isAudible(r.owner.id);
        }

        /** Records a tempo change asked for by a stream's event (`item`: that event, when it is to be sent; see _reconcileTempo). */
        _requestTempo(cycle, cps, owner, seq, item) {
            if (!this._tempoPast) this._markTempoPast(this._cpsAt(this._dispatchCycle));
            this._tempoRequests.push({ cycle, cps, owner, seq, item, committed: false });
        }

        /** What was sent so far is fixed: the clock up to the dispatch frontier, with `origin` the tempo before the requests. */
        _markTempoPast(origin) {
            const at = this._dispatchCycle;
            const segments = [...this._tempoHistory, { time: this._anchorTime, cycle: this._anchorCycle, cps: this.cps }];
            let kept = segments.filter((s) => s.cycle < at);
            if (!kept.length) kept = [segments[0]];
            const last = kept[kept.length - 1];
            this._tempoPast = { time: last.time, cycle: last.cycle, cps: last.cps, history: kept.slice(0, -1) };
            this._tempoPastCycle = at;
            this._tempoOrigin = origin;
        }

        /**
         * After a tick's dispatch: requests whose control was sent are
         * committed, those whose event was dropped go, and those with no event
         * are settled at their onset. Committed ones before the frontier (and
         * before any still open) join the tempo before the requests.
         */
        _commitTempo() {
            if (!this._tempoPast) return;
            const at = this._dispatchCycle;
            const open = [];
            for (const r of this._tempoRequests) {
                if (!r.committed) {
                    if (r.item ? r.item.dropped : r.cycle < at && !this._tempoOwned(r)) continue;
                    if (r.item ? r.item.sent : r.cycle < at) r.committed = true;
                }
                open.push(r);
            }
            open.sort(byTempoOrder);
            let origin = this._tempoOrigin;
            while (open.length && open[0].committed && open[0].cycle < at) origin = open.shift().cps;
            this._tempoRequests = open;
            this._markTempoPast(origin); // the clock this tick sent with
            this._reconcileTempo();
            if (!open.length) this._tempoPast = null;
        }

        /** Drops the requests whose control was not sent: the clock keeps what was sent and the committed tempo. */
        _dropTempoRequests() {
            if (!this._tempoPast) return;
            this._tempoRequests = this._tempoRequests.filter((r) => r.committed);
            this._reconcileTempo();
            this._tempoRequests = [];
            this._tempoPast = null;
        }

        _restoreTempo(s) {
            this._anchorTime = s.time;
            this._anchorCycle = s.cycle;
            this.cps = s.cps;
            this._tempoHistory = s.history.slice();
        }

        /** The tempo in force at a cycle (see cycleAt). */
        _cpsAt(cycle) {
            if (cycle < this._anchorCycle && this._tempoHistory.length) return this._tempoSegment((s) => s.cycle <= cycle).cps;
            return this.cps;
        }

        /** The latest earlier anchor that `fits`, or the earliest one kept. */
        _tempoSegment(fits) {
            for (let i = this._tempoHistory.length - 1; i >= 0; i--) {
                if (fits(this._tempoHistory[i])) return this._tempoHistory[i];
            }
            return this._tempoHistory[0];
        }

        /**
         * Changes the tempo from `cycle` on: the old mapping stays valid up to
         * that frontier, the new one starts there at the same time.
         */
        _retempo(cycle, cps) {
            if (Math.abs(cps - this.cps) <= 1e-9) return; // the same tempo: nothing changes
            cycle = Math.max(cycle, this._anchorCycle); // never before the mapping in force
            const time = this.timeAt(cycle);
            this._tempoHistory.push({ time: this._anchorTime, cycle: this._anchorCycle, cps: this.cps });
            // (pruned only once nothing needs it: see _pruneTimeline)
            this._anchorTime = time;
            this._anchorCycle = cycle;
            this.cps = cps;
        }

        /**
         * While eval() runs code, commands that change what TidalJS plays
         * (tempo, hush, the output stage, mute and solo, one-shots, cycles,
         * buses, recording, export and the OSC address) are staged instead of
         * applied: they run in order when the evaluation commits, and a failed
         * evaluation, or a live update held back by warnings, drops them.
         * Returns true when staged. `discard` runs when they are dropped.
         * Other side effects of the code itself (the page, the network,
         * globals it sets) are JavaScript's and are not rolled back.
         */
        _stage(kind, apply, discard = null) {
            if (!this._txn) return false;
            this._txn.push({ kind, apply, discard });
            return true;
        }

        /** Global functions from the rest of Tidal's library (see "More of Tidal's library"). */
        _setupTidalLibrary(g) {
            const pat = (input, fname) => toPattern(this, input, fname);
            const raw = (input, fname) => toRaw(this, input, fname);
            const pairs = (fname, list, order) => {
                if (!Array.isArray(list) || list.length === 0 || !list.every((x) => Array.isArray(x) && x.length === 2)) {
                    throw new TypeError(`${fname}() expects a list of pairs, e.g. ${order}`);
                }
                return list;
            };

            // Control patterns on their own, as in Tidal: n("0 .. 7"), note("c e g"), speed(2).
            // Combine them with a sound: n("0 2").sound("drum"), or sound("drum*4").set(n("0 2")).
            for (const name of [...Object.keys(CONTROLS), ...Object.keys(CONTROL_ALIASES)]) {
                if (name === 's' || name === 'sound') continue;
                const control = CONTROL_ALIASES[name] || name;
                g[name] = (value) => controlPattern(this, control, value);
            }

            // Numbers
            g.run = (n) => (typeof n === 'number' ? runPattern(this, n)
                : patterned(pure(this, 0), 'run', n, (p, x) => runPattern(this, x)));
            g.scan = (n) => patterned(pure(this, 0), 'scan', n, (p, x) => {
                const top = Math.max(1, Math.floor(x));
                return slowcat(this, Array.from({ length: top }, (_, i) => runPattern(this, i + 1)));
            });
            g.toScale = (steps, pattern) => raw(pattern, 'toScale').toScale(steps);
            g.markovPat = (n, xi, matrix) => markovPattern(this, requireNumber('markovPat', n), requireNumber('markovPat', xi), matrix);
            g.lindenmayer = (n, rules, axiom) => lindenmayer(requireNumber('lindenmayer', n), rules, axiom);

            // Lists to patterns
            g.fromList = (list) => slowcat(this, (list || []).map((x) => pure(this, x)));
            g.fastFromList = (list) => fastcat(this, (list || []).map((x) => pure(this, x)));
            g.listToPat = g.fastFromList;
            g.fromMaybes = (list) => fastcat(this, (list || []).map((x) => (x === null || x === undefined ? silence(this) : pure(this, x))));
            g.timeCat = (steps) => timecat(this, pairs('timeCat', steps, '[[1, sound("bd*4")], [1, sound("hh*8")]]')
                .map(([weight, p]) => ({ weight: requireNumber('timeCat', weight), pattern: pat(p, 'timeCat') })));
            g.timecat = g.timeCat;
            g.wrandcat = (items) => {
                const list = pairs('wrandcat', items, '[[sound("bd*2"), 3], [sound("cp"), 1]]');
                const weights = list.map(([, w]) => Math.max(0, requireNumber('wrandcat', w)));
                const total = weights.reduce((x, y) => x + y, 0) || 1;
                const patterns = list.map(([p]) => pat(p, 'wrandcat'));
                // Tidal: wchooseBy (segment 1 rand), so rand at the start of the cycle.
                return new PatternBuilder(this, (b, e) => eachCycle(b, e, (c, s, t) => {
                    let r = timeRand(c) * total;
                    const i = weights.findIndex((w) => (r -= w) < 0);
                    return patterns[i < 0 ? patterns.length - 1 : i].query(s, t);
                }));
            };

            // Booleans
            // As Tidal's binaryN and ascii: each number (or word) of the pattern
            // plays its bits squeezed into its step.
            const bitsPattern = (bits) => fastcat(this, bits.map((on) => pure(this, on)));
            g.binaryN = (bits, n) => {
                const width = Math.max(1, Math.floor(requireNumber('binaryN', bits)));
                const numbers = typeof n === 'number' ? pure(this, n) : raw(n, 'binaryN');
                return squeezeJoin(this, numbers, (v) => {
                    const x = toNumber(v);
                    return x === undefined ? null : bitsPattern(bitsOf(Math.floor(x), width));
                });
            };
            g.binary = (n) => g.binaryN(8, n);
            g.ascii = (text) => squeezeJoin(this, raw(text, 'ascii'), (v) => {
                const word = String(v);
                return word ? bitsPattern([...word].flatMap((ch) => bitsOf(ch.charCodeAt(0) & 255, 8))) : null;
            });
            g.necklace = (perCycle, list) => {
                const lengths = checkNumbers('necklace', list).map((x) => Math.max(1, Math.floor(x)));
                const bools = lengths.flatMap((x) => [true, ...new Array(x - 1).fill(false)]);
                return fastPattern(fastcat(this, bools.map((x) => pure(this, x))), requireNumber('necklace', perCycle) / bools.length);
            };
            // Tidal's brand and brandBy: rand below the probability (a number or a pattern).
            g.brand = signal(this, (t) => timeRand(t) < 0.5);
            g.brandBy = (prob) => {
                if (typeof prob === 'number') return signal(this, (t) => timeRand(t) < prob);
                const probs = raw(prob, 'brandBy');
                return signal(this, (t) => {
                    const p = numberAt(probs, t);
                    return p === undefined ? undefined : timeRand(t) < p;
                });
            };

            // Choosing
            g.chooseBy = (sig, list) => {
                if (!Array.isArray(list) || list.length === 0) throw new TypeError('chooseBy() expects a signal and a list');
                // Tidal: xs !!! floor (range 0 n f), so the index wraps around.
                return (sig instanceof PatternBuilder ? sig : raw(sig, 'chooseBy')).withValue((v) => {
                    const x = toNumber(v);
                    return x === undefined ? undefined : list[mod(Math.floor(x * list.length), list.length)];
                });
            };
            g.wchooseBy = (sig, items) => {
                const list = pairs('wchooseBy', items, '[["bd", 3], ["sn", 1]]');
                const total = list.reduce((x, [, w]) => x + Math.max(0, toNumber(w) || 0), 0) || 1;
                return (sig instanceof PatternBuilder ? sig : raw(sig, 'wchooseBy')).withValue((v) => {
                    let r = (toNumber(v) || 0) * total;
                    const hit = list.find(([, w]) => (r -= Math.max(0, toNumber(w) || 0)) < 0);
                    return (hit || list[list.length - 1])[0];
                });
            };
            g.select = (amount, patterns) => {
                const list = (patterns || []).map((p) => pat(p, 'select'));
                if (list.length === 0) throw new TypeError('select() expects a number pattern and a list of patterns');
                // Tidal: ps !! floor (max 0 (min 1 f) * (length ps - 1)).
                return joinOver(this, raw(amount, 'select'), (v) => {
                    const x = toNumber(v);
                    return x === undefined ? null : list[Math.floor(clamp(x, 0, 1) * (list.length - 1))];
                });
            };
            g.squeeze = (indices, patterns) => {
                const list = (patterns || []).map((p) => pat(p, 'squeeze'));
                if (list.length === 0) throw new TypeError('squeeze() expects an index pattern and a list of patterns');
                return squeezeJoin(this, raw(indices, 'squeeze'), (v) => {
                    const i = toNumber(v);
                    return i === undefined ? null : list[mod(Math.floor(i), list.length)];
                });
            };
            g.pickF = (indices, fns, pattern) => pat(pattern, 'pickF').pickF(indices, fns);
            g.selectF = (amount, fns, pattern) => pat(pattern, 'selectF').selectF(amount, fns);
            g.sew = (booleans, a, b) => pat(a, 'sew').sew(booleans, b);
            g.stitch = (booleans, a, b) => pat(a, 'stitch').stitch(booleans, b);
            g.wedge = (time, a, b) => pat(a, 'wedge').wedge(time, b);
            g.spread = (fn, values, pattern) => pat(pattern, 'spread').spread(fn, values);
            g.fastspread = (fn, values, pattern) => pat(pattern, 'fastspread').fastspread(fn, values);

            // Signals: the bipolar versions go from -1 to 1; envelopes run once, over the first cycle.
            const bipolar = (sig) => sig.withValue((v) => v * 2 - 1);
            g.sine2 = bipolar(g.sine);
            g.cosine2 = bipolar(g.cosine);
            g.saw2 = bipolar(g.saw);
            g.isaw2 = bipolar(g.isaw);
            g.tri2 = bipolar(g.tri);
            g.square2 = bipolar(g.square);
            const ramp = (t) => clamp(t, 0, 1);
            g.envL = signal(this, (t) => ramp(t));
            g.envLR = signal(this, (t) => 1 - ramp(t));
            g.envEq = signal(this, (t) => Math.sqrt(Math.sin((Math.PI / 2) * ramp(1 - t))));
            g.envEqR = signal(this, (t) => Math.sqrt(Math.cos((Math.PI / 2) * ramp(1 - t))));

            // Stepwise
            const patternList = (fname, list) => {
                if (!Array.isArray(list) || list.length === 0) throw new TypeError(`${fname}() expects a list of patterns`);
                return list.map((p) => pat(p, fname));
            };
            g.stepcat = (...items) => stepcatPatterns(this, patternList('stepcat', flatArgs(items)));
            g.s_cat = g.stepcat;
            g.stepalt = (groups) => {
                if (!Array.isArray(groups) || !groups.every((x) => Array.isArray(x) && x.length)) {
                    throw new TypeError('stepalt() expects a list of lists, e.g. [[sound("bd sn")], [sound("hh*3"), sound("cp")]]');
                }
                const lists = groups.map((list) => patternList('stepalt', list));
                const count = lists.map((l) => l.length).reduce((a, b) => (a * b) / gcd(a, b)) * lists.length;
                const out = [];
                for (let i = 0; out.length < count; i++) {
                    for (const list of lists) if (out.length < count) out.push(list[i % list.length]);
                }
                return stepcatPatterns(this, out);
            };
            g.stepzip = (list) => {
                const patterns = patternList('stepzip', list).filter((p) => p._steps > 0);
                if (!patterns.length) return silence(this);
                const total = lcmSteps(patterns.map((p) => p._steps)) || Math.max(...patterns.map((p) => p._steps));
                return withSteps(fastPattern(slowcat(this, patterns.map((p) => p.pace(1))), total), total);
            };

            // More of Tidal
            g.ur = (cycles, structure, patterns, fx = {}) => urPattern(this, cycles, structure, patterns, fx);
            g.inhabit = (patterns, names) => {
                if (!patterns || typeof patterns !== 'object') throw new TypeError('inhabit() expects named patterns, e.g. { a: sound("bd sn") }');
                const named = Object.fromEntries(Object.entries(patterns).map(([k, p]) => [k, pat(p, 'inhabit')]));
                const index = Object.keys(named);
                return g.squeeze(raw(names, 'inhabit').withValue((v) => (index.includes(String(v)) ? index.indexOf(String(v)) : undefined)), index.map((k) => named[k]));
            };
            g.swap = (table, pattern) => {
                if (!table || typeof table !== 'object') throw new TypeError('swap() expects a table, e.g. { a: "bd", b: "sn" }');
                const values = raw(pattern, 'swap');
                return values._derive((b, e) => values.query(b, e).flatMap((ev) => {
                    const v = table[String(ev.value)];
                    return v === undefined ? [] : [{ begin: ev.begin, end: ev.end, value: v }];
                }));
            };
            // Tidal's weaveWith t p fs: _slow t $ stack [rotL (i/l) $ _fast t (f (_slow t p))],
            // that is rotL (i * t / l) (f (slow t p)) for each function.
            g.weaveWith = (cycles, controls, fns) => {
                const t = requireNumber('weaveWith', cycles);
                const list = checkFunctions('weaveWith', fns);
                const ctrl = controls instanceof PatternBuilder ? controls : raw(controls, 'weaveWith');
                const slowed = fastPattern(ctrl, 1 / t);
                return stackPatterns(this, list.map((f, i) => shiftPattern(applyTransform('weaveWith', f, slowed), -(i * t) / list.length)));
            };
            g.weave = (cycles, controls, patterns) => {
                const list = patternList('weave', patterns);
                return g.weaveWith(cycles, controls, list.map((p) => (x) => p.set(x)));
            };
            g.snowball = (depth, combine, fn, pattern) => pat(pattern, 'snowball').snowball(depth, combine, fn);

            // The rest of Tidal's library
            g.sig = (fn) => {
                requireFunction('sig', fn);
                return signal(this, (t) => fn(t));
            };
            const numeric = (input, fname) => (typeof input === 'number' ? pure(this, input) : raw(input, fname));
            g.perlinWith = (input) => numeric(input, 'perlinWith').withValue((v) => {
                const x = toNumber(v);
                return x === undefined ? v : perlinAt(x);
            });
            g.perlin2With = (x, y) => {
                const xs = numeric(x, 'perlin2With');
                const ys = numeric(y, 'perlin2With');
                return signal(this, (t) => {
                    const a = numberAt(xs, t);
                    const b = numberAt(ys, t);
                    return a === undefined || b === undefined ? undefined : perlin2At(a, b);
                });
            };
            g.perlin2 = (y) => g.perlin2With(g.sig((t) => t), y);
            g.interlace = (a, b) => g.weave(16, controlPattern(this, 'shape', g.sine.withValue((v) => v * 0.9)), [a, b]);
            const sections = (fname, list) => {
                if (!Array.isArray(list) || list.length === 0 || !list.every((x) => Array.isArray(x) && x.length === 3)) {
                    throw new TypeError(`${fname}() expects a list of [start, stop, pattern], e.g. [[0, 4, sound("bd*4")], [2, 6, sound("hh*8")]]`);
                }
                return list.map(([start, stop, p]) => [requireNumber(fname, start), requireNumber(fname, stop), pat(p, fname)]);
            };
            g.seqP = (list) => stackPatterns(this, sections('seqP', list).map(([start, stop, p]) =>
                shiftPattern(p, Math.floor(start)).playFor(start, stop)));
            g.seqPLoop = (list) => {
                const parts = sections('seqPLoop', list);
                const first = Math.min(...parts.map(([start]) => start));
                const last = Math.max(...parts.map(([, stop]) => stop));
                if (!(last > first)) return silence(this);
                return shiftPattern(g.seqP(list), -first).timeLoop(last - first);
            };
            g.fastAppend = (a, b) => pat(a, 'fastAppend').fastAppend(b);
            g.slowAppend = (a, b) => pat(a, 'slowAppend').slowAppend(b);
            g.spreadf = (fns, pattern) => pat(pattern, 'spreadf').spreadf(fns);
            g.toScaleBy = (octave, steps, pattern) => raw(pattern, 'toScaleBy').toScaleBy(octave, steps);
            g.fitSlices = (cycles, n, from, to, pattern) => pat(pattern, 'fitSlices').fitSlices(cycles, n, from, to);
            g.resetCycles = () => this.resetCycles();
            g.setOutput = (gain, limiter) => this.setOutput(gain, limiter);

            // Playing: named streams (Tidal's d1 $ ..., p "name" $ ...) and transitions between versions
            // Tidal's first plays cycle 0 once, right away; once plays a random cycle (asap is once).
            g.first = (pattern) => this.playOnce(pat(pattern, 'first'));
            g.once = (pattern) => this.playOnce(shiftPattern(pat(pattern, 'once'), -Math.floor(Math.random() * 8193)));
            g.asap = g.once;
            // only(pattern): hush the other streams (Tidal's only = hush >> ...).
            g.only = (pattern) => {
                const p = pat(pattern, 'only');
                const s = new PatternBuilder(this, (b, e) => p.query(b, e));
                s._steps = p._steps;
                s._stream = p._stream;
                s._transition = p._transition;
                s._only = true;
                if (this._collecting) this._collecting.push(s);
                return s;
            };
            g.panic = () => {
                if (this._stage('panic', () => g.panic())) return;
                this.stopAll();
                this._allNotesOff();
            };
            g.setbpm = (bpm) => this.setTempo(bpm);
            // While code is evaluated, a setCPS() earlier in it is already seen.
            g.getcps = () => (this._txn && this._txnCps !== undefined ? this._txnCps : this.cps);
            g.getnow = () => this.getCyclePosition();
            g.setCycle = (cycle) => this.setCycle(cycle);
            for (let i = 1; i <= 16; i++) g['d' + i] = (pattern) => streamed(this, i, pattern);
            g.p = (id, pattern) => streamed(this, id, pattern);
            const num = (fname, x) => {
                const v = requireNumber(fname, x);
                if (!(v >= 0)) throw new RangeError(`${fname}() expects a number of cycles of 0 or more`);
                return v;
            };
            g.xfadeIn = (id, cycles, pattern) => streamed(this, id, pattern, TRANSITIONS.xfadeIn(Math.max(0.01, num('xfadeIn', cycles))));
            g.xfade = (id, pattern) => g.xfadeIn(id, 4, pattern);
            g.jumpIn = (id, cycles, pattern) => streamed(this, id, pattern, TRANSITIONS.jumpIn(num('jumpIn', cycles)));
            g.jump = (id, pattern) => streamed(this, id, pattern);
            g.jumpMod = (id, n, pattern) => streamed(this, id, pattern, TRANSITIONS.jumpMod(Math.max(1, Math.floor(num('jumpMod', n)))));
            // Tidal's jumpIn' and jumpMod' (JavaScript names cannot contain ').
            g.jumpInNext = (id, n, pattern) => streamed(this, id, pattern, TRANSITIONS.jumpInNext(Math.floor(num('jumpInNext', n))));
            g.jumpModOffset = (id, n, offset, pattern) => streamed(this, id, pattern,
                TRANSITIONS.jumpMod(Math.max(1, Math.floor(num('jumpModOffset', n))), Math.floor(requireNumber('jumpModOffset', offset))));
            g.histpan = (id, n, pattern) => streamed(this, id, pattern, TRANSITIONS.histpan(num('histpan', n)));
            // waitT(id, cycles, transition, ...its arguments, pattern), e.g. waitT(1, 4, xfadeIn, 8, sound("bd*2")).
            const builders = () => new Map([
                [g.xfadeIn, (a) => TRANSITIONS.xfadeIn(Math.max(0.01, num('waitT', a[0])))],
                [g.jumpIn, (a) => TRANSITIONS.jumpIn(num('waitT', a[0]))],
                [g.clutchIn, (a) => TRANSITIONS.clutchIn(Math.max(0.01, num('waitT', a[0])))],
                [g.anticipateIn, (a) => TRANSITIONS.anticipateIn(Math.max(0.01, num('waitT', a[0])))],
                [g.interpolateIn, (a) => TRANSITIONS.interpolateIn(Math.max(0.01, num('waitT', a[0])))],
                [g.jumpMod, (a) => TRANSITIONS.jumpMod(Math.max(1, Math.floor(num('waitT', a[0]))))],
            ]);
            g.waitT = (id, cycles, transition, ...rest) => {
                const pattern = rest.pop();
                const build = builders().get(transition);
                if (!build) throw new TypeError('waitT() expects a transition such as xfadeIn, jumpIn, clutchIn, anticipateIn, interpolateIn or jumpMod');
                return streamed(this, id, pattern, TRANSITIONS.waitT(num('waitT', cycles), build(rest)));
            };
            g.clutchIn = (id, cycles, pattern) => streamed(this, id, pattern, TRANSITIONS.clutchIn(Math.max(0.01, num('clutchIn', cycles))));
            g.clutch = (id, pattern) => g.clutchIn(id, 2, pattern);
            g.anticipateIn = (id, cycles, pattern) => streamed(this, id, pattern, TRANSITIONS.anticipateIn(Math.max(0.01, num('anticipateIn', cycles))));
            g.anticipate = (id, pattern) => g.anticipateIn(id, 8, pattern);
            g.interpolateIn = (id, cycles, pattern) => streamed(this, id, pattern, TRANSITIONS.interpolateIn(Math.max(0.01, num('interpolateIn', cycles))));
            g.interpolate = (id, pattern) => g.interpolateIn(id, 4, pattern);
            g.wait = (id, cycles, pattern) => streamed(this, id, pattern, TRANSITIONS.waitIn(num('wait', cycles)));
            g.mortal = (id, life, release, pattern) => streamed(this, id, pattern, TRANSITIONS.mortal(num('mortal', life), Math.max(0.01, num('mortal', release))));

            // Mute and solo streams by number (1 is d1) or name.
            g.mute = (id) => this.mute(id, true);
            g.unmute = (id) => this.mute(id, false);
            g.solo = (id) => this.solo(id, true);
            g.unsolo = (id) => this.solo(id, false);
            g.unmuteAll = () => this.unmuteAll();
            g.unsoloAll = () => this.unsoloAll();
        }

        /**
         * Plays the first cycle of a pattern once, starting now (Tidal's once).
         * It plays on its own: in its own session (output and orbit effects),
         * so starting or stopping the loops does not cut it, and the Stop
         * button (stopAll) does. Its graph goes once its effect tails are over.
         */
        playOnce(pattern) {
            if (this._stage('once', () => this.playOnce(pattern))) return;
            const ctx = this.audioContext;
            if (!ctx) return;
            const session = this._createSession();
            const start = ctx.currentTime + 0.05;
            const cps = this.cps;
            const events = pattern.query(0, 1).slice().sort((a, b) => a.begin - b.begin);
            const shot = { session, timer: null };
            const saved = this._session;
            const savedOwner = this._midiOwner;
            this._session = session;
            this._midiOwner = shot; // its MIDI is its own: stopping the loops does not cancel it
            let end = start;
            try {
                for (const ev of events) {
                    const v = asObject(ev.value);
                    const time = start + ev.begin / cps + (isNum(v.nudge) ? v.nudge : 0);
                    const duration = (ev.end - ev.begin) / cps;
                    end = Math.max(end, time + duration);
                    try {
                        this.playEvent(v, Math.max(time, ctx.currentTime), duration);
                    } catch (error) {
                        console.error('TidalJS: could not play event:', error);
                    }
                }
            } finally {
                this._session = saved;
                this._midiOwner = savedOwner;
            }
            this._oneShots.add(shot);
            shot.timer = setTimeout(() => this._endOneShot(shot), Math.max(0, end - ctx.currentTime + ONE_SHOT_TAIL) * 1000);
        }

        /** Ends a one-shot: its session is faded out and disconnected. */
        _endOneShot(shot) {
            if (!this._oneShots.delete(shot)) return;
            clearTimeout(shot.timer);
            this._teardownSession(shot.session);
            this._cancelMidi(shot);
            this._socketQueue = this._socketQueue.filter((p) => p.owner !== shot);
        }

        /** True while a first(), once() or asap() is still sounding. */
        get playingOneShots() {
            return this._oneShots.size > 0;
        }

        /** Current position in cycles (fractional), 0 when stopped. */
        getCyclePosition() {
            if (!this.isPlaying || !this.audioContext) return 0;
            return Math.max(0, this.cycleAt(this.audioContext.currentTime));
        }

        /**
         * Position in cycles of what is heard now: the clock minus the audio
         * output latency, so a playhead lines up with the sound (0 when stopped).
         */
        getAudibleCyclePosition() {
            const ctx = this.audioContext;
            if (!this.isPlaying || !ctx) return 0;
            const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
            return Math.max(0, this.cycleAt(ctx.currentTime - latency));
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
                return this._txn && this._txnCps !== undefined ? this._txnCps : this.cps;
            }
            const next = clamp(value, 0.05, 10);
            if (this._txn) {
                this._txnCps = next;
                this._stage('cps', () => this.setCPS(next));
                return next;
            }
            // Re-anchor at the scheduling frontier so already scheduled
            // events keep their times and new ones follow the new tempo.
            // (from what was already sent: events asked for ahead get their times when they go out; tempo
            // changes events asked for ahead are overridden)
            if (this.isPlaying) {
                this._dropTempoRequests();
                this._retempo(Math.max(this._dispatchCycle, this._anchorCycle), next);
            }
            else this.cps = next;
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

        /**
         * Sets the output stage: the master volume (0.8 by default) and the
         * limiter that keeps peaks below -8 dB (on by default). setOutput(1,
         * false) sends the sound out as it is, as SuperCollider does.
         */
        setOutput(gain = 0.8, limiter = true) {
            const value = toNumber(gain);
            if (value === undefined || value < 0) throw new TypeError('setOutput() expects a volume of 0 or more, e.g. setOutput(1, false)');
            if (this._stage('output', () => this.setOutput(gain, limiter))) return { gain: clamp(value, 0, 4), limiter: !!limiter };
            this._outputGain = clamp(value, 0, 4);
            this._limiterOn = !!limiter;
            if (this.masterGain && this.masterGain.gain) this.masterGain.gain.value = this._outputGain;
            this._wireOutput();
            return { gain: this._outputGain, limiter: this._limiterOn };
        }

        _wireOutput() {
            if (!this.masterGain || !this.output || !this._limiter) return;
            try { this.masterGain.disconnect(); } catch (e) { /* not connected */ }
            try { this._limiter.disconnect(); } catch (e) { /* not connected */ }
            if (this._limiterOn) {
                this.masterGain.connect(this._limiter);
                this._limiter.connect(this.output);
            } else {
                this.masterGain.connect(this.output);
            }
        }

        /** Sets the cycle the clock is at: the next cycle scheduled becomes `cycle` (Tidal's setCycle). */
        setCycle(cycle) {
            const c = requireNumber('setCycle', cycle);
            if (this._stage('setCycle', () => this.setCycle(c))) return c;
            if (this.isPlaying) this._renumber(c);
            return c;
        }

        /** Starts counting cycles from 0 again, from the next cycle scheduled (Tidal's resetCycles). */
        resetCycles() {
            if (this._stage('resetCycles', () => this.resetCycles())) return 0;
            if (this.isPlaying) this._renumber(0);
            return 0;
        }

        /**
         * Numbers the cycles afresh from what was already sent: the next cycle
         * becomes `cycle`. Earlier anchors no longer apply, and events asked
         * for ahead (in the old numbering) are asked for again.
         */
        _renumber(cycle) {
            this._dropTempoRequests(); // those not sent yet were asked for in the old numbering
            this._anchorTime = this.timeAt(this._dispatchCycle);
            this._anchorCycle = cycle;
            this._nextCycle = cycle;
            this._dispatchCycle = cycle;
            this._timelineStart = cycle; // nothing before it is played in this numbering (see _tick)
            this._tempoHistory = [];
            this._queried.clear();
            this._sentOnsets.clear();
            // (what was already sent, _sentHorizon, is a time: it stays)
            this._nudged = [];
        }

        // --- Transport -------------------------------------------------

        _start() {
            if (this.isPlaying) return;
            const ctx = this.audioContext;
            if (!ctx) throw new Error('Call tidal.init() before playing patterns');
            if (ctx.state === 'suspended') ctx.resume();
            // once() may already have opened a session while stopped.
            this._session = this._session || this._createSession();
            this._anchorTime = ctx.currentTime + 0.05;
            this._anchorCycle = 0;
            this._nextCycle = 0;
            this._dispatchCycle = 0;
            this._queried.clear();
            this._sentOnsets.clear();
            this._sentHorizon = -Infinity;
            this._tempoRequests = [];
            this._tempoPast = null;
            this._timelineStart = 0;
            this._tempoHistory = [];
            this._nudged = [];
            this.isPlaying = true;
            this._startTimer();
        }

        /** Stops the clock and the loops' session; one-shots play on (stopAll ends them too). */
        _halt() {
            this.isPlaying = false;
            this._stopTimer();
            this._nudged = []; // events held back for a later tick never play
            this._queried.clear();
            this._sentOnsets.clear();
            this._sentHorizon = -Infinity;
            this._dropTempoRequests(); // tempo changes whose control was not sent never happened: the committed tempo stays
            const session = this._session;
            this._session = null;
            this._teardownSession(session);
            this._midiHeld.clear(); // the held keys' voices went with the session
            this._liveVoices.clear();
            this._cancelExternalOutput();
            // All notes off would cut a one-shot's MIDI too: then only the loops' notes are ended (above).
            if (this._oneShots.size === 0) this._allNotesOff();
        }

        /** Fades a session out quickly, then disconnects everything of it, events already scheduled and effect tails included. */
        _teardownSession(session) {
            if (!session || !this.audioContext) return;
            const t = this.audioContext.currentTime;
            const g = session.out.gain;
            try {
                g.cancelScheduledValues(t);
                g.setValueAtTime(g.value, t);
                g.linearRampToValueAtTime(0, t + 0.04);
            } catch (e) { /* a closed context */ }
            setTimeout(() => session.nodes.forEach((node) => {
                try { node.disconnect(); } catch (e) { /* already disconnected */ }
            }), 150);
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

        /** Stops every pattern and one-shot and silences the output (hush). */
        stopAll() {
            if (this._stage('hush', () => this.stopAll())) return;
            this.channels.clear();
            this.streams.clear();
            this.channelCounter = 0;
            for (const shot of [...this._oneShots]) this._endOneShot(shot);
            this._halt();
        }

        /**
         * A stream whose pattern failed while playing: it is removed (from the
         * streams too, so no transition starts from it), the others play on,
         * and when it was the last one the clock stops. onError(error, info)
         * tells which stream it was and whether playback stopped.
         */
        _streamFailed(id, error) {
            console.error('TidalJS: pattern error, removing pattern:', error);
            this.channels.delete(id);
            if (typeof id === 'string') this.streams.delete(id);
            const stopped = this.channels.size === 0;
            if (stopped) this._halt();
            else this._reconcileTempo();
            if (typeof this.onError === 'function') this.onError(error, { stream: typeof id === 'string' ? id : null, stopped });
        }

        // --- Streams: mute and solo ------------------------------------

        /** True if a stream is heard: not muted, and soloed when any stream is. */
        isAudible(name) {
            const key = String(name);
            // Tidal: if hasSolo then psSolo else not psMute
            if (this.soloed.size > 0) return this.soloed.has(key);
            return !this.muted.has(key);
        }

        /** Mutes (or unmutes) a stream: d1 is mute(1) or mute("d1"). */
        mute(name, on = true) {
            const key = streamName(name);
            if (this._stage('mute', () => this.mute(key, on))) return;
            if (on) this.muted.add(key);
            else this.muted.delete(key);
            this._reconcileTempo();
        }

        /** Solos (or unsolos) a stream: only soloed streams are heard while any is. */
        solo(name, on = true) {
            const key = streamName(name);
            if (this._stage('solo', () => this.solo(key, on))) return;
            if (on) this.soloed.add(key);
            else this.soloed.delete(key);
            this._reconcileTempo();
        }

        unmuteAll() {
            if (this._stage('mute', () => this.unmuteAll())) return;
            this.muted.clear();
            this._reconcileTempo();
        }

        unsoloAll() {
            if (this._stage('solo', () => this.unsoloAll())) return;
            this.soloed.clear();
            this._reconcileTempo();
        }

        /** The playing streams in order, with their state, for the editor. */
        streamInfo() {
            return [...this.channels.keys()].filter((name) => typeof name === 'string').map((name) => ({
                name,
                muted: this.muted.has(name),
                soloed: this.soloed.has(name),
                audible: this.isAudible(name),
            }));
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
            // Tempo changes asked for ahead by streams that were removed, replaced or silenced since do not happen.
            this._reconcileTempo();
            this._pruneTimeline(now);
            // Events are asked for NUDGE_EARLY seconds before the horizon at which they are sent, so
            // one that a negative nudge moves earlier (up to NUDGE_EARLY) is known in time to play.
            const to = this.cycleAt(now + this.lookahead + NUDGE_EARLY);

            // Every audible stream's events since that stream was last asked. A stream that is new or
            // whose pattern changed takes over at the audible boundary, what was already sent: it is asked
            // from far enough back to cover onsets a positive nudge moves past that boundary (NUDGE_LATE
            // seconds, or further back to what the old pattern still held back), and of its events only
            // those sounding at or after the boundary go out. So a live update repeats nothing that was
            // sent (an onset moved earlier by a negative nudge) and drops nothing that was not (one moved
            // later), whether or not the old pattern had such an onset waiting. Simultaneous events keep a
            // fixed order: the streams' order, then the order each stream gives them. Silent streams are
            // asked too, for their tempo changes only (those count again if the stream is heard before them).
            let items = [];
            const requests = [];
            const handoffs = []; // replacements' events at onsets already sent but not yet passed (see below)
            let order = 0;
            for (const [id, pattern] of [...this.channels]) {
                const stream = order++;
                const asked = this._queried.get(id);
                const fresh = !asked || asked.pattern !== pattern;
                let from = asked && !fresh ? asked.to : this._dispatchCycle;
                // After a long stall (e.g. a suspended tab) skip ahead instead of firing a burst of late events.
                if (this.timeAt(from) < now - 0.5) from = this.cycleAt(now);
                if (fresh && Number.isFinite(this._sentHorizon)) {
                    // The look back starts from the boundary and is not subject to the stall rule: an onset whose
                    // nominal time is long past may still sound later (its nudge); late ones are skipped when sent.
                    // It never reaches before this run of the transport (Play, resetCycles): no onset was there.
                    let back = Math.max(this._timelineStart, this.cycleAt(Math.max(this._sentHorizon, now) - NUDGE_LATE));
                    for (const it of this._nudged) if (it.id === id && it.ev.begin < back) back = it.ev.begin;
                    if (back < from) from = back;
                }
                // No new cycles to ask for (after a sharp slowdown the frontier can be far ahead): events
                // held back still go out when their time comes (below).
                if (to <= from) continue;
                this._queried.set(id, { pattern, to });
                const audible = this.isAudible(id);
                let events;
                try {
                    events = pattern.query(from, to);
                } catch (error) {
                    if (audible) this._streamFailed(id, error);
                    continue;
                }
                // A replacement does not send again a hit its stream already sent, whatever its nudge now (nor
                // its tempo change); see _handoff, decided once this tick's tempo changes are in (below). Only
                // onsets where some new event can still sound (after what was sent, not too late) need deciding:
                // at the others every new event is dropped anyway (see _dispatch), so nothing of them is compared
                // (a long-nudged hit keeps its stream's records back to its onset; what lies between is skipped).
                // An onset not yet passed always is: tempo changes this tick may still move its events.
                const sentBefore = fresh && audible ? this._sentOnsets.get(id) : null;
                const atSent = [];
                const openAt = new Set();
                for (let i = 0; i < events.length; i++) {
                    const at = events[i].begin.toFixed(9);
                    const v = asObject(events[i].value);
                    // Each event keeps its stream and the pattern it came from, so one held back can be dropped
                    // when that stream is muted, replaced or removed before it goes out.
                    const item = audible ? { ev: events[i], v, stream, i, id, pattern, at, after: fresh ? this._sentHorizon : -Infinity } : null;
                    if (item) items.push(item);
                    if (item && sentBefore && sentBefore.has(at)) {
                        atSent.push(item);
                        if (!openAt.has(at)) {
                            const time = this._scheduledAt(events[i], v);
                            if (events[i].begin >= this._dispatchCycle || (time >= this._sentHorizon && time >= now - 0.02)) openAt.add(at);
                        }
                    }
                    // Tidal's cps control, settled when its event is sent or dropped (see _commitTempo). Onsets
                    // before what was sent were the old pattern's to make, except those a replacement recovers:
                    // still unsent, moved by a positive nudge to sound after the boundary (the tempo there follows
                    // the new version's control; the clock up to what was sent stays as it was).
                    if (isNum(v.cps) && v.cps > 0 && (events[i].begin >= this._dispatchCycle || (item && fresh && this._recovers(item, now)))) {
                        requests.push({ cycle: events[i].begin, cps: clamp(v.cps, 0.05, 10), owner: { id, pattern }, stream, i, item });
                    }
                }
                const open = atSent.filter((it) => openAt.has(it.at));
                if (open.length) handoffs.push({ id, pattern, items: open });
            }
            for (const id of [...this._queried.keys()]) if (!this.channels.has(id)) this._queried.delete(id);
            for (const id of [...this._sentOnsets.keys()]) if (!this.channels.has(id)) this._sentOnsets.delete(id);
            if (to > this._nextCycle) this._nextCycle = to;
            if (!this.isPlaying) return; // the last stream failed
            items.sort((a, b) => a.ev.begin - b.ev.begin || a.stream - b.stream || a.i - b.i);
            for (const it of items) it.seq = this._eventSeq++; // the tie-break, also against events held back

            // Tidal's cps control: an event changes the tempo from its onset
            // on, for every event that starts there or later (setcps is once . cps).
            // Owned by the stream (and its pattern) that asked for it, until the event carrying it is sent.
            requests.sort((a, b) => a.cycle - b.cycle || a.stream - b.stream || a.i - b.i);
            for (const r of requests) this._requestTempo(r.cycle, r.cps, r.owner, this._eventSeq++, r.item);
            if (requests.length) this._reconcileTempo();

            // The handoff, on the clock events go out on (a tempo change moves an onset, or where a nudged event
            // reads an absolute curve, how long a note is, and what a tempo-reading signal such as envelope()
            // gives): a hit already sent is dropped, with the tempo change it carries. Which tempo changes a
            // decision sees is fixed, so it never depends on another, nor on the order of layers or streams:
            // onsets are decided in cycle order, and each replacement event is judged (everything it reads,
            // see _judge) as it would sound if it played, on the clock with every tempo change that is not a
            // replacement's at an onset already sent, those of replacements at earlier cycles that were kept,
            // and its own; never another replacement's at its cycle or later, whatever its layer or stream (a
            // slowdown that comes with a sibling already sent changes nothing).
            if (handoffs.length) {
                const groups = [];
                for (const h of handoffs) {
                    const byOnset = new Map();
                    for (const it of h.items) {
                        if (!byOnset.has(it.at)) byOnset.set(it.at, []);
                        byOnset.get(it.at).push(it);
                    }
                    for (const list of byOnset.values()) groups.push({ id: h.id, pattern: h.pattern, cycle: list[0].ev.begin, items: list });
                }
                groups.sort((a, b) => a.cycle - b.cycle);
                const all = groups.flatMap((g) => g.items);
                const kept = new Set();
                const counted = (cycle, own) => {
                    for (const x of all) x.dropped = !(x === own || (kept.has(x) && x.ev.begin < cycle));
                    this._reconcileTempo();
                };
                for (const g of groups) {
                    // The old version's hits are read on the clock of the handoff (no replacement's tempo change at
                    // this cycle or later), each replacement on its own; curves only for pairs whose identities
                    // agree, so a layer that plays something else costs no curve read.
                    counted(g.cycle, null);
                    const old = this._oldHits(g.id, g.pattern, g.items[0].at);
                    const judged = g.items.map((it, k) => {
                        counted(g.cycle, it);
                        return this._judge(it, k, old);
                    });
                    const pairs = judged.map((j) => old.filter((o) => this._sameIdentity(o, j) && (o.follow || j.follow)));
                    const needed = new Set(pairs.flat());
                    if (needed.size) {
                        counted(g.cycle, null);
                        for (const o of needed) this._curvePoints(o);
                        judged.forEach((j, k) => {
                            if (!pairs[k].length) return;
                            counted(g.cycle, g.items[k]);
                            for (const o of pairs[k]) j.curves.set(o.src, this._sameCurves(o, j));
                        });
                    }
                    const already = this._handoff(old, judged);
                    g.items.forEach((it, k) => { if (!already.has(k)) kept.add(it); });
                }
                for (const x of all) x.dropped = !kept.has(x);
                this._reconcileTempo(); // (the tempo changes of the hits dropped no longer count)
                if (kept.size < all.length) items = items.filter((it) => !it.dropped);
            }

            // Then in the order they sound (nudge included), so the last word on
            // an orbit's effects or a cut group is the latest event's. A note's
            // length is its length in cycles at the tempo in force at its onset,
            // fixed when it starts (as SuperDirt's sustain): a tempo change met
            // later does not stretch or shorten notes already sounding.
            for (const it of items) {
                it.nudge = isNum(it.v.nudge) ? it.v.nudge : 0;
                if (it.nudge < -NUDGE_EARLY) {
                    // Earlier than the scheduler looks ahead for: it plays as early as it can (late).
                    this._warnOnce(`nudge ${+it.nudge.toFixed(3)} is earlier than ${-NUDGE_EARLY} s, the most the scheduler can honour: those events play ${-NUDGE_EARLY} s early`);
                    it.nudge = -NUDGE_EARLY;
                }
            }
            this._dispatch(items, now);
            this._commitTempo();
        }

        /**
         * Forgets what no one needs any more. The clock is needed back to the
         * earliest onset held back in any stream, how far back a replacement
         * looks (see _tick) or the playhead a second ago, whichever is
         * earliest: tempo segments that end before it go (notes held back keep
         * the mapping of their onset, however many tempo changes came since).
         * A stream's records of the hits it sent (see _handoff) are needed
         * back to how far a replacement of that stream looks: the look back,
         * or that stream's own earliest onset held back, never another's.
         */
        _pruneTimeline(now) {
            const edge = Number.isFinite(this._sentHorizon) ? Math.max(this._sentHorizon, now) : now;
            const lookback = Math.min(this.cycleAt(edge - NUDGE_LATE), this.cycleAt(now - 1));
            let floor = lookback;
            const heldFrom = new Map(); // stream -> its earliest onset held back
            for (const it of this._nudged) {
                if (it.ev.begin < floor) floor = it.ev.begin;
                if (!(heldFrom.get(it.id) <= it.ev.begin)) heldFrom.set(it.id, it.ev.begin);
            }
            // The clock and the copy of it that tempo requests are rebuilt from (see _reconcileTempo), so a
            // reconciliation does not bring back what was pruned.
            pruneSegments(this._tempoHistory, this._anchorCycle, floor);
            if (this._tempoPast) pruneSegments(this._tempoPast.history, this._tempoPast.cycle, floor);
            for (const [id, onsets] of this._sentOnsets) {
                const keep = heldFrom.has(id) ? Math.min(lookback, heldFrom.get(id)) : lookback;
                for (const [at, sent] of onsets) if (sent.cycle < keep) onsets.delete(at);
            }
        }

        /**
         * The old version's hits at an onset where its stream sent something:
         * those sent (with what they played: see _dispatch) and those still
         * held back (their identity read on the clock as it is).
         */
        _oldHits(id, pattern, at) {
            const record = this._sentOnsets.get(id).get(at);
            const old = record.hits.map((h) => ({ ...h, sent: true, src: h }));
            for (const it of this._nudged) {
                if (it.id !== id || it.pattern === pattern || it.at !== at) continue;
                old.push({ nudge: nudgeOf(it.v), follow: followOf(it.v), ev: it.ev, sent: false, src: it, fp: this._hitIdentity(it.v, it.ev, this._clockView(it.ev, it.v)) });
            }
            return old;
        }

        /**
         * A replacement event's identity against each old hit, on the clock as
         * it is now (the caller sets the clock it is judged on): when it would
         * sound and its output there (see _hitIdentity), also at the take
         * indices of each sent hit that read take lists (the counters have
         * moved on since; simultaneous layers sharing a counter each used their
         * own index). Signals that read the tempo (envelope()) are read on that
         * clock too. Its curves are compared later, only where the identities
         * agree (see _tick and _sameCurves).
         */
        _judge(it, i, old) {
            const view = this._clockView(it.ev, it.v);
            const fresh = { i, nudge: nudgeOf(it.v), follow: followOf(it.v), ev: it.ev, view };
            const fp = this._hitIdentity(it.v, it.ev, view);
            const identity = new Map(); // old hit -> its identity as read against it
            const byTakes = new Map();
            for (const o of old) {
                let mine = fp;
                if (o.sent && o.takes) {
                    const at = [...o.takes].map(([counter, index]) => counter + '=' + index).join('&');
                    if (!byTakes.has(at)) byTakes.set(at, this._hitIdentity(it.v, it.ev, view, null, o.takes));
                    mine = byTakes.get(at);
                }
                identity.set(o.src, mine);
            }
            return { ...fresh, identity, curves: new Map() }; // (curves: old hit -> whether they are the same)
        }

        /** Whether a judged replacement event and an old hit play the same, curves aside (a truncated identity proves nothing). */
        _sameIdentity(o, j) {
            const fp = j.identity.get(o.src);
            return !fp.truncated && !o.fp.truncated && fp.key === o.fp.key;
        }

        /**
         * Where an old hit's followed curves are compared, on the clock as it
         * is now (the clock of the handoff): what its voice read while laying
         * it out (a sent hit), or else its curves over its nominal span at its
         * tempo there (see Follows.samples). A signal that fails there leaves
         * nothing to compare (inconclusive).
         */
        _curvePoints(o) {
            if (o.points !== undefined || !o.follow) return;
            if (o.reads && o.reads.length) {
                o.points = o.reads;
                return;
            }
            try {
                o.points = o.follow.samples(o.ev.begin, o.ev.end, this._cpsAt(o.ev.begin));
            } catch (error) {
                console.error('TidalJS: could not compare followed curves:', error);
                o.points = null;
            }
        }

        /**
         * Which replacement events (their indices, as judged: see _judge) are
         * hits their stream already sent, at one onset. A new event plays the
         * same as an old hit when their identities agree (a truncated one
         * agrees with none) and so do their followed curves. They are matched
         * with the old version's hits there, sent and still held back alike:
         * first those whose nudge is unchanged, then the rest in nudge order
         * (sooner with sooner). A new event matched with a sent hit is not
         * sent again; one matched with a held-back hit, or with none, is the
         * new version's to play. So layers may be reordered, added or removed,
         * and of identical simultaneous hits a sent one never stands for an
         * unsent sibling.
         */
        _handoff(oldHits, judged) {
            const already = new Set();
            if (!oldHits.some((o) => o.sent) || !judged.length) return already;
            const same = (o, f) => this._sameIdentity(o, f) && (!o.follow && !f.follow ? true : f.curves.get(o.src) === true);
            const old = oldHits.slice();
            const rest = [];
            const pair = (f, k) => {
                if (old[k].sent) already.add(f.i);
                old.splice(k, 1);
            };
            for (const f of judged) {
                const k = old.findIndex((o) => Math.abs(o.nudge - f.nudge) < 1e-9 && same(o, f));
                if (k < 0) rest.push(f);
                else pair(f, k);
            }
            old.sort((a, b) => a.nudge - b.nudge || (a.sent ? 0 : 1) - (b.sent ? 0 : 1));
            rest.sort((a, b) => a.nudge - b.nudge || a.i - b.i);
            for (const f of rest) {
                const k = old.findIndex((o) => same(o, f));
                if (k >= 0) pair(f, k);
            }
            return already;
        }

        /**
         * An event's values as they go out at `time`: the next value of its
         * take lists (nTake, gainTake...; counted, so `advance` only when it
         * is really played; `indices` reads given ones instead, and `used`
         * collects the ones read) and its followed controls at that onset,
         * with the signals bound to it (see Follows.bind). Resolved once: an
         * event already resolved (no takes, its signals bound) comes back as
         * it is.
         */
        _resolveOutput(v, time, advance, indices, used, at) {
            const next = (counter, list) => {
                let index;
                if (indices && indices.has(counter)) {
                    index = indices.get(counter);
                } else {
                    index = this._nTakeCounters.get(counter) || 0;
                    if (advance) this._nTakeCounters.set(counter, index + 1);
                }
                if (used) used.set(counter, index);
                return list[index % list.length];
            };
            if (v.nTake) {
                // The next value of the list, counted per name across cycles.
                v = { ...v, n: next(v.nTake.name, v.nTake.list) };
                delete v.nTake;
            }
            if (Array.isArray(v.takes)) {
                // gainTake, panTake... (Tidal's *Take): the next value of each list.
                v = { ...v };
                for (const { key, name, list } of v.takes) v[key] = next(`${key}:${name}`, list);
                delete v.takes;
            }
            if (v.follow instanceof Follows && !v.follow.onset) {
                // The followed controls start at their signals' values at the onset (`at`: its cycle, when given).
                const cycle = at === undefined ? this.cycleAt(time) : at;
                const follow = v.follow.bind(cycle, time, this.cps);
                v = { ...v, follow };
                for (const key of follow.names()) {
                    const x = follow.valueAt(key, cycle, cycle);
                    if (x !== undefined) v[key] = x;
                }
            }
            return v;
        }

        /** When an event would sound: its onset on the clock as it is, moved by its nudge (see _tick). */
        _scheduledAt(ev, v) {
            return this.timeAt(ev.begin) + Math.max(nudgeOf(v), -NUDGE_EARLY);
        }

        /**
         * What a hit's identity reads from the clock, taken from the clock as
         * it is now: when it would sound, the cycle there, and the tempo at its
         * onset (a MIDI note's length). Fixed once taken, so a hit can be
         * judged on a clock of its own (see _tick).
         */
        _clockView(ev, v) {
            const time = this._scheduledAt(ev, v);
            return { time, cycle: this.cycleAt(time), cps: this._cpsAt(ev.begin) };
        }

        /**
         * What a hit plays, to match it at a handoff (see _handoff): for a
         * voice, its fingerprint (hitFingerprint); for MIDI and OSC, what that
         * output sends, with its followed controls at the onset it is
         * scheduled for (an absolute .follow() gives a nudged note another
         * value) and nothing else of their curves: the MIDI channel, messages
         * and note (key, velocity, length), or the OSC address and arguments
         * but the cycle and tempo (timing, like the nudge). A filter change
         * MIDI does not send is no change there.
         */
        _hitIdentity(v, ev, view, resolved, indices) {
            if (v.midi === undefined && v.osc === undefined) return hitFingerprint(v, ev);
            try {
                // What was really sent (a sent hit), or what would be on the clock `view` was taken from (take
                // counters left as they are, or the indices the hit sent at that onset used).
                const out = resolved || this._resolveOutput(v, view.time, false, indices, null, view.cycle);
                const duration = (ev.end - ev.begin) / view.cps;
                if (v.midi !== undefined) {
                    const m = midiEventOf(out, duration);
                    const note = m.note ? [m.note.key, m.note.velocity, +m.note.length.toFixed(6)] : null;
                    return { key: 'midi:' + JSON.stringify([String(v.midi), m.channel, m.controls, note]), truncated: false };
                }
                const args = [];
                for (const key of Object.keys(out).sort()) {
                    const value = out[key];
                    if (key === 'osc' || key === 'nudge' || key === 'cps') continue;
                    if (typeof value === 'number' || typeof value === 'string') args.push(key, value);
                }
                return { key: 'osc:' + JSON.stringify([String(v.osc), +duration.toFixed(6), args]), truncated: false };
            } catch (error) {
                return { key: '', truncated: true }; // (a signal that fails at the onset: undecided)
            }
        }

        /**
         * Whether a new event's followed curves are those of an old hit (both
         * follow the same controls and span the same: see hitFingerprint),
         * value for value at the old hit's points (see _curvePoints: what its
         * voice read, or its curves over its span on the clock of the handoff),
         * the new event's read there on the clock as it is now (its own).
         */
        _sameCurves(old, fresh) {
            if (!old.follow && !fresh.follow) return true;
            if (!old.follow || !fresh.follow || !old.points) return false;
            // A signal that fails where it is read proves nothing: the comparison is inconclusive (not the same),
            // so the new event plays; the tick goes on.
            try {
                return old.points.every(([name, t, onset, x]) => {
                    const y = fresh.follow.valueAt(name, t, onset);
                    return x === y || (isNum(x) && isNum(y) && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x)));
                });
            } catch (error) {
                console.error('TidalJS: could not compare followed curves:', error);
                return false;
            }
        }

        /**
         * True when a replacement's event from before what was sent will still
         * sound, and in time: its onset is behind the boundary, but a positive
         * nudge moves it past what was sent. Its time comes from the clock as
         * sent, which does not change.
         */
        _recovers(item, now) {
            const nudge = isNum(item.v.nudge) ? item.v.nudge : 0;
            const time = this.timeAt(item.ev.begin) + nudge;
            return time >= item.after && time >= now - 0.02;
        }

        /**
         * Sends the events whose time is within this tick's horizon, in the
         * order they sound. Events are known NUDGE_EARLY ahead of it, so one
         * that a negative nudge (up to NUDGE_EARLY) moves earlier still goes
         * out in order and on time; one beyond the horizon (nudged later, or
         * after a slowdown) waits for the tick that reaches its time. An
         * event held back is dropped if its stream was muted, replaced or
         * removed meanwhile. An event whose time has passed (after a stall)
         * is skipped, and dropped like those.
         */
        _dispatch(fresh, now) {
            const horizon = now + this.lookahead;
            const current = (it) => this.channels.get(it.id) === it.pattern && this.isAudible(it.id);
            const all = [];
            for (const it of this._nudged) {
                if (current(it)) all.push(it);
                else it.dropped = true; // (a tempo request it carries goes with it: see _commitTempo)
            }
            for (const it of fresh) all.push(it);
            // Times from the clock as it is now (a tempo change since an event was asked for applies).
            for (const it of all) {
                it.base = this.timeAt(it.ev.begin);
                it.time = it.base + it.nudge;
                it.duration = (it.ev.end - it.ev.begin) / this._cpsAt(it.ev.begin);
            }
            all.sort((a, b) => a.time - b.time || a.seq - b.seq);
            // A replacement's events before the boundary it took over at were the old pattern's to play.
            const live = [];
            for (const it of all) {
                if (it.time < it.after) it.dropped = true;
                else live.push(it);
            }
            this._nudged = live.filter((it) => it.time >= horizon);
            const sent = this.cycleAt(horizon);
            if (sent > this._dispatchCycle) this._dispatchCycle = sent;
            if (horizon > this._sentHorizon) this._sentHorizon = horizon;
            for (const it of live) {
                if (it.time >= horizon) break;
                if (it.time < now - 0.02) {
                    // Too late (after a stall): skipped, so never sent; a tempo change it carries is undone from
                    // what is sent now on (see _commitTempo), the clock for what was already sent stays.
                    it.dropped = true;
                    continue;
                }
                it.sent = true;
                let onsets = this._sentOnsets.get(it.id);
                if (!onsets) this._sentOnsets.set(it.id, (onsets = new Map()));
                let sentAt = onsets.get(it.at);
                if (!sentAt) onsets.set(it.at, (sentAt = { cycle: it.ev.begin, hits: [] }));
                // What it plays as it goes out (a value object changed in place later does not change it), and
                // of its followed curves what its voice reads from them while it is laid out (nothing more).
                const follow = followOf(it.v);
                const at = Math.max(it.time, now);
                const hit = { fp: null, nudge: nudgeOf(it.v), follow, reads: null, ev: it.ev }; // (its own span)
                sentAt.hits.push(hit);
                const reads = follow ? [] : null;
                FOLLOW_READS.list = reads;
                PLAYED.on = true;
                PLAYED.v = null;
                PLAYED.takes = null;
                try {
                    this.playEvent(it.v, at, it.duration);
                } catch (error) {
                    console.error('TidalJS: could not play event:', error);
                } finally {
                    FOLLOW_READS.list = null;
                    PLAYED.on = false;
                }
                // Its identity from the values it went out with (resolved once, takes and followed onsets included).
                hit.fp = this._hitIdentity(it.v, it.ev, { time: at, cycle: this.cycleAt(at), cps: this._cpsAt(it.ev.begin) }, PLAYED.v);
                hit.takes = PLAYED.takes && PLAYED.takes.size ? PLAYED.takes : null;
                PLAYED.v = null;
                PLAYED.takes = null;
                hit.reads = reads;
            }
        }

        /**
         * Events of all playing patterns in [begin, end), for visualisation.
         * Muted (or not soloed) streams are left out, unless `includeSilent`:
         * then their events come too, marked `silent: true`, and every event
         * carries the name of its stream (`stream`, null for an unnamed one).
         */
        queryActive(begin, end, includeSilent = false) {
            const out = [];
            for (const [id, pattern] of this.channels) {
                const audible = this.isAudible(id);
                if (!audible && !includeSilent) continue;
                try {
                    const stream = typeof id === 'string' ? id : null;
                    for (const ev of pattern.query(begin, end)) {
                        if (!includeSilent) out.push(ev);
                        else out.push(audible ? { ...ev, stream } : { ...ev, stream, silent: true });
                    }
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
            const unresolved = new Set(); // sounds that only a manifest this code asks for (not arrived yet) may hold
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
            // slider(), toggle(), controlLayout(), midikeys() and oscplay() of this code: they replace the old ones only if it plays.
            this._live = { controls: new Map(), layouts: [], midiKeys: [], oscPlays: [] };
            // Commands (setCPS, hush, setOutput, once...) wait for the commit (see _stage).
            const txn = [];
            this._txn = txn;
            this._txnCps = undefined;
            this._txnBanks = new Set(); // banks samples() stages in this code
            this._txnPendingLoads = []; // and the manifests it asks for that have not arrived
            // options.cps: the tempo the document brings (the editor's draft tempo). It is staged first, so
            // it applies only if the code commits, and a setCPS() in the code has the last word.
            if (isNum(options.cps) && options.cps > 0) this.setCPS(options.cps);
            let committed = false;
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
                // only(pattern): Tidal's only = hush >> ..., so only those play.
                if (patterns.some((p) => p._only)) patterns.splice(0, patterns.length, ...patterns.filter((p) => p._only));
                // Query a few cycles up front: surfaces errors and unknown
                // sounds now instead of in the middle of playback.
                // Sample files used early on start loading now. Unknown
                // names are not reported while sample banks are still loading:
                // they may be in them.
                for (const p of patterns) {
                    current = origin.get(p);
                    for (const ev of p.query(0, 4)) {
                        const v = asObject(ev.value);
                        if (isNum(v.nudge) && v.nudge < -NUDGE_EARLY) {
                            warnings.add(`nudge ${+v.nudge.toFixed(3)} is earlier than ${-NUDGE_EARLY} s, the most the scheduler can honour: those events play ${-NUDGE_EARLY} s early`);
                        }
                        if (v.midi !== undefined || v.osc !== undefined || !v.s) continue;
                        const bank = this.sampleBanks.get(v.s);
                        if (bank) {
                            const pitched = this._pitchedFile(v.s, isNum(v.note) ? v.note : isNum(v.midinote) ? v.midinote : 60);
                            if (this.audioContext) this._sampleBuffer(pitched ? pitched.url : this._sampleUrl(bank, v), false);
                        } else if (!this.samples.has(v.s) && !this._txnBanks.has(v.s)) {
                            // Unknown, unless a bank this code adds may hold it: a manifest this code asks for that has
                            // not arrived yet (one that failed, or a fetch other code left, does not count). Then the
                            // name waits: a live update is held back until it is known (see below).
                            if (this._txnPendingLoads.length) unresolved.add(v.s);
                            else warnings.add(`Unknown sound "${v.s}"`);
                        }
                    }
                }
                // A stream used twice is a warning too, so a live update holds back on it.
                const named = new Set();
                let unnamedSeen = 0;
                for (const p of patterns) {
                    const name = p._stream || '#' + (++unnamedSeen);
                    current = origin.get(p);
                    if (named.has(name)) warnings.add(`Stream ${name} is used twice; the last one plays`);
                    named.add(name);
                }

                // A live update holds back on warnings, and on sounds a bank it asks for may still bring: the
                // playing streams stay until the manifest arrives and the code is checked again.
                // samplesSettled tells when the manifests it waits for have arrived or failed (it never rejects),
                // so the code is checked again once, for those loads; a failed one brings nothing, so the check
                // after it ends in a warning instead of waiting again.
                if (options.keepOnWarnings && (warnings.size > 0 || unresolved.size > 0)) {
                    const waiting = unresolved.size > 0 && warnings.size === 0;
                    return {
                        success: false, pending: true, activePatterns: this.channels.size, warnings: [...warnings],
                        waitingForSamples: waiting ? [...unresolved] : undefined,
                        samplesSettled: waiting ? Promise.allSettled(this._txnPendingLoads).then(() => undefined) : undefined,
                    };
                }

                // Each pattern plays in a stream: d1 to d16 or p("name") name
                // theirs, the others are #1, #2... in order. A transition starts
                // from the stream's previous pattern. A hush() in the code
                // clears the streams first, as if it had run before them.
                const hushed = txn.some((op) => op.kind === 'hush' || op.kind === 'panic');
                const before = hushed ? new Map() : this.streams;
                const wasPlaying = this.isPlaying && !hushed;
                const now = wasPlaying ? this._nextCycle : 0;
                // In live updates a stream whose code is the same, and whose
                // declarations and other statements are the same, keeps playing
                // as it was, so a running transition is not restarted by editing
                // another line (see streamSources).
                const sourceOf = streamSources(statements, new Set(origin.values()));
                const streams = new Map();
                const ordinal = new Map();
                let unnamed = 0;
                for (const p of patterns) {
                    const name = p._stream || '#' + (++unnamed);
                    current = origin.get(p);
                    const nth = (ordinal.get(current) || 0) + 1;
                    ordinal.set(current, nth);
                    const source = sourceOf(current) + '\u0001' + nth;
                    const prev = before.get(name);
                    const history = prev ? [prev.pattern, ...(prev.history || [])].slice(0, 16) : [];
                    if (options.keepUnchanged && wasPlaying && prev && prev.source === source) {
                        streams.set(name, prev);
                    } else if (p._transition) {
                        // As in Tidal, a stream with no history (or stopped) starts from silence.
                        const old = prev && wasPlaying ? prev.pattern : silence(this);
                        streams.set(name, { pattern: p, history, playing: p._transition(now, p, old, history), source });
                    } else {
                        streams.set(name, { pattern: p, history, playing: p, source });
                    }
                }

                // Commit: the staged commands in order, then the streams, the controls and the clock.
                this._txn = null;
                committed = true;
                for (const op of txn) {
                    try {
                        op.apply();
                    } catch (error) {
                        console.error('TidalJS:', error);
                        warnings.add(error && error.message ? error.message : String(error));
                    }
                }
                this.streams = streams;
                this.channels = new Map([...streams].map(([name, s]) => [name, s.playing]));
                this._reconcileTempo(); // tempo changes ahead from streams this code removed or replaced go
                this._collecting = null;
                // The controls and keyboards of this code replace the old ones (those not used any more go).
                const live = this._live;
                this._live = null;
                this._midiKeys = live.midiKeys;
                this._oscPlays = live.oscPlays;
                this._controls = live.controls;
                this._layouts = live.layouts;
                this._notifyControls();
                if (patterns.length > 0) this._start();
                else if (this.isPlaying) this._halt();

                return { success: true, activePatterns: patterns.length, warnings: [...warnings] };
            } catch (error) {
                return fail(error, current);
            } finally {
                if (!committed) {
                    for (const op of txn) {
                        try { if (op.discard) op.discard(); } catch (e) { /* nothing to undo */ }
                    }
                }
                this._txn = null;
                this._txnCps = undefined;
                this._txnBanks = null;
                this._txnPendingLoads = [];
                this._collecting = null;
                this._warnings = null;
                this._live = null;
            }
        }

        // --- Live controls (slider, toggle) ----------------------------

        /**
         * Registers a slider or a toggle. A control that exists keeps its value
         * (re-running code does not reset it) and takes the new range. While
         * code is evaluated, it goes with that code's controls.
         */
        _registerControl(kind, name, value, min, max, step) {
            if (name === undefined || name === null || String(name).trim() === '') {
                throw new TypeError(`${kind}() expects a name, e.g. ${kind === 'slider' ? 'slider("cutoff", 800, 200, 4000)' : 'toggle("hats", true)'}`);
            }
            const key = String(name).trim();
            let lo = toNumber(min) ?? 0;
            let hi = toNumber(max) ?? 1;
            if (hi < lo) [lo, hi] = [hi, lo];
            const c = { name: key, kind, value: lo, min: lo, max: hi, step: Math.max(0, toNumber(step) ?? 0) };
            const pending = this._live ? this._live.controls : null;
            const prev = (pending && pending.get(key)) || this._controls.get(key);
            const start = toNumber(value);
            const initial = prev && prev.kind === kind ? prev.value
                : this._controlPresets.has(key) ? this._controlPresets.get(key)
                    : start === undefined ? lo : start;
            c.value = controlValue(c, initial);
            if (pending) pending.set(key, c);
            else {
                this._controls.set(key, c);
                this._notifyControls();
            }
            return c;
        }

        /** The current value of a control (those of the code being evaluated first), or `fallback`. */
        _controlValue(name, fallback) {
            const c = (this._live && this._live.controls.get(name)) || this._controls.get(name);
            return c ? c.value : fallback;
        }

        /** The live controls of the code that plays: [{ name, kind, value, min, max, step }]. */
        controls() {
            return [...this._controls.values()].map((c) => ({ ...c }));
        }

        /** Sets a control's value (kept within its range and step); returns the value set, or undefined if there is no such control. */
        setControl(name, value) {
            const c = this._controls.get(String(name));
            if (!c) return undefined;
            const x = controlValue(c, value);
            if (this._controlPresets.has(c.name)) this._controlPresets.set(c.name, x);
            if (x !== c.value) {
                c.value = x;
                this._notifyControls();
                this._liveChanged();
            }
            return x;
        }

        /**
         * Registers a controlLayout(title, rows): a titled group of rows of
         * control names for the Controls panel. While code is evaluated, it
         * goes with that code's layouts (they replace the old ones if it plays).
         */
        _registerLayout(title, rows) {
            const example = 'e.g. controlLayout("Synth", [["cutoff", "res"], ["amp", "on"]])';
            if (title !== undefined && title !== null && typeof title !== 'string' && typeof title !== 'number') {
                throw new TypeError(`controlLayout() expects a title and rows of control names, ${example}`);
            }
            if (!Array.isArray(rows)) throw new TypeError(`controlLayout() expects rows of control names (a list of lists), ${example}`);
            const name = (x) => {
                if (typeof x !== 'string' && typeof x !== 'number') throw new TypeError(`controlLayout(): control names are strings, ${example}`);
                return String(x).trim();
            };
            // A name on its own is a row of one control.
            const layout = {
                title: title === undefined || title === null ? '' : String(title),
                rows: rows.map((row) => (Array.isArray(row) ? row.map(name) : [name(row)]).filter(Boolean)).filter((row) => row.length),
            };
            if (this._live) this._live.layouts.push(layout);
            else {
                this._layouts.push(layout);
                this._notifyControls();
            }
        }

        /** The controlLayout() groups of the code that plays, in call order: [{ title, rows: [[name, ...], ...] }]. */
        controlLayouts() {
            return this._layouts.map((l) => ({ title: l.title, rows: l.rows.map((row) => row.slice()) }));
        }

        /** Calls fn(controls(), controlLayouts()) whenever the controls, their values or the layouts change. Returns a function that stops it. */
        onControls(fn) {
            this._controlListeners.add(fn);
            return () => this._controlListeners.delete(fn);
        }

        /** Values for controls by name (e.g. saved by the editor), used when they are created and set on those that exist. */
        restoreControls(values) {
            for (const [name, value] of Object.entries(values || {})) {
                const x = toNumber(value);
                if (x === undefined) continue;
                this._controlPresets.set(name, x);
                if (this._controls.has(name)) this.setControl(name, x);
            }
        }

        _notifyControls() {
            const list = this.controls();
            const layouts = this.controlLayouts();
            for (const fn of this._controlListeners) {
                try { fn(list, layouts); } catch (e) { console.error('TidalJS: controls listener failed:', e); }
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
            return { out, nodes: [out], orbits: new Map(), cuts: new Map() };
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
                } else if (kind === 'shape') {
                    // SuperDirt's shape: amount 0 to 0.99, as a hundredth here.
                    const a = amount / 100;
                    const k = (2 * a) / (1 - a);
                    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
                } else if (kind === 'krush') {
                    // SuperDirt's krush (from Sonic Pi's krush), amount in hundredths.
                    const k = amount / 100;
                    curve[i] = (x * x + k * x) / (x * x + Math.abs(x) * (k - 1) + 1);
                } else if (kind === 'triode') {
                    // SuperDirt's triode: the negative half saturates, amount in hundredths.
                    const sc = (amount / 100) * 10 + 1e-3;
                    curve[i] = x > 0 ? x : Math.tanh(x * sc) / sc;
                } else if (kind === 'gabber') {
                    // The gabber kick's distortion: tanh(100x) + (sign(x) - x) at -8 dB.
                    curve[i] = Math.tanh(100 * x) + (Math.sign(x) - x) * Math.pow(10, -8 / 20);
                } else if (kind === 'atan') {
                    // atan(3x) for inputs from -amount to amount (fed scaled down by amount).
                    curve[i] = Math.atan(3 * amount * x);
                } else {
                    // crush, amount in hundredths
                    const step = Math.pow(0.5, amount / 100 - 1);
                    curve[i] = Math.round(x / step) * step;
                }
            }
            this._curves.set(key, curve);
            return curve;
        }

        /**
         * SuperDirt's global effects: one delay and one reverb per orbit, fed by
         * every sound of the orbit. They are made when an event first uses them.
         */
        _orbitEffects(orbit) {
            const session = this._session;
            if (!session.orbits.has(orbit)) session.orbits.set(orbit, { delay: null, reverb: null, state: { delaytime: 0, lock: 0 } });
            return session.orbits.get(orbit);
        }

        /** The orbit's delay (dirt_delay): input -> delay with feedback -> delayAmp -> output. */
        _orbitDelay(fx) {
            if (fx.delay) return fx.delay;
            const ctx = this.audioContext;
            const session = this._session;
            const input = ctx.createGain();
            const line = ctx.createDelay(4);
            const feedback = ctx.createGain();
            const amp = ctx.createGain();
            line.delayTime.value = 0;
            feedback.gain.value = 0;
            amp.gain.value = 0;
            input.connect(line);
            line.connect(feedback);
            feedback.connect(line);
            line.connect(amp);
            amp.connect(session.out);
            session.nodes.push(input, line, feedback, amp);
            fx.delay = { input, line, feedback, amp };
            return fx.delay;
        }

        /** The orbit's reverb (dirt_reverb): input * room -> the reverb of the current size -> * (1 - dry) -> output. */
        _orbitReverb(fx) {
            if (fx.reverb) return fx.reverb;
            const ctx = this.audioContext;
            const session = this._session;
            const input = ctx.createGain();
            const out = ctx.createGain();
            input.gain.value = 0;
            out.gain.value = 1;
            out.connect(session.out);
            session.nodes.push(input, out);
            fx.reverb = { input, out, sizes: new Map(), size: null };
            this._reverbSize(fx.reverb, 0.1, ctx.currentTime);
            return fx.reverb;
        }

        /** Switches the orbit's reverb to another size at `time`; the old one's tail rings on. */
        _reverbSize(reverb, size, time) {
            const key = Math.round(clamp(size, 0, 1) * 20);
            if (reverb.size === key) return;
            const ctx = this.audioContext;
            if (!reverb.sizes.has(key)) {
                const gate = ctx.createGain();
                const convolver = ctx.createConvolver();
                convolver.buffer = this._impulseResponse(key / 20);
                gate.gain.value = 0;
                reverb.input.connect(gate);
                gate.connect(convolver);
                convolver.connect(reverb.out);
                this._session.nodes.push(gate, convolver);
                reverb.sizes.set(key, gate);
            }
            if (reverb.size !== null) reverb.sizes.get(reverb.size).gain.setValueAtTime(0, time);
            reverb.sizes.get(key).gain.setValueAtTime(1, time);
            reverb.size = key;
        }

        /**
         * An event sets its orbit's global effects at its start, as in SuperDirt:
         * delay (the delay's level; 0 when the event has none), delaytime,
         * delayfeedback and lock when it has them; room (the reverb's input),
         * size and dry (1 - the reverb's level) when it has them. Every sound
         * of the orbit feeds both, so other patterns on the orbit hear them too.
         */
        _orbitSend(node, v, time, orbit, sends = null) {
            const fx = this._orbitEffects(orbit);
            // A voice connects to each bus once (a tied event sends the same voice again).
            const link = (input) => {
                if (sends && sends.has(input)) return;
                if (sends) sends.add(input);
                node.connect(input);
            };
            if (isNum(v.delay) && v.delay > 0) this._orbitDelay(fx);
            if (fx.delay) {
                const d = fx.delay;
                if (isNum(v.delaytime)) fx.state.delaytime = clamp(v.delaytime, 0, 4);
                if (isNum(v.lock)) fx.state.lock = v.lock;
                const seconds = fx.state.lock >= 1 ? fx.state.delaytime / this.cps : fx.state.delaytime;
                d.line.delayTime.setValueAtTime(clamp(seconds, 0, 4), time);
                if (isNum(v.delayfeedback)) d.feedback.gain.setValueAtTime(clamp(v.delayfeedback, 0, 0.99), time);
                d.amp.gain.setValueAtTime(isNum(v.delay) ? clamp(v.delay, 0, 1) : 0, time);
                link(d.input);
            }
            if (isNum(v.reverb) && v.reverb > 0) this._orbitReverb(fx);
            if (fx.reverb) {
                const r = fx.reverb;
                if (isNum(v.reverb)) r.input.gain.setValueAtTime(clamp(v.reverb, 0, 1), time);
                if (isNum(v.size)) this._reverbSize(r, v.size, time);
                if (isNum(v.dry)) r.out.gain.setValueAtTime(1 - clamp(v.dry, 0, 1), time);
                link(r.input);
            }
        }

        /**
         * Sends a voice through its effects, in SuperDirt's order: vowel,
         * shape, high-pass, band-pass, crush, low-pass, the peak equaliser,
         * tremolo, phaser, waveloss, squiz, fshift, triode, krush, octer,
         * ring, distortion, the spectral effects, the DJ filter, leslie and
         * pan; then to the output and to the delay and reverb buses of its
         * orbit. `timing` ({ time, holdEnd, release, freq }) drives the
         * filter envelopes and fshiftnote. The voice nodes are released when
         * the sources end; the effect tails live on in the buses.
         */
        _route(input, v, sources, extraNodes, timing = null) {
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
            const gainNode = (value) => {
                const g = ctx.createGain();
                g.gain.value = value;
                nodes.push(g);
                return g;
            };
            // A waveshaper; amount null leaves it without a curve (it passes the
            // sound as it is) until a tied event gives it one.
            const shaper = (kind, amount, oversample = '2x') => {
                const ws = ctx.createWaveShaper();
                ws.curve = amount === null ? null : this._curve(kind, amount);
                ws.oversample = oversample;
                add(ws);
                return ws;
            };

            // Oscillators that modulate this voice (ring, tremolo, phaser, leslie); stopped with it.
            const lfos = [];
            const lfo = (freq, depth, target, type = 'sine') => {
                const osc = ctx.createOscillator();
                const amount = ctx.createGain();
                osc.type = type;
                osc.frequency.value = freq;
                amount.gain.value = depth;
                osc.connect(amount);
                amount.connect(target);
                osc.start();
                lfos.push(osc);
                nodes.push(osc, amount);
                return { freq: osc.frequency, amount: amount.gain };
            };

            // The parameters follow() and tie change later (see _applyFollows and _retie).
            const params = {};
            const follows = v.follow instanceof Follows && v.follow.onset ? v.follow : null;
            const followed = (...keys) => !!follows && keys.some((key) => follows.has(key));
            // A tied voice (tie()) builds the effects it can change even when
            // this event does not use them, set so they leave the sound as it
            // is; a later event of the tie turns them on (see _retie).
            const tied = !!(timing && timing.tied);
            const updates = [];
            const when = (time, fn) => this._atTime(time, fn);

            // A filter, with its envelope when prefix is lp, hp, bp or peak (see _filterEnvelope).
            // A followed cutoff (key: lpf, hpf or bpf) replaces the envelope.
            const filter = (type, freq, q, prefix, gain, key) => {
                const f = ctx.createBiquadFilter();
                f.type = type;
                f.frequency.value = clamp(freq, 20, 20000);
                f.Q.value = q;
                if (gain !== undefined) f.gain.value = gain;
                if (prefix && timing && !(key && follows && follows.has(key))) this._filterEnvelope(f.frequency, freq, v, prefix, timing);
                add(f);
                if (key) params[key] = { freq: f.frequency, q: f.Q };
                return f;
            };

            // An AudioWorklet effect (see fxWorkletModule), once the module is loaded.
            // A tied voice's worklet takes the new settings of the keys a later event gives.
            const worklet = (kind, options, label, keys, settings) => {
                const fx = this._workletNode(kind, options, label);
                if (!fx) return;
                add(fx);
                if (tied && keys) {
                    const state = { ...options };
                    updates.push((e, time, info) => {
                        if (!keys.some((key) => isNum(e[key]))) return;
                        Object.assign(state, settings(e, state, info));
                        this._workletSet(fx, time, state);
                    });
                }
            };

            const vowel = v.vowel && VOWELS[v.vowel] ? v.vowel : null;
            if (vowel || tied) {
                const vin = gainNode(1);
                const vout = gainNode(vowel ? 2 : 0);
                const formants = VOWELS[vowel || 'a'].map((freq, i) => {
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
                    return f;
                });
                node.connect(vin);
                if (tied) {
                    // Without a vowel the sound goes round the formants.
                    const dry = gainNode(vowel ? 0 : 1);
                    const out = gainNode(1);
                    node.connect(dry);
                    dry.connect(out);
                    vout.connect(out);
                    node = out;
                    params.vowel = { dry: dry.gain, wet: vout.gain };
                    updates.push((e, time) => {
                        if (!e.vowel || !VOWELS[e.vowel]) return;
                        VOWELS[e.vowel].forEach((freq, i) => setAt(formants[i].frequency, freq, time));
                        setAt(vout.gain, 2, time);
                        setAt(dry.gain, 0, time);
                    });
                } else {
                    node = vout;
                }
            }

            const shapeAmount = (x) => Math.round(clamp(x, 0, 0.99) * 100);
            if ((isNum(v.shape) && v.shape > 0) || tied) {
                const ws = shaper('shape', isNum(v.shape) && v.shape > 0 ? shapeAmount(v.shape) : null);
                if (tied) {
                    updates.push((e, time) => {
                        if (isNum(e.shape)) when(time, () => { ws.curve = e.shape > 0 ? this._curve('shape', shapeAmount(e.shape)) : null; });
                    });
                }
            }

            // resonance and hresonance as in SuperDirt (see resonanceDb). A tied
            // voice without hpf gets one at 20 Hz, without lpf one at 20 kHz.
            const hpfOn = isNum(v.hpf) && v.hpf > 0;
            if (hpfOn || tied) filter('highpass', hpfOn ? v.hpf : 20, resonanceDb(isNum(v.hpq) ? v.hpq : 0), hpfOn ? 'hp' : null, undefined, 'hpf');
            // SuperDirt: BPF.ar(signal, bandf, 1 / bandq) * max(bandq, 1), bandq 10 by default.
            const bpfOn = isNum(v.bpf) && v.bpf > 0;
            if (bpfOn && !tied) {
                const bandq = isNum(v.bpq) ? bandQ(v.bpq) : 10;
                filter('bandpass', v.bpf, bandq, 'bp', undefined, 'bpf');
                const makeup = gainNode(Math.max(bandq, 1));
                add(makeup);
                params.bpf.gain = makeup.gain;
            } else if (tied) {
                // A tied voice's band-pass is beside the dry sound: the event chooses which is heard.
                let bandq = isNum(v.bpq) ? bandQ(v.bpq) : 10;
                let on = bpfOn;
                const split = node;
                const out = gainNode(1);
                const dry = gainNode(on ? 0 : 1);
                const f = ctx.createBiquadFilter();
                f.type = 'bandpass';
                f.frequency.value = cutoffHz(on ? v.bpf : 1000);
                f.Q.value = bandq;
                if (on && !followed('bpf')) this._filterEnvelope(f.frequency, v.bpf, v, 'bp', timing);
                nodes.push(f);
                const makeup = gainNode(on ? Math.max(bandq, 1) : 0);
                split.connect(dry);
                dry.connect(out);
                split.connect(f);
                f.connect(makeup);
                makeup.connect(out);
                node = out;
                params.bpf = { freq: f.frequency, q: f.Q };
                updates.push((e, time) => {
                    if (!isNum(e.bpf) && !isNum(e.bpq)) return;
                    if (isNum(e.bpq)) bandq = bandQ(e.bpq);
                    if (isNum(e.bpf)) on = e.bpf > 0;
                    setAt(dry.gain, on ? 0 : 1, time);
                    setAt(makeup.gain, on ? Math.max(bandq, 1) : 0, time);
                });
            }
            // SuperDirt: signal.round(0.5 ** (crush - 1)); fractions work.
            const crushAmount = (x) => Math.round(clamp(x, 1, 16) * 100);
            if (isNum(v.crush) || tied) {
                const ws = shaper('crush', isNum(v.crush) ? crushAmount(v.crush) : null, 'none');
                if (tied) updates.push((e, time) => { if (isNum(e.crush)) when(time, () => { ws.curve = this._curve('crush', crushAmount(e.crush)); }); });
            }
            // SuperDirt: coarse > 1 holds every sample for coarse samples (Latch), on every sound.
            if (isNum(v.coarse) && v.coarse > 1) {
                worklet('coarse', { coarse: Math.min(v.coarse, 256) }, 'coarse', ['coarse'], (e) => ({ coarse: clamp(e.coarse, 1, 256) }));
            }
            const lpfOn = isNum(v.lpf) && v.lpf > 0;
            if (lpfOn || tied) filter('lowpass', lpfOn ? v.lpf : 20000, resonanceDb(isNum(v.resonance) ? v.resonance : 0), lpfOn ? 'lp' : null, undefined, 'lpf');
            // Peak equaliser: boosts (or cuts, with a negative gain) a band around peak Hz.
            // Off (a tied voice without peak, or a followed one that starts at 0) it boosts by 0 dB.
            const peakOn = isNum(v.peak) && v.peak > 0;
            if (peakOn || tied || followed('peak', 'peakq', 'peakgain')) {
                let on = peakOn || followed('peak');
                let gainDb = isNum(v.peakgain) ? clamp(v.peakgain, -40, 40) : 6;
                const f = filter('peaking', peakOn ? v.peak : 1000, isNum(v.peakq) ? clamp(v.peakq, 0.0001, 40) : 1, peakOn ? 'peak' : null,
                    on ? gainDb : 0, 'peak');
                params.peak.gain = f.gain;
                if (tied) {
                    updates.push((e, time) => {
                        if (isNum(e.peak)) {
                            on = e.peak > 0;
                            if (on) setAt(f.frequency, cutoffHz(e.peak), time);
                        }
                        if (isNum(e.peakq)) setAt(f.Q, clamp(e.peakq, 0.0001, 40), time);
                        if (isNum(e.peakgain)) gainDb = clamp(e.peakgain, -40, 40);
                        if (isNum(e.peak) || isNum(e.peakgain)) setAt(f.gain, on ? gainDb : 0, time);
                    });
                }
            }

            // Tremolo: the volume swings tremolodepth (0 to 1) at tremolorate Hz.
            const tremOn = (isNum(v.tremolorate) && v.tremolorate > 0) || (isNum(v.tremolodepth) && v.tremolodepth > 0);
            if (tremOn || tied || followed('tremolorate', 'tremolodepth')) {
                let depth = isNum(v.tremolodepth) ? clamp(v.tremolodepth, 0, 1) : tremOn || followed('tremolorate') ? 0.5 : 0;
                const trem = gainNode(1 - depth / 2);
                add(trem);
                const m = lfo(isNum(v.tremolorate) ? clamp(v.tremolorate, 0, 100) : 1, depth / 2, trem.gain);
                params.tremolo = { gain: trem.gain, rate: m.freq, amount: m.amount };
                if (tied) {
                    updates.push((e, time) => {
                        if (isNum(e.tremolorate)) setAt(m.freq, clamp(e.tremolorate, 0, 100), time);
                        let next = depth;
                        if (isNum(e.tremolodepth)) next = clamp(e.tremolodepth, 0, 1);
                        else if (isNum(e.tremolorate)) next = e.tremolorate > 0 ? (depth > 0 ? depth : 0.5) : 0;
                        if (next === depth && !isNum(e.tremolodepth)) return;
                        depth = next;
                        setAt(trem.gain, 1 - depth / 2, time);
                        setAt(m.amount, depth / 2, time);
                    });
                }
            }

            // Phaser: four all-pass filters swept by a slow sine, mixed with the dry sound.
            const phaserOn = isNum(v.phaserrate) && v.phaserrate > 0;
            if (phaserOn || tied || followed('phaserrate', 'phaserdepth')) {
                const on = phaserOn || followed('phaserrate');
                const depth = isNum(v.phaserdepth) ? clamp(v.phaserdepth, 0, 1) : 0.5;
                const dry = node;
                const out = gainNode(on ? 0.7 : 1);
                const wet = gainNode(on ? 1 : 0);
                const sweeps = [];
                let chain = dry;
                for (let i = 0; i < 4; i++) {
                    const ap = ctx.createBiquadFilter();
                    ap.type = 'allpass';
                    ap.frequency.value = 1000;
                    ap.Q.value = 0.7;
                    chain.connect(ap);
                    chain = ap;
                    nodes.push(ap);
                    sweeps.push(lfo(isNum(v.phaserrate) ? clamp(v.phaserrate, 0, 40) : 0, 900 * depth, ap.frequency));
                }
                chain.connect(wet);
                wet.connect(out);
                dry.connect(out);
                node = out;
                params.phaser = { sweeps };
                if (tied) {
                    updates.push((e, time) => {
                        if (isNum(e.phaserrate)) {
                            const rate = clamp(e.phaserrate, 0, 40);
                            for (const s of sweeps) setAt(s.freq, rate, time);
                            setAt(out.gain, rate > 0 ? 0.7 : 1, time);
                            setAt(wet.gain, rate > 0 ? 1 : 0, time);
                        }
                        if (isNum(e.phaserdepth)) for (const s of sweeps) setAt(s.amount, 900 * clamp(e.phaserdepth, 0, 1), time);
                    });
                }
            }

            if (isNum(v.waveloss) && v.waveloss > 0) {
                worklet('waveloss', { waveloss: v.waveloss }, 'waveloss', ['waveloss'], (e) => ({ waveloss: clamp(e.waveloss, 0, 100) }));
            }
            if (isNum(v.squiz) && v.squiz > 1) {
                worklet('squiz', { squiz: Math.min(v.squiz, 64) }, 'squiz', ['squiz'], (e) => ({ squiz: clamp(e.squiz, 1, 64) }));
            }
            if ((isNum(v.fshift) && v.fshift !== 0) || (isNum(v.fshiftnote) && v.fshiftnote !== 0)) {
                const noteShift = isNum(v.fshiftnote) && timing && timing.freq ? v.fshiftnote * timing.freq : 0;
                const shift = (isNum(v.fshift) ? v.fshift : 0) + noteShift;
                // The shift follows a tied event's fshift, fshiftnote and pitch.
                let hz = isNum(v.fshift) ? v.fshift : 0;
                let perNote = isNum(v.fshiftnote) ? v.fshiftnote : 0;
                worklet('fshift', { shift: clamp(shift, -20000, 20000), phase: isNum(v.fshiftphase) ? v.fshiftphase : 0 }, 'fshift',
                    ['fshift', 'fshiftnote', 'note', 'freq', 'midinote', 'n', 'speed', 'up', 'octave'], (e, state, info) => {
                        if (isNum(e.fshift)) hz = e.fshift;
                        if (isNum(e.fshiftnote)) perNote = e.fshiftnote;
                        return { shift: clamp(hz + perNote * (info.freq || 0), -20000, 20000) };
                    });
            }
            const triodeOn = isNum(v.triode) && v.triode > 0;
            if (triodeOn || tied) {
                const ws = shaper('triode', triodeOn ? Math.round(clamp(v.triode, 0, 10) * 100) : null);
                filter('highpass', 10, 0.7); // SuperDirt follows triode with LeakDC
                if (tied) {
                    updates.push((e, time) => {
                        if (isNum(e.triode)) when(time, () => { ws.curve = e.triode > 0 ? this._curve('triode', Math.round(clamp(e.triode, 0, 10) * 100)) : null; });
                    });
                }
            }
            const krushOn = isNum(v.krush) && v.krush > 0;
            if (krushOn || tied) {
                const ws = shaper('krush', krushOn ? Math.round(clamp(v.krush, 0, 100) * 100) : null);
                let on = krushOn;
                let cutoff = isNum(v.kcutoff) ? v.kcutoff : 3140;
                const f = filter('lowpass', on ? cutoff : 20000, 0.7);
                if (tied) {
                    updates.push((e, time) => {
                        if (!isNum(e.krush) && !isNum(e.kcutoff)) return;
                        if (isNum(e.krush)) {
                            on = e.krush > 0;
                            when(time, () => { ws.curve = on ? this._curve('krush', Math.round(clamp(e.krush, 0, 100) * 100)) : null; });
                        }
                        if (isNum(e.kcutoff)) cutoff = e.kcutoff;
                        setAt(f.frequency, on ? cutoffHz(cutoff) : 20000, time);
                    });
                }
            }
            if ((isNum(v.octer) && v.octer > 0) || (isNum(v.octersub) && v.octersub > 0) || (isNum(v.octersubsub) && v.octersubsub > 0)) {
                worklet('octer', { octer: v.octer || 0, octersub: v.octersub || 0, octersubsub: v.octersubsub || 0 }, 'octer',
                    ['octer', 'octersub', 'octersubsub'], (e, state) => ({
                        octer: isNum(e.octer) ? e.octer : state.octer,
                        octersub: isNum(e.octersub) ? e.octersub : state.octersub,
                        octersubsub: isNum(e.octersubsub) ? e.octersubsub : state.octersubsub,
                    }));
            }

            // Ring modulation: the sound times a sine at ringf Hz, mixed by ring (0 to 1).
            const ringOn = isNum(v.ring) && v.ring > 0;
            if (ringOn || tied || followed('ring', 'ringf')) {
                const depth = ringOn ? clamp(v.ring, 0, 1) : 0;
                const ringer = gainNode(1 - depth);
                add(ringer);
                const m = lfo(isNum(v.ringf) ? clamp(v.ringf, 0, 20000) : 0, depth, ringer.gain);
                params.ring = { gain: ringer.gain, freq: m.freq, amount: m.amount };
                if (tied) {
                    updates.push((e, time) => {
                        if (isNum(e.ringf)) setAt(m.freq, clamp(e.ringf, 0, 20000), time);
                        if (isNum(e.ring)) {
                            setAt(ringer.gain, 1 - clamp(e.ring, 0, 1), time);
                            setAt(m.amount, clamp(e.ring, 0, 1), time);
                        }
                    });
                }
            }

            // distortion (1 to 100) and Tidal's distort (0 to 1) share one waveshaper.
            const driveOf = (e) => (isNum(e.distortion) && e.distortion > 0 ? clamp(e.distortion, 1, 100)
                : isNum(e.distort) && e.distort > 0 ? 1 + clamp(e.distort, 0, 1) * 99 : 0);
            const drive = driveOf(v);
            if (drive > 0 || tied) {
                const ws = shaper('distortion', drive > 0 ? Math.round(drive) : null, '4x');
                if (tied) {
                    updates.push((e, time) => {
                        if (!isNum(e.distortion) && !isNum(e.distort)) return;
                        const next = driveOf(e);
                        when(time, () => { ws.curve = next > 0 ? this._curve('distortion', Math.round(next)) : null; });
                    });
                }
            }

            const spectral = {};
            for (const key of SPECTRAL_CONTROLS) if (isNum(v[key]) && v[key] !== 0) spectral[key] = v[key];
            if (Object.keys(spectral).length) {
                worklet('spectral', { ...spectral, size: SPECTRAL_SIZE, hop: SPECTRAL_HOP }, Object.keys(spectral).join(', '),
                    SPECTRAL_CONTROLS, (e) => Object.fromEntries(SPECTRAL_CONTROLS.filter((key) => isNum(e[key])).map((key) => [key, e[key]])));
            }

            // SuperDirt's DJ filter: RHPF(RLPF(signal, djf.linexp(0, 0.5, 20, 10000)),
            // djf.linexp(0.5, 1, 20, 10000)), both with rq 1; 0.5 does nothing
            // (a tied voice keeps the two filters open: 20 kHz and 20 Hz).
            const djfOn = isNum(v.djf) && v.djf !== 0.5;
            if (djfOn || tied || followed('djf')) {
                const x = djfOn || followed('djf') ? clamp(isNum(v.djf) ? v.djf : 0.5, 0, 1) : null;
                const low = filter('lowpass', x === null ? 20000 : djfLow(x), 0);
                const high = filter('highpass', x === null ? 20 : djfHigh(x), 0);
                params.djf = { low: low.frequency, high: high.frequency };
                if (tied) {
                    updates.push((e, time) => {
                        if (!isNum(e.djf)) return;
                        const y = clamp(e.djf, 0, 1);
                        setAt(low.frequency, y === 0.5 ? 20000 : djfLow(y), time);
                        setAt(high.frequency, y === 0.5 ? 20 : djfHigh(y), time);
                    });
                }
            }

            // SuperCollider's FreeVerb2 on the voice (freeverb, freeroom, freedamp).
            if (timing && timing.reverb) {
                worklet('freeverb', timing.reverb, 'freeverb', ['freeverb', 'freeroom', 'freedamp'], (e, state) => ({
                    mix: isNum(e.freeverb) ? clamp(e.freeverb, 0, 1) : state.mix,
                    room: isNum(e.freeroom) ? clamp(e.freeroom, 0, 1) : state.room,
                    damp: isNum(e.freedamp) ? clamp(e.freedamp, 0, 1) : state.damp,
                }));
            }

            // Leslie: a rotating speaker. The horn's movement bends the pitch
            // (a delay swept by lsize metres), its volume swings and it turns
            // around the stereo field lrate times a second. leslie is the mix.
            const leslieOn = isNum(v.leslie) && v.leslie > 0;
            if (leslieOn || tied || followed('leslie', 'lrate', 'lsize')) {
                const wet = leslieOn ? clamp(v.leslie, 0, 1) : 0;
                const rate = isNum(v.lrate) ? clamp(v.lrate, 0, 30) : 6.7;
                const size = isNum(v.lsize) ? clamp(v.lsize, 0, 5) : 0.3;
                const swing = size / 343;
                const dry = node;
                const out = gainNode(1);
                const dryLevel = gainNode(1 - wet);
                const wetLevel = gainNode(wet);
                const am = gainNode(0.75);
                const horn = ctx.createDelay(0.1);
                horn.delayTime.value = 0.002 + swing;
                nodes.push(horn);
                dry.connect(dryLevel);
                dryLevel.connect(out);
                dry.connect(horn);
                horn.connect(am);
                const turns = [];
                const hornSwing = lfo(rate, swing, horn.delayTime);
                turns.push(hornSwing, lfo(rate, 0.25, am.gain));
                let last = am;
                if (typeof ctx.createStereoPanner === 'function') {
                    const turn = ctx.createStereoPanner();
                    nodes.push(turn);
                    am.connect(turn);
                    turns.push(lfo(rate, 0.8, turn.pan, 'triangle'));
                    last = turn;
                }
                last.connect(wetLevel);
                wetLevel.connect(out);
                node = out;
                params.leslie = { dry: dryLevel.gain, wet: wetLevel.gain, rates: turns.map((m) => m.freq), delay: horn.delayTime, swing: hornSwing.amount };
                if (tied) {
                    updates.push((e, time) => {
                        if (isNum(e.leslie)) {
                            setAt(dryLevel.gain, 1 - clamp(e.leslie, 0, 1), time);
                            setAt(wetLevel.gain, clamp(e.leslie, 0, 1), time);
                        }
                        if (isNum(e.lrate)) for (const m of turns) setAt(m.freq, clamp(e.lrate, 0, 30), time);
                        if (isNum(e.lsize)) {
                            const s = clamp(e.lsize, 0, 5) / 343;
                            setAt(horn.delayTime, 0.002 + s, time);
                            setAt(hornSwing.amount, s, time);
                        }
                    });
                }
            }

            // The level that a followed gain or amp (or a tied event) changes, relative to the voice's own.
            if (timing && (timing.changeable || followed('gain', 'amp'))) {
                const level = gainNode(isNum(timing.levelStart) ? timing.levelStart : 1);
                add(level);
                params.level = level.gain;
            }

            // A voice that tie can change gets a panner even without pan, so a later event can move it.
            if ((isNum(v.pan) || (timing && timing.changeable)) && typeof ctx.createStereoPanner === 'function') {
                const panner = ctx.createStereoPanner();
                panner.pan.value = isNum(v.pan) ? clamp(v.pan, -1, 1) : 0;
                add(panner);
                params.pan = panner.pan;
            }

            node.connect(session.out);
            // The orbit's delay and reverb (SuperDirt's global effects); a tied
            // event sets them again, and connects the voice to a bus it lacks.
            params.output = node;
            params.sends = new Set();
            params.update = (e, time, info) => {
                for (const fn of updates) fn(e, time, info);
            };
            this._orbitSend(node, v, timing ? timing.time : ctx.currentTime, orbit, params.sends);

            sources[0].onended = () => {
                for (const osc of lfos) {
                    try { osc.stop(); } catch (e) { /* already stopped */ }
                }
                for (const n of nodes) {
                    try { n.disconnect(); } catch (e) { /* already disconnected */ }
                }
            };
            return params;
        }

        /** A node running one AudioWorklet effect (see fxWorkletModule), or null (with a warning) without the module. */
        /** Runs fn at audio time `time` (now if it is due): for changes that are not AudioParams, such as a waveshaper's curve. */
        _atTime(time, fn) {
            const ctx = this.audioContext;
            const wait = ctx && isNum(time) ? time - ctx.currentTime : 0;
            if (!(wait > 0.002) || typeof setTimeout !== 'function') fn();
            else setTimeout(fn, wait * 1000);
        }

        /** New settings for a running AudioWorklet effect from audio time `time` on (see TidalFx). */
        _workletSet(node, time, options) {
            if (node && node.port && typeof node.port.postMessage === 'function') node.port.postMessage({ at: time, options: { ...options } });
        }

        _workletNode(kind, options, label) {
            if (this._fxState !== 'ready' || typeof AudioWorkletNode === 'undefined') {
                this._warnOnce(this._fxState === 'loading'
                    ? `${label} is still loading; it is heard from the next events`
                    : `${label} needs AudioWorklet, which is not available here`);
                return null;
            }
            return new AudioWorkletNode(this.audioContext, 'tidal-fx', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                processorOptions: { kind, ...options },
            });
        }

        /**
         * A filter envelope on a frequency parameter, for the prefix lp, hp,
         * bp or peak: <prefix>env is the depth in octaves (negative closes
         * the filter), <prefix>attack the time to reach it, <prefix>decay the
         * time to fall to <prefix>sustain (a fraction of the depth: 1 without
         * a decay, else 0 unless given), and <prefix>release the time back
         * to the base frequency once the sound ends. The frequency moves in
         * octaves, so it glides evenly, as an exponential line.
         */
        _filterEnvelope(param, base, v, prefix, timing) {
            const depth = v[prefix + 'env'];
            if (!isNum(depth) || depth === 0) return;
            const num = (key, lo, hi, fallback) => (isNum(v[prefix + key]) ? clamp(v[prefix + key], lo, hi) : fallback);
            const attack = num('attack', 0, 10, 0);
            const decay = num('decay', 0, 10, 0);
            const sustain = num('sustain', 0, 1, decay > 0 ? 0 : 1);
            const release = num('release', 0, 10, timing.release);
            const { time, holdEnd } = timing;
            const octaves = clamp(depth, -10, 10);
            const freqAt = (x) => clamp(base * Math.pow(2, octaves * x), 20, 20000);
            // The envelope, from 0 to 1, at time t while the sound is held.
            const envAt = (t) => {
                const dt = t - time;
                if (attack > 0 && dt < attack) return Math.max(0, dt / attack);
                if (decay > 0 && dt < attack + decay) return 1 + (sustain - 1) * ((dt - attack) / decay);
                return decay > 0 ? sustain : (attack > 0 ? 1 : sustain);
            };
            param.setValueAtTime(freqAt(attack > 0 ? 0 : (decay > 0 ? 1 : sustain)), time);
            const breakpoints = [];
            if (attack > 0) breakpoints.push([time + attack, 1]);
            if (decay > 0) breakpoints.push([time + attack + decay, sustain]);
            for (const [at, level] of breakpoints) {
                if (at <= holdEnd) {
                    param.exponentialRampToValueAtTime(freqAt(level), at);
                } else {
                    param.exponentialRampToValueAtTime(freqAt(envAt(holdEnd)), holdEnd);
                    break;
                }
            }
            param.setValueAtTime(freqAt(envAt(holdEnd)), holdEnd);
            param.exponentialRampToValueAtTime(clamp(base, 20, 20000), holdEnd + Math.max(0.005, release));
        }

        /**
         * Cut groups: a new sound in the same cut group (and orbit) as a sound
         * still playing fades that one out at once, like an open hi-hat cut by
         * a closed one. In a negative group, as in SuperDirt, a sound only cuts
         * the same sound (name and n).
         */
        _cutGroup(v, time, gate, sources) {
            if (!isNum(v.cut) || v.cut === 0) return;
            const group = Math.trunc(v.cut);
            if (group === 0) return;
            // SuperDirt: the group is |cut|; a positive cut stops every sound of
            // the group, a negative one only those playing the same sample.
            const key = `${isNum(v.orbit) ? Math.floor(v.orbit) : 0}:${Math.abs(group)}`;
            const sample = this._sampleKey(v);
            const groups = this._session.cuts;
            const playing = (groups.get(key) || []).filter((x) => x.until > time);
            for (const previous of playing) {
                if (previous.time >= time || (group < 0 && previous.sample !== sample)) continue;
                previous.gate.gain.cancelScheduledValues(time);
                previous.gate.gain.setTargetAtTime(0, time, 0.004);
                for (const src of previous.sources) {
                    try { src.stop(time + 0.05); } catch (e) { /* already stopped */ }
                }
                previous.until = time;
            }
            playing.push({ time, gate, sources, sample, until: time + 60 });
            groups.set(key, playing.filter((x) => x.until > time).slice(-64));
        }

        /** The sample (file) an event plays, or its synth and variation: what a negative cut compares. */
        _sampleKey(v) {
            const bank = this.sampleBanks.get(v.s);
            if (bank) {
                const pitched = this._pitchedFile(v.s, isNum(v.note) ? v.note : isNum(v.midinote) ? v.midinote : 60);
                return pitched ? pitched.url : this._sampleUrl(bank, v);
            }
            return `${v.s}:${isNum(v.n) ? Math.floor(v.n) : 0}`;
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
         * same source again reuses the first load; a load that failed is not
         * tried again until retrySamples().
         *
         * Paths are URLs relative to a base: for a manifest URL, its _base
         * (itself relative to the manifest's final URL, after redirects) or
         * the manifest's own URL; for banks given as an object, `base` or
         * their _base, relative to the page. Absolute and root-relative
         * ("/samples/bd.wav") paths work as in a link.
         */
        loadSamples(source, base = '') {
            // An argument that is not a source is the code's mistake, not a load that failed: in code being
            // evaluated it is an error there (nothing of that code runs, what plays stays), and it is never
            // asked for, retried or waited for.
            const invalid = invalidSampleSource(source, base);
            if (invalid) {
                const error = new TypeError(invalid);
                if (this._txn) throw error;
                const rejected = Promise.reject(error);
                rejected.catch(() => { /* the caller's to handle */ });
                return rejected;
            }
            const entry = this._samplePlan(source, base);
            // The banks replace those of the same name only now (in code being evaluated, when it
            // commits), in the order the samples() calls ran: each registration has a number, and a
            // bank is never replaced by an older one that arrives later. Banks known at once (given
            // in code) are in use at once, so a first() after them in the same code plays them.
            // A failed manifest rejects the promise for whoever awaits it and is reported to the
            // editor (sampleFailures); a promise nobody awaits is not an unhandled rejection.
            const register = () => {
                const seq = ++this._bankSeq;
                if (entry.plan) return Promise.resolve(this._registerBanks(entry.plan, seq));
                const job = entry.promise.then((plan) => this._registerBanks(plan, seq));
                job.catch(() => { /* reported where the manifest failed */ });
                return job;
            };
            if (this._txn) {
                // For the warnings of this evaluation: names it adds count as known, and a manifest it
                // asks for that has not arrived means any name may come (see eval).
                if (entry.plan) for (const bank of entry.plan) this._txnBanks.add(bank.name);
                else if (!entry.failed) this._txnPendingLoads.push(entry.promise); // a manifest that failed brings nothing
                let settle;
                const result = new Promise((resolve) => { settle = resolve; });
                result.catch(() => { /* as above */ });
                this._stage('samples', () => settle(register()), () => settle(0));
                return result;
            }
            return register();
        }

        /**
         * The banks a source holds, read but not yet in use: { promise, plan }
         * with plan [{ name, urls, pitched }] once known (at once for banks
         * given in code). Manifests are fetched once; a failed one is kept as
         * failed until retrySamples().
         */
        _samplePlan(source, base) {
            const key = typeof source === 'string' ? source + '|' + base : null;
            if (key && this._sampleManifests.has(key)) return this._sampleManifests.get(key);
            const entry = { promise: null, plan: null };
            if (typeof source === 'string') {
                entry.promise = (async () => {
                    const url = resolveUrl(manifestUrl(source), pageBase());
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Could not load samples from ${url} (HTTP ${response.status})`);
                    const map = await response.json();
                    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(`The sample manifest ${url} is not an object of banks`);
                    // Relative paths follow the manifest where it really is (after any redirect).
                    const finalUrl = typeof response.url === 'string' && response.url ? response.url : url;
                    return planBanks(map, resolveUrl(base || (typeof map._base === 'string' ? map._base : ''), finalUrl));
                })();
                entry.promise.then((plan) => { entry.plan = plan; }, () => { entry.failed = true; });
            } else {
                entry.plan = planBanks(source, resolveUrl(base || (typeof source._base === 'string' ? source._base : ''), pageBase()));
                entry.promise = Promise.resolve(entry.plan);
            }
            if (key) this._sampleManifests.set(key, entry);
            this._trackLoad(entry.promise.catch((err) => {
                console.error('TidalJS:', err);
                this._sampleFailures.set(key || 'samples()', err && err.message ? err.message : String(err));
                this._warnOnce(err.message);
            }));
            return entry;
        }

        /** Puts planned banks in use (see planBanks), unless a newer registration (seq) set them; returns how many. */
        _registerBanks(plan, seq = ++this._bankSeq) {
            for (const bank of plan) {
                if ((this._bankSeqs.get(bank.name) ?? 0) > seq) continue; // a newer samples() set it
                this._bankSeqs.set(bank.name, seq);
                this.sampleBanks.set(bank.name, bank.urls);
                if (bank.pitched) this.pitchedBanks.set(bank.name, bank.pitched);
                else this.pitchedBanks.delete(bank.name);
            }
            this._notifySamples();
            return plan.length;
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
            const tracked = Promise.resolve(promise).finally(() => {
                this._sampleLoads.delete(tracked);
                if (this._sampleLoads.size === 0) this._notifySamples();
            });
            this._sampleLoads.add(tracked);
            return tracked;
        }

        /** The sample loads that failed: { source, message } for manifests and files. */
        sampleFailures() {
            return [...this._sampleFailures].map(([source, message]) => ({ source, message }));
        }

        /**
         * Forgets the failed sample loads, so the next samples() call or event
         * that needs them asks for them again. Returns how many were forgotten.
         */
        retrySamples() {
            const count = this._sampleFailures.size;
            for (const source of this._sampleFailures.keys()) {
                this._sampleManifests.delete(source);
                this._sampleBuffers.delete(source);
            }
            this._sampleFailures.clear();
            this._notifySamples();
            return count;
        }

        /** Calls fn() whenever sample loads finish or fail, or failures are retried; returns a function that stops it. */
        onSamples(fn) {
            this._sampleListeners.add(fn);
            return () => this._sampleListeners.delete(fn);
        }

        _notifySamples() {
            for (const fn of [...this._sampleListeners]) {
                try { fn(); } catch (error) { console.error('TidalJS:', error); }
            }
        }

        /**
         * Unknown sound names in what plays (its next four cycles), now that
         * the sample banks loaded: what eval() would warn about.
         */
        soundWarnings() {
            const from = this.isPlaying ? Math.floor(this.getCyclePosition()) : 0;
            const out = new Set();
            for (const pattern of this.channels.values()) {
                let events;
                try { events = pattern.query(from, from + 4); } catch (e) { continue; }
                for (const ev of events) {
                    const v = asObject(ev.value);
                    if (v.midi !== undefined || v.osc !== undefined || !v.s) continue;
                    if (!this.sampleBanks.has(v.s) && !this.samples.has(v.s)) out.add(`Unknown sound "${v.s}"`);
                }
            }
            return [...out];
        }

        /** The decoded buffer of a sample file (reversed if asked), or null while it loads (or failed: see retrySamples). */
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
                        this._sampleFailures.set(url, `Could not load sample ${url} (${err && err.message ? err.message : err})`);
                        this._warnOnce(`Could not load sample ${url} (${err && err.message ? err.message : err})`);
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

        /** The recording of a pitched bank nearest to a MIDI note, or null for other banks. */
        _pitchedFile(name, midi) {
            const notes = this.pitchedBanks.get(name);
            if (!notes) return null;
            return notes.reduce((best, x) => (Math.abs(x.midi - midi) < Math.abs(best.midi - midi) ? x : best));
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
        _playSample(v, time, duration, bank, hold = false) {
            const actual = levelOf(null, v);
            // A followed gain or amp may start at 0: the voice is built at gain 1 (see playEvent).
            const levelFollowed = v.follow instanceof Follows && (v.follow.has('gain') || v.follow.has('amp'));
            if (actual <= 0 && !levelFollowed) return null;
            const gain = actual > 0 ? actual : 1;
            const speed = isNum(v.speed) && v.speed !== 0 ? clamp(v.speed, -16, 16) : 1;
            const target = isNum(v.note) ? v.note : isNum(v.midinote) ? v.midinote : 60;
            // A pitched bank plays its nearest recording; others are pitched from middle C.
            const file = this._pitchedFile(v.s, target);
            let semitones = file ? target - file.midi : (isNum(v.note) || isNum(v.midinote) ? target - 60 : 0);
            // SuperDirt pitches samples by octave too (midinote = note + octave * 12).
            if (isNum(v.octave)) semitones += (clamp(Math.round(v.octave), 0, 10) - 5) * 12;
            const buffer = this._sampleBuffer(file ? file.url : this._sampleUrl(bank, v), speed < 0);
            if (!buffer) return null; // still loading: it plays from the next event on
            // With unit "c", speed is in cycles: speed 1 plays the whole sample in one cycle.
            const base = v.unit === 'c' ? buffer.duration * this.cps * Math.abs(speed) : Math.abs(speed);
            const rate = clamp(base, 0.01, 64) * Math.pow(2, clamp(semitones, -48, 48) / 12);

            const begin = isNum(v.begin) ? clamp(v.begin, 0, 1) : 0;
            const end = isNum(v.end) ? clamp(v.end, 0, 1) : 1;
            if (end <= begin) return null;
            // SuperDirt: the [begin, end] part plays (backwards in the reversed
            // buffer when speed < 0), looping; it lasts loop times its length,
            // or legato / sustain, never longer than that.
            const start = (speed < 0 ? 1 - end : begin) * buffer.duration;
            const span = (end - begin) * buffer.duration;
            const loops = isNum(v.loop) && v.loop > 0 ? Math.min(v.loop, 64) : 1;
            const full = (span / rate) * loops;
            let window = full;
            if (isNum(v.sustain) && v.sustain > 0) window = Math.min(full, v.sustain);
            else if (isNum(v.legato) && v.legato > 0) window = Math.min(full, v.legato * duration);
            return this._sampleVoice(v, time, buffer, rate, start, window, gain * 0.8, loops > 1 ? [start, start + span] : null,
                { levelBase: gain, levelStart: actual / gain, handle: hold, pitchRef: { note: target } });
        }

        _sampleVoice(v, time, buffer, rate, offset, window, level, loopRange = null, o = {}) {
            const ctx = this.audioContext;
            const attack = isNum(v.attack) ? clamp(v.attack, 0, 10) : 0;
            const release = isNum(v.release) ? clamp(v.release, 0.001, 10) : 0.005;
            const holdEnd = time + Math.max(window, attack);
            const stopAt = holdEnd + release + 0.02;

            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.playbackRate.setValueAtTime(rate, time);
            if (loopRange) {
                src.loop = true;
                src.loopStart = loopRange[0];
                src.loopEnd = loopRange[1];
            }
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
            // accelerate, pitchenv, vibrato and portamento work on samples too.
            const timing = { time, holdEnd, release, stopAt, freq: 0, levelBase: o.levelBase, levelStart: o.levelStart, def: null };
            const mods = this._pitchModulation({}, v, time, { window, freq: 0, timing, pitchRef: o.pitchRef }, [src], stopAt);
            this._cutGroup(v, time, gate, [src]);
            const params = this._route(gate, v, [src], [amp, ...mods], timing);
            if (params && mods.vibrato) params.vibrato = mods.vibrato;
            this._applyFollows(params, v, timing);
            this._livePitch(params, v, timing);
            if (!o.handle) return null;
            const handle = {
                def: null, time, holdEnd, release, tail: 0, stopAt, curve: 0, gate: gate.gain, held: 1, steady: 1,
                attackEnd: time + attack, sources: [src, ...mods.filter((m) => typeof m.stop === 'function')],
                bend: null, cents: 0, freq: 0, params, levelBase: o.levelBase || 1, timing,
            };
            const live = this._liveVoices.get(params);
            if (live) live.handle = handle;
            return handle;
        }

        // --- Events ----------------------------------------------------

        /**
         * Renders one event (a map of controls) at an audio time.
         * duration is the event length in seconds (used by legato and MIDI).
         */
        playEvent(v, time, duration = 0.25, hold = false) {
            if (!this.audioContext || !this._session) return null;
            // The scheduler keeps what was sent (and the take indices it used) as the hit's identity (see _dispatch).
            const used = PLAYED.on && !PLAYED.v ? new Map() : null;
            v = this._resolveOutput(v, time, true, null, used);
            if (used) {
                PLAYED.v = v;
                PLAYED.takes = used;
            }
            if (v.midi !== undefined) {
                this._sendMidi(v, time, duration);
                return null;
            }
            if (v.osc !== undefined) {
                this._sendOsc(v, time, duration);
                return null;
            }
            const name = v.s;
            if (!name || name === '~') return null;
            // The spectral effects delay the sound by their analysis window:
            // start such voices that much earlier (when there is time).
            if (SPECTRAL_CONTROLS.some((key) => isNum(v[key]) && v[key] !== 0)) {
                const late = (SPECTRAL_SIZE - SPECTRAL_HOP) / (this.audioContext.sampleRate || 44100);
                time = Math.max(this.audioContext.currentTime, time - late);
            }
            // A loaded sample bank wins over the synthesised sound of the same name.
            const bank = this.sampleBanks.get(name);
            if (bank) {
                if (v.tie !== undefined) this._warnOnce('tie() works on synths; samples ignore it');
                return this._playSample(v, time, duration, bank, hold);
            }
            const def = this.samples.get(name);
            if (!def) {
                if (!this.isLoadingSamples()) this._warnOnce(`Unknown sound "${name}"`);
                return null;
            }

            // SuperDirt: amp * gain^4 (gain 0.5 is a sixteenth, -24 dB).
            const actual = levelOf(def, v);
            // A followed gain or amp may start at 0 and rise: the voice is then
            // built at gain 1 and its level node scales it (see _applyFollows).
            const levelFollowed = v.follow instanceof Follows && (v.follow.has('gain') || v.follow.has('amp'));
            if (actual <= 0 && !levelFollowed) return null;
            const gain = actual > 0 ? actual : 1;
            const level = gain * (def.level ?? 0.5);

            let freq = def.freq;
            if (isNum(v.freq)) freq = clamp(v.freq, 20, 20000);
            else if (isNum(v.midinote)) freq = midiToFreq(clamp(v.midinote, 0, 127));
            else if (isNum(v.note)) freq = midiToFreq(clamp(v.note, 0, 127));
            // SuperDirt plays n as the note of a synth; banks of variations (bd, sn...) use it to pick one.
            else if (isNum(v.n) && !(def.variations > 1)) freq = midiToFreq(clamp(60 + v.n, 0, 127));
            // The pitch a followed note or freq moves from (the note's own, before up, octave and speed).
            const pitchRef = { note: 69 + 12 * Math.log2(clamp(freq, 1, 20000) / 440), freq: clamp(freq, 20, 20000) };
            if (isNum(v.up)) freq *= Math.pow(2, clamp(v.up, -48, 48) / 12);
            // octave, as in SuperDirt: 5 is the default, each step one octave.
            if (isNum(v.octave)) freq *= Math.pow(2, clamp(Math.round(v.octave), 0, 10) - 5);
            const speed = isNum(v.speed) && v.speed !== 0 ? clamp(Math.abs(v.speed), 0.01, 16) : 1;
            freq = clamp(freq * speed, 10, 20000);

            // Portamento glides from the last note of the same sound in the same orbit.
            const glideKey = `${isNum(v.orbit) ? Math.floor(v.orbit) : 0}:${name}`;
            const glideFrom = this._lastFreq.get(glideKey);
            this._lastFreq.delete(glideKey);
            this._lastFreq.set(glideKey, freq);
            if (this._lastFreq.size > 256) this._lastFreq.delete(this._lastFreq.keys().next().value);

            const variation = isNum(v.n) && def.variations ? Math.abs(Math.floor(v.n)) % def.variations : 0;

            // Length of the sound: hold (after the attack, as in SuperDirt),
            // sustain (seconds) or legato (fraction of the event) override the
            // natural decay.
            const attack = isNum(v.attack) ? clamp(v.attack, 0, 10) : (def.attack || 0);
            let held = null;
            if (isNum(v.hold) && v.hold >= 0) held = attack + v.hold;
            else if (isNum(v.sustain) && v.sustain > 0) held = v.sustain;
            else if (isNum(v.legato) && v.legato > 0) held = v.legato * duration;

            const begin = isNum(v.begin) ? clamp(v.begin, 0, 1) : 0;
            const end = isNum(v.end) ? clamp(v.end, 0, 1) : 1;
            if (end <= begin) return null;

            const sustained = SUSTAINED_TYPES.has(def.type);
            // decay is how long a sound rings, unless it is a held synth:
            // then it shapes the envelope (see _voice).
            const decay = isNum(v.decay) && v.decay > 0 ? clamp(v.decay, 0.001, 30) : null;
            const natural = (decay && !(sustained && held) ? decay : this._naturalLength(def, variation)) / speed;
            const length = sustained && held ? held : natural;
            let window = (end - begin) * length;
            if (!sustained && held) window = Math.min(window, held);

            // tie: a voice of the same sound, orbit and tie still sounding takes
            // this event's pitch, controls and length, without a new attack.
            const tieKey = v.tie !== undefined && v.tie !== null ? `${glideKey}:${String(v.tie)}` : null;
            const ties = this._session.ties || (this._session.ties = new Map());
            if (tieKey) {
                const running = ties.get(tieKey);
                if (running && running.time < time - 1e-6 && running.stopAt > time) {
                    this._retie(running, v, time, time + Math.max(window, 0.005), freq, pitchRef);
                    return running;
                }
            }

            const loops = isNum(v.loop) ? clamp(Math.floor(v.loop), 1, 32) : 1;
            let handle = null;
            for (let i = 0; i < loops; i++) {
                const voice = this._voice(def, v, time + i * window, {
                    level, freq, variation, speed, length, window, sustained: sustained && !!held,
                    start: time + i * window - begin * length,
                    glideFrom: i === 0 ? glideFrom : undefined,
                    levelBase: gain,
                    levelStart: actual / gain,
                    handle: i === 0 && (hold || !!tieKey),
                    tied: i === 0 && !!tieKey,
                    pitchRef,
                });
                if (i === 0) handle = voice;
            }
            if (tieKey && handle) {
                for (const [key, h] of ties) if (h.stopAt <= time) ties.delete(key);
                ties.set(tieKey, handle);
            }
            return handle;
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
         * begin, end, legato, sustain, hold, attack, decay, sustainlevel and
         * release for every sound.
         */
        _voice(def, v, time, o) {
            const ctx = this.audioContext;
            const attack = isNum(v.attack) ? clamp(v.attack, 0, 10) : (def.attack || 0);
            const release = isNum(v.release) ? clamp(v.release, 0.001, 10) : (def.release || (o.sustained ? 0.03 : 0.005));
            const holdEnd = time + Math.max(o.window, attack);
            // A held synth with a decay falls to sustainlevel (0 by default) after the attack.
            const decay = o.sustained && isNum(v.decay) && v.decay > 0 ? clamp(v.decay, 0.001, 30) : 0;
            const sustainLevel = decay ? (isNum(v.sustainlevel) ? clamp(v.sustainlevel, 0, 1) : 0) : 1;

            // The synth's envelope curve, as in SuperCollider (0 is straight).
            const curve = isNum(def.curve) ? def.curve : 0;
            const gate = ctx.createGain();
            const segments = [];
            if (attack > 0) segments.push({ dur: attack, level: 1, curve });
            if (decay) segments.push({ dur: decay, level: sustainLevel, curve });
            const held = this._envSegments(gate.gain, time, attack > 0 ? 0 : 1, segments, holdEnd);
            this._envSegments(gate.gain, holdEnd, held, [{ dur: release, level: 0, curve }], Infinity);
            // A reverb on the voice (freeverb) rings on after the release.
            const reverb = this._freeverbOf(def, v);
            const tail = reverb && !def.freeverb ? Math.min(12, (-3 * 0.0367) / Math.log10(0.7 + 0.28 * reverb.room)) : 0;
            const stopAt = holdEnd + release + tail + 0.02;

            const voice = this._generate(def, o, time, v);
            voice.output.connect(gate);
            for (const src of voice.sources) src.stop(stopAt);
            // A voice that can be changed later (tie, a held MIDI key) bends its
            // pitch through one more source, so a later event can glide it.
            const bend = o.handle ? this._bendSource(voice.pitched, time, stopAt) : null;
            const timing = {
                time, holdEnd, release, stopAt, freq: o.freq, reverb: def.freeverb ? null : reverb,
                levelBase: o.levelBase, levelStart: o.levelStart, def, changeable: !!o.handle, tied: !!o.tied,
            };
            const mods = this._pitchModulation(def, v, time, { ...o, bend, timing }, voice.pitched, stopAt);
            this._cutGroup(v, time, gate, voice.sources);
            const params = this._route(gate, v, voice.sources, [...voice.nodes, ...mods, ...(bend ? [bend] : [])], timing);
            if (params && mods.vibrato) params.vibrato = mods.vibrato;
            this._applyFollows(params, v, timing);
            this._livePitch(params, v, timing);
            if (!o.handle) return null;
            const handle = {
                def, time, holdEnd, release, tail, stopAt, curve, gate: gate.gain,
                held, steady: sustainLevel, attackEnd: time + attack + decay,
                sources: [...voice.sources, ...mods.filter((m) => typeof m.stop === 'function'), ...(bend ? [bend] : [])],
                bend: bend ? bend.offset : null, cents: 0, freq: o.freq, params, levelBase: o.levelBase || 1,
                timing, vibrato: mods.vibrato || null, tune: voice.tune || null,
            };
            // A pitch that follows a live input is laid out again around this voice's own bend (see _pitchRelay).
            const live = this._liveVoices.get(params);
            if (live) live.handle = handle;
            return handle;
        }

        /** Remembers a voice whose followed pitch reads a live input (see _pitchModulation and _pitchRelay). */
        _livePitch(params, v, timing) {
            if (!params || !timing.pitchLive) return;
            const entry = this._liveVoices.get(params) || { params, v, timing, relayParams: false };
            entry.pitch = timing.pitchLive;
            entry.key = KEY_CONTEXT.key;
            this._liveVoices.set(params, entry);
        }

        /** A constant source on the detune of a voice's oscillators (cents), for tie and held keys; null if they have none. */
        _bendSource(targets, time, stopAt) {
            const ctx = this.audioContext;
            const params = targets.map((src) => src.detune).filter(Boolean);
            if (!params.length || typeof ctx.createConstantSource !== 'function') return null;
            const src = ctx.createConstantSource();
            src.offset.value = 0;
            for (const param of params) src.connect(param);
            src.start(time);
            src.stop(stopAt);
            return src;
        }

        /**
         * Pitch changes of follow() and followNote() as a function of audio
         * time, in cents from the note's own pitch (note, freq and speed add
         * up), or null when the event follows none of them. `ref` gives the
         * pitch the voice was built at, { note, freq }, for an event whose
         * only note or freq is the one follow() gave it at the onset (or none).
         */
        _followCents(v, ref = {}) {
            const f = v.follow instanceof Follows && v.follow.onset ? v.follow : null;
            if (!f) return null;
            const parts = [];
            const note = isNum(v.note) ? clamp(v.note, 0, 127) : ref.note;
            if (f.has('note') && isNum(note)) {
                parts.push((t) => { const x = f.at('note', t); return isNum(x) ? 100 * (clamp(x, 0, 127) - note) : 0; });
            }
            const freq = isNum(v.freq) ? clamp(v.freq, 20, 20000) : ref.freq;
            if (f.has('freq') && isNum(freq) && freq > 0) {
                parts.push((t) => { const x = f.at('freq', t); return isNum(x) ? 1200 * Math.log2(clamp(x, 20, 20000) / freq) : 0; });
            }
            if (f.has('speed')) {
                const speed = isNum(v.speed) && v.speed !== 0 ? clamp(Math.abs(v.speed), 0.01, 16) : 1;
                parts.push((t) => { const x = f.at('speed', t); return isNum(x) && x !== 0 ? 1200 * Math.log2(clamp(Math.abs(x), 0.01, 16) / speed) : 0; });
            }
            if (!parts.length) return null;
            return (t) => clamp(parts.reduce((sum, part) => sum + part(t), 0), -9600, 9600);
        }

        /**
         * Automates the parameters of a voice (from _route) that follow() and
         * followNote() change, from `from` (the onset) until the voice stops:
         * filter cutoffs and Qs, pan, the level (gain and amp, relative to the
         * level the voice was built at), the peak equaliser, the DJ filter,
         * tremolo, phaser, ring modulation and leslie. Pitch is in
         * _pitchModulation. With `relay` (a live input changed while the
         * voice sounds) what was laid out after `from` is replaced.
         * A voice whose signals read a live input is remembered for that.
         */
        _applyFollows(params, v, timing, from = timing.time, relay = false) {
            const f = v.follow instanceof Follows && v.follow.onset ? v.follow : null;
            if (!params) return;
            if (!f) {
                this._liveVoices.delete(params);
                return;
            }
            const end = timing.stopAt;
            const reads = LIVE_READS.count;
            const lay = (param, fn) => {
                if (!param) return;
                const points = samplePoints(relay ? from + LIVE_GLIDE : from, end, fn);
                if (!relay) automate(param, points);
                else automateFrom(param, from, points);
            };
            const follow = (param, name, map) => {
                if (param && f.has(name)) lay(param, (t) => { const x = f.at(name, t); return isNum(x) ? map(x) : undefined; });
            };
            follow(params.lpf && params.lpf.freq, 'lpf', cutoffHz);
            follow(params.lpf && params.lpf.q, 'resonance', resonanceDb);
            follow(params.hpf && params.hpf.freq, 'hpf', cutoffHz);
            follow(params.hpf && params.hpf.q, 'hpq', resonanceDb);
            follow(params.bpf && params.bpf.freq, 'bpf', cutoffHz);
            follow(params.bpf && params.bpf.q, 'bpq', bandQ);
            follow(params.bpf && params.bpf.gain, 'bpq', (q) => Math.max(bandQ(q), 1));
            follow(params.pan, 'pan', (x) => clamp(x, -1, 1));
            follow(params.peak && params.peak.freq, 'peak', cutoffHz);
            follow(params.peak && params.peak.q, 'peakq', (q) => clamp(q, 0.0001, 40));
            follow(params.peak && params.peak.gain, 'peakgain', (g) => clamp(g, -40, 40));
            follow(params.djf && params.djf.low, 'djf', djfLow);
            follow(params.djf && params.djf.high, 'djf', djfHigh);
            // The vibrato's rate (vib times a second): a vibrato whose speed an LFO moves.
            if (params.vibrato) follow(params.vibrato.rate, 'vib', (x) => clamp(x, 0, 100));
            if (params.tremolo) {
                follow(params.tremolo.rate, 'tremolorate', (x) => clamp(x, 0, 100));
                follow(params.tremolo.gain, 'tremolodepth', (x) => 1 - clamp(x, 0, 1) / 2);
                follow(params.tremolo.amount, 'tremolodepth', (x) => clamp(x, 0, 1) / 2);
            }
            if (params.phaser) {
                for (const s of params.phaser.sweeps) {
                    follow(s.freq, 'phaserrate', (x) => clamp(x, 0, 40));
                    follow(s.amount, 'phaserdepth', (x) => 900 * clamp(x, 0, 1));
                }
            }
            if (params.ring) {
                follow(params.ring.freq, 'ringf', (x) => clamp(x, 0, 20000));
                follow(params.ring.gain, 'ring', (x) => 1 - clamp(x, 0, 1));
                follow(params.ring.amount, 'ring', (x) => clamp(x, 0, 1));
            }
            if (params.leslie) {
                follow(params.leslie.dry, 'leslie', (x) => 1 - clamp(x, 0, 1));
                follow(params.leslie.wet, 'leslie', (x) => clamp(x, 0, 1));
                for (const rate of params.leslie.rates) follow(rate, 'lrate', (x) => clamp(x, 0, 30));
                follow(params.leslie.delay, 'lsize', (x) => 0.002 + clamp(x, 0, 5) / 343);
                follow(params.leslie.swing, 'lsize', (x) => clamp(x, 0, 5) / 343);
            }
            if (params.level && (f.has('gain') || f.has('amp'))) {
                const base = timing.levelBase || 1;
                lay(params.level, (t) => {
                    const g = f.has('gain') ? f.at('gain', t) : v.gain;
                    const a = f.has('amp') ? f.at('amp', t) : v.amp;
                    return levelOf(timing.def, { gain: isNum(g) ? g : undefined, amp: isNum(a) ? a : undefined }) / base;
                });
            }
            if (relay) return;
            // Signals that read a slider, MIDI, OSC or a bus are laid out again when it changes.
            const known = this._liveVoices.get(params);
            if (LIVE_READS.count !== reads) {
                this._liveVoices.set(params, { ...(known || {}), params, v, timing, relayParams: true, key: KEY_CONTEXT.key });
                if (this._liveVoices.size > 64) this._pruneLive();
            } else if (known && known.pitch) {
                this._liveVoices.set(params, { ...known, v, timing, relayParams: false });
            } else {
                this._liveVoices.delete(params);
            }
        }

        /**
         * A live input (a slider, MIDI, OSC, a bus) changed: the sounding
         * voices that follow one are laid out again from now, at most once
         * every LIVE_RELAY_MS milliseconds.
         */
        _liveChanged() {
            if (!this._liveVoices.size) return;
            const wait = this._liveFlushedAt + LIVE_RELAY_MS - Date.now();
            if (wait <= 0) this._relayLive();
            else if (!this._liveTimer && typeof setTimeout === 'function') {
                this._liveTimer = setTimeout(() => {
                    this._liveTimer = null;
                    this._relayLive();
                }, wait);
            }
        }

        /** Forgets the voices of _liveVoices that have ended. */
        _pruneLive() {
            const now = this.audioContext ? this.audioContext.currentTime : 0;
            for (const [key, entry] of this._liveVoices) {
                if (!((entry.handle ? entry.handle.stopAt : entry.timing.stopAt) > now)) this._liveVoices.delete(key);
            }
        }

        /** Lays the followed controls of every sounding voice that reads a live input out again, from now; drops finished voices. */
        _relayLive() {
            this._liveFlushedAt = Date.now();
            const ctx = this.audioContext;
            if (!ctx) return;
            const now = ctx.currentTime;
            for (const [key, entry] of this._liveVoices) {
                const end = entry.handle ? entry.handle.stopAt : entry.timing.stopAt;
                if (!(end > now)) {
                    this._liveVoices.delete(key);
                    continue;
                }
                const from = Math.max(now, entry.timing.time);
                try {
                    withKey(entry.key, () => {
                        if (entry.relayParams) this._applyFollows(entry.params, entry.v, entry.timing, from, true);
                        if (entry.pitch) this._pitchRelay(entry, from);
                    });
                } catch (error) {
                    console.error('TidalJS: could not follow a live input:', error);
                    this._liveVoices.delete(key);
                }
            }
        }

        /**
         * The pitch of a voice that follows a live input (note, freq or speed),
         * laid out again from `from`: its bend (on top of a tied note's pitch
         * and the wheel of a held MIDI key), or its own pitch source.
         */
        _pitchRelay(entry, from) {
            const { param, cents } = entry.pitch;
            const h = entry.handle;
            const base = h ? (h.wheel ? h.wheel.cents : h.cents) : 0;
            const end = h ? h.stopAt : entry.timing.stopAt;
            automateFrom(param, from, samplePoints(from + LIVE_GLIDE, end, (t) => base + cents(t)));
        }

        /**
         * tie: a new event for a voice that still sounds. The voice takes its
         * pitch (gliding over portamento seconds, if set), its length (the
         * gate stays open, no new attack, and closes at the new end, with the
         * new release), and every control it can change in place:
         *   - filters: lpf, hpf, bpf and their resonance/Q, the peak
         *     equaliser (peak, peakq, peakgain), djf, kcutoff;
         *   - level and pan: gain, amp, pan;
         *   - shape, crush, distort/distortion, triode, krush (new curves);
         *   - vowel, tremolo (tremolorate, tremolodepth), phaser
         *     (phaserrate, phaserdepth), ring and ringf, leslie (leslie,
         *     lrate, lsize), vibrato (vib, vibmod);
         *   - the AudioWorklet effects the voice was built with (coarse,
         *     waveloss, squiz, fshift/fshiftnote, octer, the spectral
         *     effects, freeverb/freeroom/freedamp);
         *   - the synth's own parameters that drive running nodes: detune and
         *     voice (supersaw, supersquare, superreese), rate, lfo and
         *     detune (superpwm, superzow), voice, rate and lfo (superchip),
         *     voice and semitone (superfm), voice (superfb);
         *   - its orbit's delay and reverb (delay, delaytime, delayfeedback,
         *     lock, room, size, dry), as every event of the orbit sets them;
         *   - follow() and followNote() of the new event.
         * A tied voice is built with these effects even when its first event
         * leaves them out (set so they change nothing), so a later event can
         * turn them on. Controls the event leaves out keep their current
         * value. Still fixed for the voice's life: the envelope's attack,
         * decay and sustainlevel, the filter and pitch envelopes (lpenv...,
         * penv, pitchenv), accelerate, begin/end/loop, the sound and n, the
         * AudioWorklet effects it was built without, and the other synths'
         * own parameters. Samples ignore tie.
         */
        _retie(h, v, time, holdEnd, freq, ref) {
            const release = isNum(v.release) ? clamp(v.release, 0.001, 10) : h.release;
            const stopAt = holdEnd + release + h.tail + 0.02;
            const def = h.def;
            // The gate: on at its steady level (still rising if the attack has not ended), then the release.
            const level = time <= h.holdEnd ? h.held : h.held * Math.max(0, 1 - (time - h.holdEnd) / h.release);
            holdParam(h.gate, time, level);
            h.gate.linearRampToValueAtTime(h.steady, Math.max(time + 0.005, Math.min(h.attackEnd, holdEnd)));
            this._envSegments(h.gate, holdEnd, h.steady, [{ dur: release, level: 0, curve: h.curve }], Infinity);
            for (const src of h.sources) {
                try { src.stop(stopAt); } catch (e) { /* already stopped */ }
            }
            Object.assign(h, { holdEnd, release, stopAt });
            const timing = { time, holdEnd, release, stopAt, def, levelBase: h.levelBase, freq };
            h.timing = timing;
            const follow = v.follow instanceof Follows && v.follow.onset ? v.follow : null;
            const p = h.params || {};
            this._liveVoices.delete(p);
            // Pitch: from the cents it is at to the new note's, plus the new event's followed pitch.
            if (h.bend) {
                const start = h.cents;
                const target = 1200 * Math.log2(freq / h.freq);
                const glide = isNum(v.portamento) && v.portamento > 0 ? clamp(v.portamento, 0.001, 10) : 0;
                const reads = LIVE_READS.count;
                const cents = this._followCents(v, ref);
                holdParam(h.bend, time, start);
                if (!glide && !cents) h.bend.setValueAtTime(target, time);
                else {
                    automate(h.bend, samplePoints(time, stopAt, (t) => (glide && t < time + glide ? start + ((target - start) * (t - time)) / glide : target)
                        + (cents ? cents(t) : 0)));
                }
                h.cents = target;
                if (cents && LIVE_READS.count !== reads) {
                    this._liveVoices.set(p, { params: p, v, timing, handle: h, relayParams: false, pitch: { param: h.bend, cents } });
                }
            }
            // Filters, pan and level: the new values (or followed signals) from now on.
            const set = (param, value, map) => {
                if (!param) return;
                holdParam(param, time, isNum(value) ? map(value) : undefined);
                if (isNum(value)) param.setValueAtTime(map(value), time);
            };
            set(p.lpf && p.lpf.freq, v.lpf, (x) => (x > 0 ? cutoffHz(x) : 20000));
            set(p.lpf && p.lpf.q, v.resonance, resonanceDb);
            set(p.hpf && p.hpf.freq, v.hpf, (x) => (x > 0 ? cutoffHz(x) : 20));
            set(p.hpf && p.hpf.q, v.hpq, resonanceDb);
            set(p.bpf && p.bpf.freq, v.bpf, (x) => (x > 0 ? cutoffHz(x) : 1000));
            set(p.bpf && p.bpf.q, v.bpq, bandQ);
            set(p.bpf && p.bpf.gain, v.bpq, (q) => Math.max(bandQ(q), 1));
            set(p.pan, v.pan, (x) => clamp(x, -1, 1));
            set(p.level, levelOf(def, v) / h.levelBase, (x) => x);
            // The effects and the synth's own parameters it can change in place.
            if (p.update) p.update(v, time, { freq, holdEnd });
            if (h.vibrato) h.vibrato.update(v, time);
            if (h.tune) {
                for (const [key, change] of Object.entries(h.tune)) if (isNum(v[key])) change(v[key], time, { holdEnd });
            }
            // The orbit's delay and reverb, as any event of the orbit sets them.
            if (p.output) this._orbitSend(p.output, v, time, isNum(v.orbit) ? Math.floor(v.orbit) : 0, p.sends);
            if (follow) {
                this._applyFollows(p, v, timing, time);
                const live = this._liveVoices.get(p);
                if (live) live.handle = h;
            }
        }

        /** Releases a held voice (a MIDI key let go) at `time`: its gate closes over its release, then it stops. */
        _releaseVoice(h, time) {
            if (h.stopAt <= time) return;
            const level = time <= h.holdEnd ? h.held : h.held * Math.max(0, 1 - (time - h.holdEnd) / h.release);
            holdParam(h.gate, time, level);
            this._envSegments(h.gate, time, level, [{ dur: h.release, level: 0, curve: h.curve || 0 }], Infinity);
            const stopAt = time + h.release + (h.tail || 0) + 0.02;
            for (const src of h.sources) {
                try { src.stop(stopAt); } catch (e) { /* already stopped */ }
            }
            Object.assign(h, { holdEnd: time, stopAt });
            if (h.timing) h.timing.stopAt = stopAt;
        }

        /**
         * Lays out envelope segments ({ dur, level, curve }) on a parameter
         * from `start` at `level`, with SuperCollider's curves; segments past
         * `until` stop there part way. Returns the level reached.
         */
        _envSegments(param, start, level, segments, until) {
            param.setValueAtTime(level, start);
            let t = start;
            for (const seg of segments) {
                const from = level;
                const end = Math.min(t + seg.dur, until);
                const span = end - t;
                if (span <= 0) break;
                const x = span / seg.dur;
                const at = (k) => this._envelopeAt({ levels: [from, seg.level], times: [1], curves: [seg.curve] }, k);
                if (!seg.curve || Math.abs(seg.curve) < 0.001 || seg.curve === 'exp') {
                    level = from + (seg.level - from) * x;
                    param.linearRampToValueAtTime(level, end);
                } else {
                    const count = clamp(Math.ceil(span / 0.002), 8, 2048);
                    const values = new Float32Array(count + 1);
                    for (let i = 0; i <= count; i++) values[i] = at((i / count) * x);
                    level = values[count];
                    param.setValueCurveAtTime(values, t, span);
                }
                t = end;
                if (end >= until) break;
            }
            if (Number.isFinite(until) && t < until) param.setValueAtTime(level, until);
            return level;
        }

        /** The FreeVerb2 settings of an event (freeverb, freeroom, freedamp), with the synth's own as defaults, or null. */
        _freeverbOf(def, v) {
            const own = def.freeverb || null;
            const mix = isNum(v.freeverb) ? v.freeverb : own ? own.mix : 0;
            if (!(mix > 0)) return null;
            return {
                mix: clamp(mix, 0, 1),
                room: clamp(isNum(v.freeroom) ? v.freeroom : own ? own.room : 0.5, 0, 1),
                damp: clamp(isNum(v.freedamp) ? v.freedamp : own ? own.damp : 0.5, 0, 1),
            };
        }

        /** The value at time t (seconds) of an envelope { levels, times, curves }, as SuperCollider's Env. */
        _envelopeAt(env, t) {
            return envelopeValue(env, t);
        }

        /** The pitch envelope of an event: pitchenv, else penv and friends (with the synth's defaults), else the synth's own. */
        _pitchEnvelope(def, v) {
            if (v.pitchenv && Array.isArray(v.pitchenv.levels)) return v.pitchenv;
            const keys = ['penv', 'pattack', 'pdecay', 'pcurve'];
            if (def.pitch || keys.some((k) => isNum(v[k]))) {
                const base = { penv: 0, pattack: 0, pdecay: 0.1, pcurve: 0, ...(def.pitch || {}) };
                for (const k of keys) if (isNum(v[k])) base[k] = v[k];
                if (base.penv === 0) return null;
                const curve = base.pcurve;
                return {
                    levels: [0, clamp(base.penv, -96, 96), 0],
                    times: [clamp(base.pattack, 0, 10), clamp(base.pdecay, 0, 30)],
                    curves: [curve, curve],
                };
            }
            return def.pitchenv || null;
        }

        /**
         * Pitch changes while a voice plays, applied to the detune of its
         * oscillators (and sample players), in cents: accelerate, the pitch
         * envelope, vibrato and portamento. They add up. Returns the nodes.
         */
        _pitchModulation(def, v, time, o, targets, stopAt) {
            const ctx = this.audioContext;
            const params = targets.map((src) => src.detune).filter(Boolean);
            if (!params.length || typeof ctx.createConstantSource !== 'function') return [];
            const mods = [];
            const drive = (src) => {
                for (const param of params) src.connect(param);
                src.start(time);
                src.stop(stopAt);
                mods.push(src);
            };
            // A curve of cents over `duration` seconds from the start of the voice.
            const curve = (fn, duration) => {
                const dur = Math.max(0.001, duration);
                const count = clamp(Math.ceil(dur / Math.min(0.002, dur / 64)), 16, 4096);
                const values = new Float32Array(count + 1);
                for (let i = 0; i <= count; i++) values[i] = fn((i / count) * dur);
                const src = ctx.createConstantSource();
                src.offset.value = values[0];
                src.offset.setValueCurveAtTime(values, time, dur);
                drive(src);
            };

            // accelerate: the speed changes by this much (relative to 1) over the sound.
            if (isNum(v.accelerate) && v.accelerate !== 0) {
                const span = Math.max(0.01, o.window);
                const amount = v.accelerate;
                curve((t) => 1200 * Math.log2(Math.max(0.01, 1 + amount * (t / span))), span);
            }

            const env = this._pitchEnvelope(def, v);
            if (env) {
                const total = env.times.reduce((sum, x) => sum + x, 0);
                if (total > 0) curve((t) => 100 * this._envelopeAt(env, t), total);
                else {
                    const src = ctx.createConstantSource();
                    src.offset.value = 100 * env.levels[env.levels.length - 1];
                    drive(src);
                }
            }

            // Vibrato: vib times a second, vibmod semitones each way (0.5 by default).
            // A tied voice has one (at depth 0 without vib) that a later event can change.
            if ((isNum(v.vib) && v.vib > 0) || o.tied) {
                let on = isNum(v.vib) && v.vib > 0;
                let semitones = isNum(v.vibmod) ? clamp(v.vibmod, 0, 48) : 0.5;
                const wobble = ctx.createOscillator();
                const depth = ctx.createGain();
                wobble.frequency.value = isNum(v.vib) ? clamp(v.vib, 0, 100) : 0;
                depth.gain.value = on ? semitones * 100 : 0;
                wobble.connect(depth);
                for (const param of params) depth.connect(param);
                wobble.start(time);
                wobble.stop(stopAt);
                mods.push(wobble, depth);
                mods.vibrato = {
                    // Its rate, for follow("vib", ...) (see _applyFollows).
                    rate: wobble.frequency,
                    update: (e, at) => {
                        if (!isNum(e.vib) && !isNum(e.vibmod)) return;
                        if (isNum(e.vib)) {
                            on = e.vib > 0;
                            setAt(wobble.frequency, clamp(e.vib, 0, 100), at);
                        }
                        if (isNum(e.vibmod)) semitones = clamp(e.vibmod, 0, 48);
                        setAt(depth.gain, on ? semitones * 100 : 0, at);
                    },
                };
            }

            // Portamento: glide from the previous note of this sound over this many seconds.
            if (isNum(v.portamento) && v.portamento > 0 && isNum(o.glideFrom) && Math.abs(o.glideFrom - o.freq) > 1e-6) {
                const src = ctx.createConstantSource();
                const from = 1200 * Math.log2(o.glideFrom / o.freq);
                src.offset.value = from;
                src.offset.setValueAtTime(from, time);
                src.offset.linearRampToValueAtTime(0, time + clamp(v.portamento, 0.001, 10));
                drive(src);
            }

            // follow() / followNote() of note, freq or speed: the pitch moves
            // relative to the note while it sounds (on the bend source of a
            // voice that tie can change, so a later event can take it over).
            // A pitch that reads a live input is laid out again when it changes (see _pitchRelay).
            const reads = LIVE_READS.count;
            const cents = this._followCents(v, o.pitchRef);
            if (cents) {
                const points = samplePoints(time, stopAt, cents);
                let param;
                if (o.bend) param = o.bend.offset;
                else {
                    const src = ctx.createConstantSource();
                    src.offset.value = points.length ? points[0][1] : 0;
                    drive(src);
                    param = src.offset;
                }
                automate(param, points);
                if (o.timing) {
                    o.timing.pitchCents = cents;
                    if (LIVE_READS.count !== reads) o.timing.pitchLive = { param, cents };
                }
            }
            return mods;
        }

        /** Creates the sound source of a voice. Returns { output, sources, nodes, pitched }. */
        _generate(def, o, time, v = {}) {
            const ctx = this.audioContext;
            const t0 = o.start;
            const nodes = [];
            const sources = [];
            const pitched = [];

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
            // The synth's own parameters that a tied event changes in place: name -> (value, time, info).
            const tune = {};

            // Helpers of the SuperDirt-style synths.
            const osc = (wave, freq, opts = {}) => {
                const src = ctx.createOscillator();
                if (typeof wave === 'string') src.type = wave;
                else src.setPeriodicWave(wave);
                src.frequency.value = clamp(freq, 0.01, 22000);
                if (opts.detune) src.detune.value = opts.detune;
                src.start(opts.start === undefined ? time : opts.start);
                sources.push(src);
                if (opts.pitched !== false) pitched.push(src);
                return src;
            };
            const amp = (value) => {
                const g = ctx.createGain();
                g.gain.value = value;
                nodes.push(g);
                return g;
            };
            const chain = (...list) => {
                for (let i = 0; i < list.length - 1; i++) list[i].connect(list[i + 1]);
                return list[list.length - 1];
            };
            const pan = (value) => {
                if (typeof ctx.createStereoPanner !== 'function') return amp(1);
                const p = ctx.createStereoPanner();
                p.pan.value = clamp(value, -1, 1);
                nodes.push(p);
                return p;
            };
            const shaper = (kind, amount) => {
                const ws = ctx.createWaveShaper();
                ws.curve = this._curve(kind, amount);
                ws.oversample = '4x';
                nodes.push(ws);
                return ws;
            };
            const delay = (seconds, max = 0.1) => {
                const d = ctx.createDelay(max);
                d.delayTime.value = seconds;
                nodes.push(d);
                return d;
            };
            // The level of a synth: held for its length when sustained, else decaying over it.
            const body = (peak) => {
                if (!o.sustained) return decayEnv(peak, o.length);
                const env = ctx.createGain();
                env.gain.setValueAtTime(0, t0);
                env.gain.linearRampToValueAtTime(peak, t0 + 0.001);
                nodes.push(env);
                return env;
            };
            const num = (key, fallback, lo, hi) => (isNum(v[key]) ? clamp(v[key], lo, hi) : fallback);
            const f = o.freq;
            // Oscillators of a chorus start at random points of their cycle, as in SuperDirt.
            const phase = () => time + Math.random() / Math.max(20, f);

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
                    const bodyFreq = o.freq + o.variation * 20;
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(bodyFreq, t0);
                    osc.frequency.exponentialRampToValueAtTime(Math.max(20, bodyFreq * 0.7), t0 + 0.08 / o.speed);
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

                // ---- SuperDirt-style synths ----

                // Seven detuned saws (or squares): detune is the spread of the
                // outer ones in semitones, voice the level of the side voices.
                case 'supersaw':
                case 'supersquare': {
                    const wave = def.type === 'supersaw' ? 'sawtooth' : 'square';
                    const spread = num('detune', 0.2, 0, 12) * 100;
                    const side = num('voice', 0.3, 0, 1);
                    const out = body(o.level);
                    const saws = [];
                    const sides = [];
                    for (let i = 0; i < 7; i++) {
                        const x = (i - 3) / 3;
                        const src = osc(wave, f, { detune: x * spread, start: phase() });
                        const level = amp((i === 3 ? 1 : side) / 2.2);
                        saws.push({ src, x });
                        if (i !== 3) sides.push(level);
                        chain(src, level, pan(x * 0.7), out);
                    }
                    out.connect(mix);
                    tune.detune = (val, at) => { for (const s of saws) setAt(s.src.detune, s.x * clamp(val, 0, 12) * 100, at); };
                    tune.voice = (val, at) => { for (const g of sides) setAt(g.gain, clamp(val, 0, 1) / 2.2, at); };
                    break;
                }
                // Pulse-width modulation: a saw minus a delayed copy of itself is
                // a pulse, and sweeping the delay (rate Hz, lfo deep) moves its width.
                case 'superpwm': {
                    const rate = num('rate', 1, 0, 50);
                    const depth = num('lfo', 0.5, 0, 1);
                    const spread = num('detune', 0.06, 0, 12) * 100;
                    const out = body(o.level);
                    const saws = [];
                    const sweeps = [];
                    [-1, 1].forEach((side) => {
                        const sum = amp(0.5);
                        const late = delay(0.5 / f);
                        const a = osc('sawtooth', f, { detune: side * spread });
                        const b = osc('sawtooth', f, { detune: side * spread });
                        chain(a, sum);
                        chain(b, late, amp(-1), sum);
                        const sweep = osc('sine', rate * (side > 0 ? 1.13 : 1), { pitched: false });
                        const width = amp((depth * 0.4) / f);
                        chain(sweep, width, late.delayTime);
                        chain(sum, pan(side * 0.5), out);
                        saws.push({ src: a, side }, { src: b, side });
                        sweeps.push({ sweep, width, ratio: side > 0 ? 1.13 : 1 });
                    });
                    out.connect(mix);
                    tune.rate = (val, at) => { for (const s of sweeps) setAt(s.sweep.frequency, clamp(val, 0, 50) * s.ratio, at); };
                    tune.lfo = (val, at) => { for (const s of sweeps) setAt(s.width.gain, (clamp(val, 0, 1) * 0.4) / f, at); };
                    tune.detune = (val, at) => { for (const s of saws) setAt(s.src.detune, s.side * clamp(val, 0, 12) * 100, at); };
                    break;
                }
                // The hoover (after Nathan Ho's SynthDef): 20 voices, each a saw and
                // a saw an octave down, detuned at random by up to detune semitones
                // and delayed up to 10 ms, spread across the stereo field, saturated
                // with atan. The pitch scoops up from -5 to +6 semitones and settles.
                case 'superhoover': {
                    const bw = Math.pow(2, num('detune', 0.6, 0, 12) / 12);
                    const rnd = () => Math.pow(bw, Math.random() * 2 - 1);
                    const count = 20;
                    // Splay's level compensation, and an eighth for the atan curve's input range.
                    const spread = amp(Math.sqrt(1 / count) / 8);
                    for (let i = 0; i < count; i++) {
                        const late = delay(Math.random() * 0.01, 0.02);
                        osc('sawtooth', f * rnd(), { start: phase() }).connect(late);
                        osc('sawtooth', f * 0.5 * rnd(), { start: phase() }).connect(late);
                        chain(late, pan(-1 + (2 * i) / (count - 1)), spread);
                    }
                    // Env.asr(0.01, 1, 1) on the gate, with its default curve of -4,
                    // before FreeVerb2(mix 0.3, room 0.9); the outer gate is
                    // Env.asr(0, 1, 4, 6), so the reverb rings while it closes.
                    const inner = amp(0);
                    const close = time + o.window;
                    const reached = this._envSegments(inner.gain, time, 0, [{ dur: 0.01, level: 1, curve: -4 }], close);
                    this._envSegments(inner.gain, close, reached, [{ dur: 1, level: 0, curve: -4 }], Infinity);
                    chain(spread, shaper('atan', 8), inner);
                    let out = inner;
                    const reverb = this._freeverbOf(def, v);
                    if (reverb) {
                        const node = this._workletNode('freeverb', reverb, 'superhoover\'s reverb');
                        if (node) {
                            nodes.push(node);
                            out = chain(inner, node);
                        }
                    }
                    chain(out, amp(o.level), mix);
                    break;
                }
                // Reese bass: three saws detuned against each other and a sine an
                // octave down (voice is its level).
                case 'superreese': {
                    const spread = num('detune', 0.15, 0, 12) * 100;
                    const out = body(o.level);
                    const saws = [[-1, -0.6], [0, 0], [1, 0.6]].map(([x, p]) => {
                        const src = osc('sawtooth', f, { detune: x * spread, start: phase() });
                        chain(src, amp(0.4), pan(p), out);
                        return { src, x };
                    });
                    const sub = amp(num('voice', 0.3, 0, 1));
                    chain(osc('sine', f / 2), sub, out);
                    out.connect(mix);
                    tune.detune = (val, at) => { for (const s of saws) setAt(s.src.detune, s.x * clamp(val, 0, 12) * 100, at); };
                    tune.voice = (val, at) => setAt(sub.gain, clamp(val, 0, 1), at);
                    break;
                }
                // Phasing saws: each saw is mixed with a copy whose delay sweeps
                // (rate Hz, lfo deep), and the pitch rises a little and settles.
                case 'superzow': {
                    const rate = num('rate', 0.6, 0, 20);
                    const depth = num('lfo', 0.5, 0, 1);
                    const spread = num('detune', 0.1, 0, 12) * 100;
                    const out = body(o.level);
                    const saws = [];
                    const sweeps = [];
                    for (let i = 0; i < 3; i++) {
                        const saw = osc('sawtooth', f, { detune: (i - 1) * spread, start: phase() });
                        const late = delay(0.004 + i * 0.002);
                        const voiceMix = amp(0.35);
                        saw.connect(voiceMix);
                        chain(saw, late, voiceMix);
                        const sweep = osc('sine', rate * (1 + i * 0.37), { pitched: false });
                        const width = amp(0.003 * depth);
                        chain(sweep, width, late.delayTime);
                        chain(voiceMix, pan((i - 1) * 0.7), out);
                        saws.push({ src: saw, x: i - 1 });
                        sweeps.push({ sweep, width, ratio: 1 + i * 0.37 });
                    }
                    out.connect(mix);
                    tune.rate = (val, at) => { for (const s of sweeps) setAt(s.sweep.frequency, clamp(val, 0, 20) * s.ratio, at); };
                    tune.lfo = (val, at) => { for (const s of sweeps) setAt(s.width.gain, 0.003 * clamp(val, 0, 1), at); };
                    tune.detune = (val, at) => { for (const s of saws) setAt(s.src.detune, s.x * clamp(val, 0, 12) * 100, at); };
                    break;
                }
                // A chiptune pulse: voice is the pulse width (0.05 to 0.5), rate and
                // lfo a vibrato in Hz and semitones (off by default).
                case 'superchip': {
                    const src = osc(this._pulseWave(num('voice', 0.25, 0.05, 0.5)), f);
                    chain(src, body(o.level), mix);
                    const depth = num('lfo', 0, 0, 12);
                    tune.voice = (val, at) => this._atTime(at, () => src.setPeriodicWave(this._pulseWave(clamp(val, 0.05, 0.5))));
                    // A tied voice has the vibrato (at depth 0 without lfo), so a later event can start it.
                    if (depth > 0 || o.tied) {
                        const wobble = osc('sine', num('rate', 6, 0, 50), { pitched: false });
                        const amount = amp(depth * 100);
                        chain(wobble, amount, src.detune);
                        tune.rate = (val, at) => setAt(wobble.frequency, clamp(val, 0, 50), at);
                        tune.lfo = (val, at) => setAt(amount.gain, clamp(val, 0, 12) * 100, at);
                    }
                    break;
                }
                // Two-operator FM: a sine modulated by a sine semitone semitones
                // above (12 by default), voice the modulation index (0 to 1).
                case 'superfm': {
                    let ratio = Math.pow(2, num('semitone', 12, -48, 48) / 12);
                    let index = num('voice', 0.3, 0, 1) * 8;
                    const carrier = osc('sine', f);
                    const modulator = osc('sine', f * ratio);
                    const depth = amp(index * f * ratio);
                    depth.gain.setValueAtTime(index * f * ratio, t0);
                    depth.gain.exponentialRampToValueAtTime(Math.max(0.001, index * f * ratio * 0.25), t0 + Math.max(0.02, o.length));
                    chain(modulator, depth, carrier.frequency);
                    chain(carrier, body(o.level), mix);
                    // A tied event's semitone or voice: the modulator moves and its depth falls again from the new index.
                    const strike = (at, info) => {
                        const top = index * f * ratio;
                        setAt(modulator.frequency, clamp(f * ratio, 0.01, 22000), at);
                        setAt(depth.gain, top, at);
                        depth.gain.exponentialRampToValueAtTime(Math.max(0.001, top * 0.25), at + Math.max(0.02, (info && info.holdEnd ? info.holdEnd : at) - at));
                    };
                    tune.semitone = (val, at, info) => { ratio = Math.pow(2, clamp(val, -48, 48) / 12); strike(at, info); };
                    tune.voice = (val, at, info) => { index = clamp(val, 0, 1) * 8; strike(at, info); };
                    break;
                }
                // SuperCollider's SinOscFB, in the AudioWorklet (see TidalFeedbackSine):
                // voice 0 is a sine, 1 a feedback of 1.5 radians (saw-like).
                case 'superfb': {
                    const feedback = num('voice', 0.5, 0, 1) * 1.5;
                    const node = this._fxState === 'ready' && typeof AudioWorkletNode !== 'undefined'
                        ? new AudioWorkletNode(ctx, 'tidal-fb', {
                            numberOfInputs: 1,
                            numberOfOutputs: 1,
                            outputChannelCount: [1],
                            parameterData: { frequency: clamp(f, 0.01, 22000), feedback },
                        })
                        : null;
                    if (!node) {
                        this._warnOnce(this._fxState === 'loading'
                            ? 'superfb is still loading; it plays a sine until then'
                            : 'superfb needs AudioWorklet, which is not available here; it plays a sine');
                        chain(osc('sine', f), body(o.level), mix);
                        break;
                    }
                    // The gate: 1 from the note's start until the voice stops.
                    const run = ctx.createConstantSource();
                    run.offset.value = 1;
                    run.start(time);
                    sources.push(run);
                    nodes.push(node);
                    run.connect(node);
                    pitched.push({ detune: node.parameters.get('detune') });
                    tune.voice = (val, at) => setAt(node.parameters.get('feedback'), clamp(val, 0, 1) * 1.5, at);
                    chain(node, body(o.level), mix);
                    break;
                }
                // Crackle: random clicks (voice is how many) through a band-pass at freq.
                case 'superstatic': {
                    const src = ctx.createBufferSource();
                    src.buffer = this._dustBuffer(Math.round(1 + num('voice', 0.5, 0, 1) * 30) * 100);
                    src.loop = true;
                    src.start(time, Math.random() * 1.5);
                    sources.push(src);
                    chain(src, filterNode('bandpass', f, 0.5), body(o.level), mix);
                    break;
                }
                // Additive piano: eight slightly stretched partials, the higher ones
                // fading faster, and a hammer thump. voice is the brightness.
                case 'superpiano': {
                    const bright = num('voice', 0.5, 0, 1);
                    for (let k = 1; k <= 8; k++) {
                        const fk = f * k * Math.sqrt(1 + 0.0004 * k * k);
                        if (fk > 18000) break;
                        const level = o.level * 0.6 * Math.pow(k, -(2.2 - bright * 1.4));
                        chain(osc('sine', fk), decayEnv(level, o.length / (1 + 0.5 * (k - 1))), pan(((k % 3) - 1) * 0.15), mix);
                    }
                    chain(noiseSource('white'), filterNode('bandpass', clamp(f * 3, 200, 8000), 1), decayEnv(o.level * 0.15, 0.02), mix);
                    break;
                }
                // Inharmonic partials, each a slowly beating pair. voice is the brightness.
                case 'supergong': {
                    const bright = num('voice', 0.5, 0, 1);
                    [1, 1.483, 1.932, 2.546, 3.044, 3.639, 4.255, 4.953].forEach((ratio, k) => {
                        const fk = f * ratio;
                        if (fk > 18000) return;
                        const env = decayEnv(o.level * 0.5 * Math.pow(0.55 + bright * 0.35, k), o.length * (1 - k * 0.08));
                        osc('sine', fk).connect(env);
                        osc('sine', fk, { detune: 3 + k }).connect(env);
                        chain(env, pan(k % 2 ? 0.3 : -0.3), mix);
                    });
                    break;
                }
                // Kick: a sine falling penv semitones in pdecay seconds, slightly
                // saturated, with a click (voice is its level).
                case 'superkick': {
                    chain(osc('sine', f), decayEnv(o.level, o.length), shaper('shape', 30), mix);
                    chain(noiseSource('white'), filterNode('highpass', 1500, 0.7), decayEnv(o.level * num('voice', 0.4, 0, 1), 0.01), mix);
                    break;
                }
                // TR-808 kick: a long sine with a slow pitch fall and a soft click.
                case 'super808': {
                    chain(osc('sine', f), decayEnv(o.level, o.length), shaper('shape', 20), mix);
                    chain(osc('square', f * 8), decayEnv(o.level * num('voice', 0.2, 0, 1), 0.006), filterNode('lowpass', 4000, 0.7), mix);
                    break;
                }
                // TR-808 hi-hat: six square waves at metallic ratios, band-passed.
                // Only their faint upper harmonics pass, so the sum is boosted.
                case 'superhat': {
                    const sum = amp(3);
                    [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523].forEach((ratio) => osc('square', f * ratio).connect(sum));
                    chain(sum, filterNode('bandpass', 10000, 1), filterNode('highpass', 7000, 0.7), decayEnv(o.level, o.length), mix);
                    break;
                }
                // Snare: two triangle tones and band-passed noise; voice is the tone's share.
                case 'supersnare': {
                    const tone = num('voice', 0.5, 0, 1);
                    [f, f * 1.83].forEach((fr) => chain(osc('triangle', fr), decayEnv(o.level * tone * 0.6, Math.min(o.length, 0.1)), mix));
                    chain(noiseSource('white'), filterNode('highpass', 1200, 0.7), filterNode('bandpass', 3500, 0.6),
                        decayEnv(o.level * (1 - tone * 0.5) * 1.5, o.length), mix);
                    break;
                }
                // Clap: four quick noise bursts around freq Hz, then a tail.
                case 'superclap': {
                    const env = ctx.createGain();
                    nodes.push(env);
                    const g = env.gain;
                    g.setValueAtTime(0, t0);
                    [0, 0.009, 0.019, 0.031].forEach((offset, i) => {
                        const at = t0 + offset + Math.random() * 0.002;
                        const peak = o.level * [1, 0.85, 0.7, 0.6][i];
                        g.setValueAtTime(0.0001, at);
                        g.linearRampToValueAtTime(peak, at + 0.001);
                        g.exponentialRampToValueAtTime(peak * 0.1, at + 0.008);
                    });
                    const tail = t0 + 0.04;
                    g.linearRampToValueAtTime(o.level * 0.6, tail + 0.001);
                    g.exponentialRampToValueAtTime(0.0001, tail + Math.max(0.02, o.length - 0.04));
                    chain(noiseSource('white'), filterNode('bandpass', f, 1.5), env, mix);
                    break;
                }
                // Nathan Ho's gabber kick: a saw whose pitch falls penv semitones
                // (48) to freq, distorted with tanh(100x) + (sign(x) - x) at -8 dB;
                // below 100 Hz on both sides, above 300 Hz with a chorus (two
                // delays swept 0 to 10 ms at 8 Hz, a quarter turn apart, at -2 dB).
                case 'supergabber': {
                    const distorted = chain(osc('sawtooth', f), shaper('gabber', 0));
                    const high = filterNode('highpass', 300, -3.0103); // Butterworth (Q in dB)
                    const low = filterNode('lowpass', 100, -3.0103);
                    distorted.connect(high);
                    distorted.connect(low);
                    const merger = ctx.createChannelMerger(2);
                    nodes.push(merger);
                    [0, 1].forEach((ch) => {
                        const side = amp(1);
                        const late = delay(0.005, 0.02);
                        chain(osc(ch === 0 ? 'sine' : this._cosineWave(), 8, { pitched: false }), amp(0.005), late.delayTime);
                        high.connect(side);
                        chain(high, late, amp(Math.pow(10, -2 / 20)), side);
                        low.connect(side);
                        side.connect(merger, 0, ch);
                    });
                    chain(merger, body(o.level), mix);
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
            return { output: mix, sources, nodes, pitched: pitched.length ? pitched : sources, tune: Object.keys(tune).length ? tune : null };
        }

        /** A pulse wave with the given duty cycle (0 to 1), cached. */
        _pulseWave(duty) {
            const key = Math.round(duty * 100);
            if (!this._waves) this._waves = new Map();
            if (!this._waves.has('pulse' + key)) {
                const n = 64;
                const real = new Float32Array(n);
                const imag = new Float32Array(n);
                for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * (key / 100));
                this._waves.set('pulse' + key, this.audioContext.createPeriodicWave(real, imag));
            }
            return this._waves.get('pulse' + key);
        }

        /** A cosine wave: a sine a quarter turn ahead. */
        _cosineWave() {
            if (!this._waves) this._waves = new Map();
            if (!this._waves.has('cosine')) {
                this._waves.set('cosine', this.audioContext.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0])));
            }
            return this._waves.get('cosine');
        }

        /** Two seconds of random clicks, `density` a second (like SuperCollider's Dust), cached. */
        _dustBuffer(density) {
            const key = 'dust' + density;
            if (!this._noise[key]) {
                const ctx = this.audioContext;
                const length = Math.floor(ctx.sampleRate * 2);
                const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < density * 2; i++) {
                    const at = Math.floor(Math.random() * (length - 4));
                    const a = (Math.random() * 0.7 + 0.3) * (Math.random() < 0.5 ? -1 : 1);
                    data[at] = a;
                    data[at + 1] = a * 0.5;
                    data[at + 2] = a * 0.2;
                }
                this._noise[key] = buffer;
            }
            return this._noise[key];
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
            const now = performance.now();
            const toPerf = (t) => now + (t - ctx.currentTime) * 1000;
            const { channel, controls, note } = midiEventOf(v, duration);
            const at = toPerf(time);
            const owner = this._midiOwner || 'loop';
            try {
                for (const message of controls) {
                    out.send(message, at);
                    this._trackMidi(out, { owner, data: message, at }, now);
                }
                if (!note) return;
                const off = toPerf(time + note.length);
                out.send([0x90 | channel, note.key, note.velocity], at);
                // A note-off from before a Stop (which could not be cancelled) lands inside this note: strike it
                // again just after it, always strictly before this note's own note-off (no recovery when there
                // is no room: the note then ends with the stale note-off, a little early).
                const stale = this._staleOffAt(out, channel, note.key, now);
                let recovery = null;
                if (stale !== null && stale >= at && stale < off) {
                    const r = stale + Math.min(1, (off - stale) / 2);
                    if (r > stale && r < off) {
                        recovery = r;
                        out.send([0x90 | channel, note.key, note.velocity], r);
                    }
                }
                out.send([0x80 | channel, note.key, 0], off);
                this._trackMidi(out, { owner, note: { channel, key: note.key, velocity: note.velocity }, at, off, recovery }, now);
            } catch (err) {
                // An unplugged output throws: skip its events instead of stopping the scheduler.
                this._warnOnce(`MIDI output ${JSON.stringify(out.name || String(v.midi))} could not be used (${err && err.message})`);
            }
        }

        /**
         * Keeps what was sent ahead (with timestamps) to each output until it
         * has passed: notes (until their note-off) and control, program and
         * NRPN messages, each with its owner (the loops, or a one-shot), so
         * Stop can cancel exactly what it stops.
         */
        _trackMidi(out, record, now) {
            if (!this._midiSent) this._midiSent = new Map();
            let list = this._midiSent.get(out);
            if (!list) this._midiSent.set(out, list = []);
            if (list.length >= 256) {
                const live = list.filter((r) => (r.off ?? r.at) > now);
                list.length = 0;
                list.push(...live);
            }
            list.push(record);
        }

        /**
         * Stop for one owner (the loops, a one-shot) or every owner: what it
         * scheduled ahead does not sound. An output with any of its messages
         * pending is cleared where the browser supports clear(), then the
         * pending messages of the other owners are sent again with their
         * times, so a one-shot is not cut by the loops stopping. Its notes
         * already on get their note-off now; without clear(), notes still to
         * come end as they start, and controls already sent cannot be
         * recalled. Disconnected or failing outputs are skipped.
         */
        _cancelMidi(owner = null) {
            const sent = this._midiSent;
            if (!sent || !sent.size) return;
            const now = performance.now();
            const mine = (r) => owner === null || r.owner === owner;
            for (const [out, list] of [...sent]) {
                const live = list.filter((r) => (r.off ?? r.at) > now);
                const cancel = live.filter(mine);
                const keep = live.filter((r) => !mine(r));
                if (keep.length) sent.set(out, keep);
                else sent.delete(out);
                if (!cancel.length || out.state === 'disconnected') continue;
                // Pending: a note-on or control still to come, or the note-off of a note that sounds.
                const pending = cancel.some((r) => r.at > now || (r.note && r.off > now));
                let cleared = false;
                if (pending && typeof out.clear === 'function') {
                    try {
                        out.clear();
                        cleared = true;
                    } catch (e) { /* not supported, or unplugged */ }
                }
                try {
                    for (const r of cancel) {
                        if (!r.note) continue;
                        const off = [0x80 | r.note.channel, r.note.key, 0];
                        if (r.at <= now) out.send(off);              // sounding: ends now
                        else if (!cleared) out.send(off, r.at);      // could not be cancelled: ends as it starts
                        // A recovery note-on still on its way (see _sendMidi) is ended as it arrives too.
                        if (!cleared && r.note && r.recovery !== null && r.recovery !== undefined && r.recovery > now) out.send(off, r.recovery);
                        // Without clear(), its own note-off is still on its way: a note restarted on that key
                        // before then would be cut by it (see _sendMidi, which strikes it again).
                        if (!cleared) this._staleNoteOff(out, r.note.channel, r.note.key, r.off);
                    }
                    // clear() took the others' pending messages too: send them again.
                    if (cleared) {
                        for (const r of keep) {
                            if (r.note) {
                                if (r.at > now) out.send([0x90 | r.note.channel, r.note.key, r.note.velocity], r.at);
                                if (r.recovery !== null && r.recovery !== undefined && r.recovery > now) {
                                    out.send([0x90 | r.note.channel, r.note.key, r.note.velocity], r.recovery);
                                }
                                out.send([0x80 | r.note.channel, r.note.key, 0], r.off);
                            } else if (r.at > now) {
                                out.send(r.data, r.at);
                            }
                        }
                    }
                } catch (e) { /* unplugged meanwhile */ }
            }
        }

        /** Remembers a note-off still on its way to an output (it could not be cancelled), until it arrives. */
        _staleNoteOff(out, channel, key, at) {
            if (!this._staleOffs) this._staleOffs = new Map();
            let keys = this._staleOffs.get(out);
            if (!keys) this._staleOffs.set(out, keys = new Map());
            const id = channel + ':' + key;
            keys.set(id, Math.max(keys.get(id) ?? 0, at));
        }

        /** When a stale note-off for that key will arrive (see _staleNoteOff), or null. */
        _staleOffAt(out, channel, key, now) {
            const keys = this._staleOffs && this._staleOffs.get(out);
            if (!keys) return null;
            const id = channel + ':' + key;
            const at = keys.get(id);
            if (at === undefined) return null;
            if (at <= now) {
                keys.delete(id);
                return null;
            }
            return at;
        }

        /** The loops stopped: none of their MIDI or OSC scheduled ahead goes out any more (called by _halt). */
        _cancelExternalOutput() {
            this._cancelMidi('loop');
            // OSC packets waiting for the socket: the loops' go; a one-shot's stay (Stop ends those, see _endOneShot).
            this._socketQueue = this._socketQueue.filter((p) => p.owner !== 'loop');
        }

        /** All notes off (CC 123) on every channel of every output; unplugged outputs are skipped. */
        _allNotesOff() {
            if (!this.midiAccess) return;
            for (const out of this.midiAccess.outputs.values()) {
                if (out.state === 'disconnected') continue;
                try {
                    for (let ch = 0; ch < 16; ch++) out.send([0xb0 | ch, 123, 0]);
                } catch (e) { /* unplugged meanwhile */ }
            }
        }

        // --- MIDI input --------------------------------------------------

        /** Listens to every MIDI input, and to inputs plugged in later (for midicc and midikeys). Asks for access on first use. */
        _listenMidi() {
            if (this._midiListening) return;
            this._midiListening = true;
            Promise.resolve(this.enableMidi()).then((access) => {
                if (!access) {
                    this._midiListening = false; // asked again by the next midicc() or midikeys()
                    return;
                }
                const attached = new WeakSet();
                const attach = () => {
                    for (const input of access.inputs.values()) {
                        if (attached.has(input)) continue;
                        attached.add(input);
                        const listener = (e) => this._midiIn(e.data, input.id || input.name || '');
                        if (typeof input.addEventListener === 'function') input.addEventListener('midimessage', listener);
                        else input.onmidimessage = listener;
                    }
                };
                attach();
                if (typeof access.addEventListener === 'function') access.addEventListener('statechange', attach);
                else access.onstatechange = attach;
            });
        }

        /**
         * Reads the bytes of MIDI messages from one input: running status (data
         * bytes after a message repeat its status), real-time bytes anywhere,
         * system exclusive and system common messages skipped.
         */
        _midiIn(data, source = '') {
            let p = this._midiParsers.get(source);
            if (!p) {
                p = { status: 0, data: [], sysex: false };
                this._midiParsers.set(source, p);
            }
            for (const byte of data || []) {
                if (byte >= 0xf8) continue;                 // clock, start, stop...: anywhere, change nothing
                if (byte === 0xf0) { p.sysex = true; p.status = 0; continue; }
                if (byte === 0xf7) { p.sysex = false; continue; }
                if (p.sysex && byte < 0x80) continue;
                p.sysex = false;
                if (byte >= 0xf0) { p.status = 0; p.data = []; continue; } // system common: no running status after it
                if (byte >= 0x80) { p.status = byte; p.data = []; continue; }
                if (!p.status) continue;                    // data with no status to belong to
                p.data.push(byte);
                const type = p.status & 0xf0;
                if (p.data.length < (type === 0xc0 || type === 0xd0 ? 1 : 2)) continue;
                const [a, b] = p.data;
                p.data = [];
                this._midiMessage(type, p.status & 0x0f, a, b);
            }
        }

        _midiMessage(type, channel, a, b) {
            if (type === 0xb0) {
                this._midiCC.set(`${channel}:${a}`, b / 127);
                this._midiCC.set(String(a), b / 127);
                this._liveChanged();
            } else if (type === 0x90 && b > 0) {
                this._midiNoteOn(channel, a, b);
            } else if (type === 0x80 || type === 0x90) {
                this._midiNoteOff(channel, a); // a note-on with velocity 0 is a note-off
            } else if (type === 0xe0) {
                // 14 bits, least significant first: 8192 is the centre, 16383 the top.
                const raw = b * 128 + a;
                const x = raw >= 16383 ? 1 : (raw - 8192) / 8192;
                this._midiBend.set(String(channel), x);
                this._midiBend.set('*', x);
                this._midiWheel(channel);
                this._liveChanged();
            } else if (type === 0xd0 || type === 0xa0) {
                // Channel pressure, or the pressure of one key (the last one of any key for miditouch, its own for keytouch).
                const x = (type === 0xd0 ? a : b) / 127;
                if (type === 0xa0) this._polyTouch.set(`${channel}:${a}`, x);
                const seq = ++this._midiSeq;
                this._touchSeq.set(String(channel), seq);
                this._touchSeq.set('*', seq);
                this._midiTouch.set(String(channel), x);
                this._midiTouch.set('*', x);
                this._liveChanged();
            }
        }

        /** The wheel's bend in cents for a voice of a midikeys() with a bend range: its channel's (any channel's if it has none) last bend. */
        _wheelCents(wheel) {
            const x = this._midiBend.get(wheel.channel === null ? '*' : String(wheel.channel)) ?? 0;
            return x * wheel.range * 100;
        }

        /** A pitch bend on `channel`: the held keys of each midikeys() with a bend range on that channel bend. */
        _midiWheel(channel) {
            const ctx = this.audioContext;
            if (!ctx) return;
            const time = ctx.currentTime;
            for (const [held, voices] of this._midiHeld) {
                for (const h of voices) {
                    if (!h.wheel || !h.bend || h.stopAt <= time) continue;
                    if (h.wheel.channel !== null && h.wheel.channel !== channel) continue;
                    const cents = h.cents + this._wheelCents(h.wheel);
                    // On top of a followed pitch, if the voice has one.
                    const follow = h.timing && h.timing.pitchCents;
                    if (follow) withKey(held, () => automateFrom(h.bend, time, samplePoints(time + LIVE_GLIDE, h.stopAt, (t) => cents + follow(t))));
                    else {
                        holdParam(h.bend, time, h.wheel.cents);
                        h.bend.linearRampToValueAtTime(cents, time + 0.005);
                    }
                    h.wheel.cents = cents;
                }
            }
        }

        /**
         * A key pressed: each midikeys() template on its channel plays its values
         * (from its first event in the current cycle) with the key as note and
         * amp scaled by the velocity, held until the key is let go.
         */
        _midiNoteOn(channel, key, velocity) {
            const ctx = this.audioContext;
            if (!ctx || !this._midiKeys.length) return;
            if (!this._session) this._session = this._createSession();
            const time = ctx.currentTime;
            this._midiNoteOff(channel, key, time); // the same key again: the last one ends
            this._polyTouch.delete(`${channel}:${key}`); // a new press starts without pressure
            this._keySeq.set(`${channel}:${key}`, ++this._midiSeq);
            const cycle = Math.floor(this.isPlaying ? this.cycleAt(time) : 0);
            const voices = [];
            for (const { pattern, channel: wanted, bendRange } of this._midiKeys) {
                if (wanted !== null && wanted !== channel) continue;
                let first;
                try {
                    first = pattern.query(cycle, cycle + 1).sort((x, y) => x.begin - y.begin)[0];
                } catch (error) {
                    console.error('TidalJS: midikeys pattern error:', error);
                    continue;
                }
                if (!first) continue;
                const base = asObject(first.value);
                const def = this.samples.get(base.s);
                const amp = isNum(base.amp) ? base.amp : def && isNum(def.amp) ? def.amp : 0.4;
                const v = { ...base, note: key, amp: (amp * velocity) / 127, sustain: MIDI_HOLD };
                // The key sets the pitch and how long it sounds.
                for (const k of ['freq', 'midinote', 'up', 'legato', 'hold', 'tie']) delete v[k];
                try {
                    const voice = withKey(`${channel}:${key}`, () => this.playEvent(v, time, MIDI_HOLD, true));
                    if (voice && bendRange > 0 && voice.bend) {
                        // The wheel bends this voice; a key pressed with the wheel off centre starts bent.
                        voice.wheel = { channel: wanted, range: bendRange, cents: 0 };
                        const cents = this._wheelCents(voice.wheel);
                        if (cents !== 0) {
                            const base = voice.cents + cents;
                            const follow = voice.timing && voice.timing.pitchCents;
                            if (follow) withKey(`${channel}:${key}`, () => automateFrom(voice.bend, time, samplePoints(time, voice.stopAt, (t) => base + follow(t))));
                            else voice.bend.setValueAtTime(base, time);
                            voice.wheel.cents = base;
                        }
                    }
                    if (voice) voices.push(voice);
                } catch (error) {
                    console.error('TidalJS: could not play a MIDI key:', error);
                }
            }
            if (voices.length) this._midiHeld.set(`${channel}:${key}`, voices);
        }

        /** A key let go: its voices release. */
        _midiNoteOff(channel, key, time) {
            const held = this._midiHeld.get(`${channel}:${key}`);
            if (!held) return;
            this._midiHeld.delete(`${channel}:${key}`);
            const at = isNum(time) ? time : this.audioContext ? this.audioContext.currentTime : 0;
            for (const voice of held) this._releaseVoice(voice, at);
        }

        // --- OSC -------------------------------------------------------

        /**
         * The WebSocket of the OSC bridge (see setOscUrl), opened on first use.
         * It sends .osc() events, and binary messages coming back (OSC packets
         * the bridge received over UDP) feed oscIn(). Null without WebSocket.
         */
        _oscSocket() {
            if (typeof WebSocket === 'undefined') return null;
            if (this._socket) return this._socket;
            let socket;
            try {
                socket = new WebSocket(this.oscUrl);
            } catch (err) {
                this._warnOnce(`Invalid OSC WebSocket URL ${this.oscUrl}`);
                return null;
            }
            socket.binaryType = 'arraybuffer';
            socket.onopen = () => {
                // A socket replaced meanwhile (setOscUrl, reconnect) sends nothing.
                if (this._socket !== socket) return;
                const queue = this._socketQueue;
                this._socketQueue = [];
                const now = Date.now() / 1000;
                for (const { packet, at } of queue) {
                    if (at < now) continue; // its time has passed: it would play late
                    try {
                        socket.send(packet);
                    } catch (e) {
                        break;
                    }
                }
            };
            socket.onerror = () => this._warnOnce(`Could not connect to the OSC bridge at ${this.oscUrl}`);
            socket.onclose = () => { if (this._socket === socket) this._socket = null; };
            socket.onmessage = (e) => this._oscReceive(e.data);
            this._socket = socket;
            return socket;
        }

        /** OSC packets from the bridge (an ArrayBuffer, typed array or Blob): keeps each address's numeric arguments for oscIn(). */
        _oscReceive(data) {
            if (data && typeof data.arrayBuffer === 'function' && !(data instanceof ArrayBuffer)) {
                data.arrayBuffer().then((buffer) => this._oscReceive(buffer), () => {});
                return;
            }
            let bytes;
            if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
            else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            else return; // text frames are not OSC
            let messages;
            try {
                messages = parseOsc(bytes);
            } catch (error) {
                this._warnOnce(`An OSC packet from the bridge could not be read (${error.message})`);
                return;
            }
            for (const { address, args } of messages) {
                const values = this._oscValues.get(address) || [];
                args.forEach((arg, i) => {
                    if (isNum(arg)) values[i] = arg;
                    else if (typeof arg === 'boolean') values[i] = arg ? 1 : 0;
                });
                this._oscValues.set(address, values);
                this._liveChanged();
                // After its values are kept, so oscIn() in an oscplay() template reads this message.
                this._oscPlay(address);
            }
        }

        /**
         * An OSC message on an address: each oscplay() template for it plays
         * its first event of the current cycle once, now, at that event's length.
         */
        _oscPlay(address) {
            const ctx = this.audioContext;
            if (!ctx || !this._oscPlays.length) return;
            const plays = this._oscPlays.filter((p) => p.address === address);
            if (!plays.length) return;
            if (!this._session) this._session = this._createSession();
            const time = ctx.currentTime;
            const cycle = Math.floor(this.isPlaying ? this.cycleAt(time) : 0);
            for (const { pattern } of plays) {
                let first;
                try {
                    first = pattern.query(cycle, cycle + 1).sort((x, y) => x.begin - y.begin)[0];
                } catch (error) {
                    console.error('TidalJS: oscplay pattern error:', error);
                    continue;
                }
                if (!first) continue;
                try {
                    this.playEvent(asObject(first.value), time, (first.end - first.begin) / this.cps);
                } catch (error) {
                    console.error('TidalJS: could not play an OSC message:', error);
                }
            }
        }

        _sendOsc(v, time, duration) {
            if (!this._oscSocket()) return;
            const args = ['cps', this.cps, 'cycle', this.cycleAt(time), 'delta', duration];
            for (const [key, value] of Object.entries(v)) {
                if (key === 'osc' || value === undefined || value === null) continue;
                if (typeof value === 'number' || typeof value === 'string') args.push(key, value);
            }
            const wall = Date.now() / 1000 + (time - this.audioContext.currentTime);
            const packet = oscBundle(wall, oscMessage(String(v.osc), args));
            // Until the socket opens, packets wait (dropped by Stop and setOscUrl).
            if (this._socket.readyState === 1) this._socket.send(packet);
            else if (this._socketQueue.length < 256) this._socketQueue.push({ packet, at: wall, owner: this._midiOwner || 'loop' });
        }

        // --- Recording and export --------------------------------------

        /**
         * Starts recording the audio output. Returns false if already
         * recording; throws (leaving nothing connected) if it cannot start.
         * A recorder error ends the recording and calls onRecordingError.
         */
        startRecording() {
            if (!this.audioContext) throw new Error('Call tidal.init() before recording');
            if (this._recorder) return false;
            if (typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser');
            const rec = { recorder: null, chunks: [], dest: null, done: false, settle: null, timer: null };
            try {
                rec.dest = this.audioContext.createMediaStreamDestination();
                this.output.connect(rec.dest);
                const recorder = new MediaRecorder(rec.dest.stream);
                rec.recorder = recorder;
                recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
                recorder.onerror = (e) => this._recordingEnded(rec, (e && e.error) || new Error('the recorder stopped with an error'));
                recorder.onstop = () => this._recordingEnded(rec, null);
                recorder.start();
            } catch (error) {
                rec.done = true;
                this._releaseRecording(rec);
                throw error;
            }
            this._recorder = rec;
            return true;
        }

        /** True only while a recording is running (not after an error, nor while it is being saved). */
        get isRecording() {
            return !!this._recorder;
        }

        /**
         * Stops recording, downloads the file and resolves with the Blob.
         * Resolves null when not recording or when nothing was recorded (no
         * file then); rejects if the recorder fails. Never left pending.
         */
        stopRecording(filename = 'tidaljs-recording') {
            const rec = this._recorder;
            if (!rec) return Promise.resolve(null);
            this._recorder = null;
            return new Promise((resolve, reject) => {
                rec.settle = { resolve, reject, filename };
                if (rec.recorder.state === 'inactive') {
                    this._recordingEnded(rec, null); // already stopped: its data is all there
                    return;
                }
                try {
                    rec.recorder.stop();
                } catch (error) {
                    this._recordingEnded(rec, error);
                    return;
                }
                // A recorder that never reports back does not leave the promise pending.
                if (!rec.done) {
                    rec.timer = setTimeout(() => this._recordingEnded(rec, new Error('the recorder did not finish')), this.recordingTimeout || 10000);
                }
            });
        }

        /** The end of a recording (stopped, failed or timed out), handled once: releases it, then saves or reports. */
        _recordingEnded(rec, error) {
            if (rec.done) return;
            rec.done = true;
            if (rec.timer) clearTimeout(rec.timer);
            if (this._recorder === rec) this._recorder = null;
            this._releaseRecording(rec);
            const settle = rec.settle;
            if (error) {
                const err = error instanceof Error ? error : new Error(String(error && error.message || error));
                if (settle) settle.reject(err);
                else if (typeof this.onRecordingError === 'function') this.onRecordingError(err);
                else console.error('TidalJS: recording failed:', err);
                return;
            }
            if (!settle) return; // stopped by the browser without stopRecording(): nothing asked for the file
            const type = (rec.recorder && rec.recorder.mimeType) || 'audio/webm';
            const blob = new Blob(rec.chunks, { type });
            if (!blob.size) {
                settle.resolve(null); // nothing recorded: no file
                return;
            }
            const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
            try {
                downloadBlob(blob, `${settle.filename}.${ext}`);
            } catch (e) {
                settle.reject(e);
                return;
            }
            settle.resolve(blob);
        }

        /** Disconnects a recording's destination and stops its media tracks. */
        _releaseRecording(rec) {
            const dest = rec.dest;
            if (!dest) return;
            rec.dest = null;
            try { this.output.disconnect(dest); } catch (e) { /* not connected */ }
            try {
                if (dest.stream && typeof dest.stream.getTracks === 'function') dest.stream.getTracks().forEach((track) => track.stop());
            } catch (e) { /* already ended */ }
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

        /**
         * A Standard MIDI File (format 0, 480 ticks a beat, 4 beats a cycle) of
         * the events, read as .midi() reads them live (see midiEventOf), except
         * that named drums with no channel go on General MIDI's percussion
         * channel (9), as exported files always had them.
         */
        _midiFile(events) {
            const ppq = 480;
            const ticksPerCycle = ppq * 4;
            const toTick = (cycle) => Math.round(cycle * ticksPerCycle);
            // At one tick: note-offs, then program and control changes, then note-ons.
            const messages = [];
            for (const ev of events) {
                const { channel, controls, note } = midiEventOf(ev.value, (ev.end - ev.begin) / this.cps, { drumChannel: true });
                const on = toTick(ev.begin);
                for (const data of controls) messages.push({ tick: on, order: 1, data });
                if (!note) continue; // control-only: no note
                const off = Math.max(on + 1, toTick(ev.begin + note.length * this.cps));
                messages.push({ tick: on, order: 2, data: [0x90 | channel, note.key, note.velocity] });
                messages.push({ tick: off, order: 0, data: [0x80 | channel, note.key, 0] });
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

    /** Why samples(source, base) cannot be a sample source, or null when it can. */
    function invalidSampleSource(source, base) {
        const expects = 'samples() expects "github:user/repo", a manifest URL or { name: [files] }';
        if (typeof base !== 'string') return 'samples(): the base URL must be text';
        if (typeof source === 'string') {
            if (!source.trim()) return expects + ', not an empty text';
            if (/^\s*github:/i.test(source) && !/^github:[^/\s]+\/[^/\s]+(?:\/[^\s]+)?$/.test(source.trim())) {
                return `samples("${source}"): a GitHub source is "github:user/repo" (or github:user/repo/branch)`;
            }
            return null;
        }
        if (!source || typeof source !== 'object' || Array.isArray(source)) return expects;
        return null;
    }

    /**
     * URL of a sample manifest: "github:user/repo" (or "github:user/repo/branch")
     * is that repository's strudel.json; a folder URL gets /strudel.json added.
     */
    function manifestUrl(source) {
        const github = /^github:([^/\s]+)\/([^/\s]+)(?:\/([^\s]+))?$/.exec(source.trim());
        if (github) {
            const [, user, repo, rest] = github;
            // github:user/repo/file.json is a manifest in the main branch; github:user/repo/branch a branch.
            if (rest && /\.json$/.test(rest)) return `https://raw.githubusercontent.com/${user}/${repo}/main/${rest}`;
            return `https://raw.githubusercontent.com/${user}/${repo}/${rest || 'main'}/strudel.json`;
        }
        if (/\.json(\?.*)?$/.test(source)) return source;
        return source.replace(/\/?$/, '/') + 'strudel.json';
    }

    /**
     * The banks of a manifest or of banks given in code, with their files
     * resolved against `root`: [{ name, urls, pitched }]. A bank given as
     * { note: file } (e.g. { C4: "c4.wav", Ds4: ... }) is pitched: note()
     * picks the nearest recording and plays it at the right pitch.
     */
    function planBanks(map, root) {
        const full = (f) => resolveUrl(f, root);
        const plan = [];
        for (const [name, files] of Object.entries(map)) {
            if (name.startsWith('_')) continue;
            const list = (Array.isArray(files) ? files : typeof files === 'string' ? [files] : Object.values(files || {}))
                .filter((f) => typeof f === 'string');
            if (list.length === 0) continue;
            let pitched = null;
            if (files && typeof files === 'object' && !Array.isArray(files)) {
                const notes = Object.entries(files)
                    .map(([key, f]) => ({ midi: noteNameToMidi(key), url: typeof f === 'string' ? full(f) : null }))
                    .filter((x) => x.midi !== undefined && x.url);
                if (notes.length) pitched = notes.sort((a, b) => a.midi - b.midi);
            }
            plan.push({ name, urls: list.map(full), pitched });
        }
        return plan;
    }

    /** The page's address, the base of relative sample paths given in code; null outside a page. */
    function pageBase() {
        const doc = root.document;
        if (doc && typeof doc.baseURI === 'string' && doc.baseURI) return doc.baseURI;
        const loc = root.location;
        return loc && typeof loc.href === 'string' && loc.href ? loc.href : null;
    }

    /**
     * A URL resolved against a base, as a link would be: absolute ones stay,
     * "/x" goes to the base's origin, "x" next to it. Without a usable base
     * (outside a page), the path is put after the base as text.
     */
    function resolveUrl(path, base) {
        if (/^[a-z][a-z\d+.-]*:/i.test(path)) return path;
        if (base) {
            try {
                return new URL(path, base).href;
            } catch (e) { /* not a URL base: below */ }
        }
        return (base || '') + path;
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
    TidalJS.parseOsc = parseOsc;
    TidalJS.oscMessage = oscMessage;
    TidalJS.oscBundle = oscBundle;
    TidalJS.samplePoints = samplePoints;
    // The source of the AudioWorklet module (effects and superfb), for tests.
    TidalJS.workletModule = fxWorkletModule;
    // Name lists, used by the editor's autocomplete.
    TidalJS.soundNames = Object.keys(SAMPLE_DEFS);
    TidalJS.scaleNames = Object.keys(SCALES);
    TidalJS.chordNames = Object.keys(CHORDS).filter((name) => !/^\d+$/.test(name));
    TidalJS.arpModes = Object.keys(ARP_MODES);
    TidalJS.vowels = Object.keys(VOWELS);
    TidalJS.takeControls = TAKE_CONTROLS;
    root.TidalJS = TidalJS;
    root.PatternBuilder = PatternBuilder;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { TidalJS, PatternBuilder };
    }
})(typeof window !== 'undefined' ? window : globalThis);
