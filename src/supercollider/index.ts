/**
 * Converts a SuperCollider file (.scd) to TidalJS code: parse, run far enough
 * to know what plays (interpreter.ts), then write each part (emit.ts).
 *
 * Every phase counts its work against one budget (budget.ts), so a file that
 * would take too long stops with a clear error. The editor runs conversions
 * in a worker (client.ts, worker.ts) that it can cancel; this function is the
 * conversion itself, synchronous, as the worker and the tests use it.
 */
import { Budget, ConversionLimit, phase, withBudget, type BudgetOptions } from "./budget.ts";
import { emitTidal } from "./emit.ts";
import { Interpreter } from "./interpreter.ts";
import { SCSyntaxError } from "./lexer.ts";
import { parse, type Node } from "./parser.ts";

export interface Conversion {
  code: string;
  title: string;
  parts: number;
}

/** How long and how much work a conversion may take (see budget.ts for the defaults). */
export type ConvertOptions = BudgetOptions;

/** The largest file the importer reads (as the Library's import does), in characters. */
export const MAX_SOURCE_LENGTH = 5_000_000;

/**
 * Converts SuperCollider code; throws an Error with the line on a syntax error, and a clear Error when the file
 * is too large, or its conversion would take too long or too much work.
 */
export function convertSuperCollider(source: string, fileName = "", options: ConvertOptions = {}): Conversion {
  if (source.length > MAX_SOURCE_LENGTH) throw new Error("The SuperCollider file is too large to convert (more than 5 MB).");
  try {
    return withBudget(new Budget(options), () => convert(source, fileName));
  } catch (err) {
    if (err instanceof ConversionLimit) throw new Error("The SuperCollider import was stopped: " + err.message);
    // Recursion deeper than the stack (sclang functions that call themselves without end).
    if (err instanceof RangeError && /call stack/i.test(err.message)) throw new Error("The SuperCollider import was stopped: the code recurses too deeply to convert.");
    throw err;
  }
}

function convert(source: string, fileName: string): Conversion {
  const text = source.replace(/\r\n/g, "\n");
  let program: Node[];
  phase("reading the code");
  try {
    program = parse(text);
  } catch (err) {
    if (err instanceof SCSyntaxError) throw new Error("SuperCollider syntax error: " + err.message);
    throw err;
  }
  phase("running the code");
  const interp = new Interpreter();
  interp.run(program);
  const base = fileName.replace(/\.[^.]*$/, "").replace(/[-_]+/g, " ").trim();
  const { code, parts } = emitTidal(interp, fileName);
  return { code, title: base || "SuperCollider import", parts };
}

/** Is this a SuperCollider file (by its name, or by what it contains)? */
export function looksLikeSuperCollider(text: string, fileName = ""): boolean {
  if (/\.(scd|sc)$/i.test(fileName)) return true;
  if (/\.(js|ts|tidal|json)$/i.test(fileName)) return false;
  // TidalJS code calls sound( or d1(; SuperCollider has SynthDef, Pbind, Synth(\name or UGens.
  if (/\bsound\s*\(|\bd[0-9]+\s*\(/.test(text)) return false;
  return /\b(SynthDef|Pbind|Pdef|Pbindef|Ppar|Routine|TempoClock)\s*[(.]/.test(text)
    || /Synth\s*\(\s*\\/.test(text)
    || /\.ar\s*\(/.test(text);
}
