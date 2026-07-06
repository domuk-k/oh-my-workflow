# oh-my-workflow — roadmap

> Portfolio + community bar: **credible OSS twin** of Claude Code dynamic Workflow — not the biggest orchestrator, but the one you can run in CI, inspect in JSONL, and teach any coding agent to author.

**Docs site:** [oh-my-workflow.vercel.app](https://oh-my-workflow.vercel.app)  
**Open questions:** `docs/openq/` (not tracked as GitHub issues unless we start building)

---

## North star (what “recognized” means)

Someone who has never met Dongwook should be able to:

1. **Try in 60 seconds** — no API key, one command, see fan-out + schema repair + journal.
2. **Understand the bet** — “open twin of host-native dynamic Workflow; nodes are whole agent CLIs.”
3. **Trust the engine** — 240+ tests, CI green, honest scope (experimental adapters labeled).
4. **Adopt in their stack** — skill install, `--agent auto`, works in Claude/Codex/cron/CI.
5. **Debug without the author** — JSONL `kind`, `--pretty`, `omw replay`, future studio.

**Not the goal:** beat LangGraph/Mastra, replicate FleetView, or ship a visual DAG editor.

---

## Current state (2026-07)

### Strengths

| Area | Evidence |
|------|----------|
| **Core engine** | `makeRuntime` + schema-gate + journal; 244 tests; conformance suite |
| **Positioning** | Open-twin design spec, native WF research, Show HN draft |
| **Agent-first product** | `skill/SKILL.md` (~645 lines), `omw skill install` multi-host |
| **Demo path** | `examples/deep-research` + `--agent fake` deterministic green |
| **Docs site** | Static site on Vercel, CI builds + checks docs |
| **Recent hardening** | in-session probe, `--strict-resume`, kiro bridge, codex honest warnings |

### Gaps (portfolio / community friction)

| Gap | Why it hurts |
|-----|----------------|
| **0 GitHub stars, no launch moment** | Great engine, no discovery story yet |
| **npm @ 0.4.0, main ahead** | in-session / strict-resume not on npm → `bunx` users miss features |
| **Bun-only** | README says bunx not npx; shrinks audience |
| **README stale vs code** | Missing `in-session`, `--strict-resume`, docs site link |
| **No human watch UI** | Native has `/workflows` TUI; omw has `--pretty` post-hoc only |
| **Research clutter untracked** | `docs/research/*` — fine for author, noisy if committed raw |
| **Live adapter CI** | claude/codex tests skip unless `OMW_LIVE=1` |
| **SKILL adapter table stale** | in-session followUp now exists; table still says “fresh retries only” |

---

## Phases

### Phase 0 — Credibility sweep (1–2 days) · **now**

Ship “this repo is maintained and safe to star.”

- [ ] **0.4.1 release** — changelog: in-session probe, `--agent in-session`, `--strict-resume`, kiro/ambient exports
- [x] **README refresh** — docs site, in-session row, strict-resume one-liner, link this roadmap
- [ ] **SKILL.md sync** — adapter table, `--agent in-session` / auto behavior, in-session followUp
- [x] **GitHub repo metadata** — topics: `claude-code`, `workflow`, `coding-agent`, `bun`, `orchestration`
- [ ] **Issue templates** — bug / adapter request / workflow pattern (minimal)
- [x] **CONTRIBUTING.md** — bun test, no drive-by refactors, skill is part of the product

**Exit:** stranger clones → fake demo green → understands positioning in 5 minutes.

### Phase 1 — Discovery (1–2 weeks)

Make the first impression spread.

- [ ] **Show HN / GeekNews** — draft in gitignored `docs/launch/show-hn.md` (template: `docs/launch.example/`); lead with fake demo + skill one-liner
- [ ] **skills.sh / npx skills add** — ensure skill slug and install path match README
- [ ] **90s terminal recording** — `deep-research --agent fake --pretty` (asciinema or gif)
- [ ] **Examples gallery** — 3 shipped workflows beyond deep-research:
  - verify-vote (abstain quorum)
  - loop-until-dry
  - budget-bounded scan
- [ ] **Blog post (EN or KO)** — one narrative: “native Workflow anatomy → open twin” (research exists; polish one public post)
- [ ] **npm + GitHub release** — tagged `v0.4.1` with release notes

**Exit:** 50+ stars or one substantive HN thread; skill install path verified by a non-author.

### Phase 2 — Native parity that matters (2–4 weeks)

Close the gaps people feel vs Claude Code **without** cloning the harness.

| Priority | Feature | Rationale |
|----------|---------|-----------|
| P0 | **Resume stats on stderr** | `run_end.stats`: cached/total nodes; `--pretty` line (native shows tokens live) |
| P0 | **Studio v0 — Run Explorer** | `/workflows`-shaped journal viewer; see `docs/openq/2026-07-06-workflow-studio.md` |
| P1 | **Claude Code in-session probe** | `probeInSessionHost()` for Task/subagent when API is stable |
| P1 | **`log` in `--pretty`** | native `workflow_log` analog |
| P2 | **Codex adapter hardening** | token/duration accounting; document decline-as-ok limitation |
| P2 | **`pi` adapter** | third CLI leg for “agent-agnostic” claim |

**Defer:** pause/stop/restart agents, FleetView, run_in_background, remote isolation.

**Exit:** author can watch a fan-out live or in studio; resume cache hit rate visible.

### Phase 3 — Community depth (ongoing)

- [ ] **Cookbook** — `examples/README.md` with patterns + when-not-to-use-omw
- [ ] **Adapter conformance matrix** in README (generated or hand-maintained)
- [ ] **Optional `OMW_LIVE=1` nightly** — smoke claude/codex on schedule (secrets)
- [ ] **Node runner experiment** — document-only or spike: `node --experimental-strip-types` (Bun lock-in tradeoff)
- [ ] **Integrations** — GitHub Action `omw run` + upload journal artifact

**Exit:** external PRs touch adapters/examples without breaking spine tests.

---

## Version policy

| Version | Meaning |
|---------|---------|
| **0.4.x** | Open-twin API stable; legacy `(rt, args)` bridge until **0.5** |
| **0.5** | Remove legacy bridge; breaking only if announced in CHANGELOG + codemod |
| **1.0** | Studio v0 + resume stats + 3+ examples + published skill path battle-tested |

---

## What we will not do (keeps the project sharp)

- Raw LLM API nodes (LangGraph territory)
- Visual DAG / node editor as primary authoring
- Full Claude Code harness clone (ambient transform, AST meta, Date freeze by default)
- Hosted multi-tenant SaaS
- Human-first docs at the expense of SKILL.md

---

## How to use this doc

- **Public roadmap (this file)** — phases, north star, what we won't do. Update when strategy shifts.
- **Private kanban** — day-to-day cards live in `docs/tasks/KANBAN.md` (**gitignored**). Template: `docs/tasks.example/KANBAN.md` → `cp` to `docs/tasks/`.
- **Launch drafts** — `docs/launch/` is gitignored (Show HN copy, GeekNews variants). Template: `docs/launch.example/`.
- **Research scratch** — `docs/research/` is also gitignored; promote or discard before any publish.
- Open Qs live in `docs/openq/` (tracked) until a phase commits to building.
- Revisit phases after launch metrics (stars, npm weekly downloads, skill installs if measurable).

**Maintainer:** ROADMAP = strategy; KANBAN = sprint board.