import { canvas, div, onMount, signal, span } from "sibujs";
import type { PatternEvent } from "../engine.ts";
import type { Session } from "../session.ts";

const LABEL_W = 48;
const LANE_COLORS = ["#4fd1a5", "#7aa2f7", "#f7768e", "#e8b764", "#c792ea", "#7dcfff", "#f29e74", "#b5e48c"];

/** Events of the current cycle, one lane per sound, with a playhead. */
export function CycleView(session: Session) {
  const [cycleLabel, setCycleLabel] = signal("stopped");
  const view = canvas({ id: "cycleCanvas", "aria-label": "Events of the current cycle", role: "img" });
  const ctx2d = view.getContext("2d");

  let cachedCycle: number | null = null;
  let cachedEvents: PatternEvent[] = [];
  let cachedLanes: string[] = [];
  let frame = 0;

  const soundOf = (ev: PatternEvent) => String((ev.value && ev.value.s) || "?");

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = view.getBoundingClientRect();
    view.width = Math.max(1, Math.round(rect.width * dpr));
    view.height = Math.max(1, Math.round(rect.height * dpr));
  }

  function draw() {
    frame = requestAnimationFrame(draw);
    if (!ctx2d) return;
    const dpr = window.devicePixelRatio || 1;
    const fullW = view.clientWidth;
    const h = view.clientHeight;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.clearRect(0, 0, fullW, h);
    ctx2d.translate(LABEL_W, 0);
    const w = Math.max(1, fullW - LABEL_W);

    // Beat grid (4 beats per cycle)
    ctx2d.fillStyle = "#1f242d";
    for (let i = 0; i <= 4; i++) ctx2d.fillRect(Math.min(w - 1, Math.round((w * i) / 4)), 0, 1, h);

    // The engine can stop on its own (stopAll() in code, a pattern error).
    session.syncPlaying();
    const engine = session.engine();
    if (!engine || !engine.isPlaying) {
      cachedCycle = null;
      setCycleLabel("stopped");
      return;
    }

    const pos = engine.getCyclePosition();
    const cycle = Math.floor(pos);
    if (cycle !== cachedCycle) {
      cachedCycle = cycle;
      cachedEvents = engine.queryActive(cycle, cycle + 1);
      cachedLanes = [];
      for (const ev of cachedEvents) {
        const name = soundOf(ev);
        if (!cachedLanes.includes(name)) cachedLanes.push(name);
      }
    }
    setCycleLabel("cycle " + cycle);

    const laneH = h / (cachedLanes.length || 1);
    const progress = pos - cycle;
    for (const ev of cachedEvents) {
      const lane = Math.max(0, cachedLanes.indexOf(soundOf(ev)));
      const x = (ev.begin - cycle) * w;
      const width = Math.max(3, Math.min(1, ev.end - ev.begin) * w - 2);
      ctx2d.globalAlpha = ev.begin - cycle <= progress ? 1 : 0.35;
      ctx2d.fillStyle = LANE_COLORS[lane % LANE_COLORS.length];
      ctx2d.fillRect(x + 1, lane * laneH + 2, width, Math.max(2, laneH - 4));
    }
    ctx2d.globalAlpha = 1;

    // Lane labels in the left column
    if (laneH >= 9) {
      const mono = getComputedStyle(document.documentElement).getPropertyValue("--mono");
      ctx2d.font = Math.min(11, Math.floor(laneH - 2)) + "px " + mono;
      ctx2d.textBaseline = "middle";
      cachedLanes.forEach((name, i) => {
        ctx2d.fillStyle = LANE_COLORS[i % LANE_COLORS.length];
        ctx2d.fillText(name.slice(0, 6), -LABEL_W + 2, i * laneH + laneH / 2);
      });
    }

    // Playhead
    ctx2d.fillStyle = "#ffffff";
    ctx2d.fillRect(Math.round(progress * w), 0, 2, h);
  }

  const root = div("cycle panel", [
    div("cycle-head", [span({ id: "cycleLabel" }, () => cycleLabel()), span("one cycle")]),
    view,
  ]);

  onMount(() => {
    resize();
    window.addEventListener("resize", resize);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, root);

  return root;
}
