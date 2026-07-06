// LIVE smoke for the claude adapter's real spawn path (Bun.spawn → claude -p).
// Skipped by default; runs only under OMW_LIVE=1 (real CLI, real API, small cost).
// Everything else about the adapter is covered deterministically with an injected
// spawn in adapters.claude.test.ts — this exists to prove the default path works.

import { test, expect } from "bun:test";
import { makeClaudeAdapter } from "../src/adapters/claude";

const LIVE = process.env.OMW_LIVE === "1";

test.skipIf(!LIVE)(
  "live: invoke real `claude -p` returns ok with text + sessionId",
  async () => {
    const adapter = makeClaudeAdapter();
    const r = await adapter.invoke({
      prompt: "Reply with exactly the single word: pong",
      timeoutMs: 60_000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`expected ok, got ${r.kind}: ${r.stderr}`);
    expect(r.text.toLowerCase()).toContain("pong");
    expect(typeof r.meta.sessionId).toBe("string");
  },
  70_000,
);
