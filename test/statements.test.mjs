/**
 * Statement splitting in tidal.js: how live code is cut into top-level
 * statements (regular expressions, template literals, comments, control
 * flow, automatic semicolon insertion), what eval() collects from them, and
 * where it reports errors. Runs in Node with a fake audio context.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(fs.readFileSync(new URL('../tidal.js', import.meta.url), 'utf8'), { filename: 'tidal.js' });
const { TidalJS } = globalThis;

// Failing evaluations log on purpose; keep the output to the result.
console.error = () => {};
console.warn = () => {};

const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} } });
const t = new TidalJS();
t.audioContext = { currentTime: 0, state: 'running', createGain: node, resume() {} };
t.masterGain = node();
t.setupGlobalFunctions();
t._startTimer = () => {};
t._stopTimer = () => {};

let passed = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };

const split = (code) => TidalJS.splitStatements(code);
// Every range is an exact slice of the source.
const ranges = (code) => {
    const list = TidalJS.splitStatementRanges(code);
    for (const s of list) assert.strictEqual(s.text, code.slice(s.start, s.end), `text is the source slice in ${JSON.stringify(code)}`);
    return list.map((s) => [s.start, s.end]);
};
// eval() succeeds and plays this many patterns.
const plays = (code, count, msg = code) => {
    const r = t.eval(code);
    eq(r.success, true, `${msg}: ${r.error}`);
    eq(r.activePatterns, count, `${msg}: patterns`);
    return r;
};
// eval() fails in the statement that is the given slice of the source.
const failsAt = (code, slice, line) => {
    const r = t.eval(code);
    eq(r.success, false, `${code}: should fail`);
    eq(code.slice(r.location.start, r.location.end), slice, `${code}: error range`);
    eq(r.location.line, line, `${code}: error line`);
    return r;
};

// ---------------- Regular expression literals ----------------
// "//" inside a character class or escaped is not a comment.
eq(split('const re = /[/]/\nsound("bd")'), ['const re = /[/]/', 'sound("bd")']);
plays('const re = /[/]/\nsound("bd")', 1);
plays('const ok = /x\\/\\//.test("x//")\nsound(ok ? "bd" : "sn")', 1);
// Quotes and backticks in a regex do not start strings.
eq(split("const re = /'/\nsound(\"bd\")"), ["const re = /'/", 'sound("bd")']);
eq(split('const re = /"/g\nsound("bd")'), ['const re = /"/g', 'sound("bd")']);
eq(split('const re = /`/\nsound("bd")\nsound("hh")'), ['const re = /`/', 'sound("bd")', 'sound("hh")']);
plays("const re = /'/\nsound(\"bd\")\nsound(\"hh\")", 2);
// A regex inside a call, after an operator, after return and after if (...).
plays('sound("bd sn".replace(/sn/g, "hh"))\nsound("cp")', 2);
plays('const f = (s) => { return /^b/.test(s) }\nsound(f("bd") ? "bd" : "sn")', 1);
plays('let s = "sn"\nif (true) /x/.test("x") && (s = "bd")\nsound(s)', 1);
// Division is not a regex: after a name, a number, ")" and "]".
eq(split('const a = 4 / 2 / 1\nsound("bd").gain(a / 2)'), ['const a = 4 / 2 / 1', 'sound("bd").gain(a / 2)']);
eq(split('const a = (8) / 2 / [2][0]\nsound("bd")'), ['const a = (8) / 2 / [2][0]', 'sound("bd")']);
eq(split('const o = { a: 4 }\nconst b = o.a / 2 / 1\nsound("bd")').length, 3);
// A line starting with "/" after a complete line is a division, as in JavaScript.
eq(split('const a = 8\n/ 2\nsound("bd").gain(a)'), ['const a = 8\n/ 2', 'sound("bd").gain(a)']);

// ---------------- Template literals ----------------
eq(split('const a = "bd"\nconst s = `${ `${a}` } sn`\nsound(s)\nsound("hh")').length, 4);
plays('const a = "bd"\nconst s = `${ `${a}` } sn`\nsound(s)\nsound("hh")', 2);
// Braces, strings, backticks and comments inside ${...}.
eq(split('const s = `${ {a: "bd"}.a } ${"}" && "sn"}`\nsound(s)\nsound("hh")'), ['const s = `${ {a: "bd"}.a } ${"}" && "sn"}`', 'sound(s)', 'sound("hh")']);
plays('const s = `${ {a: "bd"}.a } ${"}" && "sn"}`\nsound(s)\nsound("hh")', 2);
plays('const s = `${ /* } ` */ "bd" // } `\n}`\nsound(s)\nsound("hh")', 2);
plays('const s = `${ /`/.test("`") ? "bd" : "sn" }`\nsound(s)', 1);
plays('const s = `a\n// not a comment\nb`.length > 3 ? "bd" : "sn"\nsound(s)', 1);
// A tagged template on the next line continues the expression.
eq(split('const s = String.raw\n`bd`\nsound(s)'), ['const s = String.raw\n`bd`', 'sound(s)']);

// ---------------- Comments ----------------
eq(split('sound("bd") // a "quote and /regex/\nsound("hh") /* ` */\n/* \' */ sound("cp")'), ['sound("bd")', 'sound("hh")', 'sound("cp")']);
// A block comment spanning lines separates statements, as a line break does.
eq(split('sound("bd") /*\n*/ sound("hh")'), ['sound("bd")', 'sound("hh")']);
plays('sound("bd") /*\n*/ sound("hh")', 2);
// A comment inside a statement stays in its (exact) text.
eq(split('sound("bd") // first\n  .fast(2) /* x */\n  .gain(0.5)'), ['sound("bd") // first\n  .fast(2) /* x */\n  .gain(0.5)']);
plays('sound("bd") // first\n  .fast(2) /* x */\n  .gain(0.5)', 1);
eq(split('// only a comment\n/* and another */'), []);

// ---------------- Control flow over several lines ----------------
eq(split('let n = 1\nif (n > 0)\n{\n  n = 2\n}\nelse {\n  n = 3\n}\nsound("bd")').length, 3);
plays('let n = 1\nif (n > 0)\n{\n  n = 2\n}\nelse {\n  n = 3\n}\nsound(n === 2 ? "bd" : "sn")', 1);
plays('let s = "sn"\nif (false) s = "hh"\nelse if (true)\n  s = "bd"\nelse s = "cp"\nsound(s)', 1);
plays('let s = "sn"\nif (true) s = "bd"; else s = "hh";\nsound(s)', 1);
eq(split('try {\n  x()\n}\ncatch (e) {\n}\nfinally {\n}\nsound("bd")').length, 2);
plays('let n = 1\ntry {\n  n = 2\n}\ncatch {\n}\nfinally {\n  n++\n}\nsound(n === 3 ? "bd" : "sn")', 1);
eq(split('let n = 0\ndo {\n  n++\n}\nwhile (n < 3)\nsound("bd")').length, 3);
plays('let n = 0\ndo n++; while (n < 3)\nsound(n === 3 ? "bd" : "sn")', 1);
// The loop body on its own line belongs to the loop (it once ran only once, or the loop never ended).
plays('const xs = []\nfor (let i = 0; i < 3; i++)\n  xs.push(sound("bd"))\nstack(...xs).gain(xs.length === 3 ? 1 : 0)', 1);
eq(t.channels.values().next().value.query(0, 1).every((e) => e.value.gain === 1), true);
plays('let i = 0\nwhile (i < 2)\n  i++\nsound(i === 2 ? "bd" : "sn")', 1);
plays('let k = 0\nfor (const x of [1, 2])\n{\n  k += x\n}\nsound(k === 3 ? "bd" : "sn")', 1);
plays('let s = "sn"\nswitch (1)\n{\n  case 1: s = "bd"; break\n  default: s = "hh"\n}\nsound(s)', 1);
// Labelled statements and blocks.
plays('outer: for (let i = 0; i < 2; i++) {\n  for (;;) break outer\n}\nsound("bd")', 1);
plays('let s = "bd"\nblk: {\n  break blk\n  s = "sn"\n}\nsound(s)', 1);
// Function and class declarations end at their body: "(" on the next line starts a new statement.
eq(split('function f(x) {\n  return x.fast(2)\n}\n(f(sound("bd")))'), ['function f(x) {\n  return x.fast(2)\n}', '(f(sound("bd")))']);
plays('function f(x) {\n  return x.fast(2)\n}\n(f(sound("bd")))', 1);
plays('async function g() {}\nclass A extends Object {\n  p() { return sound("bd") }\n}\n[new A().p()][0]', 1);
// Arrow functions with block bodies, object literals spanning lines, chains.
plays('const f = (x) => {\n  return x.fast(2)\n}\nf(sound("bd"))\nsound("hh")', 2);
eq(split('const f = () => {\n}\n(sound("bd"))'), ['const f = () => {\n}', '(sound("bd"))']);
plays('const o = {\n  a: "bd",\n  b: "sn"\n}\nsound(o.a)\nsound(o.b)', 2);
plays('sound("bd")\n  .fast(2)\n  .gain(0.5)\nsound("hh")\n  ?.fast(2)', 2);
plays('stack(\n  sound("bd"),\n  sound("hh")\n)\n.every(2, (x) =>\n  x.fast(2))', 1);

// ---------------- Automatic semicolon insertion ----------------
eq(split('const a = "bd"\nconst b = "sn"\nsound(a)\nsound(b)'), ['const a = "bd"', 'const b = "sn"', 'sound(a)', 'sound(b)']);
// Lines that continue the one before, as JavaScript reads them.
eq(split('const a = 3\n- 1\nsound("bd")'), ['const a = 3\n- 1', 'sound("bd")']);
eq(split('const a = 3\n+ 1\nsound("bd")'), ['const a = 3\n+ 1', 'sound("bd")']);
eq(split('const a = 3 +\n1\nsound("bd")'), ['const a = 3 +\n1', 'sound("bd")']);
eq(split('const a = [1,\n2]\nsound("bd")'), ['const a = [1,\n2]', 'sound("bd")']);
eq(split('const a = 1,\n  b = 2\nsound("bd")'), ['const a = 1,\n  b = 2', 'sound("bd")']);
eq(split('const a = true\n  ? "bd"\n  : "sn"\nsound(a)'), ['const a = true\n  ? "bd"\n  : "sn"', 'sound(a)']);
eq(split('const a = x\n  && y\n  || z\n  ?? w\nb'), ['const a = x\n  && y\n  || z\n  ?? w', 'b']);
eq(split('const a = 1 in\nobj\nb'), ['const a = 1 in\nobj', 'b']);
eq(split('const a = x\ninstanceof Y\nb'), ['const a = x\ninstanceof Y', 'b']);
eq(split('const g = f\n(sound("bd"))'), ['const g = f\n(sound("bd"))']);
eq(split('const b = a\n[0]\nb'), ['const b = a\n[0]', 'b']);
eq(split('const p = new\nPattern()\np'), ['const p = new\nPattern()', 'p']);
eq(split('a\n?.b\nc'), ['a\n?.b', 'c']);
eq(split('x = 1\ny = 2'), ['x = 1', 'y = 2']);
plays('const a = 3\n- 1\nsound("bd").gain(a)', 1);
eq(t.channels.values().next().value.query(0, 1)[0].value.gain, 2);
// Restricted productions: return, break, continue, throw and postfix ++/--.
eq(split('const f = () => {\n  return\n}\nsound("bd")'), ['const f = () => {\n  return\n}', 'sound("bd")']);
eq(split('return\nsound("bd")'), ['return', 'sound("bd")']);
eq(split('throw\nnew Error()'), ['throw', 'new Error()']);
eq(split('l: for (;;) { break }\ncontinue\nfoo'), ['l: for (;;) { break }', 'continue', 'foo']);
eq(split('let i = 0\ni++\nsound("bd")'), ['let i = 0', 'i++', 'sound("bd")']);
plays('let i = 0\ni++\nsound("bd")', 1); // the pattern after i++ was once swallowed by it
eq(split('let i = 0\nlet j = i\n++i\nsound("bd")'), ['let i = 0', 'let j = i', '++i', 'sound("bd")']);
eq(split('a\n--\nb'), ['a', '--\nb']);
eq(split('a++\n+b\nc'), ['a++\n+b', 'c']);
// Statements separated by ";" on one line, and empty statements.
eq(split(';;sound("bd"); ;sound("hh");\n;'), ['sound("bd")', 'sound("hh")']);

// ---------------- Stable ranges ----------------
// Offsets into the original code, not shifted by comments or regexes before them.
eq(ranges('/* a // b */ const re = /[/]/ // c\n  sound("bd")'), [[13, 29], [37, 48]]);
eq(ranges('const s = `${ `x` }` /* ` */\nsound("bd") // ;\nsound("hh")'), [[0, 20], [29, 40], [46, 57]]);
eq(ranges('sound("bd")\r\nsound("hh")\r\n'), [[0, 11], [13, 24]]);
eq(ranges('  a()\n// c\nb()\n  .c()'), [[2, 5], [11, 21]]);

// ---------------- Declarations share one scope ----------------
plays('const p = sound("bd")\nlet n = 2\nfunction twice(x) { return x.fast(n) }\nclass K { static go(x) { return twice(x) } }\nK.go(p)', 1);
plays('const re = /[/]/\nconst name = re.test("a/b") ? "bd" : "sn"\nsound(name)', 1);
eq(t.channels.values().next().value.query(0, 1)[0].value.s, 'bd');

// ---------------- Error locations ----------------
// A runtime error in the third statement points at it, after comments and a regex.
const third = 'const re = /"/ // \'\nsound("bd") /* ` */\nsound("hh").fast("xyz")';
failsAt(third, 'sound("hh").fast("xyz")', 3);
failsAt('sound("bd")\n/* x // y */ sound("sn")\n// c\nsound("hh").fast("xyz")', 'sound("hh").fast("xyz")', 4);
// A syntax error is found in the statement that does not compile.
failsAt("const re = /'/\nsound(\"bd\")\nsound(\"hh\"", 'sound("hh"', 3);
failsAt('if (true) {\n}\nelse {\n}\nsound("bd")\nconst = 3', 'const = 3', 6);
failsAt('const s = `${ "}" }`\nsound("bd")\nsound(s.fast("xyz"))', 'sound(s.fast("xyz"))', 3);
// A mini-notation error still points into the string.
const mini = 'const re = /`/\nsound("bd")\nsound("[hh sn")';
failsAt(mini, '[hh sn', 3);
// The previous patterns keep playing after an error.
plays('sound("bd")', 1);
t.eval('sound("hh").fast("xyz")');
eq(t.channels.size, 1);

// ---------------- Incomplete code (while typing) never hangs ----------------
for (const code of ['sound("bd', '`abc ${', '`abc ${ "x', '/* never closed', 'const r = /abc', 'if (', 'if (x) {', 'do', 'try', 'class', 'function', 'a:', 'x => {', ')]}', '"\\', '`\\', '/[/', 'return', '{{{', '?.5:1']) {
    const list = TidalJS.splitStatementRanges(code);
    for (const s of list) assert.strictEqual(s.text, code.slice(s.start, s.end));
    eq(t.eval(code).success === true || t.eval(code).success === false, true, code);
}
eq(split('sound("bd")\nsound("hh"'), ['sound("bd")', 'sound("hh"']);

console.log(`statements: all ${passed} checks passed`);
