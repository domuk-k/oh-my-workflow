// THE GATE (quality bar B0): one full pass through all 5 hooks against the fake
// adapter, including a scripted schema-fail -> self-repair -> filter(Boolean)
// survival cycle and the null-contract property. Green here = the walking
// skeleton exists. This is also exactly the `--agent fake` hero demo.

import { test, expect, describe } from "bun:test";
import { makeRuntime, type Runtime } from "../src/runtime";
import { makeJournal, type JournalEvent } from "../src/journal";
import { makeFakeAdapter } from "../src/adapters/fake";

const scopeSchema = { type: "object", required: ["topics"], properties: { topics: { type: "array" } } };
const searchSchema = {
  type: "object",
  required: ["topic", "hits"],
  properties: { topic: { type: "string" }, hits: { type: "number" } },
};
const verifySchema = { type: "object", required: ["verified"], properties: { verified: { type: "boolean" } } };
const synthSchema = {
  type: "object",
  required: ["summary", "count"],
  properties: { summary: { type: "string" }, count: { type: "number" } },
};

function spineAdapter() {
  return makeFakeAdapter({
    rules: [
      { match: (p) => p.includes("SCOPE"), responses: [{ text: '{"topics":["a","b","c"]}' }] },
      // topic a: schema-invalid first (with a session) then repaired -> self-repair loop
      {
        match: (p) => p.includes("SEARCH a"),
        responses: [{ text: '{"oops":1}', sessionId: "sa" }, { text: '{"topic":"a","hits":3}' }],
      },
      // topic b: hard adapter failure -> null -> dropped by filter(Boolean)
      { match: (p) => p.includes("SEARCH b"), responses: [{ fail: "timeout" }] },
      { match: (p) => p.includes("SEARCH c"), responses: [{ text: '{"topic":"c","hits":5}' }] },
      { match: (p) => p.includes("VERIFY"), responses: [{ text: '{"verified":true}' }] },
      { match: (p) => p.includes("SYNTH"), responses: [{ text: '{"summary":"done","count":2}' }] },
    ],
  });
}

async function runSpine(rt: Runtime) {
  rt.phase("Scope");
  const scope = (await rt.agent("SCOPE the research", { schema: scopeSchema })) as { topics: string[] };

  rt.phase("Search");
  const searched = await rt.parallel(
    scope.topics.map((t) => () => rt.agent(`SEARCH ${t}`, { schema: searchSchema, label: `search:${t}` })),
  );
  const found = searched.filter(Boolean); // survival: b's null is dropped here

  rt.phase("Verify");
  const verified = await rt.pipeline(found, async (f) => {
    const v = await rt.agent(`VERIFY ${JSON.stringify(f)}`, { schema: verifySchema });
    return v ? { ...(f as object), ...(v as object) } : null;
  });
  const confirmed = verified.filter(Boolean);

  rt.phase("Synthesize");
  const summary = await rt.agent(`SYNTH over ${confirmed.length} findings`, { schema: synthSchema });
  return { confirmed, summary };
}

describe("THE GATE — full 5-hook spine", () => {
  test("survives a node failure + a self-repair and produces the final result", async () => {
    const rejections: unknown[] = [];
    const onRej = (r: unknown) => rejections.push(r);
    process.on("unhandledRejection", onRej);

    const journal = makeJournal({ now: () => 0 });
    const rt = makeRuntime({ adapter: spineAdapter(), journal, concurrency: 4 });

    journal.runStart({ run: "r-spine", wf: "spine.test" });
    const result = await runSpine(rt);
    journal.runEnd({ ok: true, stats: { confirmed: result.confirmed.length } });

    await new Promise((r) => setTimeout(r, 0));
    process.off("unhandledRejection", onRej);

    // b (timeout) was dropped; a (self-repaired) + c survived; both verified.
    expect(result.confirmed.length).toBe(2);
    expect(result.summary).toEqual({ summary: "done", count: 2 });

    const evs = journal.events();
    expect(evs[0]?.ev).toBe("run_start");
    expect(evs[evs.length - 1]?.ev).toBe("run_end");
    expect(evs.filter((e) => e.ev === "phase").map((e) => (e as { title: string }).title)).toEqual([
      "Scope",
      "Search",
      "Verify",
      "Synthesize",
    ]);

    // null-contract: zero unhandled rejections despite the timeout node.
    expect(rejections).toEqual([]);
  });

  test("every agent_start has a matching agent_end (no orphans)", async () => {
    const journal = makeJournal({ now: () => 0 });
    const rt = makeRuntime({ adapter: spineAdapter(), journal });
    await runSpine(rt);

    const starts = journal.events().filter((e): e is Extract<JournalEvent, { ev: "agent_start" }> => e.ev === "agent_start");
    const ends = journal.events().filter((e): e is Extract<JournalEvent, { ev: "agent_end" }> => e.ev === "agent_end");
    expect(starts.length).toBe(ends.length);
    const endCalls = new Set(ends.map((e) => e.call));
    for (const s of starts) expect(endCalls.has(s.call)).toBe(true);

    // exactly one terminal failure (topic b timeout)
    expect(ends.filter((e) => e.ok === false).map((e) => e.kind)).toEqual(["timeout"]);
  });

  test("the self-repair node journals a schema_violation then ok", async () => {
    const journal = makeJournal({ now: () => 0 });
    const rt = makeRuntime({ adapter: spineAdapter(), journal });
    await runSpine(rt);

    // topic a is call #2 (SCOPE is #1). Its attempts show the repair.
    const aAttempts = journal.events().filter(
      (e): e is Extract<JournalEvent, { ev: "attempt" }> => e.ev === "attempt" && e.call === 2,
    );
    expect(aAttempts.map((a) => a.kind)).toEqual(["schema_violation", "ok"]);
  });
});
