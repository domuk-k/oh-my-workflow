# Roadmap

> Where oh-my-workflow is headed: reliable parallel repo checks through coding-agent CLIs.

**Docs:** [oh-my-workflow.vercel.app](https://oh-my-workflow.vercel.app) · **Site source:** [`site/`](site/)

---

## Architecture north star

Plain-JS workflows, thin `AgentPort` adapters, and `omw run` as the shell boundary.
The narrow job is parallel coding-agent repo checks with one result assembled from
shape-validated node outputs and explicit partial-failure receipts in the journal.

## Vision

You should be able to:

1. **Try in 60 seconds** — no API key; one command shows fan-out, schema repair, and the JSONL journal.
2. **Understand the bet** — same authoring vocabulary as host-native Workflow; nodes are whole agent CLIs, not raw LLM calls.
3. **Trust the runtime** — conformance tests, CI, experimental adapters labeled honestly.
4. **Prove repeat use** — public dogfood plus unaffiliated users who run the same job twice.
5. **Debug without spelunking** — journal `kind`, `--pretty`, `omw replay` (studio-style UI later).

**Not goals:** beat LangGraph or Mastra, replicate FleetView, or ship a visual DAG editor as the primary authoring surface.

---

## Current release line (0.5.x)

**Shipped**

- Destructured authoring surface (`budget`, nested `workflow`, `export const meta`)
- CLI adapters: `fake`, `claude`, `codex`, `hermes`, `--agent auto`
- Embedder API: `runInSessionWorkflow()` + `makeInSessionAdapter` / `makeKiroInSessionAdapter`
- `--strict-resume`, JSONL journal, schema-gate repair, `omw codemod`, static docs site

**Next**

- Publish the fixed-source dogfood report and manifests.
- Align npm 0.4.1 with its existing GitHub tag before publishing 0.5.
- Prove the narrow job with unaffiliated repeat users.

---

## Near term

| Theme | Intent |
|-------|--------|
| **Onboarding** | Short terminal demo; skill install path documented end-to-end |
| **Native parity (selective)** | Resume stats on stderr; `log` in `--pretty`; Codex accounting |
| **Evidence** | Fixed-source dogfood with public report and manifests |

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
| **0.4.x** | Destructured API with the legacy `(rt, args)` bridge |
| **0.5** | Legacy bridge removed; breaking changes ship with CHANGELOG + codemod |
| **1.0** | Narrow job repeated by unaffiliated users; adapter claims backed by live evidence |

---

## Out of scope

- Raw LLM API nodes (orchestrator-framework territory)
- Visual DAG / node editor as primary authoring
- Full Claude Code harness clone
- Hosted multi-tenant SaaS
- Human-first docs at the expense of `skill/SKILL.md`
