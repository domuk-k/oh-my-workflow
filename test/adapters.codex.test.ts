// codex adapter (experimental): parse `codex exec --json` JSONL into AgentResult.
// codex streams dot-notation events — thread.started(thread_id) → turn.started →
// item.completed(agent_message.text) → turn.completed(usage). There is no cost
// field (tokens only), so costUsd stays undefined. The success fixture is REAL
// captured output; error/malformed shapes are synthesized.
//
// Per openai/codex#15451 the JSONL stream can carry malformed lines; the parser
// tolerates them line-by-line and, if no final agent_message is found, fails
// ACTIONABLY (surfaces the reason) rather than silently returning empty.

import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCodexJsonl, makeCodexAdapter } from "../src/adapters/codex";

const goldenJsonl = readFileSync(join(import.meta.dir, "fixtures", "codex-result.success.jsonl"), "utf8");

describe("parseCodexJsonl", () => {
  test("extracts the last agent_message text + thread_id as sessionId", () => {
    const r = parseCodexJsonl(goldenJsonl);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.text).toBe("pong");
    expect(r.meta.sessionId).toBe("019ecaaf-a620-7e42-b55d-3f1ce4b25c7b");
  });

  test("turn.failed / error event -> ok:false with the reason surfaced", () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.started"}',
      '{"type":"error","message":"401 Unauthorized"}',
      '{"type":"turn.failed"}',
    ].join("\n");
    const r = parseCodexJsonl(jsonl);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("nonzero_exit");
    expect(r.stderr).toContain("401");
  });

  test("tolerates malformed JSONL lines (#15451) and still extracts the message", () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t1"}',
      "this is not json — a malformed line",
      '{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}',
      '{"type":"turn.completed","usage":{}}',
    ].join("\n");
    const r = parseCodexJsonl(jsonl);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.text).toBe("hello");
  });

  test("output present but no agent_message -> ok:false, ACTIONABLE (not silent)", () => {
    const jsonl = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.completed","usage":{}}',
    ].join("\n");
    const r = parseCodexJsonl(jsonl);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.stderr).toContain("no agent_message");
  });

  test("takes the LAST agent_message when several are present", () => {
    const jsonl = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"final"}}',
      '{"type":"turn.completed","usage":{}}',
    ].join("\n");
    const r = parseCodexJsonl(jsonl);
    expect(r.ok && r.text).toBe("final");
  });
});

describe("makeCodexAdapter (injected spawn)", () => {
  test("invoke runs `codex exec --json -s <sandbox> <prompt>`", async () => {
    const calls: string[][] = [];
    const adapter = makeCodexAdapter({
      spawn: async (args) => {
        calls.push(args);
        return { code: 0, stdout: goldenJsonl, stderr: "" };
      },
    });
    const r = await adapter.invoke({ prompt: "say pong" });
    expect(r.ok).toBe(true);
    expect(calls[0]).toContain("exec");
    expect(calls[0]).toContain("--json");
    expect(calls[0]).toContain("say pong");
    expect(calls[0]).toContain("-s"); // sandbox flag present
  });

  test("invoke passes -m <model> when requested", async () => {
    const calls: string[][] = [];
    const adapter = makeCodexAdapter({
      spawn: async (args) => {
        calls.push(args);
        return { code: 0, stdout: goldenJsonl, stderr: "" };
      },
    });
    await adapter.invoke({ prompt: "x", model: "gpt-5" });
    expect(calls[0]).toContain("-m");
    expect(calls[0]).toContain("gpt-5");
  });

  test("followUp uses `exec resume <sessionId> <prompt>`", async () => {
    const calls: string[][] = [];
    const adapter = makeCodexAdapter({
      spawn: async (args) => {
        calls.push(args);
        return { code: 0, stdout: goldenJsonl, stderr: "" };
      },
    });
    await adapter.followUp!("thread-9", "again");
    expect(calls[0]).toContain("resume");
    expect(calls[0]).toContain("thread-9");
  });

  test("followUp forwards timeoutMs so schema repair cannot hang forever", async () => {
    const opts: any[] = [];
    const adapter = makeCodexAdapter({
      spawn: async (_args, spawnOpts) => {
        opts.push(spawnOpts);
        return { code: 0, stdout: goldenJsonl, stderr: "" };
      },
    });
    await adapter.followUp!("thread-9", "again", { timeoutMs: 777 });
    expect(opts[0]?.timeoutMs).toBe(777);
  });

  test("a spawn throw -> ok:false spawn_failure, never throws", async () => {
    const adapter = makeCodexAdapter({
      spawn: async () => {
        throw new Error("ENOENT codex");
      },
    });
    const r = await adapter.invoke({ prompt: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("spawn_failure");
  });

  test("empty output + non-zero exit -> ok:false nonzero_exit", async () => {
    const adapter = makeCodexAdapter({
      spawn: async () => ({ code: 1, stdout: "", stderr: "boom" }),
    });
    const r = await adapter.invoke({ prompt: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("nonzero_exit");
    expect(r.stderr).toContain("boom");
  });
});
