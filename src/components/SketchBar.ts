import { button, div, each, onMount, p, span, when } from "sibujs";
import { popover } from "sibujs/widgets";
import type { Session } from "../session.ts";
import type { Library } from "./Library.ts";
import { shareSong } from "./Share.ts";

const RECENT = 5;

/**
 * The open sketch in the top bar: its name, Save (Ctrl+S) and a Sketches menu
 * with new, save as copy, share as a link, the recent sketches, export and import.
 */
export function SketchBar(library: Library, showLibrary: () => void, session: Session) {
  const { current, dirty, sketches } = library;
  const menu = popover();

  /** Runs a menu action and closes the menu. */
  const act = (fn: () => void) => () => {
    menu.close();
    fn();
  };

  const item = (text: string, hint: string, fn: () => void, disabled?: () => boolean) =>
    button(
      { class: "menu-item", type: "button", title: hint, disabled: disabled ?? false, on: { click: act(fn) } },
      text,
    );

  const trigger = button(
    { class: "btn", type: "button", title: "Your saved sketches, sharing, export and import" },
    ["Sketches ", span({ class: "caret", "aria-hidden": "true" }, "▾")],
  );

  const panel = div({ class: "sketch-menu", hidden: true }, [
    item("New sketch", "Start an empty sketch", () => void library.newSketch()),
    item("Save as a copy", "Save the editor's code as a new sketch", () => void library.save(true), () => !current()),
    item("Share as a link…", "Copy a link with the song's code, title and tempo inside it", () => void shareSong(session, library)),
    div({ class: "menu-sep", role: "separator" }),
    p({ class: "menu-label" }, "Recent"),
    each(
      () => sketches().slice(0, RECENT),
      (sketch) =>
        button(
          {
            class: () => "menu-item recent" + (current()?.id === sketch().id ? " open" : ""),
            type: "button",
            title: "Open in the editor",
            on: { click: act(() => void library.open(sketch())) },
          },
          [() => sketch().title],
        ),
      { key: (s) => s.id + ":" + s.updated },
    ),
    when(() => sketches().length === 0, () => p({ class: "menu-empty" }, "Nothing saved yet.")),
    item("All sketches…", "Show the library in the sidebar", showLibrary),
    div({ class: "menu-sep", role: "separator" }),
    item("Export sketch (.js)", "Download the editor's code as a .js file", library.exportCurrent),
    item("Export all (.json)", "Download every saved sketch as one .json file", library.exportAll),
    item("Import file…", "Open a .js or .txt file, or add the sketches of a .json library", () => library.chooseFile()),
    item("Import SuperCollider (.scd) (alpha)…", "Convert a SuperCollider file to TidalJS code (alpha). Random durations with rests between notes are approximated", library.chooseSuperCollider),
  ]);

  const root = div({ class: "sketchbar", role: "group", "aria-label": "Sketch" }, [
    span(
      {
        class: () => "sketch-name" + (dirty() ? " dirty" : ""),
        title: () => (current() ? (dirty() ? "Changes not saved" : "Saved in this browser") : "Not saved yet: press Save"),
      },
      [
        span({ class: "sketch-dot", "aria-hidden": "true" }),
        span("sketch-name-text", [() => current()?.title ?? "Unsaved sketch"]),
      ],
    ),
    button(
      {
        id: "saveBtn",
        class: () => "btn" + (dirty() ? " save-needed" : ""),
        type: "button",
        title: "Save the editor's code in this browser (Ctrl+S)",
        on: { click: () => void library.save() },
      },
      () => (current() && !dirty() ? "Saved" : "Save"),
    ),
    div("menu-wrap", [trigger, panel]),
  ]);

  onMount(() => menu.bind({ trigger, popover: panel }), root);
  return root;
}
