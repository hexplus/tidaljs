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
eq(sup.query(0, 1).filter((e) => e.value.up === 12).length, 4);
eq(q(struct('x ~ x x', sound('bd sn'))), 'bd@0 sn@0.5 sn@0.75');
eq(q(sound('bd sn').struct('t t t t')), 'bd@0 bd@0.25 sn@0.5 sn@0.75');
eq(q(struct('1 0 1', 'hh')), 'hh@0 hh@0.6667');

// Musical controls
eq(q(sound('arpy').note('c e g c5')), 'arpy/60@0 arpy/64@0.25 arpy/67@0.5 arpy/72@0.75');
eq(q(sound('arpy*4').note('c e')), 'arpy/60@0 arpy/60@0.25 arpy/64@0.5 arpy/64@0.75');
eq(sound('arpy').note('eb3 f#').query(0, 1).map((e) => e.value.note).join(), '51,66');
eq(sound('arpy').note('0 7').query(0, 1).map((e) => e.value.note).join(), '60,67');
eq(sound('arpy').note('c e g').up('0 12 7').query(0, 1).map((e) => e.value.up).join(), '0,12,7');
eq(sound('sine').freq('440 554 659').query(0, 1).map((e) => e.value.freq).join(), '440,554,659');
eq(sound('arpy').midinote('60 64 67').query(0, 1).map((e) => e.value.midinote).join(), '60,64,67');
eq(sound('bd sn').n('0 1').query(0, 1).map((e) => e.value.n).join(), '0,1');
eq(sound('bd').up(0.5).query(0, 1)[0].value.up, 0.5);
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
assert.throws(() => sound('bd').fast('x'), /fast\(\) expects a number/); passed++;
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
r = t.eval('sound("bd").fast("x")');
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
let er = t.eval('sound("bd")\n\nsound("hh").fast("x")');
eq(er.success, false);
eq(er.location.line, 3);
eq(JSON.stringify([er.location.start, er.location.end]), JSON.stringify([13, 34]));
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
eq(sound('arpy').n('<0 .. 2>').query(2, 3)[0].value.n, 2);
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
const off = sound('arpy').off(0.25, (x) => x.up(12)).query(0, 1).map((e) => `${e.value.up ?? 0}@${e.begin}`).sort().join(' ');
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
    eq(voices.slice(4).map((v) => v.time).join(), '5,5.5');
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
    eq(qv(sound('a').foldEvery([2, 3], (x) => x.fast(2)), 0, 4), 'a@0 a@0.5 a@1 a@2 a@2.5 a@3 a@3.5');
    eq(qv(sound('a b c d').inside(2, (x) => x.rev())), 'b@0 a@0.25 d@0.5 c@0.75');
    eq(qv(sound('<[a b] [c d]>').outside(2, (x) => x.rev()), 0, 2), 'd@0 c@0.5 b@1 a@1.5');
    eq(qv(sound('a b c d').chunkBack(4, (x) => x.gain(0)), 0, 1), 'a@0 b@0.25 c@0.5 d,gain=0@0.75');
    eq(qv(sound('bd sn').fix((x) => x.speed(2), { s: 'bd' })), 'bd,speed=2@0 sn@0.5');
    eq(qv(sound('bd sn').unfix((x) => x.speed(2), { s: 'bd' })), 'bd@0 sn,speed=2@0.5');
    eq(qv(sound('a b').spread((p, x) => p.fast(x), [1, 2]), 0, 2), 'a@0 b@0.5 a@1 b@1.25 a@1.5 b@1.75');
    eq(qv(sound('a b').pickF('<0 1>', [(x) => x.rev(), (x) => x.fast(2)]), 0, 2), 'b@0 a@0.5 a@1 b@1.25 a@1.5 b@1.75');
    eq(qv(sound('a b').soak(3, (x) => x.fast(2)), 2, 3), 'a@2 b@2.125 a@2.25 b@2.375 a@2.5 b@2.625 a@2.75 b@2.875');
    eq(qv(sound('a').always((x) => x.fast(2))), 'a@0 a@0.5');
    eq(qv(sound('a').never((x) => x.fast(2))), 'a@0');

    // Echoes: Tidal's gains (stut: feedback + (1 - feedback) * (count - x) / count)
    eq(qv(sound('bd').echo(3, 0.2, 0.5)), 'bd@0 bd,gain=0.5@0.2 bd,gain=0.25@0.4');
    eq(qv(sound('bd').stut(3, 0.5, 0.125)), 'bd@0 bd,gain=0.833@0.125 bd,gain=0.667@0.25');
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
    eq(qv(select('<0 0.5>', [sound('a'), sound('b')]), 0, 2), 'a@0 b@1');
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
    eq(qv(sound('drum').add(s(':3'))), 'drum,n=3@0');
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
    eq([sound('bd sn').steps(), sound('bd [sn sn]').steps(), sound('bd@3 sn').steps(), sound('<a b>').steps(), sound('{a b c}%4').steps()].join(), '2,2,4,1,4');
    eq(sound('bd sn').fast(2).n(1).steps(), 2);
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
    eq(qs(t.channels.get('d1'), 4, 5), 'sn,gain=1@4 sn,gain=1@4.5');
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

console.log(`all ${passed} checks passed`);
