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
    // Cycle 0 at 1 cps from 0.05 s; cycle 1 starts at 1.05 s at 2 cps. What sounds before the 1.5 s horizon goes
    // out (events are asked for 0.2 s further, so cycle 1.5, at 1.3 s, is known in time).
    eq(a.map((e) => e.time), [0.05, 0.3, 0.55, 0.8, 1.05, 1.175, 1.3]);
    eq(a.map((e) => e.duration), [0.25, 0.25, 0.25, 0.25, 0.125, 0.125, 0.125]);
    // Continuity: the next window carries on from the new mapping, with no repeats or gaps.
    const more = run(25, 400).filter((e) => e.s === 'a');
    eq(more[0].time, 1.425);
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

// ---------------------------------------------------------------- Review round 3
{
    // 2. The document's tempo goes in with the code: applied only by a commit; a setCPS() in the code wins.
    reset();
    t.eval('d1(sound("bd"))');
    eq(t.cps, 1);
    eq(t.eval('d1(sound("sn"))\nthrow new Error("no")', { cps: 1.75 }).success, false);
    eq(t.cps, 1, 'a failed evaluation keeps the previous tempo');
    eq(t.eval('d1(sound("sn*4"))\nd1(sound("hh"))', { cps: 1.75, keepOnWarnings: true }).pending, true);
    eq(t.cps, 1, 'so does one held back by warnings');
    t.eval('d1(sound("sn"))', { cps: 1.75 });
    eq(t.cps, 1.75, 'a commit applies it');
    t.eval('setCPS(0.5)\nd1(sound("sn"))', { cps: 1.75 });
    eq(t.cps, 0.5, 'the code\'s own setCPS has the last word');
}
{
    // 3. Bank registration is deterministic: in the order the samples() calls ran, whatever arrives first.
    reset();
    const slow = {};
    // Manifests answer when the test says so; sample files at once.
    globalThis.fetch = (url) => (url.endsWith('.json')
        ? new Promise((resolve) => { slow[url] = () => resolve({ ok: true, url, json: async () => ({ bd: ['old.wav'] }) }); })
        : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const older = samples('https://slow.test/a/strudel.json');
    await samples({ bd: ['https://cdn.test/newer.wav'] });
    slow['https://slow.test/a/strudel.json']();
    await older;
    eq(t.sampleBanks.get('bd'), ['https://cdn.test/newer.wav'], 'an older manifest does not replace a newer bank');
    // Within one evaluation, the same: the later samples() wins.
    t.eval('samples("https://slow.test/b/strudel.json")\nsamples({ bd: ["https://cdn.test/later.wav"] })\nd1(sound("bd"))');
    await Promise.resolve();
    slow['https://slow.test/b/strudel.json']();
    await t.whenSamplesLoaded();
    await Promise.resolve();
    eq(t.sampleBanks.get('bd'), ['https://cdn.test/later.wav']);
    // An inline bank is in use for a first() after it in the same code.
    const seen = [];
    const savedPlay = t.playEvent;
    t.playEvent = function (v) { seen.push(this.sampleBanks.get(v.s)); };
    t.eval('samples({ kit2: ["https://cdn.test/kit2.wav"] })\nfirst(sound("kit2"))');
    t.playEvent = savedPlay;
    eq(seen, [['https://cdn.test/kit2.wav']]);
    // A failed manifest: rejects for whoever awaits it, is reported, and is never an unhandled rejection.
    let unhandled = 0;
    const onUnhandled = () => { unhandled++; };
    process.on('unhandledRejection', onUnhandled);
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    t.eval('samples("https://broken.test/x/strudel.json")\nd1(sound("bd"))');
    samples('https://broken.test/y/strudel.json'); // nobody awaits it
    await assert.rejects(() => samples('https://broken.test/z/strudel.json'), /HTTP 500/); passed++;
    await t.whenSamplesLoaded();
    await new Promise((r) => realSetTimeout(r, 20));
    process.off('unhandledRejection', onUnhandled);
    eq(unhandled, 0, 'no unhandled rejections');
    ok(t.sampleFailures().some((f) => f.source.includes('broken.test/x')), 'reported to the editor');
    t.retrySamples();
}
{
    // 4. Held events know their stream: muted, replaced or removed before their time, they do not play.
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a").nudge(0.5))\nd2(sound("b"))');
    run(0, 50);
    ok(t._nudged.some((it) => it.v.s === 'a'), 'held back');
    t.mute('d1');
    let played = run(75, 700);
    ok(!played.some((e) => e.s === 'a'), 'muted before its time: not played');
    t.unmuteAll();
    reset();
    t.eval('d1(sound("a").nudge(0.5))\nd2(sound("b"))');
    run(0, 50);
    t.eval('d1(sound("c"))\nd2(sound("b"))'); // replaced
    played = run(75, 700);
    ok(!played.some((e) => e.s === 'a'), 'replaced: not played');
    reset();
    t.eval('d1(sound("a").nudge(0.5))\nd2(sound("b"))');
    run(0, 50);
    t.eval('d2(sound("b"))'); // removed
    played = run(75, 700);
    ok(!played.some((e) => e.s === 'a'), 'removed: not played');

    // A sharp slowdown with a dense pattern: every event still goes out, on time and in order,
    // also on ticks that have no new cycles to ask for.
    reset();
    t.eval('d1(sound("x*16"))\nd2(sound("~ s").cps(0.1))');
    played = run(0, 6000).filter((e) => e.s === 'x');
    const firstCycle = played.slice(0, 16).map((e) => e.time);
    const expected = [];
    for (let k = 0; k < 8; k++) expected.push(+(0.05 + k / 16).toFixed(6));
    for (let k = 0; k < 8; k++) expected.push(+(0.55 + k * 0.625).toFixed(6));
    eq(firstCycle, expected);
    for (let i = 1; i < played.length; i++) ok(played[i].time > played[i - 1].time, 'in order');
}
{
    // 6. An unused declaration whose initialiser writes what a stream reads makes that stream change.
    reset();
    const live = { keepOnWarnings: true, keepUnchanged: true };
    t.eval('const config = { level: 0.2 }\nconst unused = (config.level = 0.9)\nd1(sound("bd").gain(config.level))');
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 0.9);
    t.eval('const config = { level: 0.2 }\nconst unused = (config.level = 0.5)\nd1(sound("bd").gain(config.level))', live);
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 0.5);
    // A call to another function in an initialiser counts the same.
    t.eval('const config = { level: 0.2 }\nconst bump = (x) => { config.level = x; return x }\nconst unused = bump(0.3)\nd1(sound("bd").gain(config.level))');
    t.eval('const config = { level: 0.2 }\nconst bump = (x) => { config.level = x; return x }\nconst unused = bump(0.6)\nd1(sound("bd").gain(config.level))', live);
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 0.6);
    // Plain pattern definitions still let unrelated streams run on (a transition is not restarted).
    t.eval('const drums = sound("bd*2").every(2, (x) => x.fast(2))\nconst fx = (p) => p.gain(0.5)\nxfadeIn(1, 8, fx(sound("sn")))\nd2(drums)');
    const d1 = t.channels.get('d1');
    t.eval('const drums = sound("bd*4").every(2, (x) => x.fast(2))\nconst fx = (p) => p.gain(0.5)\nxfadeIn(1, 8, fx(sound("sn")))\nd2(drums)', live);
    eq(t.channels.get('d1'), d1, 'd1 runs on');
    eq(t.channels.get('d2').query(1, 2).length, 4, 'd2 changed');
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 4
{
    // 1. A fetch left by a rejected evaluation does not hide an unknown sound in the next one.
    reset();
    let release;
    globalThis.fetch = (url) => (url.endsWith('.json')
        ? new Promise((resolve) => { release = () => resolve({ ok: true, url, json: async () => ({ hang: ['h.wav'] }) }); })
        : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    eq(t.eval('samples("https://hang.test/kit/strudel.json")\nd1(sound("bd"))\nthrow new Error("rejected")').success, false);
    ok(t.isLoadingSamples(), 'its manifest is still on its way');
    t.eval('d1(sound("bd*2"))');
    const working = t.channels.get('d1');
    const r = t.eval('d1(sound("bdd*2"))', { keepOnWarnings: true, keepUnchanged: true });
    eq([r.pending, r.warnings], [true, ['Unknown sound "bdd"']]);
    eq(t.channels.get('d1'), working, 'the working stream stays');
    // Code that asks for that manifest itself: any name may come from it, so no warning yet.
    eq(t.eval('samples("https://hang.test/kit/strudel.json")\nd1(sound("hang"))', { keepOnWarnings: true }).warnings, []);
    release();
    await t.whenSamplesLoaded();
}
{
    // 4. Writes the analysis must see: an unused IIFE, a class extends expression, a write in another stream.
    reset();
    const live = { keepOnWarnings: true, keepUnchanged: true };
    const gain = () => t.channels.get('d1').query(0, 1)[0].value.gain;
    t.eval('const config = { level: 0.2 }\nconst unused = (() => { config.level = 0.9 })()\nd1(sound("bd").gain(config.level))');
    t.eval('const config = { level: 0.2 }\nconst unused = (() => { config.level = 0.5 })()\nd1(sound("bd").gain(config.level))', live);
    eq(gain(), 0.5, 'unused IIFE');
    t.eval('const config = { level: 0.2 }\nconst mix = (v) => { config.level = v; return class {} }\nclass A extends mix(0.9) {}\nd1(sound("bd").gain(config.level))');
    t.eval('const config = { level: 0.2 }\nconst mix = (v) => { config.level = v; return class {} }\nclass A extends mix(0.4) {}\nd1(sound("bd").gain(config.level))', live);
    eq(gain(), 0.4, 'class extends expression');
    t.eval('const config = { level: 0.2 }\nd2(sound("hh").gain((config.level = 0.9, 1)))\nd1(sound("bd").gain(config.level))');
    t.eval('const config = { level: 0.2 }\nd2(sound("hh").gain((config.level = 0.3, 1)))\nd1(sound("bd").gain(config.level))', live);
    eq(gain(), 0.3, 'a write in another stream');
    // A helper that only computes, called by another stream, is not a write: that stream's transition runs on.
    t.eval('const soft = (p) => { const level = 0.5; return p.gain(level) }\nxfadeIn(1, 8, sound("sn"))\nd2(soft(sound("hh")))');
    const d1 = t.channels.get('d1');
    t.eval('const soft = (p) => { const level = 0.5; return p.gain(level) }\nxfadeIn(1, 8, sound("sn"))\nd2(soft(sound("hh*2")))', live);
    eq(t.channels.get('d1'), d1, 'calling a pure helper is not a write');
    t.stopAll();
}
{
    // 7. Negative nudge: up to 0.2 s, events are asked for early enough to play on time; beyond, a diagnostic.
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a*2").nudge(-0.15))');
    let played = run(0, 2000).map((e) => e.time);
    ok(played.includes(0.9) && played.includes(1.4) && played.includes(1.9), 'on time, 0.15 s early: ' + played.join());
    reset();
    const r = t.eval('d1(sound("a*2").nudge(-0.5))');
    ok(r.warnings.some((w) => /nudge -0\.5 is earlier than -0\.2 s/.test(w)), 'a warning for what cannot be honoured');
    played = run(0, 2000).map((e) => e.time);
    ok(played.includes(0.85) && played.includes(1.35), 'played as early as it can: 0.2 s');
    // A stream replaced while events were asked for ahead: no gap and no repeat at the switch.
    reset();
    t.eval('d1(sound("x*8"))');
    const before = run(0, 500);
    t.eval('d1(sound("y*8"))');
    const after = run(525, 1500);
    const all = before.concat(after).map((e) => e.time);
    eq(new Set(all).size, all.length, 'no event twice');
    for (let i = 1; i < all.length; i++) eq(+(all[i] - all[i - 1]).toFixed(6), 0.125, 'no gap at ' + all[i]);
    ok(after.some((e) => e.s === 'y') && after.every((e, i) => i === 0 || e.s === 'y' || after[i - 1].s === 'x'), 'x then y');
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 5
{
    // 1. Both sides of one edit boundary: onsets moved earlier (already sent) are not sent again by the
    // replacement; onsets moved later (still held back) are sent, by the replacement.
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a*4").nudge("-0.15 0.15"))');
    const before = run(0, 600);
    // At the edit, one onset moved earlier has gone out ahead of its cycle, and one moved later is still held.
    ok(t._nudged.some((it) => it.v.s === 'a' && it.nudge > 0), 'a later onset is held back at the edit');
    t.eval('d1(sound("b*4").nudge("-0.15 0.15"))');
    const after = run(625, 2000);
    const hits = before.concat(after);
    // Every position of the grid exactly once, each at its own nudge, in time order, a then b.
    // "-0.15 0.15": the first half of each cycle 0.15 s early, the second half 0.15 s late. The hit at cycle 0
    // would be before the start (-0.1 s) and is skipped, as always.
    const expected = [];
    for (let k = 1; k <= 8; k++) {
        const c = k * 0.25;
        expected.push(+(0.05 + c + (c % 1 < 0.5 ? -0.15 : 0.15)).toFixed(6));
    }
    expected.sort((x, y) => x - y);
    const times = hits.map((e) => e.time).filter((x) => x <= 1.95 + 1e-9);
    eq(times, expected.filter((x) => x <= 1.95 + 1e-9), 'the complete sequence');
    eq(new Set(times).size, times.length, 'nothing sent twice');
    const letters = hits.map((e) => e.s).join('');
    ok(/^a+b+$/.test(letters), 'a, then b: ' + letters);
    t.stopAll();
}
{
    // 2. A 2-cps event removed before its 0.250 s onset does not change the tempo.
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a*8"))\nd2(sound("~ x ~ ~ ~").cps(2))'); // x at cycle 0.2: 0.25 s
    run(0, 50);
    eq(t.cps, 2, 'asked for ahead: the change is made (speculatively)');
    t.eval('d1(sound("a*8"))'); // d2 removed before 0.25 s
    const played = run(75, 1100).filter((e) => e.s === 'a');
    eq(t.cps, 1, 'undone');
    for (let i = 1; i < played.length; i++) eq(+(played[i].time - played[i - 1].time).toFixed(6), 0.125, 'every hit at 1 cps');
    // A change that has taken effect stays.
    reset();
    t.eval('d1(sound("a*8"))\nd2(sound("x ~ ~ ~ ~").cps(2))'); // at cycle 0: sent at once
    run(0, 100);
    t.eval('d1(sound("a*8"))');
    run(125, 300);
    eq(t.cps, 2, 'a change already in effect is kept');
    t.stopAll();
}
{
    // 3. Live validation while manifests resolve.
    reset();
    const answers = {};
    globalThis.fetch = (url) => (url.endsWith('.json')
        ? new Promise((resolve) => {
            answers[url] = (banks, status = 200) => resolve(status === 200
                ? { ok: true, url, json: async () => banks } : { ok: false, status });
        })
        : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    const live = { keepOnWarnings: true, keepUnchanged: true };
    // A fetch other committed code left (still on its way) does not hide a typo in code that does not ask for it.
    t.eval('samples("https://other.test/a/strudel.json")\nd1(sound("bd*2"))');
    const working = t.channels.get('d1');
    let r = t.eval('d1(sound("bdd*2"))', live);
    eq([r.pending, r.warnings], [true, ['Unknown sound "bdd"']]);
    // A cached 404 does not either.
    const failing = samples('https://broken.test/b/strudel.json');
    answers['https://broken.test/b/strudel.json'](null, 404);
    await assert.rejects(failing); passed++;
    r = t.eval('samples("https://broken.test/b/strudel.json")\nd1(sound("bdd*2"))', live);
    eq([r.pending, r.warnings], [true, ['Unknown sound "bdd"']]);
    eq(t.channels.get('d1'), working);
    // A bank the code itself asks for, not arrived: the edit waits, the working stream stays.
    r = t.eval('samples("https://kit.test/c/strudel.json")\nd1(sound("zork*2"))', live);
    eq([r.pending, r.warnings, r.waitingForSamples], [true, [], ['zork']]);
    eq(t.channels.get('d1'), working, 'the working stream stays while the bank is unresolved');
    // It arrives with the name: checked again, the edit commits.
    answers['https://kit.test/c/strudel.json']({ zork: ['k.wav'] });
    await new Promise((r) => realSetTimeout(r, 10)); // that manifest has arrived (another is still on its way)
    r = t.eval('samples("https://kit.test/c/strudel.json")\nd1(sound("zork*2"))', live);
    eq([r.success, r.warnings], [true, []]);
    await Promise.resolve();
    ok(t.sampleBanks.has('zork'));
    // It arrives without the name: the edit stays held back, with the warning.
    r = t.eval('samples("https://kit.test/d/strudel.json")\nd1(sound("blip*2"))', live);
    eq(r.waitingForSamples, ['blip']);
    const playingNow = t.channels.get('d1');
    answers['https://kit.test/d/strudel.json']({ hat: ['h.wav'] });
    await new Promise((r) => realSetTimeout(r, 10));
    r = t.eval('samples("https://kit.test/d/strudel.json")\nd1(sound("blip*2"))', live);
    eq([r.pending, r.warnings], [true, ['Unknown sound "blip"']]);
    eq(t.channels.get('d1'), playingNow);
    answers['https://other.test/a/strudel.json']({});
    await t.whenSamplesLoaded();
    t.retrySamples();
    t.stopAll();
}
{
    // 4. A default parameter is code that runs: an unused call whose default writes changes the stream.
    reset();
    const live = { keepOnWarnings: true, keepUnchanged: true };
    t.eval('const config = { level: 0.2 }\nconst bump = (v = (config.level = 0.9)) => v\nconst unused = bump()\nd1(sound("bd").gain(config.level))');
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 0.9);
    t.eval('const config = { level: 0.2 }\nconst bump = (v = (config.level = 0.6)) => v\nconst unused = bump()\nd1(sound("bd").gain(config.level))', live);
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 0.6);
    // A destructuring default in the parameters, the same.
    t.eval('const config = { level: 0.2 }\nconst set = ({ v = (config.level = 0.8) } = {}) => v\nconst unused = set()\nd1(sound("bd").gain(config.level))');
    t.eval('const config = { level: 0.2 }\nconst set = ({ v = (config.level = 0.4) } = {}) => v\nconst unused = set()\nd1(sound("bd").gain(config.level))', live);
    eq(t.channels.get('d1').query(0, 1)[0].value.gain, 0.4);
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 6
/** The audio time of `cycle` on a clock that starts at 0.05 s at 1 cps and changes tempo at [cycle, cps] points. */
const timeOn = (changes, cycle) => {
    let time = 0.05;
    let at = 0;
    let cps = 1;
    for (const [c, next] of changes) {
        if (c >= cycle) break;
        time += (c - at) / cps;
        at = c;
        cps = next;
    }
    return +(time + (cycle - at) / cps).toFixed(6);
};
const hitsOf = (played, s, until) => played.filter((e) => e.s === s && e.time <= until + 1e-9).map((e) => e.time);
const gridOf = (changes, step, until) => {
    const out = [];
    for (let c = 0; timeOn(changes, c) <= until + 1e-9; c += step) out.push(timeOn(changes, c));
    return out;
};
{
    // 1. An invalid samples() argument is an error in the code: nothing waits, nothing is asked for or retried,
    // and the playing streams stay.
    reset();
    const live = { keepOnWarnings: true, keepUnchanged: true };
    t.eval('d1(sound("bd*2"))');
    const working = t.channels.get('d1');
    const loadsBefore = t._sampleLoads.size;
    for (const bad of ['samples(42)', 'samples("")', 'samples(["k.wav"])', 'samples(null)', 'samples("github:nobody")', 'samples({ k: ["k.wav"] }, 5)']) {
        for (const options of [live, {}]) {
            const r = t.eval(bad + '\nd1(sound("zonk*2"))', options);
            eq([r.success, r.pending, r.waitingForSamples, r.samplesSettled], [false, undefined, undefined, undefined], bad);
            ok(/samples\(/.test(r.error), bad + ': ' + r.error);
            eq(r.location && r.location.line, 1, 'located on the samples() line');
            eq(t.channels.get('d1'), working, 'what plays stays');
        }
    }
    eq([t.sampleFailures(), t._sampleLoads.size], [[], loadsBefore], 'no load started or failed');
    await assert.rejects(t.loadSamples(42), TypeError); passed++;

    // A manifest that fails: the held-back edit waits for that load only, and once it settles the check
    // ends in a warning: it does not wait again.
    const answers = {};
    globalThis.fetch = (url) => new Promise((resolve) => {
        answers[url] = (banks, status = 200) => resolve(status === 200 ? { ok: true, url, json: async () => banks } : { ok: false, status });
    });
    const code = 'samples("https://kit.test/r6/strudel.json")\nd1(sound("zonk*2"))';
    let r = t.eval(code, live);
    eq(r.waitingForSamples, ['zonk']);
    ok(r.samplesSettled instanceof Promise, 'tied to the load it waits for');
    let settled = false;
    r.samplesSettled.then(() => { settled = true; });
    // Another load settling does not count.
    const other = t.loadSamples('https://other.test/r6/strudel.json');
    answers['https://other.test/r6/strudel.json']({ hat: ['h.wav'] });
    await other;
    await new Promise((done) => realSetTimeout(done, 5));
    eq(settled, false, 'not settled by another load');
    answers['https://kit.test/r6/strudel.json'](null, 500);
    await r.samplesSettled;
    eq(t.sampleFailures().map((f) => f.source), ['https://kit.test/r6/strudel.json|']);
    r = t.eval(code, live);
    eq([r.pending, r.warnings, r.waitingForSamples, r.samplesSettled], [true, ['Unknown sound "zonk"'], undefined, undefined], 'settled: no new wait');
    eq(t.channels.get('d1'), working);
    t.retrySamples();
    t.stopAll();
}
{
    // 3a. Tempo requests in cycle order across ticks: a stream added later asks for a change at an earlier
    // cycle (0.45, 4 cps) than one already asked for (0.5, 2 cps); both happen, in cycle order.
    reset();
    t.lookahead = 0.1;
    const live = { keepUnchanged: true }; // (a, x, y are unknown sounds: no holding back on warnings)
    t.eval('d1(sound("a*8"))\nd2(sound("~ x").cps(2))');
    let played = run(0, 300);
    ok(t._tempoRequests.some((q) => q.cycle === 0.5), 'the 0.5 request was asked for in an earlier tick');
    t.eval('d1(sound("a*8"))\nd2(sound("~ x").cps(2))\nd3(sound("y").late(0.45).cps(4))', live);
    played = played.concat(run(325, 800));
    const changes = [[0.45, 4], [0.5, 2]];
    eq(timeOn(changes, 0.5), 0.5125);
    eq(hitsOf(played, 'a', 0.76), gridOf(changes, 0.125, 0.76), 'every hit on the reconciled clock');

    // 3b. An equal request counts: d3's 2 cps at 0.4 takes over when d2's 2 cps at 0.2 goes before its onset.
    reset();
    t.eval('d1(sound("a*8"))\nd2(sound("~ x ~ ~ ~").cps(2))\nd3(sound("~ ~ y ~ ~").cps(2))');
    played = run(0, 100);
    eq(t._tempoRequests.length, 2, 'both asked for, the second equal to the tempo before it');
    t.eval('d1(sound("a*8"))\nd3(sound("~ ~ y ~ ~").cps(2))', live);
    played = played.concat(run(125, 1000));
    eq(hitsOf(played, 'a', 0.95), gridOf([[0.4, 2]], 0.125, 0.95), '1 cps up to 0.4, then 2 cps');

    // 3c. Mute and solo: a change from a stream that is not heard does not happen; heard again before its onset,
    // it does; muted past its onset, it never happens.
    reset();
    t.eval('d1(sound("a*8"))\nd2(sound("~ x ~ ~ ~").cps(2))');
    played = run(0, 50);
    eq(t.cps, 2);
    t.mute('d2');
    eq(t.cps, 1, 'muted: undone at once');
    t.mute('d2', false);
    eq(t.cps, 2, 'heard again: back');
    t.solo('d1');
    eq(t.cps, 1, 'another stream soloed: undone');
    t.unsoloAll();
    played = played.concat(run(75, 1000));
    eq(hitsOf(played, 'a', 0.95), gridOf([[0.2, 2]], 0.125, 0.95), 'it happened at 0.2');
    reset();
    t.eval('d1(sound("a*8"))\nd2(sound("~ x ~ ~ ~").cps(2).playFor(0, 1))'); // in cycle 0 only
    played = run(0, 50);
    t.mute('d2');
    played = played.concat(run(75, 600));
    t.mute('d2', false);
    played = played.concat(run(625, 1200));
    eq(t.cps, 1, 'muted past its onset: never happened');
    eq(hitsOf(played, 'a', 1.15), gridOf([], 0.125, 1.15));

    // 3d. Stop and Reset Cycles drop the requests not sent yet and keep the committed tempo (2 cps, from cycle 0).
    reset();
    t.eval('d1(sound("a*8"))\nd2(sound("x ~ ~ ~ ~").cps("<2 3>"))');
    run(0, 300);
    eq(t.cps, 3, 'the 3 cps at cycle 1 is asked for ahead');
    t.stopAll();
    eq(t.cps, 2, 'Stop: the committed tempo');
    reset();
    t.eval('d1(sound("a*8"))\nd2(sound("x ~ ~ ~ ~").cps("<2 3>"))');
    played = run(0, 300);
    eq(t.cps, 3);
    t.resetCycles();
    eq(t.cps, 2, 'Reset Cycles: the committed tempo');
    played = played.concat(run(325, 1200));
    // Cycle 0.7 (0.4 s) becomes cycle 0: 2 cps up to the new cycle 1 (0.9 s), then 3 cps.
    eq(hitsOf(played, 'a', 1.2).filter((x) => x >= 0.4 - 1e-9),
        [0.4, 0.4625, 0.525, 0.5875, 0.65, 0.7125, 0.775, 0.8375, 0.9, 0.941667, 0.983333, 1.025, 1.066667, 1.108333, 1.15, 1.191667]);
    t.stopAll();
}
{
    // 4a. Positive nudge when the old pattern held nothing back: the new version's onsets that its nudge moves
    // past what was sent are still its to play.
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a"))');
    const before = run(0, 600);
    eq(t._nudged.length, 0, 'nothing held back at the edit');
    t.eval('d1(sound("b*4").nudge(0.3))');
    const after = run(625, 2000);
    eq(hitsOf(before, 'a', 2), [0.05]);
    eq(hitsOf(after, 'b', 1.95), [0.85, 1.1, 1.35, 1.6, 1.85], 'from cycle 0.5 (nominal 0.55 s, sounding at 0.85 s)');
    eq(hitsOf(after, 'a', 2), [], 'the old pattern sends nothing more');

    // 4b. A nudge longer than the stall threshold: onsets whose nominal time is long past but still held back
    // are handed over, every position once.
    reset();
    t.eval('d1(sound("a*4").nudge(0.8))');
    const held = run(0, 600);
    eq(held.length, 0);
    ok(t._nudged.some((it) => it.ev.begin === 0), 'cycle 0 (nominal 0.05 s) still held at 0.6 s');
    t.eval('d1(sound("b*4").nudge(0.8))');
    const handed = run(625, 2000);
    eq(handed.map((e) => e.s + '@' + e.time), ['b@0.85', 'b@1.1', 'b@1.35', 'b@1.6', 'b@1.85']);
    t.stopAll();
}
{
    // 5. Parameter bindings that run code (a computed key, a default) make the function not pure: a call
    // to it counts as a write, so editing what it runs rebuilds the streams.
    reset();
    const live = { keepOnWarnings: true, keepUnchanged: true };
    const gain = () => t.channels.get('d1').query(0, 1)[0].value.gain;
    const program = (level) => `const config = { level: 0.2 }\nfunction touch() { config.level = ${level}; return "k" }\nfunction f({ [touch()]: x }) { return x }\nconst unused = f({})\nd1(sound("bd").gain(config.level))`;
    t.eval(program(0.9));
    eq(gain(), 0.9);
    t.eval(program(0.5), live);
    eq(gain(), 0.5, 'a computed key in the parameters');
    const counter = (step) => `const config = { level: 0.1 }\nconst keys = ["a"]\nconst f = ({ [keys[config.level += ${step}, 0]]: x }) => x\nconst unused = f({})\nd1(sound("bd").gain(config.level))`;
    t.eval(counter(0.2));
    t.eval(counter(0.4), live);
    eq(+gain().toFixed(6), 0.5, 'a computed key with an assignment');
    const deep = (level) => `const config = { level: 0.2 }\nfunction touch() { config.level = ${level}; return 1 }\nfunction f([{ a } = { a: touch() }]) { return a }\nconst unused = f([])\nd1(sound("bd").gain(config.level))`;
    t.eval(deep(0.7));
    t.eval(deep(0.3), live);
    eq(gain(), 0.3, 'a default inside an array pattern');
    // Plain bindings stay pure: renames, nesting and rest.
    const plain = 'function f({ a: [b, ...c], d }) { return b }\nconst x = f({ a: [1] })\nd1(sound("bd"))';
    t.eval(plain);
    const kept = t.channels.get('d1');
    t.eval(plain + '\nd2(sound("hh"))', live);
    eq(t.channels.get('d1'), kept, 'a plain destructuring function is still pure');
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 7
const shown = (played, until) => played.filter((e) => e.time <= until + 1e-9).map((e) => e.s + '@' + e.time);
{
    // 1. The positive-nudge look back stays within this run of the transport: no onset before cycle 0 just after
    // Play, none before the reset point after resetCycles(); onsets really held back are still handed over.
    const live = { keepUnchanged: true }; // (a, b are unknown sounds)
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a"))');
    let played = run(0, 100);
    t.eval('d1(sound("a"))\nd2(sound("b*4").nudge(0.5))', live); // inserted just after startup
    played = played.concat(run(125, 1600));
    eq(shown(played, 1.55), ['a@0.05', 'b@0.55', 'b@0.8', 'b@1.05', 'a@1.05', 'b@1.3', 'b@1.55'], 'nothing from cycle -0.25 (0.3 s)');

    reset();
    t.eval('d1(sound("a*4").nudge(0.5))');
    played = run(0, 100);
    eq(t._nudged.map((it) => it.ev.begin), [0, 0.25], 'cycles 0 and 0.25 held back at the edit');
    t.eval('d1(sound("b*4").nudge(0.5))', live); // replaced just after startup
    played = played.concat(run(125, 1600));
    eq(shown(played, 1.55), ['b@0.55', 'b@0.8', 'b@1.05', 'b@1.3', 'b@1.55'], 'the held onsets handed over, nothing before them');

    reset();
    t.eval('d1(sound("b*4").nudge(0.3))');
    played = run(0, 600);
    t.resetCycles(); // the new cycle 0 starts at what was sent: 0.7 s
    eq(t._anchorTime, 0.7);
    played = played.concat(run(625, 2000));
    eq(shown(played, 2), ['b@0.35', 'b@0.6', 'b@1', 'b@1.25', 'b@1.5', 'b@1.75', 'b@2'], 'nothing from before the reset point');
    t.stopAll();
}
{
    // 2. A cps control is committed when the event carrying it is sent, whatever its nudge.
    const live = { keepUnchanged: true };
    // A positive nudge holds the control past its onset (0.2): still undone by a mute, from what was sent on
    // (the notes already sent keep their times), and the control never plays.
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a*8"))\nd2(sound("~ x ~ ~ ~").cps(2).nudge(0.3).playFor(0, 1))');
    let played = run(0, 300);
    eq([t._dispatchCycle, t.cps, t._tempoRequests.map((r) => [r.cycle, r.committed])], [0.5, 2, [[0.2, false]]], 'onset passed, control not sent');
    t.mute('d2');
    eq(t.cps, 1, 'undone at once');
    played = played.concat(run(325, 1500));
    eq(hitsOf(played, 'a', 1.45), gridOf([[0.2, 2], [0.5, 1]], 0.125, 1.45), '2 cps from 0.2 up to what was sent, then 1 cps');
    eq(hitsOf(played, 'x', 2), []);
    // Once that control is sent (0.55 s), it stays: mute, replacement, Stop.
    for (const after of ['mute', 'replace', 'stop']) {
        reset();
        t.eval('d1(sound("a*8"))\nd2(sound("~ x ~ ~ ~").cps(2).nudge(0.3).playFor(0, 1))');
        played = run(0, 500);
        eq(hitsOf(played, 'x', 1), [0.55]);
        if (after === 'mute') t.mute('d2');
        else if (after === 'replace') t.eval('d1(sound("a*8"))\nd2(sound("~ y"))', live);
        else t.stopAll();
        eq(t.cps, 2, after + ' after it was sent');
        if (after === 'stop') continue;
        played = played.concat(run(525, 1500));
        eq(hitsOf(played, 'a', 1.45), gridOf([[0.2, 2]], 0.125, 1.45), after);
    }
    // A negative nudge sends the control before its onset (0.4, sent at 0.3 s): from then on it stays.
    for (const after of ['mute', 'replace', 'stop']) {
        reset();
        t.eval('d1(sound("a*8"))\nd2(sound("~ ~ x ~ ~").cps(2).nudge(-0.15).playFor(0, 1))');
        played = run(0, 250);
        eq([+t._dispatchCycle.toFixed(6), hitsOf(played, 'x', 1)], [0.3, [0.3]], 'sent, onset still ahead');
        if (after === 'mute') t.mute('d2');
        else if (after === 'replace') t.eval('d1(sound("a*8"))\nd2(sound("~ y"))', live);
        else t.stopAll();
        eq(t.cps, 2, after + ' after it was sent');
        if (after === 'stop') continue;
        played = played.concat(run(275, 1500));
        eq(hitsOf(played, 'a', 1.45), gridOf([[0.4, 2]], 0.125, 1.45), after);
    }
    // An equal control that was sent counts after an earlier one held back is undone: 2 cps from 0.2 (held), undone
    // at what was sent (0.3), then d3's 2 cps at 0.4 (sent early).
    reset();
    t.eval('d1(sound("a*8"))\nd2(sound("~ x ~ ~ ~").cps(2).nudge(0.6).playFor(0, 1))\nd3(sound("~ ~ y ~ ~").cps(2).nudge(-0.15).playFor(0, 1))');
    played = run(0, 200);
    eq(t._tempoRequests.map((r) => [r.cycle, r.committed]), [[0.2, false], [0.4, true]]);
    t.mute('d2');
    played = played.concat(run(225, 1500));
    eq(hitsOf(played, 'a', 1.45), gridOf([[0.2, 2], [0.3, 1], [0.4, 2]], 0.125, 1.45));
    // Cycle order: one sent early at 0.5 (3 cps) waits behind one still held at 0.4 (2 cps), and both apply in order.
    reset();
    t.eval('d1(sound("a*8"))\nd2(sound("~ ~ x ~ ~").cps(2).nudge(0.4).playFor(0, 1))\nd3(sound("~ ~ ~ ~ ~ y ~ ~ ~ ~").cps(3).nudge(-0.15).playFor(0, 1))');
    played = run(0, 400);
    eq(t._tempoRequests.map((r) => [r.cycle, r.committed]), [[0.4, false], [0.5, true]]);
    played = played.concat(run(425, 1500));
    eq(hitsOf(played, 'a', 1.45), gridOf([[0.4, 2], [0.5, 3]], 0.125, 1.45));
    eq([hitsOf(played, 'x', 2), hitsOf(played, 'y', 2), t.cps], [[0.85], [0.35], 3]);
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 8
{
    // 1. A replacement recovers an unsent control held by a positive nudge (onset 0.2 passed, sounding at 0.55 s):
    // its own tempo (3 cps) takes over from what was sent (cycle 0.5), and the times already sent stay.
    const live = { keepUnchanged: true };
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a*8"))\nd2(sound("~ x ~ ~ ~").cps(2).nudge(0.3).playFor(0, 1))');
    let played = run(0, 300);
    eq([t._dispatchCycle, t._tempoRequests.map((r) => [r.cycle, r.cps, r.committed])], [0.5, [[0.2, 2, false]]], 'onset passed, control not sent');
    t.eval('d1(sound("a*8"))\nd2(sound("~ x ~ ~ ~").cps(3).nudge(0.3).playFor(0, 1))', live);
    played = played.concat(run(325, 1500));
    eq(hitsOf(played, 'x', 2), [0.55], 'recovered and played once');
    eq(t.cps, 3);
    eq(hitsOf(played, 'a', 1.45), gridOf([[0.2, 2], [0.5, 3]], 0.125, 1.45), '2 cps up to what was sent, then 3 cps');

    // 2. A stall past an unsent nudged control: the event is skipped as too late, so its tempo change is undone
    // from what this tick sends on (cycle 1.9 on the clock as it was); what was sent keeps its times.
    reset();
    t.eval('d1(sound("a*8"))\nd2(sound("~ x ~ ~ ~").cps(2).nudge(0.3).playFor(0, 1))');
    played = run(0, 300);
    played = played.concat(run(1000, 1600)); // the clock jumps from 0.3 s to 1 s
    eq(hitsOf(played, 'x', 2), [], 'skipped');
    eq([t.cps, t._tempoRequests.length], [1, 0], 'undone');
    eq(hitsOf(played, 'a', 1.6), [0.05, 0.175, 0.275, 0.3375, 1.025, 1.0875, 1.2, 1.325, 1.45, 1.575]);
    eq(hitsOf(played, 'a', 1.6).filter((x) => x > 1), gridOf([[0.2, 2], [1.9, 1]], 0.125, 1.6).filter((x) => x > 1));
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 9
{
    // 1. A live update that only changes the nudge sends no onset its stream already sent (cycle 0.5 went out at
    // 0.65 s with nudge 0.1; with nudge 0.3 it would sound at 0.85 s, after what was sent), nor its tempo change.
    const live = { keepUnchanged: true };
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a*4").nudge(0.1))');
    let played = run(0, 600);
    t.eval('d1(sound("a*4").nudge(0.3))', live);
    played = played.concat(run(625, 2000));
    eq(shown(played, 2), ['a@0.15', 'a@0.4', 'a@0.65', 'a@1.1', 'a@1.35', 'a@1.6', 'a@1.85'], 'every position once');

    reset();
    t.eval('d1(sound("a*8"))\nd2(sound("~ ~ x ~").cps(2).nudge(0.1).playFor(0, 1))');
    played = run(0, 600);
    eq([hitsOf(played, 'x', 1), t.cps], [[0.65], 2], 'sent, and its 2 cps committed');
    t.eval('d1(sound("a*8"))\nd2(sound("~ ~ x ~").cps(3).nudge(0.3).playFor(0, 1))', live);
    played = played.concat(run(625, 1500));
    eq([hitsOf(played, 'x', 2), t.cps], [[0.65], 2], 'not sent again, its 3 cps never applies');
    eq(hitsOf(played, 'a', 1.45), gridOf([[0.5, 2]], 0.125, 1.45));

    // Simultaneous layers are told apart: at cycle 0, "a" was sent and "b" (nudge 0.5) held back; the new version
    // sends "b" (recovered) but not "a" again, though its nudge now puts it after what was sent.
    reset();
    t.eval('d1(stack(sound("a"), sound("b").nudge(0.5)).fast(2))');
    played = run(0, 300);
    eq(t._nudged.map((it) => it.v.s + '@' + it.ev.begin), ['b@0', 'a@0.5', 'b@0.5']);
    t.eval('d1(stack(sound("a").nudge(0.4), sound("b").nudge(0.5)).fast(2))', live);
    played = played.concat(run(325, 1600));
    eq(shown(played, 1.6), ['a@0.05', 'b@0.55', 'a@0.95', 'b@1.05', 'a@1.45', 'b@1.55']);
    t.stopAll();
}
{
    // 2. A cycle-0 hit nudged 2 s keeps the mapping of its onset across far more than 32 tempo changes (40 per
    // cycle); the history is pruned only behind what is still needed. A dense grid lands exactly on the clock.
    reset();
    t.lookahead = 0.1;
    eq(t.eval('d1(sound("a").nudge(2).playFor(0, 1))\nd2(sound("t*40").cps("[1 2]*20"))\nd3(sound("g*16"))').success, true);
    const played = run(0, 2500);
    const changes = [];
    for (let k = 0; k < 160; k++) changes.push([k / 40, k % 2 ? 2 : 1]);
    eq(changes.filter(([c]) => timeOn(changes, c) < 2.05).length > 32, true, 'more than 32 changes before it sounds');
    eq(hitsOf(played, 'a', 3), [2.05], 'at its onset (0.05 s) plus 2 s, once');
    const grid = gridOf(changes, 1 / 16, 2.4);
    eq(grid.length, 51);
    eq(hitsOf(played, 'g', 2.4), grid, 'every grid hit, exactly');
    ok(t._tempoHistory.length < 100, 'pruned behind what is needed: ' + t._tempoHistory.length);
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 10
{
    // 1. Sent hits are matched by onset and what they play, not by their order among simultaneous layers. At the
    // edit, cycle 0's kick (with its 2 cps) was sent and its hi-hat (nudge 0.5, sounding at 0.55 s) held back.
    const live = { keepUnchanged: true };
    const before = 'd1(sound("a*8"))\nd2(stack(sound("kick").cps(2), sound("hh").nudge(0.5)).playFor(0, 1))';
    reset();
    t.lookahead = 0.1;
    t.eval(before);
    let played = run(0, 300);
    eq([shown(played.filter((e) => e.s !== 'a'), 1), t._nudged.filter((it) => it.v.s === 'hh').map((it) => it.ev.begin), t.cps], [['kick@0.05'], [0], 2]);
    // Swapped (and the kick now nudged after what was sent, with another tempo): the hi-hat still plays, once;
    // the kick is not sent again, and its new 3 cps never applies.
    t.eval('d1(sound("a*8"))\nd2(stack(sound("hh").nudge(0.5), sound("kick").cps(3).nudge(0.4)).playFor(0, 1))', live);
    played = played.concat(run(325, 1500));
    eq(shown(played.filter((e) => e.s !== 'a'), 2), ['kick@0.05', 'hh@0.55'], 'swapped layers: each hit once');
    eq(t.cps, 2);
    eq(hitsOf(played, 'a', 1.45), gridOf([[0, 2]], 0.125, 1.45));

    // A new layer inserted ahead of both (nudged past what was sent, with 3 cps): it is new, so it plays and its
    // tempo takes over from what was sent (cycle 0.7); the kick is not sent again, the hi-hat still plays.
    reset();
    t.eval(before);
    played = run(0, 300);
    eq(+t._dispatchCycle.toFixed(9), 0.7);
    t.eval('d1(sound("a*8"))\nd2(stack(sound("sn").cps(3).nudge(0.45), sound("kick").cps(2), sound("hh").nudge(0.5)).playFor(0, 1))', live);
    played = played.concat(run(325, 1500));
    eq(shown(played.filter((e) => e.s !== 'a'), 2), ['kick@0.05', 'sn@0.5', 'hh@0.55'], 'inserted layer: each hit once');
    eq(t.cps, 3);
    eq(hitsOf(played, 'a', 1.45), gridOf([[0, 2], [0.7, 3]], 0.125, 1.45));
    t.stopAll();
}
{
    // 2. Pruning survives tempo reconciliation: 120 s of 128 tempo changes per cycle, 25 ms ticks, and the history
    // (and the copy requests are rebuilt from) stays bounded.
    reset();
    t.lookahead = 0.1;
    eq(t.eval('d1(sound("t*2").cps("1 2").fast(64))\nd2(sound("g*16"))').success, true);
    const saved = t.playEvent;
    let hits = 0;
    let largest = 0;
    t.playEvent = (v) => { if (v.s === 'g') hits++; };
    for (let ms = 0; ms <= 120000; ms += 25) {
        t.audioContext.currentTime = ms / 1000;
        t._tick();
        largest = Math.max(largest, t._tempoHistory.length, t._tempoPast ? t._tempoPast.history.length : 0);
    }
    t.playEvent = saved;
    ok(largest < 400, 'history bounded: ' + largest);
    // At 1 cps then 2 cps every 1/128 cycle, a cycle lasts 0.75 s: 16 hits each.
    eq(hits, Math.floor((120 + 0.1 - 0.05) / 0.75 * 16) + 1);
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 11
{
    // 1. Custom values from withValue(): BigInt and circular metadata never stop Play, another stream, or a
    // live handoff (where hits are fingerprinted).
    const live = { keepUnchanged: true };
    reset();
    t.lookahead = 0.1;
    const odd = (nudge) => `d1(sound("a*4").withValue((v) => { const o = { ...v, big: 10n, meta: { id: 1n } }; o.meta.self = o; return o }).nudge(${nudge}))\nd2(sound("b*4"))`;
    let r = t.eval(odd(0.1));
    eq([r.success, t.isPlaying], [true, true], 'Play goes ahead');
    let played = run(0, 600);
    eq(shown(played, 0.6), ['b@0.05', 'a@0.15', 'b@0.3', 'a@0.4', 'b@0.55'], 'both streams dispatch');
    r = t.eval(odd(0.3), live); // the handoff fingerprints the sent and held hits
    eq(r.success, true);
    played = played.concat(run(625, 1600));
    eq(hitsOf(played, 'a', 1.6), [0.15, 0.4, 0.65, 1.1, 1.35, 1.6], 'every position once');
    eq(hitsOf(played, 'b', 1.6), [0.05, 0.3, 0.55, 0.8, 1.05, 1.3, 1.55]);
    t.stopAll();
}
{
    // 2. Identical simultaneous kicks, one sent at once and one held back (nudge 0.5, sounding at 0.55 s); only
    // the held kick's nudge changes (to 0.7). In either layer order the sent kick is not sent again and the held
    // one plays at its new time; a kick's tempo change (2 cps on both) applies once.
    const live = { keepUnchanged: true };
    for (const [before, after] of [
        ['stack(sound("kick").cps(2), sound("kick").cps(2).nudge(0.5))', 'stack(sound("kick").cps(2), sound("kick").cps(2).nudge(0.7))'],
        ['stack(sound("kick").cps(2).nudge(0.5), sound("kick").cps(2))', 'stack(sound("kick").cps(2).nudge(0.7), sound("kick").cps(2))'],
    ]) {
        reset();
        t.lookahead = 0.1;
        t.eval(`d1(sound("a*8"))\nd2(${before}.playFor(0, 1))`);
        let played = run(0, 300);
        eq([hitsOf(played, 'kick', 1), t._nudged.filter((it) => it.v.s === 'kick').length], [[0.05], 1], before);
        t.eval(`d1(sound("a*8"))\nd2(${after}.playFor(0, 1))`, live);
        played = played.concat(run(325, 1500));
        eq(hitsOf(played, 'kick', 2), [0.05, 0.75], after);
        eq(t.cps, 2);
        eq(hitsOf(played, 'a', 1.45), gridOf([[0, 2]], 0.125, 1.45));
    }
    t.stopAll();
}
{
    // 3. followNote() curves are part of a hit: two notes start alike (lpf 200) but one rises to 2000, the other
    // to 800. The 2000 one was sent, the 800 one held back (nudge 0.5). After an edit that moves the sent one
    // later (0.8) and the held one sooner (0.6), the sent curve does not play again and the held curve plays at
    // its new time (0.65 s).
    const live = { keepUnchanged: true };
    const curves = (wide, narrow) => `d1(stack(sound("a").followNote("lpf", saw.range(200, 800)).nudge(${narrow}), sound("a").followNote("lpf", saw.range(200, 2000)).nudge(${wide})).playFor(0, 1))`;
    reset();
    t.lookahead = 0.1;
    const heard = [];
    const saved = t.playEvent;
    t.playEvent = (v, time) => { heard.push(v.follow.valueAt('lpf', 0.5, 0) + '@' + +time.toFixed(6)); };
    t.eval(curves(0, 0.5));
    for (let ms = 0; ms <= 300; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
    eq(heard, ['1100@0.05'], 'the wide curve sent, the narrow one held');
    t.eval(curves(0.8, 0.6), live);
    for (let ms = 325; ms <= 1500; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
    eq(heard, ['1100@0.05', '500@0.65'], 'the sent curve once, the held curve at its new time');
    t.playEvent = saved;
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 12
/** Plays the scheduler from `fromMs` to `toMs`, recording `label(v, time, duration)` for each event. */
const runWith = (fromMs, toMs, label) => {
    const out = [];
    const saved = t.playEvent;
    t.playEvent = (v, time, duration) => { out.push(label(v, +time.toFixed(6), +duration.toFixed(6))); };
    for (let ms = fromMs; ms <= toMs; ms += 25) {
        t.audioContext.currentTime = ms / 1000;
        t._tick();
    }
    t.playEvent = saved;
    return out;
};
{
    // 1. What a hit played is read when it is sent: a value object shared by every event (withValue) whose gain
    // (the very object each event plays) goes from 0.2 to 0.8 in place before a live nudge edit behaves as one
    // replaced by a new object with 0.8.
    // Either way the hits at 0.8 are new ones: cycle 0.5 (sent at 0.65 s with 0.2) plays again at 0.85 s.
    const live = { keepUnchanged: true };
    const outcomes = {};
    for (const how of ['mutated', 'replaced']) {
        reset();
        t.lookahead = 0.1;
        t.eval('const m = (globalThis.round12 = { gain: 0.2, meta: { big: 1n } })\nm.meta.self = m\nd1(sound("a*4").nudge(0.1).withValue((v) => Object.assign(m, v)))');
        let played = runWith(0, 600, (v, time) => v.gain + '@' + time);
        const edit = how === 'mutated' ? 'const m = globalThis.round12\nm.gain = 0.8' : 'const m = { gain: 0.8, meta: { big: 1n } }\nm.meta.self = m';
        eq(t.eval(edit + '\nd1(sound("a*4").nudge(0.3).withValue((v) => Object.assign(m, v)))', live).success, true);
        played = played.concat(runWith(625, 1600, (v, time) => v.gain + '@' + time));
        outcomes[how] = played;
    }
    eq(outcomes.mutated, ['0.2@0.15', '0.2@0.4', '0.2@0.65', '0.8@0.85', '0.8@1.1', '0.8@1.35', '0.8@1.6']);
    eq(outcomes.replaced, outcomes.mutated, 'mutated in place or replaced: the same');
    delete globalThis.round12;
    t.stopAll();
}
{
    // 2. Simultaneous notes with the same controls but different lengths are different hits: a one-cycle note was
    // sent, a half-cycle one held back (nudge 0.5). After an edit whose nudges cross (0.8 and 0.6), the half note
    // plays at 0.65 s for 0.5 s and the whole note is not sent again.
    const live = { keepUnchanged: true };
    reset();
    t.lookahead = 0.1;
    t.eval('d1(stack(sound("a ~").nudge(0.5), sound("a")).playFor(0, 1))');
    let played = runWith(0, 300, (v, time, duration) => time + ':' + duration);
    eq(played, ['0.05:1'], 'the whole note sent, the half note held');
    t.eval('d1(stack(sound("a ~").nudge(0.6), sound("a").nudge(0.8)).playFor(0, 1))', live);
    played = played.concat(runWith(325, 1500, (v, time, duration) => time + ':' + duration));
    eq(played, ['0.05:1', '0.65:0.5']);
    t.stopAll();
}
{
    // 3. followNote() curves are compared as the voice renders them: sine and sine.fast(9) agree every 1/8 cycle,
    // but not on the voice's grid. The sine note was sent, the sine.fast(9) one held back (nudge 0.5); after an
    // edit whose nudges cross (0.8 and 0.6), only sine.fast(9) plays, at 0.65 s (lpf 2000 a 36th of a cycle in,
    // where the sine is at 1256.3).
    const live = { keepUnchanged: true };
    const curves = (slow, fast) => `d1(stack(sound("a").followNote("lpf", sine.fast(9).range(200, 2000)).nudge(${fast}), sound("a").followNote("lpf", sine.range(200, 2000)).nudge(${slow})).playFor(0, 1))`;
    const label = (v, time) => +v.follow.valueAt('lpf', 1 / 36, 0).toFixed(1) + '@' + time;
    reset();
    t.lookahead = 0.1;
    t.eval(curves(0, 0.5));
    let played = runWith(0, 300, label);
    eq(played, ['1256.3@0.05'], 'the sine sent, sine.fast(9) held');
    t.eval(curves(0.8, 0.6), live);
    played = played.concat(runWith(325, 1500, label));
    eq(played, ['1256.3@0.05', '2000@0.65'], 'sine.fast(9) at its new time; the sine not again');
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 13
/** An audio context whose nodes accept every call, so voices are really laid out (their automation included). */
const layoutAudio = () => {
    const param = (value = 0) => ({ value, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, setValueCurveAtTime() {}, cancelScheduledValues() {}, cancelAndHoldAtTime() {} });
    const base = () => ({ connect(x) { return x; }, disconnect() {} });
    const source = () => ({ ...base(), start() {}, stop() {} });
    return {
        currentTime: 0, sampleRate: 48000, state: 'running', resume() {},
        createGain: () => ({ ...base(), gain: param(1) }),
        createBiquadFilter: () => ({ ...base(), type: '', frequency: param(350), Q: param(1), gain: param(0) }),
        createStereoPanner: () => ({ ...base(), pan: param(0) }),
        createOscillator: () => ({ ...source(), type: 'sine', frequency: param(440), detune: param(0), setPeriodicWave() {} }),
        createConstantSource: () => ({ ...source(), offset: param(1) }),
        createBufferSource: () => ({ ...source(), playbackRate: param(1), detune: param(0) }),
        createWaveShaper: () => base(),
        createDelay: () => ({ ...base(), delayTime: param(0) }),
        createChannelMerger: () => base(),
        createConvolver: () => base(),
        createBuffer: (ch, length, sampleRate) => ({ numberOfChannels: ch, length, sampleRate, duration: length / sampleRate, getChannelData: () => new Float32Array(length) }),
        createPeriodicWave: () => ({}),
    };
};
/** Ticks from `fromMs` to `toMs` with the real playEvent, recording `label(v, time)` for each event sent. */
const runLaidOut = (fromMs, toMs, label) => {
    const out = [];
    const real = TidalJS.prototype.playEvent;
    t.playEvent = function (v, time, duration) {
        out.push(label(v, +time.toFixed(6)));
        return real.call(this, v, time, duration);
    };
    for (let ms = fromMs; ms <= toMs; ms += 25) {
        t.audioContext.currentTime = ms / 1000;
        t._tick();
    }
    t.playEvent = real;
    return out;
};
{
    // 1. Followed curves are compared as their voice rendered them. At 1 cps with legato 0.5 and release 0.1 a
    // note's filter is laid out over 0.62 s, where sine and sine.fast(68) differ, though they agree on the note's
    // nominal one-cycle grid. The sine note was sent, the sine.fast(68) one held back (nudge 0.5); after an edit
    // whose nudges cross, sine.fast(68) plays at 0.65 s (lpf 2000 a 272nd of a cycle in, where the sine is at
    // 1120.8) and the sine does not play again at 0.85 s.
    const live = { keepUnchanged: true };
    const savedCtx = t.audioContext;
    reset();
    t.audioContext = layoutAudio();
    t.lookahead = 0.1;
    const note = (curve, nudge) => `sound("saw").legato(0.5).release(0.1).followNote("lpf", ${curve}.range(200, 2000)).nudge(${nudge})`;
    const code = (slow, fast) => `d1(stack(${note('sine.fast(68)', fast)}, ${note('sine', slow)}).playFor(0, 1))`;
    const label = (v, time) => +v.follow.valueAt('lpf', 1 / 272, 0).toFixed(1) + '@' + time;
    eq(t.eval(code(0, 0.5)).success, true);
    let played = runLaidOut(0, 300, label);
    eq(played, ['1120.8@0.05'], 'the sine sent, sine.fast(68) held');
    const sent = [...t._sentOnsets.get('d1').values()][0].hits[0];
    ok(sent.reads.length > 40, 'what its voice read while laying out its filter: ' + sent.reads.length);
    t.eval(code(0.8, 0.6), live);
    played = played.concat(runLaidOut(325, 1500, label));
    eq(played, ['1120.8@0.05', '2000@0.65'], 'sine.fast(68) at 0.65 s; the sine not again at 0.85 s');
    t.stopAll();
    t.audioContext = savedCtx;
}
{
    // 2. Sending hits reads their followed signals no more than laying them out does: a 32-voice burst with five
    // followed controls, its signals counted. With voices laid out, every read during dispatch is the voices' own;
    // without (events only recorded), dispatch reads none.
    const counted = (name, curve) => `.follow("${name}", ${curve}.withValue((x) => (globalThis.round13++, x)))`;
    const burst = 'd1(sound("saw*32")' + counted('lpf', 'sine.range(300, 3000)') + counted('hpf', 'saw.range(20, 200)')
        + counted('pan', 'tri.range(-1, 1)') + counted('gain', 'cosine.range(0.5, 1)') + counted('resonance', 'square.range(0, 0.3)') + '.playFor(0, 1))';
    const savedCtx = t.audioContext;
    const savedDispatch = t._dispatch;
    for (const laidOut of [true, false]) {
        reset();
        if (laidOut) t.audioContext = layoutAudio();
        t.lookahead = 0.1;
        globalThis.round13 = 0;
        eq(t.eval(burst).success, true);
        let inDispatch = 0;
        let inVoices = 0;
        let sentCount = 0;
        const real = TidalJS.prototype.playEvent;
        t._dispatch = function (...args) {
            const before = globalThis.round13;
            try { return savedDispatch.apply(this, args); } finally { inDispatch += globalThis.round13 - before; }
        };
        t.playEvent = function (v, time, duration) {
            sentCount++;
            const before = globalThis.round13;
            try { return laidOut ? real.call(this, v, time, duration) : undefined; } finally { inVoices += globalThis.round13 - before; }
        };
        for (let ms = 0; ms <= 1200; ms += 25) {
            t.audioContext.currentTime = ms / 1000;
            t._tick();
        }
        t.playEvent = real;
        t._dispatch = savedDispatch;
        eq(sentCount, 32);
        if (laidOut) ok(inVoices > 32 * 5, 'the voices read their curves: ' + inVoices);
        else eq(inVoices, 0);
        eq(inDispatch, inVoices, (laidOut ? 'laid out' : 'recorded') + ': dispatch reads only what the voices read');
        t.stopAll();
        t.audioContext = savedCtx;
    }
    delete globalThis.round13;
}
{
    // 3. The fingerprint budget is spent before each read, enumeration included: a value carrying 10000 getters
    // has at most 4000 of them read when it is sent (BigInt and circular metadata alongside stay safe). Such a
    // fingerprint is cut short, so it proves nothing: after a nudge edit, cycle 0.5 (sent at 0.65 s) plays again
    // at 0.85 s rather than being taken for the hit already sent.
    const live = { keepUnchanged: true };
    reset();
    t.lookahead = 0.1;
    globalThis.round13 = { reads: 0, meta: {} };
    for (let i = 0; i < 10000; i++) Object.defineProperty(globalThis.round13.meta, 'k' + i, { enumerable: true, get() { globalThis.round13.reads++; return i; } });
    const code = (nudge) => `const big = globalThis.round13.meta\nconst extra = { id: 7n }\nextra.self = extra\nd1(sound("a*4").withValue((v) => ({ ...v, extra, big })).nudge(${nudge}))`;
    eq(t.eval(code(0.1)).success, true);
    let played = run(0, 600);
    eq(shown(played, 0.7), ['a@0.15', 'a@0.4', 'a@0.65']);
    ok(globalThis.round13.reads <= 3 * 4000, 'at most the budget per hit: ' + globalThis.round13.reads);
    const sent = [...t._sentOnsets.get('d1').values()].map((x) => x.hits[0].fp.truncated);
    eq(sent, [true, true, true], 'cut short');
    eq(t.eval(code(0.3), live).success, true);
    played = played.concat(run(625, 1600));
    eq(shown(played, 1.6), ['a@0.15', 'a@0.4', 'a@0.65', 'a@0.85', 'a@1.1', 'a@1.35', 'a@1.6'], 'inconclusive: not taken for the sent hit');
    delete globalThis.round13;
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 14
{
    // 1. Each sent hit keeps its own nominal span for the fallback curve comparison: two followed MIDI notes at the
    // same onset, a whole cycle (c4) and half a cycle (e4), both sent at once (no voice lays out their curves).
    // After an edit that only nudges both past what was sent (0.5), neither is sent again, in either layer order.
    const live = { keepUnchanged: true };
    const sent = [];
    const savedAccess = t.midiAccess;
    // A fresh output for each order, so note-offs still pending from the other one do not count.
    const output = (id) => ({ outputs: new Map([[id, { id, name: 'round14', send(message) { if ((message[0] & 0xf0) === 0x90 && message[2] > 0) sent.push(message[1]); } }]]) });
    const whole = (nudge) => `note("c4").midi("round14").followNote("lpf", saw.range(200, 2000)).nudge(${nudge})`;
    const half = (nudge) => `note("e4 ~").midi("round14").followNote("lpf", sine.range(200, 2000)).nudge(${nudge})`;
    for (const order of [[whole, half], [half, whole]]) {
        const code = (nudge) => `d1(stack(${order[0](nudge)}, ${order[1](nudge)}).playFor(0, 1))`;
        reset();
        t.lookahead = 0.1;
        sent.length = 0;
        t.midiAccess = output(order[0] === whole ? 'w' : 'h');
        const real = TidalJS.prototype.playEvent;
        t.playEvent = real;
        eq(t.eval(code(0)).success, true);
        for (let ms = 0; ms <= 300; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
        eq(sent.slice().sort(), [60, 64], 'both sent');
        eq([...t._sentOnsets.get('d1').values()][0].hits.map((h) => h.ev.end - h.ev.begin).sort(), [0.5, 1], 'each with its own span');
        eq(t.eval(code(0.5), live).success, true);
        for (let ms = 325; ms <= 1500; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
        eq(sent.slice().sort(), [60, 64], (order[0] === whole ? 'whole first' : 'half first') + ': neither sent again');
    }
    t.midiAccess = savedAccess;
    t.stopAll();
}
{
    // 2. A followed signal that fails away from its onset (past 1/8 of the note) cannot stop a tick at a handoff,
    // whether the sent hit's curve is compared at what its voice read or over its span: the comparison is
    // inconclusive (the hit plays again), and the stream beside it plays every hit on time.
    const live = { keepUnchanged: true };
    const failing = 'sine.withValue((x) => { if (x > 0.75) throw new Error("bad curve"); return x })';
    const errors = [];
    const savedError = console.error;
    console.error = (...args) => errors.push(String(args[1] && args[1].message));
    // Over the span: hits only recorded (no voice), the curve that fails is the old and the new one's.
    reset();
    t.lookahead = 0.1;
    const spanCode = (nudge) => `d1(sound("a*4").followNote("lpf", ${failing}.range(200, 2000)).nudge(${nudge}))\nd2(sound("b*4"))`;
    eq(t.eval(spanCode(0.1)).success, true);
    let played = run(0, 600);
    eq(t.eval(spanCode(0.3), live).success, true);
    played = played.concat(run(625, 1600));
    eq(hitsOf(played, 'b', 1.6), [0.05, 0.3, 0.55, 0.8, 1.05, 1.3, 1.55], 'the other stream: every hit on time');
    eq(hitsOf(played, 'a', 1.6), [0.15, 0.4, 0.65, 0.85, 1.1, 1.35, 1.6], 'inconclusive: cycle 0.5 plays again');
    ok(errors.includes('bad curve'), 'reported');
    // At what the voice read: hits laid out, a sine that was sent, replaced by the curve that fails.
    const savedCtx = t.audioContext;
    reset();
    t.audioContext = layoutAudio();
    t.lookahead = 0.1;
    errors.length = 0;
    const readCode = (curve, nudge) => `d1(sound("saw*4").legato(0.5).followNote("lpf", ${curve}.range(200, 2000)).nudge(${nudge}))\nd2(sound("saw*4").n(1))`;
    const label = (v, time) => (v.n === 1 ? 'b' : 'a') + '@' + time;
    eq(t.eval(readCode('sine', 0.1)).success, true);
    played = runLaidOut(0, 600, label);
    ok([...t._sentOnsets.get('d1').values()][0].hits[0].reads.length > 0, 'compared at what the voice read');
    eq(t.eval(readCode(failing, 0.3), live).success, true);
    played = played.concat(runLaidOut(625, 1600, label));
    eq(played.filter((x) => x[0] === 'b'), ['b@0.05', 'b@0.3', 'b@0.55', 'b@0.8', 'b@1.05', 'b@1.3', 'b@1.55'], 'the other stream: every hit on time');
    eq(played.filter((x) => x[0] === 'a'), ['a@0.15', 'a@0.4', 'a@0.65', 'a@0.85', 'a@1.1', 'a@1.35', 'a@1.6'], 'inconclusive: cycle 0.5 plays again');
    ok(errors.includes('bad curve'), 'reported');
    console.error = savedError;
    t.stopAll();
    t.audioContext = savedCtx;
}

// ---------------------------------------------------------------- Review round 15
{
    // 1. MIDI (and OSC) send only a followed control's value at the onset, so a handoff compares only that: the
    // rest of the curve is not heard. A nudge-only edit with a signal that fails away from the onset sends nothing
    // again and compares nothing (no error); nor does an edit to a curve whose emitted bytes are the same (both
    // start at 200), even though the edit also moves the notes past what was sent.
    const live = { keepUnchanged: true };
    const failing = 'sine.withValue((x) => { if (x > 0.75) throw new Error("bad curve"); return x })';
    const errors = [];
    const savedError = console.error;
    console.error = (...args) => errors.push(String(args[0]));
    const savedAccess = t.midiAccess;
    const messages = [];
    let outputs = 0;
    for (const [before, after] of [
        [`note("c4 e4").midi("round15").followNote("lpf", ${failing}.range(200, 2000)).nudge(0.1)`, `note("c4 e4").midi("round15").followNote("lpf", ${failing}.range(200, 2000)).nudge(0.3)`],
        ['note("c4 e4").midi("round15").followNote("lpf", saw.range(200, 2000)).nudge(0.1)', 'note("c4 e4").midi("round15").followNote("lpf", saw.range(200, 4000)).nudge(0.3)'],
    ]) {
        reset();
        t.lookahead = 0.1;
        messages.length = 0;
        errors.length = 0;
        const id = 'r15-' + outputs++; // a fresh output each time: note-offs pending from before do not count
        t.midiAccess = { outputs: new Map([[id, { id, name: 'round15', send(message) { if (message[0] < 0xb0 || message[1] !== 123) messages.push(message.join(' ')); } }]]) };
        t.playEvent = TidalJS.prototype.playEvent;
        eq(t.eval(`d1(${before}.playFor(0, 1))`).success, true);
        for (let ms = 0; ms <= 700; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
        const first = messages.slice();
        eq(first.filter((m) => m.startsWith('144 ')), ['144 60 100', '144 64 100'], 'both notes sent: ' + before);
        eq(t.eval(`d1(${after}.playFor(0, 1))`, live).success, true);
        for (let ms = 725; ms <= 1800; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
        eq(messages, first, 'nothing sent again: ' + after);
        eq(errors.filter((e) => e.includes('compare')), [], 'nothing compared');
    }
    console.error = savedError;
    t.midiAccess = savedAccess;
    t.stopAll();
}
{
    // 2. A stream's sent-hit records are kept for that stream's own needs: a hit nudged 60 s in d1 keeps the clock
    // back to its onset, but not the records (with the automation their voices read) of a dense followed synth in
    // d2. The synth's records stay bounded, and the delayed hit plays on time, once.
    const savedCtx = t.audioContext;
    reset();
    t.audioContext = layoutAudio();
    t.lookahead = 0.1;
    eq(t.eval('d1(sound("late").nudge(60).playFor(0, 1))\nd2(sound("saw*16").legato(0.5).followNote("lpf", sine.range(200, 2000)))').success, true);
    const real = TidalJS.prototype.playEvent;
    const late = [];
    let largest = 0;
    let synth = 0;
    t.playEvent = function (v, time, duration) {
        if (v.s === 'late') late.push(+time.toFixed(6));
        else synth++;
        return real.call(this, v, time, duration);
    };
    for (let ms = 0; ms <= 61000; ms += 25) {
        t.audioContext.currentTime = ms / 1000;
        t._tick();
        const records = t._sentOnsets.get('d2');
        if (records) largest = Math.max(largest, records.size);
    }
    t.playEvent = real;
    eq(late, [60.05], 'the delayed hit on time, once');
    ok(synth > 900, 'the synth played on: ' + synth);
    ok(largest <= 40, 'the synth records stay bounded: ' + largest);
    ok(t._sentOnsets.get('d1') === undefined || t._sentOnsets.get('d1').size <= 1, 'd1 keeps its own');
    t.stopAll();
    t.audioContext = savedCtx;
}

// ---------------------------------------------------------------- Review round 16
{
    // 1. MIDI and OSC hits are matched on what the output sends, with followed controls at the onset they are
    // scheduled for. An absolute .follow("note", saw) at cycle 0.5 sends note 66; nudged 0.49 s later its onset
    // is cycle 0.99 and it sends 72: a new note, played at 1.04 s. A filter change MIDI does not send (with the
    // nudge that moves it past what was sent) sends no Note On again; OSC, which sends no cycle as identity, sends
    // nothing again for a nudge-only edit, and does send the note whose pitch changed.
    const live = { keepUnchanged: true };
    const savedAccess = t.midiAccess;
    const notes = [];
    let outputs = 0;
    const midiRun = (before, after) => {
        reset();
        t.lookahead = 0.1;
        notes.length = 0;
        const id = 'r16-' + outputs++; // a fresh output each time: note-offs pending from before do not count
        t.midiAccess = { outputs: new Map([[id, { id, name: 'round16', send(m, at) { if ((m[0] & 0xf0) === 0x90 && m[2] > 0) notes.push(m[1]); } }]]) };
        t.playEvent = TidalJS.prototype.playEvent;
        eq(t.eval(`d1(${before}.playFor(0, 1))`).success, true);
        for (let ms = 0; ms <= 600; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
        const first = notes.slice();
        eq(t.eval(`d1(${after}.playFor(0, 1))`, live).success, true);
        for (let ms = 625; ms <= 1800; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
        return [first, notes.slice()];
    };
    eq(midiRun('note("~ c4").midi("round16").follow("note", saw.range(0, 12))', 'note("~ c4").midi("round16").follow("note", saw.range(0, 12)).nudge(0.49)'),
        [[66], [66, 72]], 'the pitch it now sends is a new note');
    eq(midiRun('note("~ c4").midi("round16").lpf(300)', 'note("~ c4").midi("round16").lpf(900).nudge(0.3)'),
        [[60], [60]], 'a filter change MIDI does not send: no Note On again');
    t.midiAccess = savedAccess;

    const packets = [];
    t._oscSocket = function () { return { readyState: 1, send(p) { packets.push(p); } }; };
    t._socket = { readyState: 1, send(p) { packets.push(p); } };
    const oscRun = (before, after) => {
        reset();
        t.lookahead = 0.1;
        packets.length = 0;
        t.playEvent = TidalJS.prototype.playEvent;
        t._socket = { readyState: 1, send(p) { packets.push(p); } };
        eq(t.eval(`d1(${before}.playFor(0, 1))`).success, true);
        for (let ms = 0; ms <= 600; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
        const first = packets.length;
        eq(t.eval(`d1(${after}.playFor(0, 1))`, live).success, true);
        for (let ms = 625; ms <= 1800; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
        return [first, packets.length];
    };
    eq(oscRun('note("~ c4").osc("/round16")', 'note("~ c4").osc("/round16").nudge(0.3)'), [1, 1], 'OSC, nudge only: nothing sent again');
    eq(oscRun('note("~ c4").osc("/round16").follow("note", saw.range(0, 12))', 'note("~ c4").osc("/round16").follow("note", saw.range(0, 12)).nudge(0.49)'),
        [1, 2], 'OSC: the note whose pitch changed is sent');
    delete t._oscSocket;
    t._socket = null;
    t.stopAll();
}
{
    // 2. Replacing a stack with a long-nudged kick (60 s) and a dense followed synth: the kick keeps its stream's
    // records back to cycle 0, but the synth's onsets in between can no longer sound, so their curves are not
    // compared again. Changing the delay to 61 s reads the signal only as the queries do (once per onset), and
    // the kick plays once, at 61.05 s.
    const live = { keepUnchanged: true };
    const savedCtx = t.audioContext;
    reset();
    t.audioContext = layoutAudio();
    t.lookahead = 0.1;
    globalThis.round16 = 0;
    const code = (delay) => `d1(stack(sound("kick").nudge(${delay}).playFor(0, 1), sound("saw*16").legato(0.5).followNote("lpf", sine.withValue((x) => (globalThis.round16++, x)).range(200, 2000))))`;
    eq(t.eval(code(60)).success, true);
    const real = TidalJS.prototype.playEvent;
    const kicks = [];
    t.playEvent = function (v, time, duration) {
        if (v.s === 'kick') kicks.push(+time.toFixed(6));
        return real.call(this, v, time, duration);
    };
    for (let ms = 0; ms <= 59900; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
    eq(kicks, [], 'still held');
    eq(t.eval(code(61), live).success, true);
    const before = globalThis.round16;
    t.audioContext.currentTime = 59.925;
    t._tick(); // the handoff
    const reads = globalThis.round16 - before;
    // The lookback asks for about 60 cycles of 16 notes, and the query reads each onset's value; beyond that only
    // the onset still open (cycle 0) is compared and the notes this tick sends are laid out.
    const asked = globalThis.round16;
    t.channels.get('d1').query(0, t._queried.get('d1').to);
    const byQuery = globalThis.round16 - asked;
    ok(byQuery > 16 * 59, 'the query itself: ' + byQuery);
    ok(reads - byQuery < 300, 'bounded signal reads at the handoff: ' + reads + ' (the query: ' + byQuery + ')');
    for (let ms = 59950; ms <= 61300; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
    t.playEvent = real;
    eq(kicks, [61.05], 'the kick once, at 61.05 s');
    delete globalThis.round16;
    t.stopAll();
    t.audioContext = savedCtx;
}

// ---------------------------------------------------------------- Review round 17
{
    // 1. Which onsets a handoff decides agrees with the clock events go out on: the kick at cycle 0.5 was sent
    // early (nudge -0.15, at 0.4 s); a live edit adds a slowdown (0.25 cps) at cycle 0.45, before its onset,
    // which moves that onset later (past what was sent). The kick is still recognised as sent: it plays once, and
    // the slowdown takes effect.
    const live = { keepUnchanged: true };
    reset();
    t.lookahead = 0.1;
    t.eval('d1(sound("a*8"))\nd2(sound("~ ~ kick ~").nudge(-0.15).playFor(0, 1))');
    let played = run(0, 325);
    eq(hitsOf(played, 'kick', 1), [0.4], 'sent early');
    ok(t._dispatchCycle < 0.45, 'its onset and the new slowdown still ahead');
    t.eval('d1(sound("a*8"))\nd2(stack(sound("~ ~ kick ~").nudge(-0.15), sound("~ ~ ~ ~ ~ ~ ~ ~ ~ s ~ ~ ~ ~ ~ ~ ~ ~ ~ ~").cps(0.25)).playFor(0, 1))', live);
    played = played.concat(run(350, 2500));
    eq(hitsOf(played, 'kick', 3), [0.4], 'the kick once');
    eq(t.cps, 0.25, 'the slowdown took effect');
    eq(hitsOf(played, 'a', 2.45), gridOf([[0.45, 0.25]], 0.125, 2.45));
    t.stopAll();
}
{
    // 2. A MIDI hit's identity has its take values as they went out: gainTake 0.2 sent velocity 20; changed to
    // 0.9 (and nudged past what was sent) it is a new note, sent with velocity 90. Comparing does not count a take:
    // the counter has moved once per note played.
    const live = { keepUnchanged: true };
    const savedAccess = t.midiAccess;
    const velocities = [];
    reset();
    t.lookahead = 0.1;
    t._nTakeCounters.clear();
    t.midiAccess = { outputs: new Map([['r17a', { id: 'r17a', name: 'round17', send(m) { if ((m[0] & 0xf0) === 0x90 && m[2] > 0) velocities.push(m[2]); } }]]) };
    t.playEvent = TidalJS.prototype.playEvent;
    eq(t.eval('d1(note("~ c4").midi("round17").gainTake("g", [0.2]).playFor(0, 1))').success, true);
    for (let ms = 0; ms <= 600; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
    eq([velocities.slice(), t._nTakeCounters.get('gain:g')], [[20], 1]);
    eq(t.eval('d1(note("~ c4").midi("round17").gainTake("g", [0.9]).nudge(0.3).playFor(0, 1))', live).success, true);
    for (let ms = 625; ms <= 1800; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
    eq(velocities, [20, 90], 'velocity 90 sent');
    eq(t._nTakeCounters.get('gain:g'), 2, 'counted once per note played, not by the comparison');

    // 3. A followed control is resolved once as a hit goes out, and its identity is read from that: a stateful
    // signal (each read answers the next note) is read once per note sent, and the stored identity holds the very
    // note that was sent.
    reset();
    t.lookahead = 0.1;
    const keys = [];
    t.midiAccess = { outputs: new Map([['r17b', { id: 'r17b', name: 'round17', send(m) { if ((m[0] & 0xf0) === 0x90 && m[2] > 0) keys.push(m[1]); } }]]) };
    globalThis.round17 = 0;
    eq(t.eval('d1(note("c4*4").midi("round17").follow("note", sine.withValue(() => (globalThis.round17 += 1) % 12)).playFor(0, 1))').success, true);
    let inDispatch = 0;
    const savedDispatch = t._dispatch;
    t._dispatch = function (...args) {
        const before = globalThis.round17;
        try { return savedDispatch.apply(this, args); } finally { inDispatch += globalThis.round17 - before; }
    };
    for (let ms = 0; ms <= 1200; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); }
    t._dispatch = savedDispatch;
    eq(keys.length, 4);
    eq(inDispatch, 4, 'one read per note sent: none for its identity');
    const stored = [...t._sentOnsets.get('d1').values()].flatMap((x) => x.hits).map((h) => JSON.parse(h.fp.key.slice(5))[3][0]);
    eq(stored.slice(-keys.length), keys.slice(-stored.length), 'the stored identity is what was sent');
    delete globalThis.round17;
    t.midiAccess = savedAccess;
    t.stopAll();
}

// ---------------------------------------------------------------- Review round 18
{
    // MIDI through a stub port, with the performance clock tied to the fake audio clock so Note On times read
    // as audio times.
    const live = { keepUnchanged: true };
    const savedAccess = t.midiAccess;
    const savedNow = performance.now;
    performance.now = () => t.audioContext.currentTime * 1000;
    const sent = [];
    let ports = 0;
    const midiStart = (code) => {
        reset();
        t.lookahead = 0.1;
        t._nTakeCounters.clear();
        sent.length = 0;
        const id = 'r18-' + ports++;
        t.midiAccess = { outputs: new Map([[id, { id, name: 'round18', send(m, at) { if ((m[0] & 0xf0) === 0x90 && m[2] > 0) sent.push(m[1] + '/' + m[2] + '@' + +(at / 1000).toFixed(6)); } }]]) };
        t.playEvent = TidalJS.prototype.playEvent;
        eq(t.eval(code).success, true);
    };
    const tickTo = (fromMs, toMs) => { for (let ms = fromMs; ms <= toMs; ms += 25) { t.audioContext.currentTime = ms / 1000; t._tick(); } };

    // 1. A replacement at an onset already sent is compared with the take values that hit used: a nudge-only
    // edit sends velocity 20 (index 0) at 0.05 s and velocity 90 (index 1) at 1.65 s, two counts in all.
    midiStart('d1(note("c4").midi("round18").gainTake("meter", [0.2, 0.9]).playFor(0, 2))');
    tickTo(0, 300);
    eq(t.eval('d1(note("c4").midi("round18").gainTake("meter", [0.2, 0.9]).nudge(0.6).playFor(0, 2))', live).success, true);
    tickTo(325, 2200);
    eq(sent, ['60/20@0.05', '60/90@1.65'], 'the sent note not again, the next one with the next value');
    eq(t._nTakeCounters.get('gain:meter'), 2, 'two counts');
    // The value at that index changed (0.2 to 0.5): a new hit at cycle 0 (it goes out with the counter's next
    // value, 0.9), then cycle 1 with 0.5.
    midiStart('d1(note("c4").midi("round18").gainTake("meter", [0.2, 0.9]).playFor(0, 2))');
    tickTo(0, 300);
    eq(t.eval('d1(note("c4").midi("round18").gainTake("meter", [0.5, 0.9]).nudge(0.6).playFor(0, 2))', live).success, true);
    tickTo(325, 2200);
    eq(sent, ['60/20@0.05', '60/90@0.65', '60/50@1.65'], 'a changed value is a new hit');
    eq(t._nTakeCounters.get('gain:meter'), 3);

    // 2. The handoff reads a replacement's output on the clock it goes out on. Note 60 went out early (cycle 0.5,
    // nudge -0.06, at 0.49 s, where saw.range(0, 1) gives 0.44). The edit changes its absolute pitch curve and,
    // in the same tick, slows down to 0.2 cps at cycle 0.45: the note now goes out at 0.69 s, at cycle 0.488,
    // where the new curve gives 12: note 72 is sent (on the clock before the slowdown, cycle 0.44, it would read
    // 0, the note already sent).
    const pitched = (curve) => `note("~ c4").midi("round18").follow("note", ${curve}).nudge(-0.06).playFor(0, 1)`;
    midiStart(`d1(${pitched('saw.range(0, 1)')})`);
    tickTo(0, 400);
    eq(sent, ['60/100@0.49'], 'sent early');
    eq(+t._dispatchCycle.toFixed(9), 0.45);
    eq(t.eval(`d1(${pitched('saw.range(-110, 140)')})\nd2(sound("~ ~ ~ ~ ~ ~ ~ ~ ~ s ~ ~ ~ ~ ~ ~ ~ ~ ~ ~").cps(0.2).playFor(0, 1))`, live).success, true);
    tickTo(425, 1500);
    eq(sent, ['60/100@0.49', '72/100@0.69'], 'note 72 at 0.69 s');
    eq(t.cps, 0.2, 'the slowdown took effect');

    performance.now = savedNow;
    t.midiAccess = savedAccess;
    t.stopAll();
}

globalThis.setTimeout = realSetTimeout;
console.log(`core: all ${passed} checks passed`);
