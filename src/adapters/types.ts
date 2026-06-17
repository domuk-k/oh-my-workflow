// The contract every adapter implements. omw's only job is to be the thin
// deterministic glue between an orchestration script and these subprocess nodes.
// Kept tiny on purpose: a node is a whole coding agent, not a single LLM call.

/** Why an invocation failed. The journal records this `kind` so the authoring
 *  agent can read WHICH failure happened and repair its own script.
 *  `refusal` is a DECLINE (the model said no — HTTP 200, `stop_reason:"refusal"`),
 *  kept distinct from a crash so an abstain-quorum can treat declined ≠ failed. */
export type AgentFailureKind = "timeout" | "nonzero_exit" | "spawn_failure" | "refusal";

export type AgentResult =
  | {
      ok: true;
      text: string;
      meta: {
        durationMs: number;
        /** Present when the adapter supports session resume (claude --resume). */
        sessionId?: string;
        costUsd?: number;
      };
    }
  | {
      ok: false;
      kind: AgentFailureKind;
      stderr?: string;
      meta?: { durationMs: number };
    };

export type InvokeRequest = {
  prompt: string;
  /** Tier alias ("fast" | "smart") or a raw model string passed through. */
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  /** When true, the node inherits the host's MCP servers (slow startup). Default
   *  false → the adapter isolates the node from host MCP config (claude:
   *  --strict-mcp-config). A coding-agent node rarely needs the host's servers,
   *  and booting them all is the dominant per-node latency in a fan-out. */
  inheritHostMcp?: boolean;
};

export type AgentPort = {
  name: string;
  invoke(req: InvokeRequest): Promise<AgentResult>;
  /** Optional in-session follow-up (claude --resume). When absent, the runtime
   *  re-invokes fresh with the error feedback appended to the prompt.
   *  `cwd` MUST match the original invoke: claude scopes conversation history by
   *  project directory, so resuming from a different cwd fails to find the
   *  session ("No conversation found"). */
  followUp?(sessionId: string, prompt: string, cwd?: string): Promise<AgentResult>;
};
