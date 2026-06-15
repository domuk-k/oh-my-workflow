// replay reconstructs phase / fan-out / stats from a journal file. This is
// honestly a FIXTURE REPLAY (re-derive the view from recorded JSONL) — not a
// live resume, which is v2. summarizeJournal is pure: lines in, summary out.

import { test, expect, describe } from "bun:test";
import { parseReplayArgs, summarizeJournal } from "../src/cli/replay";

const JOURNAL = [
  { ev: "run_start", run: "r-1", wf: "examples/deep-research", ts: 0 },
  { ev: "phase", title: "Search" },
  { ev: "agent_start", call: 1, label: "search:a", adapter: "fake", promptHash: "h", optsHash: "h", ts: 0 },
  { ev: "agent_end", call: 1, ok: true, durationMs: 5 },
  { ev: "agent_start", call: 2, label: "search:b", adapter: "fake", promptHash: "h", optsHash: "h", ts: 0 },
  { ev: "agent_end", call: 2, ok: false, kind: "timeout", durationMs: 2 },
  { ev: "phase", title: "Synthesize" },
  { ev: "agent_start", call: 3, label: "synth", adapter: "fake", promptHash: "h", optsHash: "h", ts: 0 },
  { ev: "agent_end", call: 3, ok: true, durationMs: 1 },
  { ev: "run_end", ok: true },
].map((e) => JSON.stringify(e));

describe("summarizeJournal", () => {
  test("reconstructs run id, wf, phases, and fan-out stats", () => {
    const s = summarizeJournal(JOURNAL);
    expect(s.run).toBe("r-1");
    expect(s.wf).toBe("examples/deep-research");
    expect(s.phases).toEqual(["Search", "Synthesize"]);
    expect(s.calls).toEqual({ total: 3, ok: 2, failed: 1 });
    expect(s.failures).toEqual([{ call: 2, kind: "timeout" }]);
    expect(s.ok).toBe(true);
  });

  test("tolerates blank lines and ignores malformed JSON lines", () => {
    const s = summarizeJournal([...JOURNAL, "", "not json {"]);
    expect(s.calls.total).toBe(3);
  });
});

describe("parseReplayArgs", () => {
  test("parses the journal path and --json flag", () => {
    const r = parseReplayArgs([".omw/r-1.jsonl", "--json"]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value).toEqual({ path: ".omw/r-1.jsonl", json: true });
  });

  test("errors when the journal path is missing", () => {
    const r = parseReplayArgs(["--json"]);
    expect(r.ok).toBe(false);
  });
});
