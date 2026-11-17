/**
 * The code editor: a textarea under a syntax-highlighted copy of its text,
 * with problem markers, line numbers, autocomplete, parameter tab stops and
 * hover help.
 *
 * The text lives in the textarea, outside SibuJS, so it is an external()
 * source: the text layers track it and every edit invalidates it. Popups,
 * problem markers and the flash are signals.
 */
import { b, batch, code, div, each, effect, external, mark, nextTick, pre, signal, span, textarea } from "sibujs";
import type { Doc } from "../data/docs.ts";
import { signatureLabel } from "../data/signatures.ts";
import type { Snippet } from "../data/snippets.ts";
import type { EvalResult } from "../engine.ts";
import { describeAt, type HoverHelp } from "./hover.ts";
import {
  GLOBALS, METHODS, NO_PROBLEMS, STRING_CONTEXT, STRING_SOURCES, findInStrings, gutterHtml, highlightHtml, marksHtml,
  rankItems, type CompletionItem, type Problems, type Range,
} from "./language.ts";

export interface EditorOptions {
  initialCode: string;
  /** Called with the new text after every edit. */
  onChange?: (text: string) => void;
}

export interface Editor {
  view: HTMLElement;
  /** Floating elements (suggestions, hover help) to place at the page root. */
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

interface Completion {
  items: CompletionItem[];
  prefix: string;
  from: number;
}

interface Position {
  top: number;
  left: number;
}

/** Extended help: what it does, an example, a tip and related names. */
export function DocView(doc: Doc, cls: string): HTMLElement {
  return div({ class: "doc " + cls }, [
    div("doc-about", [doc.about]),
    doc.example ? pre({ class: "doc-example" }, [code(doc.example)]) : "",
    doc.tip ? div("doc-tip", [doc.tip]) : "",
    doc.see && doc.see.length
      ? div("doc-see", ["See also ", ...doc.see.flatMap((name, i) => (i ? [", ", code(name)] : [code(name)]))])
      : "",
  ]);
}

export function createEditor(options: EditorOptions): Editor {
  const onChange = options.onChange ?? (() => {});

  // ---------- State ----------

  const doc = external({ name: "editor text" });
  const [problems, setProblems] = signal<Problems>(NO_PROBLEMS);
  const [flashClass, setFlashClass] = signal("");
  const [ac, setAc] = signal<Completion | null>(null);
  const [acIndex, setAcIndex] = signal(0);
  const [acPos, setAcPos] = signal<Position>({ top: 0, left: 0 });
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
      blur: () => {
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
      div({ class: "ac-list" }, [each(
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
      )]),
      div("ac-footer", ["Enter or Tab to insert, Esc to close"]),
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
          state.doc ? DocView(state.doc, "hover-doc") : state.summary ? div("sig-desc", [state.summary]) : "",
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
  }

  function closeAutocomplete() {
    if (ac() !== null) setAc(null);
  }

  // ---------- Hover help (the texts come from hover.ts) ----------

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

  function showHoverAt(clientX: number, clientY: number) {
    const offset = offsetAtPoint(clientX, clientY);
    const help = offset >= 0 ? describeAt(ta.value, offset) : null;
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
    }
  }

  window.addEventListener("resize", () => {
    closeAutocomplete();
    hideHover();
  });

  ta.value = options.initialCode;
  doc.invalidate();

  return {
    view,
    popups: [acEl, hoverEl],
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
