# oh-my-workflow

> **The open dynamic-workflow runtime** — the portable twin of Claude Code's
> native dynamic Workflow. You write a plain-JS orchestration script; its nodes
> are whole coding-agent CLIs (`claude -p`, `codex exec`). omw is the thin glue:
> it runs the script, schema-gates each node's output, journals every step so the
> authoring agent can read its own failure and repair its own script — and gives
> you the same vocabulary as the native tool (`agent` / `parallel` / `pipeline` /
> `workflow` / `budget`), with **no magic** (no source transform, no ambient
> globals, no sandbox-by-default). What's "deterministic" is scoped honestly below.

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

## The twin framing

Claude Code has a built-in **dynamic Workflow** tool: when a task is big enough,
the model writes a deterministic JS orchestration script on the fly and the
harness runs it — `agent()` to spawn subagents, `parallel`/`pipeline` to fan out,
`budget` to bound the run, `workflow()` to nest. That surface is excellent and
**closed** (it only runs inside Claude Code, and its nodes are in-harness
subagents).

**omw is the open twin of that surface.** Same authoring shape, same vocabulary —
but the nodes are *whole external coding-agent CLIs* you already have, it runs
from any host (Claude Code, Codex, opencode, a cron job), and the whole thing is
a few hundred lines of standard TypeScript you can read.

```ts
// native dynamic Workflow — inside Claude Code
export default async function ({ agent, parallel }) {
  const found = await parallel(topics.map((t) => () => agent(`research ${t}`)));
  return { found };
}
```

```ts
// omw — anywhere, same shape
export default async function ({ agent, parallel }, args) {
  const found = await parallel(topics.map((t) => () => agent(`research ${t}`)));
  return { found: found.filter(Boolean) };
}
```

The script is nearly the same; what differs is what a node *is* and where it runs.

## What it is

You write a plain-JS orchestration script. Its default export takes the **hooks**
as a destructured first arg and your `args` as the second — exactly the native
shape:

```ts
export const meta = { name: "research", phases: [{ title: "Search" }] };

export default async function ({ agent, parallel, phase, budget }, args) {
  phase("Search");
  const hits = (await parallel(
    args.queries.map((q) => () => agent(`SEARCH: ${q}`, { schema: HIT, label: q })),
  )).filter(Boolean);                 // agent() returns null on failure, never throws
  return { hits, count: hits.length };
}
```

The hooks — destructure only what you use:

- **`agent(prompt, opts?)`** — run one coding-agent CLI node. With a `schema`, omw
  extracts JSON, validates it (ajv), and **re-prompts the node with the validation
  errors** up to 2 times before giving up. Returns the validated object, or
  `null`. **Never throws** — the load-bearing *null-contract* (the one exception
  is `budget` exhaustion; see below). `opts`: `schema`, `model`, `label`, `phase`,
  `effort`, `agentType`, `isolation: 'worktree'`, `cwd`, `inheritMcp`, `timeoutMs`.
- **`parallel(thunks)`** — concurrent, barrier; failures become `null`.
- **`pipeline(items, …stages)`** — each item flows through all stages independently.
- **`workflow(ref, args?)`** — run another workflow inline as a sub-step (one level
  deep), sharing the adapter, journal, and budget pool.
- **`budget`** — `{ total, spent(), remaining() }`. Set a ceiling with `--budget N`;
  once spent reaches it, `agent()` throws `BudgetExceededError` (the documented
  null-contract exception) so a bounded loop terminates instead of spinning.
- **`phase(title)` / `log(msg)`** — journal / `--pretty` side-channel only.

`export const meta` is optional — `{ name, description, whenToUse, model, phases }`,
matching native. A per-phase or default `model` resolves along
`opts.model > phase model > meta.model`.

Concurrency is bounded at the `agent()` boundary (default 4, `--concurrency N`).
Every step is recorded to `.omw/<runId>.jsonl`, so when a node fails you read the
`kind` (`timeout` / `nonzero_exit` / `refusal` / `schema_violation` / …) and fix
your script. stdout is one result JSON; the `--pretty` tree and a `journal: <path>`
pointer go to stderr.

**The full agent-facing guide is [`skill/SKILL.md`](skill/SKILL.md)** — patterns
(fan-out / verify-vote / pipeline / loop-until-dry), the debug loop, and the
conventions. That skill is the primary product; this README is the human intro.

## No magic (the differentiator)

The native tool can lean on the harness; an open twin has to earn portability.
omw's deliberate choice: **be boring standard JS.**

- **No source transform.** Your script is run as-is (`await import`), not rewritten.
  What you write is what executes.
- **No ambient globals.** Hooks arrive as a destructured argument, not injected
  into scope. No hidden `agent` global to explain.
- **No sandbox by default.** Determinism is a *convention you keep*; opt into
  enforcement with `--strict` (freezes `Date`/`Math.random` to throw) when you
  want a reproducible run.

That's why the same script reads cleanly in a README, a repo, or another agent's
context — there's nothing non-standard to carry along.

## Install the skill (the primary product)

omw's primary product is an **agent-authoring skill** (`skill/SKILL.md`) — it
teaches a coding agent to write, run, and repair omw workflows. After the package
is installed, wire the skill into your agent in one step:

```sh
omw skill install              # → ~/.claude/skills/oh-my-workflow   (Claude Code)
omw skill install --codex      # → ~/.codex/skills/oh-my-workflow
omw skill install --opencode   # → ~/.config/opencode/skills/oh-my-workflow
omw skill install --project    # → ./.claude/skills/oh-my-workflow   (this repo only)
omw skill path                 # print the bundled SKILL.md path
```

Then ask your coding agent: *"use oh-my-workflow to &lt;task&gt;"* — it authors a
`workflow.ts` and runs it with `omw run`.

## Adapters

A node is a coding agent driven through its headless prompt→result CLI.

| adapter | status | notes |
|---|---|---|
| **fake** | built-in, free, deterministic | the no-key demo engine and test double |
| **claude** | **full** (live-verified, 2.1.x) | `claude -p --output-format json --strict-mcp-config` (nodes isolated from host MCP by default; opt in per call with `inheritMcp`); `--resume` (same cwd) powers in-session schema self-repair. `effort`/`agentType` have no faithful CLI flag yet → dropped with a one-time warn (honest-scope) |
| **codex** | **experimental** (live-verified, 0.137.x) | `codex exec --json`; **no cost field**; tolerates malformed JSONL ([openai/codex#15451](https://github.com/openai/codex/issues/15451)) and fails *actionably* |
| **pi** | planned | not wired yet (`--agent pi` → exit 3 + install hint) |

A missing CLI exits `3` with an `install_hint` instead of failing mid-run. A node
that hits `internal_error` (e.g. an invalid JSON Schema) escalates the run to exit
`4` (result still on stdout) so an author bug doesn't hide behind the null-contract.
`omw validate <wf>` is a pre-flight load + fake-fixture lint that spawns no agents.

## Migrating from 0.3 (`(rt, args)` → destructured DI)

0.3 scripts wrote `export default async function (rt, args) { rt.agent(…) }`. That
**still works** in 0.4 — the same object is passed as the first arg, so a legacy
`rt` script and a new `({ agent })` script both run. You'll get a one-time
deprecation notice on legacy scripts; the bridge is removed in 0.5.

Migrate mechanically:

```sh
omw codemod path/to/workflow.ts            # prints the destructured-DI version
omw codemod path/to/workflow.ts --write    # rewrites in place
```

## Honest scope (read before you judge the novelty)

omw externalizes a pattern Claude Code uses internally for dynamic workflows
("the model authors a deterministic orchestration script on the fly"). It is a
**faithful reconstruction of that pattern as OSS** — not a decompiled copy, and
**no claim of first / best / moat**.

- **"deterministic"** means: the engine's guarantees (stable resume keys, JSONL
  recording, schema-gate) **and** the `--agent fake` demo. Your *script's*
  determinism is a **convention you keep** unless you pass `--strict` (opt-in
  freeze-throw on `Date`/`Math.random`).
- **resume**: the journal format and resume key `(callIndex, promptHash,
  optsHash)` are **frozen and byte-stable** (identical re-run = 100% key hits;
  edit the last node = hits up to the first change, then a miss). `omw run <wf>
  --resume <journal|runId>` reuses any node whose key hits (adapter not invoked,
  `agent_end{cached:true}`) and re-runs the rest. The key is **semantic** —
  cosmetic `label`/`phase` changes don't bust the cache; `model`/`schema`/`effort`/
  `isolation` do. Resume is **per-node key match, not dependency-aware**: when
  nodes pass state through the **filesystem** (node 1 writes, node 2 reads), an
  upstream edit re-runs node 1 but a cached node 2 can serve a **stale** result —
  re-run fresh, or thread a file digest into the downstream prompt. A
  dependency-aware cascade is v2.
- **`budget`** bounds *output-token spend the adapter reports*. A token-less
  failure (a killed timeout reports no `usage`) can't be counted, so a loop on a
  purely-timing-out node isn't bounded by `--budget` alone — pair it with your own
  iteration cap.
- an omw node is a **whole external coding-agent CLI**, heavier than a single
  in-harness subagent. JSON is extracted heuristically; cross-node state often
  flows through the **filesystem** (a real side-channel, not modeled by resume).

The one genuinely novel piece of code is the **schema-gate self-repair loop** —
the part a "subprocess + for-loop" comparison misses. Everything else is honest
glue.

## Develop

```sh
bun install
bun test            # green (live adapters run only under OMW_LIVE=1) / 0 fail
bun run typecheck   # tsc --noEmit, clean
```

The conformance suite (`conformance/*.ts` + `test/conformance.test.ts`) is the
drop-in proof: native-shaped, destructured-DI scripts — fan-out, pipeline,
schema-gate, budget-loop, `--strict` — all run green under `--agent fake`. Live
adapter tests run only under `OMW_LIVE=1` (they spend real tokens).

## Docs

- **Skill (primary product)**: [`skill/SKILL.md`](skill/SKILL.md)
- Open-twin design: [`docs/specs/2026-06-23-omw-open-dynamic-workflow-twin-design.md`](https://github.com/domuk-k/oh-my-workflow/blob/main/docs/specs/2026-06-23-omw-open-dynamic-workflow-twin-design.md)
- Product spec: [`docs/specs/2026-06-12-oh-my-workflow-design.md`](https://github.com/domuk-k/oh-my-workflow/blob/main/docs/specs/2026-06-12-oh-my-workflow-design.md)
- Resume / determinism internals: [`docs/specs/2026-06-15-resume-internals-deepdive.md`](https://github.com/domuk-k/oh-my-workflow/blob/main/docs/specs/2026-06-15-resume-internals-deepdive.md)

## License

MIT
