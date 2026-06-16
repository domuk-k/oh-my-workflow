// LIVE smoke for the codex adapter's real spawn path (Bun.spawn → codex exec).
// Skipped unless OMW_LIVE=1 (real CLI, real API, small cost). read-only sandbox
// keeps it side-effect free. Deterministic coverage lives in adapters.codex.test.ts.

import { test, expect } from "bun:test";
import { makeCodexAdapter } from "../src/adapters/codex";

const LIVE = process.env.OMW_LIVE === "1";

test.skipIf(!LIVE)(
  "live: invoke real `codex exec --json` returns ok with text + sessionId",
  async () => {
    const adapter = makeCodexAdapter({ sandbox: "read-only" });
    const r = await adapter.invoke({
      prompt: "Reply with exactly the single word: pong",
      timeoutMs: 90_000,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(`expected ok, got ${r.kind}: ${r.stderr}`);
    expect(r.text.toLowerCase()).toContain("pong");
    expect(typeof r.meta.sessionId).toBe("string");
  },
  100_000,
);
