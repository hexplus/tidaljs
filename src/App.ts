import { div, main, onMount, section } from "sibujs";
import { CycleView } from "./components/CycleView.ts";
import { Palette } from "./components/Palette.ts";
import { Sidebar } from "./components/Sidebar.ts";
import { StatusBar } from "./components/StatusBar.ts";
import { TopBar } from "./components/TopBar.ts";
import { createSession } from "./session.ts";

/** The live coding page. */
export function App() {
  const session = createSession();

  const root = div({ id: "tidaljs" }, [
    TopBar(session),
    main("layout", [
      section("workspace", [Palette(session), session.editor.view, CycleView(session), StatusBar(session)]),
      Sidebar(session),
    ]),
    ...session.editor.popups,
  ]);

  // Ctrl+Enter plays and Escape stops, wherever the focus is.
  const onKeydown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      void session.play();
    } else if (e.key === "Escape" || (mod && e.key === ".")) {
      e.preventDefault();
      session.stop();
    }
  };
  onMount(() => {
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, root);

  return root;
}
