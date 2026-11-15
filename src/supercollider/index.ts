/**
 * Converts a SuperCollider file (.scd) to TidalJS code: parse, run far enough
 * to know what plays (interpreter.ts), then write each part (emit.ts).
 */
import { emitTidal } from "./emit.ts";
import { Interpreter } from "./interpreter.ts";
import { SCSyntaxError } from "./lexer.ts";
import { parse, type Node } from "./parser.ts";

export interface Conversion {
  code: string;
  title: string;
  parts: number;
}

/** Converts SuperCollider code; throws an Error with the line on a syntax error. */
export function convertSuperCollider(source: string, fileName = ""): Conversion {
  const text = source.replace(/\r\n/g, "\n");
  let program: Node[];
  try {
    program = parse(text);
  } catch (err) {
    if (err instanceof SCSyntaxError) throw new Error("SuperCollider syntax error: " + err.message);
    throw err;
  }
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
