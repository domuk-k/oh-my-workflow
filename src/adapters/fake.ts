// The fake adapter is two things at once: the test double for the whole suite,
// AND the engine behind `--agent fake` — the free, deterministic, no-API-key
// try-it path that proves the spine (pipeline/parallel/phase + journal +
// self-repair loop) for a stranger before they touch a real agent. So it is
// real product code, not just a mock.

import type { AgentPort, AgentResult, AgentFailureKind, InvokeRequest } from "./types";

export type FakeResponse =
  | { text: string; sessionId?: string; costUsd?: number; outputTokens?: number }
  | { fail: AgentFailureKind; stderr?: string };

export type FakeRule = {
  match: (prompt: string) => boolean;
  responses: FakeResponse[];
};

export type FakeAdapterOptions = {
  rules?: FakeRule[];
  default?: FakeResponse;
  durationMs?: number;
};

function toResult(r: FakeResponse, durationMs: number): AgentResult {
  if ("fail" in r) {
    return { ok: false, kind: r.fail, stderr: r.stderr, meta: { durationMs } };
  }
  return {
    ok: true,
    text: r.text,
    meta: { durationMs, sessionId: r.sessionId, costUsd: r.costUsd, outputTokens: r.outputTokens },
  };
}

export function makeFakeAdapter(opts: FakeAdapterOptions = {}): AgentPort {
  const rules = opts.rules ?? [];
  const durationMs = opts.durationMs ?? 0;
  const fallback: FakeResponse = opts.default ?? { text: "{}" };
  // Per-rule cursor so a sequence advances across invocations and sticks on last.
  const cursors = new Map<FakeRule, number>();
  // sessionId -> issuing rule, so followUp continues the right conversation even
  // when the retry prompt no longer matches the original rule's predicate.
  const sessionRule = new Map<string, FakeRule>();

  const advance = (rule: FakeRule): FakeResponse => {
    const i = cursors.get(rule) ?? 0;
    const idx = Math.min(i, rule.responses.length - 1);
    cursors.set(rule, i + 1);
    const resp = rule.responses[idx] ?? fallback;
    if ("text" in resp && resp.sessionId) sessionRule.set(resp.sessionId, rule);
    return resp;
  };

  const nextForPrompt = (prompt: string): FakeResponse => {
    const rule = rules.find((r) => r.match(prompt));
    if (!rule || rule.responses.length === 0) return fallback;
    return advance(rule);
  };

  return {
    name: "fake",
    async invoke(req: InvokeRequest): Promise<AgentResult> {
      return toResult(nextForPrompt(req.prompt), durationMs);
    },
    async followUp(sessionId: string, prompt: string): Promise<AgentResult> {
      const rule = sessionRule.get(sessionId);
      return toResult(rule ? advance(rule) : nextForPrompt(prompt), durationMs);
    },
  };
}
