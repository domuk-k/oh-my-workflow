// CLI run command: argument parsing contract. Pure, deterministic — the input
// surface a stranger types is fixed here before any orchestration exists.

import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunArgs, runCommand, runWorkflow, resolveAdapter } from "../src/cli/run";
import { makeFakeAdapter } from "../src/adapters/fake";
import { makeResumeIndexFromLines } from "../src/resume";

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

  test("hermes resolves to the real adapter when the CLI is on PATH", () => {
    const r = resolveAdapter("hermes", { workflow: async () => ({}) }, () => true);
    expect("adapter" in r && r.adapter.name).toBe("hermes");
  });

  test("hermes is adapter_missing (with install hint) when the CLI is absent", () => {
    const r = resolveAdapter("hermes", { workflow: async () => ({}) }, () => false);
    expect("missing" in r && r.missing).toBe("hermes");
    if (!("missing" in r)) throw new Error("expected missing");
    expect(r.installHint).toContain("Hermes");
  });

  test("an unknown adapter is missing with a fake fallback hint", () => {
    const r = resolveAdapter("nope", { workflow: async () => ({}) }, () => false);
    expect("missing" in r && r.missing).toBe("nope");
  });

  test("auto uses OMW_AGENT when it is set", () => {
    const r = resolveAdapter("auto", { workflow: async () => ({}) }, (bin) => bin === "codex", { OMW_AGENT: "codex" });
    expect("adapter" in r && r.adapter.name).toBe("codex");
  });

  test("auto allows OMW_AGENT=fake for deterministic demos", () => {
    const r = resolveAdapter("auto", { workflow: async () => ({}) }, () => false, { OMW_AGENT: "fake" });
    expect("adapter" in r && r.adapter.name).toBe("fake");
  });

  test("auto prefers host hints before installed fallback order", () => {
    const r = resolveAdapter(
      "auto",
      { workflow: async () => ({}) },
      (bin) => bin === "claude" || bin === "codex",
      { CODEX_SANDBOX: "workspace-write" },
    );
    expect("adapter" in r && r.adapter.name).toBe("codex");
  });

  test("auto falls back to the first installed supported CLI", () => {
    const r = resolveAdapter("auto", { workflow: async () => ({}) }, (bin) => bin === "claude", {});
    expect("adapter" in r && r.adapter.name).toBe("claude");
  });

  test("auto is adapter_missing when no supported CLI is installed", () => {
    const r = resolveAdapter("auto", { workflow: async () => ({}) }, () => false, {});
    expect("missing" in r && r.missing).toBe("auto");
    if (!("missing" in r)) throw new Error("expected missing");
    expect(r.installHint).toContain("OMW_AGENT");
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
      strict: false,
    });
  });

  test("defaults --agent to auto so skills can call omw run directly", () => {
    const r = parseRunArgs([".omw/workflows/review.ts"]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.agent).toBe("auto");
  });

  test("parses --budget (positive int) and --strict (boolean)", () => {
    const r = parseRunArgs(["w", "--agent", "fake", "--budget", "5000", "--strict"]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.budget).toBe(5000);
    expect(r.value.strict).toBe(true);
  });

  test("--budget must be a positive integer", () => {
    expect(parseRunArgs(["w", "--agent", "fake", "--budget", "0"]).ok).toBe(false);
    expect(parseRunArgs(["w", "--agent", "fake", "--budget", "x"]).ok).toBe(false);
    expect(parseRunArgs(["w", "--agent", "fake", "--budget"]).ok).toBe(false);
  });

  test("parses --resume <journal> into RunOptions.resume", () => {
    const r = parseRunArgs(["w", "--agent", "fake", "--resume", ".omw/r-1.jsonl"]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.resume).toBe(".omw/r-1.jsonl");
  });

  test("--resume with no path (trailing flag) or an empty value is a usage error", () => {
    expect(parseRunArgs(["w", "--agent", "fake", "--resume"]).ok).toBe(false);
    expect(parseRunArgs(["w", "--agent", "fake", "--resume", ""]).ok).toBe(false);
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

describe("runWorkflow — authoring surface (destructured DI + legacy bridge)", () => {
  test("a destructured-DI workflow runs and a legacy (rt,args) workflow runs with a deprecation notice", async () => {
    const errs: string[] = [];
    const di = {
      workflow: async ({ agent }: any, args: any) => ({ di: await agent("go"), args }),
      fake: { default: { text: "ok" as const } },
    };
    const out1 = await runWorkflow(
      { wfPath: "x", agent: "fake", args: 7, pretty: false } as any,
      {
        loadWorkflow: async () => di as any,
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }),
        journalSink: () => {},
        now: () => 0,
        runId: () => "t",
        stderr: (s) => errs.push(s),
      },
    );
    expect(out1.exitCode).toBe(0);
    expect(JSON.parse(out1.stdout!)).toEqual({ di: "ok", args: 7 });
    expect(errs.join("")).not.toContain("deprecat");

    const legacy = {
      workflow: async (rt: any) => ({ leg: await rt.agent("go") }),
      fake: { default: { text: "ok" as const } },
    };
    const out2 = await runWorkflow(
      { wfPath: "x", agent: "fake", args: null, pretty: false } as any,
      {
        loadWorkflow: async () => legacy as any,
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }),
        journalSink: () => {},
        now: () => 0,
        runId: () => "t",
        stderr: (s) => errs.push(s),
      },
    );
    expect(out2.exitCode).toBe(0);
    expect(errs.join("")).toContain("deprecat");
  });

  test("a NAMED destructured-DI workflow is not misflagged as legacy (no deprecation)", async () => {
    const errs: string[] = [];
    // `function deepResearch({ agent }, args)` — named + destructured (the shipped
    // example's shape). Must not trip the legacy-shape sniff.
    const named = {
      workflow: async function deepResearch({ agent }: any, args: any) {
        return { x: await agent("go"), args };
      },
      fake: { default: { text: "ok" as const } },
    };
    const out = await runWorkflow(
      { wfPath: "x", agent: "fake", args: 1, pretty: false } as any,
      {
        loadWorkflow: async () => named as any,
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }),
        journalSink: () => {},
        now: () => 0,
        runId: () => "t",
        stderr: (s) => errs.push(s),
      },
    );
    expect(out.exitCode).toBe(0);
    expect(errs.join("")).not.toContain("deprecat");
  });

  test("workflow() runs a nested child (sharing the parent adapter) and returns its value", async () => {
    const child = {
      workflow: async ({ agent }: any, a: any) => ({ child: await agent("c"), got: a }),
      fake: {},
    };
    const parent = {
      workflow: async ({ workflow }: any) => ({ nested: await workflow({ scriptPath: "child" }, 9) }),
      fake: {
        rules: [
          { match: (p: string) => p === "c", responses: [{ text: "kid" as const }] },
          { match: () => true, responses: [{ text: "P" as const }] },
        ],
      },
    };
    const byPath: Record<string, any> = { parent, child };
    const out = await runWorkflow(
      { wfPath: "parent", agent: "fake", args: null, pretty: false } as any,
      {
        loadWorkflow: async (p: string) => byPath[p],
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }),
        journalSink: () => {},
        now: () => 0,
        runId: () => "t",
      },
    );
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout!)).toEqual({ nested: { child: "kid", got: 9 } });
  });

  test("workflow() nesting is one level only — a grandchild call throws", async () => {
    const grandchild = { workflow: async () => ({}), fake: {} };
    const child = {
      workflow: async ({ workflow }: any) => ({ deep: await workflow({ scriptPath: "grandchild" }) }),
      fake: {},
    };
    const parent = {
      workflow: async ({ workflow }: any) => ({ nested: await workflow({ scriptPath: "child" }) }),
      fake: { default: { text: "x" as const } },
    };
    const byPath: Record<string, any> = { parent, child, grandchild };
    const out = await runWorkflow(
      { wfPath: "parent", agent: "fake", args: null, pretty: false } as any,
      {
        loadWorkflow: async (p: string) => byPath[p],
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }),
        journalSink: () => {},
        now: () => 0,
        runId: () => "t",
      },
    );
    expect(out.exitCode).toBe(1);
    expect((out.error as any).message).toContain("one level");
  });
});

describe("runWorkflow — --budget halts a loop", () => {
  test("a budget-unbounded loop terminates once the ceiling is hit (BudgetExceededError → exit 1)", async () => {
    // A loop that spends until the budget throws — proving the ceiling is wired
    // from the CLI option through makeRuntime to agent().
    const loaded = {
      workflow: async ({ agent }: any) => {
        let n = 0;
        while (true) {
          await agent(`step ${n++}`); // each spends 40; throws once spent >= 100
        }
      },
      fake: { default: { text: "x" as const, outputTokens: 40 } },
    };
    const out = await runWorkflow(
      { wfPath: "w", agent: "fake", args: undefined, pretty: false, budget: 100 } as any,
      {
        loadWorkflow: async () => loaded as any,
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }),
        journalSink: () => {},
        now: () => 0,
        runId: () => "t",
      },
    );
    expect(out.exitCode).toBe(1);
    expect((out.error as any).error).toBe("script_error");
    expect((out.error as any).message).toContain("budget exhausted");
  });
});

describe("runWorkflow — --strict determinism sandbox", () => {
  test("forbids Date.now() in the body under strict (exit 1, mentions strict); allows it otherwise", async () => {
    const loaded = {
      workflow: async () => ({ t: Date.now() }),
      fake: { default: { text: "x" as const } },
    };
    const mk = (strict: boolean) =>
      runWorkflow(
        { wfPath: "w", agent: "fake", args: undefined, pretty: false, strict } as any,
        {
          loadWorkflow: async () => loaded as any,
          resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }),
          journalSink: () => {},
          now: () => 0,
          runId: () => "t",
        },
      );

    const strictOut = await mk(true);
    expect(strictOut.exitCode).toBe(1);
    expect((strictOut.error as any).error).toBe("script_error");
    expect((strictOut.error as any).message).toContain("strict");

    const looseOut = await mk(false);
    expect(looseOut.exitCode).toBe(0);
  });

  test("concurrent --strict runs do not corrupt the global Date after both finish (reentrancy)", async () => {
    const REAL_DATE = globalThis.Date;
    const mk = () => {
      const loaded = {
        // Body yields at a timer so the two runs' strict windows overlap; it
        // touches no Date/Math.random so it stays valid under --strict.
        workflow: async ({ agent }: any) => {
          await new Promise((r) => setTimeout(r, 5));
          return { x: await agent("go") };
        },
        fake: { default: { text: "ok" as const } },
      };
      return runWorkflow(
        { wfPath: "w", agent: "fake", args: undefined, pretty: false, strict: true } as any,
        {
          loadWorkflow: async () => loaded as any,
          resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }),
          journalSink: () => {},
          now: () => 0,
          runId: () => "t",
        },
      );
    };
    try {
      const [a, b] = await Promise.all([mk(), mk()]);
      expect(a.exitCode).toBe(0);
      expect(b.exitCode).toBe(0);
      // The buggy save/restore would leave a throwing StrictDate installed.
      expect(() => Date.now()).not.toThrow();
      expect(typeof Date.now()).toBe("number");
    } finally {
      globalThis.Date = REAL_DATE; // belt-and-suspenders so a failure can't poison the suite
    }
  });

  test("withStrict restores globals even when patching partially fails mid-setup", async () => {
    const REAL_DATE = globalThis.Date;
    const REAL_RANDOM = Math.random;
    // Freeze Math.random so the patch assignment throws AFTER Date was patched —
    // the partial-patch hazard. The fix must still restore Date (not leave the
    // throwing StrictDate installed).
    Object.defineProperty(Math, "random", { value: REAL_RANDOM, writable: false, configurable: true });
    try {
      const loaded = {
        workflow: async ({ agent }: any) => ({ x: await agent("go") }),
        fake: { default: { text: "ok" as const } },
      };
      const out = await runWorkflow(
        { wfPath: "w", agent: "fake", args: undefined, pretty: false, strict: true } as any,
        {
          loadWorkflow: async () => loaded as any,
          resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }),
          journalSink: () => {},
          now: () => 0,
          runId: () => "t",
        },
      );
      expect(out.exitCode).toBe(1); // patching threw → script_error
      expect(globalThis.Date).toBe(REAL_DATE); // …but Date was restored, not leaked
      expect(() => Date.now()).not.toThrow();
    } finally {
      Object.defineProperty(Math, "random", { value: REAL_RANDOM, writable: true, configurable: true });
      globalThis.Date = REAL_DATE;
    }
  });

  test("withStrict restore is fault-tolerant: a global frozen mid-run does not strand the OTHER global", async () => {
    const REAL_DATE = globalThis.Date;
    const REAL_RANDOM = Math.random;
    try {
      const loaded = {
        // Inside the run, freeze globalThis.Date so the finally's Date-restore
        // throws. The Math.random restore must still happen (independent restore).
        workflow: async ({ agent }: any) => {
          Object.defineProperty(globalThis, "Date", { value: globalThis.Date, writable: false, configurable: true });
          return { x: await agent("go") };
        },
        fake: { default: { text: "ok" as const } },
      };
      await runWorkflow(
        { wfPath: "w", agent: "fake", args: undefined, pretty: false, strict: true } as any,
        {
          loadWorkflow: async () => loaded as any,
          resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }),
          journalSink: () => {},
          now: () => 0,
          runId: () => "t",
        },
      );
      // Date restore threw (it's frozen), but Math.random must NOT be left as the
      // throwing boom — the restore of the other global must still run.
      expect(() => Math.random()).not.toThrow();
      expect(Math.random).toBe(REAL_RANDOM);
    } finally {
      Object.defineProperty(globalThis, "Date", { value: REAL_DATE, writable: true, configurable: true });
      Object.defineProperty(Math, "random", { value: REAL_RANDOM, writable: true, configurable: true });
    }
  });
});

describe("runWorkflow — resume passthrough", () => {
  test("deps.resume serves a cached hit: the adapter is never invoked", async () => {
    const workflow = async (rt: any) => {
      rt.phase("Greet");
      const x = await rt.agent("hi");
      return { x };
    };

    // Run 1 — live, records the journal.
    const lines: string[] = [];
    const out1 = await runWorkflow(
      { wfPath: "w", agent: "fake", args: undefined, pretty: false },
      {
        loadWorkflow: async () => ({ workflow, fake: { default: { text: "yo" } } }),
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter(wf.fake) }),
        journalSink: (l) => lines.push(l),
        now: () => 0,
        runId: () => "r1",
      },
    );
    expect(JSON.parse(out1.stdout!)).toEqual({ x: "yo" });

    // Run 2 — resume from run 1's journal. The adapter would throw if invoked,
    // proving the cached hit short-circuits before the adapter.
    let invoked = 0;
    const out2 = await runWorkflow(
      { wfPath: "w", agent: "fake", args: undefined, pretty: false },
      {
        loadWorkflow: async () => ({ workflow }),
        resolveAdapter: () => ({
          adapter: {
            name: "explosive",
            async invoke() {
              invoked++;
              throw new Error("adapter must not run on a cached hit");
            },
          },
        }),
        journalSink: () => {},
        now: () => 0,
        runId: () => "r2",
        resume: makeResumeIndexFromLines(lines),
      },
    );

    expect(out2.exitCode).toBe(0);
    expect(JSON.parse(out2.stdout!)).toEqual({ x: "yo" }); // cached from run 1
    expect(invoked).toBe(0);
  });
});

describe("runCommand — resume input guards", () => {
  test("warns (does not silently run live) when the --resume journal yields no cached nodes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omw-resume-"));
    const emptyJournal = join(dir, "empty.jsonl");
    writeFileSync(emptyJournal, ""); // readable, but zero events

    const errs: string[] = [];
    const code = await runCommand(
      ["examples/deep-research", "--agent", "fake", "--resume", emptyJournal],
      { stdout: () => {}, stderr: (s) => errs.push(s), omwDir: join(dir, ".omw"), runId: () => "rtest" },
    );

    expect(code).toBe(0); // still completes (live) — but the user is told
    expect(errs.join("")).toContain("resume_empty");
  });

  test("--resume accepts a runId, resolving <omwDir>/<runId>.jsonl (not a literal path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omw-resumeid-"));
    const omwDir = join(dir, ".omw");
    mkdirSync(omwDir, { recursive: true });
    writeFileSync(join(omwDir, "r-abc.jsonl"), ""); // a journal stored under its runId
    const errs: string[] = [];
    const code = await runCommand(
      ["examples/deep-research", "--agent", "fake", "--resume", "r-abc"],
      { stdout: () => {}, stderr: (s) => errs.push(s), omwDir, runId: () => "rtest" },
    );
    expect(code).toBe(0); // resolved + read (empty → resume_empty warn), not resume_read_failed
    expect(errs.join("")).not.toContain("resume_read_failed");
  });

  test("exit 1 + resume_read_failed when the --resume path is unreadable", async () => {
    const errs: string[] = [];
    const code = await runCommand(
      ["examples/deep-research", "--agent", "fake", "--resume", "/no/such/journal.jsonl"],
      { stdout: () => {}, stderr: (s) => errs.push(s), omwDir: mkdtempSync(join(tmpdir(), "omw-r2-")), runId: () => "rtest" },
    );
    expect(code).toBe(1);
    expect(errs.join("")).toContain("resume_read_failed");
  });

  test("default run ids do not collide across immediate consecutive runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omw-runid-"));
    const journals: string[] = [];
    const io = {
      stdout: () => {},
      stderr: (s: string) => {
        const m = s.match(/journal: (.+\.jsonl)/);
        if (m) journals.push(m[1]!);
      },
      omwDir: join(dir, ".omw"),
    };

    const a = await runCommand(["examples/deep-research", "--agent", "fake"], io);
    const b = await runCommand(["examples/deep-research", "--agent", "fake"], io);

    expect(a).toBe(0);
    expect(b).toBe(0);
    expect(journals.length).toBe(2);
    expect(new Set(journals).size).toBe(2);
  });
});

describe("runWorkflow — internal_error escalation", () => {
  test("a node that fails with internal_error (author bug) → exit 4, result still on stdout, structured error", async () => {
    const lines: string[] = [];
    const loaded = {
      // An invalid JSON Schema makes the gate's validator fail to compile →
      // internal_error (an author bug), distinct from a flaky node.
      workflow: async (rt: any) => {
        const x = await rt.agent("compute", { schema: { type: "bogus-not-a-type" } });
        return { x };
      },
      fake: { default: { text: '{"n":1}' } },
    };

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

    expect(outcome.exitCode).toBe(4); // escalated out of the null-contract
    expect(JSON.parse(outcome.stdout!)).toEqual({ x: null }); // partial result still emitted
    expect((outcome.error as any).error).toBe("internal_error_nodes");
    expect((outcome.error as any).calls).toEqual([1]);
    // run is bracketed ok:false so the journal reflects the author bug
    const evs = lines.map((l) => JSON.parse(l));
    expect(evs[evs.length - 1]).toMatchObject({ ev: "run_end", ok: false });
  });

  test("a normal flaky-node failure stays exit 0 (null-contract intact)", async () => {
    const loaded = {
      workflow: async (rt: any) => ({ x: await rt.agent("compute", { schema: { type: "object" } }) }),
      fake: { default: { fail: "timeout" as const } },
    };
    const outcome = await runWorkflow(
      { wfPath: "w", agent: "fake", args: undefined, pretty: false },
      {
        loadWorkflow: async () => loaded,
        resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter(wf.fake) }),
        journalSink: () => {},
        now: () => 0,
        runId: () => "test",
      },
    );
    expect(outcome.exitCode).toBe(0); // timeout is a flaky node, not an author bug
    expect(JSON.parse(outcome.stdout!)).toEqual({ x: null });
  });
});
