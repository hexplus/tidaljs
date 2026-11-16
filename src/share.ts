/**
 * Sharing a song as a link: the title, tempo and code are packed into the
 * URL fragment (`#song=...`), which browsers never send to a server.
 *
 * A link is untrusted input. Decoding is strict: size caps on the link and
 * on the decompressed data (a small link cannot inflate into a huge one),
 * then every field is checked. The code itself is JavaScript that runs in
 * the page when Play is pressed, so `scanCode()` flags what a music pattern
 * never needs (network, storage, the page, hidden names) before it first
 * plays. The scan is a check, not a guarantee.
 *
 * No DOM here: it runs in Node for the tests (test/share.test.mjs).
 *
 * Link format, version 1:
 *   #song=1.d.<base64url of deflate-raw(JSON)>   compressed
 *   #song=1.p.<base64url of JSON>                plain (browsers without CompressionStream)
 * where JSON is {"t": title, "c": code, "cps": tempo}, nothing else.
 */

export interface SharedSong {
  title: string;
  code: string;
  /** Tempo in cycles per second. */
  cps: number;
}

export const SHARE_KEY = "song";
export const SHARE_VERSION = 1;
/** Longest title kept (in characters), after cleaning. */
export const MAX_TITLE_LENGTH = 80;
/** Longest title accepted in a link, before cleaning. */
export const MAX_RAW_TITLE_LENGTH = 200;
/** Longest code that can be shared (UTF-16 code units, as String.length counts). */
export const MAX_CODE_LENGTH = 30_000;
/** Largest decoded JSON accepted: reading stops as soon as the data passes it. */
export const MAX_DECODED_BYTES = 128 * 1024;
/** Longest data part of a link (characters). Browsers handle far more, but links this long are rarely useful. */
export const MAX_ENCODED_LENGTH = 60_000;
/** Links longer than this get a warning: some chat apps and sites cut them. */
export const LONG_LINK_LENGTH = 8_000;
/** The tempo range of the editor (session.ts), repeated here to keep this module standalone. */
export const SHARE_TEMPO_MIN = 0.05;
export const SHARE_TEMPO_MAX = 10;

/** An error with a message meant for the person opening or making the link. */
export class ShareError extends Error {
  readonly reason: ShareErrorReason;
  constructor(reason: ShareErrorReason, message = SHARE_MESSAGES[reason]) {
    super(message);
    this.name = "ShareError";
    this.reason = reason;
  }
}

export type ShareErrorReason =
  | "damaged" | "newer" | "tooLong" | "tooBig" | "noCode" | "codeTooLong" | "badTempo" | "unsupported";

const SHARE_MESSAGES: Record<ShareErrorReason, string> = {
  damaged: "This link is damaged or incomplete. Ask whoever sent it for a new one.",
  newer: "This link was made by a newer version of TidalJS. Reload the page to get the latest version, then open the link again.",
  tooLong: "This link is too long to be a TidalJS song.",
  tooBig: "The song in this link is too big to open.",
  noCode: "This link has no code in it.",
  codeTooLong: "The code is longer than a link can hold (" + MAX_CODE_LENGTH.toLocaleString("en") + " characters).",
  badTempo: "The tempo in this link is not valid.",
  unsupported: "This browser cannot open compressed song links. Try it in an up-to-date browser.",
};

// ---------------- Text cleaning ----------------

/** Line breaks and tabs: become spaces in a title. */
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
/**
 * Characters that are invisible or reorder text: C0 and C1 controls, the
 * soft hyphen, bidirectional marks, embeddings, overrides and isolates
 * (U+061C, U+200E/F, U+202A-E, U+2066-9), zero-width characters, word
 * joiners and invisible operators, the BOM, Hangul fillers, interlinear
 * annotations, and tag characters (U+E0000-E007F).
 */
const INVISIBLE =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]|\uDB40[\uDC00-\uDC7F]/g;
/** Bidirectional controls, the ones that can make text read in another order than it is stored. */
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** More than four combining marks in a row ("zalgo" text) are cut to four. */
const MARK_FLOOD = /(\p{M}{4})\p{M}+/gu;

/**
 * A title safe to show as text: no control, invisible or bidirectional
 * override characters, no line breaks, one space between words, at most
 * MAX_TITLE_LENGTH characters. It is still only ever rendered as text.
 */
export function cleanTitle(title: string): string {
  const text = title
    .replace(BREAKS, " ")
    .replace(INVISIBLE, "")
    .replace(LONE_SURROGATE, "")
    .normalize("NFC")
    .replace(MARK_FLOOD, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(text).slice(0, MAX_TITLE_LENGTH).join("").trim();
}

/** Code with Windows and old Mac line ends turned into \n. Nothing else is changed: the scan reports hidden characters. */
export function normaliseCode(code: string): string {
  return code.replace(/\r\n?/g, "\n");
}

// ---------------- Base64url ----------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array {
  // Only the base64url alphabet, without padding; a length of 4n+1 is never valid.
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new ShareError("damaged");
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new ShareError("damaged");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------- Compression ----------------

/** True when this browser (or Node) can compress links with deflate-raw. */
export function canCompress(): boolean {
  try {
    return typeof CompressionStream === "function" && !!new CompressionStream("deflate-raw");
  } catch {
    return false;
  }
}

function canDecompress(): boolean {
  try {
    return typeof DecompressionStream === "function" && !!new DecompressionStream("deflate-raw");
  } catch {
    return false;
  }
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Inflates deflate-raw data, but never more than `cap` bytes: a few
 * kilobytes of deflate can expand a thousand times (a "decompression bomb").
 * The input goes in small slices and each slice waits for the output to be
 * read, so the reader stops it soon after the cap, not after the whole
 * expansion.
 *
 * Data after the end of the deflate stream makes the link damaged. Runtimes
 * disagree about it (Chrome and Node 24 reject it, Node 22 ignores it), so it
 * is checked here: a deflate stream ends in its last byte, so without that
 * byte it must fail to inflate. If it still inflates, the last byte was
 * extra.
 */
export async function inflateCapped(bytes: Uint8Array, cap: number): Promise<Uint8Array> {
  if (!canDecompress()) throw new ShareError("unsupported");
  const out = await inflateOnce(bytes, cap);
  if (bytes.length > 1) {
    const shorter = await inflateOnce(bytes.subarray(0, bytes.length - 1), cap).then(() => true, () => false);
    if (shorter) throw new ShareError("damaged");
  }
  return out;
}

async function inflateOnce(bytes: Uint8Array, cap: number): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const SLICE = 1024;
  let stopped = false;

  const pump = (async () => {
    try {
      for (let i = 0; i < bytes.length && !stopped; i += SLICE) {
        await writer.ready;
        if (stopped) return;
        await writer.write(bytes.slice(i, i + SLICE));
      }
      if (!stopped) await writer.close();
    } catch {
      /* The reader sees the same error, or stopped on purpose. */
    }
  })();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        stopped = true;
        throw new ShareError("tooBig");
      }
      chunks.push(value);
    }
  } catch (err) {
    stopped = true;
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    throw err instanceof ShareError ? err : new ShareError("damaged");
  }
  await pump;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// ---------------- Validation ----------------

const KEYS = ["t", "c", "cps"] as const;

/** Checks the decoded JSON value and returns a clean song, or throws a ShareError. */
export function validateSong(data: unknown): SharedSong {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype) {
    throw new ShareError("damaged");
  }
  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);
  // Exactly the known fields: anything else is a forged or future link.
  if (keys.length !== KEYS.length || !KEYS.every((k) => Object.prototype.hasOwnProperty.call(record, k))) {
    throw new ShareError("damaged");
  }
  const { t, c, cps } = record;
  if (typeof t !== "string" || t.length > MAX_RAW_TITLE_LENGTH) throw new ShareError("damaged");
  if (typeof c !== "string") throw new ShareError("damaged");
  if (c.length > MAX_CODE_LENGTH) throw new ShareError("codeTooLong");
  const code = normaliseCode(c);
  if (!code.trim()) throw new ShareError("noCode");
  if (typeof cps !== "number" || !Number.isFinite(cps) || cps < SHARE_TEMPO_MIN || cps > SHARE_TEMPO_MAX) {
    throw new ShareError("badTempo");
  }
  return { title: cleanTitle(t) || "Shared song", code, cps: Math.round(cps * 1000) / 1000 };
}

// ---------------- Encoding and decoding ----------------

/** The fragment of a link that carries a song: "#song=1." */
const PREFIX = "#" + SHARE_KEY + "=";

/** True when a URL fragment (location.hash) carries a shared song, valid or not. */
export function isShareHash(hash: string): boolean {
  return hash.startsWith(PREFIX);
}

/**
 * The fragment for a song, with the "#": "#song=1.d.…". Throws a ShareError
 * when the song cannot be shared (no code, code or link too long, bad tempo).
 * Every link this makes decodes with decodeShareHash().
 */
export async function encodeShareHash(song: SharedSong, options: { compress?: boolean } = {}): Promise<string> {
  const code = normaliseCode(song.code);
  if (!code.trim()) throw new ShareError("noCode", "There is no code to share.");
  if (code.length > MAX_CODE_LENGTH) throw new ShareError("codeTooLong");
  if (!Number.isFinite(song.cps) || song.cps < SHARE_TEMPO_MIN || song.cps > SHARE_TEMPO_MAX) throw new ShareError("badTempo");
  const payload = { t: cleanTitle(song.title), c: code, cps: Math.round(song.cps * 1000) / 1000 };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  if (json.byteLength > MAX_DECODED_BYTES) throw new ShareError("codeTooLong", "This song is too long to share as a link.");
  const compress = options.compress ?? canCompress();
  const data = bytesToBase64Url(compress ? await deflate(json) : json);
  if (data.length > MAX_ENCODED_LENGTH) throw new ShareError("tooLong", "This song is too long to share as a link.");
  return PREFIX + SHARE_VERSION + "." + (compress ? "d" : "p") + "." + data;
}

/**
 * Reads a song from a URL fragment. Returns null when the fragment is not a
 * song link at all; throws a ShareError (with a message for the person) when
 * it is one but cannot be read.
 */
export async function decodeShareHash(hash: string): Promise<SharedSong | null> {
  if (!isShareHash(hash)) return null;
  // The cap comes before any parsing.
  if (hash.length > PREFIX.length + 16 + MAX_ENCODED_LENGTH) throw new ShareError("tooLong");
  const match = /^(\d{1,4})\.([a-z])\.([A-Za-z0-9_-]+)$/.exec(hash.slice(PREFIX.length));
  if (!match) throw new ShareError("damaged");
  const [, versionText, method, data] = match;
  const version = Number(versionText);
  if (version > SHARE_VERSION) throw new ShareError("newer");
  if (version !== SHARE_VERSION || versionText !== String(SHARE_VERSION)) throw new ShareError("damaged");
  if (data.length > MAX_ENCODED_LENGTH) throw new ShareError("tooLong");

  const raw = base64UrlToBytes(data);
  let bytes: Uint8Array;
  if (method === "d") bytes = await inflateCapped(raw, MAX_DECODED_BYTES);
  else if (method === "p") {
    if (raw.byteLength > MAX_DECODED_BYTES) throw new ShareError("tooBig");
    bytes = raw;
  } else throw new ShareError("damaged");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ShareError("damaged");
  }
  let data2: unknown;
  try {
    data2 = JSON.parse(text);
  } catch {
    throw new ShareError("damaged");
  }
  return validateSong(data2);
}

/** A full link: the page address without its fragment, plus the song's fragment. */
export function shareUrl(pageUrl: string, hash: string): string {
  const hashAt = pageUrl.indexOf("#");
  return (hashAt === -1 ? pageUrl : pageUrl.slice(0, hashAt)) + hash;
}

// ---------------- The code scan ----------------

export interface Finding {
  /** A short name for what was found: "Network access". */
  title: string;
  /** Why it matters, in plain words. */
  why: string;
  /** The words found ("fetch", "localStorage"...), at most a few. */
  words: string[];
  /** The lines (1-based) where it was found, at most a few. */
  lines: number[];
}

export interface CodeScan {
  /** Things a music pattern does not need. Any of them asks for an extra confirmation before the first Play. */
  risks: Finding[];
  /** Sites the code names (it may load files from them or send to them): "raw.githubusercontent.com". */
  sites: string[];
}

interface Rule {
  title: string;
  why: string;
  pattern: RegExp;
  /** Extra check on a match, to skip harmless uses. */
  accept?: (match: RegExpExecArray, text: string) => boolean;
  /** "raw" (default): the whole text, strings and comments included. "code": strings and comments blanked out. */
  on?: "raw" | "code";
}

const PIECES = {
  title: "Builds names from pieces",
  why: "text glued together or decoded while the code runs can hide the names of other features from this check",
};

/** Keywords after which `[` starts an array literal, not a property lookup. */
const KEYWORDS = new Set([
  "return", "case", "in", "of", "typeof", "void", "yield", "await", "else", "do", "new", "delete", "throw", "instanceof",
  "const", "let", "var",
]);

/** Where the bracket at `open` closes, counting nested brackets (strings are already blanked); -1 if it does not. */
function matchingBracket(text: string, open: number): number {
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    if (text[k] === "[") depth++;
    else if (text[k] === "]" && --depth === 0) return k;
  }
  return -1;
}

/**
 * Names whose pieces, as short strings, suggest a name being put together
 * ("fe" + "tch", ["constr", "uctor"].join("")). A string that is the whole
 * name is already found by the word rules, which read strings too.
 */
const SENSITIVE_NAMES = [
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "eval", "Function", "constructor", "prototype",
  "__proto__", "globalThis", "window", "document", "localStorage", "sessionStorage", "indexedDB", "cookie", "location",
  "navigator", "postMessage", "import", "setTimeout", "setInterval", "alert", "prompt", "Reflect", "atob",
  "fromCharCode", "innerHTML", "createElement", "Worker", "opener", "history",
];

// Words that are common in comments ("a window of", "on top of the beat", "the location of the snare")
// count only when used as code: not followed by another word on the same line, or used as an object.

const RULES: Rule[] = [
  {
    title: "Network access",
    why: "can send data to other sites or load content from them",
    pattern: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|WebTransport|RTCPeerConnection|webkitRTCPeerConnection|RTCDataChannel)\b/g,
  },
  {
    title: "Runs extra code",
    why: "can run code that is not visible here, or run it later",
    pattern: /\b(?:eval|importScripts|execScript|setTimeout|setInterval|setImmediate|requestIdleCallback|AsyncFunction|GeneratorFunction)\b|\bFunction\b(?![ \t]+[A-Za-z])|\bimport\s*[(.]/g,
  },
  {
    title: "Reaches inside JavaScript",
    why: "a common way to get around checks like this one and reach any feature of the page",
    pattern: /\b(?:constructor|prototype|__proto__|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__|getPrototypeOf|setPrototypeOf|defineProperty|defineProperties|getOwnPropertyDescriptors?|Reflect|Proxy|globalThis)\b/g,
  },
  {
    title: "The page itself",
    why: "can read or change the page, or reach every feature of the browser",
    pattern: /\b(?:document|window)\b(?![ \t]+[A-Za-z])|\b(?:frameElement|innerHTML|outerHTML|insertAdjacentHTML|createElement|appendChild|srcdoc)\b|\b(?:self|top|parent|frames|opener)\b(?=\s*(?:\?\.|\.|\[))|(?<=[=(,:]\s*)\b(?:self|top|parent|frames|opener)\b/g,
  },
  {
    title: "Your saved data",
    why: "can read or change what this site keeps in your browser, including your saved sketches",
    pattern: /\b(?:localStorage|sessionStorage|indexedDB|cookie|cookieStore|caches|CacheStorage|openDatabase)\b/g,
  },
  {
    title: "Leaves or changes the page",
    why: "can send you to another site, which could be a fake one",
    pattern: /\blocation\b(?![ \t]+[A-Za-z])|\bhistory\s*(?:\?\.|\.|\[)|\bopen\s*\(|\bnavigation\s*\./g,
  },
  {
    title: "Other browser features",
    why: "can use the clipboard, notifications, other tabs or devices",
    pattern: /\b(?:navigator|postMessage|Worker|SharedWorker|serviceWorker|BroadcastChannel|MessageChannel|Notification|clipboard|geolocation|mediaDevices|getUserMedia)\b/g,
  },
  {
    title: "Pop-up messages",
    why: "can show messages that ask for passwords or other details",
    pattern: /\b(?:alert|confirm|prompt)\s*\(/g,
  },
  {
    title: "Loads images or media",
    why: "can contact other sites without showing anything",
    pattern: /\bnew\s+(?:Image|Audio|Option)\b/g,
  },
  {
    title: "Escaped characters",
    why: "escapes such as \\u0066 can hide the names of other features from this check",
    // \u, \x, octal-like escapes, and a backslash before a line break (a line continuation inside a string).
    pattern: /\\(?:u|x|[1-7]|\r?\n|\r|\u2028|\u2029)/g,
  },
  {
    title: PIECES.title,
    why: PIECES.why,
    // fromCharCode(...), atob(...), String.raw`...`; (28).toString(36) is "s".
    pattern: /\b(?:fromCharCode|fromCodePoint|atob|btoa|decodeURI|decodeURIComponent|unescape|escape|raw)\s*[(`]|\.toString\s*\(\s*(?:1[1-9]|[23]\d)\s*\)/g,
  },
  // The rules below read the code with strings and comments blanked out (see lex()), so the brackets
  // and quotes of mini-notation ("[bd sn]") do not count.
  {
    title: PIECES.title,
    why: PIECES.why,
    // ["fe", "tch"].join(""), "fe".concat("tch"), `${"fe"}${"tch"}`.
    pattern: /\.join\s*(?:\(\s*(?:""|''|``)?\s*\)|`)|\.concat\s*\(\s*["'`]|\$\{\s*["'`]/g,
    on: "code",
  },
  {
    title: "Looks up names from text",
    why: "obj[\"name\"] reaches a feature by a name held in text, which can hide it from this check",
    // A lookup (x[...], f()[...], x?.[...], "abc"[...]; not an array literal after a keyword such as
    // return) whose key holds a string or glues values with +, or whose result is called or looked
    // into again: x["..."], x[a + b], x[k](...), x[k][j]. Plain lookups such as chords[c] are fine.
    pattern: /(?:(?<![\w$])([A-Za-z_$][\w$]*)|[)\]"'`])\s*(?:\?\.)?\s*\[/g,
    accept: (match, text) => {
      if (match[1] && KEYWORDS.has(match[1])) return false;
      if (/["'`]$/.test(match[0][0]) && !match[1]) return true; // "abc"[i]
      const open = match.index + match[0].length - 1;
      const close = matchingBracket(text, open);
      if (close === -1) return true;
      const key = text.slice(open + 1, close);
      if (/^\s*\d+\s*$/.test(key)) return false;
      return /["'`+]/.test(key) || /^\s*(?:\?\.)?\s*[[(`]/.test(text.slice(close + 1, close + 8));
    },
    on: "code",
  },
];

// ---------------- A small JavaScript lexer ----------------

interface Lexed {
  /** The code with the contents of strings, templates, regular expressions and comments replaced by spaces (quotes kept). */
  code: string;
  /** String literals (and templates without ${}): where they start and their text between the quotes. */
  strings: { start: number; end: number; text: string }[];
  /** Places the lexer could not read for sure: a slash after ")" or "}", an unfinished string or comment. */
  unclear: number[];
}

/** Keywords after which a slash starts a regular expression. */
const REGEX_AFTER = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const LINE_END = /[\n\r\u2028\u2029]/g;

/**
 * Splits code into code, strings and comments, well enough for the scan.
 * Where JavaScript itself could read the text two ways (a slash after ")"
 * may divide or start a regular expression), the place is reported as
 * unclear rather than guessed silently, because a wrong guess could make
 * code look like a string to the scan.
 */
export function lex(source: string): Lexed {
  const out = source.split("");
  const strings: Lexed["strings"] = [];
  const unclear: number[] = [];
  const n = source.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const lineEnd = (from: number) => {
    LINE_END.lastIndex = from;
    const m = LINE_END.exec(source);
    return m ? m.index : n;
  };
  /** What came before, for the slash: "value" (it divides), "operator" (a regular expression), "close" (unclear). */
  let before: "value" | "operator" | "close" = "operator";
  const templates: number[] = []; // the brace depth at which each open ${ ... } returns to its template
  let depth = 0;
  let i = 0;

  /** Reads template text from i (after ` or }) to the closing ` or the next ${. */
  const templateText = (from: number, opened: number) => {
    let k = from;
    while (k < n) {
      const c = source[k];
      if (c === "\\") k += 2;
      else if (c === "`") {
        blank(from, k);
        if (source[opened] === "`") strings.push({ start: opened, end: k + 1, text: source.slice(opened + 1, k) });
        before = "value";
        return k + 1;
      } else if (c === "$" && source[k + 1] === "{") {
        blank(from, k);
        templates.push(depth);
        depth++;
        before = "operator";
        return k + 2;
      } else k++;
    }
    unclear.push(opened);
    blank(from, n);
    return n;
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = lineEnd(i);
      blank(i, end);
      i = end;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) {
        unclear.push(i);
        blank(i, n);
        break;
      }
      blank(i, end + 2);
      i = end + 2;
    } else if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && source[k] !== c) {
        if (source[k] === "\\") k++;
        else if (/[\n\r\u2028\u2029]/.test(source[k])) break;
        k++;
      }
      if (k >= n || source[k] !== c) {
        // Quotes cannot hold a line break: either the code is broken or the lexer lost its way.
        unclear.push(i);
        blank(i + 1, k);
        i = k;
      } else {
        strings.push({ start: i, end: k + 1, text: source.slice(i + 1, k) });
        blank(i + 1, k);
        i = k + 1;
      }
      before = "value";
    } else if (c === "`") {
      i = templateText(i + 1, i);
    } else if (c === "}" && templates.length && templates[templates.length - 1] === depth - 1) {
      templates.pop();
      depth--;
      i = templateText(i + 1, i);
    } else if (c === "/") {
      if (before === "operator") {
        // A regular expression: up to the closing slash outside a [...] class.
        let k = i + 1;
        let inClass = false;
        while (k < n && !/[\n\r\u2028\u2029]/.test(source[k])) {
          const r = source[k];
          if (r === "\\") k++;
          else if (r === "[") inClass = true;
          else if (r === "]") inClass = false;
          else if (r === "/" && !inClass) break;
          k++;
        }
        if (k >= n || source[k] !== "/") {
          unclear.push(i);
          blank(i + 1, k);
          i = k;
        } else {
          blank(i + 1, k);
          i = k + 1;
          while (i < n && /[a-z]/i.test(source[i])) i++;
        }
        before = "value";
      } else {
        if (before === "close") unclear.push(i);
        before = "operator";
        i++;
      }
    } else if (/[A-Za-z_$\\\u0080-\uFFFF]/.test(c)) {
      let k = i + 1;
      while (k < n && /[\w$\\\u0080-\uFFFF]/.test(source[k])) k++;
      const name = source.slice(i, k);
      const property = /\.\s*$/.test(source.slice(Math.max(0, i - 8), i));
      before = REGEX_AFTER.has(name) && !property ? "operator" : "value";
      i = k;
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(next ?? ""))) {
      let k = i + 1;
      while (k < n && /[\w.]/.test(source[k])) k++;
      before = "value";
      i = k;
    } else if (/\s/.test(c)) {
      i++;
    } else {
      if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
      if ((c === "+" || c === "-") && next === c) {
        // a++ / b divides, but ++/re/ ... does not: unclear either way.
        before = "close";
        i += 2;
        continue;
      }
      before = c === ")" || c === "}" ? "close" : c === "]" ? "value" : "operator";
      i++;
    }
  }
  return { code: out.join(""), strings, unclear };
}

/** Invisible and bidirectional characters in code (tabs and line breaks are fine). */
const HIDDEN_IN_CODE =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]|\uDB40[\uDC00-\uDC7F]/g;

const LONG_LINE = 400;
const BLANK_RUN = 40;
const MAX_LINES_LISTED = 5;
const MAX_WORDS_LISTED = 6;

/** A name for a hidden character: "U+202E". */
const codePointName = (ch: string) => "U+" + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");

/**
 * Looks through shared code for what a music pattern never needs: network,
 * storage, the page, running other code, and ways to hide those names
 * (escapes, names built from pieces, invisible characters, code pushed out
 * of sight). It reads the whole text, comments and strings included, so it
 * errs on the side of reporting. A clean scan does not prove the code is
 * safe: JavaScript has too many ways to reach a feature.
 */
export function scanCode(code: string): CodeScan {
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineAt = (index: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const found = new Map<string, Finding>();
  const add = (title: string, why: string, word: string, line: number) => {
    let finding = found.get(title);
    if (!finding) {
      finding = { title, why, words: [], lines: [] };
      found.set(title, finding);
    }
    if (!finding.words.includes(word) && finding.words.length < MAX_WORDS_LISTED) finding.words.push(word);
    if (!finding.lines.includes(line) && finding.lines.length < MAX_LINES_LISTED) finding.lines.push(line);
  };

  const lexed = lex(code);
  for (const rule of RULES) {
    const text = rule.on === "code" ? lexed.code : code;
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text))) {
      if (m[0] === "") {
        rule.pattern.lastIndex++;
        continue;
      }
      if (rule.accept && !rule.accept(m, text)) continue;
      add(rule.title, rule.why, code.slice(m.index, m.index + m[0].length).replace(/\s+/g, " ").trim(), lineAt(m.index));
    }
  }

  // "fe" + "tch": a short word-like string glued with +. Mini-notation strings ("bd*2 [~ sn]") are not word-like.
  // A short word-like string that is a piece of a sensitive name: "constr", "uctor", "ocalStor".
  for (const s of lexed.strings) {
    if (!/^[\w$]{1,24}$/.test(s.text)) continue;
    const after = /^\s*\+/.test(lexed.code.slice(s.end, s.end + 40));
    const beforePlus = /\+\s*$/.test(lexed.code.slice(Math.max(0, s.start - 40), s.start));
    const piece = s.text.length >= 3 && SENSITIVE_NAMES.some((name) => name !== s.text && name.includes(s.text));
    if (after || beforePlus || piece) add(PIECES.title, PIECES.why, code.slice(s.start, s.end) + (piece ? "" : " +"), lineAt(s.start));
  }

  for (const at of lexed.unclear) {
    add(
      "Code this check cannot read for sure",
      "an unfinished string or comment, or a slash after \")\" or \"}\" that JavaScript can read two ways, can hide code from this check",
      code.slice(at, at + 12).split(/\n/)[0].trim() || "here",
      lineAt(at),
    );
  }

  HIDDEN_IN_CODE.lastIndex = 0;
  let h: RegExpExecArray | null;
  while ((h = HIDDEN_IN_CODE.exec(code))) {
    const bidi = BIDI.test(h[0]);
    add(
      "Invisible characters",
      bidi
        ? "characters that reorder text can make the code look different from what runs"
        : "characters you cannot see can make the code look different from what runs",
      codePointName(h[0]),
      lineAt(h.index),
    );
  }

  const lines = code.split("\n");
  let blank = 0;
  lines.forEach((line, i) => {
    if (line.length > LONG_LINE) {
      add("Very long lines", "code can hide past the right edge of the editor", line.length + " characters", i + 1);
    }
    if (line.trim() === "") blank++;
    else {
      if (blank >= BLANK_RUN) add("Code far below empty lines", "code after many empty lines is easy to miss", blank + " empty lines", i + 1);
      blank = 0;
    }
  });

  return { risks: [...found.values()], sites: sitesIn(code) };
}

/** The sites the code names: hosts of http(s) and ws(s) URLs, protocol-relative URLs, and github: banks. */
export function sitesIn(code: string): string[] {
  const sites = new Set<string>();
  const URLS = /\b(?:https?|wss?):\/\/[^\s"'`<>()\\]+|(?<=["'`])\/\/[^\s"'`<>()\\/]+/gi;
  let m: RegExpExecArray | null;
  while ((m = URLS.exec(code)) && sites.size < 20) {
    try {
      const url = new URL(m[0].startsWith("//") ? "https:" + m[0] : m[0]);
      if (url.hostname) sites.add(url.hostname);
    } catch {
      /* not a URL after all */
    }
  }
  if (/["'`]github:/i.test(code)) sites.add("raw.githubusercontent.com");
  return [...sites];
}

/**
 * The code with invisible and bidirectional characters shown as ⟦U+202E⟧,
 * for a preview where they must not reorder or hide anything.
 */
export function revealHidden(code: string): string {
  return code.replace(HIDDEN_IN_CODE, (ch) => "⟦" + codePointName(ch) + "⟧");
}
