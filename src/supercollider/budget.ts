/**
 * How much work a conversion may do. Every phase (lexing, parsing, running
 * the program, generating pattern values, playing the parts, finding their
 * loops) counts its steps here, and the conversion stops with a clear error
 * when it has done too many or run too long, instead of hanging the page.
 *
 * The softer limits of each phase (the 512-beat horizon, the events a part
 * may play, the work a routine may do between waits) stay where they are and
 * end that phase with a note; this one ends the whole conversion.
 */

/** The conversion did too much work or took too long: it was stopped. */
export class ConversionLimit extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionLimit";
  }
}

export interface BudgetOptions {
  /** How long the conversion may run, in milliseconds. */
  timeLimitMs?: number;
  /** How many steps it may take in all. */
  maxSteps?: number;
}

/** A conversion of a large file takes a few million steps; this is far more. */
export const MAX_STEPS = 400_000_000;
/** Long enough for any file that converts at all, short enough not to look frozen. */
export const TIME_LIMIT_MS = 20_000;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class Budget {
  readonly maxSteps: number;
  readonly timeLimitMs: number;
  /** What the conversion is doing, for the error message. */
  phase = "reading the file";
  steps = 0;
  private readonly deadline: number;
  private nextCheck = 0;
  constructor(options: BudgetOptions = {}) {
    this.maxSteps = options.maxSteps ?? MAX_STEPS;
    this.timeLimitMs = options.timeLimitMs ?? TIME_LIMIT_MS;
    this.deadline = now() + this.timeLimitMs;
  }
  tick(n: number) {
    this.steps += n;
    if (this.steps > this.maxSteps) {
      throw new ConversionLimit("The file needs more work to convert than the importer allows (stopped while " + this.phase + ").");
    }
    // The clock is read every few thousand steps.
    if (this.steps >= this.nextCheck) {
      this.nextCheck = this.steps + 20_000;
      if (now() > this.deadline) {
        throw new ConversionLimit("Converting the file took longer than " + Math.round(this.timeLimitMs / 1000) + " s (stopped while " + this.phase + ").");
      }
    }
  }
}

let current: Budget | null = null;

/** Counts n steps of work against the conversion that is running (none outside a conversion). */
export function tick(n = 1) {
  if (current) current.tick(n);
}

/** Names what the conversion is doing now, for the error message if it stops. */
export function phase(name: string) {
  if (current) current.phase = name;
}

/** Runs fn with this budget: every tick() inside it counts against it. */
export function withBudget<T>(budget: Budget, fn: () => T): T {
  const saved = current;
  current = budget;
  try {
    return fn();
  } finally {
    current = saved;
  }
}

/** The most items one array may have (Array.fill, dup, series...). */
export const MAX_ITEMS = 1_000_000;

/** A count of items for a new array: a whole number from 0, refused (with a clear error) when it is too large. */
export function sized(n: number): number {
  if (!Number.isFinite(n)) {
    if (n === Infinity) throw new Error("an array of infinitely many items cannot be made");
    return 0;
  }
  const count = Math.max(0, Math.floor(n));
  if (count > MAX_ITEMS) throw new Error("an array of " + count + " items is more than the importer makes (" + MAX_ITEMS + ")");
  tick(count);
  return count;
}
