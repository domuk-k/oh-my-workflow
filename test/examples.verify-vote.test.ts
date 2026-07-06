import { test, expect } from "bun:test";
import { runWorkflow } from "../src/cli/run";
import { makeFakeAdapter } from "../src/adapters/fake";
import verifyVote, { fake } from "../examples/verify-vote/workflow";

test("verify-vote: abstain quorum — two judges uphold, one abstains", async () => {
  const outcome = await runWorkflow(
    {
      wfPath: "examples/verify-vote",
      agent: "fake",
      args: { claim: "test claim" },
      pretty: false,
    },
    {
      loadWorkflow: async () => ({ workflow: verifyVote, fake }),
      resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter(wf.fake) }),
      journalSink: () => {},
      now: () => 0,
      runId: () => "r-vv",
    },
  );

  expect(outcome.exitCode).toBe(0);
  const result = JSON.parse(outcome.stdout!);
  expect(result).toMatchObject({
    cast: 2,
    upheld: 2,
    survived: true,
    verdict: "survives",
  });
});