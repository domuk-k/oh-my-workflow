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
        /** Output tokens this node produced, when the adapter reports them.
         *  Feeds budget accounting (the shared spend counter). */
        outputTokens?: number;
      };
    }
  | {
      ok: false;
      kind: AgentFailureKind;
      stderr?: string;
      /** A failure can still report tokens (an error/refusal envelope often
       *  carries `usage`), so budget accounting counts it. A token-less failure
       *  (e.g. a killed timeout) simply omits it. */
      meta?: { durationMs: number; outputTokens?: number };
    };

export type InvokeRequest = {
  prompt: string;
  /** Tier alias ("fast" | "smart") or a raw model string passed through. */
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  /** When true, the node inherits the ambient MCP configuration the CLI would
   *  normally discover — user/global servers AND the cwd's project `.mcp.json`.
   *  Default false → the node runs isolated: booting those servers on every node
   *  is the dominant per-node latency in a fan-out, and inheriting them makes a
   *  workflow non-reproducible (it behaves differently per machine). A coding-agent
   *  node rarely needs them. Honored by the claude adapter (--strict-mcp-config);
   *  the codex adapter does not yet implement isolation, so it is a no-op there. */
  inheritMcp?: boolean;
  /** Reasoning-effort hint, passed through to adapters that support it. Adapters
   *  with no faithful flag (e.g. claude -p today) drop it and warn once. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Cross-vendor node profile (a named agent persona). Adapters map it where
   *  they can; otherwise drop + warn once (honest-scope). */
  agentType?: string;
};

/** The subset of InvokeRequest a resume turn must mirror from its original
 *  invoke so the repair runs in the same environment and obeys the same bounds. */
export type FollowUpOpts = Pick<InvokeRequest, "cwd" | "inheritMcp" | "timeoutMs">;

export type AgentPort = {
  name: string;
  invoke(req: InvokeRequest): Promise<AgentResult>;
  /** Optional in-session follow-up (claude --resume). When absent, the runtime
   *  re-invokes fresh with the error feedback appended to the prompt.
   *  `opts.cwd` MUST match the original invoke: claude scopes conversation history
   *  by project directory, so resuming from a different cwd fails to find the
   *  session ("No conversation found"). `opts.inheritMcp` must mirror the
   *  original invoke so the resume turn sees the same MCP environment.
   *  `opts.timeoutMs` must mirror the original invoke so a schema-repair resume
   *  turn cannot hang longer than the node it is repairing. */
  followUp?(sessionId: string, prompt: string, opts?: FollowUpOpts): Promise<AgentResult>;
};
