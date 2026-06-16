// `omw validate <wf> [--json]` — pre-flight check that spawns NO agents and does
// NOT run the workflow body. omw workflows are imperative JS, so a node's schema
// isn't knowable statically; what IS cheap to check is that the module loads and
// default-exports a function, and that a `fake` fixture is well-formed — the
// silent-degradation traps the SKILL warns about (top-level `responses`, a string
// `match`, or no rules+default), each of which makes `--agent fake` match nothing
// and quietly return `{}`. Runtime schema bugs surface separately as the exit-4
// internal_error escalation in `omw run`.

import type { Io } from "./run";
import { loadWorkflow, type LoadedWorkflow } from "./run";

export type ValidateReport = {
  wf: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
};

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Lint a `fake` fixture for shapes that silently match nothing. Returns
 *  human-readable warnings (empty = clean, or no fixture at all). */
export function lintFake(fake: unknown): string[] {
  const warnings: string[] = [];
  if (fake == null) return warnings;
  if (typeof fake !== "object") {
    warnings.push(`fake must be an object { rules, default }, got ${typeof fake}`);
    return warnings;
  }
  const f = fake as Record<string, unknown>;
  if ("responses" in f) {
    warnings.push("`fake.responses` at the top level is ignored — responses belong inside `fake.rules[].responses`");
  }
  const rules = f.rules;
  if (rules !== undefined && !Array.isArray(rules)) {
    warnings.push("`fake.rules` must be an array");
  } else if (Array.isArray(rules)) {
    rules.forEach((r, i) => {
      if (r == null || typeof r !== "object") {
        warnings.push(`fake.rules[${i}] must be an object { match, responses }`);
        return;
      }
      const rule = r as Record<string, unknown>;
      if (typeof rule.match !== "function") {
        warnings.push(`fake.rules[${i}].match must be a predicate function (prompt) => boolean, got ${typeof rule.match}`);
      }
      if (!Array.isArray(rule.responses)) {
        warnings.push(`fake.rules[${i}].responses must be an array`);
      }
    });
  }
  const hasRules = Array.isArray(rules) && rules.length > 0;
  if (!hasRules && f.default === undefined) {
    warnings.push("`fake` has no `rules` and no `default` — every node falls back to `{}` and will likely fail its schema");
  }
  return warnings;
}

/** Load the workflow (no run) and lint its fixture. `load` is injectable so the
 *  check is testable without the filesystem. */
export async function validateWorkflow(
  wfPath: string,
  load: (p: string) => Promise<LoadedWorkflow> = loadWorkflow,
): Promise<ValidateReport> {
  let loaded: LoadedWorkflow;
  try {
    loaded = await load(wfPath);
  } catch (e) {
    return { wf: wfPath, ok: false, errors: [errMsg(e)], warnings: [] };
  }
  return { wf: wfPath, ok: true, errors: [], warnings: lintFake(loaded.fake) };
}

export type ValidateParse =
  | { ok: true; value: { wfPath: string; json: boolean } }
  | { ok: false; error: string };

export function parseValidateArgs(argv: string[]): ValidateParse {
  let wfPath: string | undefined;
  let json = false;
  for (const tok of argv) {
    if (tok === "--json") json = true;
    else if (wfPath === undefined) wfPath = tok;
    else return { ok: false, error: `unexpected argument: ${tok}` };
  }
  if (wfPath === undefined) return { ok: false, error: "missing workflow path" };
  return { ok: true, value: { wfPath, json } };
}

/** Exit 0 only when the workflow loads AND any fake fixture is well-formed; exit
 *  1 on a load error or a fixture problem; exit 2 on a usage error. */
export async function validateCommand(argv: string[], io: Io): Promise<number> {
  const parsed = parseValidateArgs(argv);
  if (!parsed.ok) {
    io.stderr(JSON.stringify({ error: "usage", message: parsed.error }) + "\n");
    io.stderr("usage: omw validate <workflow> [--json]\n");
    return 2;
  }

  const report = await validateWorkflow(parsed.value.wfPath);
  if (parsed.value.json) {
    io.stdout(JSON.stringify(report) + "\n");
  } else {
    for (const e of report.errors) io.stderr(`✗ ${e}\n`);
    for (const w of report.warnings) io.stderr(`⚠ ${w}\n`);
    if (report.ok && report.warnings.length === 0) io.stdout(`✓ ${report.wf} — ok\n`);
  }
  return report.ok && report.warnings.length === 0 ? 0 : 1;
}
