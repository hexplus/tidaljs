import { aside, button, code, derived, div, each, effect, input, nextTick, p, signal, span, strong, when } from "sibujs";
import { EXAMPLES, type Example } from "../data/examples.ts";
import type { Session } from "../session.ts";
import { LibraryPanel, type Library } from "./Library.ts";
import { Reference } from "./Reference.ts";

export type Tab = "examples" | "library" | "reference";

/** The examples, filtered, with a heading before each group. */
function ExampleList(session: Session, library: Library) {
  const [query, setQuery] = signal("");
  const cards = new Map<Example, HTMLElement>();

  // Bring the current example into view when it changes.
  effect(() => {
    const example = session.currentExample();
    if (!example) return;
    void nextTick().then(() => cards.get(example)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  });

  type Row = { key: string; group?: string; example?: Example };
  const rows = derived<Row[]>(() => {
    const q = query().trim().toLowerCase();
    const out: Row[] = [];
    let group: string | null = null;
    EXAMPLES.forEach((example, i) => {
      if (q && !(example.title + " " + example.code + " " + example.group).toLowerCase().includes(q)) return;
      if (example.group !== group) {
        group = example.group;
        out.push({ key: "group:" + group, group });
      }
      out.push({ key: "example:" + i, example });
    });
    return out;
  });

  return [
    input({
      type: "search",
      id: "exampleFilter",
      class: "search",
      placeholder: "Filter examples",
      "aria-label": "Filter examples",
      on: { input: (e) => setQuery((e.target as HTMLInputElement).value) },
    }),
    p({ class: "hint" }, "Click an example to load it. While playing, it starts right away."),
    div({ id: "exampleList" }, [
      each(
        () => rows(),
        (row) => {
          const { group, example } = row();
          if (!example) return div("group-title", [group ?? ""]);
          const clamped = example.code.split("\n").length > 6;
          const selected = () => session.currentExample() === example;
          const active = () => selected() && session.playing();
          const card = button(
            {
              class: () => "example" + (selected() ? " selected" : "") + (active() ? " playing" : ""),
              type: "button",
              "aria-current": () => (selected() ? "true" : null),
              on: { click: () => void library.loadExample(example) },
            },
            [
              div("example-head", [
                strong(example.title),
                span({ class: "example-badge", hidden: () => !active() }, [span({ class: "badge-dot", "aria-hidden": "true" }), "Playing"]),
              ]),
              code({ class: clamped ? "clamped" : "" }, example.code),
            ],
          );
          cards.set(example, card);
          return card;
        },
        { key: (row) => row.key },
      ),
      when(() => rows().length === 0, () => p({ class: "empty" }, "No examples match.")),
    ]),
  ];
}

/** Examples, Library and Reference, as tabs. The app owns the open tab so the top bar can show the library. */
export function Sidebar(session: Session, library: Library, tab: () => Tab, setTab: (tab: Tab) => void) {

  const tabButton = (id: string, name: Tab, panel: string, text: string) =>
    button(
      {
        class: "tab",
        role: "tab",
        id,
        type: "button",
        "aria-controls": panel,
        "aria-selected": () => (tab() === name ? "true" : "false"),
        on: { click: () => setTab(name) },
      },
      text,
    );

  return aside("sidebar panel", [
    div({ class: "tabs", role: "tablist" }, [
      tabButton("tabExamples", "examples", "panelExamples", "Examples"),
      tabButton("tabLibrary", "library", "panelLibrary", "Library"),
      tabButton("tabReference", "reference", "panelReference", "Reference"),
    ]),
    div(
      { class: "tab-panel", id: "panelExamples", role: "tabpanel", "aria-labelledby": "tabExamples", hidden: () => tab() !== "examples" },
      ExampleList(session, library),
    ),
    div(
      { class: "tab-panel", id: "panelLibrary", role: "tabpanel", "aria-labelledby": "tabLibrary", hidden: () => tab() !== "library" },
      [LibraryPanel(library)],
    ),
    div(
      { class: "tab-panel ref", id: "panelReference", role: "tabpanel", "aria-labelledby": "tabReference", hidden: () => tab() !== "reference" },
      [Reference(session, () => setTab("reference"))],
    ),
  ]);
}
