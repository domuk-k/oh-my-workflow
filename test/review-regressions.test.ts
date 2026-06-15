// Regression tests for the two adversarial code reviews of the core engine.
// Each locks a fix for a real defect found pre-handoff.

import { test, expect, describe } from "bun:test";
import { makeRuntime, makeLimiter } from "../src/runtime";
import { makeJournal, optsHash, type JournalEvent } from "../src/journal";
import { makeFakeAdapter } from "../src/adapters/fake";

const numSchema = { type: "object", required: ["n"], properties: { n: { type: "number" } } };
const endOf = (j: ReturnType<typeof makeJournal>) =>
  j.events().find((e) => e.ev === "agent_end") as Extract<JournalEvent, { ev: "agent_end" }>;

describe("limiter (R1#1): never exceeds max under wake/steal contention", () => {
  test("max in-flight stays at the bound while waiters are released one by one", async () => {
    const run = makeLimiter(2);
    let inFlight = 0;
    let max = 0;
    const release: Array<() => void> = [];
    const mk = () =>
      run(async () => {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise<void>((r) => release.push(r));
        inFlight--;
      });
    const all = Array.from({ length: 6 }, mk);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(inFlight).toBe(2); // 2 running, 4 queued
    while (release.length) {
      release.shift()!();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    }
    await Promise.all(all);
    expect(max).toBe(2);
  });
});

describe("hashing (R1#3): undefined-valued keys do not destabilize the resume key", () => {
  test("an explicitly-undefined optional field hashes the same as an absent one", () => {
    expect(optsHash({ model: undefined, schema: { a: 1 } })).toBe(optsHash({ schema: { a: 1 } }));
  });
  test("undefined vs a real value still differs", () => {
    expect(optsHash({ model: undefined })).not.toBe(optsHash({ model: "smart" }));
  });
});

describe("internal_error (R2#1): our own bugs are not mislabeled as adapter failures", () => {
  test("a schema that fails to compile yields kind 'internal_error', not 'spawn_failure'", async () => {
    const journal = makeJournal({ now: () => 0 });
    const rt = makeRuntime({ adapter: makeFakeAdapter(), journal });
    const badSchema = { $ref: "#/$defs/DoesNotExist" };
    expect(await rt.agent("x", { schema: badSchema })).toBeNull();
    const end = endOf(journal);
    expect(end.kind).toBe("internal_error");
    expect(typeof end.error).toBe("string");
  });
});

describe("diagnostic payload (R2#2/#3): stderr and rawText reach the journal", () => {
  test("no-schema adapter failure journals the adapter stderr", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({
      rules: [{ match: () => true, responses: [{ fail: "nonzero_exit", stderr: "disk full" }] }],
    });
    const rt = makeRuntime({ adapter, journal });
    await rt.agent("x");
    expect(endOf(journal).stderr).toBe("disk full");
  });

  test("schema exhaustion journals the node's raw non-conforming text", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: '{"wrong":1}' }] }] });
    const rt = makeRuntime({ adapter, journal });
    await rt.agent("x", { schema: numSchema });
    expect(endOf(journal).rawText).toBe('{"wrong":1}');
  });

  test("no_json terminal failure journals what the node produced instead", async () => {
    const journal = makeJournal({ now: () => 0 });
    const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: "I refuse, here is prose" }] }] });
    const rt = makeRuntime({ adapter, journal });
    await rt.agent("x", { schema: numSchema });
    const end = endOf(journal);
    expect(end.kind).toBe("no_json");
    expect(end.rawText).toBe("I refuse, here is prose");
  });
});

describe("orchestration trail (R2#4): stage throws leave a journal entry", () => {
  test("a throwing parallel thunk is journaled with its index", async () => {
    const journal = makeJournal({ now: () => 0 });
    const rt = makeRuntime({ adapter: makeFakeAdapter(), journal });
    await rt.parallel([
      async () => 1,
      async () => {
        throw new Error("kaboom");
      },
    ]);
    const log = journal.events().find((e) => e.ev === "log") as Extract<JournalEvent, { ev: "log" }>;
    expect(log?.msg).toContain("1");
    expect(log?.msg.toLowerCase()).toContain("threw");
  });

  test("a throwing pipeline stage is journaled with its item index", async () => {
    const journal = makeJournal({ now: () => 0 });
    const rt = makeRuntime({ adapter: makeFakeAdapter(), journal });
    await rt.pipeline(
      [10, 20],
      async (x: number) => {
        if (x === 20) throw new Error("nope");
        return x;
      },
    );
    const log = journal.events().find((e) => e.ev === "log") as Extract<JournalEvent, { ev: "log" }>;
    expect(log?.msg.toLowerCase()).toContain("threw");
  });
});
