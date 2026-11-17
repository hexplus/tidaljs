/**
 * The editor's draft against what it was opened or saved as: code, title and
 * tempo. Anything that would replace the draft (opening a sketch, even the
 * same one again, loading an example, importing, opening a shared song,
 * starting a new sketch) asks first when the draft differs from that
 * baseline. No DOM here: the library and the tests use it.
 */

export interface Draft {
  code: string;
  title: string;
  /** Tempo in cycles per second. */
  cps: number;
}

/** True when the code sets its own tempo: then the tempo field is not part of the draft. */
export function setsTempo(code: string): boolean {
  return /setCPS|setcps|setTempo|setbpm/.test(code);
}

/** True when `now` differs from `baseline` in code, title, or (for code that does not set it) tempo. */
export function differs(now: Draft, baseline: Draft): boolean {
  if (now.code !== baseline.code) return true;
  if (now.title.trim() !== baseline.title.trim()) return true;
  return !setsTempo(now.code) && Math.abs(now.cps - baseline.cps) > 1e-6;
}

/** What is kept in this browser between visits: the baseline and the open sketch's id. */
export interface DraftState {
  baseline: Draft;
  title: string;
  cps: number;
  sketchId: string | null;
  /** The document it belongs to (see document.ts); state for another document is not used. */
  documentId: string | null;
}

/** A draft state read back from storage; null when there is none or it is unreadable. */
export function readDraftState(text: string | null): DraftState | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    const b = v && v.baseline;
    if (!b || typeof b.code !== "string" || typeof b.title !== "string" || typeof b.cps !== "number") return null;
    return {
      baseline: { code: b.code, title: b.title, cps: b.cps },
      title: typeof v.title === "string" ? v.title : b.title,
      cps: typeof v.cps === "number" && Number.isFinite(v.cps) && v.cps > 0 ? v.cps : b.cps,
      sketchId: typeof v.sketchId === "string" ? v.sketchId : null,
      documentId: typeof v.documentId === "string" ? v.documentId : null,
    };
  } catch {
    return null;
  }
}
