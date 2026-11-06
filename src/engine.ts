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
export interface Tidal {
  cps: number;
  readonly isPlaying: boolean;
  readonly isRecording: boolean;
  lastError?: string;
  onError: ((error: Error) => void) | null;
  init(): Promise<boolean>;
  eval(code: string, options?: { keepOnWarnings?: boolean }): EvalResult;
  setCPS(cps: number): number;
  stopAll(): void;
  getCyclePosition(): number;
  queryActive(begin: number, end: number): PatternEvent[];
  startRecording(): boolean;
  stopRecording(filename?: string): Promise<Blob | null>;
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
