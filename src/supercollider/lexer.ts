/**
 * The tokens of SuperCollider's language (sclang): numbers (with radix,
 * exponent and the pi suffix), strings, symbols (\name and 'name'), characters,
 * identifiers, class names, environment variables (~name), keywords
 * (name: in argument lists and events), operators and punctuation.
 */

import { tick } from "./budget.ts";

export type TokenType =
  | "num" | "str" | "sym" | "char" | "id" | "class" | "env" | "label" | "op" | "punc" | "eof";

export interface Token {
  type: TokenType;
  value: string;
  /** For numbers: the value. */
  num?: number;
  pos: number;
  line: number;
}

export class SCSyntaxError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message + " (line " + line + ")");
    this.line = line;
  }
}

const OP_CHARS = "!@%&*-+=|<>?/";
const PUNC = "()[]{},;.:#`^";

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdChar = (c: string) => /[A-Za-z0-9_]/.test(c);

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const push = (type: TokenType, value: string, pos: number, num?: number) => {
    tick();
    out.push({ type, value, pos, line, num });
  };

  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    // Comments: // to the end of the line, /* nested */.
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "\n") line++;
        if (src[i] === "/" && src[i + 1] === "*") { depth++; i += 2; continue; }
        if (src[i] === "*" && src[i + 1] === "/") { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }
    const start = i;
    // Numbers: 12, 1.5, 1e-3, 16rFF, 0.5pi, 2pi, 1/4 is a division.
    if (isDigit(c)) {
      let j = i;
      while (j < n && isDigit(src[j])) j++;
      if (src[j] === "r" && /[0-9A-Za-z]/.test(src[j + 1] ?? "")) {
        const radix = parseInt(src.slice(i, j), 10);
        let k = j + 1;
        while (k < n && /[0-9A-Za-z.]/.test(src[k])) k++;
        const digits = src.slice(j + 1, k);
        const [whole, frac = ""] = digits.split(".");
        let value = parseInt(whole, radix);
        for (let d = 0; d < frac.length; d++) value += parseInt(frac[d], radix) / Math.pow(radix, d + 1);
        push("num", src.slice(i, k), start, value);
        i = k;
        continue;
      }
      if (src[j] === "." && isDigit(src[j + 1] ?? "")) {
        j++;
        while (j < n && isDigit(src[j])) j++;
      }
      if ((src[j] === "e" || src[j] === "E") && (isDigit(src[j + 1] ?? "") || ((src[j + 1] === "-" || src[j + 1] === "+") && isDigit(src[j + 2] ?? "")))) {
        j += 2;
        while (j < n && isDigit(src[j])) j++;
      }
      let value = parseFloat(src.slice(i, j));
      if (src.slice(j, j + 2) === "pi" && !isIdChar(src[j + 2] ?? "")) {
        value *= Math.PI;
        j += 2;
      }
      push("num", src.slice(i, j), start, value);
      i = j;
      continue;
    }
    // Strings, with escapes. Adjacent strings join.
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < n) { s += src[j + 1]; j += 2; continue; }
        if (src[j] === "\n") line++;
        s += src[j++];
      }
      push("str", s, start);
      i = j + 1;
      continue;
    }
    // Symbols: 'quoted' and \name (a lone \ is the empty symbol: a rest).
    if (c === "'") {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== "'") {
        if (src[j] === "\\" && j + 1 < n) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      push("sym", s, start);
      i = j + 1;
      continue;
    }
    if (c === "\\") {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      push("sym", src.slice(i + 1, j), start);
      i = j;
      continue;
    }
    if (c === "$") {
      const ch = src[i + 1] === "\\" ? src[i + 2] : src[i + 1];
      push("char", ch ?? "", start);
      i += src[i + 1] === "\\" ? 3 : 2;
      continue;
    }
    if (c === "~" && isIdStart(src[i + 1] ?? "")) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      push("env", src.slice(i + 1, j), start);
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i;
      while (j < n && isIdChar(src[j])) j++;
      const word = src.slice(i, j);
      // name: is a keyword (label), but not name:: or a ternary-like a ? b : c.
      if (src[j] === ":" && src[j + 1] !== ":") {
        push("label", word, start);
        i = j + 1;
        continue;
      }
      push(/[A-Z]/.test(word[0]) ? "class" : "id", word, start);
      i = j;
      continue;
    }
    // .. and ... (ranges and ellipsis) before the single dot.
    if (c === "." && src[i + 1] === ".") {
      const dots = src[i + 2] === "." ? "..." : "..";
      push("punc", dots, start);
      i += dots.length;
      continue;
    }
    if (OP_CHARS.includes(c)) {
      let j = i;
      while (j < n && OP_CHARS.includes(src[j])) {
        // Do not swallow the start of a comment.
        if (src[j] === "/" && (src[j + 1] === "/" || src[j + 1] === "*") && j > i) break;
        j++;
      }
      push("op", src.slice(i, j), start);
      i = j;
      continue;
    }
    if (PUNC.includes(c)) {
      push("punc", c, start);
      i++;
      continue;
    }
    throw new SCSyntaxError("Unexpected character " + JSON.stringify(c), line);
  }
  out.push({ type: "eof", value: "", pos: n, line });
  return out;
}
