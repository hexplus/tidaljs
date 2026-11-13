import { div, main, nextTick, onMount, section, signal } from "sibujs";
import { isWidgetKeyEvent } from "sibujs/widgets";
import { CycleView } from "./components/CycleView.ts";
import { Palette } from "./components/Palette.ts";
import { createLibrary } from "./components/Library.ts";
import { Sidebar, type Tab } from "./components/Sidebar.ts";
import { StatusBar } from "./components/StatusBar.ts";
import { TopBar } from "./components/TopBar.ts";
import { createSession } from "./session.ts";

/** The live coding page. */
export function App() {
  const session = createSession();
  const library = createLibrary(session);
  const [tab, setTab] = signal<Tab>("examples");

  /** Switches the sidebar to the Library tab and brings it into view. */
  const showLibrary = () => {
    setTab("library");
    void nextTick().then(() => {
      const tabButton = document.getElementById("tabLibrary");
      tabButton?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      tabButton?.focus({ preventScroll: true });
    });
  };

  const root = div({ id: "tidaljs" }, [
    TopBar(session, library, showLibrary),
    main("layout", [
      section("workspace", [Palette(session), session.editor.view, CycleView(session), StatusBar(session)]),
      Sidebar(session, library, tab, setTab),
    ]),
    ...session.editor.popups,
  ]);

  // Ctrl+Enter plays, Ctrl+S saves to the library and Escape stops, wherever the focus is.
  const onKeydown = (e: KeyboardEvent) => {
    if (isWidgetKeyEvent(e)) return; // Escape that closed the Sketches menu
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
