/**
 * Checks the Reference tab's data and search (src/data/reference.ts,
 * referenceSearch.ts, referenceDocs.ts): every section is in one topic tab,
 * names are found in the entries, ranking, highlight ranges, excerpts and
 * "did you mean" suggestions. Runs in Node: npm test
 */
import assert from 'node:assert';
import { REFERENCE, REFERENCE_TOPICS } from '../src/data/reference.ts';
import { referenceDocs, referenceDocText } from '../src/data/referenceDocs.ts';
import {
    buildReferenceIndex, editDistance, excerpt, matchRanges, namesInTerm, queryWords, searchReference, suggestName,
} from '../src/data/referenceSearch.ts';

let passed = 0;
const eq = (actual, expected, msg) => { assert.deepStrictEqual(actual, expected, msg); passed++; };
const ok = (value, msg) => { assert.ok(value, msg); passed++; };

// Topics: every section in exactly one tab, no unknown or empty tabs, unique ids.
const titles = REFERENCE.map((s) => s.title);
const inTopics = REFERENCE_TOPICS.flatMap((t) => t.sections);
eq([...inTopics].sort(), [...titles].sort(), 'each Reference section is in exactly one topic');
eq(new Set(REFERENCE_TOPICS.map((t) => t.id)).size, REFERENCE_TOPICS.length, 'topic ids are unique');
for (const topic of REFERENCE_TOPICS) ok(topic.sections.length > 0, 'topic ' + topic.id + ' is empty');

// Names in the code column.
eq(namesInTerm('.delay(x) .delaytime(s) .delayfeedback(x)'), ['.delay', '.delaytime', '.delayfeedback']);
eq(namesInTerm('scale(name, p)'), ['scale']);
eq(namesInTerm('ur(n, "a b:fx", { a, b }, { fx })'), ['ur']);
eq(namesInTerm('timeCat([[w, p], ..])'), ['timeCat']);
eq(namesInTerm('setBus(k, v) / bus(k)'), ['setBus', 'bus']);
eq(namesInTerm('sine cosine saw'), ['sine', 'cosine', 'saw']);
eq(namesInTerm('"bd sn"'), [], 'mini-notation has no names');
eq(namesInTerm('Ctrl+Enter'), [], 'key names are not functions');

// The index: every item, note and closing paragraph, in tab order.
const index = buildReferenceIndex(REFERENCE, REFERENCE_TOPICS, referenceDocText);
const count = REFERENCE.reduce((n, s) => n + (s.notes?.length ?? 0) + (s.items?.length ?? 0) + (s.after ? 1 : 0), 0);
eq(index.length, count, 'every entry is indexed');
eq(new Set(index.map((e) => e.id)).size, index.length, 'entry ids are unique');
eq(index[0].topicId, REFERENCE_TOPICS[0].id, 'the index follows the tab order');
eq(index.map((e) => e.order), index.map((_, i) => i), 'order is the reading order');

// Extended help: every item but the editor keys and the bare mini-notation step opens with docs.
const withoutDocs = index.filter((e) => e.kind === 'item' && !referenceDocs({ term: e.term, refs: e.refs, section: e.section }).length);
eq(withoutDocs.filter((e) => e.section !== 'Keys').map((e) => e.term), ['"bd sn"'], 'items without extended help');
eq(referenceDocs({ term: '"bd ~ sn"', refs: [], section: 'Mini-notation' }).map((d) => d.label), ['~']);
eq(referenceDocs({ term: '.fast(n)', refs: ['.fast'], section: 'Time' })[0].label, '.fast(factor)', 'labels use the signature');
ok(/sawtooth/i.test(referenceDocs({ term: 'x', refs: ['saw'], section: 'Sounds' })[0].doc.about), 'Sounds prefer the synth');
ok(!/sawtooth synth/i.test(referenceDocs({ term: 'x', refs: ['saw'], section: 'Signals' })[0].doc.about), 'Signals prefer the signal');

// Search: case-insensitive, every word must match, names first.
const top = (q) => searchReference(index, q)[0]?.entry;
eq(searchReference(index, ''), [], 'an empty query finds nothing');
eq(searchReference(index, '   '), []);
eq(queryWords('  Low  PASS '), ['low', 'pass']);
eq(top('lpf').term, '.lpf(hz)', 'exact name first');
eq(top('LPF').term, '.lpf(hz)', 'case-insensitive');
eq(top('.fast').term, '.fast(n)', 'a leading dot is fine');
eq(top('fast(').term, '.fast(n)', 'so is an open parenthesis');
eq(top('reverb').term, '.reverb(x)');
eq(top('stack').term, 'stack([..])');
eq(top('xfade').section, 'Streams and transitions');
ok(searchReference(index, 'low pass').every((m) => /low/.test(m.entry.textLower + m.entry.docLower)), 'all words must match');
ok(searchReference(index, 'low pass').some((m) => m.entry.term === '.lpf(hz)'), 'words match in any order');
const fast = searchReference(index, 'fast');
const firstNonName = fast.findIndex((m) => !m.entry.names.some((n) => n.includes('fast')));
ok(fast.slice(firstNonName).every((m) => !m.entry.names.some((n) => n.includes('fast'))), 'name matches rank above the rest');
ok(top('snare').kind === 'note' || top('snare').section === 'Sounds', 'paragraphs are searched');
const docOnly = searchReference(index, 'wobble');
ok(docOnly.length > 0 && docOnly.every((m) => !m.visible), 'the extended help is searched, marked as not visible');
eq(searchReference(index, 'zzzqqq'), [], 'nonsense finds nothing');

// Highlight ranges: every occurrence, merged, case-insensitive.
eq(matchRanges('Low-pass filter, low', 'low'), [[0, 3], [17, 20]]);
eq(matchRanges('abcabc', 'abc bca'), [[0, 6]], 'overlapping ranges merge');
eq(matchRanges('text', ''), []);
eq(matchRanges('.Fast(n)', 'fa st'), [[1, 5]], 'adjacent ranges merge');

// Excerpts of long help around the match.
const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
const cut = excerpt(long, 'eight', 20);
ok(cut.includes('eight') && cut.startsWith('…') && cut.endsWith('…'), 'excerpt with ellipses: ' + cut);
ok(!/^…\S*[a-z]…?$/.test(cut) && !cut.slice(1).startsWith(' '), 'excerpts cut at spaces');
eq(excerpt('short text', 'text'), 'short text');

// Suggestions for typos.
eq(editDistance('revreb', 'reverb'), 1, 'a swap is one edit');
eq(editDistance('kitten', 'sitting'), 3);
eq(suggestName(index, 'revreb'), 'reverb');
eq(suggestName(index, 'stak'), 'stack');
ok(['lpf', 'lfo'].includes(suggestName(index, 'lfp')), 'a close name with the same first letter (not ifp)');
eq(suggestName(index, 'xfaed'), 'xfade');
eq(suggestName(index, 'zq'), undefined, 'too short to guess');
eq(suggestName(index, 'qqqqqqq'), undefined, 'nothing close');
eq(suggestName(index, 'low pass'), undefined, 'only one-word queries');

console.log('reference: all ' + passed + ' checks passed (' + index.length + ' entries in ' + REFERENCE_TOPICS.length + ' tabs)');
