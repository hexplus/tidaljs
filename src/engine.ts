/**
 * Typed access to the audio engine.
 *
 * tidal.js is a dependency-free script that defines window.TidalJS, so it can
 * also be used from a plain <script> tag. Importing it here runs it once, before
 * any module that needs the engine.
 */
import "../tidal.js";

/** The controls of one event, e.g. { s: "bd", gain: 0.8 }. */
export type EventValue = Record<string, unknown>;

export interface PatternEvent {
  begin: number;
  end: number;
  value: EventValue | null;
  /** From a muted (or not soloed) stream: only with queryActive(..., true). */
  silent?: boolean;
  /** The stream the event plays in (d1, "bass", #1...): only with queryActive(..., true). */
  stream?: string | null;
}

export interface EvalResult {
  success: boolean;
  /** Live update only: the new code has warnings, the old patterns keep playing. */
  pending?: boolean;
  activePatterns: number;
  error?: string;
  /** Where the error happened, as offsets in the code. */
  location?: { start: number; end: number; line: number } | null;
  warnings: string[];
}

/** An engine instance: one audio context, a clock and the playing patterns. */
/** A playing stream (d1, a p("name") stream, or #1, #2 for unnamed patterns) and its mute and solo state. */
export interface StreamInfo {
  name: string;
  muted: boolean;
  soloed: boolean;
  audible: boolean;
}

/** A live control from slider() or toggle() in the code that plays. */
export interface LiveControl {
  name: string;
  kind: "slider" | "toggle";
  value: number;
  min: number;
  max: number;
  /** 0 allows any value. */
  step: number;
}

/** A group of the Controls panel from controlLayout(title, rows): rows of control names. */
export interface ControlLayout {
  title: string;
  rows: string[][];
}

export interface Tidal {
  cps: number;
  readonly isPlaying: boolean;
  readonly isRecording: boolean;
  lastError?: string;
  onError: ((error: Error) => void) | null;
  init(): Promise<boolean>;
  eval(code: string, options?: { keepOnWarnings?: boolean; keepUnchanged?: boolean }): EvalResult;
  streamInfo(): StreamInfo[];
  mute(name: string, on?: boolean): void;
  solo(name: string, on?: boolean): void;
  readonly muted: Set<string>;
  readonly soloed: Set<string>;
  setCPS(cps: number): number;
  stopAll(): void;
  getCyclePosition(): number;
  /** The position of what is heard now: the clock minus the audio output latency. */
  getAudibleCyclePosition(): number;
  /** Events of the playing patterns in [begin, end); muted streams too (marked silent) when includeSilent. */
  queryActive(begin: number, end: number, includeSilent?: boolean): PatternEvent[];
  startRecording(): boolean;
  stopRecording(filename?: string): Promise<Blob | null>;
  /** Loaded sample banks: name -> file URLs. */
  readonly sampleBanks: Map<string, string[]>;
  /** Loads sample banks from "github:user/repo", a manifest URL or { name: [files] }. */
  loadSamples(source: string | Record<string, unknown>, base?: string): Promise<number>;
  isLoadingSamples(): boolean;
  whenSamplesLoaded(): Promise<void>;
  /** The sliders and toggles of the code that plays. */
  controls(): LiveControl[];
  /** Sets a control's value (kept within its range and step). */
  setControl(name: string, value: number | boolean): number | undefined;
  /** The controlLayout() groups of the code that plays, in call order. */
  controlLayouts(): ControlLayout[];
  /** Calls fn whenever the controls, their values or the layouts change; returns a function that stops it. */
  onControls(fn: (controls: LiveControl[], layouts: ControlLayout[]) => void): () => void;
  /** Values to give controls by name, e.g. saved in this browser. */
  restoreControls(values: Record<string, number>): void;
}

interface TidalStatic {
  new (): Tidal;
  soundNames: string[];
  scaleNames: string[];
  chordNames: string[];
  arpModes: string[];
  vowels: string[];
  /** Semitones from middle C of a chord such as "c'maj7", or null. */
  parseChord(word: string): number[] | null;
  PatternBuilder: { prototype: object };
}

export const TidalJS = (globalThis as unknown as { TidalJS: TidalStatic }).TidalJS;

/** Public method names of patterns, with how many parameters each declares. */
export function patternMethods(): { name: string; length: number }[] {
  const proto = TidalJS.PatternBuilder.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => typeof proto[name] === "function")
    .map((name) => ({ name, length: (proto[name] as (...args: unknown[]) => unknown).length }));
}
