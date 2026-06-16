// CLI run command: argument parsing contract. Pure, deterministic — the input
// surface a stranger types is fixed here before any orchestration exists.

import { test, expect, describe } from "bun:test";
import { parseRunArgs, runWorkflow, resolveAdapter } from "../src/cli/run";
import { makeFakeAdapter } from "../src/adapters/fake";

describe("resolveAdapter", () => {
  test("fake is always available", () => {
    const r = resolveAdapter("fake", { workflow: async () => ({}) });
    expect("adapter" in r && r.adapter.name).toBe("fake");
  });

  test("claude resolves to the real adapter when the CLI is on PATH", () => {
    const r = resolveAdapter("claude", { workflow: async () => ({}) }, () => true);
    expect("adapter" in r && r.adapter.name).toBe("claude");
  });

  test("claude is adapter_missing (with install hint) when the CLI is absent", () => {
    const r = resolveAdapter("claude", { workflow: async () => ({}) }, () => false);
    expect("missing" in r && r.missing).toBe("claude");
    if (!("missing" in r)) throw new Error("expected missing");
    expect(r.installHint).toContain("claude");
  });

  test("codex resolves to the real adapter when the CLI is on PATH", () => {
    const r = resolveAdapter("codex", { workflow: async () => ({}) }, () => true);
    expect("adapter" in r && r.adapter.name).toBe("codex");
  });

  test("codex is adapter_missing when the CLI is absent", () => {
    const r = resolveAdapter("codex", { workflow: async () => ({}) }, () => false);
    expect("missing" in r && r.missing).toBe("codex");
  });

  test("an unknown adapter is missing with a fake fallback hint", () => {
    const r = resolveAdapter("nope", { workflow: async () => ({}) }, () => false);
    expect("missing" in r && r.missing).toBe("nope");
  });
});

describe("parseRunArgs", () => {
  test("parses wfPath, --agent, --args (JSON), --concurrency, --pretty", () => {
    const r = parseRunArgs([
      "examples/deep-research",
      "--agent",
      "fake",
      "--args",
      '{"q":"x"}',
      "--concurrency",
      "8",
      "--pretty",
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value).toEqual({
      wfPath: "examples/deep-research",
      agent: "fake",
      args: { q: "x" },
      concurrency: 8,
      pretty: true,
    });
  });
});

describe("runWorkflow", () => {
  test("runs a workflow against fake adapter; result JSON to stdout, journal bracketed", async () => {
    const lines: string[] = [];
    const loaded = {
      workflow: async (rt: any, args: any) => {
        rt.phase("Greet");
        const x = await rt.agent("hi");
        return { x, args };
      },
      fake: { default: { text: "yo" } },
    };

    const outcome = await runWorkflow(
      { wfPath: "w", agent: "fake", args: { q: 1 }, pretty: false },
      {
        loadWorkflow: async () => loaded,
        resolveAdapter: (_name, wf) => ({ adapter: makeFakeAdapter(wf.fake) }),
        journalSink: (l) => lines.push(l),
        now: () => 0,
        runId: () => "test",
      },
    );

    expect(outcome.exitCode).toBe(0);
    expect(JSON.parse(outcome.stdout!)).toEqual({ x: "yo", args: { q: 1 } });

    const evs = lines.map((l) => JSON.parse(l));
    expect(evs[0].ev).toBe("run_start");
    expect(evs[0].run).toBe("test");
    expect(evs[evs.length - 1].ev).toBe("run_end");
    expect(evs[evs.length - 1].ok).toBe(true);
    expect(evs.some((e) => e.ev === "phase" && e.title === "Greet")).toBe(true);
  });

  test("exit 3 + adapter_missing install_hint when the adapter is not installed", async () => {
    const outcome = await runWorkflow(
      { wfPath: "w", agent: "claude", args: undefined, pretty: false },
      {
        loadWorkflow: async () => ({ workflow: async () => ({}) }),
        resolveAdapter: () => ({ missing: "claude", installHint: "npm i -g @anthropic-ai/claude-code" }),
        journalSink: () => {},
        now: () => 0,
        runId: () => "test",
      },
    );
    expect(outcome.exitCode).toBe(3);
    expect(outcome.error).toEqual({
      error: "adapter_missing",
      adapter: "claude",
      install_hint: "npm i -g @anthropic-ai/claude-code",
    });
    expect(outcome.stdout).toBeUndefined();
  });

  test("exit 1 + script_error when the workflow body throws (script bug, not node failure)", async () => {
    const lines: string[] = [];
    const outcome = await runWorkflow(
      { wfPath: "w", agent: "fake", args: undefined, pretty: false },
      {
        loadWorkflow: async () => ({
          workflow: async () => {
            throw new Error("boom in script");
          },
          fake: {},
        }),
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter(wf.fake) }),
        journalSink: (l) => lines.push(l),
        now: () => 0,
        runId: () => "test",
      },
    );
    expect(outcome.exitCode).toBe(1);
    expect((outcome.error as any).error).toBe("script_error");
    expect((outcome.error as any).message).toContain("boom in script");
    // run is still bracketed: run_end{ok:false} so the journal is never orphaned.
    const evs = lines.map((l) => JSON.parse(l));
    expect(evs[evs.length - 1]).toMatchObject({ ev: "run_end", ok: false });
  });

  test("exit 1 + load_failed when the workflow module cannot be loaded", async () => {
    const outcome = await runWorkflow(
      { wfPath: "nope", agent: "fake", args: undefined, pretty: false },
      {
        loadWorkflow: async () => {
          throw new Error("Cannot find module");
        },
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter(wf.fake) }),
        journalSink: () => {},
        now: () => 0,
        runId: () => "test",
      },
    );
    expect(outcome.exitCode).toBe(1);
    expect((outcome.error as any).error).toBe("load_failed");
  });

  test("preserves the null-contract through a full fan-out spine: a failed node is dropped, run completes", async () => {
    // A miniature of the deep-research spine: 3 topics, one hard-fails, survivors
    // pass through filter(Boolean). Proves the CLI bracket doesn't break the
    // contract that agent() never throws and the run still completes green.
    const lines: string[] = [];
    const loaded = {
      workflow: async (rt: any) => {
        rt.phase("Search");
        const searched = await rt.parallel(
          ["a", "b", "c"].map((t) => () => rt.agent(`SEARCH ${t}`, { label: `search:${t}` })),
        );
        return { found: searched.filter(Boolean) };
      },
      fake: {
        rules: [
          { match: (p: string) => p.includes("SEARCH a"), responses: [{ text: "A" }] },
          { match: (p: string) => p.includes("SEARCH b"), responses: [{ fail: "timeout" as const }] },
          { match: (p: string) => p.includes("SEARCH c"), responses: [{ text: "C" }] },
        ],
      },
    };

    const rejections: unknown[] = [];
    const onRej = (r: unknown) => rejections.push(r);
    process.on("unhandledRejection", onRej);

    const outcome = await runWorkflow(
      { wfPath: "w", agent: "fake", args: undefined, pretty: false },
      {
        loadWorkflow: async () => loaded,
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter(wf.fake) }),
        journalSink: (l) => lines.push(l),
        now: () => 0,
        runId: () => "test",
      },
    );

    await new Promise((r) => setTimeout(r, 0));
    process.off("unhandledRejection", onRej);

    expect(outcome.exitCode).toBe(0);
    expect(JSON.parse(outcome.stdout!)).toEqual({ found: ["A", "C"] });
    expect(rejections).toEqual([]);

    // every agent_start pairs with an agent_end (no orphans), exactly one failure.
    const evs = lines.map((l) => JSON.parse(l));
    const starts = evs.filter((e) => e.ev === "agent_start");
    const ends = evs.filter((e) => e.ev === "agent_end");
    expect(starts.length).toBe(3);
    expect(ends.length).toBe(3);
    expect(ends.filter((e) => e.ok === false).map((e) => e.kind)).toEqual(["timeout"]);
  });
});
