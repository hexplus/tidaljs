import { button, code, div, each, effect, label, nextTick, option, select, signal, span, untracked } from "sibujs";
import { docForLabel } from "../data/docs.ts";
import { SNIPPETS, type Snippet } from "../data/snippets.ts";
import { DocView } from "../editor/Editor.ts";
import type { Session } from "../session.ts";

const DEFAULT_HINT = "Click a button to insert it at the cursor.";

/** How long the mouse rests on a button before its help shows, as in the editor. */
const HOVER_DELAY = 350;

interface ButtonHelp {
  snippet: Snippet;
  category: string;
  anchor: HTMLElement;
}

export interface PaletteView {
  view: HTMLElement;
  /** The buttons' help, a floating element to place at the page root. */
  popup: HTMLElement;
}

/**
 * The insert palette: a category and its buttons, which insert code at the
 * cursor. Resting on a button (or focusing it) shows the same help box as the
 * editor's hover help.
 */
export function Palette(session: Session): PaletteView {
  const { category, setCategory, editor } = session;
  const [hint, setHint] = signal<Snippet | null>(null);
  const [help, setHelp] = signal<ButtonHelp | null>(null);
  const [helpPos, setHelpPos] = signal({ top: 0, left: 0 });
  let helpTimer: ReturnType<typeof setTimeout> | undefined;

  const popup = div(
    {
      id: "paletteHelp",
      class: "sighelp hoverhelp",
      role: "tooltip",
      hidden: () => !help(),
      style: { top: () => helpPos().top + "px", left: () => helpPos().left + "px" },
    },
    [
      () => {
        const state = help();
        if (!state) return "";
        const { snippet } = state;
        const doc = docForLabel(snippet.l, state.category);
        return div([
          div("sig-line", [span("sig-name", [snippet.l])]),
          snippet.c.trim() === snippet.l.trim() ? "" : div("sig-param", [code(snippet.c.replace(/\s*\n\s*/g, " "))]),
          div("sig-desc", [snippet.t]),
          doc ? DocView(doc, "hover-doc") : "",
        ]);
      },
    ],
  );

  /** Below the button; above it when it does not fit. */
  function placeHelp() {
    const state = help();
    if (!state) return;
    const rect = state.anchor.getBoundingClientRect();
    const height = popup.offsetHeight;
    const width = popup.offsetWidth;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setHelpPos({ top, left });
  }

  function showHelp(snippet: Snippet, anchor: HTMLElement, delay: number) {
    clearTimeout(helpTimer);
    const open = () => {
      setHelp({ snippet, category: category(), anchor });
      placeHelp();
      void nextTick().then(placeHelp);
    };
    if (delay > 0 && !help()) helpTimer = setTimeout(open, delay);
    else open();
  }

  function hideHelp() {
    clearTimeout(helpTimer);
    if (help() !== null) setHelp(null);
  }

  const buttons = div(
    {
      id: "snippetButtons",
      class: "palette-buttons",
      role: "group",
      "aria-label": "Snippets",
      on: { scroll: hideHelp },
    },
    [
      each(
        () => SNIPPETS[category()].map((snippet, i) => ({ snippet, key: category() + ":" + i })),
        (row) => {
          const { snippet } = row();
          return button(
            {
              class: "chip",
              type: "button",
              "aria-label": snippet.l + ": " + snippet.t,
              "aria-describedby": () => (help()?.snippet === snippet ? "paletteHelp" : null),
              on: {
                // Keep the editor's cursor and focus when clicking with a mouse.
                mousedown: (e) => {
                  e.preventDefault();
                  hideHelp();
                },
                click: () => editor.insertSnippet(snippet),
                mouseenter: (e) => {
                  setHint(snippet);
                  // Moving from one button to the next keeps the box open and follows at once.
                  showHelp(snippet, e.currentTarget as HTMLElement, HOVER_DELAY);
                },
                focus: (e) => {
                  setHint(snippet);
                  showHelp(snippet, e.currentTarget as HTMLElement, 0);
                },
                mouseleave: () => {
                  setHint(null);
                  hideHelp();
                },
                blur: () => {
                  setHint(null);
                  hideHelp();
                },
                keydown: (e) => {
                  if (e.key === "Escape" && help()) hideHelp();
                },
              },
            },
            snippet.l,
          );
        },
        { key: (row) => row.key },
      ),
    ],
  );

  effect(() => {
    category();
    untracked(() => {
      buttons.scrollTop = 0;
      hideHelp();
    });
  });

  const view = div("palette panel", [
    div("palette-head", [
      label({ for: "snippetCategory" }, "Insert"),
      div("select-wrap", [
        select(
          {
            id: "snippetCategory",
            class: "select",
            "aria-label": "Snippet category",
            on: { change: (e) => setCategory((e.target as HTMLSelectElement).value) },
          },
          Object.keys(SNIPPETS).map((name) =>
            option({ value: name, selected: () => category() === name }, name + " (" + SNIPPETS[name].length + ")"),
          ),
        ),
      ]),
      span({ id: "snippetHint", class: "palette-hint", "aria-live": "polite" }, [
        () => {
          const current = hint();
          return current ? code(current.c.replace(/\s*\n\s*/g, " ")) : "";
        },
        () => {
          const current = hint();
          return current ? " " + current.t : DEFAULT_HINT;
        },
      ]),
    ]),
    buttons,
  ]);

  return { view, popup };
}
