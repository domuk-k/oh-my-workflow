import { test, expect, describe } from "bun:test";
import { makeJournal, parseJournalLines, promptHash, optsHash, resumeKey } from "../src/journal";

describe("promptHash", () => {
  test('is "sha256:" + 64 hex chars', () => {
    expect(promptHash("hello")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  test("is deterministic for the same prompt", () => {
    expect(promptHash("same")).toBe(promptHash("same"));
  });
  test("differs for different prompts", () => {
    expect(promptHash("a")).not.toBe(promptHash("b"));
  });
});

describe("optsHash", () => {
  test("is independent of key order", () => {
    expect(optsHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      optsHash({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });
  test("is stable for undefined opts", () => {
    expect(optsHash(undefined)).toBe(optsHash(undefined));
  });
  test("differs when values differ", () => {
    expect(optsHash({ a: 1 })).not.toBe(optsHash({ a: 2 }));
  });
});

describe("resumeKey", () => {
  test("combines call index + prompt hash + opts hash", () => {
    const k = resumeKey({ call: 3, promptHash: "sha256:aa", optsHash: "sha256:bb" });
    expect(k).toBe("3:sha256:aa:sha256:bb");
  });
  test("is byte-identical for identical inputs", () => {
    const a = resumeKey({ call: 1, promptHash: "sha256:x", optsHash: "sha256:y" });
    const b = resumeKey({ call: 1, promptHash: "sha256:x", optsHash: "sha256:y" });
    expect(a).toBe(b);
  });
});

describe("makeJournal", () => {
  const fixedClock = () => 1000;

  test("records events in order with their shapes", () => {
    const j = makeJournal({ now: fixedClock });
    j.runStart({ run: "r-1", wf: "wf.js" });
    j.phase("Search");
    j.agentStart({
      call: 1,
      label: "search:broad",
      phase: "Search",
      adapter: "fake",
      promptHash: "sha256:aa",
      optsHash: "sha256:bb",
    });
    j.attempt({ call: 1, n: 1, kind: "schema_violation", errors: ["bad"] });
    j.agentEnd({ call: 1, ok: true, result: { found: 3 }, durationMs: 5 });
    j.log("done searching");
    j.runEnd({ ok: true, stats: { calls: 1 } });

    const evs = j.events();
    expect(evs.map((e) => e.ev)).toEqual([
      "run_start",
      "phase",
      "agent_start",
      "attempt",
      "agent_end",
      "log",
      "run_end",
    ]);
  });

  test("stamps ts from the injected clock", () => {
    const j = makeJournal({ now: fixedClock });
    j.runStart({ run: "r-1" });
    expect((j.events()[0] as { ts: number }).ts).toBe(1000);
  });

  test("agent_end records the terminal kind on failure", () => {
    const j = makeJournal({ now: fixedClock });
    j.agentEnd({ call: 2, ok: false, kind: "timeout" });
    const end = j.events()[0] as { ok: boolean; kind: string };
    expect(end.ok).toBe(false);
    expect(end.kind).toBe("timeout");
  });

  test("streams each event to the sink as one parseable JSON line", () => {
    const lines: string[] = [];
    const j = makeJournal({ now: fixedClock, sink: (l) => lines.push(l) });
    j.runStart({ run: "r-1" });
    j.log("hi");
    expect(lines.length).toBe(2);
    expect(lines.every((l) => !l.includes("\n"))).toBe(true);
    expect(JSON.parse(lines[1]!)).toMatchObject({ ev: "log", msg: "hi" });
  });

  test("two identical runs produce byte-identical JSONL (resume-compatible)", () => {
    const run = () => {
      const lines: string[] = [];
      const j = makeJournal({ now: fixedClock, sink: (l) => lines.push(l) });
      j.runStart({ run: "r-fixed", wf: "wf.js" });
      j.agentStart({
        call: 1,
        adapter: "fake",
        promptHash: promptHash("p"),
        optsHash: optsHash({ schema: true }),
      });
      j.agentEnd({ call: 1, ok: true, result: { x: 1 }, durationMs: 0 });
      j.runEnd({ ok: true });
      return lines.join("\n");
    };
    expect(run()).toBe(run());
  });
});

describe("parseJournalLines", () => {
  test("parses JSONL events and tolerates blank + malformed lines", () => {
    const lines = [
      JSON.stringify({ ev: "run_start", run: "r1", ts: 0 }),
      "",
      "not json {",
      JSON.stringify({ ev: "phase", title: "Search" }),
    ];
    const evs = parseJournalLines(lines);
    expect(evs.map((e) => e.ev)).toEqual(["run_start", "phase"]);
  });
});
