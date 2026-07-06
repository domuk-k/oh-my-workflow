// Ambient workflow execution: runs a plain-JS workflow body that uses the omw
// hook names (agent/parallel/pipeline/phase/log/workflow/budget) as free
// variables — no imports, no exports, just top-level await + return.
//
// The body is executed with an AsyncFunction so `return` becomes the result,
// and the hook names plus any user-supplied `bindings` are injected as
// parameters. This is the in-session execution surface: a coding-agent host
// reads a `workflow.js` file, builds a Runtime, and calls runAmbientWorkflowFile.

import { readFileSync } from "node:fs";
import type { Runtime } from "./runtime";

export type AmbientRunOptions = {
  args?: unknown;
  /** Extra names to inject as bindings (e.g. schema constants, helpers). */
  bindings?: Record<string, unknown>;
};

/** Execute a plain-JS workflow body string in an ambient context.
 *  The hook names and any extra `bindings` are injected as named parameters. */
export async function runAmbientWorkflowScript(
  script: string,
  rt: Runtime,
  opts: AmbientRunOptions = {},
): Promise<unknown> {
  const { args = {}, bindings = {} } = opts;
  const hookNames = ["agent", "parallel", "pipeline", "phase", "log", "budget"] as const;
  const paramNames = [...hookNames, "args", ...Object.keys(bindings)];
  const paramValues = [
    rt.agent.bind(rt),
    rt.parallel.bind(rt),
    rt.pipeline.bind(rt),
    rt.phase.bind(rt),
    rt.log.bind(rt),
    rt.budget,
    args,
    ...Object.values(bindings),
  ];

  // AsyncFunction body so top-level await and return both work.
  const fn = new Function(...paramNames, `"use strict"; return (async () => { ${script} })();`);
  return fn(...paramValues);
}

/** Read a workflow file and execute it as an ambient body. */
export async function runAmbientWorkflowFile(
  filePath: string,
  rt: Runtime,
  opts: AmbientRunOptions = {},
): Promise<unknown> {
  const script = readFileSync(filePath, "utf8");
  return runAmbientWorkflowScript(script, rt, opts);
}
