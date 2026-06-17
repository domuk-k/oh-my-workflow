# Coding-Agent CLI native subagent survey — what omw can delegate fan-out to

<!-- Sibling research note (2026-06-17 · CLI subagent support → omw):
  Produced by a survey agent grounded in LOCAL installed binaries/bundles (sovereign ground
  truth) + web corroboration. Scope: whether each coding-agent CLI can itself fan out /
  orchestrate sub-agents IN-PROCESS (warm, shared prompt cache), vs. only run as a single
  headless shot that omw must orchestrate externally (cold subprocess). Companion to
  2026-06-17-native-wf-for-omw.md. Research note, not a committed spec. Claims grounded in a
  local string or URL; anything else flagged (inference). -->

> **Why omw cares.** omw is agent-agnostic and drives whole CLIs as orchestration nodes. There
> are two ways to get parallelism: (a) omw launches N **cold** subprocesses and owns the fan-out
> itself (today's model — `claude -p` / `codex exec`), or (b) omw drives **one warm** CLI and lets
> *it* fan out internally, so the children reuse the parent's hot prompt cache. This survey maps
> which CLIs support (b). The headline: **Codex's `multi_agent` is shipping stable today**, but
> the scriptable `codex exec` path does **not** expose it — so omw's warm option exists but is not
> reachable via the headless surface it currently uses.

## Comparison table

| CLI | Native subagents? | Mechanism | Warm in-process vs cold subprocess | Source |
|---|---|---|---|---|
| **Claude Code** v2.1.179 | **Yes** | Task/Agent tool (agent types) + dynamic in-process Workflow tool (`agent()`/`pipeline()`/`parallel()`/budget/resume) | **Warm, in-process**; shares prompt cache (`cacheReadInputTokens`) | binary (baseline) |
| **Codex CLI** 0.137.0 | **Yes (shipping)** | `codex.multi_agent.spawn`/`resume` tool (`multi_agent` = **stable/true**); v2 subsystem under dev. Custom agents in `~/.codex/agents/*.md` | **Warm, in-process**: "thread-spawn" descendants in same session tree | `codex features list`; `/tmp/codex_strings.txt`; [developers.openai.com/codex/subagents](https://developers.openai.com/codex/subagents) |
| **Gemini CLI** 0.45.0 | **Yes (experimental)** | `delegate` / `AGENT_TOOL_NAME` tool, `agent_name` param; agents in `.gemini/agents/*.md`; A2A remote | **Warm, in-process**: "separate context loop," not separate process | bundle strings; [docs/core/subagents.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md); [developers.googleblog.com](https://developers.googleblog.com/subagents-have-arrived-in-gemini-cli/) |
| **opencode** 1.15.13 | **Yes** | Task tool + agents with `mode: primary\|subagent\|all`; defs in `.opencode/agent/*.md` | **Warm, in-process** (single server/session); cache sharing **(inference)** | strings; `opencode agent` cmd; [opencode.ai/docs/agents](https://opencode.ai/docs/agents/) |
| **GitHub Copilot CLI** (≥1.0.42) | **Yes** | `/agent` custom subagents (local, in-session) + `task`/`read_agent` tools; `/delegate` to cloud coding agent | Local subagents warm; `/delegate` = **cold async cloud** | [github.blog changelog 2025-10-28](https://github.blog/changelog/2025-10-28-github-copilot-cli-use-custom-agents-and-delegate-to-copilot-coding-agent/); [deepwiki 3.6](https://deepwiki.com/github/copilot-cli/3.6-agent-modes-and-subagents) |
| **Cursor CLI** | **Partial** | Subagents + Task tool exist in editor/Cloud; **CLI lacks the Task tool** so parallel spawn is limited there | Warm where available | [cursor.com/docs/subagents](https://cursor.com/docs/subagents); [forum](https://forum.cursor.com/t/sub-agents-in-cursor-cli/152453/6) |
| **Pi CLI** (earendil-works/pi) | **No native** (ecosystem yes) | Core has agent loop + `maxSubagentDepth` guard rails; orchestration via 3rd-party extensions (pi-orchestration, pi-subagents) / oh-my-pi fork | Warm in-process when extension loaded | [github.com/earendil-works/pi](https://github.com/earendil-works/pi); [0xKobold/pi-orchestration](https://github.com/0xKobold/pi-orchestration); [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) |
| **aider** | **No** | architect/editor = two-model **pipeline within one task**, not spawnable subagents; `/agent` is an open feature request | n/a (single agent) | [aider.chat/2024/09/26/architect](https://aider.chat/2024/09/26/architect.html); [Issue #3634](https://github.com/Aider-AI/aider/issues/3634) |

## Per-CLI notes

**Codex CLI 0.137.0 — true in-process multi-agent, shipping.** `codex features list` reports `multi_agent → stable → true` (and `multi_agent_v2 → under development`, `enable_fanout → under development`, `child_agents_md → under development`). The binary carries a full tool surface: verbatim `"Multi-agent toolsSpawn and manage sub-agents."`, `codex.multi_agent.spawn` / `codex.multi_agent.resume`, plus a v2 handler tree (`core/src/tools/handlers/multi_agents_v2/{spawn,wait,send_message,followup_task,list_agents,close_agent}.rs`). Subagents run warm in the same session tree, not as subprocesses: `"spawn_agent fork requires a thread-spawn session source"`, `"failed to load thread-spawn descendants"`, worker prompt `"Always tell workers they are not alone in the codebase... multiple workers making changes in parallel"`. Config knobs: `agent_type` (`work worker explorer no-apps`), `fork_turns` (`none`/`all`), `max_concurrent_threads_per_session`, `"Agent depth limit reached. Solve the task yourself."`. Docs confirm CLI availability + "spawning specialized agents in parallel," default concurrency 6 ([developers.openai.com/codex/subagents](https://developers.openai.com/codex/subagents)). `codex exec` is the separate headless single-shot path — no interactive subagent UI — i.e. the cold scriptable mode.

**Gemini CLI 0.45.0 — in-process subagents, experimental gate.** Bundle string `"Enable experimental subagents for task delegation (/settings)"`. Delegation is a tool: `"You MUST delegate tasks to the sub-agent with the most relevant expertise"`, `agent_name` param, `AGENT_TOOL_NAME`, built-in `codebase_investigator` agent, runtime `SubagentState.{RUNNING,COMPLETED,CANCELLED,ERROR}` / `loadAgents` / `AgentDefinition`. Warm/in-process, not a subprocess: the doc says interactions happen in "a separate context loop," agents are markdown in `.gemini/agents/*.md`, and `"When you delegate, the sub-agent's entire execution is consolidated into a single summary in your history, keeping your main loop lean."` Disable via `experimental.enableAgents:false`. Remote subagents over A2A additionally experimental.

**opencode 1.15.13 — in-process subagents with primary/subagent modes.** Strings: `"mode": "subagent"`, `mode:"primary"`, `case "all"`, `agent "${b}" is a subagent, not a primary agent`, `default_agent must point to a non-hidden, primary-mode agent`, config `primary_tools`. Agent defs in `.opencode/agent/*.md`. Task-tool invocation present verbatim (`"use the Task tool to launch the greeting-responder agent"`). `opencode agent` is a first-class subcommand. One server/session → in-process; warm-cache sharing is **(inference)**.

**Claude Code v2.1.179 — baseline.** Task/Agent tool + dynamic in-process Workflow tool; subagents in-process, share warm prompt cache (binary tracks `cacheReadInputTokens` per model). Warm end of the spectrum.

**GitHub Copilot CLI (≥1.0.42) — two delegation flavors.** Custom agents + `/agent` route to local specialist subagents in-session; the agent can call a `task` tool (general-purpose subagent) and `read_agent` (read-only). Separately, `/delegate` hands off to the **cloud** Copilot coding agent (async on GitHub, cold/remote). "Smarter delegation" parallelizes only truly independent tasks.

**Cursor CLI — partial.** Subagents (own context window, parallel Task calls) exist across editor/CLI/Cloud, but a community-reported limitation is "a lack of a Task tool on CLI, which can prevent parallel subagent execution in the CLI environment." Not installed locally; treat as partial.

**Pi CLI — core hooks, orchestration is ecosystem.** Mainline `earendil-works/pi` is a "unified LLM API, agent loop, TUI, coding agent CLI"; subagent orchestration (single/chain/parallel/fork, `maxSubagentDepth` boundary so children can't recursively spawn) ships as third-party extensions — `0xKobold/pi-orchestration`, `nicobailon/pi-subagents` ("async subagent delegation with session sharing"), the `can1357/oh-my-pi` fork. No canonical native subagent tool in base. Web-grounded (not installed).

**aider — none.** architect/editor is a two-*model* split of one task (reasoner proposes, editor applies), a pipeline inside one agent turn, not spawnable parallel subagents. A `/agent` multi-step command is an open feature request, not shipped.

## Relevance to omw

**Can delegate fan-out to the CLI's own warm subagents** (omw drives one node; the node parallelizes internally, sharing prompt cache):
- **Claude Code** — Task/Workflow, warm, shared cache. Best warm citizen.
- **Codex CLI** — `multi_agent` **stable/true today**; thread-spawn descendants share the session tree (warm). Caveat: `codex exec` (the easiest to script) is **single-shot** and does **not** expose the interactive subagent orchestration — warm fan-out needs the interactive/app-server surface, not plain `exec`.
- **Gemini CLI** — warm `delegate` behind `experimental.enableAgents`; separate context loop, results consolidated to a single summary.
- **opencode** — primary/subagent in one server; in-process. Cache benefit **(inference)**.
- **Copilot CLI** — local `/agent` warm; but `/delegate` is cold cloud.

**omw must orchestrate as cold single-shot nodes** (no usable native in-CLI fan-out; omw owns the parallelism):
- **aider** — single agent; omw runs N cold `aider` invocations and votes/merges.
- **Pi CLI (base)** — cold single node unless an orchestration extension/fork is adopted.
- **Cursor CLI** — Task tool reportedly absent in CLI; drive cold until confirmed.
- **`codex exec` / `claude -p` headless** — even for CLIs that *can* fan out interactively, the scriptable headless mode is single-agent; omw fans out by launching multiple processes.

**Warm-vs-cold cache implication.** Delegating fan-out *into* one warm CLI (Claude Workflow, Codex `multi_agent`, Gemini `delegate`) lets children reuse the parent's hot prompt cache — the system-prompt/context prefix is paid once → cheaper, lower-latency fan-out, but bounded by that CLI's concurrency cap (Codex default 6, up to 8; Claude in-process). Launching N **cold** subprocesses (`codex exec`/`claude -p`/aider) re-tokenizes full system-prompt + repo context per node with no shared cache across siblings — more tokens, slower, but **provider-agnostic, trivially horizontally scalable, and journalable as discrete nodes** (omw's native model, and the basis of cross-CLI verify-vote).

**Rule of thumb for omw.** Prefer warm in-CLI fan-out when workers share one repo+context and the CLI supports it (Codex/Claude/Gemini/opencode); fall back to cold subprocess fan-out for agent-agnostic breadth, cross-CLI verify-vote, or when each node must be independently gated/journaled. This is a genuine **future design fork** for omw, not a current capability — the cold model is what the journal/resume/verify-vote invariants are built on today.

**Sources:** local strings `/tmp/codex_strings.txt`, `/tmp/opencode_strings.txt`, Gemini bundle at `/opt/homebrew/Cellar/gemini-cli/0.45.0/.../bundle/*.js`; `codex features list`; plus URLs cited inline.
