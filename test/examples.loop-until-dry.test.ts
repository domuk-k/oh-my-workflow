import { test, expect } from "bun:test";
import { runWorkflow, type LoadedWorkflow } from "../src/cli/run";
import { makeFakeAdapter } from "../src/adapters/fake";
import loopUntilDry, { fake } from "../examples/loop-until-dry/workflow";

test("loop-until-dry: stops after two consecutive rounds with no new keys", async () => {
  const lines: string[] = [];
  const outcome = await runWorkflow(
    { wfPath: "examples/loop-until-dry", agent: "fake", args: {}, pretty: false },
    {
      loadWorkflow: async (): Promise<LoadedWorkflow> => ({
        workflow: loopUntilDry as LoadedWorkflow["workflow"],
        fake,
      }),
      resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter(wf.fake) }),
      journalSink: (l) => lines.push(l),
      now: () => 0,
      runId: () => "r-lud",
    },
  );

  expect(outcome.exitCode).toBe(0);
  const result = JSON.parse(outcome.stdout!);
  expect(result.count).toBe(3);
  expect(result.found.map((f: { key: string }) => f.key)).toEqual([
    "auth-bypass",
    "null-deref",
    "race-window",
  ]);
  expect(result.rounds).toBe(4);
  expect(result.stoppedBecause).toBe("dry");
  expect(result.dryStreakAtEnd).toBe(2);

  const logs = lines.map((l) => JSON.parse(l)).filter((e) => e.ev === "log");
  expect(logs.map((e) => e.msg)).toEqual(["round 1", "round 2", "round 3", "round 4"]);
});