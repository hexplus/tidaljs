import { div, main, onMount, section } from "sibujs";
import { CycleView } from "./components/CycleView.ts";
import { Palette } from "./components/Palette.ts";
import { createLibrary } from "./components/Library.ts";
import { Sidebar } from "./components/Sidebar.ts";
import { StatusBar } from "./components/StatusBar.ts";
import { TopBar } from "./components/TopBar.ts";
import { createSession } from "./session.ts";

/** The live coding page. */
export function App() {
  const session = createSession();
  const library = createLibrary(session);

  const root = div({ id: "tidaljs" }, [
    TopBar(session),
    main("layout", [
      section("workspace", [Palette(session), session.editor.view, CycleView(session), StatusBar(session)]),
      Sidebar(session, library),
    ]),
    ...session.editor.popups,
  ]);

  // Ctrl+Enter plays, Ctrl+S saves to the library and Escape stops, wherever the focus is.
  const onKeydown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      void session.play();
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void library.save();
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
