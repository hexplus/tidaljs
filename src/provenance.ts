/**
 * Where the code in the editor came from, and whether it may run.
 *
 * Code written here, a built-in example or a sketch saved after it ran is
 * "local". Code that someone else wrote — an imported file, a converted
 * SuperCollider file, sketches from an imported library, a song from a link —
 * is "external": it opens for review and never runs by itself (not by
 * opening it, not by a live update, not while music plays). Running it
 * gives JavaScript someone else wrote the same access to this page as
 * TidalJS, so the first Play asks for that explicitly, and the answer holds
 * only for the exact text that was shown: an edit, another document or a
 * wait for the audio to start in between makes it stale. Once that text
 * has run, the code is the person's own from then on (local).
 *
 * No DOM here: the session and the tests use it.
 */

export type Origin = "local" | "import" | "supercollider" | "library" | "shared";

export interface Provenance {
  origin: Origin;
  /** What it came from, for messages: a file name or a song title. */
  label: string;
}

export const LOCAL: Provenance = { origin: "local", label: "" };

const ORIGINS: readonly Origin[] = ["local", "import", "supercollider", "library", "shared"];

export function isExternal(p: Provenance | null | undefined): boolean {
  return !!p && p.origin !== "local";
}

/** A provenance read back from storage or a file; anything unreadable is external, never local. */
export function readProvenance(value: unknown): Provenance {
  if (value && typeof value === "object") {
    const v = value as { origin?: unknown; label?: unknown };
    const origin = ORIGINS.includes(v.origin as Origin) ? (v.origin as Origin) : "import";
    return { origin, label: typeof v.label === "string" ? v.label.slice(0, 200) : "" };
  }
  return { origin: "import", label: "" };
}

/** How a message names where external code came from. */
export function describeOrigin(p: Provenance): string {
  const what = p.label ? '"' + p.label + '"' : "this code";
  switch (p.origin) {
    case "shared": return what + " (from a link)";
    case "supercollider": return what + " (converted from SuperCollider)";
    case "library": return what + " (from an imported library)";
    case "import": return what + " (from a file)";
    default: return what;
  }
}

/**
 * A short, stable fingerprint of a text (FNV-1a over its UTF-16 units, plus
 * its length): approval is bound to it.
 */
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return text.length.toString(36) + "-" + h1.toString(36) + h2.toString(36);
}

/**
 * The approval of one external text for one document: granted for exactly
 * that text and document revision. `holds` is false as soon as either changed.
 */
export interface Approval {
  readonly revision: number;
  readonly print: string;
}

export function approve(text: string, revision: number): Approval {
  return { revision, print: fingerprint(text) };
}

export function holds(approval: Approval | null, text: string, revision: number): boolean {
  return !!approval && approval.revision === revision && approval.print === fingerprint(text);
}
