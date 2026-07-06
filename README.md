# oh-my-workflow

[![CI](https://github.com/domuk-k/oh-my-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/domuk-k/oh-my-workflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/oh-my-workflow.svg)](https://www.npmjs.com/package/oh-my-workflow)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=000)](https://bun.sh)

> **Open dynamic-workflow runtime for coding-agent CLIs** — write a plain-JS orchestration script; nodes are `claude -p`, `codex exec`, or other headless agent CLIs. Schema-gated outputs, JSONL journal, repair loop. Portable twin of Claude Code's native Workflow tool.

**omw** is the thin glue: run the script, validate each node, journal every step, and let the authoring agent read failures and fix its own workflow.

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

## Why oh-my-workflow?

Claude Code ships a **dynamic Workflow** tool: the model writes a JS orchestration script; the harness runs `agent()` / `parallel()` / `pipeline()` with in-harness subagents. Excellent — and closed to that host.

**omw is the open twin.** Same authoring vocabulary, but:

| | Native Workflow | omw |
|---|-----------------|-----|
| **Runs where** | Claude Code only | Claude Code, Codex, cron, CI, any shell |
| **A node is** | In-harness subagent | Whole external coding-agent CLI |
| **Script style** | Harness-specific | Boring standard JS — no transform, no ambient globals |
| **Debug surface** | Host journal | `.omw/<runId>.jsonl` + `--pretty` tree |

```ts
// native — inside Claude Code
export default async function ({ agent, parallel }) {
  const found = await parallel(topics.map((t) => () => agent(`research ${t}`)));
  return { found };
}

// omw — anywhere, nearly identical
export default async function ({ agent, parallel }, args) {
  const found = await parallel(topics.map((t) => () => agent(`research ${t}`)));
  return { found: found.filter(Boolean) };
}
```

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
| `budget` | Token spend ceiling via `--budget N`. |
| `phase(title)` / `log(msg)` | Journal / `--pretty` side-channel. |

Every step lands in `.omw/<runId>.jsonl`. On failure, read `kind` (`timeout`, `schema_violation`, `nonzero_exit`, …) and fix the script.

**Primary product:** [`skill/SKILL.md`](skill/SKILL.md) — teaches coding agents to author, run, and repair omw workflows.

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

## Adapters

| Adapter | Status | Notes |
|---------|--------|-------|
| **fake** | Built-in | Deterministic demo + tests; no API key |
| **in-session** | Host probe | `--agent in-session` or `--agent auto` when the host exposes a subagent callback; no CLI fallback |
| **claude** | Full | `claude -p --output-format json`; schema repair via `--resume` |
| **codex** | Experimental | `codex exec --json` |
| **hermes** | Experimental | `hermes -z` one-shot |
| **pi** | Planned | — |

`--agent auto` picks in-session when a host callback exists, else the first installed CLI. Missing adapter → exit `3` with `install_hint`. Pre-flight: `omw validate <wf>`. Resume: `omw run <wf> --resume <runId>`; opt-in safety: `--strict-resume`.

---

## Honest scope

- **Not** a decompiled Claude Code clone — a faithful OSS reconstruction of the dynamic-workflow *pattern*.
- **"Deterministic"** = engine guarantees + `--agent fake`. Your script stays conventional unless you pass `--strict`.
- **Resume** = per-node semantic cache keys; filesystem side-channels need care (see [resume deep-dive](docs/specs/2026-06-15-resume-internals-deepdive.md)).
- **Nodes are heavy** — whole agent CLIs, not lightweight function calls. The novel piece is the **schema-gate self-repair loop**.

### Migrating from 0.3

Legacy `(rt, args)` scripts still run (deprecated). Mechanical upgrade:

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
- [Docs site](https://oh-my-workflow.vercel.app)
- [Open-twin design](docs/specs/2026-06-23-omw-open-dynamic-workflow-twin-design.md)
- [Product spec](docs/specs/2026-06-12-oh-my-workflow-design.md)

## Related

Part of [domuk-k](https://github.com/domuk-k)'s agent-infrastructure stack — alongside [pubifact](https://github.com/domuk-k/pubifact), [open-managed-agents](https://github.com/domuk-k/open-managed-agents), [build-your-own-agent](https://github.com/domuk-k/build-your-own-agent).

## License

MIT