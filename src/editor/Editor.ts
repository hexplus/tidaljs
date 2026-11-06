/**
 * The code editor: a textarea under a syntax-highlighted copy of its text,
 * with problem markers, line numbers, autocomplete, parameter help, parameter
 * tab stops and hover help.
 *
 * The text lives in the textarea, outside SibuJS, so it is an external()
 * source: the text layers track it and every edit invalidates it. Popups,
 * problem markers and the flash are signals.
 */
import { b, batch, code, div, each, effect, external, mark, nextTick, pre, signal, span, textarea } from "sibujs";
import { GLOBAL_SIGNATURES, METHOD_SIGNATURES, paramsOf, signatureLabel, type Param } from "../data/signatures.ts";
import type { Snippet } from "../data/snippets.ts";
import { TidalJS, type EvalResult } from "../engine.ts";
import {
  ARP_HELP, DESCRIPTIONS, GLOBALS, KEYWORD_HELP, METHODS, MINI_HELP, NO_PROBLEMS, SOUND_DESCRIPTIONS,
  STRING_CONTEXT, STRING_SOURCES, findInStrings, gutterHtml, highlightHtml, marksHtml, midiFreq, midiName,
  noteToMidi, rankItems, type CompletionItem, type Problems, type Range,
} from "./language.ts";

export interface EditorOptions {
  initialCode: string;
  /** Called with the new text after every edit. */
  onChange?: (text: string) => void;
}

export interface Editor {
  view: HTMLElement;
  /** Floating elements (suggestions, parameter help, hover help) to place at the page root. */
  popups: HTMLElement[];
  getValue(): string;
  setValue(text: string): void;
  insertSnippet(snippet: Snippet): void;
  focus(): void;
  /** Marks the error location and the unknown names from an eval() result. */
  showProblems(result: EvalResult, text: string): void;
  /** Briefly outlines the editor: "flash" for success, "flash-error" for errors. */
  flash(cls: "flash" | "flash-error"): void;
}

/** A call around a position: its name, whether it is a method, the argument index and its "(". */
interface Call {
  name: string;
  method: boolean;
  arg: number;
  open: number;
}

interface Completion {
  items: CompletionItem[];
  prefix: string;
  from: number;
}

interface SignatureHelp {
  call: Call;
  params: Param[];
  active: number;
  summary: string;
}

interface HoverHelp {
  key: string;
  start: number;
  title: string;
  lines: [string, string][];
  summary: string;
}

interface Position {
  top: number;
  left: number;
}

const NAV_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];

export function createEditor(options: EditorOptions): Editor {
  const onChange = options.onChange ?? (() => {});

  // ---------- State ----------

  const doc = external({ name: "editor text" });
  const [problems, setProblems] = signal<Problems>(NO_PROBLEMS);
  const [flashClass, setFlashClass] = signal("");
  const [ac, setAc] = signal<Completion | null>(null);
  const [acIndex, setAcIndex] = signal(0);
  const [acPos, setAcPos] = signal<Position>({ top: 0, left: 0 });
  const [sig, setSig] = signal<SignatureHelp | null>(null);
  const [sigPos, setSigPos] = signal<Position>({ top: 0, left: 0 });
  const [hover, setHover] = signal<HoverHelp | null>(null);
  const [hoverPos, setHoverPos] = signal<Position>({ top: 0, left: 0 });

  let suppressAutocomplete = false; // while code is inserted programmatically
  let tabStop: { open: number; outer?: number } | null = null; // the call being filled in
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverKey: string | null = null;
  let charWidth = 0;

  // ---------- Views ----------

  const gutterEl = div({ id: "gutter" });
  const marksEl = code({ id: "marks" });
  const highlightEl = code({ id: "highlight" });

  const ta = textarea({
    id: "codeEditor",
    // A false boolean attribute is removed, which would leave spell checking on.
    onElement: (el) => {
      el.spellcheck = false;
    },
    autocapitalize: "off",
    autocomplete: "off",
    "aria-label": "Pattern code",
    "aria-autocomplete": "list",
    "aria-controls": "autocomplete",
    "aria-expanded": () => (ac() ? "true" : "false"),
    "aria-activedescendant": () => (ac() ? "ac-opt-" + acIndex() : null),
    placeholder: 'Type a pattern, e.g. sound("bd sn")',
    on: {
      input: (e) => onInput(e as InputEvent),
      keydown: onKeydown,
      keyup: (e) => {
        if (NAV_KEYS.includes(e.key)) updateSignature();
      },
      click: () => updateSignature(),
      focus: () => updateSignature(),
      blur: () => {
        closeSignature();
        setTimeout(closeAutocomplete, 100);
      },
      mousedown: () => {
        closeAutocomplete();
        hideHover();
      },
      mousemove: onMouseMove,
      mouseleave: hideHover,
      scroll: () => {
        syncScroll();
        closeAutocomplete();
        closeSignature();
        hideHover();
      },
    },
  });

  const view = div({ id: "editor", class: () => "editor panel" + (flashClass() ? " " + flashClass() : "") }, [
    div({ class: "gutter", "aria-hidden": "true" }, [gutterEl]),
    div("code-area", [
      pre({ class: "marks", "aria-hidden": "true" }, [marksEl]),
      pre({ "aria-hidden": "true" }, [highlightEl]),
      ta,
    ]),
  ]);

  const acEl = div(
    {
      id: "autocomplete",
      class: "autocomplete",
      role: "listbox",
      "aria-label": "Suggestions",
      hidden: () => !ac(),
      style: { top: () => acPos().top + "px", left: () => acPos().left + "px" },
    },
    [
      each(
        () => {
          const state = ac();
          if (!state) return [];
          return state.items.map((item, i) => ({ item, i, prefix: state.prefix, key: state.prefix + "|" + i + "|" + item.name }));
        },
        (row) => {
          const { item, i, prefix } = row();
          const shown = item.kind === "fn" || item.kind === "call" ? signatureLabel(item.name, item.sig) : item.name;
          const at = prefix ? item.name.toLowerCase().indexOf(prefix.toLowerCase()) : -1;
          const label = at >= 0
            ? span("ac-label", [shown.slice(0, at), mark(shown.slice(at, at + prefix.length)), shown.slice(at + prefix.length)])
            : span("ac-label", [shown]);
          return div(
            {
              class: "ac-item",
              id: "ac-opt-" + i,
              role: "option",
              "aria-selected": () => (acIndex() === i ? "true" : "false"),
              on: {
                mousedown: (e) => e.preventDefault(),
                click: () => acceptAutocomplete(i),
              },
            },
            [label, span("ac-desc", [item.desc])],
          );
        },
        { key: (row) => row.key },
      ),
      div("ac-footer", ["Enter or Tab to insert, Esc to close"]),
    ],
  );

  const sigEl = div(
    {
      id: "sighelp",
      class: "sighelp",
      role: "tooltip",
      "aria-live": "polite",
      hidden: () => !sig(),
      style: { top: () => sigPos().top + "px", left: () => sigPos().left + "px" },
    },
    [
      () => {
        const state = sig();
        if (!state) return "";
        const { call, params, active, summary } = state;
        const line: (string | HTMLElement)[] = [span("sig-name", [(call.method ? "." : "") + call.name]), "("];
        params.forEach((p, i) => {
          if (i > 0) line.push(", ");
          line.push(i === active ? span("sig-active", [p.name]) : p.name);
        });
        line.push(")");
        return div([
          div("sig-line", line),
          active >= 0 ? div("sig-param", [b(params[active].name.replace("?", "")), ": " + params[active].desc]) : "",
          div("sig-desc", [summary]),
        ]);
      },
    ],
  );

  const hoverEl = div(
    {
      id: "hoverhelp",
      class: "sighelp hoverhelp",
      role: "tooltip",
      hidden: () => !hover(),
      style: { top: () => hoverPos().top + "px", left: () => hoverPos().left + "px" },
    },
    [
      () => {
        const state = hover();
        if (!state) return "";
        return div([
          div("sig-line", [span("sig-name", [state.title])]),
          ...state.lines.map(([term, text]) => div("sig-param", [b(term.replace("?", "")), ": " + text])),
          state.summary ? div("sig-desc", [state.summary]) : "",
        ]);
      },
    ],
  );

  // ---------- Text layers ----------

  function syncScroll() {
    const shift = "translate(" + -ta.scrollLeft + "px," + -ta.scrollTop + "px)";
    (highlightEl.parentElement as HTMLElement).style.transform = shift;
    (marksEl.parentElement as HTMLElement).style.transform = shift;
    gutterEl.style.transform = "translateY(" + -ta.scrollTop + "px)";
  }

  // Escaped HTML built from the text, so innerHTML is safe here.
  effect(() => {
    doc.track();
    // sibujs-disable-next-line no-direct-dom-mutation
    highlightEl.innerHTML = highlightHtml(ta.value);
    syncScroll();
  });
  effect(() => {
    doc.track();
    const current = problems();
    // sibujs-disable-next-line no-direct-dom-mutation
    marksEl.innerHTML = marksHtml(ta.value, current);
    // sibujs-disable-next-line no-direct-dom-mutation
    gutterEl.innerHTML = gutterHtml(ta.value, current);
  });

  // ---------- Editing ----------

  /** Replaces [start, end) with text, keeping the browser's undo history when possible. */
  function replaceText(start: number, end: number, text: string) {
    suppressAutocomplete = true;
    ta.focus();
    ta.setSelectionRange(start, end);
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      ta.setRangeText(text, start, end, "end");
      ta.dispatchEvent(new Event("input"));
    }
    suppressAutocomplete = false;
  }

  function indent(outdent: boolean) {
    const { selectionStart: start, selectionEnd: end, value } = ta;
    if (outdent) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      if (value.startsWith("  ", lineStart)) {
        ta.setRangeText("", lineStart, lineStart + 2, "preserve");
        ta.selectionStart = ta.selectionEnd = Math.max(lineStart, start - 2);
      }
    } else {
      ta.setRangeText("  ", start, end, "end");
    }
    ta.dispatchEvent(new Event("input"));
  }

  function insertSnippet(snippet: Snippet) {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    let text = snippet.c;
    // Separate mini-notation words from the previous step.
    const before = ta.value[start - 1];
    if (snippet.w && before && !/[\s"'`[<{(,|]/.test(before)) text = " " + text;

    replaceText(start, end, text);

    // Calls get one tab stop per parameter; other snippets select their placeholder.
    const call = /^\s?\.?[A-Za-z_$][\w$]*\(/.exec(text);
    const open = call ? start + call[0].length - 1 : -1;
    const info = call ? callArguments(open) : null;
    if (info && info.close === start + text.trimEnd().length - 1 && startTabStops(open)) return;
    if (snippet.s) {
      const at = text.indexOf(snippet.s);
      if (at >= 0) ta.setSelectionRange(start + at, start + at + snippet.s.length);
    }
    updateSignature();
  }

  // ---------- Parameter tab stops ----------
  //
  // After inserting a call, each argument is a stop: the first is selected
  // so typing replaces it, Tab and Shift+Tab move between them, and Tab
  // after the last one leaves the parentheses.

  /** The arguments of the call whose "(" is at `open`. */
  function callArguments(open: number): { args: Range[]; close: number } | null {
    const text = ta.value;
    if (text[open] !== "(") return null;
    const args: Range[] = [];
    let depth = 0;
    let argStart = open + 1;
    for (let i = open + 1; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        let j = i + 1;
        while (j < text.length && text[j] !== ch) {
          if (text[j] === "\\") j++;
          j++;
        }
        i = j;
      } else if ("([{".includes(ch)) {
        depth++;
      } else if (")]}".includes(ch)) {
        if (depth === 0) {
          if (ch !== ")") return null;
          args.push({ start: argStart, end: i });
          return { args: args.map(trimRange).filter((r) => r.end > r.start || args.length === 1), close: i };
        }
        depth--;
      } else if (ch === "," && depth === 0) {
        args.push({ start: argStart, end: i });
        argStart = i + 1;
      }
    }
    return null;
  }

  function trimRange(r: Range): Range {
    const text = ta.value;
    let { start, end } = r;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return { start, end };
  }

  /** The parts of a call worth stopping at; a lone nested call stops at its own arguments. */
  function argumentStops(open: number): { stops: Range[]; close: number; open: number } | null {
    const info = callArguments(open);
    if (!info) return null;
    const text = ta.value;
    if (info.args.length === 1) {
      const only = info.args[0];
      const inner = /^[A-Za-z_$][\w$.]*\(/.exec(text.slice(only.start, only.end));
      if (inner) {
        const innerOpen = only.start + inner[0].length - 1;
        const nested = callArguments(innerOpen);
        if (nested && nested.close === only.end - 1) return argumentStops(innerOpen);
      }
    }
    // Arrays and objects are edited by hand, not as one stop.
    const stops = info.args.filter((r) => !/^[[{]/.test(text.slice(r.start, r.end)));
    return { stops, close: info.close, open };
  }

  function selectStop(r: Range) {
    const text = ta.value;
    let { start, end } = r;
    if (end - start >= 2 && /^(["'`])[\s\S]*\1$/.test(text.slice(start, end))) {
      start++;
      end--;
    }
    ta.setSelectionRange(start, end);
    updateSignature();
  }

  function startTabStops(open: number): boolean {
    const info = argumentStops(open);
    if (!info || info.stops.length === 0) return false;
    // No parameters, e.g. .rev(): leave the cursor after the call.
    if (info.stops.every((r) => r.end === r.start)) return false;
    tabStop = { open: info.open, outer: open };
    selectStop(info.stops[0]);
    return true;
  }

  /** Moves to the next (or previous) stop. Returns false when not filling in a call. */
  function moveTabStop(backwards: boolean): boolean {
    if (!tabStop) return false;
    const info = argumentStops(tabStop.open);
    const pos = ta.selectionStart;
    if (!info || pos <= info.open || pos > info.close) {
      tabStop = null;
      return false;
    }
    const stops = info.stops.length ? info.stops : [{ start: info.open + 1, end: info.close }];
    let index = stops.findIndex((r) => pos >= r.start && pos <= r.end);
    if (index < 0) index = stops.findIndex((r) => r.start > pos) - 1;
    const next = index + (backwards ? -1 : 1);
    if (next >= stops.length) {
      // Done: leave the call (the outer one for nested snippets).
      const outer = tabStop.outer !== undefined && tabStop.outer !== tabStop.open ? callArguments(tabStop.outer) : null;
      const after = (outer ? outer.close : info.close) + 1;
      ta.setSelectionRange(after, after);
      tabStop = null;
      updateSignature();
    } else {
      selectStop(stops[Math.max(0, next)]);
    }
    return true;
  }

  // ---------- Caret geometry ----------

  function caretMetrics() {
    const style = getComputedStyle(ta);
    if (!charWidth) {
      const c = document.createElement("canvas").getContext("2d");
      if (c) {
        c.font = style.fontSize + " " + style.fontFamily;
        charWidth = c.measureText("M".repeat(50)).width / 50;
      }
    }
    return {
      charWidth: charWidth || 8.4,
      lineHeight: parseFloat(style.lineHeight),
      padLeft: parseFloat(style.paddingLeft),
      padTop: parseFloat(style.paddingTop),
    };
  }

  /** Screen position of the top-left corner of the character at `index`. */
  function caretCoords(index: number) {
    const m = caretMetrics();
    const text = ta.value.slice(0, index);
    const lineStart = text.lastIndexOf("\n") + 1;
    const line = text.split("\n").length - 1;
    const column = text.slice(lineStart).replace(/\t/g, "  ").length;
    const rect = ta.getBoundingClientRect();
    return {
      x: rect.left + m.padLeft + column * m.charWidth - ta.scrollLeft,
      y: rect.top + m.padTop + line * m.lineHeight - ta.scrollTop,
      lineHeight: m.lineHeight,
    };
  }

  /** Runs fn now and again once the DOM has caught up, for popups that are measured. */
  function afterRender(fn: () => void) {
    fn();
    void nextTick().then(fn);
  }

  // ---------- Autocomplete ----------
  //
  // Suggests functions after typing a name, methods after ".", and inside
  // strings: sound names in sound("..."), scale names in scale("..."), chord
  // names after ' in note("..."), arpeggio modes and vowels.

  /** Works out what is being typed at the cursor and what could complete it. */
  function completionContext(manual: boolean): Completion | null {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return null;
    const text = ta.value;
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    const line = text.slice(lineStart, pos);

    // Find an unclosed string on this line, and skip comments.
    let quote: string | null = null;
    let quoteAt = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === "/" && line[i + 1] === "/") {
        return null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        quoteAt = i;
      }
    }

    if (quote) {
      const call = /([A-Za-z_$][\w$]*)\s*\(\s*$/.exec(line.slice(0, quoteAt));
      const source = call ? STRING_CONTEXT[call[1]] : undefined;
      if (!source) return null;
      const token = (/[^\s[\]<>{}(),|"`]*$/.exec(line.slice(quoteAt + 1)) ?? [""])[0];
      let prefix = token;
      if (source === "chord") {
        const parts = token.split("'");
        if (parts.length !== 2) return null; // only the chord name part
        prefix = parts[1];
      } else if (source === "scale") {
        prefix = token.includes(":") ? token.slice(token.lastIndexOf(":") + 1) : token;
      } else if (source === "sound") {
        prefix = (/[^*/!@?:~.]*$/.exec(token) ?? [""])[0];
        if (/[*/!@?:]/.test(token.slice(0, token.length - prefix.length).slice(-1))) return null;
      }
      const opened = source === "chord" || (source === "scale" && token.includes(":"));
      if (!manual && !prefix && !opened) return null;
      return { from: pos - prefix.length, prefix, items: STRING_SOURCES[source]() };
    }

    const match = /[A-Za-z_$][\w$]*$/.exec(line);
    const word = match ? match[0] : "";
    const before = line.slice(0, line.length - word.length);
    if (before.endsWith(".")) {
      const lead = /([\w$]+)\.$/.exec(before);
      if (lead && /^\d/.test(lead[1])) return null; // a decimal number such as 0.5
      return { from: pos - word.length, prefix: word, items: METHODS };
    }
    if (/[0-9]$/.test(before)) return null;
    if (!manual && !word) return null;
    return { from: pos - word.length, prefix: word, items: GLOBALS };
  }

  function updateAutocomplete(manual = false) {
    const ctx = completionContext(manual);
    if (!ctx) return closeAutocomplete();
    const ranked = rankItems(ctx.items, ctx.prefix);
    // Nothing left to complete when the only match is already typed.
    const onlyMatchTyped = ranked.length === 1 && ranked[0].name === ctx.prefix && ranked[0].kind !== "fn" && ranked[0].kind !== "call";
    if (ranked.length === 0 || (!manual && onlyMatchTyped)) return closeAutocomplete();
    batch(() => {
      setAcIndex(0);
      setAc({ items: ranked.slice(0, 60), prefix: ctx.prefix, from: ctx.from });
    });
    afterRender(positionAutocomplete);
  }

  function positionAutocomplete() {
    const state = ac();
    if (!state) return;
    const { x, y, lineHeight } = caretCoords(state.from);
    const height = acEl.offsetHeight;
    const width = acEl.offsetWidth;
    let top = y + lineHeight + 2;
    if (top + height > window.innerHeight - 8) top = Math.max(8, y - height - 2);
    const left = Math.max(8, Math.min(x - 8, window.innerWidth - width - 8));
    setAcPos({ top, left });
    positionSignature();
  }

  function moveSelection(delta: number) {
    const state = ac();
    if (!state) return;
    setAcIndex((i) => (i + delta + state.items.length) % state.items.length);
    void nextTick().then(() => {
      document.getElementById("ac-opt-" + acIndex())?.scrollIntoView({ block: "nearest" });
    });
  }

  function acceptAutocomplete(index = acIndex()) {
    const state = ac();
    const item = state?.items[index];
    if (!state || !item) return closeAutocomplete();
    const pos = ta.selectionStart;
    const after = ta.value.slice(pos);
    let text = item.name;
    let caret = text.length;
    if (item.kind === "fn" || item.kind === "call") {
      // Reuse a "(" that is already there.
      if (after.startsWith("(")) {
        caret = text.length + 1;
      } else {
        text += "()";
        caret = item.kind === "fn" ? text.length - 1 : text.length;
      }
    } else if (item.kind === "kw") {
      text += " ";
      caret = text.length;
    }
    const from = state.from;
    closeAutocomplete();
    replaceText(from, pos, text);
    ta.setSelectionRange(from + caret, from + caret);
    // Tab leaves the parentheses once the arguments are typed.
    if (item.kind === "fn") tabStop = { open: from + item.name.length };
    updateSignature();
  }

  function closeAutocomplete() {
    if (ac() !== null) setAc(null);
  }

  // ---------- Parameter help ----------

  /** The innermost function call around offset `pos`, or null. */
  function callAt(pos: number): Call | null {
    const text = ta.value;
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

  function updateSignature() {
    const call = callAt(ta.selectionStart);
    const signature = call ? signatureOf(call) : undefined;
    if (!call || !signature) return closeSignature();
    const params = paramsOf(signature);
    // Extra arguments (e.g. stack(a, b, c)) stay on the last parameter.
    const active = params.length ? Math.min(call.arg, params.length - 1) : -1;
    setSig({ call, params, active, summary: signature[0] });
    afterRender(positionSignature);
  }

  function positionSignature() {
    const state = sig();
    if (!state) return;
    const caret = caretCoords(ta.selectionStart);
    const anchor = caretCoords(state.call.open);
    const height = sigEl.offsetHeight;
    const width = sigEl.offsetWidth;
    // Above the current line; below it if there is no room, unless the
    // suggestion list already uses that space.
    let top = caret.y - height - 4;
    if (top < 8) {
      if (ac()) return closeSignature();
      top = caret.y + caret.lineHeight + 4;
    }
    const left = Math.max(8, Math.min(anchor.y === caret.y ? anchor.x - 8 : caret.x - 8, window.innerWidth - width - 8));
    setSigPos({ top, left });
  }

  function closeSignature() {
    if (sig() !== null) setSig(null);
  }

  // ---------- Hover help ----------
  //
  // Resting the mouse on the code explains what is under it: functions and
  // methods, sounds, notes, chords, scales, mini-notation symbols, and the
  // parameter a value is passed as.

  /** Offset of the character under a point of the screen, or -1. */
  function offsetAtPoint(clientX: number, clientY: number): number {
    const m = caretMetrics();
    const rect = ta.getBoundingClientRect();
    const x = clientX - rect.left - m.padLeft + ta.scrollLeft;
    const y = clientY - rect.top - m.padTop + ta.scrollTop;
    if (x < 0 || y < 0) return -1;
    const line = Math.floor(y / m.lineHeight);
    const column = Math.floor(x / m.charWidth);
    const lines = ta.value.split("\n");
    if (line >= lines.length || column >= lines[line].length) return -1;
    let offset = 0;
    for (let i = 0; i < line; i++) offset += lines[i].length + 1;
    return offset + column;
  }

  /** The run of characters matching `allowed` around `offset`. */
  function wordAround(text: string, offset: number, allowed: RegExp) {
    let start = offset;
    let end = offset;
    while (start > 0 && allowed.test(text[start - 1])) start--;
    while (end < text.length && allowed.test(text[end])) end++;
    return { start, end, word: text.slice(start, end) };
  }

  /** The parameter that offset `pos` is passed as, if it is inside a known call. */
  function parameterAt(pos: number): { name: string; desc: string; of: string } | null {
    const call = callAt(pos);
    const signature = call ? signatureOf(call) : undefined;
    if (!call || !signature) return null;
    const params = paramsOf(signature);
    if (!params.length) return null;
    const param = params[Math.min(call.arg, params.length - 1)];
    return { name: param.name.replace("?", ""), desc: param.desc, of: (call.method ? "." : "") + call.name + "()" };
  }

  /** Describes what is at `offset`, or null when there is nothing to say. */
  function describeAt(offset: number): HoverHelp | null {
    const text = ta.value;
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

    return quote ? describeInString(line, lineStart, quoteAt, col) : describeCode(text, offset);
  }

  function describeInString(line: string, lineStart: number, quoteAt: number, col: number): HoverHelp | null {
    const call = /([A-Za-z_$][\w$]*)\s*\(\s*$/.exec(line.slice(0, quoteAt));
    const context = call ? STRING_CONTEXT[call[1]] : undefined;
    const ch = line[col];
    const offset = lineStart + col;
    const alone = /[\s"'`]/.test(line[col - 1] || " ") && /[\s"'`]/.test(line[col + 1] || " ");

    // Mini-notation symbols. A "." or "_" is a symbol only on its own.
    const isSymbol = MINI_HELP[ch] && !((ch === "." || ch === "_") && !alone)
      && !(ch === ":" && context === "scale") && !(ch === "'" && context === "chord");
    if (isSymbol) {
      const [title, desc] = MINI_HELP[ch];
      return { key: "sym:" + offset, start: offset, title, lines: [], summary: desc };
    }

    const allowed = context === "scale" ? /[\w#.\-:]/ : context === "chord" ? /[\w#.\-']/ : /[\w#.-]/;
    const { start, word } = wordAround(line, col, allowed);
    if (!word) return null;
    const at = lineStart + start;
    const help = (lines: [string, string][], summary: string): HoverHelp => ({
      key: "word:" + at + ":" + word, start: at, title: word, lines, summary,
    });

    // A number right after a modifier: "*2", "?0.3", "@3".
    const before = line[start - 1];
    if (/^-?\d+(\.\d+)?$/.test(word) && before && "*/!@?%:".includes(before) && MINI_HELP[before]) {
      return { ...help([], MINI_HELP[before][1].replace(/\bn\b/, word)), title: before + word };
    }

    switch (context) {
      case "sound":
        return help([], TidalJS.soundNames.includes(word) ? SOUND_DESCRIPTIONS[word] || "Sound" : "Unknown sound");
      case "chord": {
        if (word.includes("'")) {
          const notes = TidalJS.parseChord(word);
          if (!notes) return help([], "Unknown chord");
          return help(
            [["notes", notes.map((n) => midiName(60 + n)).join(" ")]],
            "Chord: root'name'modifiers (i inverts, o opens, a number sets the note count)",
          );
        }
        const isNumber = /^-?\d+(\.\d+)?$/.test(word);
        const midi = isNumber ? 60 + parseFloat(word) : noteToMidi(word);
        if (midi === undefined) return help([], "Unknown note");
        const detail = (isNumber ? midiName(midi) + ", " : "") + "MIDI " + +midi.toFixed(2) + ", " + midiFreq(midi);
        return help([["note", detail]], isNumber ? "Semitones from middle C" : "Note");
      }
      case "scale": {
        const [root, name] = word.includes(":") ? word.split(":") : ["c", word];
        const known = TidalJS.scaleNames.includes(String(name).toLowerCase());
        return help([], known ? "Scale " + name + " starting on " + root : "Unknown scale");
      }
      case "arp":
        return help([], ARP_HELP[word] ? "Arpeggio: " + ARP_HELP[word] : "Unknown arpeggio mode");
      case "vowel":
        return help([], TidalJS.vowels.includes(word) ? "Formant filter for the vowel " + word : "Unknown vowel");
      default: {
        const param = parameterAt(offset);
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
      const param = parameterAt(offset);
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
          lines: paramsOf(signature).map((p): [string, string] => [p.name, p.desc]), summary: signature[0],
        };
      }
      return DESCRIPTIONS[word] ? { key, start: ident.start, title: "." + word + "()", lines: [], summary: DESCRIPTIONS[word] } : null;
    }
    if (KEYWORD_HELP[word]) return { key, start: ident.start, title: word, lines: [], summary: KEYWORD_HELP[word] };
    const signature = GLOBAL_SIGNATURES[word];
    if (signature) {
      return {
        key, start: ident.start, title: signatureLabel(word, signature),
        lines: paramsOf(signature).map((p): [string, string] => [p.name, p.desc]), summary: signature[0],
      };
    }
    const global = GLOBALS.find((g) => g.name === word);
    return global && global.desc ? { key, start: ident.start, title: word, lines: [], summary: global.desc } : null;
  }

  function showHoverAt(clientX: number, clientY: number) {
    const offset = offsetAtPoint(clientX, clientY);
    const help = offset >= 0 ? describeAt(offset) : null;
    if (!help) return hideHover();
    if (help.key === hoverKey) return;
    hoverKey = help.key;
    setHover(help);
    afterRender(positionHover);
  }

  function positionHover() {
    const state = hover();
    if (!state) return;
    const { x, y, lineHeight } = caretCoords(state.start);
    const height = hoverEl.offsetHeight;
    const width = hoverEl.offsetWidth;
    // Below the hovered line; above it if it does not fit.
    let top = y + lineHeight + 4;
    if (top + height > window.innerHeight - 8) top = Math.max(8, y - height - 4);
    const left = Math.max(8, Math.min(x - 8, window.innerWidth - width - 8));
    setHoverPos({ top, left });
  }

  function hideHover() {
    clearTimeout(hoverTimer);
    hoverKey = null;
    if (hover() !== null) setHover(null);
  }

  function onMouseMove(e: MouseEvent) {
    clearTimeout(hoverTimer);
    const { clientX, clientY } = e;
    hoverTimer = setTimeout(() => showHoverAt(clientX, clientY), 350);
  }

  // ---------- Events ----------

  function onInput(e: InputEvent) {
    hideHover();
    // Markers belong to the code as it was run; drop them on edits.
    batch(() => {
      setProblems(NO_PROBLEMS);
      doc.invalidate();
    });
    onChange(ta.value);

    if (!suppressAutocomplete) {
      const type = e.inputType || "";
      if (type.startsWith("insert") && type !== "insertLineBreak") updateAutocomplete();
      else if (ac() && type.startsWith("delete")) updateAutocomplete();
      else closeAutocomplete();
    }
    updateSignature();
  }

  function onKeydown(e: KeyboardEvent) {
    hideHover();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === " " || e.code === "Space")) {
      e.preventDefault();
      updateAutocomplete(true);
      return;
    }

    // Suggestions own the navigation keys while open. A consumed key must not
    // reach the page, where Escape stops the music.
    const state = ac();
    if (state) {
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "ArrowDown") return consume(), moveSelection(1);
      if (e.key === "ArrowUp") return consume(), moveSelection(-1);
      if (e.key === "PageDown") return consume(), moveSelection(Math.min(8, state.items.length - 1 - acIndex()));
      if (e.key === "PageUp") return consume(), moveSelection(-Math.min(8, acIndex()));
      if ((e.key === "Enter" || e.key === "Tab") && !mod && !e.shiftKey && !e.altKey) return consume(), acceptAutocomplete();
      if (e.key === "Escape") return consume(), closeAutocomplete();
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || (mod && e.key === "Enter")) closeAutocomplete();
    }

    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      if (!moveTabStop(e.shiftKey)) indent(e.shiftKey);
      return;
    }

    if (e.key === "Escape") {
      // Let it through: the page stops the music.
      tabStop = null;
      closeSignature();
    }
  }

  window.addEventListener("resize", () => {
    closeAutocomplete();
    closeSignature();
    hideHover();
  });

  ta.value = options.initialCode;
  doc.invalidate();

  return {
    view,
    popups: [acEl, sigEl, hoverEl],
    getValue: () => ta.value,
    setValue(text) {
      ta.value = text;
      ta.scrollTop = 0;
      ta.scrollLeft = 0;
      ta.dispatchEvent(new Event("input"));
    },
    insertSnippet,
    focus: () => ta.focus(),
    showProblems(result, text) {
      const errors = result.location ? [result.location] : [];
      const warnings: Range[] = [];
      for (const w of result.warnings) {
        const name = /"([^"]+)"/.exec(w);
        if (name) warnings.push(...findInStrings(text, name[1]));
      }
      setProblems({ errors, warnings });
    },
    flash(cls) {
      clearTimeout(flashTimer);
      setFlashClass("");
      requestAnimationFrame(() => {
        setFlashClass(cls);
        flashTimer = setTimeout(() => setFlashClass(""), 300);
      });
    },
  };
}
