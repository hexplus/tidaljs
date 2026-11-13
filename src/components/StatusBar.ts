import { div, span, when } from "sibujs";
import type { Session } from "../session.ts";

/**
 * One line telling what went wrong: errors and warnings only. Confirmations
 * ("Playing 10 patterns.", "Saved ...") are not shown; the Play button and
 * the cycle view already say what is playing.
 */
export function StatusBar(session: Session) {
  const { status } = session;
  const problem = () => /error|warn/.test(status().kind) || status().warnings.length > 0;
  return div(
    {
      id: "status",
      class: () => "status panel" + (status().kind ? " " + status().kind : ""),
      hidden: () => !problem(),
      role: "status",
      "aria-live": "polite",
    },
    [
      span({ class: "dot" }),
      span({ id: "statusText" }, [
        () => status().text,
        when(
          () => status().warnings.length > 0,
          () => span({ class: () => "warnings" + (status().text ? "" : " alone") }, [() => "Warning: " + status().warnings.join("; ")]),
        ),
      ]),
    ],
  );
}
