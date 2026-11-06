import { aside, button, code, dd, derived, div, dl, dt, each, h3, input, p, signal, strong, when } from "sibujs";
import { EXAMPLES, type Example } from "../data/examples.ts";
import { REFERENCE } from "../data/reference.ts";
import type { Session } from "../session.ts";

type Tab = "examples" | "reference";

/** Text with `backticks` turned into <code> elements. */
function rich(text: string): (string | HTMLElement)[] {
  return text.split("`").map((part, i) => (i % 2 ? code(part) : part));
}

/** The examples, filtered, with a heading before each group. */
function ExampleList(session: Session) {
  const [query, setQuery] = signal("");

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
          return button({ class: "example", type: "button", on: { click: () => session.loadExample(example) } }, [
            strong(example.title),
            code({ class: clamped ? "clamped" : "" }, example.code),
          ]);
        },
        { key: (row) => row.key },
      ),
      when(() => rows().length === 0, () => p({ class: "empty" }, "No examples match.")),
    ]),
  ];
}

/** The Reference tab content. */
function Reference() {
  const children: HTMLElement[] = [];
  for (const section of REFERENCE) {
    children.push(h3(section.title));
    for (const note of section.notes ?? []) children.push(p(rich(note)));
    if (section.items) {
      children.push(dl(section.items.flatMap(([term, description]) => [dt(term), dd(rich(description))])));
    }
    if (section.after) children.push(p({ class: "ref-note" }, rich(section.after)));
  }
  return children;
}

/** Examples and Reference, as tabs. */
export function Sidebar(session: Session) {
  const [tab, setTab] = signal<Tab>("examples");

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
      tabButton("tabReference", "reference", "panelReference", "Reference"),
    ]),
    div(
      { class: "tab-panel", id: "panelExamples", role: "tabpanel", "aria-labelledby": "tabExamples", hidden: () => tab() !== "examples" },
      ExampleList(session),
    ),
    div(
      { class: "tab-panel ref", id: "panelReference", role: "tabpanel", "aria-labelledby": "tabReference", hidden: () => tab() !== "reference" },
      Reference(),
    ),
  ]);
}
