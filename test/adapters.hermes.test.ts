// hermes adapter (experimental): `hermes -z <prompt>` prints ONLY the response
// text to stdout — so stdout IS the result. No JSON envelope, no followUp (the
// schema gate falls back to fresh invokes). Tested with an injected spawn so no
// subprocess / tokens are spent in the suite.

import { test, expect, describe } from "bun:test";
import { parseHermesResult, makeHermesAdapter } from "../src/adapters/hermes";

describe("parseHermesResult", () => {
  test("exit 0 + text -> ok, stdout is the result (trimmed)", () => {
    const r = parseHermesResult({ code: 0, stdout: "  pong\n", stderr: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.text).toBe("pong");
  });

  test("non-zero exit -> ok:false nonzero_exit with reason surfaced", () => {
    const r = parseHermesResult({ code: 1, stdout: "", stderr: "no provider configured" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("nonzero_exit");
    expect(r.stderr).toContain("no provider");
  });

  test("exit 0 but empty output -> ok:false (actionable, not silent)", () => {
    const r = parseHermesResult({ code: 0, stdout: "   \n", stderr: "" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("nonzero_exit");
    expect(r.stderr).toContain("no output");
  });

  test("timedOut -> ok:false timeout", () => {
    const r = parseHermesResult({ code: 0, stdout: "", stderr: "", timedOut: true });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("timeout");
  });
});

describe("makeHermesAdapter (injected spawn)", () => {
  test("invoke runs `hermes -z <prompt> --yolo`", async () => {
    const calls: string[][] = [];
    const adapter = makeHermesAdapter({
      spawn: async (args) => {
        calls.push(args);
        return { code: 0, stdout: "ok", stderr: "" };
      },
    });
    const r = await adapter.invoke({ prompt: "say pong" });
    expect(r.ok).toBe(true);
    expect(calls[0]).toContain("-z");
    expect(calls[0]).toContain("say pong");
    expect(calls[0]).toContain("--yolo");
  });

  test("invoke passes -m <model> when requested", async () => {
    const calls: string[][] = [];
    const adapter = makeHermesAdapter({
      spawn: async (args) => {
        calls.push(args);
        return { code: 0, stdout: "ok", stderr: "" };
      },
    });
    await adapter.invoke({ prompt: "x", model: "anthropic/claude-sonnet-4.6" });
    expect(calls[0]).toContain("-m");
    expect(calls[0]).toContain("anthropic/claude-sonnet-4.6");
  });

  test("no followUp (schema gate uses fresh invokes for hermes)", () => {
    const adapter = makeHermesAdapter({ spawn: async () => ({ code: 0, stdout: "ok", stderr: "" }) });
    expect(adapter.followUp).toBeUndefined();
  });

  test("a spawn throw -> ok:false spawn_failure, never throws", async () => {
    const adapter = makeHermesAdapter({
      spawn: async () => {
        throw new Error("ENOENT hermes");
      },
    });
    const r = await adapter.invoke({ prompt: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("spawn_failure");
  });
});
