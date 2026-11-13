import { button, canvas, div, each, onMount, signal, span } from "sibujs";
import type { PatternEvent } from "../engine.ts";
import type { Session } from "../session.ts";

const LABEL_W = 48;
const LANE_COLORS = ["#4fd1a5", "#7aa2f7", "#f7768e", "#e8b764", "#c792ea", "#7dcfff", "#f29e74", "#b5e48c"];

/** Cycles looked back for events that started earlier and still sound (slow patterns, long notes). */
const LOOKBACK = 4;

/** The lane an event is drawn in: its sound, or midi / osc. Null for events nobody hears (no sound). */
function laneOf(ev: PatternEvent): string | null {
  const v = ev.value;
  if (!v || typeof v !== "object") return null;
  if (v.midi !== undefined) return "midi";
  if (v.osc !== undefined) return "osc";
  return typeof v.s === "string" && v.s && v.s !== "~" ? v.s : null;
}

/**
 * Events of the current cycle, one lane per sound, with a playhead that
 * follows what is heard (the audio output latency taken off).
 */
export function CycleView(session: Session) {
  const [cycleLabel, setCycleLabel] = signal("stopped");
  const view = canvas({ id: "cycleCanvas", "aria-label": "Events of the current cycle", role: "img" });
  const ctx2d = view.getContext("2d");

  type Drawn = { begin: number; end: number; lane: string };
  let cachedCycle: number | null = null;
  let cachedVersion = -1;
  let cachedStreams: unknown = null;
  let cachedEvents: Drawn[] = [];
  let cachedLanes: string[] = [];
  /** Each sound keeps its colour while the music plays, whatever lanes come and go. */
  const colours = new Map<string, string>();
  let font = "";
  let frame = 0;

  const colourOf = (lane: string) => colours.get(lane) ?? LANE_COLORS[0];

  /** Gives each new sound a colour no other visible lane has (while there are enough colours). */
  function assignColours(visible: Set<string>) {
    for (const lane of visible) {
      if (colours.has(lane)) continue;
      const taken = new Set([...visible].map((l) => colours.get(l)).filter(Boolean));
      const free = LANE_COLORS.find((c) => !taken.has(c));
      colours.set(lane, free ?? LANE_COLORS[colours.size % LANE_COLORS.length]);
    }
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = view.getBoundingClientRect();
    view.width = Math.max(1, Math.round(rect.width * dpr));
    view.height = Math.max(1, Math.round(rect.height * dpr));
    font = getComputedStyle(document.documentElement).getPropertyValue("--mono");
  }

  /**
   * Reads the events to draw for a cycle: those that start in it and those
   * that started earlier and still sound. The lanes also count the cycles
   * before and after, so a sound that alternates ("<bd sn>") keeps its lane.
   */
  function query(engine: NonNullable<ReturnType<typeof session.engine>>, cycle: number) {
    const drawn: Drawn[] = [];
    const nearby = new Set<string>();
    // Playback starts at cycle 0, so nothing before it ever played.
    for (const ev of engine.queryActive(Math.max(0, cycle - LOOKBACK), cycle + 2)) {
      const lane = laneOf(ev);
      if (!lane) continue;
      if (ev.end > cycle - 1 && ev.begin < cycle + 2) nearby.add(lane);
      if (ev.end > cycle && ev.begin < cycle + 1) drawn.push({ begin: ev.begin, end: ev.end, lane });
    }
    assignColours(nearby);
    cachedEvents = drawn;
    // Lanes in the order the sounds first played, so they do not swap places.
    cachedLanes = [...colours.keys()].filter((lane) => nearby.has(lane));
  }

  function draw() {
    frame = requestAnimationFrame(draw);
    // The engine can stop on its own (stopAll() in code, a pattern error): keep the
    // play state in sync every frame, even when there is nothing to draw on.
    session.syncPlaying();
    if (!ctx2d) return;
    const dpr = window.devicePixelRatio || 1;
    const fullW = view.clientWidth;
    const h = view.clientHeight;
    if (!fullW || !h) return;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, fullW, h);
    ctx2d.translate(LABEL_W, 0);
    const w = Math.max(1, fullW - LABEL_W);

    // Beat grid (4 beats per cycle)
    ctx2d.fillStyle = "#1f242d";
    for (let i = 0; i <= 4; i++) ctx2d.fillRect(Math.min(w - 1, Math.round((w * i) / 4)), 0, 1, h);

    const engine = session.engine();
    if (!engine || !engine.isPlaying) {
      cachedCycle = null;
      colours.clear();
      setCycleLabel("stopped");
      return;
    }

    const pos = engine.getAudibleCyclePosition();
    const cycle = Math.floor(pos);
    const version = session.patternsChanged();
    const streams = session.streams();
    // Query again on a new cycle, and as soon as what plays changes: the code, a mute or a
    // solo, or a stream the engine dropped after an error.
    if (cycle !== cachedCycle || version !== cachedVersion || streams !== cachedStreams) {
      cachedCycle = cycle;
      cachedVersion = version;
      cachedStreams = streams;
      query(engine, cycle);
    }
    setCycleLabel("cycle " + cycle);

    const laneH = h / (cachedLanes.length || 1);
    const progress = pos - cycle;
    for (const ev of cachedEvents) {
      const lane = cachedLanes.indexOf(ev.lane);
      if (lane < 0) continue;
      const from = Math.max(0, ev.begin - cycle);
      const to = Math.min(1, ev.end - cycle);
      ctx2d.globalAlpha = ev.begin - cycle <= progress ? 1 : 0.35;
      ctx2d.fillStyle = colourOf(ev.lane);
      ctx2d.fillRect(from * w + 1, lane * laneH + 2, Math.max(3, (to - from) * w - 2), Math.max(2, laneH - 4));
    }
    ctx2d.globalAlpha = 1;

    // Lane labels in the left column
    if (laneH >= 9) {
      ctx2d.font = Math.min(11, Math.floor(laneH - 2)) + "px " + font;
      ctx2d.textBaseline = "middle";
      cachedLanes.forEach((name, i) => {
        ctx2d.fillStyle = colourOf(name);
        ctx2d.fillText(name.slice(0, 6), -LABEL_W + 2, i * laneH + laneH / 2);
      });
    }

    // Playhead
    ctx2d.fillStyle = "#ffffff";
    ctx2d.fillRect(Math.round(progress * w), 0, 2, h);
  }

  // One chip per playing stream, with mute (M) and solo (S) toggles.
  const streamChips = div({ class: "streams", role: "group", "aria-label": "Streams" }, [
    each(
      () => session.streams(),
      (row) => {
        const name = row().name;
        const toggle = (label: string, title: string, pressed: () => boolean, action: () => void) =>
          button(
            {
              class: "stream-toggle",
              type: "button",
              title: title + " " + name,
              "aria-label": title + " " + name,
              "aria-pressed": () => (pressed() ? "true" : "false"),
              on: { click: action },
            },
            label,
          );
        return div({ class: () => "stream" + (row().audible ? "" : " silent") }, [
          span("stream-name", [name]),
          toggle("M", "Mute", () => row().muted, () => session.toggleMute(name)),
          toggle("S", "Solo", () => row().soloed, () => session.toggleSolo(name)),
        ]);
      },
      { key: (s) => s.name },
    ),
  ]);

  const root = div("cycle panel", [
    div("cycle-head", [span({ id: "cycleLabel" }, () => cycleLabel()), streamChips, span("one cycle")]),
    view,
  ]);

  // Follow the canvas's own size (the window, the layout, being shown again), not only window resizes.
  const observer = new ResizeObserver(resize);

  onMount(() => {
    resize();
    observer.observe(view);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, root);

  return root;
}
