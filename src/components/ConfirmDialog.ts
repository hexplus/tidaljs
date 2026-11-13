import { button, dialog, dispose, div, h2, p } from "sibujs";

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Text of the button that goes ahead. */
  confirmText: string;
  cancelText?: string;
  /** A destructive action: the button is red and Cancel takes the focus. */
  danger?: boolean;
}

let closeOpen: (() => void) | null = null;

/**
 * Asks for confirmation in a styled modal dialog, in place of the browser's
 * confirm(). Resolves true when the action is confirmed; Escape, Cancel or a
 * click outside resolve false.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  closeOpen?.(); // only one at a time: a new question cancels the previous one

  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      closeOpen = null;
      if (el.open) el.close();
      el.remove();
      dispose(el);
      resolve(answer);
    };

    const cancel = button(
      { class: "btn", type: "button", autofocus: !!options.danger, on: { click: () => finish(false) } },
      options.cancelText ?? "Cancel",
    );
    const ok = button(
      {
        class: "btn " + (options.danger ? "danger" : "primary"),
        type: "button",
        autofocus: !options.danger,
        on: { click: () => finish(true) },
      },
      options.confirmText,
    );

    const el = dialog(
      {
        class: "confirm",
        "aria-labelledby": "confirmTitle",
        "aria-describedby": "confirmMessage",
        on: {
          // Escape (the dialog's cancel) and closing by any other means answer no.
          cancel: (e) => {
            e.preventDefault();
            finish(false);
          },
          close: () => finish(false),
          // A click on the backdrop lands on the <dialog> itself, outside the box.
          click: (e) => {
            if (e.target === el) finish(false);
          },
          // Keep keys inside: Escape must not also stop the music, Ctrl+S must not save.
          keydown: (e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              finish(false);
            }
          },
        },
      },
      [
        div("confirm-box", [
          h2({ id: "confirmTitle", class: "confirm-title" }, options.title),
          p({ id: "confirmMessage", class: "confirm-message" }, options.message),
          div("confirm-actions", [cancel, ok]),
        ]),
      ],
    );

    closeOpen = () => finish(false);
    document.body.append(el);
    el.showModal();
    (options.danger ? cancel : ok).focus();
  });
}
