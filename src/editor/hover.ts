/**
 * Hover help: what the editor says about the code under the mouse. Resting
 * the mouse on the code explains what is under it: functions and methods,
 * sounds, notes, chords, scales, mini-notation symbols, and the parameter a
 * value is passed as. No DOM here: text and offset in, help out.
 */
import { DOCS, GLOBAL_DOCS, MINI_DOCS, SCALE_DOCS, SOUND_DOCS, type Doc } from "../data/docs.ts";
import { GLOBAL_SIGNATURES, METHOD_SIGNATURES, paramsOf, signatureLabel } from "../data/signatures.ts";
import { TidalJS } from "../engine.ts";
import {
  ARP_HELP, DESCRIPTIONS, GLOBALS, KEYWORD_HELP, MINI_HELP, SOUND_DESCRIPTIONS, STRING_CONTEXT,
  describeBank, midiFreq, midiName, noteToMidi, sampleBanks,
} from "./language.ts";

export interface HoverHelp {
  key: string;
  start: number;
  title: string;
  lines: [string, string][];
  summary: string;
  /** Extended help. */
  doc?: Doc;
}

/** A call around a position: its name, whether it is a method, the argument index and its "(". */
interface Call {
  name: string;
  method: boolean;
  arg: number;
  open: number;
}

/** The innermost function call around offset `pos`, or null. */
function callAt(text: string, pos: number): Call | null {
  type Frame = { type: "(" | "[" | "{"; name: string | null; method: boolean; arg: number; open: number };
  const stack: Frame[] = [];
  let i = Math.max(0, pos - 6000);
  while (i < pos) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      if (nl < 0 || nl >= pos) return null; // in a comment
      i = nl;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0 || close + 2 > pos) return null;
      i = close + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < pos && text[j] !== ch && !(ch !== "`" && text[j] === "\n")) {
        if (text[j] === "\\") j++;
        j++;
      }
      i = j + 1; // an unclosed string runs to the position: still inside the call
      continue;
    }
    if (ch === "(") {
      const head = text.slice(Math.max(0, i - 80), i);
      const m = /([A-Za-z_$][\w$]*)\s*$/.exec(head);
      const method = m ? /\.\s*$/.test(head.slice(0, head.length - m[0].length)) : false;
      stack.push({ type: "(", name: m ? m[1] : null, method, arg: 0, open: i });
    } else if (ch === "[" || ch === "{") {
      stack.push({ type: ch, name: null, method: false, arg: 0, open: i });
    } else if (ch === ")" || ch === "]" || ch === "}") {
      stack.pop();
    } else if (ch === "," && stack.length && stack[stack.length - 1].type === "(") {
      stack[stack.length - 1].arg++;
    }
    i++;
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    const frame = stack[k];
    if (frame.type === "(") return frame.name ? { name: frame.name, method: frame.method, arg: frame.arg, open: frame.open } : null;
  }
  return null;
}

const signatureOf = (call: Call) => (call.method ? METHOD_SIGNATURES[call.name] : GLOBAL_SIGNATURES[call.name]);

/** The run of characters matching `allowed` around `offset`. */
function wordAround(text: string, offset: number, allowed: RegExp) {
  let start = offset;
  let end = offset;
  while (start > 0 && allowed.test(text[start - 1])) start--;
  while (end < text.length && allowed.test(text[end])) end++;
  return { start, end, word: text.slice(start, end) };
}

/** The parameter that offset `pos` is passed as, if it is inside a known call. */
function parameterAt(text: string, pos: number): { name: string; desc: string; of: string } | null {
  const call = callAt(text, pos);
  const signature = call ? signatureOf(call) : undefined;
  if (!call || !signature) return null;
  const params = paramsOf(signature);
  if (!params.length) return null;
  const param = params[Math.min(call.arg, params.length - 1)];
  return { name: param.name.replace("?", ""), desc: param.desc, of: (call.method ? "." : "") + call.name + "()" };
}

// Tidal's ratio letters, as the mini-notation reads them: 3q is three quarters.
const RATIO_LETTERS: Record<string, number> = { w: 1, h: 1 / 2, q: 1 / 4, e: 1 / 8, s: 1 / 16, t: 1 / 3, f: 1 / 5, x: 1 / 6 };
const NUMBER = /^-?\d+(\.\d+)?$/;
const RATIO_WORD = /^(-?\d+(?:\.\d+)?)([whqestfx])$/;
const FRACTION = /^(\d+(?:\.\d+)?)%(\d+(?:\.\d+)?)$/;

/** The value of "3q" or "1%3", or undefined for anything else (a bare letter is not counted: it may be a note or a sound). */
function ratioOf(word: string): number | undefined {
  let m = RATIO_WORD.exec(word);
  if (m) return parseFloat(m[1]) * RATIO_LETTERS[m[2]];
  m = FRACTION.exec(word);
  if (m && parseFloat(m[2]) !== 0) return parseFloat(m[1]) / parseFloat(m[2]);
  return undefined;
}

const ratioLine = (word: string, value: number): [string, string] => ["value", word + " = " + +value.toFixed(4)];

/** Whether `start` (after the opening quote at `quoteAt`) is inside a group right after a modifier, as in "bd*<4 3q>". */
function inModifierGroup(line: string, quoteAt: number, start: number): boolean {
  let depth = 0;
  for (let i = start - 1; i > quoteAt; i--) {
    const c = line[i];
    if (c === ">" || c === "]" || c === "}") depth++;
    else if (c === "<" || c === "[" || c === "{") {
      if (depth === 0) return "*/!@?%:".includes(line[i - 1] ?? " ");
      depth--;
    }
  }
  return false;
}

/** Describes what is at `offset` in `text`, or null when there is nothing to say. */
export function describeAt(text: string, offset: number): HoverHelp | null {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const col = offset - lineStart;
  const ch = line[col];
  if (!ch || /\s/.test(ch)) return null;

  // Is the character inside a string, or in a comment?
  let quote: string | null = null;
  let quoteAt = -1;
  for (let i = 0; i < col; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === "/" && line[i + 1] === "/") {
      return null;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
      quoteAt = i;
    }
  }
  if (!quote && ch === "/" && line[col + 1] === "/") return null;
  if (quote ? ch === quote : ch === '"' || ch === "'" || ch === "`") return null;

  return quote ? describeInString(text, line, lineStart, quoteAt, col) : describeCode(text, offset);
}

function describeInString(text: string, line: string, lineStart: number, quoteAt: number, col: number): HoverHelp | null {
  const call = /([A-Za-z_$][\w$]*)\s*\(\s*$/.exec(line.slice(0, quoteAt));
  const context = call ? STRING_CONTEXT[call[1]] : undefined;
  const ch = line[col];
  const offset = lineStart + col;
  const alone = /[\s"'`]/.test(line[col - 1] || " ") && /[\s"'`]/.test(line[col + 1] || " ");

  // A fraction: "1%3" (the % of a polymeter follows a closing brace instead).
  const fraction = wordAround(line, col, /[\d.%]/);
  const fractionValue = FRACTION.test(fraction.word) ? ratioOf(fraction.word) : undefined;
  if (fractionValue !== undefined) {
    const at = lineStart + fraction.start;
    return {
      key: "word:" + at + ":" + fraction.word, start: at, title: fraction.word, lines: [ratioLine(fraction.word, fractionValue)],
      summary: "A fraction: the first number divided by the second", doc: MINI_DOCS["1%3"],
    };
  }

  // Mini-notation symbols. A "." or "_" is a symbol only on its own.
  const isSymbol = MINI_HELP[ch] && !((ch === "." || ch === "_") && !alone)
    && !(ch === ":" && context === "scale") && !(ch === "'" && context === "chord");
  if (isSymbol) {
    const [title, desc] = MINI_HELP[ch];
    return { key: "sym:" + offset, start: offset, title, lines: [], summary: desc, doc: MINI_DOCS[title] };
  }

  const allowed = context === "scale" ? /[\w#.\-:]/ : context === "chord" ? /[\w#.\-']/ : /[\w#.-]/;
  const { start, word } = wordAround(line, col, allowed);

  // ^name reads a bus set with setBus(name): on the ^ or on the name after it.
  const busAt = ch === "^" ? col : word && line[start - 1] === "^" ? start - 1 : -1;
  if (busAt >= 0) {
    const name = wordAround(line, busAt + 1, allowed).word;
    if (name) {
      const at = lineStart + busAt;
      return {
        key: "bus:" + at + ":" + name, start: at, title: "^" + name, lines: [],
        summary: 'Reads the bus "' + name + '", set with setBus("' + name + '", value)', doc: MINI_DOCS["^name"],
      };
    }
  }

  if (!word) return null;
  const at = lineStart + start;
  const help = (lines: [string, string][], summary: string, doc?: Doc): HoverHelp => ({
    key: "word:" + at + ":" + word, start: at, title: word, lines, summary, doc,
  });

  // A range: "0 .. 7".
  if (word === "..") return help([], "Range", MINI_DOCS[".."]);
  // Tidal's other rest: "bd - sn -".
  if (word === "-") return help([], "Rest: silence for one step, the same as ~", MINI_DOCS["-"]);

  // A number right after a modifier: "*2", "?0.3", "@3", "*3q".
  const before = line[start - 1];
  const ratio = RATIO_WORD.test(word) ? ratioOf(word) : undefined;
  if ((NUMBER.test(word) || ratio !== undefined) && before && "*/!@?%:".includes(before) && MINI_HELP[before]) {
    const [title, desc] = MINI_HELP[before];
    return { ...help(ratio !== undefined ? [ratioLine(word, ratio)] : [], desc.replace(/\bn\b/, word), MINI_DOCS[title]), title: before + word };
  }
  // A number written with a ratio letter inside a modifier's group: the 3q of "bd*<4 3q>".
  // Anywhere else the mini-notation reads "3q" as a word (a sound name, say).
  if (ratio !== undefined && inModifierGroup(line, quoteAt, start)) {
    return help([ratioLine(word, ratio)], "A number written with a ratio letter", MINI_DOCS["1%3"]);
  }

  switch (context) {
    case "sound": {
      const files = sampleBanks.get(word);
      if (files !== undefined) {
        return help([], describeBank(files), {
          about: "A bank of " + files + " recorded sample" + (files === 1 ? "" : "s") + ' loaded with samples(). n picks the file, counting from 0: "' + word + ':1" or .n(1). Numbers past the end wrap around.',
          example: 'sound("' + word + '*4").n("0 .. 3")',
          tip: SOUND_DOCS[word] ? "It replaces the built-in synth of the same name." : undefined,
          see: ["n", "speed", "begin", "chop"],
        });
      }
      if (TidalJS.soundNames.includes(word)) return help([], SOUND_DESCRIPTIONS[word] || "Sound", SOUND_DOCS[word]);
      return help([], "Unknown sound (or a sample bank not loaded yet)", {
        about: "There is no synth with this name, and no loaded sample bank has it. Built-in sounds: " + TidalJS.soundNames.join(", ") + ". Load more with samples(), e.g. the Dirt-Samples library.",
        example: 'samples("github:tidalcycles/dirt-samples")',
      });
    }
    case "chord": {
      if (word.includes("'")) {
        const notes = TidalJS.parseChord(word);
        if (!notes) return help([], "Unknown chord");
        return help([["notes", notes.map((n) => midiName(60 + n)).join(" ")]], "", {
          about: "A chord: root'name, then optional modifiers. 'i inverts it (raises the lowest note an octave; 'ii twice), 'o opens the voicing (spreads it over two octaves) and a number sets how many notes to play, continuing the chord upwards.",
          example: "sound(\"saw\").note(\"<c'maj e'min7'i a3'min'5>\").legato(1)",
          tip: "Common names: maj, min, dom7, maj7, min7, dim, aug, sus2, sus4, add9. chordList() lists them all.",
          see: ["chord", "arp", "inversion"],
        });
      }
      const isNumber = NUMBER.test(word);
      const midi = isNumber ? 60 + parseFloat(word) : noteToMidi(word);
      if (midi === undefined) return help([], "Unknown note");
      const detail = (isNumber ? midiName(midi) + ", " : "") + "MIDI " + +midi.toFixed(2) + ", " + midiFreq(midi);
      return help([["note", detail]], "", {
        about: isNumber
          ? "A number in a note pattern is the number of semitones from middle C (c4): 0 is c4, 12 is c5, -12 is c3, 7 is the g above middle C."
          : "A note name: a letter from a to g, # or s for sharp, b or f for flat, and an octave number (4 when left out). c4 is middle C, a4 is 440 Hz.",
        see: ["note", "up", "scale"],
      });
    }
    case "scale": {
      const [root, name] = word.includes(":") ? word.split(":") : ["c", word];
      const known = TidalJS.scaleNames.includes(String(name).toLowerCase());
      if (!known) return help([], "Unknown scale", { about: "Known scales: " + TidalJS.scaleNames.join(", ") + "." });
      return help([], "", {
        about: (SCALE_DOCS[String(name).toLowerCase()] ?? "Scale " + name + ".") + " Here it starts on " + root.toUpperCase()
          + (word.includes(":") ? "." : '; write root:name to start on another note, e.g. "e:' + name + '".'),
        example: 'sound("arpy*8").note(scale("' + root + ":" + name + '", "0 .. 7"))',
        see: ["scale", "scaleList"],
      });
    }
    case "arp":
      if (!ARP_HELP[word]) return help([], "Unknown arpeggio mode", { about: "Modes: " + TidalJS.arpModes.join(", ") + "." });
      return help([], "", {
        about: "Arpeggio mode: " + ARP_HELP[word].toLowerCase() + ". The notes of each chord play one after another within the chord's step.",
        example: "sound(\"arpy\").note(\"<c'maj'5 a3'min7'5>\").arp(\"" + word + "\")",
        see: ["arp", "chord"],
      });
    case "vowel":
      if (!TidalJS.vowels.includes(word)) return help([], "Unknown vowel", { about: "Vowels: a, e, i, o and u." });
      return help([], "", { ...DOCS.vowel, about: 'The vowel "' + word + '". ' + DOCS.vowel.about });
    default: {
      const param = parameterAt(text, offset);
      return param ? help([[param.name, param.desc + " (" + param.of + ")"]], "") : null;
    }
  }
}

function describeCode(text: string, offset: number): HoverHelp | null {
  const ident = wordAround(text, offset, /[\w$]/);
  const word = ident.word;
  if (!word) return null;

  // Numbers: the parameter they are passed as.
  if (/^\d/.test(word) || (text[offset] === "." && /\d/.test(text[offset + 1] || ""))) {
    const number = wordAround(text, offset, /[\d.]/);
    const param = parameterAt(text, offset);
    if (!param) return null;
    return { key: "num:" + number.start, start: number.start, title: number.word, lines: [[param.name, param.desc + " (" + param.of + ")"]], summary: "" };
  }

  const key = "id:" + ident.start + ":" + word;
  let before = ident.start - 1;
  while (before >= 0 && /[ \t]/.test(text[before])) before--;

  if (text[before] === ".") {
    const signature = METHOD_SIGNATURES[word];
    if (signature) {
      return {
        key, start: ident.start, title: "." + signatureLabel(word, signature),
        lines: paramsOf(signature).map((p): [string, string] => [p.name, p.desc]), summary: signature[0], doc: DOCS[word],
      };
    }
    return DESCRIPTIONS[word] || DOCS[word]
      ? { key, start: ident.start, title: "." + word + "()", lines: [], summary: DESCRIPTIONS[word] ?? "", doc: DOCS[word] }
      : null;
  }
  if (KEYWORD_HELP[word]) return { key, start: ident.start, title: word, lines: [], summary: KEYWORD_HELP[word], doc: DOCS[word] };
  const signature = GLOBAL_SIGNATURES[word];
  if (signature) {
    return {
      key, start: ident.start, title: signatureLabel(word, signature),
      lines: paramsOf(signature).map((p): [string, string] => [p.name, p.desc]), summary: signature[0],
      doc: GLOBAL_DOCS[word] ?? DOCS[word],
    };
  }
  const global = GLOBALS.find((g) => g.name === word);
  return global && (global.desc || global.doc) ? { key, start: ident.start, title: word, lines: [], summary: global.desc, doc: global.doc } : null;
}
