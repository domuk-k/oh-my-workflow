// Regression lock on the free demo: the deep-research example, run through the
// real CLI orchestration against its co-located `--agent fake` fixtures, must be
// deterministic green — 2 confirmed findings + the synthesized summary. If this
// breaks, the README's hero line (B1) is broken. This is the CI golden anchor.

import { test, expect } from "bun:test";
import { runWorkflow } from "../src/cli/run";
import { makeFakeAdapter } from "../src/adapters/fake";
import deepResearch, { fake } from "../examples/deep-research/workflow";

test("deep-research demo is deterministic green with --agent fake", async () => {
  const lines: string[] = [];
  const outcome = await runWorkflow(
    { wfPath: "examples/deep-research", agent: "fake", args: {}, pretty: false },
    {
      loadWorkflow: async () => ({ workflow: deepResearch, fake }),
      resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter(wf.fake) }),
      journalSink: (l) => lines.push(l),
      now: () => 0,
      runId: () => "r-demo",
    },
  );

  expect(outcome.exitCode).toBe(0);
  const result = JSON.parse(outcome.stdout!);
  expect(result.confirmed.length).toBe(2);
  expect(result.summary).toEqual({ summary: "done", count: 2 });

  const evs = lines.map((l) => JSON.parse(l));
  expect(evs.filter((e) => e.ev === "phase").map((e) => e.title)).toEqual([
    "Scope",
    "Search",
    "Verify",
    "Synthesize",
  ]);
  // exactly one terminal node failure (topic b timeout), and the run still ok.
  const ends = evs.filter((e) => e.ev === "agent_end");
  expect(ends.filter((e) => e.ok === false).map((e) => e.kind)).toEqual(["timeout"]);
  expect(evs[evs.length - 1]).toMatchObject({ ev: "run_end", ok: true });
});
