/**
 * The sketch library: code saved in the browser, and files to export and
 * import. Sketches are kept in IndexedDB; where it is not available (some
 * private modes), in localStorage. No DOM here except for downloads.
 */

export interface Sketch {
  id: string;
  title: string;
  code: string;
  /** Tempo in cycles per second when it was saved. */
  cps: number;
  created: number;
  updated: number;
}

/** The JSON file of an exported library. */
export interface LibraryFile {
  app: "tidaljs";
  version: 1;
  exported: string;
  sketches: Sketch[];
}

/** Where sketches are kept: "indexeddb", "localstorage", or "memory" if neither works. */
export type StorageKind = "indexeddb" | "localstorage" | "memory";

export interface Store {
  readonly kind: StorageKind;
  list(): Promise<Sketch[]>;
  put(sketch: Sketch): Promise<void>;
  remove(id: string): Promise<void>;
}

const DB_NAME = "tidaljs";
const STORE_NAME = "sketches";
const LOCAL_KEY = "tidaljs:sketches";

/** A new id: time plus randomness, unique enough for one browser. */
export function newId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/** A sketch from code, with a title from its first comment line when none is given. */
export function makeSketch(code: string, title: string, cps: number, now = Date.now()): Sketch {
  return { id: newId(), title: title.trim() || titleFromCode(code), code, cps, created: now, updated: now };
}

/** The first comment of the code ("// Bossa nova: ..." gives "Bossa nova"), or "Untitled". */
export function titleFromCode(code: string): string {
  // The first comment, skipping the editor's "Ctrl+Enter to play" hint.
  const comment = [...code.matchAll(/^\s*\/\/\s*(.+)$/gm)].map((m) => m[1]).find((text) => !/Ctrl\+Enter/i.test(text));
  if (!comment) return "Untitled";
  const text = comment.replace(/[.:]\s.*$/, "").replace(/\s+-\s+.*$/, "").replace(/[.:]$/, "").trim();
  return (text || "Untitled").slice(0, 60);
}

/** Sorts sketches with the most recently updated first. */
export function sortSketches(sketches: Sketch[]): Sketch[] {
  return sketches.slice().sort((a, b) => b.updated - a.updated);
}

/** Checks that a value looks like a sketch, filling in what is missing. Returns null if it cannot be one. */
export function normaliseSketch(value: unknown, now = Date.now()): Sketch | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Sketch>;
  if (typeof v.code !== "string") return null;
  const cps = typeof v.cps === "number" && Number.isFinite(v.cps) && v.cps > 0 ? v.cps : 0.8;
  return {
    id: typeof v.id === "string" && v.id ? v.id : newId(),
    title: typeof v.title === "string" && v.title.trim() ? v.title.trim().slice(0, 120) : titleFromCode(v.code),
    code: v.code,
    cps,
    created: typeof v.created === "number" ? v.created : now,
    updated: typeof v.updated === "number" ? v.updated : now,
  };
}

/** The JSON text of an exported library. */
export function exportLibrary(sketches: Sketch[], now = new Date()): string {
  const file: LibraryFile = { app: "tidaljs", version: 1, exported: now.toISOString(), sketches: sortSketches(sketches) };
  return JSON.stringify(file, null, 2);
}

/** The text of an exported sketch: its code, with the title and tempo as a comment if they are not in it. */
export function exportSketch(sketch: Pick<Sketch, "title" | "code" | "cps">): string {
  const header: string[] = [];
  if (titleFromCode(sketch.code) !== sketch.title) header.push("// " + sketch.title);
  if (!/setCPS|setcps|setTempo/.test(sketch.code)) header.push("setCPS(" + +sketch.cps.toFixed(3) + ")");
  return (header.length ? header.join("\n") + "\n" : "") + sketch.code.replace(/\s*$/, "\n");
}

export type ImportResult =
  | { kind: "library"; sketches: Sketch[] }
  | { kind: "code"; title: string; code: string };

/**
 * Reads an imported file: a library exported as JSON (or a single sketch,
 * or a list of sketches), or code. The file name gives code a title.
 */
export function parseImport(text: string, fileName = ""): ImportResult {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      data = undefined; // Not JSON after all: code that starts with { or [.
    }
    if (data !== undefined) {
      const list = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray((data as LibraryFile).sketches)
          ? (data as LibraryFile).sketches
          : [data];
      const sketches = list.map((x) => normaliseSketch(x)).filter((x): x is Sketch => x !== null);
      if (sketches.length === 0) throw new Error("This file has no sketches in it.");
      return { kind: "library", sketches };
    }
  }
  if (!trimmed) throw new Error("This file is empty.");
  const base = fileName.replace(/\.[^.]*$/, "").replace(/\.tidal$/, "").replace(/[-_]+/g, " ").trim();
  return { kind: "code", title: base || titleFromCode(text), code: text.replace(/\r\n/g, "\n") };
}

/**
 * Adds imported sketches to a library. One with the same id and code as a
 * saved one is skipped; one with the same id but other code gets a new id,
 * so nothing saved is overwritten. Returns the sketches to store.
 */
export function mergeImport(existing: Sketch[], imported: Sketch[]): Sketch[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const out: Sketch[] = [];
  for (const sketch of imported) {
    const same = byId.get(sketch.id);
    if (same && same.code === sketch.code) continue;
    const copy = same ? { ...sketch, id: newId() } : sketch;
    byId.set(copy.id, copy);
    out.push(copy);
  }
  return out;
}

/** A file name from a title: "Bossa nova" gives "bossa-nova". */
export function fileNameFor(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sketch";
}

/** Saves text as a file in the user's downloads. */
export function download(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------- Stores ----------------

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Sketches in IndexedDB. */
async function indexedDbStore(): Promise<Store> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is not available");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE_NAME)) open.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  return {
    kind: "indexeddb",
    list: async () => sortSketches((await request(tx("readonly").getAll())) as Sketch[]),
    put: async (sketch) => {
      await request(tx("readwrite").put(sketch));
    },
    remove: async (id) => {
      await request(tx("readwrite").delete(id));
    },
  };
}

/** Sketches in localStorage (or in memory, when even that is unavailable). */
export function localStore(storage: Storage | null = safeLocalStorage()): Store {
  let memory: Sketch[] = [];
  const read = (): Sketch[] => {
    if (!storage) return memory;
    try {
      const data = JSON.parse(storage.getItem(LOCAL_KEY) || "[]");
      return Array.isArray(data) ? data.map((x) => normaliseSketch(x)).filter((x): x is Sketch => x !== null) : [];
    } catch {
      return [];
    }
  };
  const write = (list: Sketch[]) => {
    if (!storage) {
      memory = list;
      return;
    }
    // Throws when the storage is full; the caller reports it.
    storage.setItem(LOCAL_KEY, JSON.stringify(list));
  };
  return {
    kind: storage ? "localstorage" : "memory",
    list: async () => sortSketches(read()),
    put: async (sketch) => write([...read().filter((s) => s.id !== sketch.id), sketch]),
    remove: async (id) => write(read().filter((s) => s.id !== id)),
  };
}

function safeLocalStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const probe = "tidaljs:probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/**
 * Opens the best store: IndexedDB, else localStorage. Sketches saved in
 * localStorage before IndexedDB worked are moved into it.
 */
export async function openStore(): Promise<Store> {
  try {
    const store = await indexedDbStore();
    const local = localStore();
    if (local.kind === "localstorage") {
      const old = await local.list();
      if (old.length) {
        for (const sketch of old) await store.put(sketch);
        safeLocalStorage()?.removeItem(LOCAL_KEY);
      }
    }
    return store;
  } catch {
    return localStore();
  }
}
