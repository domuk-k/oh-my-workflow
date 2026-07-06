// `omw codemod <file> [--to-di|--to-omw] [--write]` — mechanical source rewrites
// for the 0.4→0.5 migration. `--to-di` (default) converts a legacy positional
// `(rt, args)` workflow to the destructured-DI surface; `--to-omw` (planned)
// will wrap a native ambient-global script into an omw default export.
//
// These are TEXT transforms on a file the engineer passes — best-effort, printed
// for review (or written back with --write), never run. A regex codemod can't
// see through aliasing, so the output is a starting point an author confirms.

import { readFileSync, writeFileSync } from "node:fs";
import type { Io } from "./run";

const HOOKS = "{ agent, parallel, pipeline, phase, log, workflow, budget }";

export type Transform = "to-di" | "to-omw";

export type CodemodResult = { ok: true; output: string; changed: boolean } | { ok: false; error: string };

/** Rewrite a legacy `(rt, args)` default-export workflow to destructured DI:
 *  the first param `rt` becomes the hooks object, and `rt.agent(...)` etc. become
 *  bare `agent(...)`. Handles `function` and arrow default exports. */
export function toDi(src: string): CodemodResult {
  const fnRe = /(export\s+default\s+(?:async\s+)?function\s*\*?\s*)\(\s*rt\b\s*(,\s*[^)]*)?\)/;
  const arrowRe = /(export\s+default\s+(?:async\s+)?)\(\s*rt\b\s*(,\s*[^)]*)?\)\s*=>/;

  let out = src;
  let matched = false;
  if (fnRe.test(out)) {
    out = out.replace(fnRe, (_m, pre, rest) => `${pre}(${HOOKS}${rest ?? ""})`);
    matched = true;
  } else if (arrowRe.test(out)) {
    out = out.replace(arrowRe, (_m, pre, rest) => `${pre}(${HOOKS}${rest ?? ""}) =>`);
    matched = true;
  }

  if (!matched) {
    return { ok: false, error: "no legacy `(rt, args)` default export found (already destructured-DI?)" };
  }
  // Drop the `rt.` qualifier so hook calls reference the destructured names.
  out = out.replace(/\brt\./g, "");
  return { ok: true, output: out, changed: out !== src };
}

export type CodemodParse =
  | { ok: true; value: { file: string; transform: Transform; write: boolean } }
  | { ok: false; error: string };

export function parseCodemodArgs(argv: string[]): CodemodParse {
  let file: string | undefined;
  let transform: Transform = "to-di";
  let write = false;
  for (const tok of argv) {
    if (tok === "--to-di") transform = "to-di";
    else if (tok === "--to-omw") transform = "to-omw";
    else if (tok === "--write") write = true;
    else if (file === undefined) file = tok;
    else return { ok: false, error: `unexpected argument: ${tok}` };
  }
  if (file === undefined) return { ok: false, error: "missing file path" };
  return { ok: true, value: { file, transform, write } };
}

/** Exit 0 on a successful transform, 1 on a transform/read error, 2 on usage. */
export async function codemodCommand(argv: string[], io: Io): Promise<number> {
  const parsed = parseCodemodArgs(argv);
  if (!parsed.ok) {
    io.stderr(JSON.stringify({ error: "usage", message: parsed.error }) + "\n");
    io.stderr("usage: omw codemod <file> [--to-di|--to-omw] [--write]\n");
    return 2;
  }
  const { file, transform, write } = parsed.value;

  if (transform === "to-omw") {
    io.stderr(JSON.stringify({ error: "not_implemented", message: "--to-omw is not implemented yet; use --to-di" }) + "\n");
    return 1;
  }

  let src: string;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    io.stderr(JSON.stringify({ error: "read_failed", path: file }) + "\n");
    return 1;
  }

  const result = toDi(src);
  if (!result.ok) {
    io.stderr(JSON.stringify({ error: "transform_failed", message: result.error, path: file }) + "\n");
    return 1;
  }

  if (write) {
    writeFileSync(file, result.output);
    io.stderr(`✓ ${file} — rewrote to destructured DI\n`);
  } else {
    io.stdout(result.output);
  }
  return 0;
}
