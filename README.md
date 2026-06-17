# oh-my-workflow

> Run the coding-agent CLIs you already have — `claude -p`, `codex exec` — as
> nodes in a plain-JS workflow your host agent writes. omw is the thin glue: it
> runs the script, schema-gates each node's output, and journals every step so the
> agent can read its own failure and repair its own script. (What's
> "deterministic" is scoped honestly below — the engine and `--agent fake`, not
> your script.)

## Try it now — free, no API key

```sh
git clone https://github.com/domuk-k/oh-my-workflow && cd oh-my-workflow
bun install
bun src/cli/omw.ts run examples/deep-research --agent fake
```

```json
{"confirmed":[{"topic":"a","hits":3,"verified":true},{"topic":"c","hits":5,"verified":true}],"summary":{"summary":"done","count":2}}
```

That's the whole spine in one pass — a `--pretty` tree shows it:

```sh
bun src/cli/omw.ts run examples/deep-research --agent fake --pretty
```

```
run r-… (examples/deep-research)
  ▸ Scope
    • call#1 [fake]
      ✓ call#1
  ▸ Search
    • search:a [fake]
    • search:b [fake]
    • search:c [fake]
      ✗ timeout call#3
      ✓ call#4
      ✓ call#2
  ▸ Verify
    • call#5 [fake]
    • call#6 [fake]
      ✓ call#5
      ✓ call#6
  ▸ Synthesize
    • call#7 [fake]
      ✓ call#7
run_end ok=true · 6 ok / 1 failed
```

`search:a` (call#2) returns invalid JSON first and self-repairs to `✓`; `search:b`
(call#3) times out and is dropped by `filter(Boolean)` — the run still ends green.

`--agent fake` is a built-in deterministic adapter — no API key, no network. A
stranger runs the full fan-out + pipeline + a scripted schema-fail→self-repair +
a scripted timeout→drop, and gets a stable result JSON. Swap `--agent claude`
(after `claude login`) to run it for real.

> Once on npm this is `bunx oh-my-workflow run examples/deep-research --agent fake`
> — the example ships inside the package and resolves from there, so it runs from
> any directory. omw runs under **bun**; `npx` (Node) won't execute the TS bin.

## What it is

You write a plain-JS orchestration script. Its nodes are **whole coding agents**
(`claude -p`, `codex exec`) — not single LLM calls. The runtime hands your script
**five hooks** and nothing else:

```ts
export default async function (rt, args) {
  rt.phase("Search");
  const hits = (await rt.parallel(
    args.queries.map((q) => () => rt.agent(`SEARCH: ${q}`, { schema: HIT, label: q })),
  )).filter(Boolean);                 // agent() returns null on failure, never throws
  return { hits, count: hits.length };
}
```

- `rt.agent(prompt, opts?)` — run one coding-agent CLI node. With a `schema`, omw
  extracts JSON, validates it (ajv), and **re-prompts the node with the
  validation errors** up to 2 times before giving up. Returns the validated
  object, or `null`. **Never throws** — the load-bearing *null-contract*.
- `rt.parallel(thunks)` — concurrent, barrier; failures become `null`.
- `rt.pipeline(items, …stages)` — each item flows through all stages independently.
- `rt.phase(title)` / `rt.log(msg)` — journal / `--pretty` side-channel only.

Concurrency is bounded at the `agent()` boundary (default 4, `--concurrency N`).
Every step is recorded to the journal file `.omw/<runId>.jsonl`, so when a node
fails you read the `kind` (`timeout` / `nonzero_exit` / `schema_violation` / …)
and fix your script. stdout is one result JSON; the `--pretty` tree and a
`journal: <path>` pointer go to stderr.

**The full agent-facing guide is [`skill/SKILL.md`](skill/SKILL.md)** — patterns
(fan-out / verify-vote / pipeline / loop-until-dry), the debug loop, and the
conventions. That skill is the primary product; this README is the human intro.

## Install the skill (the primary product)

omw's primary product is an **agent-authoring skill** (`skill/SKILL.md`) — it
teaches a coding agent to write, run, and repair omw workflows. After the package
is installed, wire the skill into your agent in one step:

```sh
omw skill install            # → ~/.claude/skills/oh-my-workflow  (Claude Code auto-discovers it)
omw skill install --project  # → ./.claude/skills/oh-my-workflow  (this repo only)
omw skill path               # print the bundled SKILL.md path (cat / pipe / point an agent at it)
```

Then ask your coding agent: *"use oh-my-workflow to &lt;task&gt;"* — it authors a
`workflow.ts` and runs it with `omw run`. (The skill is Claude-Code-flavored;
for other hosts use `omw skill path` and feed the file in however that host loads
context.)

## Adapters

A node is a coding agent driven through its headless prompt→result CLI.

| adapter | status | notes |
|---|---|---|
| **fake** | built-in, free, deterministic | the no-key demo engine and test double |
| **claude** | **full** (live-verified, 2.1.x) | `claude -p --output-format json --strict-mcp-config` (nodes isolated from host MCP by default; opt in per call with `inheritMcp`); `--resume` (same cwd) powers in-session schema self-repair |
| **codex** | **experimental** (live-verified, 0.137.x) | `codex exec --json`; **no cost field**; tolerates malformed JSONL ([openai/codex#15451](https://github.com/openai/codex/issues/15451)) and fails *actionably* |
| **pi** | planned | not wired yet (`--agent pi` → exit 3 + install hint) |
| **kiro** | not a fit | its CLI is an IDE launcher (open files/diffs), no headless prompt→result interface |

A missing CLI exits `3` with an `install_hint` instead of failing mid-run. A node
that hits `internal_error` (e.g. an invalid JSON Schema) escalates the run to exit
`4` (result still on stdout) so an author bug doesn't hide behind the null-contract.
`omw validate <wf>` is a pre-flight load + fake-fixture lint that spawns no agents.

## Honest scope (read before you judge the novelty)

omw externalizes a pattern Claude Code uses internally for dynamic workflows
("the model authors a deterministic orchestration script on the fly"). It is a
**faithful reconstruction of that pattern as OSS** — not a decompiled copy, and
**no claim of first / best / moat**.

- **"deterministic"** means: the engine's guarantees (stable resume keys, JSONL
  recording, schema-gate) **and** the `--agent fake` demo. Your *script's*
  determinism is a **convention you keep** — there is **no sandbox**, so omw
  can't stop a workflow from calling `Date.now()`.
- **resume**: the journal format and resume key `(callIndex, promptHash,
  optsHash)` (journaled as `call`) are **frozen and proven byte-stable** (identical re-run = 100% key
  hits; edit the last node = hits up to the first change, then a miss). **Live
  resume has landed**: `omw run <wf> --resume <journal>` reuses any node whose
  `(callIndex, promptHash, optsHash)` key hits (adapter not invoked,
  `agent_end{cached:true}`) and re-runs the rest — verified end-to-end on
  `--agent fake`. Resume is **per-node key match, not dependency-aware**: it
  behaves as longest-unchanged-prefix only when upstream outputs flow into
  downstream prompts (the usual data-flow shape). When nodes instead pass state
  through the **filesystem** (the normal coding-agent idiom — node 1 writes files
  node 2 reads), an upstream edit re-runs node 1 but a cached node 2 serves a
  **stale** result; re-run fresh, or thread a file digest into the downstream
  prompt. Keeping per-node preserves parallel/pipeline sibling cache; a
  `--strict-resume` prefix-truncation opt-in and dependency-aware cascade are v2.
  It holds **only for deterministic workflows**: omw can't *enforce* determinism
  (no sandbox), so that stays a convention you keep (enforcement is v2). `omw replay` remains a
  read-only **fixture replay** (reconstructing a recorded run's view), a separate
  command — not the resume path.
- an omw node is a **whole external coding-agent CLI**, heavier than a single
  in-harness subagent.
- **not in v1** (the CC dynamic-workflow surface has these; omw doesn't yet):
  `budget`, nested `workflow()`, a `meta`/`phases` block, custom `agentType`,
  `run_in_background`, worktree isolation.

The one genuinely novel piece of code is the **schema-gate self-repair loop** —
the part a "subprocess + for-loop" comparison misses. Everything else is honest
glue. The fuller positioning (4-way prior-art table, resemblance ledger) lives in
[`skill/SKILL.md`](skill/SKILL.md) and the
[launch strategy](https://github.com/domuk-k/oh-my-workflow/blob/main/docs/specs/2026-06-14-omw-launch-strategy.md).

## Develop

```sh
bun install
bun test            # 136 pass / 2 skip (live adapters, OMW_LIVE=1) / 0 fail
bun test --coverage # ~99% lines on the pure core
bun run typecheck   # tsc --noEmit, clean
```

`test/spine.test.ts` is the gate: one full `scope → search → verify → synthesize`
pass against the fake adapter, including the scripted schema-fail → self-repair →
`filter(Boolean)` survival cycle. Live adapter tests run only under `OMW_LIVE=1`
(they spend real tokens) and are skipped by default.

## Docs

- **Skill (primary product)**: [`skill/SKILL.md`](skill/SKILL.md)
- Product spec: [`docs/specs/2026-06-12-oh-my-workflow-design.md`](https://github.com/domuk-k/oh-my-workflow/blob/main/docs/specs/2026-06-12-oh-my-workflow-design.md)
- Launch strategy + scorecard: [`docs/specs/2026-06-14-omw-launch-strategy.md`](https://github.com/domuk-k/oh-my-workflow/blob/main/docs/specs/2026-06-14-omw-launch-strategy.md)
- Resume / determinism internals: [`docs/specs/2026-06-15-resume-internals-deepdive.md`](https://github.com/domuk-k/oh-my-workflow/blob/main/docs/specs/2026-06-15-resume-internals-deepdive.md)

## License

MIT
