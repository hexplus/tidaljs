/**
 * Tests for the editor's rules that need no DOM: where code came from and
 * when it may run (src/provenance.ts), the draft and what counts as unsaved
 * (src/drafts.ts), the guards for asynchronous actions (src/runs.ts), and
 * provenance kept through the library (src/library.ts). The browser flows
 * are in test/browser. npm test
 */
import assert from 'node:assert';
import { LOCAL, approve, describeOrigin, fingerprint, holds, isExternal, readProvenance } from '../src/provenance.ts';
import { differs, readDraftState, setsTempo } from '../src/drafts.ts';
import { Tickets, singleFlight } from '../src/runs.ts';
import { exportLibrary, markImported, mergeImport, normaliseSketch, parseImport } from '../src/library.ts';

let passed = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };
const ok = (v, msg) => { assert.ok(v, msg); passed++; };

// ---------------- 1. Provenance and approval
eq(isExternal(LOCAL), false);
eq(isExternal({ origin: 'shared', label: 'x' }), true);
// Anything unreadable from storage or a file is external, never local.
eq(readProvenance(null).origin, 'import');
eq(readProvenance({ origin: 'trusted-by-me' }).origin, 'import');
eq(readProvenance({ origin: 'local' }).origin, 'local');
eq(readProvenance({ origin: 'shared', label: 'Song' }), { origin: 'shared', label: 'Song' });
ok(describeOrigin({ origin: 'supercollider', label: 'a.scd' }).includes('SuperCollider'));
// Approval holds for exactly the text and document it was given for.
const code = 'd1(sound("bd"))';
const a = approve(code, 3);
eq(holds(a, code, 3), true);
eq(holds(a, code + ' ', 3), false, 'an edit makes it stale');
eq(holds(a, code, 4), false, 'another document makes it stale');
eq(holds(null, code, 3), false);
ok(fingerprint('a') !== fingerprint('b') && fingerprint('ab') !== fingerprint('ba'));
eq(fingerprint('same'), fingerprint('same'));

// ---------------- 6. Drafts: code, title and tempo
const base = { code: 'd1(sound("bd"))', title: 'Beat', cps: 0.5 };
eq(differs({ ...base }, base), false);
eq(differs({ ...base, code: 'd1(sound("sn"))' }, base), true);
eq(differs({ ...base, title: 'Other' }, base), true, 'a new title is unsaved');
eq(differs({ ...base, title: ' Beat ' }, base), false);
eq(differs({ ...base, cps: 0.6 }, base), true, 'a new tempo is unsaved');
// Code that sets its own tempo: the tempo field follows it and is not part of the draft.
const timed = { code: 'setCPS(0.6)\nd1(sound("bd"))', title: '', cps: 0.5 };
eq(setsTempo(timed.code), true);
eq(differs({ ...timed, cps: 0.6 }, timed), false);
// Stored state: read back, and nothing for unreadable text.
eq(readDraftState(null), null);
eq(readDraftState('{oops'), null);
eq(readDraftState(JSON.stringify({ baseline: base, title: 'T', cps: 0.7, sketchId: 'abc', documentId: 'd1' })), { baseline: base, title: 'T', cps: 0.7, sketchId: 'abc', documentId: 'd1' });

// ---------------- 3. One engine start for many clicks; stale tickets
{
    let started = 0;
    let finish;
    const start = singleFlight(() => { started++; return new Promise((r) => { finish = r; }); });
    const p1 = start();
    const p2 = start();
    eq(started, 1, 'a second click shares the start in flight');
    finish('engine');
    eq(await p1, 'engine');
    eq(await p2, 'engine');
    start();
    eq(started, 2, 'after it settles, a new start can begin');
    finish('again');

    const tickets = new Tickets();
    const play = tickets.take();
    eq(tickets.current(play), true);
    tickets.cancel(); // Stop
    eq(tickets.current(play), false, 'a Play waiting for the audio is stale after Stop');
    const newer = tickets.take();
    eq([tickets.current(newer), tickets.current(play)], [true, false]);
}

// ---------------- 1. Provenance through the library: save, export, import
{
    // Sketches saved before provenance existed are the person's own.
    eq(normaliseSketch({ code: 'x', title: 'Old' }).provenance, undefined);
    // An external sketch keeps its provenance through saving (normalise) and export.
    const saved = normaliseSketch({ id: 's1', code: 'x', title: 'From a link', provenance: { origin: 'shared', label: 'Song' } });
    eq(saved.provenance, { origin: 'shared', label: 'Song' });
    const file = exportLibrary([saved]);
    const back = parseImport(file, 'lib.json');
    eq(back.kind, 'library');
    eq(back.sketches[0].provenance, { origin: 'shared', label: 'Song' });
    // A file cannot make code local: every imported sketch is external.
    const claimed = parseImport(JSON.stringify([{ id: 'x', code: 'y', title: 'Mine', provenance: { origin: 'local' } }]), 'evil.json');
    const marked = markImported(claimed.sketches, 'evil.json');
    eq(marked[0].provenance, { origin: 'library', label: 'evil.json' });
    eq(mergeImport([], marked)[0].provenance.origin, 'library');
}

// ---------------- 1. The document kept between visits: one record, read conservatively
{
    const { DOCUMENT_KEY, LEGACY_KEYS, readDocument, serializeDocument } = await import('../src/document.ts');
    const { DEFAULT_CODE } = await import('../src/data/examples.ts');
    const store = (entries) => (key) => (key in entries ? entries[key] : null);
    // A snapshot comes back as written: code, provenance, identity and the tempo waiting for the first run.
    const doc = { code: 'd1(sound("x"))', provenance: { origin: 'shared', label: 'Song' }, id: 'doc-1', pendingCps: 1.75 };
    eq(readDocument(store({ [DOCUMENT_KEY]: serializeDocument(doc) })), doc);
    // An intentionally empty draft stays empty; nothing stored gives the starting code.
    eq(readDocument(store({ [DOCUMENT_KEY]: serializeDocument({ ...doc, code: '', provenance: LOCAL, pendingCps: null }) })).code, '');
    eq(readDocument(store({})).code, DEFAULT_CODE);
    eq(readDocument(store({ [LEGACY_KEYS.code]: '' })).code, '', 'an empty legacy draft is kept too');
    // A snapshot without a provenance is not trusted as local.
    eq(readDocument(store({ [DOCUMENT_KEY]: JSON.stringify({ code: 'x' }) })).provenance.origin, 'import');
    // Legacy records: separate code and provenance cannot be known to match, so local becomes external.
    eq(readDocument(store({ [LEGACY_KEYS.code]: 'window.x = 1', [LEGACY_KEYS.provenance]: JSON.stringify(LOCAL) })).provenance.origin, 'import');
    eq(readDocument(store({ [LEGACY_KEYS.code]: 'x', [LEGACY_KEYS.provenance]: JSON.stringify({ origin: 'shared', label: 'S' }) })).provenance, { origin: 'shared', label: 'S' });
    eq(readDocument(store({ [LEGACY_KEYS.code]: 'x', [LEGACY_KEYS.shared]: '1' })).provenance.origin, 'shared');
    // Code from before provenance existed (no record at all) is the person's own.
    eq(readDocument(store({ [LEGACY_KEYS.code]: 'd1(sound("bd"))' })).provenance, LOCAL);
}

console.log(`editor: all ${passed} checks passed`);
