import { button, derived, div, each, effect, input, p, signal, span, strong, when } from "sibujs";
import {
  download, exportLibrary, exportSketch, fileNameFor, makeSketch, markImported, mergeImport, openStore, parseImportAsync, titleFromCode,
  type Sketch, type StorageKind, type Store,
} from "../library.ts";
import { confirmDialog } from "./ConfirmDialog.ts";
import { DEFAULT_CODE, type Example } from "../data/examples.ts";
import { differs, readDraftState, type Draft, type DraftState } from "../drafts.ts";
import { LOCAL, isExternal, type Provenance } from "../provenance.ts";
import type { Session } from "../session.ts";
import type { SharedSong } from "../share.ts";

export type Library = ReturnType<typeof createLibrary>;

const STORAGE_TEXT: Record<StorageKind, string> = {
  indexeddb: "Saved in this browser (IndexedDB).",
  localstorage: "Saved in this browser (localStorage).",
  memory: "This browser does not allow saving: sketches last until you close the page. Export them to keep them.",
};

const DRAFT_KEY = "tidaljs:draft";

function readStoredDraft(): DraftState | null {
  try {
    return readDraftState(localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
}

/** The saved sketches and the actions on them: save, open, rename, delete, export and import. */
export function createLibrary(session: Session, storeSource?: Promise<Store>) {
  const { editor } = session;
  const [sketches, setSketches] = signal<Sketch[]>([]);
  const [current, setCurrent] = signal<Sketch | null>(null);
  // The stored title, baseline and open sketch, only if they belong to the restored document: state
  // written for another document (or by an older version, without an identity) is not trusted, so the
  // draft then counts as unsaved.
  const storedState = readStoredDraft();
  const stored = storedState && storedState.documentId === session.documentId() ? storedState : null;
  const [title, setTitle] = signal(stored?.title ?? "");
  const [kind, setKind] = signal<StorageKind | null>(null);
  const storePromise: Promise<Store> = storeSource ?? openStore();

  /**
   * What the draft was opened or saved as (code, title, tempo): replacing a
   * draft that differs from it asks first (see drafts.ts). Without a stored
   * one, the starting code is the baseline, so a draft left from an older
   * version counts as unsaved.
   */
  const [baseline, setBaseline] = signal<Draft>(stored?.baseline ?? { code: DEFAULT_CODE, title: "", cps: session.tempo() });
  const draftNow = (): Draft => ({ code: editor.getValue(), title: title(), cps: session.tempo() });
  const markBaseline = (draft: Draft) => setBaseline({ ...draft });

  /** True when the draft differs from what it was opened or saved as. */
  const dirty = derived(() => {
    session.edits();
    return differs(draftNow(), baseline());
  });

  // The baseline, title, tempo and open sketch outlive a reload, with the code (kept by the session).
  effect(() => {
    const state: DraftState = {
      baseline: baseline(), title: title(), cps: session.tempo(), sketchId: current()?.id ?? null, documentId: session.documentId(),
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  });

  const fail = (what: string, err: unknown) =>
    session.notify("error", what + ": " + (err instanceof Error ? err.message : String(err)));

  async function refresh() {
    const store = await storePromise;
    setKind(store.kind);
    setSketches(await store.list());
  }
  const restoringFor = session.documentId();
  void refresh()
    .then(() => {
      // The sketch that was open before the reload is open again, unless another document was put
      // in the editor while the library loaded: a late answer never reattaches an old sketch.
      if (session.documentId() !== restoringFor) return;
      if (stored?.sketchId && !current()) setCurrent(sketches().find((s) => s.id === stored.sketchId) ?? null);
    })
    .catch((err) => fail("Could not read the library", err));

  /** Saves the editor's code: over the open sketch, or as a new one. Code that has not run keeps its provenance. */
  async function save(asNew = false) {
    // Everything is read now, before anything is awaited: the document saved is the one in the editor
    // when Save was pressed.
    const documentAtSave = session.documentId();
    const code = editor.getValue();
    const name = title().trim();
    const open = current();
    const base: Sketch = open && !asNew
      ? { ...open, code, cps: session.tempo(), title: name || open.title, updated: Date.now() }
      : makeSketch(code, name, session.tempo());
    const from = session.provenance();
    const sketch: Sketch = { ...base };
    if (isExternal(from)) sketch.provenance = from;
    else delete sketch.provenance;
    try {
      const store = await storePromise;
      await store.put(sketch);
      // If another document was opened meanwhile, it does not become this sketch: its next Save
      // still goes where it should, and its unsaved changes stay unsaved.
      if (session.documentId() === documentAtSave) {
        setCurrent(sketch);
        setTitle(sketch.title);
        markBaseline({ code: sketch.code, title: sketch.title, cps: sketch.cps });
      }
      await refresh();
      session.notify("", 'Saved "' + sketch.title + '".');
    } catch (err) {
      fail("Could not save", err);
    }
  }

  /**
   * Asks before replacing a draft that differs from what it was opened or
   * saved as. Resolves true when the draft may be replaced.
   */
  async function mayReplace(question: string, confirmText: string): Promise<boolean> {
    if (!dirty()) return true;
    return confirmDialog({
      title: question,
      message: "The changes in the editor (code, title or tempo) are not saved and will be lost. Save first if you want to keep them.",
      confirmText,
      cancelText: "Keep my changes",
      danger: true,
    });
  }

  async function open(sketch: Sketch) {
    const again = current()?.id === sketch.id;
    if (!(await mayReplace((again ? 'Reopen "' : 'Open "') + sketch.title + '"?', again ? "Discard and reopen" : "Discard and open"))) return;
    setCurrent(sketch);
    setTitle(sketch.title);
    markBaseline({ code: sketch.code, title: sketch.title, cps: sketch.cps });
    session.openCode(sketch.code, sketch.title, sketch.cps, sketch.provenance ?? LOCAL);
  }

  /** Loads an example from the list as a new, unsaved sketch. */
  async function loadExample(example: Example) {
    if (!(await mayReplace('Load "' + example.title + '"?', "Discard and load"))) return;
    setCurrent(null);
    setTitle("");
    session.loadExample(example);
    markBaseline(draftNow());
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
    const sure = await confirmDialog({
      title: 'Delete "' + sketch.title + '"?',
      message: "It is removed from this browser for good. Export it first if you want to keep a copy.",
      confirmText: "Delete",
      danger: true,
    });
    if (!sure) return;
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

  /**
   * Opens a song from a shared link in the editor, as a new unsaved sketch.
   * Asks first when that would lose code nobody saved: not for an empty
   * editor, the starting code or an unchanged example. Never saves anything.
   * Resolves false when the person keeps their code.
   */
  async function openShared(song: SharedSong): Promise<boolean> {
    if (!(await mayReplace('Replace the editor\'s code with "' + song.title + '"?', "Replace it"))) return false;
    setCurrent(null);
    setTitle(song.title);
    session.openSharedCode(song.code, song.title, song.cps);
    markBaseline({ code: song.code, title: song.title, cps: session.tempo() });
    return true;
  }

  /** Starts an empty sketch. */
  async function newSketch() {
    if (!(await mayReplace("Start a new sketch?", "Discard and start"))) return;
    setCurrent(null);
    setTitle("");
    session.openCode("", "a new sketch");
    markBaseline(draftNow());
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
      const result = await parseImportAsync(await file.text(), file.name);
      if (result.kind === "code") {
        if (!(await mayReplace('Open "' + file.name + '"?', "Discard and open"))) return;
        setCurrent(null);
        setTitle(result.title);
        // Someone else's code: it opens for review and runs only after a Play that allows it.
        const from: Provenance = { origin: result.from === "supercollider" ? "supercollider" : "import", label: file.name };
        session.openCode(result.code, result.title, undefined, from);
        markBaseline(draftNow());
        if (result.from === "supercollider") {
          session.notify("warn", result.parts
            ? 'Converted "' + file.name + '" from SuperCollider: ' + result.parts + " part" + (result.parts === 1 ? "" : "s")
              + ". Notes on the conversion are at the top of the code. It has not run: read it, then press Play."
            : 'Converted "' + file.name + '", but nothing in it plays: see the notes at the top of the code.');
        } else {
          session.notify("warn", 'Opened "' + file.name + '" for review. It has not run: read it, then press Play to run it.');
        }
        return;
      }
      const store = await storePromise;
      const added = mergeImport(sketches(), markImported(result.sketches, file.name));
      for (const sketch of added) await store.put(sketch);
      await refresh();
      const skipped = result.sketches.length - added.length;
      session.notify("", "Imported " + added.length + " sketch" + (added.length === 1 ? "" : "es")
        + (skipped ? " (" + skipped + " already in the library)" : "") + ".");
    } catch (err) {
      fail('Could not import "' + file.name + '"', err);
    }
  }

  /** Opens the file picker; `accept` narrows it (SuperCollider files only, for the SuperCollider item). */
  function chooseFile(accept = ".js,.tidal,.txt,.json,.scd,.sc,text/plain,application/json,text/javascript") {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = accept;
    picker.onchange = () => {
      const file = picker.files?.[0];
      if (file) void importFile(file);
    };
    picker.click();
  }

  return {
    sketches, current, title, setTitle, kind, dirty,
    save, open, openShared, loadExample, rename, remove, newSketch, exportCurrent, exportAll, importFile, chooseFile,
    chooseSuperCollider: () => chooseFile(".scd,.sc,.txt,text/plain"),
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
        { class: "sketch-code", type: "button", title: "Open in the editor", on: { click: () => void library.open(sketch()) } },
        [() => sketch().code.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).slice(0, 3).join("\n") || "(empty)"],
      ),
      div("sketch-actions", [
        button({ class: "link-btn", type: "button", on: { click: () => void library.open(sketch()) } }, "Open"),
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
          button({ class: "btn small", type: "button", title: "Start an empty sketch", on: { click: () => void library.newSketch() } }, "New"),
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
          button({ class: "btn small", type: "button", title: "Open a .js or .txt file, or add the sketches of a .json library", on: { click: () => library.chooseFile() } }, "Import"),
          button({ class: "btn small", type: "button", title: "Convert a SuperCollider file (.scd) to TidalJS code (alpha: not everything converts yet)", on: { click: library.chooseSuperCollider } }, "Import .scd (alpha)"),
        ]),
        p({ class: "hint" }, "Import a .js file to open it, a library .json to add its sketches, or a SuperCollider .scd file to convert it. You can also drop a file here."),
      ]),
    ],
  );
}
