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

### 1. Run Explorer (journal viewer)

- Load a journal file or tail live JSONL
- Phase tree + per-node: label, adapter, ok/kind, duration, cached, attempt trail
- Click `agent_end` → stderr / rawText / schema errors
- Diff two journals (resume probe: which calls flipped cached→live)

**Smallest valuable slice.** Mostly a structured viewer over existing events.

### 2. Run Launcher

- Form for: workflow path, `--agent`, `--args` JSON, concurrency, budget, resume
- Spawn `omw run` as subprocess; stream stderr pretty tree + stdout result
- Show exit code semantics (0/1/3/4) inline

Thin wrapper — but lowers friction for non-agent humans and demos.

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
  ├── serve a Run Explorer over .omw/*.jsonl
  ├── reuse parseJournalLines + renderTree from src/
  └── optional: spawn omw run via CLI wrapper
```

Success criteria:

- Open `examples/deep-research` fake run journal → see phase tree, failed node kind, self-repair attempt line
- Diff resume run vs original → cached flags visible per call
- Zero duplication of runtime logic (import from package or shared module)

## References

- Product spec: `docs/specs/2026-06-12-oh-my-workflow-design.md` (agent-first, no TUI in v1 — **this open Q revisits that for a studio, not a full TUI**)
- Open twin design: `docs/specs/2026-06-23-omw-open-dynamic-workflow-twin-design.md`
- Native WF archaeology: `docs/research/2026-06-17-native-wf-for-omw.md`

## Decision needed

- [ ] Park as research / issue only (current)
- [ ] Spike Run Explorer v0 in `studio/` workspace
- [ ] Fold into `site/` as `/studio` route
- [ ] Explicit wontfix — CLI + JSONL is enough