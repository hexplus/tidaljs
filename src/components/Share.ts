import { button, dialog, dispose, div, h2, input, li, p, pre, signal, span, strong, ul } from "sibujs";
import { titleFromCode } from "../library.ts";
import type { Session } from "../session.ts";
import {
  LONG_LINK_LENGTH, MAX_CODE_LENGTH, ShareError, decodeShareHash, encodeShareHash, isShareHash, revealHidden, scanCode, shareUrl,
  type CodeScan, type Finding, type SharedSong,
} from "../share.ts";
import { confirmDialog } from "./ConfirmDialog.ts";
import type { Library } from "./Library.ts";

/*
 * Sharing a song as a link, and opening one. Everything that comes from a
 * link is shown as text (text nodes and input values, never HTML), the code
 * is never run here, and the first Play of shared code goes through the
 * session's check (session.ts: checkShared).
 */

interface ModalOptions {
  title: string;
  body: Node[];
  /** The buttons; each calls `close` with its answer, or does its own thing. */
  actions: (close: (answer: string) => void) => HTMLElement[];
  /** The element to focus first (default: the primary button). */
  focus?: () => HTMLElement | null;
}

let closeOpenModal: (() => void) | null = null;
let modalCount = 0;

/**
 * A modal dialog like confirmDialog(), with any content: the page behind is
 * inert, Escape or a click outside answer "cancel", keys do not reach the
 * page's shortcuts, and focus goes back where it was.
 */
function modal(options: ModalOptions): Promise<string> {
  closeOpenModal?.();
  return new Promise((resolve) => {
    const id = "shareDialog" + ++modalCount;
    const previous = document.activeElement as HTMLElement | null;
    let settled = false;
    const finish = (answer: string) => {
      if (settled) return;
      settled = true;
      closeOpenModal = null;
      if (el.open) el.close();
      el.remove();
      dispose(el);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(answer);
    };
    const el = dialog(
      {
        class: "confirm share-dialog",
        "aria-labelledby": id + "-title",
        on: {
          cancel: (e) => {
            e.preventDefault();
            finish("cancel");
          },
          close: () => finish("cancel"),
          click: (e) => {
            if (e.target === el) finish("cancel");
          },
          // Keep keys inside: Escape must not also stop the music, Ctrl+Enter must not play.
          keydown: (e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              finish("cancel");
            }
          },
        },
      },
      [
        div("confirm-box share-box", [
          h2({ id: id + "-title", class: "confirm-title" }, [options.title]),
          ...options.body,
          div("confirm-actions", options.actions(finish)),
        ]),
      ],
    );
    closeOpenModal = () => finish("cancel");
    document.body.append(el);
    el.showModal();
    (options.focus?.() ?? el.querySelector<HTMLElement>(".confirm-actions .primary"))?.focus();
  });
}

/** A message with an OK button. */
const notice = (title: string, message: string) =>
  modal({
    title,
    body: [p("confirm-message", [message])],
    actions: (close) => [button({ class: "btn primary", type: "button", on: { click: () => close("ok") } }, "OK")],
  });

/** One finding as a line of text: "Network access: can send data... (fetch; line 3)". Hidden characters are shown, not obeyed. */
function findingText(finding: Finding): string {
  const where = finding.lines.length ? "; line" + (finding.lines.length > 1 ? "s " : " ") + finding.lines.join(", ") : "";
  return finding.title + ": " + finding.why + " (" + revealHidden(finding.words.join(", ")) + where + ")";
}

/** Asks before the first Play of shared code that the scan flags. */
function confirmRiskyPlay(scan: CodeScan): Promise<boolean> {
  return confirmDialog({
    title: "Play code that does more than music?",
    message:
      "This code came from a link and uses things a music pattern does not need. It may be harmless, but code like this "
      + "could read your saved sketches, send data to other sites or change the page.",
    details: scan.risks.map(findingText),
    note:
      "This is a quick check, not a guarantee: risky code can also go unnoticed. Play it only if you trust whoever sent "
      + "the link and you have read the code.",
    confirmText: "Play anyway",
    cancelText: "Don't play",
    danger: true,
  });
}

// ---------------- Opening a link ----------------

/** Shows a shared song for review. Nothing runs; "Open in editor" puts it in the editor. */
async function reviewShared(song: SharedSong, session: Session, library: Library) {
  const scan = scanCode(song.code);
  const lines = song.code.split("\n").length;
  const fact = (name: string, value: Node | string) => div("share-fact", [span("share-label", [name]), value]);

  const body: Node[] = [
    p("confirm-message", ["Someone shared this song with you. It came inside the link itself: nothing was uploaded or downloaded."]),
    div("share-facts", [
      fact("Title", strong("share-title", [song.title])),
      fact("Tempo", span([song.cps.toFixed(2) + " cycles per second"])),
      fact("Code", span([lines + (lines === 1 ? " line" : " lines") + ", " + song.code.length.toLocaleString() + " characters"])),
    ]),
    // The code as text; invisible and bidirectional characters are shown as ⟦U+202E⟧ so they cannot disguise it.
    pre({ class: "share-code", tabindex: "0", role: "region", "aria-label": "The shared code" }, [revealHidden(song.code)]),
  ];
  if (scan.sites.length) {
    body.push(p("confirm-message", ["Playing it may load files from: " + scan.sites.join(", ") + "."]));
  }
  if (scan.risks.length) {
    body.push(
      div({ class: "share-risks", role: "note" }, [
        strong(["Check before playing"]),
        p(["This code uses things a music pattern does not need. You will be asked again before it plays."]),
        ul(scan.risks.map((finding) => li([findingText(finding)]))),
      ]),
    );
  }
  body.push(
    p("confirm-message share-warning", [
      "This is JavaScript. When you press Play, it runs in your browser with the same access as TidalJS itself. "
      + "Opening it does not play it. Only play code from people you trust.",
    ]),
  );

  const answer = await modal({
    title: "Open a shared song?",
    body,
    actions: (close) => [
      button({ class: "btn", type: "button", on: { click: () => close("cancel") } }, "Cancel"),
      button({ class: "btn primary", type: "button", on: { click: () => close("open") } }, "Open in editor"),
    ],
  });
  if (answer !== "open") {
    session.notify("", "The shared song was not opened.");
    return;
  }
  if (!(await library.openShared(song))) session.notify("", 'Kept your code: "' + song.title + '" was not opened.');
}

/** Reads a link's fragment and shows the song, or says why it cannot be opened. */
async function openLink(hash: string, session: Session, library: Library) {
  let song: SharedSong | null;
  try {
    song = await decodeShareHash(hash);
  } catch (err) {
    const message = err instanceof ShareError ? err.message : "This link is damaged or incomplete. Ask whoever sent it for a new one.";
    await notice("This link cannot be opened", message);
    return;
  }
  if (song) await reviewShared(song, session, library);
}

/**
 * Opens a shared song from the address (`#song=...`), now and whenever the
 * fragment changes. The fragment is removed from the address bar at once,
 * before it is even read, so a reload does not open it again. Also sets the
 * confirmation the session asks for before playing risky shared code.
 * Returns a function that stops watching.
 */
export function watchSharedLinks(session: Session, library: Library): () => void {
  session.setRiskyConfirm(confirmRiskyPlay);
  const check = () => {
    const hash = location.hash;
    if (!isShareHash(hash)) return;
    try {
      history.replaceState(history.state, "", location.pathname + location.search);
    } catch {
      location.hash = "";
    }
    void openLink(hash, session, library);
  };
  check();
  window.addEventListener("hashchange", check);
  return () => window.removeEventListener("hashchange", check);
}

// ---------------- Making a link ----------------

/** Copies text, or throws when the clipboard is not available (an insecure page, a denied permission). */
async function copyText(text: string) {
  if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
  await navigator.clipboard.writeText(text);
}

/** Makes a link to the editor's song (code, title, tempo), copies it and shows it. */
export async function shareSong(session: Session, library: Library) {
  const code = session.editor.getValue();
  const title = library.title().trim() || library.current()?.title || titleFromCode(code);
  const tooLong = (detail: string) =>
    notice(
      "Too long to share as a link",
      detail + " Export it as a file instead (Sketches, then Export sketch) and send the file.",
    );

  if (!code.trim()) {
    await notice("Nothing to share", "The editor is empty. Write or open a song first.");
    return;
  }
  if (code.length > MAX_CODE_LENGTH) {
    await tooLong(
      "A link can hold up to " + MAX_CODE_LENGTH.toLocaleString() + " characters of code; this song has "
      + code.length.toLocaleString() + ".",
    );
    return;
  }
  let hash: string;
  try {
    hash = await encodeShareHash({ title, code, cps: session.tempo() });
  } catch (err) {
    if (err instanceof ShareError && (err.reason === "codeTooLong" || err.reason === "tooLong")) await tooLong(err.message);
    else await notice("The link could not be made", err instanceof Error ? err.message : String(err));
    return;
  }
  const url = shareUrl(location.href, hash);

  const [copied, setCopied] = signal<"" | "yes" | "no">("");
  const field = input({
    id: "shareLink",
    name: "shareLink",
    class: "share-link",
    type: "text",
    readonly: true,
    value: url,
    "aria-label": "Link to this song",
    "aria-describedby": "shareStatus",
    onElement: (el) => {
      el.spellcheck = false;
    },
    on: { focus: () => field.select() },
  });
  const copy = async () => {
    try {
      await copyText(url);
      setCopied("yes");
    } catch {
      setCopied("no");
      field.focus();
      field.select();
    }
  };

  const body: Node[] = [
    p("confirm-message", [
      "Anyone with this link can open the song: its title, tempo and code. The song is inside the link itself; nothing is uploaded.",
    ]),
    field,
    p({ id: "shareStatus", class: () => "share-status" + (copied() === "no" ? " warn" : ""), role: "status", "aria-live": "polite" }, [
      () =>
        copied() === "yes"
          ? "Copied. Paste the link wherever you want to share it."
          : copied() === "no"
            ? "Could not copy it automatically. The link is selected: press Ctrl+C (Cmd+C on Mac) to copy it."
            : "",
    ]),
  ];
  if (url.length > LONG_LINK_LENGTH) {
    body.push(
      p("confirm-message share-warning", [
        "This link is long (" + url.length.toLocaleString() + " characters). Some chat apps and sites cut long links; "
        + "if it does not open, export the sketch as a file instead.",
      ]),
    );
  }

  const done = modal({
    title: 'Share "' + title + '"',
    body,
    actions: (close) => [
      button({ class: "btn", type: "button", on: { click: () => close("close") } }, "Close"),
      button({ class: "btn primary", type: "button", on: { click: () => void copy() } }, "Copy link"),
    ],
  });
  void copy();
  await done;
}
