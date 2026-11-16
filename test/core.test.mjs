/**
 * Regression tests for the evaluation, scheduling and sample-loading core of
 * tidal.js: staged commands and rollback, one-shots and runtime errors, the
 * scheduler's ordering and tempo changes, live-update stream identity, and
 * sample URLs and retries. Node, a fake audio context and a fake clock.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(fs.readFileSync(new URL('../tidal.js', import.meta.url), 'utf8'), { filename: 'tidal.js' });
const { TidalJS } = globalThis;
console.error = () => {};
console.warn = () => {};

let passed = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };
const ok = (v, msg) => { assert.ok(v, msg); passed++; };

/** A gain node whose ramps are recorded, to tell a torn-down session. */
const ramps = [];
const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime(v, time) { ramps.push([this, v, time]); }, cancelScheduledValues() {} });
const node = () => ({ connect() {}, disconnect() {}, gain: param() });
const t = new TidalJS();
t.audioContext = { currentTime: 0, state: 'running', createGain: node, resume() {} };
t.masterGain = node();
t.setupGlobalFunctions();
t._startTimer = () => {};
t._stopTimer = () => {};
const timeouts = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; };
globalThis.clearTimeout = () => {};

/** Plays the scheduler from `fromMs` to `toMs` (fake clock), recording what plays. */
function run(fromMs, toMs, step = 25) {
    const out = [];
    const saved = t.playEvent;
    t.playEvent = (v, time, duration) => { out.push({ s: v.s, time: +time.toFixed(6), duration: +duration.toFixed(6), orbit: v.orbit }); };
    for (let ms = fromMs; ms <= toMs; ms += step) {
        t.audioContext.currentTime = ms / 1000;
        t._tick();
    }
    t.playEvent = saved;
    return out;
}
const reset = () => {
    t.stopAll();
    t.unmuteAll();
    t.unsoloAll();
    t.setCPS(1);
    t.setOutput(0.8, true);
    t.audioContext.currentTime = 0;
};

// ---------------------------------------------------------------- 2. Evaluation rollback
{
    reset();
    let r = t.eval('setCPS(0.5)\nslider("cutoff", 0.3)\nd1(sound("bd"))');
    eq(r.success, true);
    eq(t.cps, 0.5);
    const playing = t.channels.get('d1');
    const shots = [];
    const savedOnce = t.playOnce;

    // A command followed by an error: nothing of it happens.
    r = t.eval('setCPS(2)\nhush()\nsetOutput(0.1, false)\nmute(1)\nsolo("d2")\nonce(sound("cp"))\nresetCycles()\nsetBus("x", 3)\nslider("other", 1)\nd1(sound("sn"))\nthrow new Error("boom")');
    eq(r.success, false);
    eq(t.cps, 0.5, 'tempo kept');
    eq(t.channels.get('d1'), playing, 'stream kept');
    eq(t.isPlaying, true, 'transport kept');
    eq([t._outputGain, t._limiterOn], [0.8, true], 'output kept');
    eq([t.muted.size, t.soloed.size], [0, 0], 'mute and solo kept');
    eq(t._oneShots.size, 0, 'no one-shot played');
    eq(t.buses.has('x'), false, 'bus kept');
    eq(t.controls().map((c) => c.name), ['cutoff'], 'live controls kept');

    // A command followed by a warning, in a live update held back by it: nothing happens either.
    r = t.eval('setCPS(2)\nhush()\nsetOutput(0.1, false)\nmute(1)\nonce(sound("cp"))\nd1(sound("zz"))', { keepOnWarnings: true, keepUnchanged: true });
    eq(r.pending, true);
    eq([t.cps, t.channels.get('d1') === playing, t.isPlaying, t._outputGain, t.muted.size, t._oneShots.size], [0.5, true, true, 0.8, 0, 0]);

    // The same commands commit, in order, with code that plays.
    t.playOnce = (p) => (t._txn ? savedOnce.call(t, p) : shots.push(p));
    r = t.eval('setCPS(2)\nsetOutput(0.5, false)\nmute(2)\nonce(sound("cp"))\nd1(sound("sn").gain(getcps()))');
    eq(r.success, true);
    eq([t.cps, t._outputGain, t._limiterOn, t.muted.has('d2'), shots.length], [2, 0.5, false, true, 1]);
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 2, 'getcps() sees the staged tempo');
    t.playOnce = savedOnce;

    // hush() then a stream in the same code: the stream plays, from silence (no history).
    r = t.eval('hush()\nxfadeIn(1, 4, sound("hh"))');
    eq([r.success, t.isPlaying, t.streams.get('d1').history.length], [true, true, 0]);

    // Recording and export wait for the commit too; a dropped evaluation never calls them.
    let stops = 0;
    const savedStop = t.stopRecording;
    t.stopRecording = () => { stops++; return Promise.resolve(null); };
    t.eval('stopRecording()\nthrow new Error("no")');
    eq(stops, 0);
    t.eval('stopRecording()\nd1(sound("bd"))');
    eq(stops, 1);
    t.stopRecording = savedStop;
}

// ---------------------------------------------------------------- 7. One-shots and runtime errors
{
    reset();
    const sessions = [];
    const saved = t.playEvent;
    t.playEvent = function (v) { sessions.push(this._session); };
    // A standalone once(): code with no loops used to stop the clock and with it the one-shot's session.
    let r = t.eval('once(sound("bd sn"))');
    eq([r.success, r.activePatterns, t.isPlaying], [true, 0, false]);
    eq(sessions.length, 2);
    ok(sessions[0] && sessions[0] === sessions[1], 'its events play in their own session');
    eq(t._oneShots.size, 1);
    const shotSession = sessions[0];
    const tornDown = () => ramps.some(([p, v]) => p === shotSession.out.gain && v === 0);
    // Other evaluations (with or without loops) do not cut it.
    t.eval('// nothing');
    t.eval('d1(sound("hh"))');
    t.eval('');
    eq([t._oneShots.size, tornDown()], [1, false]);
    // first() plays cycle 0 fully and stays independent of the loop that starts with it.
    sessions.length = 0;
    t.eval('first(sound("a b c d"))\nd1(sound("hh"))');
    eq(sessions.length, 4);
    ok(sessions.every((s) => s === sessions[0]) && sessions[0] !== t._session, 'first() has its own session, not the loop\'s');
    // Stop ends them all.
    t.stopAll();
    eq([t._oneShots.size, tornDown()], [0, true]);
    // Left alone, a one-shot's graph goes after its tails (a timer).
    t.eval('once(sound("bd"))');
    const shot = [...t._oneShots][0];
    timeouts[timeouts.length - 1].fn();
    eq(t._oneShots.has(shot), false);
    t.playEvent = saved;

    // A stream that fails while playing goes (from the streams too); the others play on.
    reset();
    const errors = [];
    t.onError = (error, info) => errors.push([error.message, info]);
    t.eval('d1(sound("bd*2"))\nd2(sound("hh*2"))');
    const failing = { query() { throw new Error('bad pattern'); } };
    t.channels.set('d2', failing);
    let played = run(0, 100);
    eq(errors, [['bad pattern', { stream: 'd2', stopped: false }]]);
    eq([t.channels.has('d2'), t.streams.has('d2'), t.isPlaying], [false, false, true]);
    ok(played.every((e) => e.s === 'bd') && played.length > 0, 'd1 plays on');
    // The last one failing stops the clock and says so.
    t.channels.set('d1', failing);
    played = run(125, 200);
    eq(errors[1], ['bad pattern', { stream: 'd1', stopped: true }]);
    eq([t.isPlaying, t.channels.size, t.streams.size], [false, 0, 0]);
    t.onError = null;
}

// ---------------------------------------------------------------- 5. Scheduler and clock
{
    reset();
    t.lookahead = 1;
    // Unsorted stacked events, two streams sharing an orbit, a nudged onset: played in the order they sound.
    t.eval('d1(stack(sound("x").late(0.5), sound("y")).orbit(1))\nd2(sound("z").late(0.25).orbit(1))\nd3(sound("n").nudge(0.1).orbit(1))');
    let played = run(0, 0);
    eq(played.map((e) => e.s + '@' + e.time), ['y@0.05', 'n@0.15', 'z@0.3', 'x@0.55']);
    // Simultaneous events: the streams' order, then each stream's own.
    reset();
    t.lookahead = 0.5;
    t.eval('d1(sound("b a"))\nd2(sound("c"))\nd3(stack(sound("e"), sound("d")))');
    played = run(0, 0);
    eq(played.filter((e) => e.time === 0.05).map((e) => e.s), ['b', 'c', 'e', 'd']);

    // An event's tempo change takes effect at its onset for every event from there, in every stream.
    reset();
    t.lookahead = 1.5;
    t.eval('d1(sound("a*4"))\nd2(sound("b").cps("<1 2 2 2 2 2 2 2>"))');
    played = run(0, 0);
    const a = played.filter((e) => e.s === 'a');
    // Cycle 0 at 1 cps from 0.05 s; cycle 1 starts at 1.05 s at 2 cps (the window ends at cycle 1.45).
    eq(a.map((e) => e.time), [0.05, 0.3, 0.55, 0.8, 1.05, 1.175]);
    eq(a.map((e) => e.duration), [0.25, 0.25, 0.25, 0.25, 0.125, 0.125]);
    // Continuity: the next window carries on from the new mapping, with no repeats or gaps.
    const more = run(25, 400).filter((e) => e.s === 'a');
    eq(more[0].time, 1.3);
    for (let i = 1; i < more.length; i++) eq(+(more[i].time - more[i - 1].time).toFixed(6), 0.125);

    // setCPS while playing: the playhead does not jump, and what was scheduled keeps its times.
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a*4"))');
    run(0, 500);
    t.audioContext.currentTime = 0.5;
    const before = t.getCyclePosition();
    t.setCPS(2);
    eq(+t.getCyclePosition().toFixed(9), +before.toFixed(9), 'playhead continuous');
    const after = run(525, 1000);
    for (let i = 1; i < after.length; i++) ok(after[i].time > after[i - 1].time, 'monotonic');
    eq(+(after[after.length - 1].time - after[after.length - 2].time).toFixed(6), 0.125);
    t.lookahead = 0.1;
}

// ---------------------------------------------------------------- 8. Live updates
{
    reset();
    const live = { keepOnWarnings: true, keepUnchanged: true };
    // A change that first shows at cycle 8 (every 8) is committed, although the next cycles look the same.
    t.eval('d1(sound("bd").every(8, (x) => x.fast(2)))');
    t._nextCycle = 1;
    t.eval('d1(sound("bd").every(8, (x) => x.fast(4)))', live);
    eq(t.channels.get('d1').query(8, 9).length, 4);
    // A changed helper changes the streams that use it, and only those.
    t.eval('const soft = (p) => p.gain(0.5)\nconst loud = (p) => p.gain(1)\nxfadeIn(1, 8, soft(sound("sn")))\nxfadeIn(2, 8, loud(sound("hh")))');
    const d1 = t.channels.get('d1');
    const d2 = t.channels.get('d2');
    t.eval('const soft = (p) => p.gain(0.25)\nconst loud = (p) => p.gain(1)\nxfadeIn(1, 8, soft(sound("sn")))\nxfadeIn(2, 8, loud(sound("hh")))', live);
    ok(t.channels.get('d1') !== d1, 'd1 uses the changed helper');
    eq(t.channels.get('d2'), d2, 'd2 does not: its transition runs on');
    eq(t.streams.get('d1').pattern.query(0, 1)[0].value.gain, 0.25);
    // Helpers that use helpers: a change two levels down counts.
    t.eval('const base = 0.5\nconst level = () => base\nd1(sound("bd").gain(level()))');
    const kept = t.channels.get('d1');
    t.eval('const base = 0.5\nconst level = () => base\nd1(sound("bd").gain(level()))', live);
    eq(t.channels.get('d1'), kept, 'identical code keeps the stream');
    t.eval('const base = 0.7\nconst level = () => base\nd1(sound("bd").gain(level()))', live);
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 0.7);
    // Any other statement (an assignment, a setCPS) counts for every stream.
    t.eval('let n = 1\nn = 2\nd1(sound("bd").gain(n))');
    const before = t.channels.get('d1');
    t.eval('let n = 1\nn = 3\nd1(sound("bd").gain(n))', live);
    ok(t.channels.get('d1') !== before);
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 3);
    // Play (not live) always starts the streams again.
    const now = t.channels.get('d1');
    t.eval('let n = 1\nn = 3\nd1(sound("bd").gain(n))');
    ok(t.channels.get('d1') !== now);
}

// ---------------------------------------------------------------- 13. Sample URLs and retries
{
    reset();
    const fetched = [];
    let manifest = { _base: 'audio/', kick: ['k.wav', '/root/r.wav', 'https://abs.test/a.wav'] };
    globalThis.fetch = async (url) => {
        fetched.push(url);
        if (url.endsWith('.json')) return { ok: true, url: 'https://cdn.test/moved/strudel.json', json: async () => manifest };
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    // A relative _base follows the manifest where it ended up (after a redirect).
    await samples('https://example.test/kit/strudel.json');
    eq(t.sampleBanks.get('kick'), ['https://cdn.test/moved/audio/k.wav', 'https://cdn.test/root/r.wav', 'https://abs.test/a.wav']);
    // No _base: next to the manifest.
    manifest = { snare: ['s.wav'] };
    await samples('https://example.test/other/strudel.json');
    eq(t.sampleBanks.get('snare'), ['https://cdn.test/moved/s.wav']);
    // Banks given in code: relative to the page, or to the base given.
    globalThis.document = { baseURI: 'https://app.test/editor/index.html' };
    await samples({ tom: ['t.wav'] });
    await samples({ rim: ['r.wav'] }, 'kits/');
    await samples({ cy: ['/c.wav'], _base: 'https://cdn.test/x/' });
    eq([t.sampleBanks.get('tom')[0], t.sampleBanks.get('rim')[0], t.sampleBanks.get('cy')[0]],
        ['https://app.test/editor/t.wav', 'https://app.test/editor/kits/r.wav', 'https://cdn.test/c.wav']);
    delete globalThis.document;

    // A file that does not decode: reported once, not asked for again by every event, retried on request.
    let decodes = 0;
    t.audioContext.decodeAudioData = async () => {
        decodes++;
        if (decodes === 1) throw new Error('bad data');
        return { duration: 1, numberOfChannels: 1, length: 1, sampleRate: 1 };
    };
    let notified = 0;
    const stop = t.onSamples(() => notified++);
    const url = 'https://cdn.test/moved/audio/k.wav';
    eq(t._sampleBuffer(url, false), null);
    await t.whenSamplesLoaded();
    for (let i = 0; i < 5; i++) eq(t._sampleBuffer(url, false), null);
    await t.whenSamplesLoaded();
    eq(fetched.filter((u) => u === url).length, 1, 'no repeated automatic requests');
    eq(t.sampleFailures().map((f) => f.source), [url]);
    ok(notified >= 1, 'listeners hear of it');
    eq(t.retrySamples(), 1);
    eq(t.sampleFailures().length, 0);
    t._sampleBuffer(url, false);
    await t.whenSamplesLoaded();
    ok(t._sampleBuffer(url, false), 'recovered after a retry');
    eq(fetched.filter((u) => u === url).length, 2);
    stop();

    // After the banks load, unknown names in what plays are found without running the code again.
    t.eval('d1(sound("kick nope"))');
    eq(t.soundWarnings(), ['Unknown sound "nope"']);
    t.stopAll();
}

// ---------------------------------------------------------------- Review follow-up
{
    // 2. A rejected edit cannot replace a bank the performance uses, nor its streams or tempo.
    reset();
    await samples({ bd: ['https://cdn.test/old.wav'] });
    t.eval('setCPS(0.5)\nd1(sound("bd*2"))');
    const playing = t.channels.get('d1');
    let r = t.eval('samples({ bd: ["https://cdn.test/new.wav"] })\nsetCPS(2)\nd1(sound("bd*4"))\nthrow new Error("no")');
    await Promise.resolve(); await Promise.resolve();
    eq(r.success, false);
    eq([t.sampleBanks.get('bd'), t.cps, t.channels.get('d1') === playing], [['https://cdn.test/old.wav'], 0.5, true]);
    // Held back by a warning (in a live update), the same: and a stream used twice is a warning.
    r = t.eval('samples({ bd: ["https://cdn.test/new.wav"] })\nsetCPS(2)\nd1(sound("bd*4"))\nd1(sound("bd*8"))', { keepOnWarnings: true, keepUnchanged: true });
    await Promise.resolve(); await Promise.resolve();
    eq(r.pending, true);
    ok(r.warnings.some((w) => /used twice/.test(w)));
    eq([t.sampleBanks.get('bd'), t.cps, t.channels.get('d1') === playing], [['https://cdn.test/old.wav'], 0.5, true]);
    // Committed: the new bank is used (without an "unknown sound" warning for a bank the same code adds).
    r = t.eval('samples({ kit: ["https://cdn.test/k.wav"] })\nd1(sound("kit"))', { keepOnWarnings: true });
    eq([r.success, r.warnings], [true, []]);
    await t.whenSamplesLoaded();
    eq(t.sampleBanks.get('kit'), ['https://cdn.test/k.wav']);
}
{
    // 3. Across ticks: a hit nudged to 0.550 s waits for its tick, so a hit at 0.175 s from a later tick goes first.
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a").nudge(0.5))\nd2(sound("b").late(0.125))');
    const played = run(0, 600);
    eq(played.map((e) => e.s + '@' + e.time).slice(0, 2), ['b@0.175', 'a@0.55']);
    for (let i = 1; i < played.length; i++) ok(played[i].time >= played[i - 1].time, 'sent in the order they sound');
    // Stop drops what was held back.
    t.eval('d1(sound("a").nudge(0.9))');
    run(625, 1000); // cycle 1 enters the window; its hit (at 1.95 s) waits
    eq(t._nudged.length > 0, true);
    t.stopAll();
    eq(t._nudged.length, 0);

    // A note's length is fixed at its onset, at the tempo then: a tempo change met in a later tick
    // (or in the same one) does not change it.
    for (const lookahead of [0.1, 1.5]) {
        reset();
        t.lookahead = lookahead;
        t.eval('d1(sound("long"))\nd2(sound("~ x").cps(2))');
        const notes = run(0, 1200).filter((e) => e.s === 'long');
        eq(notes[0].duration, 1, 'one cycle at 1 cps, whatever the lookahead');
    }
    t.lookahead = 0.1;
}
{
    // 4. Unicode names: a changed declaration changes the stream that uses it.
    reset();
    const live = { keepOnWarnings: true, keepUnchanged: true };
    t.eval('const café = 0.2\nd1(sound("bd").gain(café))');
    t.eval('const café = 0.7\nd1(sound("bd").gain(café))', live);
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 0.7);
    t.eval('const ñandú = 1, 𝑥 = 0.3\nd1(sound("bd").gain(𝑥))');
    t.eval('const ñandú = 1, 𝑥 = 0.4\nd1(sound("bd").gain(𝑥))', live);
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 0.4);
    // When the reading cannot be certain (eval, globalThis...), streams are rebuilt, never kept.
    t.eval('globalThis.level = 0.5\nd1(sound("bd"))');
    const before = t.channels.get('d1');
    t.eval('globalThis.level = 0.5\nd1(sound("bd"))', live);
    ok(t.channels.get('d1') !== before, 'rebuilt when unsure');

    // Division after a multiline function expression stays one statement (as Node reads it).
    eq(TidalJS.splitStatements('const x = function() {}\n/2/1;'), ['const x = function() {}\n/2/1']);
    eq(TidalJS.splitStatements('const C = class {}\n/2/1\nd1(sound("bd"))'), ['const C = class {}\n/2/1', 'd1(sound("bd"))']);
    eq(t.eval('const x = function() {}\n/2/1;\nd1(sound("bd"))').success, true);
    // And a function declaration is still followed by a regular expression.
    eq(TidalJS.splitStatements('function f() {}\n/re/.test("x")'), ['function f() {}', '/re/.test("x")']);
    t.stopAll();
}

globalThis.setTimeout = realSetTimeout;
console.log(`core: all ${passed} checks passed`);
