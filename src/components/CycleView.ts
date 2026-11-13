import { button, canvas, div, each, onMount, signal, span } from "sibujs";
import type { PatternEvent } from "../engine.ts";
import type { Session } from "../session.ts";

const LABEL_W = 72;
/** Height of a lane when there is room; the view grows (up to MAX_H) to fit every stream. */
const LANE_H = 14;
const MIN_H = 84;
const MAX_H = 196;
const LANE_COLORS = ["#4fd1a5", "#7aa2f7", "#f7768e", "#e8b764", "#c792ea", "#7dcfff", "#f29e74", "#b5e48c"];

/** The panel's background, which dimmed bars are mixed towards. */
const BACKGROUND = [0x14, 0x17, 0x1d];

/** A colour mixed with the background: 1 is the colour itself, 0 the background. */
function dim(hex: string, amount: number): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return "rgb(" + rgb.map((c, i) => Math.round(BACKGROUND[i] + (c - BACKGROUND[i]) * amount)).join(",") + ")";
}

/** Brightness of a bar: played or still to come in this cycle, from a heard or a muted stream. */
const LEVELS = { upcoming: 0.35, played: 1, mutedUpcoming: 0.12, mutedPlayed: 0.25 };

/**
 * Cycles looked back for events that started earlier and still sound (slow
 * patterns, long notes). Longer ones are carried over from cycle to cycle.
 */
const LOOKBACK = 4;

/** What an event plays: its sound, or midi / osc. Null for events nobody hears (no sound). */
function soundOf(ev: PatternEvent): string | null {
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

  type Drawn = { begin: number; end: number; lane: string; silent: boolean };
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

  /** Sizes the canvas's pixels to its box and the screen's pixel ratio. */
  function resize(dpr: number, width: number, height: number) {
    view.width = Math.max(1, Math.round(width * dpr));
    view.height = Math.max(1, Math.round(height * dpr));
    font = getComputedStyle(document.documentElement).getPropertyValue("--mono");
  }

  /** Each lane is one sound of one stream: its stream and sound, and the label it shows. */
  const lanes = new Map<string, { stream: string | null; sound: string; label: string }>();

  /** A label cut to the width of the left column, with an ellipsis. */
  function fit(text: string) {
    const room = LABEL_W - 8;
    if (ctx2d!.measureText(text).width <= room) return text;
    let cut = text;
    while (cut.length > 1 && ctx2d!.measureText(cut + "…").width > room) cut = cut.slice(0, -1);
    return cut + "…";
  }

  /**
   * Labels the lanes: a named stream (d1, "bass") shows its name, with the
   * sound when it plays several; an unnamed one (#1) shows the sound, with
   * the stream when two unnamed streams play the same sound.
   */
  function labelLanes(keys: string[]) {
    const soundsOf = new Map<string, number>();
    const unnamedSound = new Map<string, number>();
    for (const key of keys) {
      const { stream, sound } = lanes.get(key)!;
      soundsOf.set(stream ?? "", (soundsOf.get(stream ?? "") ?? 0) + 1);
      if (!stream || stream.startsWith("#")) unnamedSound.set(sound, (unnamedSound.get(sound) ?? 0) + 1);
    }
    for (const key of keys) {
      const lane = lanes.get(key)!;
      const named = !!lane.stream && !lane.stream.startsWith("#");
      lane.label = named
        ? (soundsOf.get(lane.stream!)! > 1 ? lane.stream + " " + lane.sound : lane.stream!)
        : (lane.stream && unnamedSound.get(lane.sound)! > 1 ? lane.stream + " " + lane.sound : lane.sound);
    }
  }

  /**
   * Reads the events to draw for a cycle: those that start in it and those
   * that started earlier and still sound. The lanes also count the cycles
   * before and after, so a sound that alternates ("<bd sn>") keeps its lane.
   */
  function query(engine: NonNullable<ReturnType<typeof session.engine>>, cycle: number, advanced: boolean) {
    // Events longer than the look-back, carried over when only the cycle moved on (the
    // patterns are the same); after a change in what plays they are read again from scratch.
    const from = Math.max(0, cycle - LOOKBACK);
    const drawn: Drawn[] = advanced ? cachedEvents.filter((ev) => ev.begin < from && ev.end > cycle) : [];
    const nearby = new Set<string>(drawn.map((ev) => ev.lane));
    // Playback starts at cycle 0, so nothing before it ever played. Muted streams come too,
    // dimmed, so muting one does not make the other lanes jump.
    for (const ev of engine.queryActive(from, cycle + 2, true)) {
      const sound = soundOf(ev);
      if (!sound) continue;
      // One lane per sound of each stream, so streams sharing a sound (a bass and strings
      // both on "saw") get lanes of their own, like the stream chips above.
      const lane = (ev.stream ?? "") + "" + sound;
      if (!lanes.has(lane)) lanes.set(lane, { stream: ev.stream ?? null, sound, label: sound });
      if (ev.end > cycle - 1 && ev.begin < cycle + 2) nearby.add(lane);
      if (ev.end > cycle && ev.begin < cycle + 1) drawn.push({ begin: ev.begin, end: ev.end, lane, silent: !!ev.silent });
    }
    assignColours(nearby);
    cachedEvents = drawn;
    // Lanes in the order of the streams (as the chips), then of the sounds' first appearance.
    const order = new Map(session.streams().map((s, i) => [s.name, i]));
    const first = [...colours.keys()];
    const rank = (key: string) => order.get(lanes.get(key)?.stream ?? "") ?? order.size;
    cachedLanes = first.filter((key) => nearby.has(key)).sort((a, b) => rank(a) - rank(b) || first.indexOf(a) - first.indexOf(b));
    labelLanes(cachedLanes);
  }

  /** Sets the view's height in CSS pixels, when it changes. */
  function setHeight(px: number) {
    if (view.style.height !== px + "px") view.style.height = px + "px";
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
    // Checked every frame, so the canvas stays sharp when its box changes, the page is
    // zoomed or the window moves to a screen with another pixel ratio.
    if (view.width !== Math.max(1, Math.round(fullW * dpr)) || view.height !== Math.max(1, Math.round(h * dpr))) {
      resize(dpr, fullW, h);
    }
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
      cachedLanes = [];
      setHeight(MIN_H);
      colours.clear();
      lanes.clear();
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
      const advanced = cachedCycle !== null && cycle === cachedCycle + 1 && version === cachedVersion && streams === cachedStreams;
      cachedCycle = cycle;
      cachedVersion = version;
      cachedStreams = streams;
      query(engine, cycle, advanced);
    }
    setCycleLabel("cycle " + cycle);
    // Grow with the lanes so every stream keeps a readable lane (the canvas is resized next frame).
    setHeight(Math.min(MAX_H, Math.max(MIN_H, cachedLanes.length * LANE_H + 4)));

    const laneH = h / (cachedLanes.length || 1);
    const progress = pos - cycle;
    // Bars still to come in this cycle are dim and light up once the playhead reaches them.
    // They are painted in solid, pre-mixed colours (not see-through), so notes that overlap in
    // a lane (chords, several streams on one sound) do not stack into patches of uneven shade;
    // the dimmest are painted first, so a played note always shows over an upcoming one.
    const bars = cachedEvents.map((ev) => {
      const played = ev.begin - cycle <= progress;
      const level = ev.silent ? (played ? LEVELS.mutedPlayed : LEVELS.mutedUpcoming) : played ? LEVELS.played : LEVELS.upcoming;
      return { ev, level };
    });
    bars.sort((a, b) => a.level - b.level);
    for (const { ev, level } of bars) {
      const lane = cachedLanes.indexOf(ev.lane);
      if (lane < 0) continue;
      const from = Math.max(0, ev.begin - cycle);
      const to = Math.min(1, ev.end - cycle);
      ctx2d.fillStyle = dim(colourOf(ev.lane), level);
      ctx2d.fillRect(from * w + 1, lane * laneH + 2, Math.max(3, (to - from) * w - 2), Math.max(2, laneH - 4));
    }

    // Lane labels in the left column
    if (laneH >= 9) {
      ctx2d.font = Math.min(11, Math.floor(laneH - 2)) + "px " + font;
      ctx2d.textBaseline = "middle";
      // A lane whose events all come from muted streams gets a dimmed label.
      const heard = new Set(cachedEvents.filter((ev) => !ev.silent).map((ev) => ev.lane));
      cachedLanes.forEach((name, i) => {
        ctx2d.globalAlpha = heard.has(name) || !cachedEvents.some((ev) => ev.lane === name) ? 1 : 0.4;
        ctx2d.fillStyle = colourOf(name);
        ctx2d.fillText(fit(lanes.get(name)?.label ?? name), -LABEL_W + 2, i * laneH + laneH / 2);
      });
      ctx2d.globalAlpha = 1;
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

  onMount(() => {
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, root);

  return root;
}
