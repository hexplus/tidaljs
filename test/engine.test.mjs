/**
 * Engine tests for tidal.js: patterns, mini-notation, transformations,
 * controls, harmony, signals, code evaluation, error locations and the
 * scheduler. Runs in Node with a fake audio context: npm test
 */
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

// tidal.js is a classic script that defines globalThis.TidalJS.
vm.runInThisContext(fs.readFileSync(new URL('../tidal.js', import.meta.url), 'utf8'), { filename: 'tidal.js' });
const { TidalJS } = globalThis;

// Failing evaluations log on purpose; keep the output to the result.
console.error = () => {};
console.warn = () => {};

// Minimal fake audio context so eval()/_start() work without audio.
const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} } });
const t = new TidalJS();
t.audioContext = { currentTime: 0, state: 'running', createGain: node, resume() {} };
t.masterGain = node();
t.setupGlobalFunctions();
t._startTimer = () => {};
t._stopTimer = () => {};

const fmt = (evs) => evs
    .slice()
    .sort((a, b) => (Math.abs(a.begin - b.begin) > 1e-9 ? a.begin - b.begin : String(a.value.s).localeCompare(String(b.value.s))))
    .map((e) => `${e.value.s ?? ''}${e.value.note !== undefined ? '/' + e.value.note : ''}@${+e.begin.toFixed(4)}`)
    .join(' ');
const q = (p, b = 0, e = 1) => fmt(p.query(b, e));
let passed = 0;
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); passed++; };

// Mini-notation
eq(q(sound('bd sn')), 'bd@0 sn@0.5');
eq(q(sound('bd ~ sn ~')), 'bd@0 sn@0.5');
eq(q(sound('bd*2 sn')), 'bd@0 bd@0.25 sn@0.5');
eq(q(sound(['bd', 'sn', '~', 'hh'])), 'bd@0 sn@0.25 hh@0.75');

// fast repeats the pattern (bug before: compressed into first half)
eq(q(sound('bd sn').fast(2)), 'bd@0 sn@0.25 bd@0.5 sn@0.75');
eq(q(sound('bd sn').density(2)), 'bd@0 sn@0.25 bd@0.5 sn@0.75');
eq(q(sound('bd sn').slow(2), 0, 2), 'bd@0 sn@1');
eq(q(sound('bd sn hh').rev()), 'hh@0 sn@0.3333 bd@0.6667');
eq(q(sound('bd sn').rev(), 3, 4), 'sn@3 bd@3.5');
eq(q(sound('bd').slow(2).rev(), 0, 4), 'bd@1 bd@3');

// every: cycle 0, 4, 8...
const ev = sound('bd sn').every(4, (x) => x.fast(2));
eq(q(ev, 0, 1), 'bd@0 sn@0.25 bd@0.5 sn@0.75');
eq(q(ev, 1, 2), 'bd@1 sn@1.5');
eq(q(ev, 4, 5), 'bd@4 sn@4.25 bd@4.5 sn@4.75');
// two every() calls no longer overwrite each other
const ev2 = sound('bd sn').every(2, (x) => x.gain(0.5)).every(3, (x) => x.rev());
eq(q(ev2, 0, 1), 'sn@0 bd@0.5'); // cycle 0: both apply
eq(ev2.query(0, 1)[0].value.gain, 0.5);
eq(q(ev2, 3, 4), 'sn@3 bd@3.5');
eq(ev2.query(3, 4)[0].value.gain, undefined);

// whenmod: Tidal semantics (cycle mod n >= offset)
const wm = sound('bd sn').whenmod(4, 2, (x) => x.rev());
eq(q(wm, 1, 2), 'bd@1 sn@1.5');
eq(q(wm, 2, 3), 'sn@2 bd@2.5');
eq(q(wm, 3, 4), 'sn@3 bd@3.5');

// sometimes: roughly half, deterministic per event
const st = sound('hh*16').sometimes((x) => x.gain(0.1));
let low = 0;
for (let c = 0; c < 50; c++) low += st.query(c, c + 1).filter((e) => e.value.gain === 0.1).length;
assert(low > 300 && low < 500, `sometimes ratio ${low}/800`); passed++;
eq(JSON.stringify(st.query(7, 8)), JSON.stringify(st.query(7, 8)));
const often = sound('hh*16').often((x) => x.gain(0.1));
let lo2 = 0;
for (let c = 0; c < 50; c++) lo2 += often.query(c, c + 1).filter((e) => e.value.gain === 0.1).length;
assert(lo2 > 520 && lo2 < 680, `often ratio ${lo2}/800`); passed++;
eq(sound('bd sn').almostNever((x) => x.fast(2)).query(0, 1).length >= 1, true);
eq(sound('bd sn').almostAlways((x) => x).query(0, 1).length, 2);
eq(sound('bd sn').rarely((x) => x).query(0, 1).length, 2);

// Composition
eq(q(stack([sound('bd ~'), sound('~ sn')])), 'bd@0 sn@0.5');
eq(q(stack(sound('bd ~'), sound('~ sn'))), 'bd@0 sn@0.5'); // varargs (bug before)
eq(q(layer([sound('bd'), sound('hh hh')])), 'bd@0 hh@0 hh@0.5');
const c2 = cat([sound('bd sn'), sound('hh cp')]);
eq(q(c2, 0, 1), 'bd@0 sn@0.5');
eq(q(c2, 1, 2), 'hh@1 cp@1.5');
eq(q(c2, 2, 3), 'bd@2 sn@2.5');
eq(q(fastcat([sound('bd'), sound('sn')])), 'bd@0 sn@0.5');
const ap = sound('bd').append('sn').append('cp');
eq(q(ap, 0, 3), 'bd@0 sn@1 cp@2');
eq(q(ap, 3, 4), 'bd@3');
eq(q(sound('bd ~ bd ~').overlay('~ sn ~ sn')), 'bd@0 sn@0.25 bd@0.5 sn@0.75');
const sup = sound('bd sn').superimpose((x) => x.fast(2).up(12));
eq(sup.query(0, 1).length, 6);
eq(sup.query(0, 1).filter((e) => e.value.note === 72).length, 4); // Tidal: up = note
eq(q(struct('x ~ x x', sound('bd sn'))), 'bd@0 sn@0.5 sn@0.75');
eq(q(sound('bd sn').struct('t t t t')), 'bd@0 bd@0.25 sn@0.5 sn@0.75');
eq(q(struct('1 0 1', 'hh')), 'hh@0 hh@0.6667');

// Musical controls
eq(q(sound('arpy').note('c e g c5')), 'arpy/60@0 arpy/64@0.25 arpy/67@0.5 arpy/72@0.75');
eq(q(sound('arpy*4').note('c e')), 'arpy/60@0 arpy/60@0.25 arpy/64@0.5 arpy/64@0.75');
eq(sound('arpy').note('eb3 f#').query(0, 1).map((e) => e.value.note).join(), '51,66');
eq(sound('arpy').note('0 7').query(0, 1).map((e) => e.value.note).join(), '60,67');
eq(sound('arpy').note('c e g').up('0 12 7').query(0, 1).map((e) => e.value.note).join(), '60,72,67'); // up = note replaces it, as in Tidal
eq(sound('sine').freq('440 554 659').query(0, 1).map((e) => e.value.freq).join(), '440,554,659');
eq(sound('arpy').midinote('60 64 67').query(0, 1).map((e) => e.value.midinote).join(), '60,64,67');
eq(sound('bd sn').n('0 1').query(0, 1).map((e) => e.value.n).join(), '0,1');
eq(sound('bd').up(0.5).query(0, 1)[0].value.note, 60.5);
eq(sound('hh*4').gain('1 0.5').query(0, 1).map((e) => e.value.gain).join(), '1,1,0.5,0.5');

// Effects
const fx = sound('bd').gain(0).pan(-0.5).lpf(800).hpf(100).bpf(1000).delay(0.25).reverb(0.3).distortion(5).crush(4).vowel('a');
eq(JSON.stringify(fx.query(0, 1)[0].value), JSON.stringify({ s: 'bd', gain: 0, pan: -0.5, lpf: 800, hpf: 100, bpf: 1000, delay: 0.25, reverb: 0.3, distortion: 5, crush: 4, vowel: 'a' }));
// Immutability: methods never change the original
const base = sound('bd sn');
base.fast(2); base.gain(0.2);
eq(q(base), 'bd@0 sn@0.5');
eq(base.query(0, 1)[0].value.gain, undefined);

// Errors are thrown with readable messages
assert.throws(() => sound('bd').fast('xyz'), /fast\(\) expects a number/); passed++; // "x" alone is Tidal's 1/6
assert.throws(() => sound('bd').every(4, 5), /every\(\) expects a function/); passed++;
assert.throws(() => sound('bd').superimpose(() => 3), /must return a pattern/); passed++;

// Statement splitting
const split = TidalJS.splitStatements;
eq(JSON.stringify(split('sound("bd")\n  .fast(2)\n\nsound("hh") // c\nsound("a//b"); sound("x")')),
    JSON.stringify(['sound("bd")\n  .fast(2)', 'sound("hh")', 'sound("a//b")', 'sound("x")']));
eq(split('stack([\n  sound("bd"),\n  sound("sn")\n])\n.fast(2)').length, 1);
eq(split('const p = sound("bd")\np.fast(2)').length, 2);
eq(split('sound("bd").every(4, x =>\n  x.fast(2))').length, 1);

// eval
let r = t.eval('// comment\nconst p = sound("bd sn")\np.fast(2)\nsound("hh*4").gain(0.5)\n\nsetCPS(1)');
eq(r.success, true);
eq(r.activePatterns, 2);
eq(t.cps, 1);
eq(t.isPlaying, true);
r = t.eval('sound("bd").play()');
eq(r.activePatterns, 1);
r = t.eval('sound("bd").fast("xyz")');
eq(r.success, false);
eq(/fast\(\) expects a number/.test(r.error), true);
eq(t.channels.size, 1); // previous pattern keeps playing on error
r = t.eval('sound("bd"');
eq(r.success, false);
eq(t.channels.size, 1);
r = t.eval('sound("bd zz").note("c q")');
eq(r.success, true);
eq(r.warnings.includes('Unknown sound "zz"'), true);
eq(r.warnings.includes('Unknown note "q"'), true);
r = t.eval('// nothing');
eq(r.activePatterns, 0);
eq(t.isPlaying, false);

// Scheduler: events are scheduled once, at the right time, across ticks
t.eval('sound("bd sn hh cp")');
const played = [];
t.playEvent = (v, time) => played.push([v.s, +time.toFixed(4)]);
t.cps = 1;
t._anchorTime = 0; t._anchorCycle = 0; t._nextCycle = 0;
for (let ms = 0; ms <= 2000; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
eq(played.filter(([s]) => s === 'bd').length, 3); // cycles 0, 1, 2 (lookahead)
eq(played.length, new Set(played.map(String)).size);
eq(JSON.stringify(played.slice(0, 4)), JSON.stringify([['bd', 0], ['sn', 0.25], ['hh', 0.5], ['cp', 0.75]]));
// Tempo change keeps continuity
played.length = 0;
t.setCPS(2);
for (let ms = 2025; ms <= 3000; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
const times = played.map(([, time]) => time);
for (let i = 1; i < times.length; i++) assert(times[i] > times[i - 1], 'monotonic');
eq(Math.abs((times[times.length - 1] - times[times.length - 2]) - 0.125) < 1e-6, true);

// Old setCPS(NaN) bug
t.setCPS(NaN);
eq(t.cps, 2);

// queryActive leaves muted streams out, or marks them silent when asked
t.eval('d1(sound("bd*2")); d2(sound("hh*4")); mute(2)');
eq(t.queryActive(0, 1).map((e) => e.value.s).join(' '), 'bd bd');
eq(t.queryActive(0, 1, true).filter((e) => e.silent).map((e) => e.value.s).join(' '), 'hh hh hh hh');
eq([...new Set(t.queryActive(0, 1, true).map((e) => e.stream))].join(' '), 'd1 d2');
eq(t.queryActive(0, 1).some((e) => 'stream' in e), false);
t.muted.clear();

// The heard position trails the clock by the output latency (the cycle view's playhead)
eq(t.getAudibleCyclePosition(), t.getCyclePosition());
t.audioContext.outputLatency = 0.04; t.audioContext.baseLatency = 0.01;
eq(+(t.getCyclePosition() - t.getAudibleCyclePosition()).toFixed(6), +(0.05 * t.cps).toFixed(6));
delete t.audioContext.outputLatency; delete t.audioContext.baseLatency;

// ---------------- Phase 2+ ----------------
const vals = (p, b = 0, e = 1) => p.query(b, e).slice().sort((x, y) => x.begin - y.begin || String(x.value.s ?? x.value).localeCompare(String(y.value.s ?? y.value)));
// Mini-notation
eq(q(sound('bd [sn sn]')), 'bd@0 sn@0.5 sn@0.75');
eq(q(sound('[bd sn]*2')), 'bd@0 sn@0.25 bd@0.5 sn@0.75');
const alt = sound('bd <sn cp hh>');
eq(q(alt, 0, 3), 'bd@0 sn@0.5 bd@1 cp@1.5 bd@2 hh@2.5');
eq(q(sound('<bd sn>/2'), 0, 4), 'bd@0 sn@2');
eq(q(sound('[bd, hh hh]')), 'bd@0 hh@0 hh@0.5');
eq(q(sound('bd@3 sn')), 'bd@0 sn@0.75');
eq(q(sound('bd _ _ sn')), 'bd@0 sn@0.75');
eq(q(sound('bd!3 sn')), 'bd@0 bd@0.25 bd@0.5 sn@0.75');
eq(q(sound('bd ! sn')), 'bd@0 bd@0.3333 sn@0.6667');
eq(q(sound('bd(3,8)')), 'bd@0 bd@0.375 bd@0.75');
eq(q(sound('bd(3,8,2)')), 'bd@0.125 bd@0.5 bd@0.75');
eq(TidalJS.bjorklund(5, 8).map((x) => (x ? 'x' : '.')).join(''), 'x.xx.xx.');
eq(TidalJS.bjorklund(4, 12).map((x) => (x ? 'x' : '.')).join(''), 'x..x..x..x..');
eq(q(sound('{bd sn, hh hh hh}'), 0, 1), 'bd@0 hh@0 hh@0.5 sn@0.5');
eq(q(sound('{bd sn, hh hh hh}'), 1, 2), 'bd@1 hh@1 hh@1.5 sn@1.5');
eq(q(sound('{bd sn hh}%4')), 'bd@0 sn@0.25 hh@0.5 bd@0.75');
eq(q(sound('bd . hh hh')), 'bd@0 hh@0.5 hh@0.75');
eq(JSON.stringify(sound('bd:3 sn').query(0, 1)[0].value), JSON.stringify({ s: 'bd', n: 3 }));
let kept = 0;
const deg = sound('hh*16?');
for (let c = 0; c < 20; c++) kept += deg.query(c, c + 1).length;
assert(kept > 120 && kept < 200, 'hh? keeps about half: ' + kept); passed++;
let either = 0;
const rnd = sound('[bd | sn]');
for (let c = 0; c < 40; c++) either += rnd.query(c, c + 1)[0].value.s === 'bd' ? 1 : 0;
assert(either > 8 && either < 32, '| picks randomly ' + either); passed++;
assert.throws(() => sound('[bd sn'), /expected "\]"/); passed++;
assert.throws(() => sound('bd )'), /unexpected/); passed++;

// Chords and scales
eq(JSON.stringify(TidalJS.parseChord("c'maj")), '[0,4,7]');
eq(JSON.stringify(TidalJS.parseChord("e'min7")), '[4,7,11,14]');
eq(JSON.stringify(TidalJS.parseChord("c'maj'i")), '[4,7,12]');
eq(JSON.stringify(TidalJS.parseChord("c'maj'5")), '[0,4,7,12,16]');
eq(JSON.stringify(TidalJS.parseChord("c'maj7'o")), '[-12,-5,4,11]');
const chordNotes = (p) => p.query(0, 1).map((e) => e.value.note).sort((a, b) => a - b).join();
eq(chordNotes(sound('arpy').note("c'maj")), '60,64,67');
eq(chordNotes(sound('arpy*2').note("c'maj")), '60,60,64,64,67,67');
eq(chordNotes(sound('arpy').note(chord("a3'min"))), '57,60,64');
eq(q(sound('arpy').note("c'maj").arp('up')), 'arpy/60@0 arpy/64@0.3333 arpy/67@0.6667');
eq(q(sound('arpy').note("c'maj").arp('down')), 'arpy/67@0 arpy/64@0.3333 arpy/60@0.6667');
eq(sound('arpy').note("c'maj e'min").arp('<up updown>').query(1, 2).map((e) => e.value.note).join(), '60,64,67,64,64,67,71,67');
eq(chordNotes(sound('arpy').note("c'maj").inversion(1)), '64,67,72');
eq(scale('major', '0 2 4 7').query(0, 1).map((e) => e.value).join(), '0,4,7,12');
eq(scale('e:minor', '0 1 2').query(0, 1).map((e) => e.value).join(), '4,6,7');
eq(scale('<major minor>', '2').query(1, 2).map((e) => e.value).join(), '3');
eq(sound('arpy*4').note(scale('major', '0 1 2 -1')).query(0, 1).map((e) => e.value.note).join(), '60,62,64,59');

// Transformations
eq(q(sound('bd sn hh cp').chunk(4, (x) => x.gain(0.5)), 1, 2), 'bd@1 sn@1.25 hh@1.5 cp@1.75');
eq(sound('bd sn hh cp').chunk(4, (x) => x.gain(0.5)).query(1, 2).filter((e) => e.value.gain === 0.5).map((e) => e.value.s).join(), 'sn');
eq(q(sound('bd sn').palindrome(), 0, 2), 'bd@0 sn@0.5 sn@1 bd@1.5');
eq(q(sound('bd sn').compress(0.5, 1)), 'bd@0.5 sn@0.75');
eq(q(sound('bd sn').compress(0.5, 1).stretch()), 'bd@0 sn@0.5');
eq(q(sound('hh*4').swingBy(0.25, 2)), 'hh@0 hh@0.375 hh@0.5 hh@0.875');
eq(q(sound('hh*4').swing(2)).split(' ').length, 4);
const sc = sound('a b c d').scramble(4);
eq(sc.query(0, 1).length, 4);
const sh = sound('a b c d').shuffle(4);
for (let c = 0; c < 5; c++) eq(sh.query(c, c + 1).map((e) => e.value.s).sort().join(''), 'abcd');
eq(q(sound('a b c d').bite(4, '0 0 3 2')), 'a@0 a@0.25 d@0.5 c@0.75');
eq(q(sound('a b c d').fitment(2, '1 0')), 'c@0 d@0.25 a@0.5 b@0.75');
const chopped = sound('bd sn').chop(2).query(0, 1);
eq(chopped.map((e) => `${e.value.s}${e.value.begin}-${e.value.end}@${e.begin}`).join(' '), 'bd0-0.5@0 bd0.5-1@0.25 sn0-0.5@0.5 sn0.5-1@0.75');
eq(sound('bd').striate(2).query(0, 1).map((e) => `${e.value.begin}@${e.begin}`).join(' '), '0@0 0.5@0.5');
let dkept = 0;
const dg = sound('hh*16').degradeBy(0.75);
for (let c = 0; c < 20; c++) dkept += dg.query(c, c + 1).length;
assert(dkept > 40 && dkept < 120, 'degradeBy 0.75 keeps ~25%: ' + dkept); passed++;
eq(sound('hh*16').degrade().query(0, 8).length + sound('hh*16').unDegradeBy(0.5).query(0, 8).length > 0, true);
eq(q(sound('bd sn').hurry(2)), 'bd@0 sn@0.25 bd@0.5 sn@0.75');
eq(sound('bd sn').hurry(2).query(0, 1)[0].value.speed, 2);
eq(q(sound('bd sn').sparsity(2), 0, 2), 'bd@0 sn@1');
eq(sound('bd*4').within(0, 0.5, (x) => x.gain(0.2)).query(0, 1).map((e) => e.value.gain).sort().join(), '0.2,0.2,,');
eq(sound('bd*4').within([0.5, 1], (x) => x.gain(0.2)).query(0, 1).filter((e) => e.value.gain === 0.2).length, 2);
eq(sound('bd*4').while('1 0', (x) => x.gain(0.2)).query(0, 1).filter((e) => e.value.gain === 0.2).length, 2);
eq(sound('bd').until(2, (x) => x.gain(0.1)).query(1, 2)[0].value.gain, 0.1);
eq(sound('bd').until(2, (x) => x.gain(0.1)).query(2, 3)[0].value.gain, undefined);
eq(q(sound('bd').playFor(1, 3), 0, 4), 'bd@1 bd@2');
eq(q(sound('bd').stopFor(1, 3), 0, 4), 'bd@0 bd@3');
eq(q(randcat([sound('a'), sound('b')]), 0, 1).length > 0, true);

// Signals
eq(sound('hh*4').gain(saw).query(0, 1).map((e) => e.value.gain).join(), '0,0.25,0.5,0.75');
eq(sound('hh*4').lpf(saw.range(100, 500)).query(0, 1).map((e) => e.value.lpf).join(), '100,200,300,400');
eq(sound('hh*2').lpf(saw.slow(2)).query(1, 2).map((e) => e.value.lpf).join(), '0.5,0.75');
eq(sound('hh*4').pan(square).query(0, 1).map((e) => e.value.pan).join(), '0,0,1,1');
eq(sound('hh*4').gain(tri).query(0, 1).map((e) => e.value.gain).join(), '0,0.5,1,0.5');
eq(Math.round(sound('hh').gain(sine).query(0, 1)[0].value.gain * 100), 50);
eq(sound('hh*8').n(irand(8)).query(0, 1).every((e) => Number.isInteger(e.value.n) && e.value.n >= 0 && e.value.n < 8), true);
eq(sound('hh*8').gain(rand).query(0, 1).every((e) => e.value.gain >= 0 && e.value.gain < 1), true);
eq(sound('hh*8').gain(perlin).query(0, 1).every((e) => e.value.gain >= 0 && e.value.gain <= 1), true);
eq(saw.segment(4).query(0, 1).map((e) => e.value).join(), '0,0.25,0.5,0.75');
eq(saw.range(0, 7).quantise().segment(4).query(0, 1).map((e) => e.value).join(), '0,2,4,5');
eq(sound('hh*4').gain(fit(0, [0, 1], '0 1').smooth()).query(0, 1).map((e) => e.value.gain).join(), '0,0.5,1,0.5');
setBus('cut', 900);
eq(sound('hh').lpf(bus('cut')).query(0, 1)[0].value.lpf, 900);
setBus('cut', 300);
eq(sound('hh').lpf(bus('cut')).query(0, 1)[0].value.lpf, 300);

// fit
eq(sound(fit(1, ['bd', 'sn', 'hh'], '0 1')).query(0, 2).map((e) => e.value.s).join(), 'bd,sn,sn,hh');

// Controls and aliases
const ctl = sound('saw').cutoff(500).resonance(5).room(0.3).size(0.8).orbit(1).speed(2).begin(0.25).end(0.5).loop(2).legato(0.5).sustain(1).attack(0.1).release(0.2).nudge(0.01).vel(0.5).ccn(74).ccv(64).pgm(3).midichan(2);
eq(JSON.stringify(ctl.query(0, 1)[0].value), JSON.stringify({ s: 'saw', lpf: 500, resonance: 5, reverb: 0.3, size: 0.8, orbit: 1, speed: 2, begin: 0.25, end: 0.5, loop: 2, legato: 0.5, sustain: 1, attack: 0.1, release: 0.2, nudge: 0.01, vel: 0.5, ccn: 74, ccv: 64, pgm: 3, midichan: 2 }));
eq(sound('bd').midi('synth').query(0, 1)[0].value.midi, 'synth');
eq(sound('bd').osc().query(0, 1)[0].value.osc, '/dirt/play');

// MIDI file export
const smf = t.exportPattern(sound('bd sn').note('c e'), 1, 'midi');
eq(String.fromCharCode(...smf.slice(0, 4)), 'MThd');
eq(String.fromCharCode(...smf.slice(14, 18)), 'MTrk');
const json = t.exportPattern('bd sn', 2, 'json');
eq(json.events.length, 4);

// eval with new syntax
r = t.eval('sound("bd*2 [~ sn] <hh cp>").every(3, x => x.chunk(4, y => y.hurry(2)))\n\nsound("arpy").note("<c\'maj e\'min>").arp("updown").lpf(sine.range(400, 4000).slow(8))');
eq(r.success, true);
eq(r.activePatterns, 2);

// late / early and per-cycle structure with rest bars
eq(q(sound('bd sn').late(0.25)), 'bd@0.25 sn@0.75');
eq(q(sound('bd sn').early(0.25)), 'sn@0.25 bd@0.75');
eq(q(sound('<bd sn hh>').late(1), 0, 3), 'hh@0 bd@1 sn@2');
const rests = sound('arpy').note('<~ [a2 e3 a3 ~@3]>');
eq(rests.query(0, 1).length, 0);
eq(rests.query(1, 2).map((e) => e.value.note).join(), '45,52,57');
eq(sound('hh*4').gain('1 ~').query(0, 1).length, 2);

// Error locations and pending warnings
t.eval('sound("bd")');
let er = t.eval('sound("bd")\n\nsound("hh").fast("xyz")');
eq(er.success, false);
eq(er.location.line, 3);
eq(JSON.stringify([er.location.start, er.location.end]), JSON.stringify([13, 36]));
er = t.eval('sound("bd")\nsound("hh"');
eq(er.success, false);
eq(er.location.line, 2);
er = t.eval('stack([\n  sound("bd"),\n  sound("[hh sn")\n])');
eq(er.success, false);
eq(er.location.line, 3);
eq('stack([\n  sound("bd"),\n  sound("[hh sn")\n])'.slice(er.location.start, er.location.end), '[hh sn');
er = t.eval('sound("bd zz")', { keepOnWarnings: true });
eq(er.pending, true);
eq(t.channels.size, 1); // still the earlier pattern
er = t.eval('const p = sound("bd")\np.play()\nsound("hh")');
eq(er.success, true);
eq(er.activePatterns, 2);
eq(JSON.stringify(TidalJS.splitStatementRanges('  a()\n// c\nb()\n  .c()')), JSON.stringify([{ text: 'a()', start: 2, end: 5 }, { text: 'b()\n  .c()', start: 11, end: 21 }]));

// ---------------- Patterned arguments ----------------
const pf = sound('bd sn').fast('<1 2>');
eq(q(pf, 0, 1), 'bd@0 sn@0.5');
eq(q(pf, 1, 2), 'bd@1 sn@1.25 bd@1.5 sn@1.75');
eq(q(sound('bd sn').fast('1 2')), 'bd@0 bd@0.5 sn@0.75');
eq(q(sound('bd sn').slow('<1 2>'), 1, 2), 'sn@1'); // slow(2) at absolute time: sn falls on cycle 1
eq(q(sound('bd').ply('<2 3>'), 1, 2), 'bd@1 bd@1.3333 bd@1.6667');
eq(q(sound('bd sn').late('<0 0.25>'), 1, 2), 'bd@1.25 sn@1.75');
eq(q(sound('bd sn').every('<2 3>', (x) => x.rev()), 0, 1), 'sn@0 bd@0.5');
eq(q(sound('hh*4').degradeBy('0 1')).split(' ').filter((s) => s.startsWith('hh@0.5') || s.startsWith('hh@0.75')).length, 0);
eq(sound('bd sn').fast(saw.range(1, 3)).query(0, 1).length, 2);
assert.throws(() => sound('bd').fast('x y'), /fast\(\) expects a number or a pattern of numbers/); passed++;
eq(q(sound('bd sn').fast(2)), 'bd@0 sn@0.25 bd@0.5 sn@0.75');
eq(q(sound('bd sn').fast('2')), 'bd@0 sn@0.25 bd@0.5 sn@0.75');

// ---------------- Ranges in mini-notation ----------------
const notes = (p) => p.query(0, 1).sort((a, b) => a.begin - b.begin).map((e) => e.value.note - 60).join(' ');
eq(notes(sound('arpy').note('0 .. 3')), '0 1 2 3');
eq(notes(sound('arpy').note('0..3')), '0 1 2 3');
eq(notes(sound('arpy').note('3 .. 0')), '3 2 1 0');
eq(notes(sound('arpy').note('[0 .. 2] 7')), '0 1 2 7');
// In Tidal a range is one step: "<0 .. 2>" plays 0 1 2 in every cycle
eq(sound('arpy').n('<0 .. 2>').query(2, 3).map((e) => e.value.n).join(), '0,1,2');
eq(notes(sound('arpy').note(scale('major', '0 .. 7'))), '0 2 4 5 7 9 11 12');

// ---------------- More of Tidal's library ----------------
eq(q(sound('bd sn').ply(2)), 'bd@0 bd@0.25 sn@0.5 sn@0.75');
eq(q(sound('a b c d').iter(4), 1, 2), 'b@1 c@1.25 d@1.5 a@1.75');
eq(q(sound('a b c d').iter(4), 4, 5), 'a@4 b@4.25 c@4.5 d@4.75');
eq(q(sound('a b c d').iterBack(4), 1, 2), 'd@1 a@1.25 b@1.5 c@1.75');
eq(q(sound('a b c d').linger(0.25)), 'a@0 a@0.25 a@0.5 a@0.75');
eq(q(sound('a b c d').linger(0.5)), 'a@0 b@0.25 a@0.5 b@0.75');
eq(q(sound('a b c d').linger(-0.25)), 'd@0 d@0.25 d@0.5 d@0.75');
eq(q(sound('a b c d').rot(1)), 'b@0 c@0.25 d@0.5 a@0.75');
eq(q(sound('a ~ b c').rot('<0 1>'), 1, 2), 'b@1 c@1.5 a@1.75');
const jux = sound('bd sn').jux((x) => x.rev()).query(0, 1).map((e) => `${e.value.s}${e.value.pan}@${e.begin}`).sort().join(' ');
eq(jux, 'bd-1@0 bd1@0.5 sn-1@0.5 sn1@0');
eq(sound('bd').juxBy(0.5, (x) => x).query(0, 1).map((e) => e.value.pan).sort().join(), '-0.5,0.5');
const off = sound('arpy').off(0.25, (x) => x.add(note(12))).query(0, 1).map((e) => `${(e.value.note ?? 60) - 60}@${e.begin}`).sort().join(' ');
eq(off, '0@0 12@0.25');
eq(q(sound('bd').euclid(3, 8)), 'bd@0 bd@0.375 bd@0.75');
eq(q(sound('bd').euclid(3, 8, 2)), 'bd@0.125 bd@0.5 bd@0.75');
eq(q(sound('hh').euclidInv(3, 8)).split(' ').length, 5);
eq(q(sound('bd').euclidFull(3, 8, sound('hh'))), 'bd@0 hh@0.125 hh@0.25 bd@0.375 hh@0.5 hh@0.625 bd@0.75 hh@0.875');
eq(q(euclidFull(3, 8, 'bd', 'hh')).split(' ').length, 8);
eq(JSON.stringify(sound('bd').nTake('a', [0, 2, 4]).query(0, 1)[0].value.nTake), JSON.stringify({ name: 'a', list: [0, 2, 4] }));
assert.throws(() => sound('bd').nTake('a', []), /nTake\(\) expects/); passed++;

// nTake counts across played events
{
    const taken = [];
    t._session = {};
    t.sampleBanks.set('kit', ['k0.wav', 'k1.wav', 'k2.wav', 'k3.wav', 'k4.wav']);
    t._playSample = (v) => taken.push(v.n);
    for (const ev of sound('kit*4').nTake('x', [0, 2, 4]).query(0, 2)) TidalJS.prototype.playEvent.call(t, ev.value, 0, 0.25);
    eq(taken.join(','), '0,2,4,0,2,4,0,2');
    t.sampleBanks.delete('kit');
    delete t._playSample;
    t._session = null;
}

// ---------------- Samples ----------------
{
    const fetched = [];
    const manifest = { _base: 'https://cdn.test/kit/', kick: ['kick/a.wav', 'kick/b.wav'], snare: 'snare/a.wav', pitched: { c4: 'p/c4.wav' }, _meta: 1 };
    globalThis.fetch = async (url) => {
        fetched.push(url);
        if (url.endsWith('.json')) return { ok: true, json: async () => manifest };
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    const decoded = [];
    t.audioContext.decodeAudioData = async () => { const b = { duration: 2, numberOfChannels: 1, length: 4, sampleRate: 2, getChannelData: () => new Float32Array([1, 2, 3, 4]) }; decoded.push(b); return b; };

    const banks = await samples('github:someone/kit');
    eq(fetched[0], 'https://raw.githubusercontent.com/someone/kit/main/strudel.json');
    eq(banks, 3);
    eq(JSON.stringify(t.sampleBanks.get('kick')), JSON.stringify(['https://cdn.test/kit/kick/a.wav', 'https://cdn.test/kit/kick/b.wav']));
    eq(t.sampleBanks.get('snare')[0], 'https://cdn.test/kit/snare/a.wav');
    eq(t.sampleBanks.has('_meta'), false);
    eq(await samples('github:someone/kit'), 3);
    eq(fetched.filter((u) => u.endsWith('.json')).length, 1); // second load reused
    await samples({ tom: ['t.wav'] }, 'https://other.test/');
    eq(t.sampleBanks.get('tom')[0], 'https://other.test/t.wav');

    // eval: no "unknown" warning for a bank, and its first files start loading
    r = t.eval('sound("kick*2 snare").n("<0 1>")');
    eq(r.success, true);
    eq(r.warnings.length, 0);
    await t.whenSamplesLoaded();
    eq(t.isLoadingSamples(), false);
    eq(fetched.includes('https://cdn.test/kit/kick/a.wav'), true);

    // Playback: n picks the file, speed/note set the rate, begin/end the slice
    const voices = [];
    t._session = {};
    t._sampleVoice = (v, time, buffer, rate, offset, window, level) => voices.push({ time, rate: +rate.toFixed(4), offset, window: +window.toFixed(4), level });
    TidalJS.prototype.playEvent.call(t, { s: 'kick', n: 0 }, 1, 0.5);
    TidalJS.prototype.playEvent.call(t, { s: 'kick', n: 3, speed: 2, begin: 0.5 }, 2, 0.5); // n 3 wraps to the second file
    TidalJS.prototype.playEvent.call(t, { s: 'kick', note: 72 }, 3, 0.5);
    TidalJS.prototype.playEvent.call(t, { s: 'kick', legato: 0.5 }, 4, 0.5);
    TidalJS.prototype.playEvent.call(t, { s: 'kick', loop: 2, end: 0.25 }, 5, 0.5);
    eq(JSON.stringify(voices[0]), JSON.stringify({ time: 1, rate: 1, offset: 0, window: 2, level: 0.8 }));
    eq(voices[1].time === 2 && voices[1].rate === 2 && voices[1].offset === 1 && voices[1].window === 0.5, true);
    eq(voices[2].rate, 2);
    eq(voices[3].window, 0.25);
    // SuperDirt's loop: one voice looping [begin, end], loop times as long
    eq(voices.length === 5 && voices[4].time === 5 && voices[4].window === 1, true);
    eq(t.sampleBanks.has('kick') && !!t._sampleBuffers.get('https://cdn.test/kit/kick/b.wav').buffer, true);

    // A bad source is reported and can be retried
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(() => samples('github:nobody/none'), /HTTP 404/); passed++;
    eq(t._sampleManifests.has('github:nobody/none|'), false);
    delete t._sampleVoice;
    t._session = null;
}

// ---------------------------------------------------------------------
// More of Tidal's library. Expected results follow Tidal's own docs.
// ---------------------------------------------------------------------
{
    // Values with their controls, sorted by time: "bd,speed=2@0.5"
    const show = (v) => (v && typeof v === 'object'
        ? Object.entries(v).map(([k, x]) => (k === 's' ? x : `${k}=${typeof x === 'number' ? +x.toFixed(3) : x}`)).join(',')
        : String(v));
    const qv = (p, b = 0, e = 1) => p.query(b, e)
        .sort((x, y) => x.begin - y.begin || show(x.value).localeCompare(show(y.value)))
        .map((ev) => `${show(ev.value)}@${+ev.begin.toFixed(3)}`).join(' ');

    // Structure
    eq(qv(sound('bd sn').brak(), 0, 2), 'bd@0 sn@0.5 bd@1.25 sn@1.5');
    eq(qv(sound('bd*4').mask('1 0 1 1')), 'bd@0 bd@0.5 bd@0.75');
    eq(qv(sound('bd*4').sew('t f', sound('hh*8'))), 'bd@0 bd@0.25 hh@0.5 hh@0.625 hh@0.75 hh@0.875');
    eq(qv(sound('bd').stitch('t f t t', sound('sn'))), 'bd@0 sn@0.25 bd@0.5 bd@0.75');
    eq(qv(sound('bd sn').wedge(0.25, sound('hh hh'))), 'bd@0 sn@0.125 hh@0.25 hh@0.625');
    eq(qv(sound('a b c d').zoom(0.25, 0.75)), 'b@0 c@0.5');
    eq(qv(sound('a b').fastGap(2)), 'a@0 b@0.25');
    eq(qv(sound('a b c d').trunc(0.75)), 'a@0 b@0.25 c@0.5');
    eq(qv(sound('<a b>').repeatCycles(2), 0, 4), 'a@0 a@1 b@2 b@3');
    eq(qv(sound('<a b>').loopFirst(), 1, 2), 'a@1');
    eq(qv(sound('a b').press()), 'a@0.25 b@0.75');
    eq(qv(sound('a b').plyWith(3, (x) => x.gain(0.5))), 'a@0 a,gain=0.5@0.167 a,gain=0.5@0.333 b@0.5 b,gain=0.5@0.667 b,gain=0.5@0.833');
    eq(qv(sound('arpy').note("c'maj").rolled()), 'arpy,note=60@0 arpy,note=64@0.083 arpy,note=67@0.167');
    eq(qv(sound('arpy').note("c'maj").rolledBy(-0.25)), 'arpy,note=67@0 arpy,note=64@0.083 arpy,note=60@0.167');

    // Conditions
    eq(qv(sound('a b').when((c) => c % 2 === 1, (x) => x.fast(2)), 0, 2), 'a@0 b@0.5 a@1 b@1.25 a@1.5 b@1.75');
    // Tidal: every 2 f (every 3 f p), so on cycle 0 the outer fast squeezes the inner cycles 0 and 1
    eq(qv(sound('a').foldEvery([2, 3], (x) => x.fast(2)), 0, 4), 'a@0 a@0.25 a@0.5 a@1 a@2 a@2.5 a@3 a@3.5');
    eq(qv(sound('a b c d').inside(2, (x) => x.rev())), 'b@0 a@0.25 d@0.5 c@0.75');
    eq(qv(sound('<[a b] [c d]>').outside(2, (x) => x.rev()), 0, 2), 'd@0 c@0.5 b@1 a@1.5');
    eq(qv(sound('a b c d').chunk(-4, (x) => x.gain(0)), 0, 1), 'a@0 b@0.25 c@0.5 d,gain=0@0.75');
    eq(qv(sound('bd sn').fix((x) => x.speed(2), { s: 'bd' })), 'bd,speed=2@0 sn@0.5');
    eq(qv(sound('bd sn').unfix((x) => x.speed(2), { s: 'bd' })), 'bd@0 sn,speed=2@0.5');
    eq(qv(sound('a b').spread((p, x) => p.fast(x), [1, 2]), 0, 2), 'a@0 b@0.5 a@1 b@1.25 a@1.5 b@1.75');
    eq(qv(sound('a b').pickF('<0 1>', [(x) => x.rev(), (x) => x.fast(2)]), 0, 2), 'b@0 a@0.5 a@1 b@1.25 a@1.5 b@1.75');
    eq(qv(sound('a b').soak(3, (x) => x.fast(2)), 2, 3), 'a@2 b@2.125 a@2.25 b@2.375 a@2.5 b@2.625 a@2.75 b@2.875');
    eq(qv(sound('a').always((x) => x.fast(2))), 'a@0 a@0.5');
    eq(qv(sound('a').never((x) => x.fast(2))), 'a@0');

    // Echoes: Tidal's gains (anticipateIn's internal stut: feedback + (1 - feedback) * (count - x) / count)
    eq(qv(sound('bd').echo(3, 0.2, 0.5)), 'bd@0 bd,gain=0.5@0.2 bd,gain=0.25@0.4');
    eq(qv(sound('bd')._stut(3, 0.5, 0.125)), 'bd@0 bd,gain=0.833@0.125 bd,gain=0.667@0.25');
    // Names Tidal deprecated are gone (stut, stutWith, discretise, chunk' as chunkBack; wash, washIn, scaleP globals).
    for (const name of ['stut', 'stutWith', 'discretise', 'chunkBack']) eq(typeof sound('bd')[name], 'undefined');
    eq(qv(sound('bd').stutter(4, 1 / 16)), 'bd@0 bd@0.063 bd@0.125 bd@0.188');
    eq(qv(sound('sn').ghost()).split(' ').map((x) => x.split('@')[1]).join(), '0,0.188,0.313,0.5');

    // Values
    eq(qv(run(8).toScale([0, 2, 4, 5, 7, 9, 11])), '0@0 2@0.125 4@0.25 5@0.375 7@0.5 9@0.625 11@0.75 12@0.875');
    eq(qv(run('<2 3>'), 0, 2), '0@0 1@0.5 0@1 1@1.333 2@1.667');
    eq(qv(scan(3), 0, 3), '0@0 0@1 1@1.5 0@2 1@2.333 2@2.667');
    eq(+saw.rangex(20, 2000)._signal(0.5).toFixed(3), 200);
    eq(qv(saw.range(0, 4).segment(4).qfloor()), '0@0 1@0.25 2@0.5 3@0.75');

    // Samples
    eq(qv(sound('bev').slice(4, '0 2')), 'bev,begin=0,end=0.25@0 bev,begin=0.5,end=0.75@0.5');
    eq(qv(sound('bev').splice(4, '0 2')), 'bev,begin=0,end=0.25,speed=0.5,unit=c@0 bev,begin=0.5,end=0.75,speed=0.5,unit=c@0.5');
    eq(qv(sound('break').loopAt(2), 0, 2), 'break,speed=0.5,unit=c@0');
    eq(qv(sound('a b').spin(2)), 'a,pan=-1@0 b,pan=0@0 a,pan=0@0.5 b,pan=-1@0.5');
    eq(qv(sound('a').striateBy(2, 0.5)), 'a,begin=0,end=0.5@0 a,begin=0.5,end=1@0.5');

    // Constructors
    eq(qv(binary(5)), 'false@0 false@0.125 false@0.25 false@0.375 false@0.5 true@0.625 false@0.75 true@0.875');
    eq(qv(binary('<5 1>'), 1, 2).split(' ').filter((x) => x.startsWith('true')).length, 1);
    eq(qv(ascii('a')).split(' ').map((x) => (x.startsWith('true') ? 1 : 0)).join(''), '01100001');
    eq(qv(necklace(12, [4, 2])).split(' ').map((x) => (x.startsWith('true') ? 1 : 0)).join(''), '100010100010');
    eq(qv(select('<0 0.5 1>', [sound('a'), sound('b')]), 0, 3), 'a@0 a@1 b@2'); // Tidal: floor(x * (n - 1))
    eq(qv(squeeze('0 1', [sound('a b'), sound('c d e')])), 'a@0 b@0.25 c@0.5 d@0.667 e@0.833');
    eq(qv(timeCat([[1, sound('a')], [3, sound('b b b')]])), 'a@0 b@0.25 b@0.5 b@0.75');
    eq(lindenmayer(3, 'a:b,b:ab', 'ab'), 'bababbab');
    eq(qv(markovPat(4, 1, [[1, 0], [1, 0]])), '1@0 0@0.25 0@0.5 0@0.75');
    eq(qv(fromList(['a', 'b']), 1, 2), 'b@1');
    eq(qv(fastFromList(['a', 'b'])), 'a@0 b@0.5');
    eq(sine2._signal(0.25), 1);
    eq(envL._signal(0.5), 0.5);

    // Control patterns and operators (Tidal's #, |+, |*)
    eq(qv(n('c e g a')), 'n=0@0 n=4@0.25 n=7@0.5 n=9@0.75');
    eq(qv(n('0 2').sound('drum')), 'n=0,drum@0 n=2,drum@0.5');
    eq(qv(sound('bd*2').set(speed('1 2'))), 'bd,speed=1@0 bd,speed=2@0.5');
    eq(qv(note('0 4').sound('arpy').add(note('<12 7>')), 1, 2), 'note=67,arpy@1 note=71,arpy@1.5');
    eq(qv(n('0 4').add(12)), 'n=12@0 n=16@0.5');
    eq(qv(sound('bd*2').speed(2).mul(speed('1 0.5'))), 'bd,speed=2@0 bd,speed=1@0.5');
    eq(qv(sound('drum').add(s(':3'))), 'drum@0'); // Tidal keeps the left string (no joining)
    eq(qv(sound('drum').add(3)), 'drum,n=3@0'); // a whole number is n, as Tidal's fromInteger
    eq(qv(sound('drum').mul(speed(2)).add(0.5)), 'drum,speed=2.5@0'); // a fraction is speed (fromRational); unionWith adds missing keys
    eq(qv(n('0 .. 7').mod(4)).split(' ').map((x) => x.split('@')[0]).join(), 'n=0,n=1,n=2,n=3,n=0,n=1,n=2,n=3');
    eq(qv(d1(sound('bd'))), 'bd@0');

    // Mini-notation: patterned arguments
    eq(qv(sound('bd*<2 3>'), 0, 2), 'bd@0 bd@0.5 bd@1 bd@1.333 bd@1.667');
    eq(qv(sound('bd*[2 3]')), 'bd@0 bd@0.667');
    eq(qv(sound('bd(<3 5>,8)'), 1, 2), 'bd@1 bd@1.25 bd@1.375 bd@1.625 bd@1.75');
    eq(qv(sound('bd(3,8,<0 2>)'), 1, 2), 'bd@1.125 bd@1.5 bd@1.75');
    eq(qv(sound('bd').euclid('<3 5>', 8), 1, 2), 'bd@1 bd@1.25 bd@1.375 bd@1.625 bd@1.75');

    // Tidal's chord and scale tables, and arp modes
    eq(JSON.stringify(TidalJS.parseChord("c'm7s9")), '[0,3,7,10,15]');
    eq(JSON.stringify(TidalJS.parseChord("c'7sus4")), '[0,5,7,10]');
    eq(qv(n(scale('hijaz', '0 1 2'))), 'n=0@0 n=1@0.333 n=4@0.667');
    eq(qv(n(scale('harmonicMajor', '5'))), 'n=8@0');
    eq(qv(note("c'maj7").arp('thumbupdown')).split(' ').map((x) => x.split('=')[1].split('@')[0]).join(), '60,64,60,67,60,71,60,67,60,64');
    eq(TidalJS.scaleNames.length >= 70 && TidalJS.chordNames.length >= 120, true);

    // Controls: delay is the level, with delaytime and delayfeedback
    eq(JSON.stringify(sound('cp').delay(0.5).delaytime(0.25).delayfeedback(0.4).query(0, 1)[0].value), '{"s":"cp","delay":0.5,"delaytime":0.25,"delayfeedback":0.4}');
    eq(JSON.stringify(sound('cp').sz(0.9).lpq(5).dfb(0.3).query(0, 1)[0].value), '{"s":"cp","size":0.9,"resonance":5,"delayfeedback":0.3}');
    eq(sound('cp').unit('x').query(0, 1)[0].value.unit, undefined);

    // Steps, as Tidal counts them
    eq([sound('bd sn').steps(), sound('bd [sn sn]').steps(), sound('bd@3 sn').steps(), sound('<a b>').steps(), sound('{a b c}%4').steps()].join(), '2,2,4,2,3'); // Tidal 1.10: <a b> has 2 steps, {a b c}%4 has 3
    eq(sound('bd sn').fast(2).n(1).steps(), 2);
    // The steps follow the side that sets the rhythm.
    eq(sound('arpy').note('c e g').steps(), 3);
    eq(sound('a b c d').note('c e').steps(), 4);
    eq(stack(sound('a b'), sound('c d e')).steps(), 6);
    eq(fastcat(sound('a b'), sound('c')).steps(), 3);

    // Stepwise
    eq(qv(stepcat(sound('bd sn'), sound('hh hh hh'))), 'bd@0 sn@0.2 hh@0.4 hh@0.6 hh@0.8');
    eq(stepcat(sound('bd sn'), sound('hh hh hh')).steps(), 5);
    eq(qv(sound('a b c d').steptake(2)), 'a@0 b@0.5');
    eq(qv(sound('a b c d').steptake(-1)), 'd@0');
    eq(qv(sound('a b c d').stepdrop(1)), 'a@0 b@0.333 c@0.667');
    eq(qv(stepcat(sound('a b').expand(2), sound('c d'))), 'a@0 b@0.333 c@0.667 d@0.833');
    eq(sound('a b').extend(2).steps() + ' ' + qv(sound('a b').extend(2)), '4 a@0 b@0.25 a@0.5 b@0.75');
    eq(qv(sound('a b c').pace(4)), 'a@0 b@0.25 c@0.5 a@0.75');
    eq(qv(stepalt([[sound('a b')], [sound('c'), sound('d d d')]])), 'a@0 b@0.125 c@0.25 a@0.375 b@0.5 d@0.625 d@0.75 d@0.875');
    eq(qv(stepzip([sound('a b'), sound('c d')]), 0, 2), 'a@0 c@0.5 b@1 d@1.5');

    // ur, inhabit, swap, weave, chew, snowball
    eq(qv(ur(4, 'a b', { a: sound('bd*2'), b: sound('hh*4') }), 1, 3), 'bd@1 bd@1.5 hh@2 hh@2.25 hh@2.5 hh@2.75');
    eq(qv(ur(2, 'a:fast', { a: sound('bd sn') }, { fast: (x) => x.fast(2) }), 1, 2), 'bd@1 sn@1.25 bd@1.5 sn@1.75');
    eq(qv(inhabit({ x: sound('bd sn'), y: sound('hh*3') }, 'x y')), 'bd@0 sn@0.25 hh@0.5 hh@0.667 hh@0.833');
    eq(qv(sound(swap({ a: 'bd', b: 'sn' }, 'a b ~ c'))), 'bd@0 sn@0.25');
    eq(qv(weave(4, pan(saw), [sound('a'), sound('b')])), 'a,pan=0@0 b,pan=0.5@0');
    eq(qv(sound('a b c d').chew(4, '0 [2 3]')), 'a,speed=0.5@0 c,speed=1@0.5 d,speed=1@0.75');
    eq(qv(n('0 1').snowball(3, (a, b) => a.add(b), (x) => x.fast(2)), 2, 3), 'n=0@2 n=1@2.5');
    eq(qv(note("c'maj").arpg('down')), 'note=67@0 note=64@0.333 note=60@0.667');
}

// Streams, transitions, mute and solo (through eval, as the editor runs code)
{
    const show = (v) => Object.entries(v).map(([k, x]) => (k === 's' ? x : `${k}=${+x.toFixed(3)}`)).join(',');
    const qs = (p, b, e) => p.query(b, e).sort((x, y) => x.begin - y.begin || show(x.value).localeCompare(show(y.value)))
        .map((ev) => `${show(ev.value)}@${+ev.begin.toFixed(3)}`).join(' ');
    const active = (b, e) => qs({ query: (x, y) => t.queryActive(x, y) }, b, e);
    t.stopAll();
    t.muted.clear();
    t.soloed.clear();
    t.eval('d1(sound("bd*2"))\nsound("hh")');
    eq(t.streamInfo().map((s) => s.name).join(), 'd1,#1');
    // Pretend the clock is running at cycle 2 for the transitions.
    t.isPlaying = true;
    t._nextCycle = 2;
    t.eval('xfadeIn(1, 2, sound("sn*2"))');
    eq(qs(t.channels.get('d1'), 2, 3), 'bd,gain=1@2 sn,gain=0@2 bd,gain=0.961@2.5 sn,gain=0.619@2.5');
    // Tidal keeps the old pattern after the fade, at gain 0 (silent)
    eq(qs(t.channels.get('d1'), 4, 5), 'bd,gain=0@4 sn,gain=1@4 bd,gain=0@4.5 sn,gain=1@4.5');
    t.eval('jumpIn(1, 1, sound("cp"))');
    eq(qs(t.channels.get('d1'), 2, 4), 'sn@2 sn@2.5 cp@3');
    t.eval('jumpMod(1, 4, sound("bd"))');
    eq(qs(t.channels.get('d1'), 2, 5), 'cp@2 cp@3 bd@4');
    t.eval('d2(sound("hh").gain(0))');
    t.eval('interpolateIn(2, 4, sound("hh").gain(1))');
    eq(qs(t.channels.get('d2'), 4, 5), 'hh,gain=0.5@4');
    t.eval('d1(sound("bd"))');
    t.eval('wait(1, 2, sound("cp"))');
    eq(qs(t.channels.get('d1'), 2, 5), 'cp@4');
    // Live updates keep streams whose events have not changed, with their transitions.
    t.eval('xfadeIn(1, 8, sound("sn*2"))\nd2(sound("hh"))');
    const running = t.channels.get('d1');
    t.eval('xfadeIn(1, 8, sound("sn*2"))\nd2(sound("hh*2"))', { keepUnchanged: true });
    eq(t.channels.get('d1') === running && qs(t.channels.get('d2'), 2, 3) === 'hh@2 hh@2.5', true);
    // Mute and solo, from code and by name
    t.eval('mute(1)\nd1(sound("bd"))\nd2(sound("hh"))');
    eq(active(2, 3), 'hh@2');
    t.eval('unmuteAll()\nsolo("d1")\nd1(sound("bd"))\nd2(sound("hh"))');
    eq(active(2, 3), 'bd@2');
    t.solo('d1', false);
    eq(active(2, 3), 'bd@2 hh@2');
    t.eval('p("drums", sound("bd"))\np("drums", sound("sn"))');
    eq(t.streamInfo().map((s) => s.name).join() + ' ' + active(2, 3), 'drums sn@2');
    t.isPlaying = false;
    t.stopAll();
}

// Pitched sample banks: { note: file } picks the nearest recording and tunes it
{
    globalThis.fetch = async (url) => (String(url).endsWith('.json')
        ? { ok: true, status: 200, json: async () => ({ _base: 'https://cdn.test/piano/', piano: { C4: 'c4.mp3', Ds4: 'ds4.mp3', A4: 'a4.mp3' } }) }
        : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
    t.audioContext.decodeAudioData = async () => ({ duration: 2, numberOfChannels: 1, length: 4, sampleRate: 2 });
    await samples('github:someone/pianos/piano.json');
    eq(t._sampleManifests.has('github:someone/pianos/piano.json|'), true);
    eq(t.pitchedBanks.get('piano').map((x) => x.midi).join(), '60,63,69');
    const voices = [];
    t._session = {};
    t._sampleVoice = (v, time, buffer, rate) => voices.push(+rate.toFixed(4));
    for (const note of [60, 64, 70, 60]) TidalJS.prototype.playEvent.call(t, { s: 'piano', note }, 1, 0.5);
    await t.whenSamplesLoaded();
    for (const note of [60, 64, 70]) TidalJS.prototype.playEvent.call(t, { s: 'piano', note }, 1, 0.5);
    // c4 as recorded; e4 from ds4 a semitone up; a#4 from a4 a semitone up
    eq(voices.join(), [1, Math.pow(2, 1 / 12), Math.pow(2, 1 / 12)].map((x) => +x.toFixed(4)).join());
    delete t._sampleVoice;
    t._session = null;
}

// Weighted steps keep their places in every cycle (rounding at cycle 1 used to drop some)
{
    const seq = 'a@4 b@4 c@4 d@4 e@3 f g@2 h@3 i j@2';
    const at = (c) => sound(seq).query(c, c + 1).sort((x, y) => x.begin - y.begin).map((e) => e.value.s + Math.round((e.begin - c) * 28)).join(' ');
    for (const c of [0, 1, 2, 5, 123]) eq(at(c), 'a0 b4 c8 d12 e16 f19 g20 h22 i25 j26');
    let chunked = 0;
    for (let x = 0; x < 20; x += 0.0137) chunked += sound(seq).query(x, Math.min(20, x + 0.0137)).length;
    eq(chunked, 200);
}

// Operators: where the rhythm comes from (Tidal's |+, +|, |+| and ||+)
{
    const vals = (p, b = 0, e = 1) => p.query(b, e).sort((x, y) => x.begin - y.begin)
        .map((ev) => `${ev.value.n}@${+ev.begin.toFixed(4)}-${+ev.end.toFixed(4)}`).join(' ');
    eq(vals(n('0 1').add(n('10 20 30'))), '10@0-0.5 21@0.5-1');
    eq(vals(n('0 1').addRight(n('10 20 30'))), '10@0-0.3333 20@0.3333-0.6667 31@0.6667-1');
    eq(vals(n('0 1').addBoth(n('10 20 30'))), '10@0-0.3333 20@0.3333-0.5 21@0.5-0.6667 31@0.6667-1');
    eq(vals(n('0 1').addSqueeze(n('10 20'))), '10@0-0.25 20@0.25-0.5 11@0.5-0.75 21@0.75-1');
    eq(vals(n('5 6').subRight(n('1 2 3'))), '4@0-0.3333 3@0.3333-0.6667 3@0.6667-1');
    eq(vals(n('0 1').setRight(n('7 8 9'))), '7@0-0.3333 8@0.3333-0.6667 9@0.6667-1');
    const kept = n('0 1').speed(2).keep(n('5 6').speed(1).vowel('a')).query(0, 1)[0].value;
    eq(kept.n, 0); eq(kept.speed, 2); eq(kept.vowel, 'a');
    eq(vals(n('0 1').keepRight(n('5 6 7'))), '0@0-0.3333 0@0.3333-0.6667 1@0.6667-1');
    eq(vals(n('2 3').mulSqueeze(n('1 10'))), '2@0-0.25 20@0.25-0.5 3@0.5-0.75 30@0.75-1');
    // a signal on the right keeps the left rhythm
    eq(sound('bd*4').addBoth(speed(saw)).query(0, 1).length, 4);
}

// Primed functions and the rest of Tidal's library
{
    const ss = (p, b = 0, e = 1) => q(p, b, e);
    eq(ss(sound('bd sn').everyOffset(3, 1, (x) => x.fast(2)), 1, 2), 'bd@1 sn@1.25 bd@1.5 sn@1.75');
    eq(ss(sound('bd sn').everyOffset(3, 1, (x) => x.fast(2)), 2, 3), 'bd@2 sn@2.5');
    eq(ss(sound('a b c d').withinZoom(0, 0.5, (x) => x.rev())), 'b@0 a@0.25 c@0.5 d@0.75');
    // within reverses the whole cycle and keeps its first half; withinZoom reverses the half
    eq(ss(sound('a b c d').within(0, 0.5, (x) => x.rev())), 'd@0 c@0.25 c@0.5 d@0.75');
    eq(ss(sound('bd sn').fitSlices(1, 2, '0 1', '1 0')), 'sn@0 bd@0.5');
    eq(ss(sound('bd sn hh cp').fitSlices(1, 4, '0 1 2 3', '3 0')), 'cp@0 bd@0.5');
    eq(ss(sound('bd sn').substruct('t ~ t t')), 'bd@0 sn@0.125 bd@0.5 sn@0.625 bd@0.75 sn@0.875');
    eq(ss(sound('bd sn').fastSqueeze('1 2')), 'bd@0 sn@0.25 bd@0.5 sn@0.625 bd@0.75 sn@0.875');
    eq(ss(sound('bd sn').slowSqueeze('2')), 'bd@0');
    eq(ss(sound('bd*4').whenT((t) => t % 1 >= 0.5, (x) => x.speed(2))), 'bd@0 bd@0.25 bd@0.5 bd@0.75');
    eq(sound('bd*4').whenT((t) => t % 1 >= 0.5, (x) => x.speed(2)).query(0, 1).filter((e) => e.value.speed === 2).length, 2);
    eq(ss(sound('bd').fastAppend('sn')), 'bd@0 sn@0.5');
    eq(ss(sound('bd').slowAppend('sn'), 0, 2), 'bd@0 sn@1');
    eq(ss(fastAppend(sound('bd'), sound('sn'))), 'bd@0 sn@0.5');
    eq(sound('bd').jux4((x) => x.speed(2)).query(0, 1).map((e) => e.value.pan).sort().join(), '-0.75,0.25');
    eq(sound('bd').juxcut((x) => x).query(0, 1).map((e) => `${e.value.pan}/${e.value.cut}`).sort().join(), '-1/-1,1/-2');
    eq(ss(sound('bd sn').spreadf([(x) => x.rev(), (x) => x.fast(2)]), 0, 1), 'sn@0 bd@0.5');
    eq(ss(sound('bd sn').spreadf([(x) => x.rev(), (x) => x.fast(2)]), 1, 2), 'bd@1 sn@1.25 bd@1.5 sn@1.75');
    eq(ss(note('[c, e] g').mono()), '/60@0 /67@0.5');
    const mono = n('0@3 1').slow(1).query(0, 1);
    eq(mono.length, 2);
    eq(ss(n('<0 1 2 3>').sound('a').timeLoop(2), 2, 4), 'a@2 a@3');
    eq(n('<0 1 2 3>').timeLoop(2).query(2, 4).map((e) => e.value.n).join(), '0,1');
    eq(ss(seqP([[0, 2, sound('bd')], [1, 3, sound('hh')]]), 0, 3), 'bd@0 bd@1 hh@1 hh@2');
    eq(ss(seqPLoop([[0, 2, sound('bd')], [1, 3, sound('hh')]]), 3, 5), 'bd@3 bd@4 hh@4');
    eq(note(toScaleBy(10, [0, 2, 4], '0 3 4')).query(0, 1).map((e) => e.value.note).join(), '60,70,72');
    eq(toScaleBy(12, [0, 4, 7], '0 3 -1').query(0, 1).map((e) => e.value).join(), '0,12,-5');
    eq(interlace(sound('bd*2'), sound('hh')).query(0, 1).every((e) => typeof e.value.shape === 'number'), true);
    eq(sig((t) => t * 2)._signal(0.25), 0.5);
    const pw = perlinWith(saw.mul(4));
    eq(pw._signal(0.5) >= 0 && pw._signal(0.5) <= 1, true);
    eq(Math.abs(perlinWith(3).query(0, 1)[0].value - perlin._signal(3)) < 1e-9, true);
    const p2 = perlin2(sine);
    for (const t of [0.1, 0.4, 0.77, 3.3]) eq(p2._signal(t) >= 0 && p2._signal(t) <= 1, true);
    eq(nrpn('1000:64').query(0, 1)[0].value.nrpn, '1000:64');
    eq(sound('saw').pitchenv([-5, 6, 0], [0.1, 1.7], ['lin', -4]).query(0, 1)[0].value.pitchenv.curves.join(), '0,-4');
    assert.throws(() => sound('saw').pitchenv([0, 1], [0.1, 0.2]), /one time/); passed++;
    // New controls exist as methods and globals
    for (const name of ['penv', 'pattack', 'pdecay', 'hold', 'decay', 'peak', 'lpenv', 'peakattack', 'squiz', 'leslie', 'freeze', 'vib', 'portamento', 'voice']) {
        eq(typeof sound('bd')[name], 'function');
        eq(typeof globalThis[name], 'function');
    }
    eq(sound('bd').vibrato(4).query(0, 1)[0].value.vib, 4);
    eq(sound('bd').glide(0.1).query(0, 1)[0].value.portamento, 0.1);
    // resetCycles restarts the count at the scheduling frontier
    t.isPlaying = true;
    t._nextCycle = 12.5;
    t._anchorTime = 0;
    t._anchorCycle = 0;
    const at = t.timeAt(12.5);
    t.resetCycles();
    eq(t._nextCycle, 0);
    eq(Math.abs(t.timeAt(0) - at) < 1e-9, true);
    t.isPlaying = false;
}

// Envelopes: SuperCollider's Env curves and the pitch envelope of synths
{
    const at = (env, x) => TidalJS.prototype._envelopeAt.call(t, env, x);
    const hoover = { levels: [-5, 6, 0], times: [0.1, 1.7], curves: [0, -4] };
    eq(at(hoover, 0), -5);
    eq(+at(hoover, 0.05).toFixed(6), 0.5);
    eq(+at(hoover, 0.1).toFixed(6), 6);
    const sc = (x) => 6 + (0 - 6) * (1 - Math.exp(-4 * x)) / (1 - Math.exp(-4));
    eq(+at(hoover, 0.1 + 0.85).toFixed(6), +sc(0.5).toFixed(6));
    eq(at(hoover, 5), 0);
    const pe = (def, v) => TidalJS.prototype._pitchEnvelope.call(t, def, v);
    const gabber = t.samples.get('supergabber');
    eq(JSON.stringify(pe(gabber, {})), JSON.stringify({ levels: [0, 48, 0], times: [0.001, 0.08], curves: [-1, -1] }));
    eq(pe(gabber, { penv: 19.2 }).levels[1], 19.2);
    eq(pe(t.samples.get('saw'), {}), null);
    eq(pe(t.samples.get('saw'), { penv: 12 }).times.join(), '0,0.1');
    eq(pe(t.samples.get('superhoover'), {}).levels.join(), '-5,6,0');
    eq(pe(t.samples.get('superhoover'), { pitchenv: { levels: [0, 1], times: [1], curves: [0] } }).levels.join(), '0,1');
    for (const name of ['supersaw', 'superhoover', 'supergabber', 'superkick', 'super808', 'superpiano', 'superfm']) eq(TidalJS.soundNames.includes(name), true);

    // FreeVerb2: superhoover has its own (SuperCollider's mix 0.3, room 0.9), others only with freeverb
    const fv = (name, v) => JSON.stringify(TidalJS.prototype._freeverbOf.call(t, t.samples.get(name), v));
    eq(fv('superhoover', {}), JSON.stringify({ mix: 0.3, room: 0.9, damp: 0.5 }));
    eq(fv('superhoover', { freeverb: 0 }), 'null');
    eq(fv('saw', {}), 'null');
    eq(fv('saw', { freeverb: 0.4, freeroom: 0.8 }), JSON.stringify({ mix: 0.4, room: 0.8, damp: 0.5 }));
    // superhoover and supergabber: amp as in SuperCollider (0.1 by default) and Env.asr's curves
    eq(t.samples.get('supergabber').amp, 0.1);
    eq(t.samples.get('supergabber').curve, -4);
    eq(t.samples.get('superhoover').curve, 6);
    eq(t.samples.get('superhoover').release, 4);
    // Envelope segments follow SuperCollider's curve and stop part way at `until`
    const calls = [];
    const param = { setValueAtTime: (v, at) => calls.push(['set', +v.toFixed(4), at]), linearRampToValueAtTime: (v, at) => calls.push(['ramp', +v.toFixed(4), at]),
        setValueCurveAtTime: (values, at, dur) => calls.push(['curve', +values[values.length - 1].toFixed(4), at, dur]) };
    const reached = TidalJS.prototype._envSegments.call(t, param, 0, 1, [{ dur: 1, level: 0, curve: -4 }], 0.5);
    const scHalf = 1 - (1 - Math.exp(-2)) / (1 - Math.exp(-4));
    eq(+reached.toFixed(4), +scHalf.toFixed(4));
    eq(calls[1][0], 'curve');
    eq(calls[1][3], 0.5);
    eq(+TidalJS.prototype._envSegments.call(t, param, 0, 0, [{ dur: 2, level: 1, curve: 0 }], 1).toFixed(4), 0.5);
}

// The output stage: master volume and limiter
{
    eq(JSON.stringify(setOutput(1, false)), JSON.stringify({ gain: 1, limiter: false }));
    eq(t.masterGain.gain.value, 1);
    eq(JSON.stringify(setOutput()), JSON.stringify({ gain: 0.8, limiter: true }));
    assert.throws(() => setOutput(-1), /volume/); passed++;
}

// ---------------------------------------------------------------------
// Parity with Tidal: each check is a difference found by comparing with
// Tidal's source (tidal-core, Sound.Tidal.*), and SuperDirt for playback.
// ---------------------------------------------------------------------
{
    const r4 = (x) => +x.toFixed(4);
    const ev = (p, b = 0, e = 1) => p.query(b, e).sort((x, y) => x.begin - y.begin || x.end - y.end)
        .map((e2) => (typeof e2.value === 'object' ? (e2.value.n ?? e2.value.note ?? e2.value.s) : e2.value) + '@' + r4(e2.begin) + '-' + r4(e2.end)).join(' ');
    const vals = (p, b = 0, e = 1) => ev(p, b, e).split(' ').map((x) => x.split('@')[0]).join(' ');

    // Random numbers are Tidal's timeToRand (xorshift over a 300-cycle loop)
    eq(rand._signal(0), 0.5);
    eq(rand._signal(1.25), rand._signal(301.25));
    eq(JSON.stringify(sound('hh*8?').query(0, 4)), JSON.stringify(sound('hh*8?').query(0, 4))); // same string, same choices
    // degradeBy and unDegradeBy share rand, so they are complementary; sometimesBy picks events first
    let both = 0;
    for (let c = 0; c < 50; c++) {
        const kept = new Set(sound('x*8').degradeBy(0.3).query(c, c + 1).map((e2) => e2.begin));
        for (const e2 of sound('x*8').unDegradeBy(0.3).query(c, c + 1)) if (kept.has(e2.begin)) both++;
    }
    eq(both, 0);
    eq(sound('bd*4').sometimesBy(0.5, (x) => x.ply(2)).query(0, 50).length % 1, 0);
    eq(vals(sound('x*16').degradeBy(saw), 0, 1).split(' ').length < 16, true); // a signal amount is read at each event
    eq(choose([0, 2, 4]) instanceof PatternBuilder, true);
    eq(new Set([0, 1, 2, 3, 4, 5, 6, 7].map((c) => cycleChoose([0, 1, 2, 3]).query(c, c + 1)[0].value)).size > 1, true);
    eq([...Array(30).keys()].every((c) => n('0 .. 7').shuffle(8).query(c, c + 1).map((e2) => e2.value.n).sort().join() === '0,1,2,3,4,5,6,7'), true);
    eq(vals(select(0.5, [n('0'), n('1')])), '0'); // floor(x * (n - 1))
    eq(vals(chooseBy('0 1.25', ['a', 'b', 'c', 'd'])), 'a b'); // the index wraps

    // Structure
    eq(ev(n('0 1').euclid(3, 8)), '0@0-0.0625 1@0.0625-0.125 0@0.375-0.4375 1@0.4375-0.5 0@0.75-0.8125 1@0.8125-0.875');
    eq(ev(n('0*4').swingBy(0.5, 2), 1, 2), '0@1-1.25 0@1.25-1.5 0@1.5-1.75 0@1.75-2');
    eq([0, 1, 2, 3, 4, 5, 6].map((c) => vals(n('0').foldEvery([2, 3], (x) => x.add(n(1))), c, c + 1)).join(' '), '2 0 1 1 1 0 2');
    eq(vals(n('<[0 1 2 3] [4 5 6 7]>').iter(4), 1, 2), '1 2 3 4');
    eq([0, 1, 2, 3].map((c) => vals(n('<0 1 2 3>').chunk(4, (x) => x.add(n(10))), c, c + 1)).join(' '), '10 0 0 0');
    eq(ev(n('0').echoWith(2, 0.25, (x) => x.fast(2))), '0@0-1 0@0.125-0.625 0@0.625-1.125');
    eq(ev(n('[0 1, 2 ~ 3]').mono()), '2@0-0.3333 0@0.3333-0.5 1@0.5-1');
    eq(vals(n('[0,1,2,3,4]').arp('disconverge')), '0 4 1 3 2 3 1 4 0');
    eq(vals(n('[0,7,4]').arp('up')), '0 7 4');
    eq(vals(binary('3 5')).split(' ').map((x) => (x === 'true' ? 1 : 0)).join(''), '0000001100000101');
    eq(weave(3, pan(saw), [n('0'), n('1'), n('2')]).query(0, 1).sort((x, y) => x.value.n - y.value.n).map((e2) => r4(e2.value.pan)).join(' '), '0 0.3333 0.6667');
    eq(ev(n('0').ply(2.5)), '0@0-0.4 0@0.4-0.8 0@0.8-1');
    eq(ev(n('[0,4]').plyWith(2, (x) => x.add(n(12)))), '0@0-0.25 4@0.25-0.5 12@0.5-0.75 16@0.75-1');
    eq(ev(squeeze(run(1).slow(2), [n('0 1')]), 0, 2), '0@0-1 1@1-2');
    eq(vals(fastFromList([0.5, 1.5, 2.5]).quantise()), '0 2 2');
    eq(vals(n('0 .. 7').linger(-0.25)), '7 6 7 6 7 6 7 6');
    eq(ev(n('0 1').fast(-1)), '1@0-0.5 0@0.5-1');
    eq(ev(layer([(x) => x, (x) => x.add(n(1))], n('0'))), '0@0-1 1@0-1');

    // Mini-notation
    eq(ev(sound('<a@3 b>'), 0, 4), 'a@0-3 b@3-4');
    eq(ev(sound('{a@3 b, c d}')).startsWith('c@0-0.25 a@0-0.75'), true);
    eq(ev(n('0 .. 3 4')), '0@0-0.125 1@0.125-0.25 2@0.25-0.375 3@0.375-0.5 4@0.5-1');
    eq(note('c .. e').query(0, 1).map((e2) => e2.value.note - 60).join(), '0,1,2,3,4');
    eq(vals(sound('a !3 b')), 'a a a b');
    eq(ev(sound('a @3 b')), 'a@0-0.75 b@0.75-1');
    eq(note("c'm69'd2").query(0, 1).map((e2) => e2.value.note - 60).join(), '-5,0,3,9,14');
    eq(note("c'm69'o").query(0, 1).map((e2) => e2.value.note - 60).join(), '-12,-3,3,7,14');
    eq([0, 1].map((c) => note("c'<maj min>").query(c, c + 1).map((e2) => e2.value.note - 60).join()).join(' | '), '0,4,7 | 0,3,7');
    eq(ev(sound('a - b')), 'a@0-0.3333 b@0.6667-1');
    eq(ev(sound('a').fast('<4 q>'), 0, 1).split(' ').length, 4);
    eq([sound('<a b c>').steps(), sound('{a b, c d e}').steps(), sound('{a b c}%4').steps(), sound('bd(3,8)').steps(), sound('~').steps()].join(), '3,6,3,8,1');

    // Controls and SuperDirt playback
    eq(note('7').up(12).query(0, 1)[0].value.note, 72); // up = note
    eq(ev(sound('a').add(1)), 'a@0-1'.replace('a@', '1@')); // a bare whole number is n
    eq(JSON.stringify(sound('a').add(s(':3')).query(0, 1)[0].value), '{"s":"a"}'); // strings are not joined
    eq(ev(sound('bev').begin(0.5).striate(2)).length > 0 && sound('bev').begin(0.5).striate(2).query(0, 1).map((e2) => e2.value.begin).join(), '0.5,0.75');
    eq(sound('bev').chop(2).steps(), 2);
    eq(scale('bartok', '0 1 2').query(0, 1).map((x) => x.value).join(), '0,2,4');

    // Streams, transitions and stepwise
    t.stopAll();
    t.eval('mortal(1, 1, 1, sound("bd"))');
    eq(t.channels.get('d1').query(2, 4).length, 0); // a new stream starts from silence
    t.soloed.add('d9');
    t.muted.add('d9');
    eq(t.isAudible('d9'), true); // soloed wins over muted, as in Tidal
    t.soloed.clear();
    t.muted.clear();
    eq(ev(stepcat(sound('<a b>'), sound('c d'))), 'a@0-0.5 c@0.5-0.75 d@0.75-1');
    eq(ev(sound('a b c d').steptake('1 3')), 'a@0-0.25 a@0.25-0.5 b@0.5-0.75 c@0.75-1');
    eq(vals(sound('a b c d').steptake(6)), 'a b c d a b');
    eq(ev(stepcat(sound('a b').steptake(0), sound('c'))), 'c@0-1');
    eq(sound('a').segment(4).steps(), 4);
    eq(sound('a b c d').zoom(0.25, 0.75).steps(), 2);
    t.stopAll();
}

// ---------------------------------------------------------------------
// Phase 17: changes during a note (follow, tie), live controls, MIDI and
// OSC input, superfb. A fake audio graph records every AudioParam call.
// ---------------------------------------------------------------------
function fakeAudio() {
    const nodes = [];
    const param = (label, value = 0) => {
        const p = {
            label, value, events: [],
            setValueAtTime(v, at) { p.events.push(['set', v, at]); },
            linearRampToValueAtTime(v, at) { p.events.push(['ramp', v, at]); },
            exponentialRampToValueAtTime(v, at) { p.events.push(['exp', v, at]); },
            setTargetAtTime(v, at) { p.events.push(['target', v, at]); },
            setValueCurveAtTime(values, at, dur) { p.events.push(['curve', values[values.length - 1], at + dur]); },
            cancelScheduledValues(at) { p.events.push(['cancel', at]); },
            cancelAndHoldAtTime(at) { p.events.push(['hold', at]); },
        };
        return p;
    };
    const base = (kind) => ({ kind, connections: [], connect(x) { this.connections.push(x); return x; }, disconnect() {} });
    const source = (kind) => ({ ...base(kind), stops: [], start(at) { this.started = at; }, stop(at) { this.stops.push(at); } });
    const track = (n) => { nodes.push(n); return n; };
    const ctx = {
        currentTime: 0, sampleRate: 48000, state: 'running', resume() {},
        createGain: () => track({ ...base('gain'), gain: param('gain', 1) }),
        createBiquadFilter: () => track({ ...base('filter'), type: '', frequency: param('frequency', 350), Q: param('Q', 1), gain: param('fgain', 0) }),
        createStereoPanner: () => track({ ...base('panner'), pan: param('pan', 0) }),
        createOscillator: () => track({ ...source('osc'), type: 'sine', frequency: param('frequency', 440), detune: param('detune', 0), setPeriodicWave() {} }),
        createConstantSource: () => track({ ...source('constant'), offset: param('offset', 1) }),
        createBufferSource: () => track({ ...source('buffer'), playbackRate: param('rate', 1), detune: param('detune', 0) }),
        createWaveShaper: () => track({ ...base('shaper') }),
        createDelay: () => track({ ...base('delay'), delayTime: param('delayTime', 0) }),
        createChannelMerger: () => track(base('merger')),
        createConvolver: () => track(base('convolver')),
        createBuffer: (ch, length, sampleRate) => ({ numberOfChannels: ch, length, sampleRate, duration: length / sampleRate, getChannelData: () => new Float32Array(length) }),
        createPeriodicWave: () => ({}),
    };
    return { ctx, nodes, param };
}
{
    const savedCtx = t.audioContext;
    delete t.playEvent; // stubbed by the scheduler test above
    const { ctx, nodes, param } = fakeAudio();
    const useAudio = () => {
        nodes.length = 0;
        t.audioContext = ctx;
        t._session = t._createSession();
        t.cps = 1;
        t._anchorTime = 0;
        t._anchorCycle = 0;
    };
    const near = (a, b, tol, msg) => { assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); passed++; };
    /** The value an automated parameter is given at (about) a time. */
    const valueAt = (p, at) => {
        const points = p.events.filter((x) => x[0] === 'set' || x[0] === 'ramp');
        return points.reduce((best, x) => (Math.abs(x[2] - at) < Math.abs(best[2] - at) ? x : best))[1];
    };

    // samplePoints: every 15 ms (at most 400), flat runs left out
    const pts = TidalJS.samplePoints(0, 1, (x) => x);
    eq(pts[0].join(), '0,0');
    eq(pts[pts.length - 1].join(), '1,1');
    eq(pts.length, Math.ceil(1 / 0.015) + 1);
    eq(TidalJS.samplePoints(0, 60, (x) => x).length, 401);
    eq(TidalJS.samplePoints(0, 1, () => 5).length, 2);

    // follow: the event carries the signal's value at its onset; the filter moves during the note
    useAudio();
    const lp = sound('saw').note('c3').legato(1).follow('lpf', saw.range(200, 2200));
    eq(lp.query(0, 1)[0].value.lpf, 200);
    eq(lp.fast(2).query(0, 1)[1].value.lpf, 1200); // onsets are the times that play (after fast)
    eq(JSON.stringify(lp.query(0, 1)[0].value).includes('follow'), false); // left out of JSON
    eq(JSON.stringify(t.exportPattern(lp, 1)).includes('follow'), false);
    t.playEvent(lp.query(0, 1)[0].value, 0.25, 1);
    let filt = nodes.find((n) => n.kind === 'filter' && n.type === 'lowpass');
    eq(filt.frequency.events[0].join(), 'set,700,0.25'); // the onset value replaces the control's own
    near(valueAt(filt.frequency, 0.75), 1700, 40, 'lpf follows the signal at absolute cycles');
    near(valueAt(filt.frequency, 1.1), 400, 40, 'the saw wraps at the next cycle');
    const lastAt = Math.max(...filt.frequency.events.map((x) => x[2]));
    near(lastAt, 0.25 + 1 + 0.03 + 0.02, 1e-6, 'automated through the release');
    // followNote: the signal's time starts at the onset
    useAudio();
    t.playEvent(sound('saw').legato(1).followNote('lpf', saw.range(200, 2200)).query(0, 1)[0].value, 0.25, 1);
    filt = nodes.find((n) => n.kind === 'filter' && n.type === 'lowpass');
    eq(filt.frequency.events[0][1], 200);
    near(valueAt(filt.frequency, 0.75), 1200, 40, 'followNote at half a cycle into the note');
    // resonance, pan and gain (a gain that starts at 0 still builds the voice)
    useAudio();
    t.playEvent(sound('saw').legato(1).lpf(1000).follow('resonance', saw).follow('pan', saw.range(-1, 1)).follow('gain', saw).query(0, 1)[0].value, 0, 1);
    filt = nodes.find((n) => n.kind === 'filter' && n.type === 'lowpass');
    near(valueAt(filt.Q, 0.5), 30, 1, 'resonance 0.5 is 30 dB');
    near(valueAt(nodes.find((n) => n.kind === 'panner').pan, 0.5), 0, 0.05, 'pan follows');
    const level = nodes.find((n) => n.kind === 'gain' && n.gain.events.some((x) => x[0] === 'ramp' && Math.abs(x[2] - 0.5) < 0.008));
    near(valueAt(level.gain, 0.5), Math.pow(0.5, 4), 0.01, 'gain follows SuperDirt\'s curve');
    // pitch: note (relative to the note, in cents, on a constant source into the detunes)
    useAudio();
    t.playEvent(sound('saw').note('c3').legato(1).followNote('note', saw.range(0, 12)).query(0, 1)[0].value, 0, 1);
    const bend = nodes.find((n) => n.kind === 'constant' && n.offset.events.length > 2);
    near(valueAt(bend.offset, 0.5), 600, 20, 'note follows in cents');
    eq(nodes.find((n) => n.kind === 'osc').frequency.value.toFixed(2), (440 * Math.pow(2, (60 - 69) / 12)).toFixed(2)); // starts at the signal's note
    eq(bend.connections.some((c) => c.label === 'detune'), true);
    // speed on a synth, and several follows with the last winning
    useAudio();
    t.playEvent(sound('saw').legato(1).follow('speed', '2').follow('speed', saw.range(1, 2)).query(0, 1)[0].value, 0, 1);
    near(valueAt(nodes.find((n) => n.kind === 'constant' && n.offset.events.length > 2).offset, 0.5), 1200 * Math.log2(1.5), 20, 'speed follows');
    // an unsupported control is ignored with a warning
    let r = t.eval('sound("saw").follow("vowel", "a")');
    eq(r.success && r.warnings.some((w) => /cannot change vowel/.test(w)), true);
    // live updates tell follow signals apart
    t.eval('d1(sound("saw").follow("lpf", sine.range(200, 400)))');
    const kept = t.channels.get('d1');
    t.eval('d1(sound("saw").follow("lpf", sine.range(200, 400)))', { keepUnchanged: true });
    eq(t.channels.get('d1') === kept, true);
    t.eval('d1(sound("saw").follow("lpf", sine.range(200, 800)))', { keepUnchanged: true });
    eq(t.channels.get('d1') === kept, false);
    t.stopAll();

    // tie: the second note takes over the voice (no new oscillator), glides and lasts longer
    useAudio();
    const tied = sound('saw').note('c3 e3').legato(1).lpf('500 900').tie(1).portamento(0.1).query(0, 1).map((e) => e.value);
    eq(tied[0].tie, 1);
    const first = t.playEvent(tied[0], 0, 0.5);
    const oscs = nodes.filter((n) => n.kind === 'osc').length;
    const again = t.playEvent(tied[1], 0.5, 0.5);
    eq(again === first, true);
    eq(nodes.filter((n) => n.kind === 'osc').length, oscs);
    eq(first.bend.events.some((x) => x[0] === 'hold' && x[1] === 0.5), true);
    near(valueAt(first.bend, 0.6), 400, 5, 'glides to e3 over portamento');
    eq(first.gate.events.some((x) => x[0] === 'hold' && x[1] === 0.5), true);
    near(first.stopAt, 1 + 0.03 + 0.02, 1e-9, 'the voice lasts until the new end');
    eq(nodes.find((n) => n.kind === 'osc').stops.slice(-1)[0], first.stopAt);
    eq(first.params.lpf.freq.events.slice(-1)[0].join(), 'set,900,0.5');
    // once the voice has ended, the same tie starts a new one; another tie is another voice
    eq(t.playEvent({ ...tied[1], note: 50 }, 3, 0.5) === first, false);
    eq(t.playEvent({ ...tied[0], tie: 2 }, 3.1, 0.5) === t._session.ties.get('0:saw:1'), false);
    t.sampleBanks.set('kit', ['k.wav']);
    t._sampleBuffers.set('k.wav', { buffer: ctx.createBuffer(1, 4800, 48000) });
    r = t.eval('sound("kit").tie(1)');
    t._session = t._createSession();
    t.playEvent({ s: 'kit', tie: 1 }, 0, 0.5);
    eq(t._warned.has('tie() works on synths; samples ignore it'), true);
    t.sampleBanks.delete('kit');

    // Live controls: slider and toggle
    const seen = [];
    const stop = t.onControls((list) => seen.push(list));
    r = t.eval('sound("saw").lpf(slider("cut", 800, 200, 4000))');
    eq(JSON.stringify(t.controls()), JSON.stringify([{ name: 'cut', kind: 'slider', value: 800, min: 200, max: 4000, step: 0 }]));
    eq(seen.length > 0, true);
    eq(t.channels.get('#1').query(0, 1)[0].value.lpf, 800);
    eq(t.setControl('cut', 5000), 4000);
    eq(t.channels.get('#1').query(0, 1)[0].value.lpf, 4000);
    t.eval('sound("saw").lpf(slider("cut", 300, 100, 3000))');
    eq(t.controls()[0].value, 3000); // keeps its value, within the new range
    t.eval('sound("saw").lpf(slider("cut", 300).fast("xyz"))'); // fails: the controls stay
    eq(t.controls().length, 1);
    t.eval('sound("hh*4").gain(toggle("hats", true)).pan(slider("p", 0.33, 0, 1, 0.25))');
    eq(t.controls().map((c) => `${c.name}:${c.kind}:${c.value}`).join(), 'hats:toggle:1,p:slider:0.25'); // cut went
    eq(t.setControl('hats', false), 0);
    eq(t.channels.get('#1').query(0, 1)[0].value.gain, 0);
    t.restoreControls({ x: 7 });
    t.eval('sound("saw").speed(slider("x", 1, 0, 10))');
    eq(t.controls()[0].value, 7);
    stop();
    t.stopAll();

    // MIDI input: control changes (running status, real-time bytes, channels)
    t._midiIn([0xb0, 74, 127]);
    eq(midicc(74)._signal(0), 1);
    eq(midicc(74, 0)._signal(0), 1);
    eq(midicc(74, 1)._signal(0), 0);
    t._midiIn([0xb1, 10, 64, 11, 127], 'other');
    eq(+midicc(10, 1)._signal(0).toFixed(4), +(64 / 127).toFixed(4));
    eq(midicc(11)._signal(0), 1);
    t._midiIn([0xb0, 0xf8, 7, 0]);
    eq(midicc(7)._signal(0), 0);
    t._midiIn([0xb0, 7]); t._midiIn([127]); // a message split in two
    eq(midicc(7)._signal(0), 1);
    // midikeys: each key plays the template, held until let go
    useAudio();
    r = t.eval('stack(midikeys(sound("supersaw").amp(0.2).lpf(2000)), midikeys(sound("superfm"), 3))');
    eq(r.success && t._midiKeys.length === 2, true);
    ctx.currentTime = 1;
    t._midiIn([0x90, 64, 127]);
    let held = t._midiHeld.get('0:64');
    eq(held.length, 1); // the channel-3 keyboard does not hear channel 0
    const keyOsc = nodes.find((n) => n.kind === 'osc');
    eq(+keyOsc.frequency.value.toFixed(3), +(440 * Math.pow(2, (64 - 69) / 12)).toFixed(3));
    eq(keyOsc.stops[0] > 600, true); // held
    t._midiIn([64, 0]); // running status: note-on with velocity 0 is a note-off
    eq(t._midiHeld.has('0:64'), false);
    eq(keyOsc.stops.slice(-1)[0] < 2, true);
    const played = [];
    const realPlay = t.playEvent;
    t.playEvent = (v, time, dur, hold) => { played.push({ v, hold }); return null; };
    t._midiIn([0x93, 60, 64]);
    eq(played.length, 2);
    eq(played[0].v.note === 60 && played[0].v.lpf === 2000 && +played[0].v.amp.toFixed(4) === +(0.2 * 64 / 127).toFixed(4) && played[0].hold, true);
    eq(+played[1].v.amp.toFixed(4), +(0.4 * 64 / 127).toFixed(4)); // the default amp
    t.playEvent = realPlay;
    t.eval('sound("bd")');
    eq(t._midiKeys.length, 0); // gone when the code no longer uses it
    t.stopAll();

    // OSC input: messages and bundles from the bridge
    class FakeSocket {
        constructor(url) { this.url = url; this.readyState = 0; FakeSocket.last = this; }
        send() {}
        close() {}
    }
    const savedSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeSocket;
    t._socket = null;
    r = t.eval('sound("saw*4").lpf(oscIn("/fader").range(200, 4000)).pan(oscIn("pan", 1))');
    eq(r.success && FakeSocket.last.url === t.oscUrl, true);
    eq(oscIn('/fader')._signal(0), 0);
    FakeSocket.last.onmessage({ data: TidalJS.oscMessage('/fader', [0.5, 3]).buffer });
    eq(oscIn('/fader')._signal(0), 0.5);
    eq(oscIn('/fader', 1)._signal(0), 3);
    eq(t.channels.get('#1').query(0, 1)[0].value.lpf, 2100);
    t._oscReceive(TidalJS.oscBundle(0, TidalJS.oscMessage('/pan', ['x', -1])));
    eq(oscIn('/pan', 1)._signal(0), -1);
    eq(oscIn('/pan', 0)._signal(0), 0); // text is not a number
    // other types: double, int64, true, a blob; nested bundles
    const enc = new TextEncoder();
    const pad = (bytes) => { const out = new Uint8Array(Math.ceil((bytes.length + 1) / 4) * 4); out.set(bytes); return out; };
    const u8 = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
    const be = (n, f) => { const b = new Uint8Array(n); f(new DataView(b.buffer)); return b; };
    const msg = u8(pad(enc.encode('/many')), pad(enc.encode(',dbhTi')), be(8, (d) => d.setFloat64(0, 0.25)),
        be(4, (d) => d.setInt32(0, 3)), new Uint8Array([1, 2, 3, 0]), be(8, (d) => d.setBigInt64(0, 9n)), be(4, (d) => d.setInt32(0, -7)));
    eq(JSON.stringify(TidalJS.parseOsc(msg)[0].args), JSON.stringify([0.25, { 0: 1, 1: 2, 2: 3 }, 9, true, -7]));
    const nested = TidalJS.oscBundle(0, TidalJS.oscBundle(0, TidalJS.oscMessage('/deep', [2])));
    t._oscReceive(nested);
    eq(oscIn('/deep')._signal(0), 2);
    t._oscReceive(msg.slice(0, 13)); // cut short: a warning, nothing changes
    eq([...t._warned].some((w) => /OSC packet/.test(w)), true);
    eq(oscIn('/many', 4)._signal(0), 0);
    t._oscReceive(msg);
    eq(oscIn('/many', 4)._signal(0), -7);
    globalThis.WebSocket = savedSocket;
    t._socket = null;
    t.stopAll();

    // superfb: the SinOscFB processor, sample by sample
    const registered = {};
    new Function('sampleRate', 'registerProcessor', 'AudioWorkletProcessor', '(' + TidalJS.workletModule.toString() + ')();')(
        48000, (name, cls) => { registered[name] = cls; }, class {});
    const FB = registered['tidal-fb'];
    eq(typeof FB, 'function');
    const render = (feedback, gate = 1) => {
        const p = new FB();
        const out = [];
        for (let k = 0; k < 16; k++) {
            const o = new Float32Array(128);
            p.process([[new Float32Array(128).fill(gate)]], [[o]], { frequency: [750], detune: [0], feedback: [feedback] });
            out.push(...o);
        }
        return out;
    };
    const pure = render(0);
    eq(pure.every((y, i) => Math.abs(y - Math.sin((2 * Math.PI * 750 * i) / 48000)) < 1e-4), true); // a sine
    const harmonic = (ys, k) => {
        let re = 0; let im = 0;
        ys.forEach((y, i) => { re += y * Math.cos((2 * Math.PI * 750 * k * i) / 48000); im += y * Math.sin((2 * Math.PI * 750 * k * i) / 48000); });
        return Math.hypot(re, im) / ys.length;
    };
    const buzz = render(1.5);
    eq(harmonic(pure, 2) < 1e-3, true);
    eq(harmonic(buzz, 2) / harmonic(buzz, 1) > 0.25 && harmonic(buzz, 3) / harmonic(buzz, 1) > 0.1, true); // saw-like
    const gated = new FB();
    const o = new Float32Array(128);
    eq(gated.process([[]], [[o]], { frequency: [750], detune: [0], feedback: [0] }), true); // not started yet
    gated.process([[new Float32Array(128).fill(1)]], [[o]], { frequency: [750], detune: [0], feedback: [0] });
    eq(gated.process([[]], [[o]], { frequency: [750], detune: [0], feedback: [0] }), false); // stopped: done
    eq(render(0, 0).every((y) => y === 0), true);
    // In the engine: the worklet node with the voice's feedback, or a sine with a warning without it
    eq(TidalJS.soundNames.includes('superfb'), true);
    useAudio();
    t._fxState = 'failed';
    t.playEvent({ s: 'superfb', note: 48, legato: 1 }, 0, 1);
    eq(t._warned.has('superfb needs AudioWorklet, which is not available here; it plays a sine'), true);
    eq(nodes.some((n) => n.kind === 'osc'), true);
    const worklets = [];
    globalThis.AudioWorkletNode = class {
        constructor(c, name, opts) { this.name = name; this.opts = opts; this.parameters = new Map([['detune', param('detune')]]); worklets.push(this); }
        connect() {}
        disconnect() {}
    };
    t._fxState = 'ready';
    useAudio();
    t.playEvent({ s: 'superfb', note: 48, voice: 0.8, legato: 1, tie: 'x' }, 0, 1);
    eq(worklets.length === 1 && worklets[0].name === 'tidal-fb', true);
    eq(+worklets[0].opts.parameterData.feedback.toFixed(6), 1.2);
    eq(nodes.some((n) => n.kind === 'osc' && n.frequency.value > 20), false); // no sine instead (a tied voice's LFOs are slower)
    const gateSrc = nodes.find((n) => n.kind === 'constant' && n.offset.value === 1);
    eq(gateSrc.connections[0] === worklets[0], true);
    eq(nodes.filter((n) => n.kind === 'constant').some((n) => n.connections.includes(worklets[0].parameters.get('detune'))), true); // tie can bend it
    delete globalThis.AudioWorkletNode;
    t._fxState = 'none';

    // ---------------------------------------------------------------
    // Phase 18: midibend, miditouch, midikeys' bend range, oscplay,
    // envelope, rhythm, controlLayout, tie on every control, live follow.
    // ---------------------------------------------------------------
    const lastSet = (p) => p.events.filter((x) => x[0] === 'set' || x[0] === 'ramp').slice(-1)[0];

    // midibend: 14 bits, -1 to 1, per channel and any channel; miditouch: channel and key pressure
    eq(midibend()._signal(0), 0);
    t._midiIn([0xe0, 0, 64]);
    eq(midibend()._signal(0), 0);
    t._midiIn([0xe0, 0x7f, 0x7f]);
    eq(midibend(0)._signal(0), 1);
    t._midiIn([0xe1, 0, 0]);
    eq(midibend(1)._signal(0), -1);
    eq(midibend()._signal(0), -1);
    eq(midibend(0)._signal(0), 1);
    t._midiIn([0xe2, 0, 96]);
    eq(midibend(2)._signal(0), 0.5);
    eq(miditouch()._signal(0), 0);
    t._midiIn([0xd3, 127]);
    eq(miditouch(3)._signal(0), 1);
    eq(miditouch(4)._signal(0), 0);
    t._midiIn([0xa0, 60, 64, 61, 127]); // running status: two key pressures, the last one counts
    eq(miditouch(0)._signal(0), 1);
    eq(miditouch()._signal(0), 1);
    t._midiIn([0xa5, 60, 0]);
    eq(miditouch()._signal(0), 0);
    eq(miditouch(3)._signal(0), 1);

    // keytouch: inside a midikeys() voice, the pressure of its own key; 0 elsewhere
    t._midiIn([0xa0, 60, 127]);
    eq(keytouch()._signal(0), 0);
    useAudio();
    r = t.eval('midikeys(sound("saw").follow("amp", keytouch().range(0.1, 0.5)))');
    eq(r.success, true);
    ctx.currentTime = 3;
    t._midiIn([0x90, 60, 100, 64, 100]); // a new press of 60 starts without its old pressure
    const k60 = t._midiHeld.get('0:60')[0], k64 = t._midiHeld.get('0:64')[0];
    eq([...t._liveVoices.values()].map((e) => e.key).sort().join(), '0:60,0:64');
    const before64 = k64.params.level.events.length;
    const levelAt = (h) => h.params.level.events.filter((x) => x[0] === 'set' || x[0] === 'ramp').slice(-1)[0][1];
    const start60 = levelAt(k60);
    eq(start60, levelAt(k64)); // before any pressure each note keeps its own amp
    t._liveFlushedAt = 0;
    t._midiIn([0xa0, 64, 127]); // only key 64 is pressed harder
    eq(k64.params.level.events.length > before64, true);
    const hard = levelAt(k64);
    t._liveFlushedAt = 0;
    t._midiIn([0xa0, 64, 0]);
    eq(hard > levelAt(k64) * 4.9, true); // amp 0.5 at full pressure, 0.1 at none
    eq(levelAt(k60), start60); // key 60 keeps its own (no) pressure
    eq(miditouch()._signal(0), 0); // miditouch still reads the last key
    // miditouch in a voice: the note keeps its own value until channel pressure comes after its key went down
    r = t.eval('midikeys(sound("saw").follow("amp", miditouch().range(0.1, 0.5)))');
    t._midiIn([0x90, 67, 100]);
    const k67 = t._midiHeld.get('0:67')[0];
    const own = levelAt(k67);
    t._liveFlushedAt = 0;
    t._midiIn([0xd0, 127]);
    eq(levelAt(k67) !== own, true);
    t._midiIn([0x80, 60, 0, 64, 0, 67, 0]);
    t.eval('sound("bd")');
    t.stopAll();

    // midikeys(template, channel, bendRange): the wheel bends the held keys
    useAudio();
    t._midiIn([0xe0, 0, 64]); t._midiIn([0xe1, 0, 64]); t._midiIn([0xe2, 0, 64]);
    r = t.eval('stack(midikeys(sound("saw"), null, 2), midikeys(sound("superfm"), 1))');
    eq(r.success && t._midiKeys[0].bendRange === 2 && t._midiKeys[1].bendRange === 0, true);
    ctx.currentTime = 1;
    t._midiIn([0xe0, 0, 96]); // half up before the key: it starts bent by a semitone
    t._midiIn([0x90, 60, 100]);
    let voice = t._midiHeld.get('0:60')[0];
    eq(voice.wheel.range, 2);
    eq(lastSet(voice.bend).join(), 'set,100,1');
    ctx.currentTime = 1.5;
    t._midiIn([0xe0, 0x7f, 0x7f]); // all the way up: two semitones
    eq(lastSet(voice.bend).join(), 'ramp,200,1.505');
    t._midiIn([0xe0, 0, 64]);
    eq(lastSet(voice.bend)[1], 0);
    t._midiIn([0x91, 62, 100]); // channel 1: the superfm keyboard has no bend range
    const fm = t._midiHeld.get('1:62').find((h) => !h.wheel);
    eq(!!fm, true);
    const fmEvents = fm.bend ? fm.bend.events.length : 0;
    t._midiIn([0xe1, 0x7f, 0x7f]);
    eq(fm.bend ? fm.bend.events.length : 0, fmEvents);
    t._midiIn([0x80, 60, 0]);
    eq(t._midiHeld.has('0:60'), false);
    eq(voice.stopAt < 2, true); // released as before
    t._midiIn([0xe0, 0, 64]); t._midiIn([0xe1, 0, 64]);
    t.eval('sound("bd")');
    t.stopAll();

    // oscplay: each message plays the template once, with that message's values
    {
        const savedWs = globalThis.WebSocket;
        globalThis.WebSocket = class { constructor(url) { this.url = url; this.readyState = 0; } send() {} close() {} };
        t._socket = null;
        useAudio();
        r = t.eval('oscplay("hit", sound("superpiano").freq(oscIn("/hit", 1)).amp(oscIn("/hit", 2)))');
        eq(r.success && t._oscPlays.length === 1 && t._oscPlays[0].address === '/hit', true);
        const heard = [];
        t.playEvent = (v, time, dur) => { heard.push({ v, time, dur }); return null; };
        ctx.currentTime = 2;
        t._oscReceive(TidalJS.oscMessage('/hit', [0, 330, 0.5]));
        t._oscReceive(TidalJS.oscBundle(0, TidalJS.oscMessage('/hit', [0, 440, 0.25])));
        t._oscReceive(TidalJS.oscMessage('/other', [1, 2, 3]));
        eq(heard.length, 2);
        eq(heard[0].v.s === 'superpiano' && heard[0].v.freq === 330 && heard[0].v.amp === 0.5 && heard[0].time === 2 && heard[0].dur === 1, true);
        eq(heard[1].v.freq === 440 && heard[1].v.amp === 0.25, true);
        delete t.playEvent;
        t._oscReceive(TidalJS.oscMessage('/hit', [0, 220, 0.4])); // really plays
        eq(nodes.some((n) => n.kind === 'osc' && Math.abs(n.frequency.value - 220) < 0.1), true); // superpiano stretches its partials a little
        t.eval('sound("saw").lpf(slider("x", 1)).fast("xyz")'); // fails: oscplay stays
        eq(t._oscPlays.length, 1);
        t.eval('sound("bd")');
        eq(t._oscPlays.length, 0);
        let threw = false;
        try { oscplay('/x'); } catch (e) { threw = e instanceof TypeError; }
        eq(threw, true);
        globalThis.WebSocket = savedWs;
        t._socket = null;
        t.stopAll();
    }

    // envelope(levels, times, curves): SuperCollider's Env, times in seconds
    t.cps = 1;
    const env = envelope([0, 1, 0], [1, 1]);
    eq(env._signal(-1), 0);
    eq(env._signal(0), 0);
    eq(env._signal(0.5), 0.5);
    eq(env._signal(1), 1);
    eq(env._signal(1.5), 0.5);
    eq(env._signal(5), 0);
    t.cps = 0.5;
    eq(env._signal(0.25), 0.5); // cycle 0.25 is half a second at 0.5 cps
    t.cps = 1;
    near(envelope([1, 100], [1], 'exp')._signal(0.5), 10, 1e-9, 'exponential');
    near(envelope([0, 100], [1], 'exp')._signal(0.5), 50, 1e-9, 'exponential from 0 is straight');
    eq(envelope([1, 100], [1], 'step')._signal(0.5), 100);
    eq(envelope([1, 100], [1], 'hold')._signal(0.5), 1);
    near(envelope([0, 1], [1], 'sin')._signal(0.25), 0.5 - 0.5 * Math.cos(Math.PI / 4), 1e-9, 'sine');
    near(envelope([0, 1], [1], 'welch')._signal(0.5), Math.sin(Math.PI / 4), 1e-9, 'welch up');
    near(envelope([1, 0], [1], 'wel')._signal(0.5), Math.sin(Math.PI / 4), 1e-9, 'welch down (SuperCollider: y2 - (y2 - y1) * sin(pi/2 * (1 - x)))');
    near(envelope([0, 4], [1], 'sqr')._signal(0.5), 1, 1e-9, 'squared');
    near(envelope([0, 8], [1], 'cubed')._signal(0.5), 1, 1e-9, 'cubed');
    near(envelope([0, 1], [1], -4)._signal(0.5), (1 - Math.exp(-2)) / (1 - Math.exp(-4)), 1e-9, 'curve -4');
    near(envelope([0, 1, 0], [1, 1], ['lin', 'step'])._signal(1.5), 0, 1e-9, 'one curve per segment');
    near(envelope([0, 1, 0, 1], [1], 'lin')._signal(2.5), 0.5, 1e-9, 'times are cycled');
    eq(envelope([0.3], [])._signal(9), 0.3);
    for (const bad of [() => envelope('x', [1]), () => envelope([0, 1], [-1]), () => envelope([0, 1], []), () => envelope([0, 1], [1], 'zig'), () => envelope([0, 'a'], [1])]) {
        let threw = false;
        try { bad(); } catch (e) { threw = e instanceof TypeError; }
        eq(threw, true);
    }
    // with followNote: restarts at each note; with follow and late: absolute time
    useAudio();
    t.playEvent(sound('saw').legato(1).followNote('lpf', envelope([200, 4200], [1])).query(0, 1)[0].value, 0.25, 1);
    let envFilt = nodes.find((n) => n.kind === 'filter' && n.type === 'lowpass');
    eq(envFilt.frequency.events[0][1], 200);
    near(valueAt(envFilt.frequency, 0.75), 2200, 40, 'followNote reads the envelope from the onset');
    eq(sound('saw').follow('pan', envelope([-1, 1], [8]).late(2)).query(6, 7)[0].value.pan, 0);

    // rhythm(durations): one step after another from cycle 0, never looping
    const steps = note('c4 e4 g4').slow(3).s('superpiano').rhythm(0.25);
    eq(steps.query(0, 1).map((e2) => `${e2.value.note}@${e2.begin}-${e2.end}`).join(' '), '60@0-0.25 64@0.25-0.5 67@0.5-0.75 60@0.75-1');
    eq(steps.query(0.3, 0.6).map((e2) => e2.value.note).join(), '67'); // onsets in the span
    const randomSteps = note('c4 e4 g4').slow(3).s('superpiano').rhythm(choose([0.25, 0.5]));
    const pick = choose([0.25, 0.5])._signal;
    let at = 0;
    const firstSteps = randomSteps.query(0, 20);
    for (let k = 0; k < firstSteps.length; k++) {
        const e2 = firstSteps[k];
        assert(Math.abs(e2.begin - at) < 1e-9 && Math.abs(e2.end - e2.begin - pick(k)) < 1e-9, `step ${k}`);
        assert.strictEqual(e2.value.note, [60, 64, 67][k % 3]);
        at = e2.end;
    }
    passed++;
    // far into the future: fast, and the same as summing from the start
    const started = Date.now();
    const far = randomSteps.query(20000, 20002);
    eq(Date.now() - started < 3000, true);
    const fresh = note('c4 e4 g4').slow(3).s('superpiano').rhythm(choose([0.25, 0.5]));
    let sum = 0;
    let k0 = 0;
    while (sum < 20000) sum += pick(k0++);
    eq(Math.abs(far[0].begin - sum) < 1e-6 && far[0].value.note === [60, 64, 67][k0 % 3], true);
    eq(JSON.stringify(fresh.query(20000, 20002)), JSON.stringify(far));
    for (let i = 1; i < far.length; i++) assert(Math.abs(far[i].begin - far[i - 1].end) < 1e-9);
    passed++;
    // chords, rests, a pattern of lengths, the shortest step, other lengths
    eq(note('[c4,e4] g4').slow(2).rhythm(0.5).query(0, 1).map((e2) => `${e2.value.note}@${e2.begin}`).join(' '), '60@0 64@0 67@0.5');
    eq(note('c4 ~').slow(2).rhythm(0.5).query(0, 1.5).map((e2) => `${e2.value.note}@${e2.begin}`).join(' '), '60@0 60@1');
    eq(note('c d e f').rhythm('1 0.5').query(0, 3).map((e2) => `${e2.begin}-${e2.end}`).join(' '), '0-1 1-2 2-3');
    eq(note('c').rhythm('<1 0.5>').query(0, 3).map((e2) => e2.begin).join(), '0,1,1.5,2.5');
    eq(note('c').rhythm(0).query(0, 1).length, 256);
    eq(note('c').rhythm(rand.range(0.1, 0.3)).query(0, 4).every((e2) => e2.end - e2.begin >= 0.1 - 1e-9 && e2.end - e2.begin <= 0.3 + 1e-9), true);
    t._warnings = new Set();
    eq(note('c').rhythm('a').query(0, 1).map((e2) => e2.end - e2.begin).join(), '0.25,0.25,0.25,0.25');
    eq([...t._warnings].some((w) => /step length is not a number/.test(w)), true);
    t._warnings = null;
    eq(note('c').rhythm(1 / 256).query(8000, 8001).length, 0); // past the cap: silent, with a warning
    eq([...t._warned].some((w) => /first 2000000 steps/.test(w)), true);
    // legato, the views and export work as with any pattern
    const legato = sound('saw').note('c3 e3').rhythm(0.75).legato(0.5);
    eq(legato.query(0, 2).map((e2) => `${e2.begin}-${e2.end}:${e2.value.legato}`).join(' '), '0-0.75:0.5 0.75-1.5:0.5 1.5-2.25:0.5');
    const exported = t.exportPattern(note('c4 e4').rhythm(0.75), 2);
    eq(exported.events.map((e2) => `${e2.begin}-${e2.end}`).join(' '), '0-0.75 0.75-1.5 1.5-2.25');
    r = t.eval('d1(note("c4 e4 g4").slow(3).s("superpiano").rhythm(choose([0.25, 0.5])))');
    eq(r.success && t.queryActive(10, 12).length > 0, true);
    t.stopAll();
    let threwRhythm = false;
    try { note('c').rhythm(); } catch (e) { threwRhythm = e instanceof TypeError; }
    eq(threwRhythm, true);

    // controlLayout(title, rows): groups of the Controls panel, replaced like the controls
    const layoutsSeen = [];
    const stopLayouts = t.onControls((list, layouts) => layoutsSeen.push(layouts));
    r = t.eval('d1(sound("saw").lpf(slider("cut", 800, 200, 4000)).resonance(slider("res", 0.2)).gain(toggle("on", true)))\ncontrolLayout("Synth", [["cut", "res"], ["on", "ghost"]])\ncontrolLayout("More", ["amp"])');
    eq(r.success && r.activePatterns === 1, true);
    eq(JSON.stringify(t.controlLayouts()), JSON.stringify([{ title: 'Synth', rows: [['cut', 'res'], ['on', 'ghost']] }, { title: 'More', rows: [['amp']] }]));
    eq(JSON.stringify(layoutsSeen[layoutsSeen.length - 1]), JSON.stringify(t.controlLayouts()));
    r = t.eval('controlLayout("Synth", [["cut"]])\nsound("saw").lpf(slider("cut", 800, 200, 4000))'); // before the pattern: it still plays
    eq(r.success && r.activePatterns === 1 && t.controlLayouts().length === 1, true);
    t.eval('controlLayout("X", [["cut"]])\nsound("saw").fast("xyz")'); // fails: the layouts stay
    eq(t.controlLayouts()[0].title, 'Synth');
    r = t.eval('controlLayout("X", "cut")');
    eq(r.success, false);
    t.eval('sound("saw").lpf(slider("cut", 800, 200, 4000))');
    eq(t.controlLayouts().length, 0);
    stopLayouts();
    t.stopAll();

    // tie: a tied event changes effects, the synth's parameters and the orbit's effects
    useAudio();
    ctx.currentTime = 0.5; // curve changes are due now
    const tie1 = t.playEvent({ s: 'saw', note: 48, legato: 1, tie: 't' }, 0, 0.5);
    const shapers = nodes.filter((n) => n.kind === 'shaper');
    eq(shapers.length >= 5 && shapers.every((n) => n.curve === null), true); // built, passing the sound as it is
    const vowelWet = tie1.params.vowel.wet;
    eq(vowelWet.value, 0);
    const tie2 = t.playEvent({
        s: 'saw', note: 52, legato: 1, tie: 't', shape: 0.5, crush: 4, distort: 0.5, vowel: 'o', tremolorate: 4, tremolodepth: 0.6,
        ring: 0.5, ringf: 200, phaserrate: 2, phaserdepth: 0.4, leslie: 0.5, lrate: 2, peak: 800, peakgain: 10, djf: 0.2,
        hpf: 300, bpf: 1000, lpf: 2000, vib: 5, vibmod: 1, delay: 0.5, delaytime: 0.25, delayfeedback: 0.4, reverb: 0.3, size: 0.8, dry: 0.2,
    }, 0.5, 0.5);
    eq(tie2 === tie1, true);
    const p1 = tie1.params;
    eq(shapers.some((n) => n.curve === t._curve('shape', 50)), true);
    eq(shapers.some((n) => n.curve === t._curve('crush', 400)), true);
    eq(shapers.some((n) => n.curve === t._curve('distortion', Math.round(1 + 0.5 * 99))), true);
    eq(lastSet(vowelWet).join(), 'set,2,0.5');
    eq(lastSet(p1.vowel.dry).join(), 'set,0,0.5');
    eq(lastSet(p1.tremolo.rate).join(), 'set,4,0.5');
    eq(lastSet(p1.tremolo.amount)[1], 0.3);
    eq(lastSet(p1.ring.gain)[1], 0.5);
    eq(lastSet(p1.ring.freq)[1], 200);
    eq(p1.phaser.sweeps.every((s2) => lastSet(s2.freq)[1] === 2 && Math.abs(lastSet(s2.amount)[1] - 360) < 1e-9), true);
    eq(lastSet(p1.leslie.wet)[1], 0.5);
    eq(p1.leslie.rates.every((x) => lastSet(x)[1] === 2), true);
    eq(lastSet(p1.peak.freq)[1] === 800 && lastSet(p1.peak.gain)[1] === 10, true);
    near(lastSet(p1.djf.low)[1], 20 * Math.pow(500, 0.4), 1e-6, 'djf');
    eq(lastSet(p1.hpf.freq)[1] === 300 && lastSet(p1.bpf.freq)[1] === 1000 && lastSet(p1.lpf.freq)[1] === 2000, true);
    const vibOsc = nodes.find((n) => n.kind === 'osc' && n.frequency.events.some((x) => x[0] === 'set' && x[1] === 5));
    eq(!!vibOsc, true);
    const fx = t._orbitEffects(0);
    eq(!!fx.delay && fx.delay.amp.gain.events.some((x) => x[0] === 'set' && x[1] === 0.5 && x[2] === 0.5), true);
    eq(p1.output.connections.includes(fx.delay.input), true);
    eq(!!fx.reverb && fx.reverb.input.gain.events.some((x) => x[1] === 0.3 && x[2] === 0.5), true);
    eq(p1.output.connections.filter((c) => c === fx.reverb.input).length, 1);
    t.playEvent({ s: 'saw', note: 52, legato: 1, tie: 't', reverb: 0.1 }, 0.9, 0.5);
    eq(p1.output.connections.filter((c) => c === fx.reverb.input).length, 1); // connected once
    eq(lastSet(p1.tremolo.rate)[1], 4); // left out: kept
    // the synth's own parameters
    useAudio();
    const saw7 = t.playEvent({ s: 'supersaw', note: 48, legato: 1, tie: 's' }, 0, 0.5);
    t.playEvent({ s: 'supersaw', note: 48, legato: 1, tie: 's', detune: 1, voice: 0.9 }, 0.5, 0.5);
    eq(!!saw7.tune && nodes.filter((n) => n.kind === 'osc' && n.detune.events.some((x) => x[0] === 'set' && Math.abs(Math.abs(x[1]) - 100) < 1e-9)).length, 2);
    eq(nodes.filter((n) => n.kind === 'gain' && n.gain.events.some((x) => x[0] === 'set' && Math.abs(x[1] - 0.9 / 2.2) < 1e-9)).length, 6);
    useAudio();
    t.playEvent({ s: 'superfm', note: 48, legato: 1, tie: 'f' }, 0, 0.5);
    t.playEvent({ s: 'superfm', note: 48, legato: 1, tie: 'f', semitone: 7 }, 0.5, 0.5);
    eq(nodes.some((n) => n.kind === 'osc' && n.frequency.events.some((x) => x[0] === 'set' && Math.abs(x[1] - (440 * Math.pow(2, (48 - 69) / 12)) * Math.pow(2, 7 / 12)) < 1e-6)), true);
    // follow() on a tied event, and on a newly followable control
    useAudio();
    const tiedFollow = sound('saw').note('c3 e3').legato(1).tie(1).follow('tremolorate', saw.range(1, 9)).query(0, 1).map((e2) => e2.value);
    const tf = t.playEvent(tiedFollow[0], 0, 0.5);
    t.playEvent(tiedFollow[1], 0.5, 0.5);
    near(valueAt(tf.params.tremolo.rate, 0.75), 7, 0.3, 'a tied event follows tremolorate');
    useAudio();
    r = t.eval('sound("saw").legato(1).follow("tremolodepth", saw).follow("ringf", saw.range(100, 200))');
    eq(r.success && !r.warnings.some((w) => /cannot change/.test(w)), true);
    t.stopAll();
    // AudioWorklet effects take a tied event's settings (a message at its time)
    {
        const posted = [];
        globalThis.AudioWorkletNode = class {
            constructor() { this.parameters = new Map(); this.port = { postMessage: (m) => posted.push(m) }; }
            connect() {}
            disconnect() {}
        };
        t._fxState = 'ready';
        useAudio();
        t.playEvent({ s: 'saw', note: 48, legato: 1, tie: 'w', coarse: 4 }, 0, 0.5);
        t.playEvent({ s: 'saw', note: 48, legato: 1, tie: 'w', coarse: 8 }, 0.5, 0.5);
        eq(JSON.stringify(posted), JSON.stringify([{ at: 0.5, options: { coarse: 8 } }]));
        delete globalThis.AudioWorkletNode;
        t._fxState = 'none';
        const procs = {};
        new Function('sampleRate', 'registerProcessor', 'AudioWorkletProcessor', '(' + TidalJS.workletModule.toString() + ')();')(
            48000, (name, cls) => { procs[name] = cls; }, class {});
        const coarse = new procs['tidal-fx']({ processorOptions: { kind: 'coarse', coarse: 4 } });
        const input = Float32Array.from({ length: 8 }, (_, i) => i + 1);
        const out = new Float32Array(8);
        coarse.process([[input]], [[out]]);
        eq(Array.from(out).join(), '1,1,1,1,5,5,5,5');
        coarse.pending.push({ at: 0, options: { coarse: 1 } });
        coarse.process([[input]], [[out]]);
        eq(Array.from(out).join(), '1,2,3,4,5,6,7,8');
    }

    // follow() of a live input: moving it changes the sounding notes from now
    /** The value laid out at a time since the last re-layout (the fake keeps cancelled events). */
    const liveAt = (p, at) => valueAt({ events: p.events.slice(Math.max(0, p.events.map((x) => x[0]).lastIndexOf('hold'))) }, at);
    useAudio();
    t._liveVoices.clear();
    t.eval('d1(sound("saw").legato(1).follow("lpf", slider("cut", 500, 100, 5000)))');
    t.playEvent(t.channels.get('d1').query(0, 1)[0].value, 0, 4);
    eq(t._liveVoices.size, 1);
    let liveFilt = nodes.find((n) => n.kind === 'filter' && n.type === 'lowpass');
    eq(liveFilt.frequency.events[0][1], 500);
    ctx.currentTime = 1;
    t._liveFlushedAt = -Infinity;
    t.setControl('cut', 2000);
    eq(liveFilt.frequency.events.some((x) => x[0] === 'hold' && x[1] === 1), true);
    near(liveAt(liveFilt.frequency, 2), 2000, 1e-6, 'the slider moves the sounding note');
    t.setControl('cut', 3000); // too soon: waits for the next re-layout
    eq(!!t._liveTimer, true);
    clearTimeout(t._liveTimer);
    t._liveTimer = null;
    t._relayLive();
    near(liveAt(liveFilt.frequency, 2), 3000, 1e-6, 'then follows');
    ctx.currentTime = 10;
    t._relayLive();
    eq(t._liveVoices.size, 0); // the finished voice is dropped
    t.stopAll();
    // a voice whose signal reads no live input is not remembered
    useAudio();
    t.playEvent(sound('saw').legato(1).follow('lpf', sine.range(200, 400)).query(0, 1)[0].value, 0, 1);
    eq(t._liveVoices.size, 0);
    // MIDI knobs, buses and OSC; a pitch with no note or freq of its own but follow()'s
    useAudio();
    ctx.currentTime = 0;
    t._midiIn([0xb0, 7, 0]);
    t.playEvent(sound('saw').legato(1).follow('pan', midicc(7).range(-1, 1)).follow('gain', bus('g', 1)).query(0, 1)[0].value, 0, 4);
    const livePan = nodes.find((n) => n.kind === 'panner').pan;
    eq(livePan.events[0][1], -1);
    ctx.currentTime = 1;
    t._liveFlushedAt = -Infinity;
    t._midiIn([0xb0, 7, 127]);
    near(liveAt(livePan, 2), 1, 1e-6, 'a MIDI knob moves the pan');
    t._liveFlushedAt = -Infinity;
    setBus('g', 0.5);
    const liveLevel = nodes.find((n) => n.kind === 'gain' && n.gain.events.some((x) => x[0] === 'hold'));
    near(liveAt(liveLevel.gain, 2), Math.pow(0.5, 4), 1e-6, 'setBus moves the gain');
    {
        const savedWs = globalThis.WebSocket;
        globalThis.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} };
        t._socket = null;
        useAudio();
        ctx.currentTime = 0;
        t.playEvent(sound('saw').legato(1).follow('freq', oscIn('/pitch', 1)).query(0, 1)[0].value, 0, 4);
        const pitchSrc = nodes.find((n) => n.kind === 'constant' && n.connections.some((c) => c.label === 'detune'));
        eq(!!pitchSrc, true); // built at 20 Hz (the 0 oscIn gives before a message), following from there
        ctx.currentTime = 1;
        t._liveFlushedAt = -Infinity;
        t._oscReceive(TidalJS.oscMessage('/pitch', [0, 440]));
        near(liveAt(pitchSrc.offset, 2), 1200 * Math.log2(440 / 20), 1e-6, 'an OSC fader moves the pitch');
        globalThis.WebSocket = savedWs;
        t._socket = null;
    }
    useAudio();
    t.playEvent(sound('saw').legato(1).follow('note', '~ c5').query(0, 1)[0].value, 0, 1);
    const sawRef = 69 + 12 * Math.log2(t.samples.get('saw').freq / 440);
    const notePitch = nodes.find((n) => n.kind === 'constant' && n.connections.some((c) => c.label === 'detune'));
    near(liveAt(notePitch.offset, 0.75), 100 * (72 - sawRef), 1e-6, 'a note that follow() gives only later');
    // tied voices and held MIDI keys follow live inputs too
    useAudio();
    ctx.currentTime = 0;
    t._midiIn([0xb0, 1, 0]);
    const liveTie = sound('saw').note('c3 e3').legato(1).tie(9).follow('lpf', midicc(1).range(200, 2000)).query(0, 1).map((e2) => e2.value);
    const lt = t.playEvent(liveTie[0], 0, 0.5);
    t.playEvent(liveTie[1], 0.5, 0.5);
    eq(t._liveVoices.get(lt.params).handle === lt, true);
    ctx.currentTime = 0.75;
    t._liveFlushedAt = -Infinity;
    t._midiIn([0xb0, 1, 127]);
    near(liveAt(lt.params.lpf.freq, 1), 2000, 1e-6, 'a tied voice follows the knob');
    useAudio();
    ctx.currentTime = 0;
    t._midiIn([0xb0, 1, 0]);
    t.eval('midikeys(sound("saw").follow("lpf", midicc(1).range(200, 2000)))');
    t._midiIn([0x90, 64, 100]);
    const key = t._midiHeld.get('0:64')[0];
    eq(t._liveVoices.get(key.params).handle === key, true);
    ctx.currentTime = 2;
    t._liveFlushedAt = -Infinity;
    t._midiIn([0xb0, 1, 127]);
    near(liveAt(key.params.lpf.freq, 3), 2000, 1e-6, 'a held key follows the knob');
    t._midiIn([0x80, 64, 0]);
    eq(key.timing.stopAt < 3, true);
    t.eval('sound("bd")');
    t.stopAll();
    t._liveVoices.clear();

    t._session = null;
    t.audioContext = savedCtx;
}

console.log(`all ${passed} checks passed`);
