import { test, expect, describe } from "bun:test";
import { makeRuntime } from "../src/runtime";
import { makeJournal, type JournalEvent } from "../src/journal";
import { makeFakeAdapter } from "../src/adapters/fake";
import type { AgentPort } from "../src/adapters/types";

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
