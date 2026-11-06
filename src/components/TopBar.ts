import { a, button, div, effect, h1, header, input, kbd, label, output, p, path, span, svg } from "sibujs";
import { parseTempo, type Session } from "../session.ts";

const REPOSITORY = "https://github.com/hexplus/tidaljs";

// The GitHub mark, from Octicons (MIT): https://github.com/primer/octicons
const GITHUB_MARK =
  "M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z";

/** Link to the repository, shown as the GitHub mark. */
function GitHubLink() {
  return a(
    {
      class: "github-link",
      href: REPOSITORY,
      target: "_blank",
      rel: "noopener",
      title: "Source code on GitHub",
      "aria-label": "Source code on GitHub",
    },
    [svg({ viewBox: "0 0 16 16", width: "16", height: "16", fill: "currentColor", "aria-hidden": "true" }, [path({ d: GITHUB_MARK })])],
  );
}

/** Brand, transport buttons, live update toggle and tempo. */
export function TopBar(session: Session) {
  const { tempo, recording, liveEnabled, setLiveEnabled } = session;

  const tempoInput = input({
    id: "tempoInput",
    type: "number",
    value: "0.8",
    step: "0.05",
    min: "0.05",
    max: "10",
    inputmode: "decimal",
    on: {
      input: (e) => session.changeTempo(parseTempo((e.target as HTMLInputElement).value)),
      change: (e) => {
        const el = e.target as HTMLInputElement;
        el.value = String(parseTempo(el.value));
      },
    },
  });

  // Show the engine's tempo (code can call setCPS) unless the field is being edited.
  effect(() => {
    const value = String(tempo());
    if (document.activeElement !== tempoInput) tempoInput.value = value;
  });

  return header("topbar", [
    div("brand", [
      h1(["Tidal", span("JS")]),
      p([
        span("brand-tagline", ["Live coding music in your browser, "]),
        "built with ",
        a({ href: "https://sibujs.dev/", target: "_blank", rel: "noopener" }, "SibuJS"),
        GitHubLink(),
      ]),
    ]),
    div("transport", [
      button(
        { id: "playBtn", class: "btn primary", type: "button", title: "Evaluate and play (Ctrl+Enter)", on: { click: () => void session.play() } },
        ["Play ", kbd("Ctrl+Enter")],
      ),
      button(
        { id: "stopBtn", class: "btn", type: "button", title: "Stop all patterns (Esc)", on: { click: session.stop } },
        ["Stop ", kbd("Esc")],
      ),
      button(
        {
          id: "recordBtn",
          class: "btn",
          type: "button",
          title: "Record the audio output to a file",
          "aria-pressed": () => (recording() ? "true" : "false"),
          on: { click: () => void session.toggleRecording() },
        },
        () => (recording() ? "Stop recording" : "Record"),
      ),
      label({ class: "toggle", title: "While playing, re-run the code shortly after you stop typing" }, [
        input({
          id: "liveToggle",
          type: "checkbox",
          checked: () => liveEnabled(),
          on: { change: (e) => setLiveEnabled((e.target as HTMLInputElement).checked) },
        }),
        " Live update",
      ]),
      label({ class: "tempo", for: "tempoInput" }, [
        "Tempo",
        tempoInput,
        "cps",
        output({ id: "bpmOutput", for: "tempoInput" }, () => Math.round(tempo() * 240) + " bpm"),
      ]),
    ]),
  ]);
}
