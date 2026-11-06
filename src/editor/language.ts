/**
 * What the editor knows about TidalJS code: completion sources, highlighting,
 * problem-marker rendering and the texts of the hover help. No DOM here.
 */
import { GLOBAL_SIGNATURES, METHOD_SIGNATURES, type Signature } from "../data/signatures.ts";
import { SNIPPETS } from "../data/snippets.ts";
import { TidalJS, patternMethods } from "../engine.ts";

export type CompletionKind = "fn" | "call" | "value" | "kw" | "word";

export interface CompletionItem {
  name: string;
  /** fn: call with arguments, call: call without, value: no call, kw: keyword, word: inside a string. */
  kind: CompletionKind;
  sig?: Signature;
  desc: string;
}

export interface Range {
  start: number;
  end: number;
}

export interface Problems {
  errors: Range[];
  warnings: Range[];
}

export const NO_PROBLEMS: Problems = { errors: [], warnings: [] };

// ---------------- Descriptions ----------------

// From the insert palette, plus a few that it lacks. Sound names are left
// out: in code, sine and saw are signals, not sounds.
export const DESCRIPTIONS: Record<string, string> = {};
for (const [category, list] of Object.entries(SNIPPETS)) {
  if (category === "Sounds") continue;
  for (const s of list) {
    const key = s.l.replace(/^\./, "").replace(/\(\)$/, "");
    if (!DESCRIPTIONS[key]) DESCRIPTIONS[key] = s.t;
  }
}
Object.assign(DESCRIPTIONS, {
  s: "Same as sound", play: "Start playing this pattern", stop: "Stop this pattern",
  query: "Events between two cycle times", firstCycle: "Events of the first cycle",
  late: "Shift later by n cycles", early: "Shift earlier by n cycles", quantize: "Same as quantise",
  arpeggiate: "Same as arp", hcutoff: "Same as hpf", bandf: "Same as bpf", velocity: "Same as vel",
  setCPS: "Cycles per second", setTempo: "Beats per minute (4 beats per cycle)", withValue: "Map every value",
  slowcat: "Same as cat", setcps: "Same as setCPS", scaleP: "Same as scale", arp: "Play chord notes in turn",
  scaleList: "Names of all scales", chordList: "Names of all chords",
  const: "Declare a constant", let: "Declare a variable",
});

export const SOUND_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  (SNIPPETS.Sounds ?? []).map((s) => [s.c, s.t]),
);

// ---------------- Completion sources ----------------

export const GLOBALS: CompletionItem[] = ([
  ["sound", "fn"], ["s", "fn"], ["stack", "fn"], ["layer", "fn"], ["cat", "fn"], ["slowcat", "fn"],
  ["fastcat", "fn"], ["randcat", "fn"], ["struct", "fn"], ["silence", "value"],
  ["sine", "value"], ["cosine", "value"], ["saw", "value"], ["isaw", "value"], ["tri", "value"],
  ["square", "value"], ["rand", "value"], ["irand", "fn"], ["perlin", "value"],
  ["scale", "fn"], ["scaleP", "fn"], ["chord", "fn"], ["arp", "fn"], ["fit", "fn"],
  ["scaleList", "call"], ["chordList", "call"], ["setBus", "fn"], ["bus", "fn"],
  ["setCPS", "fn"], ["setcps", "fn"], ["setTempo", "fn"], ["stopAll", "call"], ["hush", "call"],
  ["choose", "fn"], ["wchoose", "fn"], ["cycleChoose", "fn"], ["setOscUrl", "fn"],
  ["midiOutputs", "call"], ["record", "call"], ["stopRecording", "call"], ["exportPattern", "fn"],
  ["const", "kw"], ["let", "kw"],
] as [string, CompletionKind][]).map(([name, kind]) => {
  const sig = GLOBAL_SIGNATURES[name];
  return { name, kind, sig, desc: DESCRIPTIONS[name] || (sig ? sig[0] : "") };
});

const HIDDEN_METHODS = new Set(["constructor", "withValue"]);
const WITH_ARGUMENTS = new Set(["arp", "arpeggiate", "inversion", "midi", "osc", "sometimes"]);

export const METHODS: CompletionItem[] = patternMethods()
  .filter((m) => !m.name.startsWith("_") && !HIDDEN_METHODS.has(m.name))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(({ name, length }) => {
    const sig = METHOD_SIGNATURES[name];
    const takesArgs = sig ? sig.length > 1 : length > 0 || WITH_ARGUMENTS.has(name);
    return { name, kind: takesArgs ? "fn" : "call", sig, desc: DESCRIPTIONS[name] || (sig ? sig[0] : "") };
  });

export type StringContext = "sound" | "scale" | "chord" | "arp" | "vowel";

const words = (names: string[], desc: string | ((name: string) => string)): CompletionItem[] =>
  names.map((name) => ({ name, kind: "word", desc: typeof desc === "function" ? desc(name) : desc }));

export const STRING_SOURCES: Record<StringContext, () => CompletionItem[]> = {
  sound: () => words(TidalJS.soundNames, (n) => SOUND_DESCRIPTIONS[n] || "Sound"),
  scale: () => words(TidalJS.scaleNames, "Scale"),
  chord: () => words(TidalJS.chordNames, "Chord"),
  arp: () => words(TidalJS.arpModes, "Arpeggio mode"),
  vowel: () => words(TidalJS.vowels, "Vowel"),
};

/** Which strings get which completions, by the function they are passed to. */
export const STRING_CONTEXT: Record<string, StringContext> = {
  sound: "sound", s: "sound", overlay: "sound", append: "sound",
  scale: "scale", scaleP: "scale",
  arp: "arp", arpeggiate: "arp",
  vowel: "vowel",
  note: "chord", chord: "chord",
};

/** Items starting with the prefix first, then items containing it. */
export function rankItems(items: CompletionItem[], prefix: string): CompletionItem[] {
  const p = prefix.toLowerCase();
  if (!p) return items.slice();
  const starts: CompletionItem[] = [];
  const contains: CompletionItem[] = [];
  for (const item of items) {
    const n = item.name.toLowerCase();
    if (n.startsWith(p)) starts.push(item);
    else if (n.includes(p)) contains.push(item);
  }
  return starts.concat(contains);
}

// ---------------- Rendering helpers ----------------

const TOKENS = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(\b\d+(?:\.\d+)?\b)|(\b(?:const|let|var|function|return|if|else|new)\b)|([A-Za-z_$][\w$]*)(?=\s*\()|(=>)/g;
const TOKEN_CLASSES = ["tok-comment", "tok-string", "tok-number", "tok-keyword", "tok-fn", "tok-arrow"];

export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The code as escaped HTML with token classes. */
export function highlightHtml(text: string): string {
  let html = "";
  let last = 0;
  TOKENS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKENS.exec(text))) {
    html += escapeHtml(text.slice(last, m.index));
    const group = m.slice(1).findIndex((g) => g !== undefined);
    html += '<span class="' + TOKEN_CLASSES[group] + '">' + escapeHtml(m[0]) + "</span>";
    last = TOKENS.lastIndex;
  }
  return html + escapeHtml(text.slice(last)) + "\n";
}

/** The code as escaped HTML with error and warning ranges wrapped in marker spans. */
export function marksHtml(text: string, problems: Problems): string {
  const marks: (string | null)[] = new Array(text.length).fill(null);
  for (const r of problems.warnings) for (let i = r.start; i < Math.min(r.end, text.length); i++) marks[i] = "mk-warn";
  for (const r of problems.errors) for (let i = r.start; i < Math.min(r.end, text.length); i++) marks[i] = "mk-err";
  let html = "";
  let i = 0;
  while (i < text.length) {
    const cls = marks[i];
    let j = i + 1;
    while (j < text.length && marks[j] === cls) j++;
    const part = escapeHtml(text.slice(i, j));
    html += cls ? '<span class="' + cls + '">' + part + "</span>" : part;
    i = j;
  }
  return html + "\n";
}

/** Line numbers, red for lines with errors and amber for lines with warnings. */
export function gutterHtml(text: string, problems: Problems): string {
  const lineAt = (offset: number) => text.slice(0, offset).split("\n").length;
  const errorLines = new Set<number>();
  const warnLines = new Set<number>();
  for (const r of problems.errors) {
    for (let l = lineAt(r.start); l <= lineAt(Math.max(r.start, r.end - 1)); l++) errorLines.add(l);
  }
  for (const r of problems.warnings) warnLines.add(lineAt(r.start));
  const count = text.split("\n").length;
  let html = "";
  for (let l = 1; l <= count; l++) {
    const cls = errorLines.has(l) ? "gl-err" : warnLines.has(l) ? "gl-warn" : "";
    html += cls ? '<span class="' + cls + '">' + l + "</span>\n" : l + "\n";
  }
  return html;
}

/** Ranges of `token` inside string literals, as a whole word. */
export function findInStrings(text: string, token: string): Range[] {
  const ranges: Range[] = [];
  const strings = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;
  const isWordChar = (ch: string | undefined) => !!ch && /[\w#']/.test(ch);
  let m: RegExpExecArray | null;
  while ((m = strings.exec(text))) {
    const inner = m[0].slice(1, -1);
    let at = inner.indexOf(token);
    while (at >= 0) {
      if (!isWordChar(inner[at - 1]) && !isWordChar(inner[at + token.length])) {
        const start = m.index + 1 + at;
        ranges.push({ start, end: start + token.length });
      }
      at = inner.indexOf(token, at + 1);
    }
  }
  return ranges;
}

// ---------------- Hover help texts ----------------

/** Mini-notation symbols, by character: [title, description]. */
export const MINI_HELP: Record<string, [string, string]> = {
  "~": ["~", "Rest: silence for one step"],
  "[": ["[ ]", "Subsequence: the steps inside share one step"],
  "]": ["[ ]", "Subsequence: the steps inside share one step"],
  "<": ["< >", "Alternation: one of the steps inside per cycle"],
  ">": ["< >", "Alternation: one of the steps inside per cycle"],
  "{": ["{ }", "Polymeter: every part keeps its own step length; %n sets the steps per cycle"],
  "}": ["{ }", "Polymeter: every part keeps its own step length; %n sets the steps per cycle"],
  ",": [",", "Play the parts on each side at the same time"],
  "|": ["|", "Random choice: one of the parts each cycle"],
  "*": ["*n", "Play the step n times in its slot"],
  "/": ["/n", "Stretch the step over n cycles"],
  "!": ["!n", "Repeat the step (n times in total)"],
  "@": ["@n", "Make the step n times longer than the others"],
  "?": ["?", "Remove the step at random: half of the time, or ?0.3 for 30%"],
  "(": ["(k,n,r)", "Euclidean rhythm: k hits spread over n steps, rotated by r"],
  ")": ["(k,n,r)", "Euclidean rhythm: k hits spread over n steps, rotated by r"],
  ":": [":n", "Sound variation, the same as .n(n)"],
  "_": ["_", "Make the previous step one step longer"],
  ".": [".", "Group: the steps on each side of the dot each share one step"],
  "%": ["%n", "Steps per cycle of a polymeter"],
};

export const ARP_HELP: Record<string, string> = {
  up: "Lowest note to highest", down: "Highest note to lowest",
  updown: "Up, then down, without repeating the ends", downup: "Down, then up, without repeating the ends",
  "up&down": "Up, then down, repeating the ends", "down&up": "Down, then up, repeating the ends",
  converge: "Outside notes first, moving inwards", diverge: "Inside notes first, moving outwards",
  disconverge: "Converge, then diverge", pinkyup: "Each note followed by the top note",
  thumbup: "The bottom note followed by each note",
};

export const KEYWORD_HELP: Record<string, string> = {
  const: 'Declares a constant, e.g. const melody = "c e g"',
  let: "Declares a variable",
  var: "Declares a variable",
  function: "Declares a function",
  return: "Returns a value from a function",
  new: "Creates an object",
};

const NOTE_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
const NOTE_BASE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** MIDI number of a note name such as c, c4, eb3, f#5 (default octave 4), or undefined. */
export function noteToMidi(word: string): number | undefined {
  const m = /^([a-g])((?:#|s|b|f)*)(-?\d+)?$/i.exec(word);
  if (!m) return undefined;
  let midi = NOTE_BASE[m[1].toLowerCase()];
  for (const acc of m[2].toLowerCase()) midi += acc === "#" || acc === "s" ? 1 : -1;
  return midi + ((m[3] !== undefined ? parseInt(m[3], 10) : 4) + 1) * 12;
}

export const midiName = (midi: number): string =>
  NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12] + (Math.floor(Math.round(midi) / 12) - 1);

export const midiFreq = (midi: number): string => (440 * Math.pow(2, (midi - 69) / 12)).toFixed(1) + " Hz";
