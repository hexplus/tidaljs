/**
 * The editor's hover help (src/editor/hover.ts) and suggestions
 * (src/editor/language.ts): every global the engine defines, every pattern
 * method, sound, scale, arpeggio mode and mini-notation symbol gets a
 * tooltip, and the tooltip says the right thing. Runs in Node: npm test
 */
import assert from 'node:assert';
import { describeAt } from '../src/editor/hover.ts';
import { GLOBALS, METHODS, MINI_HELP } from '../src/editor/language.ts';
import { METHOD_SIGNATURES } from '../src/data/signatures.ts';
import { TidalJS, patternMethods } from '../src/engine.ts';

let passed = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };
const ok = (v, msg) => { assert.ok(v, msg); passed++; };

/** The hover help at the first `marker` in `code` (the marker's first character). */
const hoverAt = (code, marker, from = 0) => {
    const at = code.indexOf(marker, from);
    assert.ok(at >= 0, 'no ' + marker + ' in ' + code);
    return describeAt(code, at);
};
/** A tooltip that says something: a summary, parameter lines or extended help. */
const says = (help) => !!help && (!!help.summary || help.lines.length > 0 || !!help.doc);

// ---------------- Every global the engine defines (except the engine object itself)
console.error = () => {};
console.warn = () => {};
const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} } });
const before = new Set(Object.getOwnPropertyNames(globalThis));
const t = new TidalJS();
t.audioContext = { currentTime: 0, state: 'running', createGain: node, resume() {} };
t.masterGain = node();
t.setupGlobalFunctions();
const globals = Object.getOwnPropertyNames(globalThis).filter((n) => !before.has(n) && n !== 'tidal');
ok(globals.length > 200, 'the engine defines its globals');
for (const name of globals) {
    const help = hoverAt(name + '()', name);
    ok(says(help), 'no hover help for the global ' + name);
    ok(GLOBALS.some((g) => g.name === name), name + ' is not suggested');
}
// Every suggestion explains itself.
for (const item of [...GLOBALS, ...METHODS]) ok(item.desc || item.doc, 'the suggestion ' + item.name + ' has no text');

// The signals and envelopes that only have extended help still get a tooltip.
for (const name of ['brand', 'saw2', 'isaw2', 'tri2', 'square2', 'cosine2', 'envLR', 'envEq', 'envEqR']) {
    const help = hoverAt('sound("hh*8").pan(' + name + ')', name);
    ok(help && help.summary && help.doc, name + ' has a summary and extended help');
}

// ---------------- Every pattern method: a summary, and the parameters when it takes any
const methods = patternMethods().map((m) => m.name).filter((n) => !n.startsWith('_') && n !== 'constructor' && n !== 'withValue');
for (const name of methods) {
    const help = hoverAt('sound("bd").' + name + '()', name);
    ok(says(help) && help.summary, 'no hover summary for .' + name + '()');
    ok(METHOD_SIGNATURES[name], '.' + name + '() has no signature');
}
// No signature for a method that does not exist (the *Take controls skip the aliases).
for (const name of Object.keys(METHOD_SIGNATURES)) ok(methods.includes(name), 'a signature for the missing method .' + name + '()');
{
    const help = hoverAt('sound("bd").gainTake("g", [1, 0.8])', 'gainTake');
    eq(help.title, '.gainTake(name, list)');
    eq(help.lines.map(([name]) => name), ['name', 'list']);
}

// ---------------- Words inside strings
for (const name of TidalJS.soundNames) {
    const help = hoverAt('sound("' + name + '")', name);
    ok(says(help) && !/Unknown/.test(help.summary), 'sound ' + name);
}
for (const name of TidalJS.scaleNames) {
    const help = hoverAt('scale("' + name + '", "0 2")', name);
    ok(says(help) && !/Unknown/.test(help.summary), 'scale ' + name);
}
for (const mode of TidalJS.arpModes) {
    const help = hoverAt('note("c\'maj").arp("' + mode + '")', mode);
    ok(says(help) && !/Unknown/.test(help.summary), 'arpeggio mode ' + mode);
}
for (const vowel of TidalJS.vowels) ok(says(hoverAt('sound("saw").vowel("' + vowel + '")', vowel, 18)), 'vowel ' + vowel);

// ---------------- Mini-notation
for (const ch of Object.keys(MINI_HELP)) {
    const code = 'sound("bd ' + ch + ' sn")';
    const help = describeAt(code, code.indexOf(' ' + ch + ' ') + 1);
    ok(says(help) && help.doc, 'mini-notation ' + ch);
}
{
    // "-" is a rest, not an unknown sound, alone or in a group.
    let help = hoverAt('sound("bd - sn -")', '-');
    eq([help.title, /Rest/.test(help.summary), !!help.doc], ['-', true, true]);
    help = hoverAt('sound("[- sn]")', '-');
    eq(help.title, '-');
    // A negative number is still a number.
    eq(hoverAt('note("-12")', '-').lines[0][0], 'note');

    // ^name reads a bus: on the ^ and on the name.
    help = hoverAt('sound("^kick sn")', '^');
    eq([help.title, /setBus\("kick"/.test(help.summary), !!help.doc], ['^kick', true, true]);
    eq(hoverAt('sound("^kick sn")', 'kick').title, '^kick');

    // Ratios: 3q after a modifier, inside a modifier's group, and fractions.
    help = hoverAt('sound("bd*3q")', '3q');
    eq([help.title, help.lines], ['*3q', [['value', '3q = 0.75']]]);
    help = hoverAt('sound("bd*<4 3q>")', '3q');
    eq([help.lines, !!help.doc], [[['value', '3q = 0.75']], true]);
    help = hoverAt('sound("bd@1%3")', '%');
    eq([help.title, help.lines], ['1%3', [['value', '1%3 = 0.3333']]]);
    eq(hoverAt('sound("bd@1%3")', '3').title, '1%3', 'the digits of a fraction too');
    // Elsewhere "3q" is a word, such as a sound name, and a polymeter's % keeps its own help.
    ok(/Unknown sound/.test(hoverAt('sound("3q")', '3q').summary), '3q as a sound name');
    eq(hoverAt('sound("{bd sn}%4")', '%').title, '%n');
}

console.log(`hover: all ${passed} checks passed`);
