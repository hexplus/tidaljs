/**
 * Output tests for tidal.js: Web MIDI and OSC after Stop, MIDI file export
 * (decoded and compared with live MIDI) and audio recording. Runs in Node
 * with fake clocks, fake MIDI ports, a fake WebSocket and fake MediaRecorders.
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
const ok = (x, msg) => { assert.ok(x, msg); passed++; };

// --- Fake clocks: the audio clock in seconds, performance.now() and Date.now() in ms, kept together.
const clock = { audio: 10 };
const perfNow = () => clock.audio * 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: perfNow }, configurable: true, writable: true });
const realDateNow = Date.now;
Date.now = () => 1.7e12 + clock.audio * 1000;
const setTime = (seconds) => { clock.audio = seconds; };

// --- Fake audio graph (connections are kept, to check recording cleanup).
const node = () => {
    const n = {
        connections: new Set(),
        connect(to) { n.connections.add(to); },
        disconnect(to) {
            if (to === undefined) n.connections.clear();
            else if (!n.connections.delete(to)) throw new Error('InvalidAccessError: not connected');
        },
        gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
    };
    return n;
};
const streams = [];
function makeEngine() {
    const t = new TidalJS();
    t.audioContext = {
        get currentTime() { return clock.audio; },
        state: 'running',
        createGain: node,
        resume() {},
        createMediaStreamDestination() {
            const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
            const dest = { ...node(), stream: { tracks, getTracks: () => tracks } };
            streams.push(dest);
            return dest;
        },
    };
    t.masterGain = node();
    t.output = node();
    t.setupGlobalFunctions();
    t._startTimer = () => {};
    t._stopTimer = () => {};
    return t;
}

// --- Fake Web MIDI: outputs keep what they were sent and when the device would hear it.
class FakeOutput {
    constructor(name) {
        this.name = name;
        this.id = name;
        this.state = 'connected';
        this.log = [];
        this.failing = false;
    }

    send(data, timestamp) {
        if (this.state === 'disconnected' || this.failing) throw new Error('InvalidStateError: port is not open');
        // A missing or past timestamp means now.
        const at = timestamp && timestamp > perfNow() ? timestamp : perfNow();
        this.log.push({ data: [...data], at, cancelled: false });
    }

    clear() {
        if (this.failing) throw new Error('InvalidStateError');
        for (const m of this.log) if (m.at > perfNow()) m.cancelled = true;
    }

    /** The messages the device hears, in time order. */
    heard() {
        return this.log.filter((m) => !m.cancelled).sort((a, b) => a.at - b.at);
    }

    /** Notes left sounding after every message has been heard ("channel:key"). */
    hanging() {
        const on = new Set();
        for (const { data } of this.heard()) {
            const [status, a, b] = data;
            const type = status & 0xf0;
            const ch = status & 0x0f;
            if (type === 0x90 && b > 0) on.add(`${ch}:${a}`);
            else if (type === 0x80 || type === 0x90) on.delete(`${ch}:${a}`);
            else if (type === 0xb0 && a === 123) for (const k of [...on]) if (k.startsWith(ch + ':')) on.delete(k);
        }
        return [...on];
    }

    /** The note-ons heard, as "key@seconds". */
    noteOns() {
        return this.heard().filter((m) => (m.data[0] & 0xf0) === 0x90 && m.data[2] > 0).map((m) => `${m.data[1]}@${+(m.at / 1000).toFixed(3)}`);
    }
}
class OutputWithoutClear extends FakeOutput {}
OutputWithoutClear.prototype.clear = undefined;

async function withMidi(t, outputs) {
    const access = { outputs: new Map(outputs.map((o) => [o.id, o])), inputs: new Map() };
    Object.defineProperty(globalThis, 'navigator', { value: { requestMIDIAccess: async () => access }, configurable: true, writable: true });
    await t.enableMidi();
    return access;
}

// =====================================================================
// 14. Stop and external output
// =====================================================================

// Notes sent ahead (inside the lookahead) do not sound after Stop; a note already on ends now.
{
    setTime(10);
    const t = makeEngine();
    const out = new FakeOutput('Synth');
    await withMidi(t, [out]);
    t._sendMidi({ s: 'superpiano', note: 60, midi: 'Synth' }, 10.0, 0.5);  // on now, off at 10.5
    t._sendMidi({ s: 'superpiano', note: 64, midi: 'Synth' }, 10.08, 0.05); // ahead: on at 10.08
    setTime(10.02);
    t.stopAll();
    eq(out.noteOns(), ['60@10'], 'the note scheduled ahead is cancelled');
    eq(out.hanging(), [], 'no hanging notes after Stop');
    const off60 = out.heard().find((m) => m.data[0] === 0x80 && m.data[1] === 60);
    eq(+(off60.at / 1000).toFixed(3), 10.02, 'the sounding note ends at Stop, not at its scheduled end');
    ok(out.log.some((m) => m.cancelled && m.data[0] === 0x90 && m.data[1] === 64), 'its note-on was cleared from the port');

    // Immediate restart: new events go out, the old ones stay cancelled.
    t._sendMidi({ s: 'superpiano', note: 67, midi: 'Synth' }, 10.05, 0.1);
    setTime(10.3);
    eq(out.noteOns(), ['60@10', '67@10.05']);
    eq(out.hanging(), []);
}

// Without output.clear(): notes still to come end as they start; nothing is left hanging.
{
    setTime(20);
    const t = makeEngine();
    const out = new OutputWithoutClear('Old synth');
    await withMidi(t, [out]);
    t._sendMidi({ s: 'superpiano', note: 60, midi: 0 }, 20.0, 1);
    t._sendMidi({ s: 'superpiano', note: 62, midi: 0, midichan: 3 }, 20.09, 1);
    setTime(20.01);
    t.stopAll();
    eq(out.hanging(), []);
    const n62 = out.heard().filter((m) => (m.data[0] & 0x0f) === 3 && m.data[1] === 62 && m.data[0] !== 0xb3);
    eq(n62.map((m) => [m.data[0], +(m.at / 1000).toFixed(3)]), [[0x93, 20.09], [0x83, 20.09], [0x83, 21.09]], 'the uncancellable note lasts no time');
    const off60 = out.heard().find((m) => m.data[0] === 0x80 && m.data[1] === 60);
    eq(+(off60.at / 1000).toFixed(3), 20.01);
}

// Stop and panic survive disconnected and failing outputs; a failing send does not throw from the scheduler.
{
    setTime(30);
    const t = makeEngine();
    const gone = new FakeOutput('Unplugged');
    const broken = new FakeOutput('Broken');
    const good = new FakeOutput('Good');
    await withMidi(t, [gone, broken, good]);
    t._sendMidi({ s: 'superpiano', note: 60, midi: 'Unplugged' }, 30.05, 0.5);
    t._sendMidi({ s: 'superpiano', note: 61, midi: 'Broken' }, 30.05, 0.5);
    t._sendMidi({ s: 'superpiano', note: 62, midi: 'Good' }, 30.0, 0.5);
    gone.state = 'disconnected';
    broken.failing = true;
    t.stopAll();
    globalThis.panic();
    passed++;
    eq(good.hanging(), [], 'the working output is still cleaned up');
    t._sendMidi({ s: 'superpiano', note: 63, midi: 'Broken' }, 30.1, 0.5); // no throw
    passed++;
}

// End to end: a .midi() pattern through the scheduler, Stop in the middle, then play again at once.
{
    setTime(0);
    const t = makeEngine();
    const out = new FakeOutput('Synth');
    await withMidi(t, [out]);
    t.cps = 1;
    t.eval('note("c d e f").s("superpiano").midi("Synth")');
    t._session = { out: node(), nodes: [] };
    t._anchorTime = 0; t._anchorCycle = 0; t._nextCycle = 0;
    for (let ms = 0; ms <= 300; ms += 25) { setTime(ms / 1000); t._tick(); }
    // Stopped at 0.3 s: the notes at 0 and 0.25 have sounded; the one at 0.5 is not sent yet (0.3 + lookahead 0.1).
    t.stopAll();
    const before = out.noteOns();
    eq(before, ['60@0', '62@0.25'], 'only notes whose time had come are heard');
    eq(out.hanging(), []);
    t.eval('note("a#").s("superpiano").midi("Synth")');
    t._session = { out: node(), nodes: [] };
    const restart = t._anchorTime;
    for (let ms = 325; ms <= 700; ms += 25) { setTime(ms / 1000); t._tick(); }
    t.stopAll();
    const after = out.noteOns().slice(before.length);
    eq(after.length, 1, 'the new pattern plays after the restart');
    eq(after[0], `70@${+restart.toFixed(3)}`);
    eq(out.noteOns().filter((n) => /^6[45]@/.test(n)), [], 'notes of the stopped run never sound');
    eq(out.hanging(), []);
}

// OSC: packets waiting for the socket are dropped by Stop, by a URL change and when late.
class FakeSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        FakeSocket.all.push(this);
    }

    send(data) {
        if (this.readyState !== 1) throw new Error('InvalidStateError');
        this.sent.push(data);
    }

    close() {
        this.readyState = 3;
        if (this.onclose) this.onclose();
    }

    open() {
        this.readyState = 1;
        if (this.onopen) this.onopen();
    }
}
FakeSocket.all = [];
globalThis.WebSocket = FakeSocket;
const oscN = (packet) => TidalJS.parseOsc(packet)[0].args[TidalJS.parseOsc(packet)[0].args.indexOf('n') + 1];
{
    setTime(40);
    const t = makeEngine();
    t._sendOsc({ s: 'bd', n: 1, osc: '/dirt/play' }, 40.05, 0.25);
    t._sendOsc({ s: 'bd', n: 2, osc: '/dirt/play' }, 40.09, 0.25);
    const ws = FakeSocket.all.at(-1);
    t.stopAll();
    ws.open();
    eq(ws.sent.length, 0, 'packets queued before Stop are not flushed when the socket opens');
    // Restart: new packets go out at once on the open socket.
    t._sendOsc({ s: 'bd', n: 3, osc: '/dirt/play' }, 40.1, 0.25);
    eq(ws.sent.map(oscN), [3]);
}
{
    setTime(50);
    const t = makeEngine();
    t._sendOsc({ s: 'bd', n: 1, osc: '/dirt/play' }, 50.05, 0.25);
    const old = FakeSocket.all.at(-1);
    globalThis.setOscUrl('ws://elsewhere:9000');
    eq(old.readyState, 3, 'the old socket is closed');
    old.onopen && old.onopen(); // a stale connection opening late
    eq(old.sent.length, 0, 'a stale connection flushes nothing');
    t._sendOsc({ s: 'bd', n: 2, osc: '/dirt/play' }, 50.06, 0.25);
    const fresh = FakeSocket.all.at(-1);
    eq(fresh.url, 'ws://elsewhere:9000');
    fresh.open();
    eq(fresh.sent.map(oscN), [2], 'only packets for the new bridge are sent');
}
{
    // Reconnect: the bridge drops; a late open of the dropped socket sends nothing; the new one sends what is still in time.
    setTime(60);
    const t = makeEngine();
    t._sendOsc({ s: 'bd', n: 1, osc: '/dirt/play' }, 60.02, 0.25);
    const first = FakeSocket.all.at(-1);
    first.close();
    t._sendOsc({ s: 'bd', n: 2, osc: '/dirt/play' }, 60.5, 0.25);
    const second = FakeSocket.all.at(-1);
    ok(second !== first, 'a new socket is opened');
    first.onopen();
    eq(first.sent.length, 0);
    setTime(60.1); // the first packet's time has passed
    second.open();
    eq(second.sent.map(oscN), [2], 'a packet whose time has passed is dropped');
}

// =====================================================================
// 15. MIDI file export, decoded
// =====================================================================

/** A small Standard MIDI File reader: header, track chunks, delta times, running status, meta and sysex events. */
function parseSmf(bytes) {
    let at = 0;
    const u8 = () => bytes[at++];
    const u16 = () => (u8() << 8) | u8();
    const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
    const str = (n) => String.fromCharCode(...bytes.slice(at, (at += n)));
    const varLen = () => {
        let n = 0;
        for (;;) {
            const b = u8();
            n = (n << 7) | (b & 0x7f);
            if (!(b & 0x80)) return n;
        }
    };
    assert.strictEqual(str(4), 'MThd');
    assert.strictEqual(u32(), 6);
    const format = u16();
    const ntracks = u16();
    const division = u16();
    const tracks = [];
    for (let i = 0; i < ntracks; i++) {
        assert.strictEqual(str(4), 'MTrk');
        const end = u32() + at;
        const events = [];
        let tick = 0;
        let status = 0;
        while (at < end) {
            tick += varLen();
            let b = bytes[at];
            if (b & 0x80) { status = b; at++; } else assert.ok(status, 'running status with no status');
            if (status === 0xff) {
                const type = u8();
                const len = varLen();
                events.push({ tick, meta: type, data: [...bytes.slice(at, (at += len))] });
                status = 0;
            } else if (status === 0xf0 || status === 0xf7) {
                const len = varLen();
                at += len;
                status = 0;
            } else {
                const type = status & 0xf0;
                const data = type === 0xc0 || type === 0xd0 ? [u8()] : [u8(), u8()];
                events.push({ tick, type, channel: status & 0x0f, data });
            }
        }
        assert.strictEqual(at, end, 'track length');
        tracks.push(events);
    }
    assert.strictEqual(at, bytes.length, 'file length');
    return { format, division, tracks };
}
const kinds = { 0x80: 'off', 0x90: 'on', 0xb0: 'cc', 0xc0: 'pgm' };
const decode = (bytes) => {
    const { tracks, division } = parseSmf(bytes);
    eq(division, 480);
    const tempo = tracks[0].find((e) => e.meta === 0x51);
    return {
        tempo: tempo && (tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2],
        events: tracks[0].filter((e) => e.type).map((e) => [e.tick, kinds[e.type], e.channel, ...e.data]),
        end: tracks[0].at(-1).meta,
    };
};
{
    const t = makeEngine();
    t.cps = 0.5; // a cycle is 2 s, 1920 ticks
    // Notes: channel, velocity, timing.
    let f = decode(t.exportPattern(globalThis.note('c e').s('superpiano').vel(0.5).midichan(2), 1, 'midi'));
    eq(f.tempo, 500000);
    eq(f.end, 0x2f);
    eq(f.events, [[0, 'on', 2, 60, 64], [960, 'off', 2, 60, 0], [960, 'on', 2, 64, 64], [1920, 'off', 2, 64, 0]]);
    // legato and sustain set the length (sustain in seconds: 0.25 s at 0.5 cps is 240 ticks).
    f = decode(t.exportPattern(globalThis.note('c').s('superpiano').legato(0.5), 1, 'midi'));
    eq(f.events, [[0, 'on', 0, 60, 100], [960, 'off', 0, 60, 0]]);
    f = decode(t.exportPattern(globalThis.note('c').s('superpiano').sustain(0.25), 1, 'midi'));
    eq(f.events, [[0, 'on', 0, 60, 100], [240, 'off', 0, 60, 0]]);
    // gain sets the velocity without vel; vel above 1 is taken as is.
    f = decode(t.exportPattern(globalThis.note('c').s('superpiano').gain(0.5), 1, 'midi'));
    eq(f.events[0], [0, 'on', 0, 60, 50]);
    f = decode(t.exportPattern(globalThis.note('c').s('superpiano').vel(90), 1, 'midi'));
    eq(f.events[0], [0, 'on', 0, 60, 90]);
    // Control-only events: CC, program change and NRPN, and no note.
    f = decode(t.exportPattern(globalThis.ccn(74).ccv('0 127').midichan(1), 1, 'midi'));
    eq(f.events, [[0, 'cc', 1, 74, 0], [960, 'cc', 1, 74, 127]]);
    f = decode(t.exportPattern(globalThis.pgm(5), 1, 'midi'));
    eq(f.events, [[0, 'pgm', 0, 5]]);
    f = decode(t.exportPattern(globalThis.nrpn('1000:64'), 1, 'midi'));
    eq(f.events, [[0, 'cc', 0, 99, 7], [0, 'cc', 0, 98, 104], [0, 'cc', 0, 6, 0], [0, 'cc', 0, 38, 64]]);
    // Program change and CC come before the note they go with.
    f = decode(t.exportPattern(globalThis.note('c').s('superpiano').pgm(3).ccn(1).ccv(20).midichan(4), 1, 'midi'));
    eq(f.events, [[0, 'pgm', 4, 3], [0, 'cc', 4, 1, 20], [0, 'on', 4, 60, 100], [1920, 'off', 4, 60, 0]]);
    // Drums by name play their General MIDI note, on midichan when given...
    f = decode(t.exportPattern(globalThis.sound('bd sn hh').midichan(3), 1, 'midi'));
    eq(f.events.filter((e) => e[1] === 'on').map((e) => [e[2], e[3]]), [[3, 36], [3, 38], [3, 42]]);
    // ...and, with no channel, on General MIDI's percussion channel (9), as exports always had them.
    f = decode(t.exportPattern(globalThis.sound('bd sn hh'), 1, 'midi'));
    eq(f.events.filter((e) => e[1] === 'on').map((e) => [e[2], e[3]]), [[9, 36], [9, 38], [9, 42]]);
    // A drum name with a note given is a note like any other (channel 0).
    f = decode(t.exportPattern(globalThis.sound('bd').note(-20), 1, 'midi'));
    eq(f.events.filter((e) => e[1] === 'on').map((e) => [e[2], e[3]]), [[0, 40]]);
    // A repeated key: the note-off of the first comes before the next note-on at the same tick.
    f = decode(t.exportPattern(globalThis.note('c c').s('superpiano'), 1, 'midi'));
    eq(f.events.map((e) => e[1]), ['on', 'off', 'on', 'off']);
}

/** A pattern of one event a cycle with this value. */
const once = (t, value) => new TidalJS.PatternBuilder(t, (b, e) => {
    const events = [];
    for (let c = Math.floor(b); c < e; c++) events.push({ begin: c, end: c + 1, value: { ...value } });
    return events;
});
// Export and live MIDI read events the same way: the same messages, and the same note lengths.
{
    setTime(70);
    const t = makeEngine();
    const out = new FakeOutput('Synth');
    await withMidi(t, [out]);
    t.cps = 0.5;
    const values = [
        { s: 'superpiano', note: 62, vel: 0.8, midichan: 5, legato: 0.5 },
        { s: 'sn', gain: 0.7 },
        { ccn: 10, ccv: 99, midichan: 2 },
        { pgm: 7 },
        { nrpn: '300:5000' },
        { s: 'superpiano', freq: 440, up: 2, sustain: 0.1, pgm: 1, ccn: 7, ccv: 100 },
    ];
    for (const value of values) {
        out.log.length = 0;
        t._sendMidi({ ...value, midi: 'Synth' }, 70, 2); // 2 s: one cycle at 0.5 cps
        const live = out.heard().map((m) => [Math.round((m.at - 70000) / 1000 * 0.5 * 1920), ...m.data]);
        const file = decode(t.exportPattern(once(t, value), 1, 'midi')).events
            .map(([tick, kind, ch, ...data]) => [tick, ({ on: 0x90, off: 0x80, cc: 0xb0, pgm: 0xc0 })[kind] | ch, ...data]);
        // The one difference: a named drum with no channel goes on channel 9 in a file (General MIDI percussion).
        const expected = value.s === 'sn' && value.midichan === undefined
            ? live.map(([tick, status, ...data]) => [tick, (status & 0xf0) | 9, ...data]) : live;
        eq(file, expected, `export matches live for ${JSON.stringify(value)}`);
    }
}

// =====================================================================
// 16. Recording
// =====================================================================

const recorders = [];
function recorderClass({ throwOnConstruct, throwOnStart, throwOnStop, noData, silent } = {}) {
    return class FakeRecorder {
        constructor(stream) {
            if (throwOnConstruct) throw new Error('NotSupportedError: no encoder');
            this.stream = stream;
            this.state = 'inactive';
            this.mimeType = 'audio/webm';
            recorders.push(this);
        }

        start() {
            if (throwOnStart) throw new Error('InvalidStateError: cannot start');
            this.state = 'recording';
        }

        stop() {
            if (throwOnStop) throw new Error('InvalidStateError: cannot stop');
            this.state = 'inactive';
            if (silent) return; // never reports back
            queueMicrotask(() => {
                if (!noData) this.ondataavailable({ data: new Blob(['abc']) });
                this.onstop();
            });
        }

        fail(message) {
            this.state = 'inactive';
            this.onerror({ error: new Error(message) });
            this.onstop();
        }
    };
}
const released = (dest, output) => !output.connections.has(dest) && dest.stream.tracks.every((tr) => tr.stopped);

{
    const t = makeEngine();
    // The constructor throws: nothing stays connected, the tracks stop, and a retry works.
    globalThis.MediaRecorder = recorderClass({ throwOnConstruct: true });
    assert.throws(() => t.startRecording(), /no encoder/); passed++;
    ok(released(streams.at(-1), t.output));
    eq(t.isRecording, false);

    // start() throws: the same.
    globalThis.MediaRecorder = recorderClass({ throwOnStart: true });
    assert.throws(() => t.startRecording(), /cannot start/); passed++;
    ok(released(streams.at(-1), t.output));
    eq(t.isRecording, false);

    // Normal recording: resolves with a non-empty Blob, and releases everything.
    globalThis.MediaRecorder = recorderClass();
    eq(t.startRecording(), true);
    eq(t.isRecording, true);
    eq(t.startRecording(), false, 'already recording');
    const dest = streams.at(-1);
    ok(t.output.connections.has(dest));
    const saving = t.stopRecording();
    eq(t.isRecording, false, 'not recording while saving');
    const blob = await saving;
    ok(blob && blob.size === 3);
    ok(released(dest, t.output));
    eq(await t.stopRecording(), null, 'stopping when not recording resolves null');

    // Nothing recorded: resolves null (no file).
    globalThis.MediaRecorder = recorderClass({ noData: true });
    t.startRecording();
    eq(await t.stopRecording(), null);
    ok(released(streams.at(-1), t.output));

    // stop() throws: rejects, releases, and recording can start again.
    globalThis.MediaRecorder = recorderClass({ throwOnStop: true });
    t.startRecording();
    await assert.rejects(t.stopRecording(), /cannot stop/); passed++;
    ok(released(streams.at(-1), t.output));
    eq(t.isRecording, false);

    // The recorder fails while recording: the recording ends and onRecordingError is told.
    globalThis.MediaRecorder = recorderClass();
    const errors = [];
    t.onRecordingError = (err) => errors.push(err.message);
    t.startRecording();
    recorders.at(-1).fail('device lost');
    eq(t.isRecording, false);
    eq(errors, ['device lost']);
    ok(released(streams.at(-1), t.output));
    eq(await t.stopRecording(), null);

    // The recorder fails while stopping: the promise rejects (once), onRecordingError is not called twice.
    t.startRecording();
    const rec = recorders.at(-1);
    rec.stop = function () { this.state = 'inactive'; queueMicrotask(() => this.fail('encoder crashed')); };
    await assert.rejects(t.stopRecording(), /encoder crashed/); passed++;
    eq(errors, ['device lost']);
    ok(released(streams.at(-1), t.output));

    // Already inactive when stopped (the browser ended it without events): settles with what it has.
    t.startRecording();
    const inactive = recorders.at(-1);
    inactive.ondataavailable({ data: new Blob(['xy']) });
    inactive.state = 'inactive';
    const b2 = await t.stopRecording();
    eq(b2.size, 2);
    ok(released(streams.at(-1), t.output));

    // A recorder that never reports back: rejects after the timeout instead of hanging.
    globalThis.MediaRecorder = recorderClass({ silent: true });
    t.recordingTimeout = 5;
    t.startRecording();
    await assert.rejects(t.stopRecording(), /did not finish/); passed++;
    ok(released(streams.at(-1), t.output));

    // And after all that, a normal recording still works.
    globalThis.MediaRecorder = recorderClass();
    t.startRecording();
    ok((await t.stopRecording()).size > 0);
}

// =====================================================================
// Review follow-up: Stop clears ports that only got controls; one-shots own their MIDI.
// =====================================================================
{
    // A CC scheduled ahead on a port that played no notes is cleared by Stop.
    setTime(200);
    const t = makeEngine();
    const port = new FakeOutput('Controls');
    await withMidi(t, [port]);
    t._session = t._createSession();
    t._sendMidi({ midi: 'Controls', ccn: 74, ccv: 100 }, 200.05, 0.25);
    t._sendMidi({ midi: 'Controls', pgm: 3 }, 200.08, 0.25);
    t._sendMidi({ midi: 'Controls', nrpn: '10:20' }, 200.09, 0.25);
    t.stopAll();
    eq(port.heard().filter((m) => (m.data[0] & 0xf0) === 0xb0 && m.data[1] !== 123).length, 0, 'no pending CC or NRPN reaches the device');
    eq(port.heard().filter((m) => (m.data[0] & 0xf0) === 0xc0).length, 0, 'no pending program change either');
}
{
    // A one-shot's MIDI, evaluated while a loop plays and the loop then stops in the same code, still sounds; Stop cancels it.
    setTime(300);
    const t = makeEngine();
    const port = new FakeOutput('Synth');
    await withMidi(t, [port]);
    t.eval('d1(note("c e").midi("Synth"))');
    t._anchorTime = 300.05;
    for (let ms = 0; ms <= 100; ms += 25) { setTime(300 + ms / 1000); t._tick(); }
    t.eval('first(note("g").midi("Synth"))'); // no loop left: the clock stops, the one-shot plays on
    eq(t.isPlaying, false);
    ok(port.noteOns().some((n) => n.startsWith('67@')), 'the one-shot note was scheduled');
    setTime(300.2);
    ok(port.heard().some((m) => (m.data[0] & 0xf0) === 0x90 && m.data[1] === 67), 'and it was not cleared when the loop stopped');
    ok(!port.heard().some((m) => m.data[0] === 0xb0 && m.data[1] === 123), 'no all-notes-off while the one-shot sounds');
    // Stop does end it.
    t.stopAll();
    setTime(310);
    eq(port.hanging(), [], 'nothing left hanging after Stop');
}
{
    // Cancelling the loops on a port shared with a one-shot: clear() takes both, the one-shot's go out again.
    setTime(400);
    const t = makeEngine();
    const port = new FakeOutput('Both');
    await withMidi(t, [port]);
    t._session = t._createSession();
    t._sendMidi({ midi: 'Both', note: 0 }, 400.5, 0.5); // the loops' note, to come
    const shot = { session: t._createSession(), timer: null };
    t._midiOwner = shot;
    t._sendMidi({ midi: 'Both', note: 7, ccn: 1, ccv: 9 }, 400.6, 0.5); // the one-shot's, to come
    t._midiOwner = null;
    t._cancelMidi('loop');
    const heard = port.heard().map((m) => [m.data[0] & 0xf0, m.data[1], +(m.at / 1000).toFixed(3)]);
    ok(heard.some(([type, key, at]) => type === 0x90 && key === 7 && at === 400.6), 'the one-shot note is sent again after clear()');
    ok(heard.some(([type, cc, at]) => type === 0xb0 && cc === 1 && at === 400.6), 'and its control too');
    ok(!heard.some(([type, key]) => type === 0x90 && key === 0), 'the loop note is cancelled');
}

Date.now = realDateNow;
console.log(`output tests: ${passed} passed`);
