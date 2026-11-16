/**
 * Tests for the SuperCollider importer (src/supercollider/): the parser,
 * the interpreter, and conversions whose TidalJS code is played in the
 * engine and compared with what SuperCollider would play. npm test
 */
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { convertSuperCollider, looksLikeSuperCollider } from '../src/supercollider/index.ts';
import { parse } from '../src/supercollider/parser.ts';
import { Interpreter } from '../src/supercollider/interpreter.ts';
import { parseImport, parseImportAsync } from '../src/library.ts';
import { convertSuperColliderAsync } from '../src/supercollider/client.ts';
import { isSafeBinding, TIDAL_GLOBALS } from '../src/supercollider/emit.ts';

vm.runInThisContext(fs.readFileSync(new URL('../tidal.js', import.meta.url), 'utf8'), { filename: 'tidal.js' });
console.warn = () => {};
console.error = () => {};
const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} } });
const t = new globalThis.TidalJS();
t.audioContext = { currentTime: 0, state: 'running', createGain: node, resume() {} };
t.masterGain = node();
t.setupGlobalFunctions();
t._startTimer = () => {};
t._stopTimer = () => {};

let passed = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };
const ok = (v, msg) => { assert.ok(v, msg); passed++; };
const near = (a, b, msg, tol = 1e-5) => { assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`); passed++; };

/** Runs SuperCollider code in the interpreter and returns the value of the last statement. */
function sc(code) {
  const interp = new Interpreter();
  const program = parse(code);
  let last = null;
  for (const st of program) last = interp.eval(st, interp['global']);
  return last;
}

/** Converts, plays the TidalJS code in the engine, returns its events in seconds. */
function play(code, seconds = 8, allowWarnings = null) {
  const { code: js, parts } = convertSuperCollider(code, 'test.scd');
  const result = t.eval(js);
  assert.ok(result.success, 'the converted code fails: ' + result.error + '\n' + js);
  const warnings = allowWarnings ? result.warnings.filter((w) => !allowWarnings.test(w)) : result.warnings;
  assert.deepStrictEqual(warnings, [], 'the converted code warns:\n' + js);
  const events = [];
  for (const p of t.channels.values()) {
    for (const ev of p.query(0, seconds * t.cps - 1e-9)) events.push({ time: Math.round((ev.begin / t.cps) * 1e9) / 1e9, length: (ev.end - ev.begin) / t.cps, ...ev.value });
  }
  t.stopAll();
  events.sort((a, b) => a.time - b.time || (a.note ?? 0) - (b.note ?? 0));
  return { js, parts, events };
}

// ---------------------------------------------------------------- the language

eq(sc('1 + 2 * 3'), 9); // no precedence: left to right
eq(sc('2 ** 3 + 1'), 9);
near(sc('-20.dbamp'), 0.1, 'negative literal then method');
eq(sc('(0..4)'), [0, 1, 2, 3, 4]);
eq(sc('(1, 3..9)'), [1, 3, 5, 7, 9]);
eq(sc('[1, 2, 3].sum'), 6);
eq(sc('[1, 2, 3] * 2'), [2, 4, 6]);
eq(sc('[1, 2] + [10, 20, 30]'), [11, 22, 31]);
eq(sc('[0, 5, 10].normalize'), [0, 0.5, 1]);
near(sc('0.5.linexp(0, 1, 100, 400)'), 200, 'linexp');
eq(sc('var a = 3; a = a + 1; a'), 4);
eq(sc('{ |x, y = 2| x * y }.value(5)'), 10);
eq(sc('f = { arg n; n + 1 }; f.(1)'), 2);
eq(sc('[1, 2, 3].collect({ |x, i| x * i })'), [0, 2, 6]);
eq(sc('Array.fill(3, { |i| i * i })'), [0, 1, 4]);
eq(sc('3.dup(2)'), [3, 3]);
eq(sc('4 ! 3'), [4, 4, 4]);
eq(sc('if(2 > 1, { 10 }, { 20 })'), 10);
eq(sc('if (1 > 2) { 10 } { 20 }'), 20);
eq(sc('x = 0; 4.do { |i| x = x + i }; x'), 6);
eq(sc('[1, 2, 3].reverse.rotate(1)'), [1, 3, 2]);
eq(sc('Scale.minor.degrees'), [0, 2, 3, 5, 7, 8, 10]);
eq(sc('/* a /* nested */ comment */ 7 // the end'), 7);
eq(sc('(a: 1, b: 2)').get('b'), 2);
eq(sc('nil ?? { 5 }'), 5);
eq(sc('3 ?? { 5 }'), 3);
eq(sc('4 !? { |x| x * 2 }'), 8);
eq(sc('nil !? { |x| x * 2 }'), null);
assert.throws(() => convertSuperCollider('Pbind(\\dur, 1'), /syntax error.*line 1/i);
passed++;

// ---------------------------------------------------------------- detection

ok(looksLikeSuperCollider('', 'song.scd'), '.scd is SuperCollider');
ok(looksLikeSuperCollider('SynthDef(\\a, { Out.ar(0, SinOsc.ar) }).add;'), 'SynthDef is SuperCollider');
ok(looksLikeSuperCollider('Pbind(\\dur, 0.5).play;'), 'Pbind is SuperCollider');
ok(!looksLikeSuperCollider('sound("bd sn")'), 'TidalJS is not SuperCollider');
ok(!looksLikeSuperCollider('SynthDef', 'beat.js'), 'a .js file is not SuperCollider');
{
  const r = parseImport('Pbind(\\degree, Pseq([0, 2], inf), \\dur, 0.5).play;', 'my-tune.scd');
  eq([r.kind, r.from, r.title, r.parts], ['code', 'supercollider', 'my tune', 1]);
  ok(/sound\("saw"\)/.test(r.code), 'the import is TidalJS code');
}

// ---------------------------------------------------------------- conversions

// The gabber track: two SynthDefs that TidalJS has ports of, a Ppar of two Pbinds, a TempoClock.
const TRACK = String.raw`(
SynthDef(\gabberkick, {
    var snd, freq, high, lfo;
    freq = \freq.kr(440) * (Env.perc(0.001, 0.08, curve: -1).ar * 48 * \bend.kr(1)).midiratio;
    snd = Saw.ar(freq);
    snd = (snd * 100).tanh + ((snd.sign - snd) * -8.dbamp);
    high = HPF.ar(snd, 300);
    lfo = SinOsc.ar(8, [0, 0.5pi]).range(0, 0.01);
    high = high.dup(2) + (DelayC.ar(high, 0.01, lfo) * -2.dbamp);
    snd = LPF.ar(snd, 100).dup(2) + high;
    snd = RLPF.ar(snd, 7000, 2);
    snd = BPeakEQ.ar(snd, \ffreq.kr(3000) * XLine.kr(1, 0.8, 0.3), 0.5, 15);
    snd = snd * Env.asr(0.001, 1, 0.05).ar(2, \gate.kr(1));
    Out.ar(\out.kr(0), snd * \amp.kr(0.1));
}).add;
SynthDef(\hoover, {
    var snd, freq, bw, delay, decay;
    freq = \freq.kr(440);
    freq = freq * Env([-5, 6, 0], [0.1, 1.7], [\lin, -4]).kr.midiratio;
    bw = 1.035;
    snd = { DelayN.ar(Saw.ar(freq * ExpRand(bw, 1 / bw)) + Saw.ar(freq * 0.5 * ExpRand(bw, 1 / bw)), 0.01, Rand(0, 0.01)) }.dup(20);
    snd = (Splay.ar(snd) * 3).atan;
    snd = snd * Env.asr(0.01, 1.0, 1.0).kr(0, \gate.kr(1));
    snd = FreeVerb2.ar(snd[0], snd[1], 0.3, 0.9);
    snd = snd * Env.asr(0, 1.0, 4, 6).kr(2, \gate.kr(1));
    Out.ar(\out.kr(0), snd * \amp.kr(0.1));
}).add;
)
(
var durations;
durations = [1, 1, 1, 1, 3/4, 1/4, 1/2, 3/4, 1/4, 1/2];
Ppar([
    Pbind(*[
        instrument: \gabberkick,
        amp: -23.dbamp,
        freq: 60,
        legato: 0.8,
        ffreq: Pseq((0..(durations.size * 4 - 1)).normalize, inf).linexp(0, 1, 100, 4000),
        dur: Pseq(durations, inf),
        bend: Pfuncn({ |x| if(x < (1/2), 0.4, 1) }, inf) <> Pkey(\dur),
    ]),
    Pbind(*[
        instrument: \hoover,
        amp: -20.dbamp,
        midinote: 74,
        dur: durations.sum * 2,
        sustain: 7,
    ])
]).play(TempoClock(210 / 60));
)`;
{
  const { js, parts, events } = play(TRACK, 64);
  eq(parts, 2);
  ok(js.includes('setCPS(0.5)'), 'one cycle is the 7 beats of the kick figure');
  ok(js.includes('sound("supergabber")') && js.includes('sound("superhoover")'), 'the SynthDefs become their TidalJS ports');
  ok(js.includes('.lpf(7000)') && js.includes('.peakq(2)') && js.includes('.peakgain(15)'), "the gabber kick's filters become effects");
  // SuperCollider's events, from the Pbinds.
  const bps = 210 / 60;
  const durations = [1, 1, 1, 1, 0.75, 0.25, 0.5, 0.75, 0.25, 0.5];
  const ref = [];
  for (let beat = 0, i = 0; beat / bps < 64 - 1e-9; i++) {
    const dur = durations[i % 10];
    ref.push({ s: 'supergabber', time: beat / bps, freq: 60, peak: 100 * Math.pow(40, (i % 40) / 39), penv: dur < 0.5 ? 19.2 : 48, length: dur * 0.8 / bps, amp: Math.pow(10, -23 / 20) });
    beat += dur;
  }
  for (let beat = 0; beat / bps < 64 - 1e-9; beat += 14) ref.push({ s: 'superhoover', time: beat / bps, note: 74, length: 7 / bps, amp: 0.1 });
  eq(events.length, ref.length);
  for (const r of ref) {
    const got = events.find((e) => e.s === r.s && Math.abs(e.time - r.time) < 1e-6);
    ok(got, 'missing ' + r.s + ' at ' + r.time);
    if (r.freq) eq(got.freq, r.freq);
    if (r.note) eq(got.note, r.note);
    if (r.peak) near(got.peak, r.peak, 'peak');
    if (r.penv) near(got.penv, r.penv, 'penv');
    near(got.legato * got.length, r.length, 'length');
    near(got.amp, r.amp, 'amp');
  }
}

// Degrees on the default synth.
{
  const { js, events } = play('Pbind(\\degree, Pseq([0, 2, 4, 7], inf), \\dur, 0.25).play;', 2);
  ok(js.includes('"c4 e4 g4 c5"'), 'degrees become note names');
  eq(events.map((e) => e.time), Array.from({ length: 8 }, (_, i) => i * 0.25));
  eq(events.map((e) => e.note), [60, 64, 67, 72, 60, 64, 67, 72]);
  ok(events.every((e) => Math.abs(e.legato - 0.8) < 1e-9), 'the default legato is 0.8');
}

// Rests, random values.
{
  const { js, events } = play('Pbind(\\note, Pseq([0, \\rest, 3, 5], inf), \\dur, 0.5, \\amp, Pwhite(0.05, 0.2), \\pan, Prand([-1, 0, 1], inf)).play;', 4);
  ok(js.includes('rand.range(0.06, 0.24)') && js.includes('choose([-1, 0, 1])'), 'random patterns become TidalJS random signals');
  eq(events.map((e) => e.time), [0, 1, 1.5, 2, 3, 3.5]);
  eq(events.map((e) => e.note), [60, 63, 65, 60, 63, 65]);
  ok(events.every((e) => e.amp >= 0.06 && e.amp <= 0.24 && [-1, 0, 1].includes(e.pan)), 'random values in range');
}

// Sections: Pseq of finite Pbinds.
{
  const { events } = play('Pseq([Pbind(\\note, Pseq([0, 4, 7]), \\dur, 0.5), Pbind(\\note, Pseq([12, 7]), \\dur, 1)], inf).play;', 7);
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [0.5, 64], [1, 67], [1.5, 72], [2.5, 67], [3.5, 60], [4, 64], [4.5, 67], [5, 72], [6, 67]]);
}

// A routine with Synth and wait, and a SynthDef with an argument for its filter.
{
  const { js, events } = play(String.raw`SynthDef(\pluck, { |out = 0, freq = 440, amp = 0.2, cutoff = 2000, rq = 0.3|
  var sig = Saw.ar(freq) * Env.perc(0.01, 0.5).ar(2);
  sig = RLPF.ar(sig, cutoff, rq);
  Out.ar(out, Pan2.ar(sig * amp, 0));
}).add;
Routine({ loop { [60, 63, 67].do { |m| Synth(\pluck, [\freq, m.midicps, \cutoff, 1200]); 0.25.wait } } }).play;`, 1.5);
  ok(js.includes('.attack(0.01).hold(0).release(0.5)'), 'Env.perc becomes attack, hold and release');
  eq(events.map((e) => e.time), [0, 0.25, 0.5, 0.75, 1, 1.25]);
  events.forEach((e, i) => near(e.freq, 440 * Math.pow(2, ([60, 63, 67][i % 3] - 69) / 12), 'freq'));
  ok(events.every((e) => e.lpf === 1200 && Math.abs(e.resonance - Math.log10(1 / 0.3) / 3) < 1e-5), 'the cutoff argument drives lpf, rq the resonance');
}

// Ppar of two SynthDefs on a TempoClock, with MoogFF, an ADSR and detuned saws.
{
  const { js, events } = play(String.raw`(
var bass = Pbind(\instrument, \bass, \midinote, Pseq([36, 36, 39, 41], inf), \dur, 0.5, \cutoff, Pseq([400, 800], inf));
var hats = Pbind(\instrument, \hat, \dur, 0.25, \amp, Pseq([0.3, 0.1], inf));
SynthDef(\bass, { |out, freq = 100, amp = 0.3, cutoff = 1000, gate = 1|
  var sig = Saw.ar(freq * [1, 1.01]).sum;
  sig = MoogFF.ar(sig, cutoff, 2.5);
  sig = sig * Env.adsr(0.01, 0.2, 0.6, 0.1).kr(2, gate);
  Out.ar(out, (sig * amp) ! 2);
}).add;
SynthDef(\hat, { |out, amp = 0.2| var sig = HPF.ar(WhiteNoise.ar, 8000) * Env.perc(0.001, 0.05).ar(2); Out.ar(out, Pan2.ar(sig * amp)) }).add;
Ppar([bass, hats]).play(TempoClock(2));
)`, 2);
  ok(js.includes('sound("supersaw")') && js.includes('sound("superhat")'), 'detuned saws are a supersaw; the name hat is superhat');
  const bass = events.filter((e) => e.s === 'supersaw');
  const hat = events.filter((e) => e.s === 'superhat');
  eq(bass.map((e) => [e.time, e.note, e.lpf]), [[0, 36, 400], [0.25, 36, 800], [0.5, 39, 400], [0.75, 41, 800], [1, 36, 400], [1.25, 36, 800], [1.5, 39, 400], [1.75, 41, 800]]);
  eq(hat.length, 16);
  ok(bass.every((e) => e.attack === 0.01 && e.decay === 0.2 && e.sustainlevel === 0.6 && e.release === 0.1), 'Env.adsr');
}

// Euclidean durations, a scale with a root and octave, Ptpar, chains, chords, a synth played once.
{
  const { events } = play('Pbind(\\dur, Pbjorklund2(3, 8) / 4, \\degree, 0).play;', 4);
  eq(events.map((e) => e.time), [0, 0.75, 1.5, 2, 2.75, 3.5]);
}
{
  const { events } = play('Pbind(\\scale, Scale.minor, \\root, 2, \\octave, 4, \\degree, Pseq([0, 1, 2, 3, 4], inf), \\dur, Pseq([0.5, 0.25, 0.25], inf)).play;', 2.5);
  eq(events.map((e) => [e.time, e.note]), [[0, 50], [0.5, 52], [0.75, 53], [1, 55], [1.5, 57], [1.75, 50], [2, 52]]);
}
{
  const { events } = play('Ptpar([0, Pbind(\\note, 0, \\dur, 1), 0.5, Pbind(\\note, 7, \\dur, 1)]).play;', 2);
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [0.5, 67], [1, 60], [1.5, 67]]);
}
{
  const { events } = play('(Pbind(\\dur, 0.5) <> Pbind(\\note, Pseq([0, 2, 4], inf))).play;', 1.5);
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [0.5, 62], [1, 64]]);
}
{
  const { events } = play('(instrument: \\default, degree: [0, 2, 4], dur: 2).play;', 2);
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [0, 64], [0, 67]]);
}
{
  const { js, events } = play('{ SinOsc.ar(440) * 0.1 }.play;', 1);
  ok(js.includes('sound("sine")') && events[0].freq === 440, 'a function played once is a sine at 440 Hz');
}
{
  const { js, events } = play('Pbind(\\type, \\dirt, \\s, Pseq([\\bd, \\sn], inf), \\n, 1, \\dur, 0.5, \\speed, 2).play;', 1);
  ok(js.includes('sound("bd sn")'), 'SuperDirt events keep their sounds');
  eq(events.map((e) => [e.time, e.s, e.n, e.speed]), [[0, 'bd', 1, 2], [0.5, 'sn', 1, 2]]);
}
{
  // A filter envelope (env.exprange) on a SynthDef's RLPF.
  const { js } = play(String.raw`SynthDef(\acid, { |out, freq = 100, amp = 0.3, gate = 1|
  var env = Env.perc(0.01, 0.3).kr;
  var sig = RLPF.ar(Pulse.ar(freq), env.exprange(200, 3200), 0.2);
  Out.ar(out, sig * Env.adsr(0.01, 0.1, 0.7, 0.05).kr(2, gate) ! 2 * amp);
}).add;
Pbind(\instrument, \acid, \midinote, Pseq([36, 48], inf), \dur, 0.25).play;`, 1);
  ok(js.includes('.lpf(200).lpenv(4)') && js.includes('.lpattack(0.01).lpdecay(0.3)'), 'env.exprange becomes lpf with lpenv');
}
{
  const { js, parts } = play('SynthDef(\\a, { Out.ar(0, SinOsc.ar(440) * 0.1) }).add;', 1);
  eq(parts, 0);
  ok(js.includes('Nothing in the file plays'), 'a file that plays nothing says so');
}

// Multichannel expansion and an LFO on the pitch: two channels, each a sine swept from 100 Hz to 2 kHz
// (1 and 3 times a second), at 0.2, until stopped.
{
  const { js, events } = play('{ SinOsc.ar(SinOsc.kr([1, 3]).exprange(100, 2e3), 0, 0.2) }.play', 4);
  ok(js.includes('sound("sine")') && js.includes('layer(['), 'two different channels are two layers of a sine');
  eq(events.length, 2);
  const [left, right] = events.sort((a, b) => a.pan - b.pan);
  eq([left.pan, left.vib, right.pan, right.vib], [-1, 1, 1, 3]);
  for (const e of events) {
    near(e.freq, Math.sqrt(100 * 2000), 'the sweep is centred on the geometric mean');
    near(e.vibmod, 12 * Math.log2(20) / 2, 'and goes half the range in semitones each way');
    near(e.amp, 0.2 * 0.4 / 0.45, 'the level is 0.2, as in SuperCollider');
    eq(e.legato, 1);
    near(e.length, 4, 'a note as long as the cycle');
  }
}

// ---------------------------------------------------------------- buses, effects, JITLib, buffers, MIDI, OSC

const PLUCK = String.raw`SynthDef(\pluck, { |out = 0, freq = 440, amp = 0.2| var sig = Saw.ar(freq) * Env.perc(0.01, 0.4).ar(2); Out.ar(out, Pan2.ar(sig * amp)) }).add;`;
const notesAt = (events) => events.map((e) => [e.time, e.note]);

// An effect synth that reads a bus (In.ar): the parts that play into the bus go through its effects.
{
  const { js, parts, events } = play(String.raw`(
~rev = Bus.audio(s, 2);
${PLUCK}
SynthDef(\verb, { |in, out = 0, mix = 0.4| var sig = In.ar(in, 2); sig = FreeVerb.ar(sig, mix, 0.8, 0.3); sig = LPF.ar(sig, 3000); Out.ar(out, sig) }).add;
Synth(\verb, [\in, ~rev, \mix, 0.6], addAction: \addToTail);
Pbind(\instrument, \pluck, \out, ~rev, \degree, Pseq([0, 2, 4], inf), \dur, 0.5).play;
)`, 3);
  eq(parts, 1);
  ok(js.includes('It goes through \\verb'), 'the comment names the effect');
  eq(notesAt(events), [[0, 60], [0.5, 64], [1, 67], [1.5, 60], [2, 64], [2.5, 67]]);
  ok(events.every((e) => e.lpf === 3000 && e.freeverb === 0.6 && e.freeroom === 0.8 && e.freedamp === 0.3), "the effect's filter and reverb, with the synth's \\mix");
}
// A send: the dry sound goes out, a part of it to the reverb's bus.
{
  const { events } = play(String.raw`(
~fx = Bus.audio(s, 2);
SynthDef(\lead, { |out = 0, send, freq = 440| var sig = Saw.ar(freq) * Env.perc(0.01, 0.3).ar(2) * 0.1; Out.ar(out, sig ! 2); Out.ar(send, sig * 0.5 ! 2) }).add;
SynthDef(\rev, { |in| Out.ar(0, FreeVerb.ar(In.ar(in, 2), 1, 0.9)) }).add;
Synth(\rev, [\in, ~fx]);
Pbind(\instrument, \lead, \send, ~fx, \note, 0, \dur, 1).play;
)`, 2);
  ok(events.length === 2 && events.every((e) => e.freeverb === 0.5 && e.freeroom === 0.9), 'a send scales the reverb mix by its level');
}
// Pfx: the pattern's events go through an effect synth.
{
  const { events } = play(String.raw`SynthDef(\hp, { |out = 0| var sig = In.ar(out, 2); ReplaceOut.ar(out, HPF.ar(sig, 800)) }).add;
Pfx(Pbind(\degree, Pseq([0, 4], inf), \dur, 0.5), \hp).play;`, 1);
  eq(notesAt(events), [[0, 60], [0.5, 67]]);
  ok(events.every((e) => e.hpf === 800), 'Pfx applies its HPF');
}
// JITLib: an Ndef with a filter slot, another Ndef read inside it, ProxySpace.
{
  const { js, events } = play(String.raw`(
Ndef(\lfo, { SinOsc.kr(0.25).range(400, 4000) });
Ndef(\bass, { RLPF.ar(Saw.ar([55, 55.5]), Ndef.kr(\lfo), 0.3) * 0.2 }).play;
Ndef(\bass)[1] = \filter -> { |in| HPF.ar(in, 60) };
)`, 4);
  ok(!/not converted/.test(js), 'Ndef converts');
  eq(events.map((e) => [e.freq, e.pan, e.hpf, e.legato]).sort(), [[55, -1, 60, 1], [55.5, 1, 60, 1]]);
}
{
  const { events } = play(String.raw`p = ProxySpace.push(s);
~a = { SinOsc.ar(330) * 0.1 };
~a.play;
~b = Pbind(\note, Pseq([0, 7], inf), \dur, 0.25);
~b.play;
~c = { Saw.ar(100) * 0.1 }; // defined but never played`, 0.5);
  ok(events.some((e) => e.s === 'sine' && e.freq === 330 && e.legato === 1), 'a ProxySpace function plays as a synth');
  eq(notesAt(events.filter((e) => e.s === 'saw')), [[0, 60], [0.25, 67]]);
  ok(!events.some((e) => e.freq === 100), 'a proxy that is not played stays silent');
}
{
  // An effect proxy fed by another one with <<>.
  const { events } = play(String.raw`Ndef(\src, { Pulse.ar(220) * 0.1 });
Ndef(\fx, { LPF.ar(\in.ar(0 ! 2), 900) }).play;
Ndef(\fx) <<> Ndef(\src);`, 1);
  ok(events.length === 1 && events[0].s === 'square' && events[0].freq === 220 && events[0].lpf === 900, 'the source plays through the effect proxy');
}
// Tdef: the last definition plays.
{
  const { events } = play(String.raw`Tdef(\t, { loop { (note: 0, dur: 0.5).play; 0.5.wait } });
Tdef(\t).play;`, 1);
  eq(notesAt(events), [[0, 60], [0.5, 60]]);
}
// Buffers: Buffer.read files become sample banks; PlayBuf's rate is the speed.
{
  const { code: js } = convertSuperCollider(String.raw`b = Buffer.read(s, "sounds/kick.wav");
c = Buffer.read(s, Platform.resourceDir +/+ "sounds/snare.aiff");
SynthDef(\play, { |out = 0, buf = 0, rate = 1, start = 0, amp = 0.5| var sig = PlayBuf.ar(2, buf, BufRateScale.kr(buf) * rate, startPos: start * BufFrames.kr(buf), doneAction: 2); Out.ar(out, sig * amp) }).add;
Pbind(\instrument, \play, \buf, Pseq([b, c, b, b], inf), \rate, Pseq([1, 1.5], inf), \start, 0.25, \dur, 0.5).play;`, 'test.scd');
  ok(js.includes('kick: ["sounds/kick.wav"]') && js.includes('snare: ["Platform.resourceDir/sounds/snare.aiff"]'), 'the files become sample banks');
  ok(js.includes('sound("kick snare kick kick")') && js.includes('.speed("1 1.5 1 1.5")') && js.includes('.begin(0.25)'), 'buffers, rate and start');
  const realSamples = globalThis.samples;
  globalThis.samples = () => Promise.resolve();
  try {
    const result = t.eval(js);
    ok(result.success, 'the sample code runs: ' + result.error);
    const events = [...t.channels.values()].flatMap((p) => p.query(0, t.cps * 2 - 1e-9)).map((ev) => ev.value);
    eq(events.map((v) => [v.s, v.speed]), [['kick', 1], ['snare', 1.5], ['kick', 1], ['kick', 1.5]]);
    ok(events.every((v) => Math.abs(v.amp - 0.2) < 1e-9 && v.legato === undefined), 'amp 0.5 is 0.2 for samples; one-shots play to the end');
    t.stopAll();
  } finally {
    globalThis.samples = realSamples;
  }
}
// MIDI: Pbind(\type, \midi) and noteOn/noteOff in a routine go to .midi().
{
  const { js, events } = play(String.raw`MIDIClient.init;
m = MIDIOut(1);
Pbind(\type, \midi, \midiout, m, \chan, 2, \degree, Pseq([0, 2, 4], inf), \dur, 0.5, \amp, 0.8).play;
Routine({ loop { m.noteOn(0, 72, 100); 0.25.wait; m.noteOff(0, 72); 0.75.wait } }).play;
m.control(5, 74, 64);`, 2, /MIDI/);
  ok(!/MIDI is not converted/.test(js), 'MIDI converts');
  const pb = events.filter((e) => e.midichan === 2);
  eq(pb.map((e) => [e.time, e.note, e.vel, e.midi]), [[0, 60, 0.8, 1], [0.5, 64, 0.8, 1], [1, 67, 0.8, 1], [1.5, 60, 0.8, 1]]);
  const rt = events.filter((e) => e.note === 72);
  eq(rt.map((e) => [e.time, e.midichan, e.legato]), [[0, 0, 0.25], [1, 0, 0.25]]);
  near(rt[0].vel, 100 / 127, 'noteOn velocity');
  ok(events.some((e) => e.ccn === 74 && e.ccv === 64 && e.midichan === 5), 'a control change');
}
// OSC: /dirt/play messages are SuperDirt events; other messages are sent with .osc().
{
  const { events } = play(String.raw`n = NetAddr("127.0.0.1", 57120);
Routine({ loop { n.sendMsg("/dirt/play", \s, \bd, \n, 1); 0.5.wait; n.sendMsg("/foo", \n, 3); 0.5.wait } }).play;`, 2);
  eq(events.map((e) => [e.time, e.s ?? null, e.n, e.osc ?? null]), [[0, 'bd', 1, null], [0.5, null, 3, '/foo'], [1, 'bd', 1, null], [1.5, null, 3, '/foo']]);
}
// An empty window and groups change nothing.
{
  const { js, events } = play(String.raw`w = Window("x").front;
g = Group.new;
Synth(\default, [\freq, 220], target: g);`, 1);
  ok(!js.includes('controlLayout') && events.length === 1 && events[0].freq === 220, 'an empty window adds no layout, groups are ignored');
}
// Random values in a routine stay random (TidalJS random signals), so the routine still loops.
{
  const { js, events } = play(String.raw`SynthDef(\beep, { |freq = 440, amp = 0.1| Out.ar(0, SinOsc.ar(freq) * Env.perc(0.01, 0.2).ar(2) * amp ! 2) }).add;
Routine({ loop { Synth(\beep, [\freq, rrand(200, 800), \amp, [0.1, 0.2].choose]); 0.25.wait } }).play;`, 4);
  ok(js.includes('irand(601)') && js.includes('choose(['), 'rrand and choose become random signals');
  ok(!/drawn once/.test(js) && !/never repeats/.test(js), 'no fixed draw, no 16-beat loop');
  eq(events.map((e) => e.time), Array.from({ length: 16 }, (_, i) => i * 0.25));
  ok(events.every((e) => Number.isInteger(e.freq) && e.freq >= 200 && e.freq <= 800), 'freq in range, whole numbers');
  ok(new Set(events.map((e) => e.freq)).size > 4, 'freq changes');
}
// An endless Pseries keeps growing; a list shuffled again and again is TidalJS's shuffle; Pconst.
{
  const { js, events } = play(String.raw`Pbind(\note, Pseries(0, 1, inf), \dur, 0.25).play;`, 20);
  ok(!/never repeats/.test(js), 'the series is not cut to 16 beats');
  eq(events.map((e) => e.note), Array.from({ length: 80 }, (_, i) => 60 + i));
}
{
  const { js, events } = play(String.raw`Pbind(\note, Pn(Pshuf([0, 3, 7, 10], 1), inf), \dur, 0.25).play;`, 8);
  ok(js.includes('.shuffle(4)'), 'Pn(Pshuf) becomes shuffle');
  for (let i = 0; i < events.length; i += 4) eq(events.slice(i, i + 4).map((e) => e.note).sort((a, b) => a - b), [60, 63, 67, 70]);
}
{
  const { events } = play(String.raw`Pbind(\note, 0, \dur, Pconst(4, Pseq([1.5], inf))).play;`, 4);
  eq(events.map((e) => [e.time, Math.round(e.length * 1e6) / 1e6]), [[0, 1.5], [1.5, 1.5], [3, 1]]);
}
// FM: a sine whose frequency a sine moves is superfm, with its ratio and index.
{
  const { events } = play(String.raw`SynthDef(\fm, { |freq = 220, amp = 0.2| var mod = SinOsc.ar(freq * 2) * freq * 2 * 3; var sig = SinOsc.ar(freq + mod) * Env.perc(0.01, 1).ar(2); Out.ar(0, sig * amp ! 2) }).add;
Pbind(\instrument, \fm, \degree, Pseq([0, 4], inf), \dur, 0.5).play;`, 1);
  ok(events.every((e) => e.s === 'superfm' && e.semitone === 12 && e.voice === 0.375), 'ratio 2 is 12 semitones, index 3 is voice 3/8');
}
{
  // SinOscFB is superfb: its feedback (0 to 1.5) is the voice (0 to 1).
  const { events } = play(String.raw`SynthDef(\fb, { |freq = 110, amp = 0.2| Out.ar(0, SinOscFB.ar(freq, 0.9) * Env.perc(0.01, 0.5).ar(2) * amp ! 2) }).add;
Pbind(\instrument, \fb, \dur, 0.5).play;`, 1);
  ok(events.length === 2 && events.every((e) => e.s === 'superfb' && Math.abs(e.voice - 0.6) < 1e-9), 'SinOscFB becomes superfb');
}
// Synths started in a routine end where the routine releases them, and synth.set starts a new note.
{
  const { events } = play(String.raw`Routine({ loop { x = Synth(\default, [\freq, 300]); 0.5.wait; x.release; 0.5.wait } }).play;`, 2);
  eq(events.map((e) => [e.time, e.freq, e.legato]), [[0, 300, 0.5], [1, 300, 0.5]]);
}
{
  const { events } = play(String.raw`Routine({ x = Synth(\default, [\freq, 200]); 1.wait; x.set(\freq, 400); 1.wait; x.set(\gate, 0); 2.wait }).play;`, 4);
  eq(events.map((e) => [e.time, e.freq, Math.round(e.legato * 1e6) / 1e6]), [[0, 200, 1], [1, 400, 1 / 3]].map(([a, b, c]) => [a, b, Math.round(c * 1e6) / 1e6]));
}
// A control bus an LFO writes, mapped to an argument: a TidalJS signal at the LFO's rate.
{
  const { js, events } = play(String.raw`~c = Bus.control(s, 1);
{ Out.kr(~c, SinOsc.kr(0.5).range(200, 2000)) }.play;
SynthDef(\sq, { |freq = 110, cutoff = 1000, amp = 0.2| Out.ar(0, RLPF.ar(Pulse.ar(freq), cutoff, 0.3) * Env.perc(0.01, 0.3).ar(2) * amp ! 2) }).add;
Pbind(\instrument, \sq, \cutoff, ~c.asMap, \dur, 0.25).play;`, 2);
  ok(js.includes('sine.range(200, 2000)'), 'the LFO becomes a sine signal');
  // SinOsc starts at its middle going up: 1100 Hz at 0 s, 2000 at 0.5 s, 1100 at 1 s, 200 at 1.5 s.
  for (const [time, hz] of [[0, 1100], [0.5, 2000], [1, 1100], [1.5, 200]]) near(events.find((e) => Math.abs(e.time - time) < 1e-9).lpf, hz, 'lpf at ' + time);
}
{
  // bus.set: a fixed value.
  const { events } = play(String.raw`~c = Bus.control(s, 1); ~c.set(700);
SynthDef(\sq, { |freq = 110, cutoff = 1000| Out.ar(0, RLPF.ar(Pulse.ar(freq), cutoff, 0.3) * Env.perc(0.01, 0.3).ar(2) * 0.1 ! 2) }).add;
Pbind(\instrument, \sq, \cutoff, ~c.asMap, \dur, 1).play;`, 1);
  eq(events[0].lpf, 700);
}

// ---------------------------------------------------------------- live inputs, ties, changes during a note

const PAD = String.raw`SynthDef(\pad, { |freq = 220, cutoff = 1000, amp = 0.1| Out.ar(0, RLPF.ar(Saw.ar(freq), cutoff, 0.3) * amp ! 2) }).add;
x = Synth(\pad);`;
// GUI sliders become TidalJS sliders: the synth's controls read them.
{
  const { js, events } = play(String.raw`${PAD}
w = Window("pad").front;
EZSlider(w, Rect(0, 0, 300, 20), "cutoff", [200, 5000].asSpec, { |ez| x.set(\cutoff, ez.value) }, 1000);
Button(w, Rect(0, 30, 80, 20)).action_({ |b| x.set(\amp, b.value * 0.1) });`, 1);
  ok(js.includes('.follow("lpf", slider("cutoff", 1000, 200, 5000))') && js.includes('toggle("button2")'), 'EZSlider and Button become slider and toggle, followed during the note');
  eq(events[0].lpf, 1000);
  eq(events[0].amp, 0);
}
// MIDI input: a controller drives a synth argument; a note function becomes midikeys.
{
  const { js, events } = play(String.raw`${PAD}
MIDIIn.connectAll;
MIDIdef.cc(\cut, { |val| x.set(\cutoff, val.linexp(0, 127, 200, 5000)) }, 74);`, 1, /MIDI/);
  ok(js.includes('.follow("lpf", midicc(74).range(0, 127)'), 'the controller becomes midicc');
  near(events[0].lpf, 200, 'midicc starts at 0');
}
{
  const { js } = play(String.raw`SynthDef(\pluck, { |freq = 440, amp = 0.2, gate = 1| Out.ar(0, Saw.ar(freq) * Env.adsr(0.01, 0.2, 0.5, 0.3).kr(2, gate) * amp ! 2) }).add;
~notes = Array.newClear(128);
MIDIdef.noteOn(\on, { |vel, num| ~notes[num] = Synth(\pluck, [\freq, num.midicps, \amp, vel / 127 * 0.3]) });
MIDIdef.noteOff(\off, { |vel, num| ~notes[num].release });`, 1, /MIDI/);
  ok(js.includes('midikeys(sound("saw").amp(0.565685).attack(0.01).decay(0.2).sustainlevel(0.5).release(0.3))'), 'the note function becomes midikeys, amp at full velocity');
  ok(!/left out/.test(js), 'nothing is left out');
}
// OSC input: the values a function reads become oscIn.
{
  const { js, events } = play(String.raw`${PAD}
OSCdef(\f, { |msg| x.set(\freq, msg[1]) }, '/freq');`, 1);
  ok(js.includes('.follow("freq", oscIn("/freq"))'), 'msg[1] becomes oscIn');
  eq(events.length, 1);
}
// Pmono and a synth that changes while it plays: tied notes, one voice.
{
  const { js, events } = play(String.raw`Pmono(\default, \degree, Pseq([0, 2, 4], inf), \dur, 0.5).play;`, 1.5);
  ok(js.includes('.tie(1)') && !/note per event/.test(js), 'Pmono ties its notes');
  eq(events.map((e) => [e.time, e.note, e.tie]), [[0, 60, 1], [0.5, 64, 1], [1, 67, 1]]);
}
{
  const { js, events } = play(String.raw`Routine({ x = Synth(\default, [\freq, 200]); 1.wait; x.set(\freq, 400); 1.wait; x.set(\gate, 0); 2.wait }).play;`, 4);
  ok(js.includes('.tie('), 'synth.set ties the new note to the running one');
  eq(events.map((e) => [e.time, e.freq, e.tie]), [[0, 200, 1], [1, 400, 1]]);
}
// Changes during a note: an LFO inside a synth (followNote) and a control bus an LFO writes (follow).
{
  const { js, events } = play(String.raw`SynthDef(\wob, { |freq = 55, amp = 0.2| var sig = RLPF.ar(Saw.ar(freq), SinOsc.kr(2).range(300, 3000), 0.2) * Env.perc(0.01, 1).ar(2); Out.ar(0, sig * amp ! 2) }).add;
Pbind(\instrument, \wob, \dur, 1).play;`, 2);
  ok(js.includes('.followNote("lpf", sine.range(300, 3000).fast(2 / getcps()))'), 'an LFO on the filter is followed during each note');
  ok(!/cannot follow/.test(js), 'no start value only');
  eq(events.length, 2);
}
{
  const { js } = play(String.raw`~c = Bus.control(s, 1);
{ Out.kr(~c, SinOsc.kr(0.5).range(200, 2000)) }.play;
SynthDef(\sq, { |freq = 110, cutoff = 1000, amp = 0.2| Out.ar(0, RLPF.ar(Pulse.ar(freq), cutoff, 0.3) * Env.perc(0.01, 0.3).ar(2) * amp ! 2) }).add;
Pbind(\instrument, \sq, \cutoff, ~c.asMap, \dur, 0.25).play;`, 1);
  ok(js.includes('.follow("lpf", sine.range(200, 2000).fast(0.5 / getcps()))'), 'a mapped control bus is followed during each note');
}
// Random durations: rhythm() plays the events one after another, each with a new random duration.
{
  const { js, events } = play(String.raw`Pbind(\note, Pseq([0, 3, 7], inf), \dur, Pwhite(0.1, 0.5)).play;`, 16);
  ok(js.includes('.rhythm(rand.range(0.025, 0.125))') && js.includes('.slow(3)') && !/beats loop|randcat/.test(js), 'random durations become rhythm()');
  ok(events.length > 30, 'it plays');
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].time - events[i - 1].time;
    ok(gap > 0.1 - 1e-6 && gap < 0.5 + 1e-6, 'each gap is a random duration between 0.1 and 0.5 beats');
    eq(events[i].note, [60, 63, 67][i % 3], 'the notes keep their order');
  }
  ok(new Set(events.map((e, i) => i && Math.round((e.time - events[i - 1].time) * 1e6))).size > 10, 'the durations vary');
}
{
  const { js, events } = play(String.raw`Pbind(\degree, Prand([0, 2, 4], inf), \dur, Prand([0.25, 0.5], inf), \legato, 0.5).play;`, 8);
  ok(js.includes('.rhythm(choose([0.0625, 0.125]))') && js.includes('.legato(0.5)'), 'a random choice of durations, in cycles');
  ok(events.every((e) => [60, 64, 67].includes(e.note)), 'random notes (degrees 0, 2 and 4)');
  ok(events.every((e, i) => i === 0 || [0.25, 0.5].some((d) => Math.abs(e.time - events[i - 1].time - d) < 1e-6)), 'each duration is one of the choices');
}
{
  const { js, events } = play(String.raw`Routine({ loop { Synth(\default, [\freq, [200, 300].choose]); rrand(0.1, 0.4).wait } }).play;`, 8);
  ok(js.includes('.rhythm(rand.range(0.025, 0.1))'), 'a random wait in a routine becomes rhythm()');
  ok(events.every((e, i) => i === 0 || (e.time - events[i - 1].time > 0.1 - 1e-6 && e.time - events[i - 1].time < 0.4 + 1e-6)), 'waits between 0.1 and 0.4 beats');
}
// Random durations with rests between notes: a rest is a silent step of rhythm(), with its own random duration.
{
  const { js, events } = play(String.raw`Pbind(\note, Pseq([0, \rest, 7], inf), \dur, Pwhite(0.1, 0.5)).play;`, 16);
  ok(js.includes('.struct("x ~ x")') && js.includes('.slow(3)') && js.includes('.rhythm(rand.range(0.025, 0.125))') && !js.includes('randcat'), 'with rests, rhythm() too');
  ok(events.length > 20, 'it plays');
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].time - events[i - 1].time;
    eq(events[i].note, [60, 67][i % 2], 'the notes keep their order');
    // From 0 to 7 a rest comes between: two random durations.
    if (events[i].note === 67) ok(gap > 0.2 - 1e-6 && gap < 1 + 1e-6, 'a note, a rest, then the next note: two durations');
    else ok(gap > 0.1 - 1e-6 && gap < 0.5 + 1e-6, 'one duration');
  }
  ok(new Set(events.filter((e) => e.note === 67).map((e, i, a) => i && Math.round((e.time - a[i - 1].time) * 1e6))).size > 4, 'the rests vary too');
}
{
  // At 2 beats per second, rests from a random choice of durations.
  const { js, events } = play(String.raw`TempoClock.default.tempo = 2; Pbind(\note, Pseq([0, \rest, 7, 5], inf), \dur, Prand([0.25, 0.5], inf), \legato, 0.5).play;`, 8);
  ok(js.includes('.rhythm(choose([0.0625, 0.125]))') && js.includes('.legato(0.5)'), 'a random choice, in cycles, with rests');
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].time - events[i - 1].time;
    const choices = events[i].note === 67 ? [0.25, 0.375, 0.5] : [0.125, 0.25];
    ok(choices.some((d) => Math.abs(gap - d) < 1e-6), 'each gap is the durations it spans, in seconds: ' + gap);
  }
}
// Random and fixed durations in a loop: rhythm() reads one length per step from cat().
{
  const { js, events } = play(String.raw`Pbind(\note, Pseq([0, 3, 7, 10], inf), \dur, Pseq([0.25, Pwhite(0.1, 0.5, 1), 0.5], inf)).play;`, 16);
  ok(js.includes('.rhythm(cat("0.0625", rand.range(0.025, 0.125).segment(1), "0.125"))') && !js.includes('randcat'), 'a loop of step lengths');
  ok(events.length > 30, 'it plays');
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].time - events[i - 1].time;
    eq(events[i].note, [60, 63, 67, 70][i % 4], 'the notes keep their order');
    const step = (i - 1) % 3;
    if (step === 1) ok(gap > 0.1 - 1e-6 && gap < 0.5 + 1e-6, 'the random step');
    else near(gap, step === 0 ? 0.25 : 0.5, 'the fixed steps');
  }
}
{
  // A stretch that changes: each step's random duration is scaled by its own stretch.
  const { js, events } = play(String.raw`Pbind(\note, Pseq([0, 3, 7], inf), \dur, Pwhite(0.1, 0.5), \stretch, Pseq([1, 2], inf)).play;`, 16);
  ok(js.includes('.rhythm(cat(rand.range(0.025, 0.125).segment(1), rand.range(0.05, 0.25).segment(1)))'), 'stretched random durations');
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].time - events[i - 1].time;
    const k = (i - 1) % 2 ? 2 : 1;
    ok(gap > 0.1 * k - 1e-6 && gap < 0.5 * k + 1e-6, 'a duration times its stretch');
  }
}
{
  // A routine with a random wait and a fixed one.
  const { js, events } = play(String.raw`Routine({ loop { Synth(\default, [\freq, 200]); rrand(0.1, 0.4).wait; Synth(\default, [\freq, 300]); 0.5.wait } }).play;`, 16);
  ok(js.includes('.rhythm(cat(rand.range(0.025, 0.1).segment(1), "0.125"))'), 'a random wait and a fixed one');
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].time - events[i - 1].time;
    eq(events[i].freq, [200, 300][i % 2], 'the synths keep their order');
    if (events[i].freq === 300) ok(gap > 0.1 - 1e-6 && gap < 0.4 + 1e-6, 'the random wait');
    else near(gap, 0.5, 'the fixed wait');
  }
}
{
  // Two waits after one synth add up to a length no single random duration gives: random stretches.
  const { js } = play(String.raw`Routine({ loop { Synth(\default, [\freq, 200]); 0.25.wait; rrand(0.1, 0.4).wait } }).play;`, 4);
  ok(js.includes('randcat(') && !js.includes('.rhythm('), 'a fixed and a random wait in a row: random stretches');
}

// GUI windows become groups of the Controls panel, laid out as in SuperCollider; labels come from StaticText.
{
  const { js, events } = play(String.raw`${PAD}
(
w = Window("Pad", Rect(100, 100, 300, 200));
c = Slider(); r = Knob(); m = Button().states_([["Mute"], ["Play"]]);
c.action_({ |s| x.set(\cutoff, s.value.linexp(0, 1, 200, 8000)) });
r.action_({ |s| x.set(\amp, s.value * 0.2) });
m.action_({ |b| x.set(\freq, b.value * 110 + 110) });
w.layout_(VLayout(HLayout(StaticText().string_("Cutoff"), c, StaticText().string_("Level:"), r), m));
w.front;
)`, 1);
  ok(js.includes('controlLayout("Pad", [["Cutoff", "Level"], ["Mute"]])'), 'the window becomes a controlLayout with its rows');
  ok(js.includes('slider("Cutoff", 0, 0, 1)') && js.includes('slider("Level", 0, 0, 1)') && js.includes('toggle("Mute")'), 'controls named after their labels and states');
  eq(events.length, 1);
}
{
  const { js } = play(String.raw`${PAD}
w = Window("Placed");
a = Slider(w, Rect(80, 10, 200, 20)); b = Slider(w, Rect(80, 40, 200, 20)); d = NumberBox(w, Rect(290, 40, 50, 20));
StaticText(w, Rect(10, 10, 60, 20)).string_("Cutoff");
StaticText(w, Rect(10, 40, 60, 20)).string_("Level");
a.action_({ |s| x.set(\cutoff, s.value * 4000 + 200) });
b.action_({ |s| x.set(\amp, s.value * 0.3) });
d.action_({ |n| x.set(\freq, n.value) });`, 1);
  ok(js.includes('controlLayout("Placed", [["Cutoff"], ["Level", "number3"]])'), 'controls placed by bounds make rows, labelled from the left');
  ok(js.includes('.follow("lpf", slider("Cutoff", 0, 0, 1).withValue((x) => 4000 * x + 200))'), 'straight-line maps written as one');
}
{
  const { js } = play(String.raw`${PAD}
p = PopUpMenu().items_(["low", "mid", "high"]).action_({ |m| x.set(\freq, m.value * 110 + 110) });
q = Slider2D().action_({ |v| x.set(\cutoff, v.x * 3000 + 200, \amp, v.y * 0.2) });
Window("XY").layout_(HLayout(p, q)).front;`, 1);
  ok(js.includes('slider("menu1", 0, 0, 2, 1)'), 'a menu becomes a slider over its items');
  ok(js.includes('slider("xy2 x", 0, 0, 1)') && js.includes('slider("xy2 y", 0, 0, 1)'), 'Slider2D becomes two sliders');
  ok(js.includes('controlLayout("XY", [["menu1", "xy2 x", "xy2 y"]])'), 'side by side');
}
// A GUI value read in a pattern: the slider, live.
{
  const { js, events } = play(String.raw`~level = EZSlider(nil, nil, "level", [0, 0.5].asSpec, nil, 0.2);
Pbind(\degree, 0, \amp, Pfunc { ~level.value }, \dur, 1).play;`, 1);
  ok(js.includes('slider("level", 0.2, 0, 0.5)'), 'Pfunc reads the slider');
  near(events[0].amp, 0.2 * 1.2, 'its starting value');
}

// MIDI pitch bend and aftertouch.
{
  const { js } = play(String.raw`SynthDef(\pad, { |freq = 440, amp = 0.2, gate = 1, bend = 0| Out.ar(0, Saw.ar(freq * bend.midiratio) * EnvGen.kr(Env.adsr, gate, doneAction: 2) * amp ! 2) }).add;
~notes = Array.newClear(128);
MIDIdef.noteOn(\on, { |vel, num| ~notes[num] = Synth(\pad, [\freq, num.midicps, \amp, vel / 127 * 0.3]) });
MIDIdef.noteOff(\off, { |vel, num| ~notes[num].release; ~notes[num] = nil });
MIDIdef.bend(\bend, { |val| ~notes.do { |s| s !? { s.set(\bend, val.linlin(0, 16383, -2, 2)) } } });`, 1, /MIDI/);
  ok(/midikeys\(sound\("supersaw"\)[^\n]*, null, 2\)/.test(js), 'pitch bend bends the held keys by 2 semitones: ' + js);
  ok(js.includes('pitch-bend wheel bends the held notes up to 2 semitones'), 'and says so');
  ok(!/bend input is left out/.test(js), 'nothing left out');
}
{
  const { js, events } = play(String.raw`${PAD}
MIDIdef.bend(\b, { |val| x.set(\freq, val.linlin(0, 16383, 110, 330)) });
MIDIdef.touch(\t, { |val| x.set(\cutoff, val * 20 + 500) }, 1);`, 1, /MIDI/);
  ok(js.includes('.follow("freq", midibend().withValue((x) => 110 * x + 220))'), 'pitch bend on a synth becomes midibend');
  ok(js.includes('.follow("lpf", miditouch(1).range(500, 3040))'), 'aftertouch becomes miditouch');
  near(events[0].freq, 220, 'the wheel starts in the middle');
}
// Aftertouch on the held notes: each key's own pressure (keytouch), channel pressure for all of them (miditouch).
{
  const { js } = play(String.raw`SynthDef(\pad, { |freq = 440, amp = 0.2, cutoff = 2000, gate = 1| Out.ar(0, RLPF.ar(Saw.ar(freq), cutoff, 0.3) * EnvGen.kr(Env.adsr, gate, doneAction: 2) * amp ! 2) }).add;
~notes = Array.newClear(128);
MIDIdef.noteOn(\on, { |vel, num| ~notes[num] = Synth(\pad, [\freq, num.midicps, \amp, vel / 127 * 0.3]) });
MIDIdef.noteOff(\off, { |vel, num| ~notes[num].release; ~notes[num] = nil });
MIDIdef.polytouch(\pt, { |val, num| ~notes[num] !? { ~notes[num].set(\cutoff, val.linlin(0, 127, 500, 6000)) } });
MIDIdef.touch(\t, { |val| ~notes.do { |s| s !? { s.set(\amp, val / 127 * 0.3) } } });`, 1, /MIDI/);
  ok(js.includes('.follow("lpf", keytouch().range(500, 6000))'), 'per-key aftertouch becomes keytouch in the midikeys template: ' + js);
  ok(js.includes('.follow("amp", miditouch().range(0, 0.565685))'), 'channel pressure on the held notes becomes miditouch');
  ok(!/last key pressed/.test(js), 'no approximation note');
}
{
  const { js } = play(String.raw`${PAD}
MIDIdef.polytouch(\pt, { |val| x.set(\cutoff, val * 40 + 200) });`, 1, /MIDI/);
  ok(js.includes('.follow("lpf", miditouch().range(200, 5280))') && /last key pressed/.test(js), 'aftertouch on a synth that is not a key: the last key');
}
// OSC messages that start synths: oscplay, with the message's values.
{
  const { js } = play(String.raw`SynthDef(\ping, { |freq = 440, amp = 0.2, pan = 0| Out.ar(0, Pan2.ar(SinOsc.ar(freq) * Env.perc(0.01, 0.4).ar(2) * amp, pan)) }).add;
OSCdef(\hit, { |msg| Synth(\ping, [\freq, msg[1], \amp, msg[2] * 0.5, \pan, msg[3]]) }, '/hit');`, 1);
  ok(js.includes('oscplay("/hit", sound("sine").freq(oscIn("/hit")).amp(oscIn("/hit", 1).withValue((x) => 0.444444 * x)).pan(oscIn("/hit", 2))'), 'oscplay: ' + js);
  ok(!/left out/.test(js), 'nothing left out');
}

// Changes during a note that are not LFOs: envelopes, Line and XLine, the mouse, random values per note.
{
  const { js, events } = play(String.raw`SynthDef(\sweep, { |freq = 220, amp = 0.2|
  var sig = RLPF.ar(Saw.ar(freq * Rand(0.99, 1.01)), MouseX.kr(200, 5000), Line.kr(0.9, 0.1, 1));
  Out.ar(0, Pan2.ar(sig * Env.perc(0.01, 1).ar(2) * amp, EnvGen.kr(Env([-1, 1, 0], [0.5, 0.5]))))
}).add;
Pbind(\instrument, \sweep, \dur, 1, \degree, Pseq([0, 2], inf)).play;`, 2);
  ok(js.includes('.followNote("pan", envelope([-1, 1, 0], [0.5, 0.5]))'), 'an envelope on the pan is followed during each note');
  ok(js.includes('.follow("lpf", slider("mouse x", 200, 200, 5000))'), 'the mouse becomes a slider');
  ok(js.includes('.followNote("resonance", envelope(['), 'a Line on the resonance is followed');
  ok(js.includes('.add(note(rand.range(-0.173995, 0.172264)))'), 'a random detune per note');
  ok(!/cannot follow/.test(js), 'nothing is fixed at its start value');
  eq(events.length, 2);
}
{
  const { js } = play(String.raw`~cut = Bus.control(s, 1);
SynthDef(\sweeper, { |out| Out.kr(out, EnvGen.kr(Env([300, 6000, 800], [8, 4], \exp))) }).add;
SynthDef(\pluck, { |freq = 220, amp = 0.2, cutoff = 1000| Out.ar(0, LPF.ar(Saw.ar(freq), cutoff) * Env.perc(0.01, 0.3).ar(2) * amp ! 2) }).add;
Routine({ 2.wait; Synth(\sweeper, [\out, ~cut]) }).play;
Pbind(\instrument, \pluck, \dur, 0.25, \cutoff, ~cut.asMap).play;`, 1);
  ok(js.includes('.follow("lpf", envelope([300, 300, 6000, 800], [2, 8, 4], ["lin", "exp", "exp"]))'), 'an envelope writing a control bus, from when it starts: ' + js);
}
// An LFO moved by another LFO: its speed integrated (a smooth speed-up), its range bounds moving.
{
  const { js, events } = play(String.raw`SynthDef(\wob, { |freq = 55, amp = 0.2|
  var sig = RLPF.ar(Saw.ar(freq), SinOsc.kr(SinOsc.kr(0.25).range(1, 8)).range(300, LFTri.kr(0.1).range(1000, 4000)), 0.2);
  Out.ar(0, sig * Env.perc(0.01, 4).ar(2) * amp ! 2)
}).add;
Pbind(\instrument, \wob, \dur, 4).play;`, 8);
  ok(js.includes('.followNote("lpf", sig((t) => { const s = t / getcps();') && !/cannot follow/.test(js), 'followed during the note: ' + js);
  near(events[0].lpf, 650, 'at the onset: half way between 300 and the moving top (1000)');
  // The same function, read on its own: the speed goes from 1 to 8 Hz, so the phase is the integral of the speed.
  const fn = new Function('getcps', 'sig', 'return ' + js.match(/followNote\("lpf", (sig\(.*\}\))\)/)[1])(() => 1, (f) => f);
  const top = (s) => 1000 + 3000 * (1 - Math.abs(2 * ((0.1 * s) % 1) - 1));
  // The integral of 1 + 7 * (sin(2π 0.25 s) + 1) / 2 from 0 to s.
  const phase = (s) => s + 7 * (s / 2 + (1 - Math.cos(2 * Math.PI * 0.25 * s)) / (4 * Math.PI * 0.25));
  for (const s of [0.3, 1.7, 3.9]) near(fn(s), 300 + (top(s) - 300) * (Math.sin(2 * Math.PI * phase(s)) + 1) / 2, 'value at ' + s + ' s');
}
{
  const { js, events } = play(String.raw`SynthDef(\vib, { |freq = 220, amp = 0.2| Out.ar(0, SinOsc.ar(freq * SinOsc.kr(LFTri.kr(0.5).range(3, 7)).range(0.98, 1.02)) * Env.perc(0.01, 2).ar(2) * amp ! 2) }).add;
Pbind(\instrument, \vib, \dur, 2).play;`, 2);
  ok(js.includes('.followNote("vib", tri.range(3, 7).fast(0.5 / getcps()))'), 'a vibrato whose speed an LFO moves');
  eq(events[0].vib, 3);
}
{
  const { js, events } = play(String.raw`~c = Bus.control(s, 1);
{ Out.kr(~c, LFSaw.kr(LFPulse.kr(0.5).range(0.5, 2)).range(200, 2000)) }.play;
SynthDef(\sq, { |freq = 110, cutoff = 1000, amp = 0.2| Out.ar(0, RLPF.ar(Pulse.ar(freq), cutoff, 0.3) * Env.perc(0.01, 0.3).ar(2) * amp ! 2) }).add;
Pbind(\instrument, \sq, \cutoff, ~c.asMap, \dur, 0.5).play;`, 2);
  ok(js.includes('.follow("lpf", sig((t) => {'), 'a control bus whose LFO another LFO speeds up');
  near(events[0].lpf, 200, 'the saw starts at the bottom');
}
// A synth with a gated envelope that nothing releases plays until it is stopped.
{
  const { js } = play(String.raw`SynthDef(\held, { |freq = 220, amp = 0.1, gate = 1| Out.ar(0, Saw.ar(freq) * EnvGen.kr(Env.asr(0.1, 1, 0.5), gate, doneAction: 2) * amp ! 2) }).add;
Synth(\held);`, 1);
  ok(js.includes('.legato(1)'), 'it holds for the whole loop');
}

// ---------------------------------------------------------------- bounded conversions

/** Converts, and returns the code with the time it took (in milliseconds). */
function timed(code, options) {
  const t0 = Date.now();
  const result = convertSuperCollider(code, 'test.scd', options);
  return { ...result, ms: Date.now() - t0 };
}

// Empty patterns repeated forever hang SuperCollider: the conversion ends with a note instead of hanging.
for (const code of [
  'Pn(Pseq([], inf), inf).play;',
  'Pbind(\\degree, Pn(Pseq([], inf), inf), \\dur, 0.5).play;',
  'Pbind(\\degree, Pseq([Pseq([], 1)], inf)).play;',
  'Pseq([Pseq([], 1)], inf).play;',
  'Ppar([], inf).play;',
]) {
  const { code: js, parts, ms } = timed(code);
  eq(parts, 0, code);
  ok(/would hang/.test(js), 'the note says why nothing plays: ' + code);
  ok(ms < 5000, code + ' took ' + ms + ' ms');
}
// A routine whose loop never waits: noted, and the rest of the file still converts.
{
  const { js, events } = play('Routine({ loop { } }).play;\nPbind(\\degree, 1, \\dur, 1).play;', 3);
  ok(/routine loops without waiting/.test(js), 'the routine that never waits is noted');
  eq(events.map((e) => [e.time, e.note]), [[0, 62], [1, 62], [2, 62]]);
}
{
  // It played a synth before it got stuck: that one is kept (and plays once: the piece then stops).
  const { js, events } = play('Routine({ Synth(\\default, [\\freq, 300]); 1.wait; loop { Synth(\\default, [\\freq, 600]) } }).play;', 3);
  ok(/stops at beat 1/.test(js), 'where it got stuck');
  ok(events.length > 0 && events.every((e) => e.freq === 300), 'only the synth before the endless loop plays');
}
// Events that take no time, forever: SuperCollider hangs; nothing is written.
eq(timed('Pbind(\\dur, 0).play;').parts, 0);
// A statement that never ends at the top level is noted and skipped; the next one runs.
{
  const { js, events } = play('inf.do { |i| i };\nPbind(\\degree, 2, \\dur, 1).play;', 2);
  ok(/Line 1 never finishes/.test(js), 'the endless statement is noted');
  eq(events.map((e) => e.note), [64, 64]);
}
// An array too large to make: the statement is noted, the rest converts.
{
  const { code: js, parts } = timed('a = 0 ! 1e9;\nb = Array.fill(inf, 1);\nPbind(\\degree, 0).play;');
  eq(parts, 1);
  ok(/an array of 1000000000 items/.test(js) && /infinitely many/.test(js), 'the arrays that are too large are noted');
}
// Code nested too deeply is a syntax error, not a stack overflow.
assert.throws(() => convertSuperCollider('x = ' + '['.repeat(3000) + '1' + ']'.repeat(3000) + ';'), /syntax error.*nested more than/i);
passed++;
// The whole conversion has a budget: past it (or past its time limit) it stops with a clear error.
assert.throws(() => convertSuperCollider('Pbind(\\degree, Pseq((0..100), inf)).play;', 'x.scd', { maxSteps: 2000 }), /import was stopped.*more work/);
passed++;
assert.throws(() => convertSuperCollider('Pbind(\\degree, Pseq((0..100), inf)).play;', 'x.scd', { timeLimitMs: -1 }), /import was stopped.*took longer/);
passed++;
// Dense regular material (an event every 0.05 beats: 6000 events reach only 300 beats) still finds its loop, quickly.
{
  const t0 = Date.now();
  const { js, events } = play('Pbind(\\dur, 0.05, \\degree, Pseq([0, 1, 2, 3], inf)).play;', 2);
  ok(Date.now() - t0 < 5000, 'dense material converts in ' + (Date.now() - t0) + ' ms');
  ok(!/never repeats/.test(js) && js.includes('"c4 d4 e4 f4"'), 'its loop of four notes is found');
  eq(events.length, 40);
  events.forEach((e, i) => { near(e.time, i * 0.05, 'time'); eq(e.note, [60, 62, 64, 65][i % 4]); });
}
// Aperiodic material (each duration 0.001 beats longer than the last) ends with its first 16 beats looping.
{
  const t0 = Date.now();
  const { js, events } = play('Pbind(\\dur, Pseries(0.05, 0.001, inf)).play;', 16);
  ok(Date.now() - t0 < 5000, 'aperiodic material converts in ' + (Date.now() - t0) + ' ms');
  ok(/rhythm of line 1 never repeats: its first 16 beats loop/.test(js), 'the note says the rhythm never repeats');
  // SuperCollider: event k at the sum of the durations before it (written to the nearest 1/96 beat).
  const ref = [];
  for (let k = 0, time = 0; time < 16 - 1e-9; time += 0.05 + 0.001 * k, k++) ref.push(time);
  eq(events.length, ref.length);
  events.forEach((e, i) => near(e.time, ref[i], 'time', 1 / 96));
}
// Dense aperiodic material: the period search stops at the 6000 events played (449.95 beats here), and says so.
{
  const { code: js, ms } = timed('Pbind(\\dur, (Pseries(0, 1, inf).sqrt.floor % 2 + 1) * 0.05).play;');
  ok(ms < 8000, 'dense aperiodic rhythm converts in ' + ms + ' ms');
  ok(/does not repeat within its first 6000 events \(449\.95 beats\): its first 16 beats loop/.test(js), 'the note gives how far it was played');
  ok(!/legato of line 1 never repeats/.test(js), 'a value that never changes is not reported as never repeating');
  const notes = timed('Pbind(\\dur, 0.05, \\degree, Pseries(0, 1, inf).sqrt.floor).play;');
  ok(notes.ms < 8000 && /note of line 1 never repeats/.test(notes.code), 'a dense value that never repeats');
}
// The editor's converter: in a worker in the browser; here (no Worker) the same conversion, with the same API.
{
  const code = 'Pbind(\\degree, Pseq([0, 2], inf), \\dur, 0.5).play;';
  const r = await convertSuperColliderAsync(code, 'tune.scd', { timeoutMs: 10000 });
  eq(r, convertSuperCollider(code, 'tune.scd'));
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(convertSuperColliderAsync(code, 'tune.scd', { signal: aborted.signal }), (err) => err.name === 'AbortError' && /cancelled/.test(err.message));
  passed++;
  await assert.rejects(convertSuperColliderAsync('Pbind(\\dur, 1', 'x.scd'), /syntax error/i);
  passed++;
  const imported = await parseImportAsync(code, 'my-tune.scd');
  eq([imported.kind, imported.from, imported.title, imported.parts], ['code', 'supercollider', 'my tune', 1]);
  eq((await parseImportAsync('sound("bd")', 'beat.js')).kind, 'code');
}

// ---------------------------------------------------------------- when parts start and stop

// An intro that plays once beside a part that plays on: the intro is not repeated.
{
  const { js, events } = play('Ppar([Pbind(\\degree, Pseq([0, 1, 2, 3], 1), \\dur, 1), Pbind(\\degree, 7, \\dur, 0.5)]).play;', 12);
  ok(js.includes('It plays once, from beat 0 to beat 4') && js.includes('.playFor(0, 1)'), 'the intro plays once');
  eq(events.filter((e) => e.note !== 72).map((e) => [e.time, e.note]), [[0, 60], [1, 62], [2, 64], [3, 65]]);
  eq(events.filter((e) => e.note === 72).map((e) => e.time), Array.from({ length: 24 }, (_, i) => i * 0.5));
}
// A part that starts four beats later starts there, not at the beginning.
{
  const { js, events } = play('Ptpar([0, Pbind(\\degree, 0, \\dur, 1), 4, Pbind(\\degree, Pseq([4, 5], inf), \\dur, 0.5)]).play;', 8);
  ok(js.includes('It starts at beat 4') && !/plays from the start/.test(js), 'the late start is kept');
  eq(events.filter((e) => e.note !== 60).map((e) => [e.time, e.note]), Array.from({ length: 8 }, (_, i) => [4 + i * 0.5, i % 2 ? 69 : 67]));
  eq(events.filter((e) => e.note === 60).length, 8);
}
// A start off the loop's grid keeps every event of the loop (here the second note of each 2-beat loop).
{
  const { events } = play('Ptpar([1.5, Pbind(\\degree, Pseq([0, 4], inf), \\dur, 1)]).play;', 5);
  eq(events.map((e) => [e.time, e.note]), [[1.5, 60], [2.5, 67], [3.5, 60], [4.5, 67]]);
}
// A section that plays once, then one that plays on.
{
  const { events } = play('Pseq([Pbind(\\degree, Pseq([0, 1], 1), \\dur, 1), Pbind(\\degree, 4, \\dur, 0.5)]).play;', 4);
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [1, 62], [2, 67], [2.5, 67], [3, 67], [3.5, 67]]);
}
// A routine that waits two beats first.
{
  const { events } = play('Routine({ 2.wait; loop { Synth(\\default, [\\freq, 300]); 1.wait } }).play;', 5);
  eq(events.map((e) => e.time), [2, 3, 4]);
}
// Everything stops: the whole piece loops as a preview, said in the code, each part within its own beats.
{
  const { js, events } = play('Ptpar([0, Pbind(\\degree, Pseq([0, 1, 2, 3], 1), \\dur, 1), 2, Pbind(\\degree, Pseq([7, 7], 1), \\dur, 0.5)]).play;', 8);
  ok(js.includes('.timeLoop(1) // a preview: SuperCollider plays this once (4 beats); here it loops'), 'the loop is a preview, and says so');
  const once = [[0, 60], [1, 62], [2, 64], [2, 72], [2.5, 72], [3, 65]];
  eq(events.map((e) => [e.time, e.note]), [...once, ...once.map(([time, n]) => [time + 4, n])]);
}
// A negative timingOffset: every event plays that much earlier; the one before the start is left out, with a note.
{
  const { js, events } = play('Pbind(\\degree, Pseq([0, 1], inf), \\dur, 1, \\timingOffset, -0.25).play;', 4);
  ok(/timingOffset moves events of line 1 before the start/.test(js), 'the events before the start are noted');
  eq(events.map((e) => [e.time, e.note]), [[0.75, 62], [1.75, 60], [2.75, 62], [3.75, 60]]);
}

// ---------------------------------------------------------------- simultaneous voices, alternating SynthDefs

// Two synths a routine starts at the same instant: both play, each with its own frequency and length.
{
  const { js, events } = play('Routine({ loop { Synth(\\default, [\\freq, 200]); Synth(\\default, [\\freq, 500]); 0.5.wait } }).play;', 2);
  ok(js.includes('stack([') && js.includes('.freq(200)') && js.includes('.freq(500)'), 'one voice each');
  eq(events.map((e) => [e.time, e.freq]), [0, 0.5, 1, 1.5].flatMap((time) => [[time, 200], [time, 500]]));
  ok(events.every((e) => e.legato === undefined || e.legato > 0), 'no voice has a legato of 0');
}

/**
 * The golden fixtures: a SuperCollider file and the events it plays, compared one by one (within `windows`, in
 * seconds, when given: else from 0 to `seconds`). `sounding`: [time, n] pairs, how many notes sound at that time.
 */
for (const name of ['voices', 'alternating', 'routine-children', 'timing-offset', 'stop-replay', 'periodic-gaps', 'overlap', 'second-clock']) {
  const dir = new URL('./fixtures/supercollider/', import.meta.url);
  const source = fs.readFileSync(new URL(name + '.scd', dir), 'utf8');
  const golden = JSON.parse(fs.readFileSync(new URL(name + '.json', dir), 'utf8'));
  const { events } = play(source, golden.seconds);
  const windows = golden.windows ?? [[0, golden.seconds]];
  const pitch = (e) => e.note ?? e.freq ?? 0;
  const want = golden.events.slice().sort((a, b) => a.time - b.time || pitch(a) - pitch(b));
  const got = events.filter((e) => windows.some(([from, to]) => e.time >= from - 1e-9 && e.time < to - 1e-9)).sort((a, b) => a.time - b.time || pitch(a) - pitch(b));
  eq(got.length, want.length, name + ': the number of events (voices included)');
  want.forEach((w, i) => {
    const g = got[i];
    for (const [key, value] of Object.entries(w)) {
      if (key === 'absent') { for (const k of value) eq(g[k], undefined, name + ' event ' + i + ' has no ' + k); continue; }
      if (key === 'duration') { near((g.legato ?? NaN) * g.length, value, name + ' event ' + i + ' duration'); continue; }
      near(g[key], value, name + ' event ' + i + ' ' + key);
    }
  });
  for (const [time, n] of golden.sounding ?? []) {
    eq(events.filter((e) => e.time <= time + 1e-9 && time < e.time + e.legato * e.length - 1e-9).length, n, name + ': notes sounding at ' + time);
  }
  if (name === 'voices') near(got[1].amp / got[0].amp, 0.5, 'the second voice keeps its own level');
}

// ---------------------------------------------------------------- lifetimes and lengths

// A routine that ends starts an endless Pbind: the Pbind plays on (the routine's end, or the 512 beats the
// importer follows, is not where it ends). Event k plays degree [0, 2, 4][k % 3] at beat k / 4.
{
  const { js, events } = play('Routine({ Pbind(\\degree, Pseq([0, 2, 4], inf), \\dur, 0.25).play; 2.wait; }).play;', 514);
  ok(!/playFor|timeLoop|plays once/.test(js), 'the Pbind a finished routine started is not written as ending:\n' + js);
  const late = events.filter((e) => e.time >= 510);
  eq(late.map((e) => [e.time, e.note]), Array.from({ length: 16 }, (_, i) => [510 + i / 4, [60, 64, 67][(2040 + i) % 3]]));
  late.forEach((e) => near(e.legato * e.length, 0.2, 'each note lasts dur * legato'));
}
// A pattern a finished routine started, cut by the most events the importer follows (6000, 300 beats here): it
// plays on too.
{
  const { js, events } = play('Routine({ Pbind(\\degree, Pseq([0, 1, 2], inf), \\dur, 0.05).play; 1.wait; }).play;', 401);
  ok(!/playFor|timeLoop|plays once/.test(js), 'an event cap is not an end');
  // Event k at beat k / 20: the 8000th at beat 400.
  eq(events.filter((e) => e.time >= 400 - 1e-9).map((e) => e.note), Array.from({ length: 20 }, (_, i) => [60, 62, 64][(8000 + i) % 3]));
}
// A routine stops the pattern it started: it ends there (events at beats 0 to 1.75 only), and so does the piece.
{
  const { js, events } = play('Routine({ var p = Pbind(\\degree, Pseq([0, 2, 4], inf), \\dur, 0.25).play; 2.wait; p.stop; }).play;', 2);
  ok(/plays once \(2 beats\)/.test(js), 'the piece ends where the pattern is stopped');
  eq(events.map((e) => [e.time, e.note]), Array.from({ length: 8 }, (_, k) => [k / 4, [60, 64, 67][k % 3]]));
}
// A routine stops a pattern the file started, at beat 3: it plays until then (not at all, before).
{
  const { js, events } = play('x = Pbind(\\degree, Pseq([0, 2], inf), \\dur, 0.5).play;\nRoutine({ 3.wait; x.stop; }).play;', 3);
  ok(/plays once \(3 beats\)/.test(js), 'it ends at beat 3');
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [0.5, 64], [1, 60], [1.5, 64], [2, 60], [2.5, 64]]);
}
// A Ppar whose finite pattern ends while the other plays on: it ends after its own four events.
{
  const { events } = play('Ppar([Pbind(\\degree, Pseq([0, 1, 2, 3]), \\dur, 1), Pbind(\\degree, 7, \\dur, 0.5)]).play;', 8);
  eq(events.filter((e) => e.note !== 72).map((e) => [e.time, e.note]), [[0, 60], [1, 62], [2, 64], [3, 65]]);
  eq(events.filter((e) => e.note === 72).length, 16);
}
// A routine that loops forever, starting the same pattern every 4 beats: each playback ends, the piece does not.
{
  const { js, events } = play('p = Pbind(\\degree, Pseq([0, 1]), \\dur, 0.5);\nRoutine({ loop { p.play; 4.wait } }).play;', 520);
  ok(!/playFor|timeLoop|plays once/.test(js), 'it plays on');
  eq(events.filter((e) => e.time >= 512).map((e) => [e.time, e.note]), [[512, 60], [512.5, 62], [516, 60], [516.5, 62]]);
}
// ... and starting a new pattern every 4 beats: those after the 512 beats followed are not written, and it says so.
{
  const { code: js } = convertSuperCollider('Routine({ loop { Pbind(\\degree, Pseq([0, 1]), \\dur, 0.5).play; 4.wait } }).play;', 'test.scd');
  ok(!/this plays once|timeLoop/.test(js), 'the piece is not written as ending at the horizon');
  ok(/the routine loops forever; the patterns it starts are followed for its first 512 beats/.test(js), 'the note says how far it was followed');
}
// A timingOffset keeps each note's own length (dur * legato), whatever the width of its step.
{
  const { events } = play('Pbind(\\degree, Pseq([0, 4], inf), \\dur, 1, \\timingOffset, Pseq([0.5, 0], inf)).play;', 4);
  eq(events.map((e) => [e.time, e.note]), [[0.5, 60], [1, 67], [2.5, 60], [3, 67]]);
  events.forEach((e) => near(e.legato * e.length, 0.8, 'the note at ' + e.time + ' lasts 0.8 beats'));
}
// So does a step that the next onset (moved early) cuts short, and one that the end of the loop cuts short (Ptpar).
{
  const { events } = play('Pbind(\\degree, Pseq([0, 4], inf), \\dur, 1, \\timingOffset, Pseq([0, -0.5], inf)).play;', 4);
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [0.5, 67], [2, 60], [2.5, 67]]);
  events.forEach((e) => near(e.legato * e.length, 0.8, 'the note at ' + e.time + ' lasts 0.8 beats'));
  const ptpar = play('Ptpar([0, Pbind(\\note, 0, \\dur, 1), 0.5, Pbind(\\note, 7, \\dur, 1)]).play;', 2).events;
  eq(ptpar.map((e) => [e.time, e.note]), [[0, 60], [0.5, 67], [1, 60], [1.5, 67]]);
  ptpar.forEach((e) => near(e.legato * e.length, 0.8, 'the note at ' + e.time + ' lasts 0.8 beats'));
}

// Each .play is a playback of its own (the fixtures stop-replay, periodic-gaps, overlap and second-clock check more).
// Played, stopped and played again by a routine that then loops forever: the gap stays, the second playback plays
// on from its own first note (degrees 0 and 2 alternate: event k of it at beat 6 + k).
{
  const { js, events } = play('p = Pbind(\\degree, Pseq([0, 2], inf), \\dur, 1);\nRoutine({ x = p.play; 4.wait; x.stop; 2.wait; p.play; loop { 1.wait } }).play;', 10);
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [1, 64], [2, 60], [3, 64], [6, 60], [7, 64], [8, 60], [9, 64]]);
  ok(js.includes('.playFor(0, 1)') && js.includes('.stopFor(0, 1.5)'), 'one part per playback, each from its own start');
  const late = play('p = Pbind(\\degree, Pseq([0, 2], inf), \\dur, 1);\nRoutine({ x = p.play; 4.wait; x.stop; 2.wait; p.play; loop { 1.wait } }).play;', 802).events;
  eq(late.filter((e) => e.time >= 798).map((e) => [e.time, e.note]), [[798, 60], [799, 64], [800, 60], [801, 64]]);
}
// A routine that ends after playing and stopping the same pattern 8 times: one part, its gaps in its loop, once.
{
  const { js, parts, events } = play('p = Pbind(\\degree, Pseq([0, 1, 2, 3], inf), \\dur, 1);\nRoutine({ 8.do { x = p.play; 3.wait; x.stop; 1.wait } }).play;', 31);
  eq(parts, 1);
  ok(/plays once \(31 beats\)/.test(js), 'it ends where the last playback is stopped');
  eq(events.map((e) => [e.time, e.note]), Array.from({ length: 8 }, (_, n) => [[4 * n, 60], [4 * n + 1, 62], [4 * n + 2, 64]]).flat());
}
// x.resume after x.stop goes on from where the stream stopped (an EventStreamPlayer is not reset).
{
  const { events } = play('x = Pbind(\\degree, Pseq([0, 1, 2, 3, 4, 5], inf), \\dur, 1).play;\nRoutine({ 2.wait; x.stop; 2.wait; x.resume; }).play;', 9);
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [1, 62], [4, 64], [5, 65], [6, 67], [7, 69], [8, 60]]);
}
// A Pdef stopped and played again: each play starts it again, from its first note.
{
  const { events } = play('Pdef(\\a, Pbind(\\degree, Pseq([0, 2], inf), \\dur, 0.5));\nRoutine({ Pdef(\\a).play; 2.wait; Pdef(\\a).stop; 1.wait; Pdef(\\a).play; 2.wait; Pdef(\\a).stop }).play;', 5);
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [0.5, 64], [1, 60], [1.5, 64], [3, 60], [3.5, 64], [4, 60], [4.5, 64]]);
}
// A Pdef that plays already does not start again: played twice at the top of the file it is one part (its last
// definition), and played again by a routine while it plays it goes on, not from its first note. A finite one that
// ended does start again.
{
  const twice = play('Pdef(\\a, Pbind(\\degree, 0)).play;\nPdef(\\a, Pbind(\\degree, 4)).play;', 3);
  eq([twice.parts, twice.events.map((e) => [e.time, e.note])], [1, [[0, 67], [1, 67], [2, 67]]]);
  const again = play('Pdef(\\a, Pbind(\\degree, Pseq([0, 1, 2, 3], inf), \\dur, 1)).play;\nRoutine({ 2.wait; Pdef(\\a).play }).play;', 6);
  eq(again.events.map((e) => [e.time, e.note]), [[0, 60], [1, 62], [2, 64], [3, 65], [4, 60], [5, 62]]);
  const ended = play('Pdef(\\f, Pbind(\\degree, Pseq([0, 1]), \\dur, 0.5));\nRoutine({ loop { Pdef(\\f).play; 4.wait } }).play;', 9);
  eq(ended.events.map((e) => [e.time, e.note]), [[0, 60], [0.5, 62], [4, 60], [4.5, 62], [8, 60], [8.5, 62]]);
}
// quant: a pattern played at beat 0.5 with quant 2 starts at beat 2; a Pdef starts on the next beat (its default quant is 1).
{
  const { events } = play('p = Pbind(\\degree, Pseq([0, 1], inf), \\dur, 1);\nPdef(\\a, Pbind(\\degree, 7, \\dur, 1));\nRoutine({ 0.5.wait; p.play(quant: 2); Pdef(\\a).play; }).play;', 4);
  eq(events.map((e) => [e.time, e.note]), [[1, 72], [2, 60], [2, 72], [3, 62], [3, 72]]);
}
// Clocks: a pattern played in a routine on TempoClock(2) without a clock plays on the default clock (1 beat per
// second); the routine stops it 1.5 of its beats (0.75 s) after each start, every 4 of its beats (2 s), for ever.
{
  const { events } = play('p = Pbind(\\degree, Pseq([0, 1], inf), \\dur, 1);\nRoutine({ loop { x = p.play; 1.5.wait; x.stop; 2.5.wait } }).play(TempoClock(2));', 606);
  eq(events.filter((e) => e.time < 7 || e.time >= 600).map((e) => [e.time, e.note]), [[0, 60], [2, 60], [4, 60], [6, 60], [600, 60], [602, 60], [604, 60]]);
}
// A routine started by a routine on a faster clock waits in beats of that clock: 4 beats at 4 per second are 1 s.
{
  const { js, events } = play('x = Pbind(\\degree, Pseq([0, 1, 2, 3], inf), \\dur, 0.5).play;\nRoutine({ 1.wait; Routine({ 4.wait; x.stop }).play(TempoClock(4)) }).play;', 2);
  ok(/plays once \(2 beats\)/.test(js), 'stopped at 2 s');
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [0.5, 62], [1, 64], [1.5, 65]]);
}

// ---------------------------------------------------------------- safe code, tempo

// Instruments named like reserved words, the evaluator's names and TidalJS's globals: the code still runs.
{
  const names = ['yield', 'let', 'static', 'implements', 'await', 'arguments', 'eval', '__out', 'sound', 'stack', 'sine', 'note', 'Math'];
  const code = names.map((n, i) => `SynthDef('${n}', { |out, freq = 440, amp = 0.1| Out.ar(out, SinOsc.ar(freq) * Env.perc(0.01, 0.1).ar(2) * amp ! 2) }).add;\nPbind(\\instrument, '${n}', \\dur, 1, \\degree, ${i}).play;`).join('\n');
  const { js, parts, events } = play(code, 1);
  eq(parts, names.length);
  ok(js.includes('const yieldPart = ') && js.includes('const soundPart = ') && !/const (yield|let|static|await|sound|stack|note) =/.test(js), 'safe bindings');
  eq(events.length, names.length);
}
{
  const { js, events } = play(String.raw`SynthDef(\yield, { |out, freq = 440, amp = 0.1| Out.ar(out, SinOsc.ar(freq) * Env.perc(0.01, 0.2).ar(2) * amp ! 2) }).add;
Pbind(\instrument, \yield, \degree, Pseq([0, 2], inf), \dur, 0.5).play;`, 1);
  ok(js.includes('sound("sine")'), 'a SynthDef named yield converts');
  eq(events.map((e) => [e.time, e.note]), [[0, 60], [0.5, 64]]);
}
// Every global TidalJS defines is a name a binding avoids (and the importer's list has them all).
{
  const context = vm.createContext({ console: { warn() {}, error() {}, log() {} } });
  const before = new Set(vm.runInContext('Object.getOwnPropertyNames(globalThis)', context));
  vm.runInContext(fs.readFileSync(new URL('../tidal.js', import.meta.url), 'utf8'), context);
  vm.runInContext(`const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} } });
    const engine = new TidalJS(); engine.audioContext = { currentTime: 0, state: 'running', createGain: node, resume() {} };
    engine.masterGain = node(); engine.setupGlobalFunctions();`, context);
  const globals = [...vm.runInContext('Object.getOwnPropertyNames(globalThis)', context)].filter((n) => !before.has(n));
  ok(globals.length > 200, 'the engine defines its globals');
  const missing = globals.filter((n) => !TIDAL_GLOBALS.has(n));
  eq(missing, [], 'TIDAL_GLOBALS in emit.ts lists every global of tidal.js');
  ok(globals.every((n) => !isSafeBinding(n)), 'no binding hides a global');
  ok(['yield', 'let', 'static', 'implements', 'await', 'package', '__out', '__at', 'eval', 'arguments'].every((n) => !isSafeBinding(n)), 'nor a reserved word or an evaluator name');
}
// Line breaks and other control characters in names cannot end a comment and become code.
{
  const evil = 'x\u2028sound("bd*16")\u2029//\ny';
  const { js, events } = play(`Pbind(\\instrument, '${evil}', \\dur, 1).play;`, 2, /Unknown sound/);
  ok(!/[\u2028\u2029]/.test(js), 'no line or paragraph separator in the code');
  ok(js.split('\n').every((line) => !/^sound\("bd\*16"\)/.test(line.trim())), 'the name stays inside its comment');
  eq(events.length, 2);
  const named = convertSuperCollider('Pbind(\\dur, 1).play;', 'a\nsound("bd")\u2028.scd');
  ok(named.code.split(/\r\n|[\n\r\u2028\u2029]/).every((line) => line.startsWith('//') || !line.includes('sound("bd")')), 'nor can the file name');
  ok(t.eval(named.code).success, 'the code runs');
  t.stopAll();
}
// 360 beats per minute (TempoClock.default.tempo = 6): setTempo stops at 300 BPM, so setCPS keeps the tempo.
{
  const { js, events } = play('TempoClock.default.tempo = 6;\nPbind(\\degree, Pseq([0, 1, 2, 3], inf), \\dur, 1).play;', 1);
  ok(js.includes('setCPS(1.5)') && !js.includes('setTempo('), 'the tempo is set exactly');
  events.forEach((e, i) => { near(e.time, i / 6, 'a beat is 1/6 s'); eq(e.note, [60, 62, 64, 65][i % 4]); });
  eq(events.length, 6);
}
// Faster than TidalJS's 10 cycles per second at 4 beats a cycle: a cycle of more beats keeps it exact.
{
  const { js, events } = play('TempoClock.default.tempo = 100;\nPbind(\\dur, 0.25).play;', 0.1);
  ok(js.includes('setCPS(6.25)') && /one cycle is 16 beats/.test(js), 'the tempo stays exact');
  eq(t.cps, 6.25);
  events.forEach((e, i) => near(e.time, i * 0.0025, 'a quarter beat is 2.5 ms'));
  eq(events.length, 40);
}

// The README's example converts to the code the README shows.
{
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8').split('\r\n').join('\n');
  const section = readme.split('### Importing SuperCollider code')[1];
  const input = section.match(/```supercollider\n([\s\S]*?)```/)[1];
  const output = section.match(/becomes:\n\n```javascript\n([\s\S]*?)```/)[1];
  eq(convertSuperCollider(input, 'my-song.scd').code, output);
}

console.log('supercollider: all ' + passed + ' checks passed');
