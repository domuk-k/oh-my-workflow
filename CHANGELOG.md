# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] — 2026-08-20

### Fixed

- Codex `turn.completed.usage.output_tokens` now reaches runtime accounting.
  Budgeted Codex nodes fail explicitly when the CLI omits that usage receipt.
- Codex nodes ignore ambient user config and execpolicy rules by default; opt in
  explicitly with `inheritMcp`.
- `--strict` now preserves the runtime's own journal clock while still rejecting
  workflow calls to `Date.now()`.
- Nested workflows share the run-wide concurrency limiter.
- Bare JSON arrays are extractable by the schema gate, and a workflow returning
  no JSON-serializable artifact now exits non-zero.
- Invalid runtime concurrency fails fast instead of deadlocking; invalid
  `maxRetries` becomes an explicit internal-error receipt without invoking an agent.
- Worktree setup failures stay inside the node null-contract, and cleanup errors
  no longer replace a successful node result.
- Budgeted Claude calls now fail closed when `usage.output_tokens` is absent,
  and non-zero JSON results preserve any reported output-token receipt.
- Strict and non-strict runs no longer overlap while process-global determinism
  guards are installed; the embedder API does not expose CLI-only `--strict`.
- Budget admission now occurs inside the shared limiter and exhausted calls close
  their journal span. Requested worktree isolation fails closed when Git cannot
  create an isolated checkout.
- Schema repair preserves the selected model and Codex sandbox policy. CLI
  subprocess timeouts escalate from terminate to forced kill after a short grace.
- The CLI sets `process.exitCode` instead of forcing immediate exit, so large or
  piped JSON artifacts flush completely.
- In-session adapters now preserve model and budget requirements on follow-up,
  extract host usage receipts, and reject budgeted calls when usage is absent.
- Resume keys now include timeout and retry bounds, so tighter limits cannot
  reuse a result produced under looser execution policy.

### Changed (breaking)

- Removed the deprecated positional `(rt, args)` workflow bridge. Run
  `omw codemod <file> --write` before upgrading.
- `--budget` is documented as a reported output-token ceiling, not a cost or
  total-token cap.

### Changed

- **Public `docs/` tree removed** — maintainer notes, specs, research, and openq live
  under `docs/` locally only (gitignored). Marketing/docs ship via [`site/`](site/).

### Changed (breaking)

- **CLI is headless-only** — `--agent in-session` and auto-probe of host callbacks
  are removed from `omw run`. In-session transport is **embedder-only** via
  `runInSessionWorkflow({ wfPath }, { adapter })` or an explicit `probe` inject.
- **`runInSessionWorkflow()`** no longer defaults to `probeInSessionHost()` — pass
  `adapter` or `probe` explicitly. See `examples/host-runners/kiro.ts`.

## [0.4.1] — in-session transport + strict resume

Aligns npm with main: host-native subagent transport, safer resume, and public
library exports for in-session runners.

### Added

- **`--agent in-session`** and **`probeInSessionHost()`** — detect a host callback
  (Kiro subagent tool today) and run nodes in the live session; exit `3` with
  `in_session_unavailable` when absent — **no CLI subprocess fallback**.
- **`--agent auto`** now prefers in-session when probed, then host env hints, then
  installed CLIs (`claude`, `codex`, `hermes`).
- **`runInSessionWorkflow()`** — `oh-my-workflow/in-session` export for tiny host
  runners (probe → runtime → workflow; same exit-code contract as `omw run`).
- **`makeInSessionAdapter`** + **`makeKiroInSessionAdapter`** — in-session bridge
  with `followUp` via host `sessionId` (schema-gate repair in the same session).
- **`--strict-resume`** — on the first cache miss by call index, force every later
  call live (prefix truncation for out-of-band state such as filesystem side-channels).
- **Public package exports**: `oh-my-workflow/ambient`, `/in-session`,
  `/adapters/in-session`, `/adapters/in-session-probe`, `/adapters/kiro-in-session`.

### Changed

- **`in-session` adapter** — richer host result extraction (`summary`, `Text`/`Json`,
  nested shapes) and `sessionId` threading for follow-ups.
- **SKILL.md** — adapter table, in-session flow, `--strict-resume`, and
  `runInSessionWorkflow` documented to match CLI behavior.

### Fixed

- **`package.json` exports** merge conflict resolved — subpath imports work again.
- **Codex adapter** — one-time warn when `inheritMcp` (and other unmapped opts) are
  requested but not implemented (no silent no-op).

## [0.4.0] — open dynamic-workflow twin

Re-surfaces omw as the **open twin of Claude Code's native dynamic Workflow** —
same authoring shape and vocabulary, external coding-agent CLI nodes, no magic.

### Docs & onboarding

- Added a Vercel-ready static docs site (then `docs/site`, now `site/`; built with `bun run docs:build`)
  that leads with `/omw` skill onboarding, why the timing matters, the seven-hook
  API, core patterns, and quality signals.
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
- **`conformance/` now ships in the package**. The repository also includes a
  `scripts/smoke-live.sh` harness and cross-host authoring runbook.

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
