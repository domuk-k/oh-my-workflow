// The resume index is a read-model over a PRIOR run's journal: it pairs each
// agent_start (which carries the resume key (call, promptHash, optsHash)) with
// its agent_end, and exposes a lookup so the runtime can skip a node whose key
// already produced a result. Only ok:true ends are cached — a failed node must
// re-run live on resume (partial-failure recompute).

import { test, expect, describe } from "bun:test";
import { makeResumeIndex, makeResumeIndexFromLines } from "../src/resume";
import type { JournalEvent } from "../src/journal";

const start = (call: number, promptHash: string, optsHash: string): JournalEvent => ({
  ev: "agent_start",
  call,
  adapter: "fake",
  promptHash,
  optsHash,
  ts: 0,
});

describe("makeResumeIndex", () => {
  test("looks up a prior ok node's result by (call, promptHash, optsHash)", () => {
    const events: JournalEvent[] = [
      start(1, "sha256:p1", "sha256:o1"),
      { ev: "agent_end", call: 1, ok: true, result: { n: 5 } },
    ];
    const idx = makeResumeIndex(events);

    const hit = idx.lookup({ call: 1, promptHash: "sha256:p1", optsHash: "sha256:o1" });
    expect(hit.found).toBe(true);
    if (hit.found) expect(hit.value).toEqual({ n: 5 });
  });

  test("does NOT cache a failed node — resume must re-run it live", () => {
    const events: JournalEvent[] = [
      start(1, "sha256:p1", "sha256:o1"),
      { ev: "agent_end", call: 1, ok: false, kind: "timeout" },
    ];
    const idx = makeResumeIndex(events);

    expect(idx.lookup({ call: 1, promptHash: "sha256:p1", optsHash: "sha256:o1" }).found).toBe(false);
  });

  test("misses when any key component differs (changed prompt -> live)", () => {
    const events: JournalEvent[] = [
      start(1, "sha256:p1", "sha256:o1"),
      { ev: "agent_end", call: 1, ok: true, result: { n: 5 } },
    ];
    const idx = makeResumeIndex(events);

    expect(idx.lookup({ call: 1, promptHash: "sha256:EDITED", optsHash: "sha256:o1" }).found).toBe(false);
    expect(idx.lookup({ call: 2, promptHash: "sha256:p1", optsHash: "sha256:o1" }).found).toBe(false);
  });
});

describe("makeResumeIndexFromLines", () => {
  test("builds an index from JSONL, tolerating blank and malformed lines", () => {
    const lines = [
      JSON.stringify(start(1, "sha256:p1", "sha256:o1")),
      JSON.stringify({ ev: "agent_end", call: 1, ok: true, result: { n: 7 } }),
      "",
      "not json {",
    ];
    const idx = makeResumeIndexFromLines(lines);

    const hit = idx.lookup({ call: 1, promptHash: "sha256:p1", optsHash: "sha256:o1" });
    expect(hit.found).toBe(true);
    if (hit.found) expect(hit.value).toEqual({ n: 7 });
  });
});

describe("ResumeIndex.size", () => {
  test("counts only cached ok nodes; an empty/all-failed journal is 0", () => {
    const okJournal: JournalEvent[] = [
      start(1, "sha256:p1", "sha256:o1"),
      { ev: "agent_end", call: 1, ok: true, result: { n: 1 } },
      start(2, "sha256:p2", "sha256:o2"),
      { ev: "agent_end", call: 2, ok: false, kind: "timeout" },
    ];
    expect(makeResumeIndex(okJournal).size).toBe(1); // only the ok node

    expect(makeResumeIndex([]).size).toBe(0);
    expect(makeResumeIndexFromLines([""]).size).toBe(0); // empty/garbage file
    expect(makeResumeIndexFromLines(["garbage {"]).size).toBe(0);
  });
});
