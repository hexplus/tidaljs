import { button, code, div, each, effect, label, option, select, signal, span } from "sibujs";
import { SNIPPETS, type Snippet } from "../data/snippets.ts";
import type { Session } from "../session.ts";

const DEFAULT_HINT = "Click a button to insert it at the cursor.";

/** The insert palette: a category and its buttons, which insert code at the cursor. */
export function Palette(session: Session) {
  const { category, setCategory, editor } = session;
  const [hint, setHint] = signal<Snippet | null>(null);

  const buttons = div(
    { id: "snippetButtons", class: "palette-buttons", role: "group", "aria-label": "Snippets" },
    [
      each(
        () => SNIPPETS[category()].map((snippet, i) => ({ snippet, key: category() + ":" + i })),
        (row) => {
          const { snippet } = row();
          return button(
            {
              class: "chip",
              type: "button",
              title: snippet.t,
              "aria-label": snippet.l + ": " + snippet.t,
              on: {
                // Keep the editor's cursor and focus when clicking with a mouse.
                mousedown: (e) => e.preventDefault(),
                click: () => editor.insertSnippet(snippet),
                mouseenter: () => setHint(snippet),
                focus: () => setHint(snippet),
                mouseleave: () => setHint(null),
                blur: () => setHint(null),
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
    buttons.scrollTop = 0;
  });

  return div("palette panel", [
    div("palette-head", [
      label({ for: "snippetCategory" }, "Insert"),
      select(
        {
          id: "snippetCategory",
          "aria-label": "Snippet category",
          on: { change: (e) => setCategory((e.target as HTMLSelectElement).value) },
        },
        Object.keys(SNIPPETS).map((name) => option({ value: name, selected: () => category() === name }, name)),
      ),
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
}
