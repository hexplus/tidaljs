import {
  button, code, derived, details, div, each, effect, h3, input, kbd, label, li, mark, nextTick, onMount, p, pre, signal,
  span, strong, summary, ul, when,
} from "sibujs";
import { isWidgetKeyEvent, tabs } from "sibujs/widgets";
import { REFERENCE, REFERENCE_TOPICS } from "../data/reference.ts";
import { referenceDocs, referenceDocText, type RefDoc } from "../data/referenceDocs.ts";
import { buildReferenceIndex, excerpt, matchRanges, searchReference, suggestName, type RefEntry, type RefMatch } from "../data/referenceSearch.ts";
import type { Session } from "../session.ts";

const TOPIC_KEY = "tidaljs:referenceTopic";
/** How long typing rests before the results update. */
const DEBOUNCE_MS = 120;
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function loadTopic(): string | undefined {
  try {
    return localStorage.getItem(TOPIC_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveTopic(id: string) {
  try {
    localStorage.setItem(TOPIC_KEY, id);
  } catch {
    // Private windows and blocked storage: the tab is simply not remembered.
  }
}

const OPEN_KEY = "tidaljs:referenceOpen";

/** The titles of the sections the viewer left open. */
function loadOpenGroups(): Set<string> {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return new Set(Array.isArray(list) ? list.filter((t): t is string => typeof t === "string") : []);
  } catch {
    return new Set();
  }
}

function saveOpenGroups(open: ReadonlySet<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // Not remembered when storage is blocked.
  }
}

type Child = string | HTMLElement;

/** Text with the words of the query wrapped in <mark>, as text nodes and elements. */
function highlighted(text: string, query: string): Child[] {
  if (!query) return [text];
  const out: Child[] = [];
  let at = 0;
  for (const [start, end] of matchRanges(text, query)) {
    if (start > at) out.push(text.slice(at, start));
    out.push(mark([text.slice(start, end)]));
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Text with `backticks` turned into <code>, and the query highlighted. */
function rich(text: string, query = ""): Child[] {
  return text.split("`").flatMap((part, i) => (i % 2 ? [code(highlighted(part, query))] : highlighted(part, query)));
}

/** True when a key press belongs to a field the user is typing in. */
function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || !!el.closest?.("input, textarea, select, [contenteditable]"));
}

/**
 * The Reference tab: a search over everything, and the sections split into
 * topic tabs. `show` opens the sidebar's Reference tab (for the / and Ctrl+K
 * shortcuts).
 */
export function Reference(session: Session, show: () => void): HTMLElement {
  const index = buildReferenceIndex(REFERENCE, REFERENCE_TOPICS, referenceDocText);

  // What is typed, and the query the results follow (a moment later).
  const [typed, setTyped] = signal("");
  const [query, setQuery] = signal("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const applyNow = (value: string) => {
    clearTimeout(timer);
    setQuery(value.trim());
  };
  const type = (value: string) => {
    setTyped(value);
    clearTimeout(timer);
    if (!value.trim()) applyNow(value);
    else timer = setTimeout(() => applyNow(value), DEBOUNCE_MS);
  };
  const searching = () => query() !== "";
  const results = derived<RefMatch[]>(() => searchReference(index, query()));
  const suggestion = derived(() => (searching() && results().length === 0 ? suggestName(index, query()) : undefined));

  const searchInput = input({
    type: "search",
    id: "refSearch",
    class: "search ref-search-input",
    placeholder: "Search functions, controls, sounds…",
    autocomplete: "off",
    spellcheck: "false",
    enterkeyhint: "search",
    "aria-describedby": "refHint refCount",
    "aria-controls": "refResults",
    "aria-keyshortcuts": IS_MAC ? "/ Meta+K" : "/ Control+K",
    on: {
      input: (e) => type((e.target as HTMLInputElement).value),
      keydown: (e) => {
        if (e.key === "Escape" && typed()) {
          // Clear the search; only an Escape in an empty field reaches the page (which stops the music).
          e.preventDefault();
          e.stopPropagation();
          setSearch("");
        } else if (e.key === "Enter") {
          e.preventDefault();
          applyNow(typed());
        } else if (e.key === "ArrowDown" && searching()) {
          e.preventDefault();
          applyNow(typed());
          void nextTick().then(() => resultsList.querySelector<HTMLElement>("summary, .ref-result [tabindex]")?.focus());
        }
      },
    },
  });

  /** Sets the search text and runs it right away (a suggestion, "see also", Clear). */
  const setSearch = (text: string) => {
    searchInput.value = text;
    setTyped(text);
    applyNow(text);
  };
  const focusSearch = () => {
    searchInput.focus();
    searchInput.select();
  };
  const searchFor = (text: string) => {
    setSearch(text);
    searchInput.focus();
  };

  // ---------- One entry ----------

  /** The docs of an item, built the first time it is opened. */
  const DocBlock = ({ label: name, doc }: RefDoc, many: boolean) =>
    div({ class: "doc ref-doc" }, [
      many ? div("ref-doc-name", [code([name])]) : "",
      div("doc-about", rich(doc.about)),
      doc.example
        ? div("ref-example", [
            pre({ class: "doc-example" }, [code([doc.example])]),
            button(
              {
                type: "button",
                class: "ref-insert",
                title: "Insert the example at the cursor in the editor",
                on: { click: () => session.editor.insertSnippet({ l: name, c: doc.example!, t: doc.about }) },
              },
              ["Insert example"],
            ),
          ])
        : "",
      doc.tip ? div("doc-tip", rich(doc.tip)) : "",
      doc.see && doc.see.length
        ? div("doc-see", [
            "See also ",
            ...doc.see.flatMap((ref, i) => {
              const link = button(
                { type: "button", class: "ref-see", title: `Search for ${ref}`, on: { click: () => searchFor(ref) } },
                [code([ref])],
              );
              return i ? [", ", link] : [link];
            }),
          ])
        : "",
    ]);

  /** A paragraph or a list item. `q` gives the query to highlight ("" while browsing). */
  const Entry = (entry: RefEntry, q: () => string): HTMLElement => {
    const text = () => span(rich(entry.text, q()));
    if (entry.term === undefined) return p({ class: entry.kind === "after" ? "ref-note" : "ref-para" }, [text]);
    const term = code({ class: "ref-term" }, [() => span(highlighted(entry.term!, q()))]);
    const desc = span({ class: "ref-desc" }, [text]);
    const docs = referenceDocs({ term: entry.term, refs: entry.refs, section: entry.section });
    if (!docs.length) return div("ref-row", [term, desc]);
    const [opened, setOpened] = signal(false);
    return details(
      {
        class: "ref-entry",
        on: { toggle: (e) => (e.currentTarget as HTMLDetailsElement).open && setOpened(true) },
      },
      [
        summary({ class: "ref-row" }, [term, desc]),
        div("ref-detail", [when(() => opened(), () => div(docs.map((d) => DocBlock(d, docs.length > 1))))]),
      ],
    );
  };

  // ---------- Browsing: topic tabs ----------

  const topicTabs = tabs({
    tabs: REFERENCE_TOPICS.map((t) => ({ id: t.id, label: t.label })),
    defaultTab: loadTopic(),
  });
  effect(() => saveTopic(topicTabs.activeTab()));

  // Each section is a group that opens and closes; the open ones are remembered.
  const [openGroups, setOpenGroups] = signal<ReadonlySet<string>>(loadOpenGroups());
  effect(() => saveOpenGroups(openGroups()));
  const setGroupOpen = (title: string, open: boolean) => {
    if (openGroups().has(title) === open) return;
    const next = new Set(openGroups());
    if (open) next.add(title);
    else next.delete(title);
    setOpenGroups(next);
  };
  const setAllOpen = (titles: string[], open: boolean) => {
    const next = new Set(openGroups());
    for (const title of titles) {
      if (open) next.add(title);
      else next.delete(title);
    }
    setOpenGroups(next);
  };

  const noQuery = () => "";
  const tabEls: Record<string, HTMLElement> = {};
  const panelEls: Record<string, HTMLElement> = {};
  for (const topic of REFERENCE_TOPICS) {
    tabEls[topic.id] = button({ type: "button", class: "ref-tab", id: `refTab-${topic.id}` }, [topic.label]);
    const titles = topic.sections;
    const allOpen = () => titles.every((title) => openGroups().has(title));
    const groups = titles.map((title) => {
      const entries = index.filter((e) => e.section === title);
      const items = entries.filter((e) => e.kind === "item");
      const count = items.length || entries.length;
      return details(
        {
          class: "ref-group",
          open: () => openGroups().has(title),
          on: { toggle: (e) => setGroupOpen(title, (e.currentTarget as HTMLDetailsElement).open) },
        },
        [
          summary({ class: "ref-group-head" }, [
            h3([title]),
            span({ class: "ref-group-count" }, [String(count), span({ class: "sr-only" }, [count === 1 ? " entry" : " entries"])]),
          ]),
          div("ref-group-body", [
            ...entries.filter((e) => e.kind === "note").map((e) => Entry(e, noQuery)),
            items.length ? ul({ class: "ref-list" }, items.map((e) => li([Entry(e, noQuery)]))) : "",
            ...entries.filter((e) => e.kind === "after").map((e) => Entry(e, noQuery)),
          ]),
        ],
      );
    });
    const toolbar = div("ref-panel-tools", [
      span("ref-panel-summary", [`${titles.length} ${titles.length === 1 ? "group" : "groups"}`]),
      button(
        {
          type: "button",
          class: "ref-toggle-all",
          "aria-label": () => `${allOpen() ? "Collapse" : "Expand"} all ${topic.label} groups`,
          on: { click: () => setAllOpen(titles, !allOpen()) },
        },
        [() => (allOpen() ? "Collapse all" : "Expand all")],
      ),
    ]);
    panelEls[topic.id] = div({ class: "ref-panel", id: `refPanel-${topic.id}` }, [toolbar, ...groups]);
  }
  const tablist = div({ class: "ref-tabs", "aria-label": "Reference sections" }, REFERENCE_TOPICS.map((t) => tabEls[t.id]));
  const disposeTabs = topicTabs.bind({ tablist, tabs: tabEls, panels: panelEls });

  // ---------- Searching: results across every section ----------

  const resultsList = ul(
    { class: "ref-list ref-results-list", "aria-label": "Search results" },
    [
      each(
        () => results(),
        (match) => {
          const entry = match().entry;
          return li({ class: "ref-result" }, [
            div("ref-where", [
              entry.topic,
              span({ class: "ref-sep", "aria-hidden": "true" }, [" › "]),
              span({ class: "sr-only" }, [", "]),
              entry.section,
            ]),
            Entry(entry, query),
            when(
              () => !match().visible,
              () => p({ class: "ref-excerpt" }, [() => span(highlighted(excerpt(entry.doc, query()), query()))]),
            ),
          ]);
        },
        { key: (m) => m.entry.id },
      ),
    ],
  );

  const empty = div({ class: "ref-empty", hidden: () => !(searching() && results().length === 0) }, [
    p(["No results for “", strong([() => query()]), "”."]),
    when(
      () => suggestion(),
      () =>
        p([
          "Did you mean ",
          button({ type: "button", class: "ref-see", on: { click: () => searchFor(suggestion() ?? "") } }, [code([() => suggestion() ?? ""])]),
          "?",
        ]),
    ),
    p("ref-empty-tip", ["Try a shorter word, a function name such as ", code(["fast"]), ", ", code(["lpf"]), " or ", code(["stack"]),
      ", or browse the sections."]),
    button({ type: "button", class: "ref-clear-all", on: { click: () => searchFor("") } }, ["Clear search"]),
  ]);

  const countText = () => {
    if (!searching()) return "";
    const n = results().length;
    if (!n) return "No results";
    return `${n} ${n === 1 ? "result" : "results"} in all sections`;
  };

  // ---------- Layout ----------

  const body = div({ class: "ref-body" }, [
    div({ class: "ref-browse", hidden: () => searching() }, REFERENCE_TOPICS.map((t) => panelEls[t.id])),
    div({ class: "ref-results", id: "refResults", hidden: () => !searching() }, [
      resultsList,
      empty,
    ]),
  ]);

  // Each tab keeps its own scroll position; a new search starts at the top.
  const scroll = new Map<string, number>();
  let shown = topicTabs.activeTab();
  effect(() => {
    const next = searching() ? "search" : topicTabs.activeTab();
    if (next === shown) return;
    scroll.set(shown, body.scrollTop);
    shown = next;
    const top = next === "search" ? 0 : scroll.get(next) ?? 0;
    void nextTick().then(() => (body.scrollTop = top));
  });
  effect(() => {
    if (query()) body.scrollTop = 0;
  });

  const root = div({ class: "ref-root" }, [
    div("ref-head", [
      label({ for: "refSearch", class: "sr-only" }, ["Search the reference"]),
      div("ref-search", [
        searchInput,
        button(
          {
            type: "button",
            class: "ref-clear",
            "aria-label": "Clear search",
            title: "Clear search (Esc)",
            hidden: () => !typed(),
            on: { click: () => searchFor("") },
          },
          [span({ "aria-hidden": "true" }, ["×"])],
        ),
      ]),
      div("ref-status", [
        p({ class: "hint ref-hint", id: "refHint", hidden: () => searching() }, [
          span("ref-keys", ["Press ", kbd(["/"]), " or ", kbd([IS_MAC ? "⌘K" : "Ctrl+K"]), " to search. "]),
          "Open an entry for details and an example.",
        ]),
        p({ class: "hint ref-count", id: "refCount", role: "status" }, [() => countText()]),
      ]),
      div({ class: "ref-tabs-wrap", hidden: () => searching() }, [tablist]),
    ]),
    body,
  ]);

  // "/" or Ctrl+K (Cmd+K) opens the Reference and focuses the search, unless the user is typing somewhere.
  const onKeydown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isWidgetKeyEvent(e) || e.altKey || inTextField(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const slash = e.key === "/" && !mod;
    const commandK = mod && !e.shiftKey && e.key.toLowerCase() === "k";
    if (!slash && !commandK) return;
    e.preventDefault();
    show();
    void nextTick().then(focusSearch);
  };
  onMount(() => {
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("keydown", onKeydown);
      clearTimeout(timer);
      disposeTabs();
    };
  }, root);

  return root;
}
