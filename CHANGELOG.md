# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.4.0] — open dynamic-workflow twin

Re-surfaces omw as the **open twin of Claude Code's native dynamic Workflow** —
same authoring shape and vocabulary, external coding-agent CLI nodes, no magic.

### Launch readiness

- Added a Vercel-ready static docs site (`docs/site`, built with `bun run docs:build`)
  that leads with `/omw` skill onboarding, why the timing matters, the seven-hook
  API, core patterns, and verification proof.
- Added a Show HN / GeekNews launch note at `docs/launch/show-hn.md`.
- CI now builds the docs site in addition to typecheck and tests.
- `omw run <workflow>` now defaults to `--agent auto`, so an installed skill can
  run the workflow without asking the user to pick Claude, Codex, or Hermes.

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
- **`hermes` adapter** (experimental) — `--agent hermes` runs nodes via
  `hermes -z <prompt> --yolo` (one-shot; stdout is the response). No in-session
  followUp (schema retries go fresh).
- **`conformance/` now ships in the package**, plus a `scripts/smoke-live.sh`
  harness and a cross-host authoring runbook for testing adapters / host-authoring.

### Fixed

- `agent()` budget accounting coerces a malformed `outputTokens` (NaN/negative/
  non-number) to 0, so a buggy adapter can't silently disable the ceiling.
- `--strict` global patch/restore is reentrancy-safe and fault-tolerant: overlapping
  strict runs share one install, and a global frozen mid-run can't strand the other.
- The legacy-authoring deprecation notice is now actually surfaced to stderr, and a
  *named* destructured function (`function name({ … })`) is no longer misflagged as legacy.
- Schema-gate in-session `followUp` repair turns now inherit the original node's
  `timeoutMs`, so a repair cannot hang longer than the node it is repairing.
- Default run ids now include process and random entropy, preventing two immediate
  runs from appending into the same `.omw/<run>.jsonl` file.

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
