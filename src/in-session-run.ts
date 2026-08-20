// Embedder-only in-session runner: pass an explicit adapter (or probe) → makeRuntime → run.
// No CLI subprocess fallback; no implicit host detection.

import type { AgentPort } from "./adapters/types";
import type { RunDeps, RunOptions, RunOutcome } from "./cli/run";
import { loadWorkflow, runWorkflow } from "./cli/run";
import { resolveInSessionAdapter, type InSessionProbeResult } from "./adapters/in-session-probe";

export const IN_SESSION_ADAPTER_REQUIRED_HINT =
  "Pass `adapter` (makeInSessionAdapter / makeKiroInSessionAdapter) or `probe` to runInSessionWorkflow. " +
  "For headless runs use `omw run --agent claude|codex|fake`.";

export type InSessionRunOptions = Pick<RunOptions, "wfPath" | "concurrency" | "budget" | "strictResume" | "strict"> & {
  args?: unknown;
};

export type InSessionRunDeps = {
  /** Ready in-session adapter — preferred for embedders. */
  adapter?: AgentPort;
  /** Optional probe when the host ships its own detection (e.g. Kiro). */
  probe?: () => InSessionProbeResult;
  journalSink?: (line: string) => void;
  now?: () => number;
  runId?: () => string;
  stderr?: (line: string) => void;
};

function resolveEmbedderAdapter(
  deps: InSessionRunDeps,
): { adapter: AgentPort } | { missing: string; installHint: string } {
  if (deps.adapter) return { adapter: deps.adapter };
  if (deps.probe) return resolveInSessionAdapter(deps.probe);
  return { missing: "in-session", installHint: IN_SESSION_ADAPTER_REQUIRED_HINT };
}

/** Run a workflow through an explicit in-session adapter. Embedder API only — not `omw run`. */
export async function runInSessionWorkflow(
  opts: InSessionRunOptions,
  deps: InSessionRunDeps = {},
): Promise<RunOutcome> {
  const resolved = resolveEmbedderAdapter(deps);
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