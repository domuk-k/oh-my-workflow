// hermes adapter (experimental) — a config over the generic exec-adapter. These
// tests pin the hermes-specific config (argv shape, no followUp). The generic
// spawn/parse behavior is covered in adapters.exec.test.ts. Injected spawn → no
// subprocess / tokens.

import { test, expect, describe } from "bun:test";
import { makeHermesAdapter, hermesExec } from "../src/adapters/hermes";

describe("hermes adapter (config over exec)", () => {
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

  test("name is hermes; no followUp (schema gate uses fresh invokes)", () => {
    expect(hermesExec.name).toBe("hermes");
    const adapter = makeHermesAdapter({ spawn: async () => ({ code: 0, stdout: "ok", stderr: "" }) });
    expect(adapter.name).toBe("hermes");
    expect(adapter.followUp).toBeUndefined();
  });
});
