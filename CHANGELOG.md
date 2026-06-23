# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

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
