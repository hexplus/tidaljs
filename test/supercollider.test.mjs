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
import { parseImport } from '../src/library.ts';

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
function play(code, seconds = 8) {
  const { code: js, parts } = convertSuperCollider(code, 'test.scd');
  const result = t.eval(js);
  assert.ok(result.success, 'the converted code fails: ' + result.error + '\n' + js);
  assert.deepStrictEqual(result.warnings, [], 'the converted code warns:\n' + js);
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
  ok(js.includes('rand.range(0.2, 0.8)') && js.includes('choose([-1, 0, 1])'), 'random patterns become TidalJS random signals');
  eq(events.map((e) => e.time), [0, 1, 1.5, 2, 3, 3.5]);
  eq(events.map((e) => e.note), [60, 63, 65, 60, 63, 65]);
  ok(events.every((e) => e.amp >= 0.2 && e.amp <= 0.8 && [-1, 0, 1].includes(e.pan)), 'random values in range');
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

// The README's example converts to the code the README shows.
{
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8').split('\r\n').join('\n');
  const section = readme.split('### Importing SuperCollider code')[1];
  const input = section.match(/```supercollider\n([\s\S]*?)```/)[1];
  const output = section.match(/becomes:\n\n```javascript\n([\s\S]*?)```/)[1];
  eq(convertSuperCollider(input, 'my-song.scd').code, output);
}

console.log('supercollider: all ' + passed + ' checks passed');
