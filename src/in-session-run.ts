// Unified in-session runner: probe the host → makeRuntime → run the workflow.
// Fails cleanly (exit 3) when no host callback exists — never falls back to CLI.

import type { RunDeps, RunOptions, RunOutcome } from "./cli/run";
import { loadWorkflow, runWorkflow } from "./cli/run";
import { probeInSessionHost, resolveInSessionAdapter, type InSessionProbeResult } from "./adapters/in-session-probe";

export type InSessionRunOptions = Pick<RunOptions, "wfPath" | "concurrency" | "budget" | "strictResume" | "strict"> & {
  args?: unknown;
};

export type InSessionRunDeps = {
  probe?: () => InSessionProbeResult;
  journalSink?: (line: string) => void;
  now?: () => number;
  runId?: () => string;
  stderr?: (line: string) => void;
};

/** Run a workflow through the in-session adapter only. No CLI subprocess fallback. */
export async function runInSessionWorkflow(
  opts: InSessionRunOptions,
  deps: InSessionRunDeps = {},
): Promise<RunOutcome> {
  const probe = deps.probe ?? probeInSessionHost;
  const resolved = resolveInSessionAdapter(probe);
  if ("missing" in resolved) {
    return {
      exitCode: 3,
      error: { error: "in_session_unavailable", adapter: resolved.missing, install_hint: resolved.installHint },
    };
  }

  const runDeps: RunDeps = {
    loadWorkflow,
    resolveAdapter: (name) => {
      if (name === "in-session") return resolved;
      return {
        missing: name,
        installHint: `in-session runs cannot use --agent ${name}; use headless omw run instead.`,
      };
    },
    journalSink: (line) => deps.journalSink?.(line),
    now: deps.now ?? (() => Date.now()),
    runId: deps.runId ?? (() => `is-${Date.now().toString(36)}`),
    stderr: deps.stderr,
  };

  return runWorkflow(
    {
      wfPath: opts.wfPath,
      agent: "in-session",
      args: opts.args,
      concurrency: opts.concurrency,
      budget: opts.budget,
      strictResume: opts.strictResume,
      strict: opts.strict,
      pretty: false,
    },
    runDeps,
  );
}