# oh-my-workflow

[![CI](https://github.com/domuk-k/oh-my-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/domuk-k/oh-my-workflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/oh-my-workflow.svg)](https://www.npmjs.com/package/oh-my-workflow)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=000)](https://bun.sh)

> **Run independent coding-agent repo checks in parallel and return one
> shape-validated artifact — with explicit receipts when a check fails.**

**omw** runs `claude -p` or `codex exec` as nodes in a plain-JS workflow. It
validates output shape, journals each attempt, and leaves completeness policy in
your script instead of pretending a partial run is complete.

---

## Try it in 30 seconds — no API key

```sh
git clone https://github.com/domuk-k/oh-my-workflow && cd oh-my-workflow
bun install
bun src/cli/omw.ts run examples/deep-research --agent fake
```

```json
{"confirmed":[{"topic":"a","hits":3,"verified":true},{"topic":"c","hits":5,"verified":true}],"summary":{"summary":"done","count":2}}
```

Fan-out, schema self-repair, timeout handling — one pass, deterministic:

```sh
bun src/cli/omw.ts run examples/deep-research --agent fake --pretty
```

`--agent fake` needs no network. Swap to `--agent claude` (after `claude login`) or `--agent codex` for real runs.

> On npm: `bunx oh-my-workflow run examples/deep-research --agent fake` — requires **Bun** (not Node `npx`).

---

## The job it is built for

Use omw when several repo checks are independent, each needs a coding agent's
tools and context, and the final consumer needs one predictable JSON shape.
Ordinary shell scripts remain the better choice for deterministic commands.

The runtime supplies bounded parallel subprocesses, JSON Schema shape validation
with repair attempts, and a JSONL receipt for successes, retries, and failures.

---

## How it works

You export a default async function. Hooks arrive as a **destructured first argument** (no magic globals):

```ts
export const meta = { name: "research", phases: [{ title: "Search" }] };

export default async function ({ agent, parallel, phase, budget }, args) {
  phase("Search");
  const hits = (await parallel(
    args.queries.map((q) => () => agent(`SEARCH: ${q}`, { schema: HIT, label: q })),
  )).filter(Boolean);
  return { hits, count: hits.length };
}
```

| Hook | Role |
|------|------|
| `agent(prompt, opts?)` | Run one CLI node. With `schema`, validates JSON and **re-prompts on failure** (up to 2 retries). Returns object or `null` — never throws (except budget exhaustion). |
| `parallel(thunks)` | Concurrent fan-out; failures → `null`. |
| `pipeline(items, …stages)` | Per-item staged flow. |
| `workflow(ref, args?)` | Inline sub-workflow (one level). |
| `budget` | Reported output-token ceiling via `--budget N`. |
| `phase(title)` / `log(msg)` | Journal / `--pretty` side-channel. |

Every step lands in `.omw/<runId>.jsonl`. On failure, read `kind` (`timeout`, `schema_violation`, `nonzero_exit`, …) and fix the script.

**Optional authoring skill:** [`skill/SKILL.md`](skill/SKILL.md) teaches a coding
agent to author, run, and repair these workflows.

**Docs site:** [oh-my-workflow.vercel.app](https://oh-my-workflow.vercel.app) · **Roadmap:** [ROADMAP.md](ROADMAP.md)

---

## Install the skill

```sh
omw skill install              # → ~/.claude/skills/omw
omw skill install --codex      # → ~/.codex/skills/omw
omw skill install --project    # → ./.claude/skills/omw
# or: npx skills add domuk-k/oh-my-workflow --skill omw
```

Then: *"use oh-my-workflow to &lt;task&gt;"* — the agent writes `workflow.ts` and runs `omw run`.

---

## Agent CLIs

`fake` is the deterministic no-key demo. `claude` is the established live path;
`codex` and `hermes` are experimental. One workflow run binds one adapter.

**In-session** (host subagent callback) is **embedder-only** — `runInSessionWorkflow()` from `oh-my-workflow/in-session` with an explicit adapter. See `examples/host-runners/kiro.ts`. The CLI does not probe hosts.

`--agent auto` picks the first installed CLI (or `OMW_AGENT`). Missing adapter → exit `3` with `install_hint`. Pre-flight: `omw validate <wf>`. Resume: `omw run <wf> --resume <runId>`; opt-in safety: `--strict-resume`.

---

## Honest scope

- JSON Schema validates output shape, not factual correctness or source truth.
- **"Deterministic"** = engine guarantees + `--agent fake`. Your script stays conventional unless you pass `--strict`.
- **Resume** = per-node semantic cache keys; filesystem side-channels need care — use `--strict-resume` when nodes pass state via the filesystem.
- **Nodes are heavy** — whole agent CLIs, not lightweight function calls. The novel piece is the **schema-gate self-repair loop**.
- `--budget` counts reported output tokens only. It is not a cost, input-token,
  reasoning-token, or exact concurrent-overshoot cap.

## Why the API looks familiar

Claude Code's native Workflow uses similar `agent` / `parallel` / `pipeline`
vocabulary. omw applies that small authoring shape to external CLI processes; it
does not claim host-level isolation, scheduling, or UI parity.

### Migrating from 0.3

Version 0.5 rejects positional `(rt, args)` scripts. Mechanical upgrade:

```sh
omw codemod path/to/workflow.ts --write
```

---

## Develop

```sh
bun install
bun test            # live adapters only under OMW_LIVE=1
bun run typecheck
```

Conformance suite under `conformance/` proves fan-out, pipeline, schema-gate, and budget loops on `--agent fake`.

## Docs

- [Skill (start here)](skill/SKILL.md)
- [Roadmap](ROADMAP.md)
- [Docs site](https://oh-my-workflow.vercel.app) — built from [`site/`](site/)

## Related

Part of [domuk-k](https://github.com/domuk-k)'s agent-infrastructure stack — alongside [pubifact](https://github.com/domuk-k/pubifact), [open-managed-agents](https://github.com/domuk-k/open-managed-agents), [build-your-own-agent](https://github.com/domuk-k/build-your-own-agent).

## License

MIT
