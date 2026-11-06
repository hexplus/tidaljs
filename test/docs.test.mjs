/**
 * Checks the extended help (src/data/docs.ts): every function and method has
 * a doc, every "see also" name exists, and every example runs in the engine
 * without errors. Runs in Node (which strips the TypeScript types): npm test
 */
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { DOCS, GLOBAL_DOCS, MINI_DOCS, SCALE_DOCS, SOUND_DOCS } from '../src/data/docs.ts';
import { GLOBAL_SIGNATURES, METHOD_SIGNATURES } from '../src/data/signatures.ts';
import { SNIPPETS } from '../src/data/snippets.ts';
import { docForLabel } from '../src/data/docs.ts';

vm.runInThisContext(fs.readFileSync(new URL('../tidal.js', import.meta.url), 'utf8'), { filename: 'tidal.js' });
const { TidalJS, PatternBuilder } = globalThis;
console.error = () => {};
console.warn = () => {};

const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} } });
const t = new TidalJS();
t.audioContext = { currentTime: 0, state: 'running', createGain: node, resume() {} };
t.masterGain = node();
t.setupGlobalFunctions();
t._startTimer = () => {};
t._stopTimer = () => {};
// Examples must not touch the network, the downloads or MIDI.
t.loadSamples = () => Promise.resolve();
t.startRecording = () => {};
t.stopRecording = () => Promise.resolve();
t.exportPattern = () => {};
t.midiOutputs = () => [];

let passed = 0;
const ok = (value, msg) => { assert.ok(value, msg); passed++; };

// Coverage: every method, every global and every signal.
const methods = Object.getOwnPropertyNames(PatternBuilder.prototype).filter((n) => !n.startsWith('_') && n !== 'constructor');
for (const name of methods) ok(DOCS[name], 'no doc for method .' + name + '()');
for (const name of Object.keys(GLOBAL_SIGNATURES)) ok(GLOBAL_DOCS[name] || DOCS[name], 'no doc for ' + name + '()');
for (const name of Object.keys(METHOD_SIGNATURES)) ok(DOCS[name], 'no doc for .' + name + '()');
for (const name of ['silence', 'sine', 'cosine', 'saw', 'isaw', 'tri', 'square', 'rand', 'perlin', 'const', 'let']) ok(DOCS[name], 'no doc for ' + name);
for (const name of TidalJS.soundNames) ok(SOUND_DOCS[name], 'no doc for sound ' + name);
for (const name of TidalJS.scaleNames) ok(SCALE_DOCS[name], 'no doc for scale ' + name);
for (const [, list] of Object.entries(SNIPPETS)) {
    for (const snippet of list) ok(docForLabel(snippet.l), 'no doc for palette button ' + snippet.l);
}

// "See also" names exist.
const all = { ...DOCS, ...GLOBAL_DOCS, ...SOUND_DOCS };
for (const [name, doc] of Object.entries(all)) {
    for (const ref of doc.see ?? []) ok(DOCS[ref] || GLOBAL_DOCS[ref] || SOUND_DOCS[ref], name + ' refers to unknown ' + ref);
}

// Every example evaluates and plays without errors or warnings. Sample-bank
// names only exist once samples() has loaded, so those warnings are allowed.
const ALLOWED = /Unknown sound "(breaks125|drum)"|Web MIDI is not available/;
const SILENT = new Set(['query', 'firstCycle', 'exportPattern']);
const examples = [
    ...Object.entries(DOCS), ...Object.entries(GLOBAL_DOCS), ...Object.entries(SOUND_DOCS), ...Object.entries(MINI_DOCS),
].filter(([, doc]) => doc.example);
const failures = [];
for (const [name, doc] of examples) {
    try {
        const result = t.eval(doc.example);
        ok(result.success, 'failed: ' + result.error);
        const warnings = result.warnings.filter((w) => !ALLOWED.test(w));
        ok(warnings.length === 0, 'warns: ' + warnings.join('; '));
        ok(result.activePatterns > 0 || SILENT.has(name) || !/sound\(/.test(doc.example), 'plays nothing');
        for (const pattern of t.channels.values()) {
            for (const ev of pattern.query(0, 4)) ok(ev && typeof ev.value === 'object', 'bad event');
        }
    } catch (error) {
        failures.push(name + ': ' + error.message + '\n    ' + doc.example.replace(/\n/g, '\n    '));
    }
    t.stopAll();
}
assert.deepStrictEqual(failures, [], 'examples that do not run:\n' + failures.join('\n'));

console.log('docs: all ' + passed + ' checks passed (' + examples.length + ' examples)');
