import { div, span, when } from "sibujs";
import type { Session } from "../session.ts";

/** One line telling what is playing, or what went wrong. */
export function StatusBar(session: Session) {
  const { status } = session;
  return div(
    {
      id: "status",
      class: () => "status panel" + (status().kind ? " " + status().kind : ""),
      role: "status",
      "aria-live": "polite",
    },
    [
      span({ class: "dot" }),
      span({ id: "statusText" }, [
        () => status().text,
        when(
          () => status().warnings.length > 0,
          () => span("warnings", [() => "Warning: " + status().warnings.join("; ")]),
        ),
      ]),
    ],
  );
}
