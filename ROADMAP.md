# Roadmap

> Where oh-my-workflow is headed — an open, portable twin of the dynamic Workflow pattern used in coding-agent hosts.

**Docs:** [oh-my-workflow.vercel.app](https://oh-my-workflow.vercel.app) · **Open questions:** [`docs/openq/`](docs/openq/)

---

## Vision

You should be able to:

1. **Try in 60 seconds** — no API key; one command shows fan-out, schema repair, and the JSONL journal.
2. **Understand the bet** — same authoring vocabulary as host-native Workflow; nodes are whole agent CLIs, not raw LLM calls.
3. **Trust the runtime** — conformance tests, CI, experimental adapters labeled honestly.
4. **Adopt anywhere** — skill install, `--agent auto`, Claude / Codex / cron / CI.
5. **Debug without spelunking** — journal `kind`, `--pretty`, `omw replay` (studio-style UI later).

**Not goals:** beat LangGraph or Mastra, replicate FleetView, or ship a visual DAG editor as the primary authoring surface.

---

## Current release line (0.4.x)

**Shipped**

- Open-twin authoring surface (destructured hooks, `budget`, nested `workflow`, `export const meta`)
- Adapters: `fake`, `claude`, `codex`, `hermes`, `in-session` (host probe), `--agent auto`
- `--strict-resume`, JSONL journal, schema-gate repair, `omw codemod`, static docs site

**Next**

- **0.4.1** — npm + GitHub release aligned with main (in-session, strict-resume)
- **SKILL.md** — keep adapter table and CLI flags in sync with code
- **Issue templates** — bug, adapter request, workflow pattern
- **Examples** — verify-vote, loop-until-dry, budget-bounded scan (beyond `deep-research`)

---

## Near term

| Theme | Intent |
|-------|--------|
| **Onboarding** | Short terminal demo; skill install path documented end-to-end |
| **Native parity (selective)** | Resume stats on stderr; `log` in `--pretty`; Codex accounting |
| **Run explorer** | Read-mostly UI on JSONL — see [`docs/openq/2026-07-06-workflow-studio.md`](docs/openq/2026-07-06-workflow-studio.md) |

**Explicitly deferred:** pause/stop agents, FleetView, `run_in_background`, remote isolation, harness-style ambient transform.

---

## Later

- Cookbook (`examples/README.md`) with when-not-to-use-omw
- Adapter conformance matrix in README
- Optional `OMW_LIVE=1` scheduled smoke for real CLIs
- GitHub Action: `omw run` + journal artifact upload
- Node runner spike (`--experimental-strip-types`) — Bun lock-in tradeoff

---

## Version policy

| Version | Meaning |
|---------|---------|
| **0.4.x** | Open-twin API stable; legacy `(rt, args)` bridge until **0.5** |
| **0.5** | Remove legacy bridge; breaking changes only with CHANGELOG + codemod |
| **1.0** | Run explorer v0, resume stats, 3+ examples, skill path battle-tested |

---

## Out of scope

- Raw LLM API nodes (orchestrator-framework territory)
- Visual DAG / node editor as primary authoring
- Full Claude Code harness clone
- Hosted multi-tenant SaaS
- Human-first docs at the expense of `skill/SKILL.md`