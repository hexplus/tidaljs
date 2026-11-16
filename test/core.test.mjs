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

globalThis.setTimeout = realSetTimeout;
console.log(`core: all ${passed} checks passed`);
