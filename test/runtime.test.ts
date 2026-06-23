import { test, expect, describe } from "bun:test";
import { makeRuntime, BudgetExceededError } from "../src/runtime";
import { makeJournal, type JournalEvent } from "../src/journal";
import { makeFakeAdapter } from "../src/adapters/fake";
import { makeResumeIndex } from "../src/resume";
import type { AgentPort, AgentResult } from "../src/adapters/types";

/** A fake adapter that counts invocations, so a resume cached-hit is provable by
 *  the adapter NOT being called. Each call returns a distinct value. */
function countingAdapter(): AgentPort & { calls: () => number } {
  let calls = 0;
  return {
    name: "counting",
    calls: () => calls,
    async invoke(): Promise<AgentResult> {
      calls++;
      return { ok: true, text: `{"n":${calls}}`, meta: { durationMs: 1 } };
    },
  };
}

const numSchema = {
  type: "object",
  properties: { n: { type: "number" } },
  required: ["n"],
};

describe("runtime.agent — schema + null-contract", () => {
  test("returns the validated value and journals start+end(ok)", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: '{"n":5}' }] }] });
    const rt = makeRuntime({ adapter, journal });

    const out = await rt.agent("compute", { schema: numSchema });
    expect(out).toEqual({ n: 5 });

    const evs = journal.events();
    expect(evs.find((e) => e.ev === "agent_start")).toBeDefined();
    const end = evs.find((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>;
    expect(end.ok).toBe(true);
  });

  test("returns null (never throws) and journals kind on schema exhaustion", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: '{"wrong":1}' }] }] });
    const rt = makeRuntime({ adapter, journal });

    const out = await rt.agent("compute", { schema: numSchema });
    expect(out).toBeNull();

    const attempts = journal.events().filter((e) => e.ev === "attempt");
    expect(attempts.length).toBe(3);
    const end = journal.events().find((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>;
    expect(end.ok).toBe(false);
    expect(end.kind).toBe("schema_violation");
  });

  test("self-repairs: invalid then valid via the followUp session path", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({
      rules: [
        {
          match: () => true,
          responses: [{ text: '{"wrong":1}', sessionId: "s1" }, { text: '{"n":9}' }],
        },
      ],
    });
    const rt = makeRuntime({ adapter, journal });

    const out = await rt.agent("compute", { schema: numSchema });
    expect(out).toEqual({ n: 9 });
    const attempts = journal.events().filter((e) => e.ev === "attempt");
    expect(attempts.map((a) => (a as { kind: string }).kind)).toEqual(["schema_violation", "ok"]);
  });

  test("self-repair falls back to a fresh invoke when followUp (resume) fails", async () => {
    const journal = makeJournal({ now: () => 0 });
    let invokes = 0;
    let followUps = 0;
    // 1st invoke: invalid JSON but yields a sessionId → the retry takes the
    // followUp path. followUp then FAILS (e.g. expired session). The gate must
    // not treat that as terminal — it falls back to a fresh invoke, which is valid.
    const adapter: AgentPort = {
      name: "flaky-resume",
      async invoke(): Promise<AgentResult> {
        invokes++;
        return invokes === 1
          ? { ok: true, text: '{"wrong":1}', meta: { durationMs: 1, sessionId: "s1" } }
          : { ok: true, text: '{"n":7}', meta: { durationMs: 1 } };
      },
      async followUp(): Promise<AgentResult> {
        followUps++;
        return { ok: false, kind: "nonzero_exit", stderr: "No conversation found", meta: { durationMs: 1 } };
      },
    };
    const rt = makeRuntime({ adapter, journal });

    const out = await rt.agent("compute", { schema: numSchema });
    expect(out).toEqual({ n: 7 }); // recovered despite the broken resume
    expect(followUps).toBe(1); // resume was attempted
    expect(invokes).toBe(2); // and it fell back to a fresh invoke
  });

  test("fresh-retry path hands the model back its own prior non-conforming output (B6)", async () => {
    const journal = makeJournal({ now: () => 0 });
    const prompts: string[] = [];
    // No sessionId → the retry takes the FRESH-invoke path (not in-session
    // followUp). A brand-new subprocess has no transcript of its prior attempt,
    // so the gate must embed that attempt; otherwise the model repairs blind.
    const adapter: AgentPort = {
      name: "fresh-capture",
      async invoke(req): Promise<AgentResult> {
        prompts.push(req.prompt);
        return prompts.length === 1
          ? { ok: true, text: '{"wrong":"MARKER_ZZ9"}', meta: { durationMs: 1 } }
          : { ok: true, text: '{"n":9}', meta: { durationMs: 1 } };
      },
    };
    const rt = makeRuntime({ adapter, journal });

    const out = await rt.agent("compute", { schema: numSchema });
    expect(out).toEqual({ n: 9 });
    expect(prompts.length).toBe(2);
    // The fresh retry prompt carries the concrete prior output, not just errors.
    expect(prompts[1]).toContain("MARKER_ZZ9");
  });

  test("in-session followUp retry stays lean — does NOT re-echo rawText (already in transcript)", async () => {
    const journal = makeJournal({ now: () => 0 });
    let followUpPrompt = "";
    // invalid + a sessionId → the retry takes the in-session followUp path, where
    // the prior attempt is still in the live transcript, so re-sending it is waste.
    const adapter: AgentPort = {
      name: "session-capture",
      async invoke(): Promise<AgentResult> {
        return { ok: true, text: '{"wrong":"MARKER_SESS"}', meta: { durationMs: 1, sessionId: "s1" } };
      },
      async followUp(_s, prompt): Promise<AgentResult> {
        followUpPrompt = prompt;
        return { ok: true, text: '{"n":3}', meta: { durationMs: 1 } };
      },
    };
    const rt = makeRuntime({ adapter, journal });

    const out = await rt.agent("compute", { schema: numSchema });
    expect(out).toEqual({ n: 3 });
    expect(followUpPrompt).not.toContain("MARKER_SESS"); // prior output not re-sent
    expect(followUpPrompt).toContain("required property 'n'"); // errors still carried
  });

  test("with no schema, returns the raw text", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: "plain answer" }] }] });
    const rt = makeRuntime({ adapter, journal });
    expect(await rt.agent("say hi")).toBe("plain answer");
  });

  test("adapter failure resolves to null with the failure kind journaled", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ fail: "timeout" }] }] });
    const rt = makeRuntime({ adapter, journal });
    expect(await rt.agent("compute", { schema: numSchema })).toBeNull();
    const end = journal.events().find((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>;
    expect(end.kind).toBe("timeout");
  });

  test("a refusal (decline) resolves to null and journals kind:'refusal', distinct from a crash", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ fail: "refusal" }] }] });
    const rt = makeRuntime({ adapter, journal });
    // Stays inside the null-contract: a decline is a journaled outcome, not a throw.
    expect(await rt.agent("do something the model declines", { schema: numSchema })).toBeNull();
    const end = journal.events().find((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>;
    expect(end.ok).toBe(false);
    expect(end.kind).toBe("refusal");
  });

  test("null-contract holds on the no-schema path: adapter failure -> null", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ fail: "nonzero_exit" }] }] });
    const rt = makeRuntime({ adapter, journal });
    expect(await rt.agent("no schema here")).toBeNull();
    const end = journal.events().find((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>;
    expect(end.ok).toBe(false);
    expect(end.kind).toBe("nonzero_exit");
  });

  test("null-contract holds even if the adapter throws: -> null + spawn_failure", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter: AgentPort = {
      name: "explosive",
      async invoke() {
        throw new Error("adapter blew up");
      },
    };
    const rt = makeRuntime({ adapter, journal });
    expect(await rt.agent("anything")).toBeNull();
    const end = journal.events().find((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>;
    expect(end.ok).toBe(false);
    expect(end.kind).toBe("spawn_failure");
  });
});

describe("runtime.phase / log", () => {
  test("phase() is inherited by later agent() calls; opts.phase overrides", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: "x" }] }] });
    const rt = makeRuntime({ adapter, journal });

    rt.phase("Search");
    await rt.agent("a");
    await rt.agent("b", { phase: "Verify" });

    const starts = journal.events().filter((e) => e.ev === "agent_start") as Extract<
      JournalEvent,
      { ev: "agent_start" }
    >[];
    expect(starts[0]?.phase).toBe("Search");
    expect(starts[1]?.phase).toBe("Verify");
  });

  test("log() is journaled", async () => {
    const journal = makeJournal({ now: () => 0 });
    const rt = makeRuntime({ adapter: makeFakeAdapter(), journal });
    rt.log("hello");
    expect(journal.events().find((e) => e.ev === "log")).toMatchObject({ msg: "hello" });
  });
});

describe("runtime.parallel / pipeline", () => {
  test("parallel returns results in order; a throwing thunk becomes null", async () => {
    const rt = makeRuntime({ adapter: makeFakeAdapter(), journal: makeJournal({ now: () => 0 }) });
    const out = await rt.parallel([
      async () => 1,
      async () => {
        throw new Error("boom");
      },
      async () => 3,
    ]);
    expect(out).toEqual([1, null, 3]);
  });

  test("pipeline flows each item through all stages; a throwing stage drops to null", async () => {
    const rt = makeRuntime({ adapter: makeFakeAdapter(), journal: makeJournal({ now: () => 0 }) });
    const out = await rt.pipeline(
      [1, 2, 3],
      async (x: number) => x * 10,
      async (x: number) => {
        if (x === 20) throw new Error("nope");
        return x + 1;
      },
    );
    expect(out).toEqual([11, null, 31]);
  });

  test("pipeline passes the original item and index to later stages", async () => {
    const rt = makeRuntime({ adapter: makeFakeAdapter(), journal: makeJournal({ now: () => 0 }) });
    const out = await rt.pipeline(
      ["a", "b"],
      async () => "ignored",
      async (_prev: unknown, orig: string, i: number) => `${orig}:${i}`,
    );
    expect(out).toEqual(["a:0", "b:1"]);
  });
});

describe("runtime concurrency limiter", () => {
  test("never exceeds the configured concurrency (default 4)", async () => {
    let active = 0;
    let max = 0;
    const adapter: AgentPort = {
      name: "slow",
      async invoke() {
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { ok: true, text: '{"n":1}', meta: { durationMs: 5 } };
      },
    };
    const rt = makeRuntime({ adapter, journal: makeJournal({ now: () => 0 }), concurrency: 4 });
    await rt.parallel(Array.from({ length: 20 }, () => () => rt.agent("x", { schema: numSchema })));
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1);
  });
});

describe("runtime.agent — resume (longest-unchanged-prefix cache)", () => {
  test("identical re-run is a cached hit: adapter NOT invoked, prior value returned", async () => {
    // First run records a journal.
    const j1 = makeJournal({ now: () => 0 });
    const a1 = countingAdapter();
    const rt1 = makeRuntime({ adapter: a1, journal: j1 });
    const first = await rt1.agent("compute", { schema: numSchema });
    expect(first).toEqual({ n: 1 });
    expect(a1.calls()).toBe(1);

    // Second run resumes from the first run's journal.
    const j2 = makeJournal({ now: () => 0 });
    const a2 = countingAdapter();
    const resume = makeResumeIndex(j1.events());
    const rt2 = makeRuntime({ adapter: a2, journal: j2, resume });
    const second = await rt2.agent("compute", { schema: numSchema });

    expect(second).toEqual({ n: 1 }); // the cached value, not a fresh {n:1} from a2
    expect(a2.calls()).toBe(0); // adapter skipped entirely on the hit
    const end = j2.events().find((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>;
    expect(end.ok).toBe(true);
    expect(end.cached).toBe(true);
  });
});

describe("runtime.agent — resume keys on semantic opts only", () => {
  test("a cosmetic label change does not bust the cache (label excluded from key)", async () => {
    const j1 = makeJournal({ now: () => 0 });
    const a1 = countingAdapter();
    const rt1 = makeRuntime({ adapter: a1, journal: j1 });
    await rt1.agent("compute", { label: "a" });
    expect(a1.calls()).toBe(1);

    const j2 = makeJournal({ now: () => 0 });
    const a2 = countingAdapter();
    const resume = makeResumeIndex(j1.events());
    const rt2 = makeRuntime({ adapter: a2, journal: j2, resume });
    await rt2.agent("compute", { label: "b" }); // same prompt, different cosmetic label
    expect(a2.calls()).toBe(0); // cache hit despite label change
  });

  test("a semantic opt change (model) DOES bust the cache", async () => {
    const j1 = makeJournal({ now: () => 0 });
    const a1 = countingAdapter();
    const rt1 = makeRuntime({ adapter: a1, journal: j1 });
    await rt1.agent("compute", { model: "m1" });

    const j2 = makeJournal({ now: () => 0 });
    const a2 = countingAdapter();
    const resume = makeResumeIndex(j1.events());
    const rt2 = makeRuntime({ adapter: a2, journal: j2, resume });
    await rt2.agent("compute", { model: "m2" }); // different model → miss
    expect(a2.calls()).toBe(1);
  });
});

describe("runtime.agent — resume partial-failure recompute", () => {
  test("a prior failed node re-runs live while prior ok nodes stay cached", async () => {
    // Run 1: node A succeeds with a distinctive value; node B fails (timeout).
    const j1 = makeJournal({ now: () => 0 });
    const a1 = makeFakeAdapter({
      rules: [
        { match: (p) => p.includes("NODE A"), responses: [{ text: '{"n":42}' }] },
        { match: (p) => p.includes("NODE B"), responses: [{ fail: "timeout" }] },
      ],
    });
    const rt1 = makeRuntime({ adapter: a1, journal: j1 });
    const a1res = await rt1.agent("NODE A", { schema: numSchema });
    const b1res = await rt1.agent("NODE B", { schema: numSchema });
    expect(a1res).toEqual({ n: 42 });
    expect(b1res).toBeNull();

    // Run 2: resume from j1. A is cached (skip adapter); B missed the index
    // (it failed), so it re-runs live — and now succeeds.
    const j2 = makeJournal({ now: () => 0 });
    const a2 = countingAdapter(); // returns {n:1} on its single live call (B)
    const resume = makeResumeIndex(j1.events());
    const rt2 = makeRuntime({ adapter: a2, journal: j2, resume });
    const a2res = await rt2.agent("NODE A", { schema: numSchema });
    const b2res = await rt2.agent("NODE B", { schema: numSchema });

    expect(a2res).toEqual({ n: 42 }); // cached from run 1, NOT re-run
    expect(b2res).toEqual({ n: 1 }); // re-run live on resume
    expect(a2.calls()).toBe(1); // adapter invoked only for B

    const ends = j2.events().filter((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>[];
    expect(ends.map((e) => e.cached ?? false)).toEqual([true, false]); // A cached, B live
  });
});

describe("runtime.agent — resume full-prefix cache (parallel fan-out)", () => {
  // A miniature deep-research shape: a scope node, a parallel fan-out, a synth.
  async function miniWorkflow(rt: ReturnType<typeof makeRuntime>) {
    rt.phase("Scope");
    const scope = (await rt.agent("SCOPE", { schema: numSchema })) as { n: number };
    rt.phase("Search");
    const hits = await rt.parallel(
      ["a", "b", "c"].map((t) => () => rt.agent(`SEARCH ${t}`, { schema: numSchema, label: `search:${t}` })),
    );
    rt.phase("Synth");
    const synth = await rt.agent("SYNTH", { schema: numSchema });
    return { scope, hits, synth };
  }

  function miniAdapter() {
    return makeFakeAdapter({
      rules: [
        { match: (p) => p.includes("SCOPE"), responses: [{ text: '{"n":1}' }] },
        { match: (p) => p.includes("SEARCH a"), responses: [{ text: '{"n":2}' }] },
        { match: (p) => p.includes("SEARCH b"), responses: [{ text: '{"n":3}' }] },
        { match: (p) => p.includes("SEARCH c"), responses: [{ text: '{"n":4}' }] },
        { match: (p) => p.includes("SYNTH"), responses: [{ text: '{"n":5}' }] },
      ],
    });
  }

  test("identical re-run: 100% cache hits, zero adapter calls, byte-identical result", async () => {
    const j1 = makeJournal({ now: () => 0 });
    const r1 = await miniWorkflow(makeRuntime({ adapter: miniAdapter(), journal: j1 }));

    const j2 = makeJournal({ now: () => 0 });
    const a2 = countingAdapter();
    const resume = makeResumeIndex(j1.events());
    const r2 = await miniWorkflow(makeRuntime({ adapter: a2, journal: j2, resume }));

    expect(a2.calls()).toBe(0); // every node served from the index
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1)); // byte-identical

    // every agent_start has a matching cached agent_end (spine invariant)
    const starts = j2.events().filter((e) => e.ev === "agent_start") as Extract<JournalEvent, { ev: "agent_start" }>[];
    const ends = j2.events().filter((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>[];
    expect(starts.length).toBe(5);
    expect(ends.length).toBe(5);
    expect(ends.every((e) => e.cached === true && e.ok === true)).toBe(true);
    expect(new Set(ends.map((e) => e.call))).toEqual(new Set(starts.map((e) => e.call)));
  });

  test("editing the last node: prefix stays cached, only the edited node runs live", async () => {
    const j1 = makeJournal({ now: () => 0 });
    await miniWorkflow(makeRuntime({ adapter: miniAdapter(), journal: j1 }));

    const j2 = makeJournal({ now: () => 0 });
    const a2 = countingAdapter();
    const resume = makeResumeIndex(j1.events());
    const rt2 = makeRuntime({ adapter: a2, journal: j2, resume });

    // Replay the prefix verbatim, then change the final node's prompt.
    rt2.phase("Scope");
    await rt2.agent("SCOPE", { schema: numSchema });
    rt2.phase("Search");
    await rt2.parallel(["a", "b", "c"].map((t) => () => rt2.agent(`SEARCH ${t}`, { schema: numSchema, label: `search:${t}` })));
    rt2.phase("Synth");
    const synth = await rt2.agent("SYNTH v2 — EDITED", { schema: numSchema });

    expect(a2.calls()).toBe(1); // only the edited SYNTH node ran live
    expect(synth).toEqual({ n: 1 }); // fresh value from a2, not the cached {n:5}
    const ends = j2.events().filter((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>[];
    expect(ends.map((e) => e.cached ?? false)).toEqual([true, true, true, true, false]);
  });
});

describe("runtime — model precedence (opts > phase > meta default)", () => {
  test("resolves the effective model from the opts > phase > meta chain", async () => {
    const seen: (string | undefined)[] = [];
    const adapter: AgentPort = {
      name: "cap",
      async invoke(req) {
        seen.push(req.model);
        return { ok: true, text: "x", meta: { durationMs: 0 } };
      },
    };
    const journal = makeJournal({ now: () => 0 });
    const rt = makeRuntime({
      adapter,
      journal,
      meta: { model: "default-m", phases: [{ title: "A", model: "phase-a" }] },
    });
    rt.phase("A");
    await rt.agent("1"); // phase A has a model → phase-a
    await rt.agent("2", { model: "opt-m" }); // explicit opts wins
    rt.phase("B"); // no phase model → meta default
    await rt.agent("3");
    expect(seen).toEqual(["phase-a", "opt-m", "default-m"]);
  });
});

describe("runtime — isolation:'worktree'", () => {
  test("threads the worktree dir as the node's cwd to the adapter", async () => {
    const seenCwd: (string | undefined)[] = [];
    const adapter: AgentPort = {
      name: "cap",
      async invoke(req) {
        seenCwd.push(req.cwd);
        return { ok: true, text: "x", meta: { durationMs: 0 } };
      },
    };
    const journal = makeJournal({ now: () => 0 });
    // Fake worktree: hand the body a sentinel dir instead of touching git.
    const fakeWithWorktree = (async (_repo: string, fn: (d: string) => Promise<unknown>) =>
      fn("/tmp/wt-sentinel")) as any;
    const rt = makeRuntime({ adapter, journal, withWorktree: fakeWithWorktree });
    await rt.agent("a", { isolation: "worktree", cwd: "/repo" });
    await rt.agent("b"); // no isolation → caller cwd passes through unchanged
    expect(seenCwd).toEqual(["/tmp/wt-sentinel", undefined]);
  });
});

describe("runtime.budget — token accounting", () => {
  test("budget.spent sums node output tokens; remaining counts down; Infinity when unset", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: "x", outputTokens: 30 }] }] });
    const rt = makeRuntime({ adapter, journal, budget: 100 });
    expect(rt.budget.total).toBe(100);
    await rt.agent("a");
    expect(rt.budget.spent()).toBe(30);
    expect(rt.budget.remaining()).toBe(70);
    const rt2 = makeRuntime({ adapter, journal });
    expect(rt2.budget.remaining()).toBe(Infinity);
  });

  test("agent() throws BudgetExceededError once spent >= total (the one null-contract exception)", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: "x", outputTokens: 60 }] }] });
    const rt = makeRuntime({ adapter, journal, budget: 50 });
    await rt.agent("first"); // spends 60 ≥ 50 after this
    await expect(rt.agent("second")).rejects.toBeInstanceOf(BudgetExceededError);
  });

  test("a budget throw inside parallel() is swallowed to null (matches native)", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: "x", outputTokens: 99 }] }] });
    const rt = makeRuntime({ adapter, journal, budget: 1 });
    await rt.agent("warmup").catch(() => {});
    const res = await rt.parallel([() => rt.agent("a")]);
    expect(res).toEqual([null]);
  });
});
