/**
 * Tests for the sketch library (src/library.ts): titles, export and import
 * of files, merging imports, and the localStorage store. npm test
 */
import assert from 'node:assert';
import {
    exportLibrary, exportSketch, fileNameFor, localStore, makeSketch, mergeImport, normaliseSketch, parseImport, titleFromCode,
} from '../src/library.ts';

let passed = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };

// Titles come from the first comment
eq(titleFromCode('// Bossa nova: the bossa clave over a ii-V-I in C.\nsetCPS(0.55)'), 'Bossa nova');
eq(titleFromCode('// Jingle Bells - James Lord Pierpont (1857), the chorus.'), 'Jingle Bells');
eq(titleFromCode('sound("bd sn")'), 'Untitled');
eq(titleFromCode('// Ctrl+Enter (Cmd+Enter on Mac) to play, Esc to stop.\n// Ode to Joy over a house beat: same melody.'), 'Ode to Joy over a house beat');
eq(titleFromCode('// Ctrl+Enter to play.\nsound("bd")'), 'Untitled');
eq(makeSketch('// House beat\nsound("bd*4")', '', 0.5, 1000).title, 'House beat');
eq(makeSketch('sound("bd")', '  My beat ', 0.5, 1000).title, 'My beat');
eq(fileNameFor('Für Elise (Beethoven, 1810)'), 'fur-elise-beethoven-1810');
eq(fileNameFor('!!!'), 'sketch');

// Exporting a sketch keeps its title and tempo when the code lacks them
eq(exportSketch({ title: 'Beat', code: 'sound("bd*4")', cps: 0.5 }), '// Beat\nsetCPS(0.5)\nsound("bd*4")\n');
eq(exportSketch({ title: 'House', code: '// House\nsetCPS(0.533)\nsound("bd*4")\n\n', cps: 0.8 }), '// House\nsetCPS(0.533)\nsound("bd*4")\n');

// A library round trip
const a = { id: 'a', title: 'A', code: 'sound("bd")', cps: 0.5, created: 1, updated: 2 };
const b = { id: 'b', title: 'B', code: 'sound("sn")', cps: 0.6, created: 1, updated: 5 };
const json = exportLibrary([a, b], new Date('2026-11-05T00:00:00Z'));
const file = JSON.parse(json);
eq([file.app, file.version, file.exported, file.sketches.map((s) => s.id).join()], ['tidaljs', 1, '2026-11-05T00:00:00.000Z', 'b,a']);
eq(parseImport(json).sketches.map((s) => s.title), ['B', 'A']);

// Other shapes of JSON: one sketch, a list; bad sketches are dropped
eq(parseImport(JSON.stringify(a)).sketches.length, 1);
eq(parseImport(JSON.stringify([a, { title: 'no code' }, b])).sketches.map((s) => s.id), ['a', 'b']);
assert.throws(() => parseImport('{"sketches": []}'), /no sketches/); passed++;
assert.throws(() => parseImport('   '), /empty/); passed++;

// Code files open in the editor, titled by the file name
eq(parseImport('sound("bd sn")\r\n', 'my-groove.tidal.js'), { kind: 'code', title: 'my groove', code: 'sound("bd sn")\n' });
eq(parseImport('// Lullaby\nsound("arpy")').title, 'Lullaby');
// Code that starts with [ but is not JSON is still code
eq(parseImport('[1, 2].map(x => x)\nsound("bd")', 'x.js').kind, 'code');

// Bad values are cleaned up
eq(normaliseSketch({ code: 'x', cps: -1, title: '  ' }).cps, 0.8);
eq(normaliseSketch(null), null);

// Merging an import never overwrites a saved sketch
const imported = [a, { ...b, code: 'sound("cp")' }, { ...a, id: 'c' }];
const merged = mergeImport([a, b], imported);
eq(merged.length, 2); // a is identical and skipped
eq(merged[0].id !== 'b' && merged[0].code === 'sound("cp")', true); // same id, other code: a new id
eq(merged[1].id, 'c');

// The localStorage store, and the in-memory one when storage is unavailable
const fake = () => {
    const data = new Map();
    return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
};
for (const store of [localStore(fake()), localStore(null)]) {
    eq(await store.list(), []);
    await store.put(a);
    await store.put(b);
    await store.put({ ...a, title: 'A2', updated: 9 });
    eq((await store.list()).map((s) => s.title), ['A2', 'B']);
    await store.remove('b');
    eq((await store.list()).map((s) => s.id), ['a']);
}
eq(localStore(fake()).kind + ' ' + localStore(null).kind, 'localstorage memory');

console.log(`library: all ${passed} checks passed`);
