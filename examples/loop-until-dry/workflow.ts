// loop-until-dry — keep discovering until K consecutive rounds find nothing new.
//
//   bun src/cli/omw.ts run examples/loop-until-dry --agent fake
//
// Each round fans out parallel finders. Duplicates and nulls do not count as
// fresh; two dry rounds in a row (default) ends the loop.

import type { Runtime } from "../../src/runtime";
import type { FakeAdapterOptions } from "../../src/adapters/fake";

const findingSchema = {
  type: "object",
  required: ["key", "title"],
  properties: { key: { type: "string" }, title: { type: "string" } },
};

const FINDERS = [
  { id: "a", label: "finder-a" },
  { id: "b", label: "finder-b" },
] as const;

export const meta = {
  name: "loop-until-dry",
  description: "Parallel finders each round until consecutive empty rounds.",
  phases: [{ title: "Discover" }],
};

type Args = {
  /** Consecutive rounds with no new `key` before stopping. Default 2. */
  dryStreak?: number;
  /** Safety cap so a live run cannot spin forever. Default 10. */
  maxRounds?: number;
};

export default async function loopUntilDry(
  { agent, parallel, phase, log }: Runtime,
  args: Args = {},
) {
  const dryTarget = args.dryStreak ?? 2;
  const maxRounds = args.maxRounds ?? 10;

  phase("Discover");
  const seen = new Set<string>();
  const found: { key: string; title: string }[] = [];
  let dry = 0;
  let round = 0;

  while (dry < dryTarget && round < maxRounds) {
    round++;
    log(`round ${round}`);

    const roundHits = (
      await parallel(
        FINDERS.map(
          (f) => () =>
            agent(`ROUND ${round} FINDER ${f.id}: Report one concrete issue. Use a stable key.`, {
              schema: findingSchema,
              label: `${f.label}:r${round}`,
            }),
        ),
      )
    ).filter(Boolean) as { key: string; title: string }[];

    const fresh = roundHits.filter((hit) => !seen.has(hit.key));
    if (fresh.length === 0) {
      dry++;
      continue;
    }

    dry = 0;
    for (const hit of fresh) {
      seen.add(hit.key);
      found.push(hit);
    }
  }

  return {
    found,
    count: found.length,
    rounds: round,
    dryStreakAtEnd: dry,
    stoppedBecause: dry >= dryTarget ? "dry" : "max_rounds",
  };
}

// Scripted rounds: 1 → two new keys, 2 → one new + one duplicate, 3–4 → dry.
export const fake: FakeAdapterOptions = {
  rules: [
    {
      match: (p) => p.includes("ROUND 1") && p.includes("FINDER a"),
      responses: [{ text: '{"key":"auth-bypass","title":"Missing auth on admin route"}' }],
    },
    {
      match: (p) => p.includes("ROUND 1") && p.includes("FINDER b"),
      responses: [{ text: '{"key":"null-deref","title":"Possible null deref in parser"}' }],
    },
    {
      match: (p) => p.includes("ROUND 2") && p.includes("FINDER a"),
      responses: [{ text: '{"key":"race-window","title":"TOCTOU in cache write"}' }],
    },
    {
      match: (p) => p.includes("ROUND 2") && p.includes("FINDER b"),
      responses: [{ text: '{"key":"auth-bypass","title":"duplicate finding"}' }],
    },
    {
      match: (p) => /ROUND [34]/.test(p),
      responses: [{ fail: "timeout" }],
    },
  ],
  default: { text: '{"key":"unexpected","title":"unmatched prompt"}' },
};