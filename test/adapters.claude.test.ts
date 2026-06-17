// claude adapter: parse the real `claude -p --output-format json` payload into
// our AgentResult, renaming claude's snake_case fields to our contract. The
// success fixture is REAL captured output (test/fixtures/claude-result.success.json);
// the error shape is synthesized (hard to provoke deterministically live).
//
// invoke()/followUp() are tested with an injected spawn so no subprocess or API
// call happens in the suite — the live path is exercised separately under OMW_LIVE.

import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClaudeResult, makeClaudeAdapter } from "../src/adapters/claude";

const golden = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "claude-result.success.json"), "utf8"),
);

describe("parseClaudeResult", () => {
  test("maps a successful result, renaming session_id/total_cost_usd/duration_ms", () => {
    const r = parseClaudeResult(golden);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.text).toBe("pong");
    expect(r.meta.sessionId).toBe(golden.session_id);
    expect(r.meta.costUsd).toBe(golden.total_cost_usd);
    expect(r.meta.durationMs).toBe(golden.duration_ms);
  });

  test("is_error:true -> ok:false with subtype+result surfaced in stderr", () => {
    const errJson = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "the model hit an error",
      session_id: "s-err",
      duration_ms: 10,
      total_cost_usd: 0.01,
    };
    const r = parseClaudeResult(errJson);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("nonzero_exit");
    expect(r.stderr).toContain("error_during_execution");
    expect(r.stderr).toContain("the model hit an error");
  });

  test("a non-result payload (e.g. truncated) -> ok:false", () => {
    const r = parseClaudeResult({ type: "system", subtype: "init" });
    expect(r.ok).toBe(false);
  });

  // A safety/decline refusal is HTTP 200 with stop_reason "refusal" (captured
  // shape — not yet verified against a live CLI refusal). It must read as a
  // DECLINE, not a crash, so the abstain-quorum can treat declined ≠ failed.
  test("a refusal (stop_reason:refusal, HTTP 200) -> ok:false with kind 'refusal'", () => {
    const refusalJson = {
      type: "result",
      subtype: "refusal",
      is_error: false,
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
      result: "",
      session_id: "s-ref",
      duration_ms: 5,
    };
    const r = parseClaudeResult(refusalJson);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("refusal");
    // the decline category is journaled so the reason stays auditable
    expect(r.stderr).toContain("cyber");
  });

  // A decline can arrive with subtype:"success" + is_error:false (the request
  // didn't error, the model just declined). It must STILL read as a refusal —
  // classified before the envelope check — not as an empty ok:true success.
  test("a refusal with subtype:'success' is still kind 'refusal', not an empty ok", () => {
    const r = parseClaudeResult({
      type: "result",
      subtype: "success",
      is_error: false,
      stop_reason: "refusal",
      stop_details: { category: "bio" },
      result: "",
      duration_ms: 3,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected refusal, got ok");
    expect(r.kind).toBe("refusal");
    expect(r.stderr).toContain("bio");
  });
});

describe("makeClaudeAdapter (injected spawn)", () => {
  test("invoke spawns `claude -p <prompt> --output-format json` and parses stdout", async () => {
    const calls: string[][] = [];
    const adapter = makeClaudeAdapter({
      spawn: async (args) => {
        calls.push(args);
        return { code: 0, stdout: JSON.stringify(golden), stderr: "" };
      },
    });
    const r = await adapter.invoke({ prompt: "say pong" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.text).toBe("pong");
    expect(calls[0]).toContain("-p");
    expect(calls[0]).toContain("say pong");
    expect(calls[0]).toContain("--output-format");
    expect(calls[0]).toContain("json");
  });

  test("invoke passes --model when a model is requested", async () => {
    const calls: string[][] = [];
    const adapter = makeClaudeAdapter({
      spawn: async (args) => {
        calls.push(args);
        return { code: 0, stdout: JSON.stringify(golden), stderr: "" };
      },
    });
    await adapter.invoke({ prompt: "x", model: "claude-opus-4-8" });
    expect(calls[0]).toContain("--model");
    expect(calls[0]).toContain("claude-opus-4-8");
  });

  test("followUp passes --resume <sessionId> to continue the session", async () => {
    const calls: string[][] = [];
    const adapter = makeClaudeAdapter({
      spawn: async (args) => {
        calls.push(args);
        return { code: 0, stdout: JSON.stringify(golden), stderr: "" };
      },
    });
    await adapter.followUp!("sess-123", "and again");
    expect(calls[0]).toContain("--resume");
    expect(calls[0]).toContain("sess-123");
  });

  test("a non-zero exit (no JSON) -> ok:false nonzero_exit, never throws", async () => {
    const adapter = makeClaudeAdapter({
      spawn: async () => ({ code: 1, stdout: "", stderr: "boom" }),
    });
    const r = await adapter.invoke({ prompt: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("nonzero_exit");
    expect(r.stderr).toContain("boom");
  });

  test("a timed-out spawn -> ok:false timeout (distinct kind), never throws", async () => {
    const adapter = makeClaudeAdapter({
      spawn: async () => ({ code: 143, stdout: "", stderr: "", timedOut: true }),
    });
    const r = await adapter.invoke({ prompt: "x", timeoutMs: 50 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("timeout");
  });

  test("a spawn throw -> ok:false spawn_failure, never throws", async () => {
    const adapter = makeClaudeAdapter({
      spawn: async () => {
        throw new Error("ENOENT claude");
      },
    });
    const r = await adapter.invoke({ prompt: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("spawn_failure");
  });
});
