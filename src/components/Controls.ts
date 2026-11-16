import { button, derived, div, each, fieldset, h2, input, label, legend, output, section, span } from "sibujs";
import type { ControlLayout, LiveControl } from "../engine.ts";
import type { Session } from "../session.ts";

/** Decimals worth showing for a slider: those of its step, or enough for its range. */
function decimals(c: LiveControl): number {
  if (c.step > 0) {
    const text = String(c.step);
    return text.includes(".") ? Math.min(4, text.split(".")[1].length) : 0;
  }
  const span = c.max - c.min;
  return span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3;
}

/** A slider's step for the range input: its own, or a thousandth of its range (so the arrow keys move it finely). */
function stepOf(c: LiveControl): string {
  if (c.step > 0) return String(c.step);
  const span = c.max - c.min;
  return span > 0 ? String(span / 1000) : "any";
}

/** A control's key in the lists: its kind and name, so a slider that becomes a toggle is built again. */
const keyOf = (c: LiveControl) => c.kind + ":" + c.name;

/** A group of the panel: a controlLayout() title and its rows of control keys (names the code has as controls only). */
export interface ControlGroup {
  title: string;
  rows: string[][];
}

/**
 * Arranges the controls by the layouts: one group per layout, in order,
 * each row with the controls it names that exist (empty rows and groups
 * left out); `rest` has the controls no layout names, in their own order.
 */
export function groupControls(controls: LiveControl[], layouts: ControlLayout[]): { groups: ControlGroup[]; rest: string[] } {
  const byName = new Map(controls.map((c) => [c.name, c]));
  const listed = new Set<string>();
  const groups: ControlGroup[] = [];
  for (const layout of layouts) {
    const rows = layout.rows
      .map((row) => row.filter((name) => byName.has(name)).map((name) => {
        listed.add(name);
        return keyOf(byName.get(name)!);
      }))
      .filter((row) => row.length > 0);
    if (rows.length) groups.push({ title: layout.title, rows });
  }
  return { groups, rest: controls.filter((c) => !listed.has(c.name)).map(keyOf) };
}

let nextId = 0;

/**
 * The sliders and switches of the code that plays (slider(), toggle()):
 * moving one changes the music at once. controlLayout() groups them in
 * titled boxes of rows; the others follow. Hidden when the code has none.
 */
export function ControlsPanel(session: Session) {
  const byName = derived(() => new Map(session.controls().map((c) => [c.name, c])));
  // Only a change of arrangement rebuilds the groups; moving a control just updates it.
  const arrangement = derived(() => groupControls(session.controls(), session.controlLayouts()), {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  /** The view of the control with this key ("kind:name"), following its value. */
  const controlView = (key: string) => {
    const name = key.slice(key.indexOf(":") + 1);
    const current = (): LiveControl => byName().get(name) ?? { name, kind: "slider", value: 0, min: 0, max: 1, step: 0 };
    if (key.startsWith("toggle:")) {
      return button(
        {
          type: "button",
          role: "switch",
          class: "control control-switch",
          title: "Turn " + name + " on or off",
          "aria-checked": () => (current().value ? "true" : "false"),
          on: { click: () => session.setControl(name, !current().value) },
        },
        [span({ class: "switch-track", "aria-hidden": "true" }, [span({ class: "switch-thumb" })]), span("control-name", [name])],
      );
    }
    const id = "control-" + ++nextId;
    return div("control control-slider", [
      label({ for: id, class: "control-name" }, name),
      input({
        id,
        type: "range",
        min: () => String(current().min),
        max: () => String(current().max),
        step: () => stepOf(current()),
        value: () => String(current().value),
        "aria-valuetext": () => current().value.toFixed(decimals(current())),
        on: { input: (e: Event) => session.setControl(name, Number((e.target as HTMLInputElement).value)) },
      }),
      output({ for: id, class: "control-value", "aria-live": "off" }, () => current().value.toFixed(decimals(current()))),
    ]);
  };

  const groups = div({ class: "control-groups" }, [
    each(
      () => arrangement().groups.map((g, i) => ({ ...g, index: i })),
      (group) => {
        const title = group().title;
        // A fieldset named by its legend (a layout without a title is an unnamed group).
        return fieldset({ class: "control-group" }, [
          ...(title ? [legend({ class: "control-group-title" }, title)] : []),
          each(
            () => group().rows.map((keys, i) => ({ keys, index: i })),
            (row) => div({ class: "control-row" }, [each(() => row().keys, (key) => controlView(key()), { key: (k) => k })]),
            { key: (r) => r.index + ":" + r.keys.join(",") },
          ),
        ]);
      },
      { key: (g) => g.index + ":" + g.title },
    ),
  ]);

  const list = div({ class: "controls-list" }, [each(() => arrangement().rest, (key) => controlView(key()), { key: (k) => k })]);

  return section(
    { class: "controls panel", "aria-labelledby": "controlsTitle", hidden: () => session.controls().length === 0 },
    [div("controls-head", [h2({ id: "controlsTitle" }, "Controls"), span("controls-hint", "slider() and toggle() in the code")]), groups, list],
  );
}
