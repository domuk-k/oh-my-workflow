# Open Q — omw Workflow Studio (UI)

> Status: **open question** · not a spec · 2026-07-06
> GitHub: https://github.com/domuk-k/oh-my-workflow/issues/4

## Why this might matter

omw's spine today is **agent-first and file-based**:

- Author: plain-JS `workflow.js` + SKILL.md
- Run: `omw run …` → stdout JSON + `.omw/<runId>.jsonl`
- Debug: read journal, `omw replay`, `--pretty` tree on stderr

That is the right core for CI, in-session hosts, and coding agents that repair their own scripts. It is **weak for humans** (and for agents that benefit from spatial layout) when:

- A fan-out has 12 nodes and you need to see *which* branch failed at a glance
- You are comparing two runs / resume cache hits (`cached:true` flags)
- You want to iterate on a workflow without re-reading 400 lines of JSONL
- You want a "what would native Claude Code Workflow UI feel like" twin outside the harness

A **Workflow Studio** (name TBD: Studio / Console / Portal) would be a **read-mostly + light-edit** surface on top of the existing contracts — not a second runtime.

## Reference: Claude Code native dynamic Workflow UI/TUI

Claude Code already ships a **simple but real** workflow UI on both **Desktop app** and **CLI** — not a full DAG editor, but enough to run, watch, approve, and drill into agents. omw should treat this as the **parity bar for human-facing surfaces**, while keeping JSONL as the richer machine-facing spine.

Sources: [Claude Code workflows docs](https://code.claude.com/docs/en/workflows), `docs/research/2026-06-17-claude-code-internals-archaeology.md`, twin design spec §1.2 (`meta` → permission dialog + progress tree).

### What native provides (surface by surface)

| Native surface | What the user sees | omw today | Studio target |
|----------------|-------------------|-----------|---------------|
| **Launch approval** | CLI: planned phases + Yes / View raw script / No; Desktop: approval card with phase list + Once/Always/Deny | nothing (script is a file; `omw validate` is separate) | optional pre-run card from `export const meta` + phase list |
| **Task panel strip** | One-line live progress under the input; ↓ to focus, Enter to expand | `--pretty` tree on **stderr** at end of run only | live tail of journal → same one-liner while running |
| **`/workflows` TUI** | List running + completed runs; per-run progress view | `omw replay` (post-hoc, read-only) | Run list + interactive progress view |
| **Phase row** | Phase name, agent count, token total, elapsed time | `phase` events + `agent_start`/`agent_end` in journal | same columns, sourced from JSONL |
| **Agent drill-down** | Enter on phase → agent list; Enter on agent → prompt, recent tool calls, result | journal has promptHash/label/result/kind; no tool-call stream | agent detail drawer from `agent_end` + `attempt` events |
| **Run controls** | `p` pause/resume, `x` stop agent or whole run, `r` restart agent, `f` filter by status | none (CLI is fire-and-forget) | v2+; needs runtime hooks — **not v0** |
| **`workflow_log` stream** | Human progress lines via synthetic progress channel (`log()` → UI) | `log` events in journal; `--pretty` ignores them today | show `log` lines inline in progress view |
| **Save workflow** | `s` in `/workflows` → `.claude/workflows/<name>` | workflow already a file in repo | N/A (omw workflows are files by design) |
| **Resume in session** | Paused run resumes; completed agents return from cache | `--resume` + per-node cache flags in journal | resume diff UI (cached vs live per call) |
| **Cost visibility** | Per-agent token usage in `/workflows` while running | `budget.spent()` + optional `outputTokens` in adapter meta | token column when adapters report usage |
| **Background + responsive** | Script runs in isolated env; chat stays clean; final return only | same separation if in-session; CLI runs block the shell unless backgrounded externally | in-session monitor + optional detached `omw run` |

### Native UX principles worth copying (not cloning)

1. **Plan before run** — `meta.name` + `meta.phases[]` shown *before* spawning agents (AST-extracted in native; module export in omw). User/agent sees scope, not a black box.
2. **Progress without context pollution** — intermediate noise stays out of the main conversation; only the final JSON hits stdout. omw already does this; studio makes the *side channel* visible.
3. **Shallow tree, deep drill-down** — phase list first, agents second, detail third. Matches `renderTree()` shape:

   ```
   run r-abc (examples/deep-research)
     ▸ Search
       • search:a [fake]
         ✓ call#2
   ```

4. **Simple TUI, not a canvas** — arrow keys, Enter, Esc. No node-graph editor. Studio v0 should be the same altitude: **terminal-like or narrow web panel**, not Figma for workflows.
5. **Same vocabulary on CLI and Desktop** — debounced task summary mirrored to LocalSessionManager (archaeology). omw analog: one `renderTree` / JSON API consumed by CLI (`--pretty`), web studio, and VS Code webview.

### Explicit non-parity (ok to defer)

- FleetView / multi-workflow fleet management
- Pause/restart/stop per agent (needs runtime control plane)
- Permission-mode-specific approval flows
- `ultracode` / `/effort` session modes
- Worktree isolation UI

## Non-goals (v0)

- Not a visual DAG editor that replaces plain-JS authoring (agent-first stays primary)
- Not a hosted SaaS requirement on day one (local-first is fine)
- Not a second orchestration engine (runtime.ts remains the truth)
- Not interactive prompts mid-run (omw's `no-interactive` invariant holds)

## What already exists to build on

| Asset | Role for a studio |
|-------|-------------------|
| `.omw/*.jsonl` journal | Source of truth for run timeline |
| `omw replay [--json]` | Stats / phase tree reconstruction |
| `renderTree()` / `--pretty` | Human phase/fan-out renderer |
| `omw validate` | Pre-flight without spawning agents |
| `examples/deep-research` | Canonical demo run |
| `site/` | Marketing/docs shell (not a studio yet) |
| `docs/research/2026-06-24-site-prototype.html` | Explainer-site prototypes only |

## Candidate surfaces (pick 1–2 for a v0 spike)

### 1. Run Explorer — `/workflows` twin (journal viewer)

Mirror the native `/workflows` progress view, backed by JSONL instead of host internals:

- **Run list** — scan `.omw/*.jsonl` (like `/workflows` run picker)
- **Phase table** — title, agent count, ok/failed, duration sum, tokens if present
- **Drill-down** — phase → agents (`label` / `call#`) → detail (`attempt` trail, `kind`, `rawText`, `stderr`)
- **Live tail** — watch file grow during `omw run` (task-panel strip + expandable tree)
- **Resume diff** — two journals side-by-side; highlight `cached:true` → live flips

**Smallest valuable slice.** Mostly a structured viewer over existing events — the honest open twin of native's watch UI.

### 2. Run Launcher — approval + spawn

Native shows planned phases before Yes/No. omw launcher:

- Read `export const meta` from workflow module (name, phases, description)
- Form: workflow path, `--agent`, `--args` JSON, concurrency, budget, resume
- **Approve card** (Desktop-like) or CLI confirm — then spawn `omw run`
- Stream stderr pretty tree + stdout result; exit code semantics (0/1/3/4) inline

Thin wrapper — but matches the native "see the plan, then run" rhythm.

### 3. Workflow Copilot panel (authoring aid)

- Side-by-side: `workflow.js` + last journal errors
- "Repair hints" from structured `kind` (timeout vs schema_violation vs refusal)
- Link to SKILL patterns (fan-out, verify-vote, pipeline)

Agent-first: the copilot is still an agent; the UI just surfaces journal + file context.

### 4. In-session monitor

When `--agent in-session` / host probe succeeds:

- Same explorer, but nodes complete in-process (no subprocess spawn latency)
- Adapter column always `in-session`; host name in metadata

Aligns with the in-session-unified transport policy.

## Open design questions

1. **Standalone app vs web vs VS Code panel?**
   - Local Vite SPA reading `.omw/` is simplest
   - VS Code webview fits "journal next to workflow.ts"
   - Tauri/Electron only if file-watch + subprocess ergonomics demand it

2. **Live tail vs post-hoc only?**
   - Post-hoc = trivial (parse JSONL)
   - Live = need run id, file watch, or stdio bridge from `omw run`

3. **Authoring: stay plain-JS or add a "template gallery"?**
   - Gallery of conformance examples (`fanout`, `pipeline`, `budget-loop`) as copy-paste starters
   - No node-graph DSL

4. **Relationship to `site/`**
   - `site/` = public docs/marketing
   - Studio = dev tool (could live in `studio/` workspace package)

5. **Agent-first UX: who is the primary user?**
   - If still the authoring agent, studio is a **machine-readable dashboard** (JSON APIs + minimal UI)
   - If humans matter for demos, optimize Run Explorer + Launcher first

## Suggested v0 spike (2–3 days)

```
studio/
  ├── Run list + phase/agent drill-down (native /workflows shape)
  ├── live tail of .omw/<runId>.jsonl during omw run
  ├── reuse parseJournalLines + renderTree from src/
  └── optional: meta-driven approve card before spawn
```

Success criteria:

- Fake `deep-research` run → phase table matches native docs screenshot *shape* (phases, agent rows, ✓/✗)
- Self-repair visible: `attempt` with `schema_violation` then `ok` on same call
- Resume diff: upstream edit → which calls flipped `cached` (validates `--strict-resume` story)
- `log()` events visible in progress strip (native `workflow_log` analog)
- Zero duplication of runtime logic (import from package or shared module)

## References

- **Native UI (primary):** [Claude Code — Orchestrate subagents with dynamic workflows](https://code.claude.com/docs/en/workflows) (`/workflows` TUI, task panel, approval, save)
- Product spec: `docs/specs/2026-06-12-oh-my-workflow-design.md` (agent-first, no TUI in v1 — **this open Q revisits that for a studio, not a fleet TUI**)
- Open twin design: `docs/specs/2026-06-23-omw-open-dynamic-workflow-twin-design.md` (`meta` → plan UI)
- Native WF archaeology: `docs/research/2026-06-17-claude-code-internals-archaeology.md` (`workflow_log`, task_summary, FleetView)
- Native gap analysis: `docs/research/2026-06-17-native-wf-for-omw.md`
- omw `--pretty` renderer: `src/cli/run.ts` (`renderTree`)

## Decision needed

- [ ] Park as research / issue only (current)
- [ ] Spike Run Explorer v0 in `studio/` workspace
- [ ] Fold into `site/` as `/studio` route
- [ ] Explicit wontfix — CLI + JSONL is enough