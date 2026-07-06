// Generic config-driven exec-adapter: spawn → exit-code/timeout → parse stdout.
// Covers the boilerplate every simple text CLI shares, so a per-CLI adapter is
// just a config (see hermes). Injected spawn → no subprocess.

import { test, expect, describe } from "bun:test";
import { makeExecAdapter, parseExecResult, type ExecAdapterConfig } from "../src/adapters/exec";

const cfg: ExecAdapterConfig = {
  name: "demo",
  bin: "demo-cli",
  argv: ({ prompt, model }) => {
    const a = ["run", prompt];
    if (model) a.push("--model", model);
    return a;
  },
};

describe("parseExecResult", () => {
  const id = (s: string) => s;
  test("exit 0 + text -> ok, parsed+trimmed stdout is the result", () => {
    const r = parseExecResult({ code: 0, stdout: "  pong\n", stderr: "" }, id, "demo");
    expect(r.ok && r.text).toBe("pong");
  });
  test("non-zero exit -> nonzero_exit with reason", () => {
    const r = parseExecResult({ code: 1, stdout: "", stderr: "boom" }, id, "demo");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("nonzero_exit");
    expect(r.stderr).toContain("boom");
  });
  test("exit 0 but empty parse -> ok:false (actionable, names the adapter)", () => {
    const r = parseExecResult({ code: 0, stdout: "   ", stderr: "" }, id, "demo");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.stderr).toContain("demo");
  });
  test("timedOut -> timeout", () => {
    const r = parseExecResult({ code: 0, stdout: "", stderr: "", timedOut: true }, id, "demo");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("timeout");
  });
  test("a custom parse extracts a field from stdout", () => {
    const parse = (s: string) => JSON.parse(s).answer as string;
    const r = parseExecResult({ code: 0, stdout: '{"answer":"42"}', stderr: "" }, parse, "demo");
    expect(r.ok && r.text).toBe("42");
  });
});

describe("makeExecAdapter", () => {
  test("invoke builds argv from config and returns parsed text", async () => {
    const calls: string[][] = [];
    const adapter = makeExecAdapter(cfg, {
      spawn: async (args) => {
        calls.push(args);
        return { code: 0, stdout: "hi", stderr: "" };
      },
    });
    const r = await adapter.invoke({ prompt: "p", model: "m1" });
    expect(r.ok && r.text).toBe("hi");
    expect(calls[0]).toEqual(["run", "p", "--model", "m1"]);
    expect(adapter.name).toBe("demo");
    expect(adapter.followUp).toBeUndefined();
  });

  test("a spawn throw -> spawn_failure, never throws", async () => {
    const adapter = makeExecAdapter(cfg, {
      spawn: async () => {
        throw new Error("ENOENT demo-cli");
      },
    });
    const r = await adapter.invoke({ prompt: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.kind).toBe("spawn_failure");
  });
});
