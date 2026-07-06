// verify-vote — independent judges + abstain quorum on null nodes.
//
//   bun src/cli/omw.ts run examples/verify-vote --agent fake --args '{"claim":"omw nodes are whole agent CLIs"}'
//
// A failed judge resolves to null and abstains — it does not vote "no". The claim
// survives only when ≥2 cast votes agree it was not refuted.

import type { Runtime } from "../../src/runtime";
import type { FakeAdapterOptions } from "../../src/adapters/fake";

const voteSchema = {
  type: "object",
  required: ["refuted"],
  properties: { refuted: { type: "boolean" } },
};

export const meta = {
  name: "verify-vote",
  description: "Three independent judges try to refute one claim; null abstains.",
  phases: [{ title: "Judge" }],
};

export default async function verifyVote({ agent, parallel, phase }: Runtime, args: { claim: string }) {
  phase("Judge");
  const votes = (
    await parallel(
      [1, 2, 3].map(
        (i) => () =>
          agent(`JUDGE ${i}: Try to REFUTE this claim. Default to refuted=true if unsure.\n\nClaim: ${args.claim}`, {
            schema: voteSchema,
            label: `judge:${i}`,
          }),
      ),
    )
  ).filter(Boolean) as { refuted: boolean }[];

  const cast = votes.length;
  const upheld = votes.filter((v) => !v.refuted).length;
  const survived = cast >= 2 && upheld >= 2;

  return {
    claim: args.claim,
    cast,
    upheld,
    survived,
    verdict: survived ? "survives" : cast < 2 ? "no_quorum" : "refuted",
  };
}

export const fake: FakeAdapterOptions = {
  rules: [
    { match: (p) => p.includes("JUDGE 1"), responses: [{ text: '{"refuted":false}' }] },
    { match: (p) => p.includes("JUDGE 2"), responses: [{ fail: "timeout" }] },
    { match: (p) => p.includes("JUDGE 3"), responses: [{ text: '{"refuted":false}' }] },
  ],
  default: { text: '{"refuted":true}' },
};