/**
 * Evaluates code made by tool/midi2tidal.py in TidalJS and prints what it
 * plays, as JSON, for tool/tests/test_midi2tidal.py:
 *
 *   node tool/tests/evaluate.mjs code.js CYCLES
 *
 * { success, error, warnings, cps, injected, events: [{ begin, end, note, s, amp, level }] }
 *
 * begin and end are in cycles. level is the volume the Web Audio synth is
 * built at, relative to the same event without amp or gain: each event is
 * played twice into a fake audio graph and the peaks of its gain nodes compared.
 */
import fs from 'node:fs';
import vm from 'node:vm';

const [file, cyclesArg] = process.argv.slice(2);
vm.runInThisContext(fs.readFileSync(new URL('../../tidal.js', import.meta.url), 'utf8'), { filename: 'tidal.js' });
const { TidalJS } = globalThis;
const warnings = [];
console.error = () => {};
console.warn = () => {};
Math.random = () => 0.5; // the same graph on both plays of an event

function fakeAudio() {
    const nodes = [];
    const param = (initial = 0) => {
        let value = initial;
        const p = {
            peak: 0,
            get value() { return value; },
            set value(v) { value = v; p.note(v); },
            note(v) { if (Number.isFinite(v)) p.peak = Math.max(p.peak, Math.abs(v)); },
            setValueAtTime(v) { p.note(v); }, linearRampToValueAtTime(v) { p.note(v); },
            exponentialRampToValueAtTime(v) { p.note(v); }, setTargetAtTime(v) { p.note(v); },
            setValueCurveAtTime(values) { for (const v of values) p.note(v); },
            cancelScheduledValues() {}, cancelAndHoldAtTime() {},
        };
        return p;
    };
    const base = (kind) => ({ kind, connect(x) { return x; }, disconnect() {} });
    const source = (kind) => ({ ...base(kind), start() {}, stop() {} });
    const track = (n) => { nodes.push(n); return n; };
    const ctx = {
        currentTime: 0, sampleRate: 48000, state: 'running', resume() {},
        createGain: () => track({ ...base('gain'), gain: param(1) }),
        createBiquadFilter: () => track({ ...base('filter'), type: '', frequency: param(350), Q: param(1), gain: param(0) }),
        createStereoPanner: () => track({ ...base('panner'), pan: param(0) }),
        createOscillator: () => track({ ...source('osc'), type: 'sine', frequency: param(440), detune: param(0), setPeriodicWave() {} }),
        createConstantSource: () => track({ ...source('constant'), offset: param(1) }),
        createBufferSource: () => track({ ...source('buffer'), playbackRate: param(1), detune: param(0) }),
        createWaveShaper: () => track({ ...base('shaper') }),
        createDelay: () => track({ ...base('delay'), delayTime: param(0) }),
        createChannelMerger: () => track(base('merger')),
        createConvolver: () => track(base('convolver')),
        createDynamicsCompressor: () => track({ ...base('compressor'), threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }),
        createBuffer: (ch, length, sampleRate) => ({ numberOfChannels: ch, length, sampleRate, duration: length / sampleRate, getChannelData: () => new Float32Array(length) }),
        createPeriodicWave: () => ({}),
    };
    return { ctx, nodes };
}

const t = new TidalJS();
const { ctx, nodes } = fakeAudio();
t.audioContext = ctx;
t.masterGain = ctx.createGain();
t.setupGlobalFunctions();
t._startTimer = () => {};
t._stopTimer = () => {};
t.loadSamples = () => Promise.resolve(); // no network: Dirt-Samples banks stay unknown

const result = t.eval(fs.readFileSync(file, 'utf8'));
const out = { success: result.success, error: result.error ?? null, warnings: result.warnings, cps: t.cps, injected: globalThis.injected !== undefined, events: [] };

/** The peaks of the gain nodes one play of an event builds. */
function peaks(value, duration) {
    nodes.length = 0;
    t.cps = 1;
    t._anchorTime = 0;
    t._anchorCycle = 0;
    t._session = t._createSession();
    try { t.playEvent(value, 0, duration); } catch { return null; }
    return nodes.filter((n) => n.kind === 'gain').map((n) => n.gain.peak);
}

if (result.success) {
    const cycles = Number(cyclesArg);
    for (const pattern of t.channels.values()) {
        for (const ev of pattern.query(0, cycles)) {
            const v = ev.value;
            const event = { begin: ev.begin, end: ev.end, note: v.note ?? null, s: v.s ?? null, amp: v.amp ?? null, level: null };
            const loud = peaks(v, ev.end - ev.begin);
            const { amp, gain, ...plain } = v;
            const quiet = peaks(plain, ev.end - ev.begin);
            if (loud && quiet && loud.length === quiet.length) {
                // Gains the level does not reach are equal on both plays. The level scales
                // the others (one node, or every partial of a synth alike): their sums give it.
                const changed = loud.map((p, i) => [p, quiet[i]]).filter(([a, b]) => Math.abs(a - b) > 1e-12);
                const sum = (i) => changed.reduce((s, pair) => s + pair[i], 0);
                event.level = changed.length ? sum(0) / sum(1) : 1;
            }
            out.events.push(event);
        }
    }
    out.events.sort((a, b) => a.begin - b.begin || (a.note ?? 0) - (b.note ?? 0) || String(a.s).localeCompare(String(b.s)));
}
process.stdout.write(JSON.stringify(out));
