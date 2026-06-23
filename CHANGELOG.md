# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.4.0] — open dynamic-workflow twin

Re-surfaces omw as the **open twin of Claude Code's native dynamic Workflow** —
same authoring shape and vocabulary, external coding-agent CLI nodes, no magic.

### Changed (breaking — authoring surface)

- **Workflows now take the hooks as a destructured first argument**:
  `export default async function ({ agent, parallel, pipeline, phase, log, workflow, budget }, args)`.
  Legacy positional `(rt, args)` scripts **still run** (the same object is passed)
  but are **deprecated** — they emit a one-time notice and the bridge is **removed
  in 0.5**. Migrate mechanically with `omw codemod <file> [--write]`.
- The resume key is now keyed on the **semantic** opts subset: cosmetic `label`/
  `phase` changes no longer bust the cache; `model`/`schema`/`effort`/`isolation` do.

### Added (native vocabulary parity)

- **`budget`** hook (`{ total, spent(), remaining() }`) + `--budget N`. `agent()`
  throws `BudgetExceededError` at the ceiling — the one documented exception to the
  null-contract. Counts reported output tokens, including failure envelopes.
- **nested `workflow(ref, args?)`** — run another workflow inline (one level deep),
  sharing the adapter, journal, and budget pool.
- **`export const meta`** (`name`/`description`/`whenToUse`/`model`/`phases`) with a
  model-precedence chain `opts.model > phase model > meta.model`.
- **`agent` opts** `effort`, `agentType` (threaded to adapters; the claude adapter
  has no faithful flag yet → dropped with a one-time warn), and
  **`isolation: 'worktree'`** (a fresh ephemeral `git worktree` per node).
- **`--strict`** opt-in determinism sandbox (freezes `Date`/`Math.random` to throw).
- **`--resume <runId>`** resolves `.omw/<runId>.jsonl` (not just a path).
- **`omw codemod <file> [--to-di] [--write]`** — migrate legacy workflows to DI.
- **`omw skill install --codex` / `--opencode`** — install the authoring skill for
  other coding agents (distinct dirs; never wipes a sibling install).

### Fixed

- `agent()` budget accounting coerces a malformed `outputTokens` (NaN/negative/
  non-number) to 0, so a buggy adapter can't silently disable the ceiling.
- `--strict` global patch/restore is reentrancy-safe and fault-tolerant: overlapping
  strict runs share one install, and a global frozen mid-run can't strand the other.
- The legacy-authoring deprecation notice is now actually surfaced to stderr, and a
  *named* destructured function (`function name({ … })`) is no longer misflagged as legacy.

## [0.3.0]

### Changed (behavior)

- **Nodes are now isolated from the ambient MCP configuration by default.** The
  claude adapter runs each node with `--strict-mcp-config`, so a node no longer
  inherits the user/global MCP servers or the cwd's project `.mcp.json`. Booting
  those servers on every node was the dominant per-node startup latency in a
  fan-out, and inheriting them made a workflow non-reproducible (it behaved
  differently per machine). **Opt back in per call** with
  `agent(prompt, { inheritMcp: true })`. (No-op for the codex adapter, which does
  not yet implement isolation.)

### Fixed

- **Schema-gate self-repair now works for cwd-scoped nodes.** `followUp` was
  resuming from the wrong working directory; since claude keys conversation
  history by project directory, the resume failed with "No conversation found"
  and a recoverable format hiccup became a terminal node failure. `followUp` now
  resumes in the original `cwd` (claude + codex).
- A failed resume is no longer terminal: the gate falls back to a fresh invoke
  with the error appended, and the failed resume's duration is accounted.
- **Fresh retries echo the model's own prior non-conforming output back** (capped),
  so a brand-new subprocess repairs against what it produced instead of regressing
  on a different field.

### Added

- `agent(prompt, { inheritMcp })` / `InvokeRequest.inheritMcp` — opt into ambient
  MCP inheritance for a node.
