// deep-research — the reference workflow and the free `--agent fake` hero demo.
//
//   bunx oh-my-workflow run examples/deep-research --agent fake
//
// It exercises the whole spine in one pass: phase → fan-out search (parallel) →
// per-finding verify (pipeline) → synthesize. One search node is scripted to
// hard-fail and one to return schema-invalid JSON first, so the demo also shows
// the two load-bearing behaviors live:
//   • null-contract  — a failed node resolves to null and is dropped by
//     filter(Boolean); the run still completes green.
//   • self-repair    — an invalid-JSON node is re-prompted with the schema error
//     and recovers, without the authoring script ever seeing the noise.
//
// `fake` fixtures are co-located so the demo is deterministic with no API key.
// Swap `--agent fake` for `--agent claude` (once configured) to run it for real.

import type { Runtime } from "../../src/runtime";
import type { FakeAdapterOptions } from "../../src/adapters/fake";

const scopeSchema = {
  type: "object",
  required: ["topics"],
  properties: { topics: { type: "array" } },
};
const searchSchema = {
  type: "object",
  required: ["topic", "hits"],
  properties: { topic: { type: "string" }, hits: { type: "number" } },
};
const verifySchema = {
  type: "object",
  required: ["verified"],
  properties: { verified: { type: "boolean" } },
};
const synthSchema = {
  type: "object",
  required: ["summary", "count"],
  properties: { summary: { type: "string" }, count: { type: "number" } },
};

export default async function deepResearch({ agent, parallel, pipeline, phase }: Runtime, _args: unknown) {
  phase("Scope");
  const scope = (await agent("SCOPE the research question into topics", {
    schema: scopeSchema,
  })) as { topics: string[] } | null;
  if (!scope) return { error: "scoping failed", confirmed: 0 };

  phase("Search");
  const searched = await parallel(
    scope.topics.map((t) => () => agent(`SEARCH ${t}`, { schema: searchSchema, label: `search:${t}` })),
  );
  const found = searched.filter(Boolean); // a failed/timed-out node is dropped here

  phase("Verify");
  const verified = await pipeline(found, async (f) => {
    const v = await agent(`VERIFY ${JSON.stringify(f)}`, { schema: verifySchema });
    return v ? { ...(f as object), ...(v as object) } : null;
  });
  const confirmed = verified.filter(Boolean);

  phase("Synthesize");
  const summary = await agent(`SYNTH over ${confirmed.length} findings`, { schema: synthSchema });

  return { confirmed, summary };
}

// Deterministic fixtures for `--agent fake`: topic `a` self-repairs (invalid
// JSON + sessionId → repaired), topic `b` hard-fails (timeout → dropped),
// topic `c` succeeds. Net: 2 confirmed findings, one synthesized summary.
export const fake: FakeAdapterOptions = {
  rules: [
    { match: (p) => p.includes("SCOPE"), responses: [{ text: '{"topics":["a","b","c"]}' }] },
    {
      match: (p) => p.includes("SEARCH a"),
      responses: [{ text: '{"oops":1}', sessionId: "sa" }, { text: '{"topic":"a","hits":3}' }],
    },
    { match: (p) => p.includes("SEARCH b"), responses: [{ fail: "timeout" }] },
    { match: (p) => p.includes("SEARCH c"), responses: [{ text: '{"topic":"c","hits":5}' }] },
    { match: (p) => p.includes("VERIFY"), responses: [{ text: '{"verified":true}' }] },
    { match: (p) => p.includes("SYNTH"), responses: [{ text: '{"summary":"done","count":2}' }] },
  ],
};
