import { button, derived, div, each, effect, input, p, signal, span, strong, when } from "sibujs";
import {
  download, exportLibrary, exportSketch, fileNameFor, makeSketch, mergeImport, openStore, parseImport, titleFromCode,
  type Sketch, type StorageKind, type Store,
} from "../library.ts";
import type { Session } from "../session.ts";

export type Library = ReturnType<typeof createLibrary>;

const STORAGE_TEXT: Record<StorageKind, string> = {
  indexeddb: "Saved in this browser (IndexedDB).",
  localstorage: "Saved in this browser (localStorage).",
  memory: "This browser does not allow saving: sketches last until you close the page. Export them to keep them.",
};

/** The saved sketches and the actions on them: save, open, rename, delete, export and import. */
export function createLibrary(session: Session) {
  const { editor } = session;
  const [sketches, setSketches] = signal<Sketch[]>([]);
  const [current, setCurrent] = signal<Sketch | null>(null);
  const [title, setTitle] = signal("");
  const [kind, setKind] = signal<StorageKind | null>(null);
  const storePromise: Promise<Store> = openStore();

  /** True when the editor's code differs from the open sketch (or nothing is saved yet). */
  const dirty = derived(() => {
    session.edits();
    const open = current();
    return !open || editor.getValue() !== open.code;
  });

  // An example loaded from the list is a new sketch: forget the open one and its title.
  effect(() => {
    if (session.examplesLoaded() === 0) return;
    setCurrent(null);
    setTitle("");
  });

  const fail = (what: string, err: unknown) =>
    session.notify("error", what + ": " + (err instanceof Error ? err.message : String(err)));

  async function refresh() {
    const store = await storePromise;
    setKind(store.kind);
    setSketches(await store.list());
  }
  void refresh().catch((err) => fail("Could not read the library", err));

  /** Saves the editor's code: over the open sketch, or as a new one. */
  async function save(asNew = false) {
    try {
      const store = await storePromise;
      const code = editor.getValue();
      const name = title().trim();
      const open = current();
      const sketch: Sketch = open && !asNew
        ? { ...open, code, cps: session.tempo(), title: name || open.title, updated: Date.now() }
        : makeSketch(code, name, session.tempo());
      await store.put(sketch);
      setCurrent(sketch);
      setTitle(sketch.title);
      await refresh();
      session.notify("", 'Saved "' + sketch.title + '".');
    } catch (err) {
      fail("Could not save", err);
    }
  }

  function open(sketch: Sketch) {
    if (dirty() && current() && current()!.id !== sketch.id && !confirm("Open \"" + sketch.title + "\"? Changes not saved in the editor will be lost.")) return;
    setCurrent(sketch);
    setTitle(sketch.title);
    session.openCode(sketch.code, sketch.title, sketch.cps);
  }

  async function rename(sketch: Sketch, name: string) {
    const text = name.trim();
    if (!text || text === sketch.title) return;
    try {
      const store = await storePromise;
      const renamed = { ...sketch, title: text, updated: Date.now() };
      await store.put(renamed);
      if (current()?.id === sketch.id) {
        setCurrent(renamed);
        setTitle(text);
      }
      await refresh();
    } catch (err) {
      fail("Could not rename", err);
    }
  }

  async function remove(sketch: Sketch) {
    if (!confirm('Delete "' + sketch.title + '"? Export it first if you want to keep a copy.')) return;
    try {
      const store = await storePromise;
      await store.remove(sketch.id);
      if (current()?.id === sketch.id) setCurrent(null);
      await refresh();
      session.notify("", 'Deleted "' + sketch.title + '".');
    } catch (err) {
      fail("Could not delete", err);
    }
  }

  /** Starts an empty sketch. */
  function newSketch() {
    if (dirty() && editor.getValue().trim() && !confirm("Start a new sketch? Changes not saved in the editor will be lost.")) return;
    setCurrent(null);
    setTitle("");
    session.openCode("", "a new sketch");
  }

  function exportCurrent() {
    const code = editor.getValue();
    const name = title().trim() || current()?.title || titleFromCode(code);
    download(exportSketch({ title: name, code, cps: session.tempo() }), fileNameFor(name) + ".js", "text/javascript");
    session.notify("", 'Exported "' + name + '" to your downloads.');
  }

  function exportAll() {
    const list = sketches();
    if (!list.length) {
      session.notify("warn", "The library is empty: save a sketch first.");
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    download(exportLibrary(list), "tidaljs-library-" + date + ".json", "application/json");
    session.notify("", "Exported " + list.length + " sketch" + (list.length === 1 ? "" : "es") + " to your downloads.");
  }

  /** Imports a file: a library JSON adds its sketches; code opens in the editor. */
  async function importFile(file: File) {
    try {
      if (file.size > 5_000_000) throw new Error("the file is larger than 5 MB");
      const result = parseImport(await file.text(), file.name);
      if (result.kind === "code") {
        if (dirty() && editor.getValue().trim() && !confirm('Open "' + file.name + '"? Changes not saved in the editor will be lost.')) return;
        setCurrent(null);
        setTitle(result.title);
        session.openCode(result.code, result.title);
        session.notify("", 'Opened "' + file.name + '". Press Save to keep it in the library.');
        return;
      }
      const store = await storePromise;
      const added = mergeImport(sketches(), result.sketches);
      for (const sketch of added) await store.put(sketch);
      await refresh();
      const skipped = result.sketches.length - added.length;
      session.notify("", "Imported " + added.length + " sketch" + (added.length === 1 ? "" : "es")
        + (skipped ? " (" + skipped + " already in the library)" : "") + ".");
    } catch (err) {
      fail('Could not import "' + file.name + '"', err);
    }
  }

  /** Opens the file picker. */
  function chooseFile() {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".js,.tidal,.txt,.json,text/plain,application/json,text/javascript";
    picker.onchange = () => {
      const file = picker.files?.[0];
      if (file) void importFile(file);
    };
    picker.click();
  }

  return {
    sketches, current, title, setTitle, kind, dirty,
    save, open, rename, remove, newSketch, exportCurrent, exportAll, importFile, chooseFile,
  };
}

const dateText = (time: number) => {
  const d = new Date(time);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
};

/** The Library tab: save the editor's code, the saved sketches, export and import. */
export function LibraryPanel(library: Library) {
  const { sketches, current, title, setTitle, dirty } = library;
  const [dragging, setDragging] = signal(false);

  const titleField = input({
    id: "sketchTitle",
    class: "search",
    type: "text",
    placeholder: "Title (from the first comment if empty)",
    "aria-label": "Sketch title",
    value: () => title(),
    on: {
      input: (e) => setTitle((e.target as HTMLInputElement).value),
      keydown: (e) => {
        if (e.key === "Enter") void library.save();
      },
    },
  });

  const row = (sketch: () => Sketch) => {
    const isOpen = () => current()?.id === sketch().id;
    const name = input({
      class: "sketch-title",
      type: "text",
      "aria-label": "Title",
      value: () => sketch().title,
      title: "Click to rename",
      on: {
        change: (e) => void library.rename(sketch(), (e.target as HTMLInputElement).value),
        keydown: (e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            (e.target as HTMLInputElement).value = sketch().title;
            (e.target as HTMLInputElement).blur();
          }
        },
      },
    });
    return div({ class: () => "sketch" + (isOpen() ? " open" : "") }, [
      div("sketch-head", [
        name,
        span("sketch-date", [() => (isOpen() && dirty() ? "edited" : dateText(sketch().updated))]),
      ]),
      button(
        { class: "sketch-code", type: "button", title: "Open in the editor", on: { click: () => library.open(sketch()) } },
        [() => sketch().code.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).slice(0, 3).join("\n") || "(empty)"],
      ),
      div("sketch-actions", [
        button({ class: "link-btn", type: "button", on: { click: () => library.open(sketch()) } }, "Open"),
        button({
          class: "link-btn",
          type: "button",
          on: {
            click: () => download(exportSketch(sketch()), fileNameFor(sketch().title) + ".js", "text/javascript"),
          },
        }, "Export"),
        button({ class: "link-btn danger", type: "button", on: { click: () => void library.remove(sketch()) } }, "Delete"),
      ]),
    ]);
  };

  return div(
    {
      class: () => "library" + (dragging() ? " dragging" : ""),
      on: {
        dragover: (e) => {
          e.preventDefault();
          setDragging(true);
        },
        dragleave: () => setDragging(false),
        drop: (e) => {
          e.preventDefault();
          setDragging(false);
          const file = (e as DragEvent).dataTransfer?.files?.[0];
          if (file) void library.importFile(file);
        },
      },
    },
    [
      div("library-save", [
        titleField,
        div("library-buttons", [
          button({
            class: "btn small primary",
            type: "button",
            title: "Save the editor's code (Ctrl+S)",
            on: { click: () => void library.save() },
          }, [() => (current() ? (dirty() ? "Save changes" : "Saved") : "Save")]),
          when(() => !!current(), () => button({
            class: "btn small",
            type: "button",
            title: "Save as a new sketch",
            on: { click: () => void library.save(true) },
          }, "Save as new")),
          button({ class: "btn small", type: "button", title: "Start an empty sketch", on: { click: library.newSketch } }, "New"),
        ]),
      ]),
      p({ class: "hint" }, [() => (library.kind() ? STORAGE_TEXT[library.kind()!] : "Opening the library...")]),
      div({ id: "sketchList" }, [
        each(() => sketches(), row, { key: (s) => s.id + ":" + s.updated }),
        when(() => sketches().length === 0, () => p({ class: "empty" }, [
          "No saved sketches yet. Press Save (or Ctrl+S) to keep the code in the editor, or import a file.",
        ])),
      ]),
      div("library-files", [
        strong("Files"),
        div("library-buttons", [
          button({ class: "btn small", type: "button", title: "Download the editor's code as a .js file", on: { click: library.exportCurrent } }, "Export sketch"),
          button({ class: "btn small", type: "button", title: "Download every saved sketch as one .json file", on: { click: library.exportAll } }, "Export all"),
          button({ class: "btn small", type: "button", title: "Open a .js or .txt file, or add the sketches of a .json library", on: { click: library.chooseFile } }, "Import"),
        ]),
        p({ class: "hint" }, "Import a .js file to open it, or a library .json to add its sketches. You can also drop a file here."),
      ]),
    ],
  );
}
