// Single front door for in-session execution: detect whether the current host
// exposes a subagent/agent callback, build ONE adapter for it, or fail cleanly.
// No subprocess fallback — headless CLI is a separate explicit path (--agent claude|…).

import type { AgentPort } from "./types";
import { detectKiroSubagentTool, makeKiroInSessionAdapter } from "./kiro-in-session";

export type InSessionProbeResult =
  | { ok: true; host: string; adapter: AgentPort }
  | { ok: false; reason: string };

export const IN_SESSION_UNAVAILABLE_HINT =
  "No in-session host callback detected in this process. " +
  "Wire makeInSessionAdapter({ invoke }) or makeKiroInSessionAdapter() in a host runner, " +
  "then call runInSessionWorkflow({ wfPath }, { adapter }). " +
  "For headless runs use omw run --agent claude|codex|fake.";

/** Detect an in-session host and return a ready adapter, or { ok:false }. */
export function probeInSessionHost(): InSessionProbeResult {
  if (detectKiroSubagentTool()) {
    return {
      ok: true,
      host: "kiro",
      adapter: makeKiroInSessionAdapter({ name: "in-session", tool: detectKiroSubagentTool() }),
    };
  }

  return { ok: false, reason: IN_SESSION_UNAVAILABLE_HINT };
}

/** Resolve an embedder probe: adapter or a structured missing signal (exit 3). */
export function resolveInSessionAdapter(probe: () => InSessionProbeResult = probeInSessionHost):
  | { adapter: AgentPort }
  | { missing: string; installHint: string } {
  const hit = probe();
  if (hit.ok) return { adapter: hit.adapter };
  return { missing: "in-session", installHint: hit.reason };
}