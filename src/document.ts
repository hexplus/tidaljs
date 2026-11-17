/**
 * The editor's document as kept in this browser between visits: its code,
 * where it came from (see provenance.ts), an identity, and its tempo (the
 * draft tempo, which playback takes only when the code runs successfully).
 * All of it is written together, as one record, so a reload can never pair
 * code with another document's provenance (external code restored as
 * local). No DOM here.
 */
import { DEFAULT_CODE } from "./data/examples.ts";
import { LOCAL, isExternal, readProvenance, type Provenance } from "./provenance.ts";

export const DOCUMENT_KEY = "tidaljs:document";
/** Older, separate records: the code, and (briefly) its provenance or a "shared, not played yet" flag. */
export const LEGACY_KEYS = { code: "tidaljs:code", provenance: "tidaljs:provenance", shared: "tidaljs:sharedUnplayed" };

export interface StoredDocument {
  code: string;
  provenance: Provenance;
  /** Changes whenever another document is put in the editor; typing keeps it. */
  id: string;
  /** The document's tempo in cycles per second, or null when none was stored. */
  cps: number | null;
}

export function newDocumentId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function serializeDocument(doc: StoredDocument): string {
  return JSON.stringify({ v: 2, code: doc.code, provenance: doc.provenance, id: doc.id, cps: doc.cps });
}

/** What writeDocument needs of a Storage. */
export interface DocumentStorage {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Writes the document. The older records are removed only after the new one
 * is written: if writing fails (the storage is full or refused), they stay,
 * and a reload reads them as before (conservatively, see readDocument).
 * Returns whether the document was written.
 */
export function writeDocument(storage: DocumentStorage | null, doc: StoredDocument): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DOCUMENT_KEY, serializeDocument(doc));
  } catch {
    return false;
  }
  for (const key of Object.values(LEGACY_KEYS)) {
    try {
      storage.removeItem(key);
    } catch {
      /* removing is best effort: a snapshot, once written, is what is read */
    }
  }
  return true;
}

const tempoOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

/**
 * The document to restore. A snapshot is used as it is (an empty draft stays
 * empty). Without one, the older records are read conservatively: code with
 * a separate provenance record cannot be known to match it, so unless that
 * record already says external, the code is treated as external too (it is
 * asked about before it first runs). Code with no provenance record at all
 * predates provenance and is the person's own. Nothing stored: the starting code.
 */
export function readDocument(get: (key: string) => string | null): StoredDocument {
  const text = get(DOCUMENT_KEY);
  if (text) {
    try {
      const v = JSON.parse(text);
      if (v && typeof v === "object" && typeof v.code === "string") {
        return {
          code: v.code,
          provenance: v.provenance === undefined ? readProvenance(null) : readProvenance(v.provenance),
          id: typeof v.id === "string" && v.id ? v.id : newDocumentId(),
          // Version 1 kept only the tempo an external song brought (pendingCps).
          cps: tempoOf(v.cps) ?? tempoOf(v.pendingCps),
        };
      }
    } catch {
      /* unreadable: below, as if absent */
    }
  }
  const code = get(LEGACY_KEYS.code);
  if (code === null) return { code: DEFAULT_CODE, provenance: LOCAL, id: newDocumentId(), cps: null };
  let provenance: Provenance = LOCAL;
  const legacy = get(LEGACY_KEYS.provenance);
  if (legacy !== null) {
    let read: Provenance;
    try {
      read = readProvenance(JSON.parse(legacy));
    } catch {
      read = readProvenance(null);
    }
    provenance = isExternal(read) ? read : { origin: "import", label: "a draft restored from an earlier visit" };
  } else if (get(LEGACY_KEYS.shared) === "1") {
    provenance = { origin: "shared", label: "" };
  }
  return { code, provenance, id: newDocumentId(), cps: null };
}
