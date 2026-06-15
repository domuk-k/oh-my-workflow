// The contract every adapter implements. omw's only job is to be the thin
// deterministic glue between an orchestration script and these subprocess nodes.
// Kept tiny on purpose: a node is a whole coding agent, not a single LLM call.

/** Why an invocation failed. The journal records this `kind` so the authoring
 *  agent can read WHICH failure happened and repair its own script. */
export type AgentFailureKind = "timeout" | "nonzero_exit" | "spawn_failure";

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
};

export type AgentPort = {
  name: string;
  invoke(req: InvokeRequest): Promise<AgentResult>;
  /** Optional in-session follow-up (claude --resume). When absent, the runtime
   *  re-invokes fresh with the error feedback appended to the prompt. */
  followUp?(sessionId: string, prompt: string): Promise<AgentResult>;
};
