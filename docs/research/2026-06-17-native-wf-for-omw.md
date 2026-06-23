# Native Claude Code dynamic Workflow → lessons for omw — a decision memo

<!-- Sibling research note (2026-06-17 · native Claude Code dynamic Workflow → omw):
  Produced by a dynamic workflow: 8 dimensions mapped from the native Workflow primitive onto
  the omw codebase, each EXTRACTED → VERDICT → ADVERSARIALLY REFUTED against src/, with a
  completeness-critic pass over unmapped surface and overstated parity. Research note, not a
  committed spec. Verdicts are named against omw mechanisms: schema-gate self-repair,
  verify-vote/abstain-quorum, JSONL journal, null-contract, per-node resume-by-key, the limiter.
  Companion to the 2026-06-16 Fable-5 notes; same house voice (honest, no overclaiming,
  structure ≠ capability). -->

> **The reference implementation.** Native Claude Code dynamic Workflow is the in-process
> orchestrator omw hand-rolls against whole CLIs. **Full replication is impossible** — native runs
> in-harness (tool-forced structured output, logit-level constraints, a shared output-token budget
> across nested workflows); omw drives `claude -p` / `codex exec` subprocesses from the outside. So
> the value here is **borrowing design, not code**: which native ideas survive translation to a
> CLI-orchestration substrate, and which are category errors.

> **Framing constraint, kept throughout.** The user's **#1 goal is reducing end-to-end run
> wall-clock**; #2 is API round-trips. **Raw $cost is NOT a goal** — cost work earns its place only
> as *measurement that enables latency tuning*. Every verdict below is taken under this latency
> lens, and several dimensions that look important (budget, cost accounting) are honestly demoted
> because they govern spend/scale, not the clock. Each node in omw is a whole coding-agent
> subprocess — heavier than a native in-harness subagent — so an *avoided* or *shortened* node
> saves more wall-clock in omw than the same idiom saves in native.

---

## 0. Executive summary

| # | Dimension | Native WF | omw today | Verdict (latency lens) | Wall-clock lever |
|---|---|---|---|---|---|
| 1 | **structured-output validation** (B6) | tool-forced StructuredOutput; retries at the tool-call layer; author never parses text | deterministic `extractJson` → Ajv `allErrors` → never-throw self-repair (≤2). **But** `retryPrompt` drops `feedback.rawText` on the fresh-invoke path | **ADOPT (surgical)** — thread `rawText` into the fresh retry prompt | **med** |
| 2 | **model/effort tiering** (B3) | per-agent `opts.model` AND `opts.effort('low'..'max')` | `opts.model` passthrough only; **no `effort`**; "fast/smart" alias is a dangling comment | **ADOPT (partial)** — plumb `effort` (codex clean, claude no-op); **REJECT** alias table | **high** (codex) |
| 3 | **batching / 0-skip / dedup** (B4) | "0 found → skip verify"; dedup-before-verify barrier; no-silent-caps | parallel/pipeline substrate exists; verify is **finding-per-node**; SYNTH spawned unconditionally; no dedup/0-skip taught | **ADOPT (docs + 1 tiny helper)** | **high** |
| 4 | **concurrency / scheduling** | auto-cap `min(16, cores-2)`; hard caps (1000 agents, 4096 fan-out) | TOCTOU-correct semaphore at the `agent()` boundary; **fixed `?? 4`**; manual `--concurrency` | **REJECT** the port (cores model the wrong resource) — optional `?? 8` default bump only | **low** |
| 5 | **resume / journal / caching** | relaunch by `runId`; longest-**unchanged-prefix**; `Date`/`random` THROW | JSONL journal + **per-node** key `(call, promptHash, optsHash)`; wall-clock excluded; ok-only cache | **ALREADY-EMBODIED (different model)** + ADOPT-lite cache-hit stat; WATCH live-resume | **high** (core) |
| 6 | **node isolation / MCP** | `isolation:'worktree'`; per-agent `agentType` | cold `claude -p` per node = fresh context; **`--strict-mcp-config` is DEFAULT** (MCP tax removed) | **ALREADY-EMBODIED** (the one latency half); REJECT worktree (claude); WATCH per-node agentType | **none** (banked) |
| 7 | **null-contract / failure** | `agent()`→`null` on terminal death; **opaque** null | `null` + journaled `AgentFailureKind`; `refusal≠crash`; never-throws | **ALREADY-EMBODIED (strict superset)** | **low** |
| 8 | **quality patterns / idioms** | adversarial/perspective verify, judge panel, loop-until-dry, completeness critic, pipeline-by-default | abstain-quorum verify-vote (adds quorum native lacks), pipeline-by-default, loop-until-dry; **lacks** perspective-diverse / judge-panel / multi-modal / completeness-critic | **WATCH** (quality, not latency) + 1 docs ADOPT | **low** |

**Net:** three ADOPTs that actually move the clock (B6, effort, B4), all *small*; the rest is either already banked (resume core, MCP isolation, null-contract) or off-goal under a latency lens (concurrency port, budget, most quality idioms).

---

## 1. Structured-output validation — the central dimension (B6) · ADOPT (surgical)

**Native principle.** A `schema` forces a `StructuredOutput` **tool-call**; validation and retry happen **at the tool-call layer** with the model's prior attempt fully in context; `agent()` returns the already-validated object. *The author never parses text.* This is constrained/guided generation backed by detect-and-auto-correct ([Self-Refine, Madaan et al. 2023, arXiv:2303.17651](https://arxiv.org/abs/2303.17651); [Reflexion, Shinn et al. 2023, arXiv:2303.11366](https://arxiv.org/abs/2303.11366); grammar-constrained decoding, [guidance-ai/llguidance](https://github.com/guidance-ai/llguidance)).

**omw reality.** omw cannot logit-constrain a CLI subprocess, so it reconstructs the guarantee in user-space and **the architecture is already a faithful port**: deterministic `extractJson` (last fenced block, else largest balanced-brace span — `src/schema-gate.ts:57-73`), Ajv compiled with `{ allErrors: true, strict: false }` (`src/schema-gate.ts:82`), and a never-throw self-repair loop (`schemaGate`, `src/schema-gate.ts:117-164`, default `maxRetries:2` at `:123`, `{ok:false}` on exhaustion at `:163`). The gate already carries **both** signals: `GateFeedback = { errors: string[]; rawText: string }` (`:100`), populated on `no_json` (`:148`) and `schema_violation` (`:160`).

**The leak (B6).** `runtime.ts retryPrompt` (`src/runtime.ts:66-72`) builds its note from `feedback.errors` only (`:69`) and **silently drops `feedback.rawText`**. On the in-session followUp path (`src/runtime.ts:152`, `fresh=false`) this is harmless — the prior output is still in the live transcript. But on the **fresh-invoke path** (`:159` fallback when followUp fails; `:167` default when there is no session) the brand-new subprocess sees `original_prompt + abstract error list` and **never sees the concrete non-conforming output it must repair** — starving exactly the substrate Self-Refine/Reflexion refine over, producing whack-a-mole repairs that burn extra full subprocesses.

**Surviving verdict: ADOPT (surgical).** `refuted:false`, confidence high. Architecture is **ALREADY-EMBODIED**; the only thing to adopt is closing B6: when `fresh===true`, embed a (length-capped) fenced block of `feedback.rawText` before the error list; leave the followUp path untouched. Do **not** chase "parity" by tool-forcing — structurally impossible for a CLI and the wrong altitude. The wall-clock lens promotes this from nice-to-have to ADOPT: in omw the subprocess spawn is the costliest unit and sits on the critical path; a repair that lands in one fresh re-invoke instead of two (or instead of exhausting to `null`) removes a whole subprocess from the longest-running node's tail. **`wallClockLever: med`.**

**Honesty caveat (from the completeness critic).** The "2-retries-then-null → 1-retry success" payoff is **a hypothesis grounded in Self-Refine/Reflexion, not measured in-repo.** It should ship *with* the cheap validating test that proves the mechanism (assert the fresh-path prompt contains a slice of `rawText`), and the latency claim stated as expected-value, not fact.

**Academic anchor.** Self-Refine / Reflexion: the concrete prior attempt is the substrate the next attempt refines; dropping `rawText` on the fresh path removes that substrate. omw is the black-box-CLI analogue of constrained decoding — correctness-by-retry, where B6 weakens the "correct" step on exactly one seam.

---

## 2. Model/effort tiering (B3) · ADOPT (partial: `effort` only)

**Native principle.** Two orthogonal per-agent knobs: `opts.model` and `opts.effort('low'|'medium'|'high'|'xhigh'|'max')`, with the spec coupling effort to difficulty ("'low' for cheap mechanical stages, higher only for hardest verify/judge"). Because effort scales per-call thinking *latency* and `pipeline()` wall-clock is the slowest single-item chain, dropping mechanical nodes to `effort:'low'` shortens every link on the critical path ([FrugalGPT, Chen/Zaharia/Zou 2023, arXiv:2305.05176](https://arxiv.org/abs/2305.05176)).

**omw reality.** omw has **one** of the two knobs. `AgentOpts.model?: string` (`src/runtime.ts:19`) is a pure passthrough — forwarded verbatim at all four invoke sites (`src/runtime.ts:126,159,162,171`) to `claude --model` (`src/adapters/claude.ts:138`) and `codex -m` (`src/adapters/codex.ts:140`). **There is no `effort` field anywhere in `src/`** (grep confirms `effort`/`reasoning` absent from the entire tree; acknowledged in `skill/SKILL.md` not-implemented list). The `"fast"|"smart"` "tier alias" claim at `src/adapters/types.ts:31` is **aspirational** — no resolver exists, so an alias would reach `claude --model fast` verbatim and likely error.

**Surviving verdict: ADOPT (partial), `wallClockLever: high`.** `refuted:false`. Split by altitude:
- **`effort` knob — ADOPT.** The reasoning-depth axis is the cheapest, finest-grained per-call latency lever and omw has zero analogue. Port **scoped per-adapter**, honestly: codex exposes it cleanly as `-c model_reasoning_effort=<low|medium|high>` (a real wall-clock win); the **claude CLI has no first-class per-invocation effort flag** (effort is largely model/session-bound there), so the claude adapter is a **documented best-effort/no-op** — do not emit an unsupported flag. The native extraction's "claude --..." shorthand overstates the claude side; the clean win is codex-only.
- **alias-resolution table / per-stage tiering policy — REJECT (for this goal).** The model knob already works as a passthrough and already participates in resume keys (`optsHash` hashes whole opts, `src/journal.ts:30`). A `"fast"/"smart"` resolver changes how an author *spells* a model choice, not whether a node runs faster — pure DX/cost-Pareto sugar the user de-prioritized. The wall-clock-correct fix for the dangling comment is to **delete it**, not build a resolver.

**Port.** Small (~15-25 LOC, additive optional field): add `effort?: "low"|"medium"|"high"` to `AgentOpts` and `InvokeRequest`; forward at the 4 invoke sites; emit `-c model_reasoning_effort` in codex; no-op-with-comment in claude; one SKILL.md line moving `opts.effort` out of "Not implemented" with a one-line tiering hint. Resume is automatically correct (effort lands in opts → `optsHash`).

**Academic anchor.** FrugalGPT / latency-quality-cost Pareto: right-size compute to difficulty. omw can already hand-route the *model* half; `effort` is the missing, cheaper half that touches the clock directly — on codex.

---

## 3. Batching / 0-finding-skip / dedup-before-verify (B4) · ADOPT (docs + 1 inlinable helper)

**Native principle.** Three short-circuit idioms over the parallel-barrier/pipeline substrate: (1) **0-finding skip** — "0 bugs found → skip verification entirely" (an early-exit `parallel()` barrier); (2) **dedup-before-verify** — a barrier merges the full set so duplicates collapse to one verify node *before* the expensive stage; (3) **batched verify** — author controls item→`agent()` mapping. Plus "no silent caps": `log()` whatever was dropped. ([Predicate pushdown / early elimination](https://questdb.com/glossary/predicate-pushdown/); short-circuit evaluation; deduplication.)

**omw reality.** The substrate is present and correct — `parallel()` is a `Promise.all` barrier (`src/runtime.ts:217-228`), `pipeline()` is per-item no-barrier (`src/runtime.ts:230-245`) — but **none of the three idioms is taught**, and the reference shape is finding-per-node:
- Verify is **one node per item**: the deep-research example runs `pipeline(found, async (f) => agent(VERIFY f))` (`examples/deep-research/workflow.ts:55-58`); the skill's `survives()` spawns 3 refute nodes **per claim**, so a 10-finding set = 30 verify nodes. Verify node count is **multiplicative** (F×K).
- **No 0-finding skip**: the example spawns SYNTH **unconditionally** even when `confirmed.length === 0` (`examples/deep-research/workflow.ts:61-62`).
- **No dedup-before-verify**: between search and verify omw does only `searched.filter(Boolean)` (`workflow.ts:52`) — a null-drop, not a content merge.

Why this is a wall-clock lever in omw specifically: the default limiter is `?? 4` (`src/runtime.ts:85`), so once F×K exceeds 4 the excess **queues serially** — node count lands directly on the critical path — and each node is a full subprocess.

**Surviving verdict: ADOPT — skill text + one tiny inlinable helper, NOT new primitives.** `refuted:false`, `wallClockLever: high`. Priority by leverage: **(1) 0-finding skip** (`if (found.length === 0) return …`) — total phase elimination on empty rounds, **zero quality cost**, biggest single win; apply it before SYNTH in the example as the live demo. **(2) dedup-before-verify** — a ~6-line `dedupBeforeVerify(items, keyFn)` Map-reducer snippet, placed exactly where the skill already names "dedup" as the barrier's purpose. **(3) dimension-batched verify** — a template, framed with the **isolation caveat** (each batch node stays a *fresh-context* separate `agent()`) and the attention-dilution tradeoff (this one trades isolation granularity for fewer nodes — present it *with* the knob, not as free). **(4) no-silent-caps** — one-line convention only (hygiene, near-zero latency value). No `src/runtime.ts`, adapter, journal, or resume-key changes, so determinism invariants are untouched.

**Academic anchor.** Predicate pushdown / short-circuit evaluation: run the cheap predicate (count, dedup) before the expensive operator (verify), so verification only ever runs on the minimal surviving set.

---

## 4. Concurrency / scheduling · REJECT the port (optional `?? 8` default bump only)

**Native principle.** Auto-cap concurrent `agent()` at `min(16, cores-2)` (author never sets it), a lifetime cap of 1000 agents/workflow, and a per-call fan-out ceiling of 4096. `pipeline()` = async dataflow (no inter-stage barrier; wall-clock = slowest single-item chain), `parallel()` = BSP superstep barrier ([Valiant 1990, CACM 33(8)](https://dl.acm.org/doi/10.1145/79173.79181); [Amdahl 1967](https://en.wikichip.org/wiki/amdahl's_law)).

**omw reality.** A single global **counting-semaphore** built once per run with a fixed default: `makeLimiter(deps.concurrency ?? 4)` (`src/runtime.ts:85`). The semaphore is **TOCTOU-correct** — on release it hands its slot directly to the next waiter rather than decrement-then-recheck (`src/runtime.ts:45-62`, comment at `:40-44`), held **only at the `agent()` boundary** (`src/runtime.ts:113`). `parallel`/`pipeline` deliberately do **not** acquire it (`src/runtime.ts:213-216`: wrapping them would deadlock). Barrier semantics match native in spirit (parallel = `Promise.all` barrier; pipeline = per-item map, no inter-stage barrier). `os.cpus()` is **never** inspected anywhere in `src/`. Override is manual only: `--concurrency N` parsed as a positive integer (`src/cli/run.ts:55-62`), threaded into `makeRuntime` (`src/cli/run.ts:196`).

**Surviving verdict: REJECT the native mechanism.** `refuted:false`, confidence high. The load-bearing move survives scrutiny: **omw's unit of concurrency is a network/LLM-latency- and provider-rate-limit-bound subprocess, not CPU-bound local work.** Native's `min(16, cores-2)` models the wrong resource — a 4-core laptop and a 64-core CI box hit the same endpoint under the same provider caps; the extraction's "2.5× shortfall on a 12-core box" assumes core-bound scaling that does not exist, and over-fanning toward `cores-2` risks 429s. The scheduling model itself (TOCTOU semaphore, `agent()`-boundary placement, pipeline-no-barrier vs parallel-barrier) is **ALREADY-EMBODIED**, arguably more carefully reasoned than native's. The hard caps (1000/4096) are cost/safety, not a wall-clock lever (a ceiling can only throttle/abort, never speed up) — WATCH at most.

**The one small, *different* lever.** The fixed `?? 4` is conservative for the embarrassingly-parallel fan-out omw exists for. The wall-clock-correct fix is **raise the default, decoupled from `os.cpus()`**: `src/runtime.ts:85` `?? 4` → `?? 8` (ideally a named `DEFAULT_CONCURRENCY = 8`). **Explicitly do NOT add `os.cpus()` detection and do NOT add hard caps under this lens.** `wallClockLever: low` — already user-overridable via `--concurrency`, and the magnitude is a judgment call; lowest-risk path is to ship nothing here.

**Honesty caveat (completeness critic).** "agent() is network-bound, cores-2 risks 429s" is a **plausible-but-unverified architectural premise** (no rate-limit evidence in-repo). It is the basis for REJECT and should be labeled an assumption, not a finding — though a strong one.

**Academic anchor.** Dijkstra counting semaphores & the TOCTOU release race (the slot-handoff is the textbook fix); BSP vs async dataflow / Amdahl (pipeline pushes the serial fraction toward zero — already embodied).

---

## 5. Resume / journal / caching · ALREADY-EMBODIED (different model) + ADOPT-lite (cache-hit stat); WATCH live-resume

**Native principle.** Relaunch `{scriptPath, resumeFromRunId}` returns the **longest unchanged PREFIX** from cache; the first edited/new call **and everything after it** runs live. `Date.now()`/`Math.random()`/argless `new Date()` **THROW** to keep replay deterministic ([content-hash memoization, Bazel/Nix](https://docs.bazel.build/versions/main/hermeticity.html); [record-and-replay, rr](https://rr-project.org/)).

**omw reality.** A JSONL journal + a resume index. The key is wall-clock-free by construction: `promptHash = sha256(prompt)`, `optsHash = sha256(stableStringify(opts))` with recursive key-sort + undefined-drop so behaviorally-identical opts never drift the key (`src/journal.ts:15-33`); timestamps live only on `run_start`/`agent_start` and are **never** hashed (`src/journal.ts:4-5,38,48`). Only `ok:true` ends are cached, so a failed/changed node re-runs live (`src/resume.ts:27-29`). On a hit the runtime **skips both the limiter and the adapter** and returns `durationMs:0, cached:true` (`src/runtime.ts:103-111`).

**The correction (completeness critic — this is the memo's single biggest divergence to surface honestly).** The code *comments* call this "longest-unchanged-prefix" (`src/runtime.ts:80-81`, `src/resume.ts:1-3`, `src/journal.ts:3-5`), **but the implementation is per-NODE content-addressed memoization, not prefix invalidation.** `makeResumeIndex` builds a per-key Map and `lookup` is independent per node (`src/resume.ts:20-41`): a changed node N does **not** force everything after it live — each later node still hits if its own `(call, promptHash, optsHash)` matches. SKILL.md is explicit and correct where the comments are not: resume is **per-node, not dependency-aware** (`skill/SKILL.md:458,470`), and `--strict-resume` (prefix truncation) is a **v2 candidate** (`skill/SKILL.md:482-485`). So:
- **For parallel/independent fan-out, omw's per-node model is BETTER than native's prefix** (a changed sibling does not invalidate the others).
- **For linear data-dependent chains it is WEAKER**: SKILL.md documents the trap directly — "node 1 writes files, node 2 reads them" is the normal coding-agent idiom; edit node 1 → on resume it re-runs and writes different files, but node 2 **hits its cache and serves a summary of the old files** (silently stale), because the filesystem channel is invisible to the key.

**Surviving verdict: ALREADY-EMBODIED on the determinism + content-hash *guarantee* — but a DIFFERENT resume model, not "prefix parity."** Downgrade the headline from the extraction's "longest-unchanged-prefix parity" to: *parity on the wall-clock-exclusion key; per-node memoization that is stronger for parallel fan-out and weaker (can serve stale downstream) for linear dependency cascades.* The two gaps under the latency lens:
- **GAP 1 (live/in-flight resume) — WATCH.** Near-zero wall-clock payoff: cross-run resume already serves the whole unchanged prefix from disk on re-run (those nodes are already `durationMs:0`); the only expensive part (the subprocess) is already avoided. The format is forward-compatible (`cached` is the documented v2 hook, `src/journal.ts:58-61`), so the cost of waiting is zero. Don't build.
- **GAP 2 (determinism enforcement) — ADOPT-lite as DETECTION, not enforcement.** Native makes `Date.now`/`Math.random` THROW; omw treats determinism as a **convention** with no sandbox (`skill/SKILL.md` "Determinism enforcement … v2"). Sandboxing author JS to throw fights omw's plain-JS authoring model for a marginal gain. The proportionate version is to **surface the cache-hit rate on resume** so a re-run that should have been mostly cached but wasn't (because a nondeterministic prompt drifted the hash) is *visible*. ~15-25 LOC: count `agent_end{cached:true}` vs total agent nodes, pass into the already-present-but-empty `run_end.stats` (`src/cli/run.ts:209/225`; field exists at `src/journal.ts:69`), echo a one-line `resume: N/M nodes served from cache` to stderr beside the existing `resume_empty` guard (`src/cli/run.ts:308-311`), and render it in the `--pretty` / `replay` `run_end` line.

**Caveat (completeness critic).** `call` is a **positional** counter (`++callCounter`, `src/runtime.ts:90`), so resumeKey = `${call}:${promptHash}:${optsHash}` means **inserting/removing any earlier `agent()` shifts every downstream call index and busts those keys** — the same positional sensitivity native has; do not frame omw resume as purely content-addressed.

**Academic anchor.** Content-hash memoization + record-and-replay: the JSONL journal is the replayable trace; `--agent fake` is the hermetic deterministic engine. The honesty scope (engine + fake adapter, not your script or real nodes) is exactly Bazel's — reproducibility holds only for hermetic, deterministic actions.

---

## 6. Node isolation / MCP-agnostic · ALREADY-EMBODIED (the one latency half); REJECT worktree (claude); WATCH per-node agentType

**Native principle.** Two orthogonal per-agent opts: `isolation:'worktree'` (a fresh git worktree, ~200-500ms + disk, gated to **parallel file mutation only**) and `agentType('Explore'|'code-reviewer'|…)` (a distinct subagent persona per call). Context isolation is implicit — every `agent()` gets a fresh window ([hermetic execution](https://docs.bazel.build/versions/main/hermeticity.html); fresh-context verifiers > self-critique, Fable-5 guidance; [self-consistency, Wang et al. 2022, arXiv:2203.11171](https://arxiv.org/abs/2203.11171)).

**omw reality.** Each node is a whole cold `claude -p` subprocess (`src/adapters/claude.ts:137`) — fresh context, no shared state — which **is** the verify-vote isolation substrate by construction. The wall-clock-relevant half is **already banked**: omw **defaults to `--strict-mcp-config`** — `if (!req.inheritHostMcp) args.push("--strict-mcp-config")` (`src/adapters/claude.ts:139-141`), the comment naming host-MCP boot as "the dominant fan-out latency"; opt-out `inheritHostMcp` is threaded agent→runtime→adapter (`src/runtime.ts:23-24,129`; `src/adapters/types.ts:35-39`); followUp also forces it (`src/adapters/claude.ts:147`). No worktree primitive; no per-node `agentType`; the adapter is bound **once per run** via `--agent` (`src/cli/run.ts:43`).

**Surviving verdict: ALREADY-EMBODIED for the wall-clock half.** `refuted:false`, `wallClockLever: none` (already banked). The residuals:
- **worktree — REJECT-as-gap, scoped to claude.** claude nodes return text (`src/adapters/types.ts:1-3`); they don't mutate the repo in parallel, so worktree solves a problem the model doesn't have — porting it would *regress* wall-clock ~200-500ms+disk/node. **Honesty scope (completeness critic):** this REJECT is **NOT universal** — the **codex** adapter defaults to sandbox `workspace-write` (`src/adapters/codex.ts:110`) and **can** mutate the cwd; with `parallel()` fan-out over one cwd, codex nodes **can conflict**. Scope the worktree REJECT to claude; flag codex parallel-mutation as a real (experimental) exposure — the one place native's `isolation:'worktree'` is *not* purely anti-goal for omw.
- **per-node agentType / cross-CLI verifier — WATCH (quality, not latency).** The fresh-context-verifier rationale is already satisfied by cold `claude -p`; what's missing is per-node persona/CLI heterogeneity (e.g. route a claude-found result through codex so a memorized shortcut can't survive both producer and verifier). Blocked today by once-per-run `--agent` binding. Negligible wall-clock effect — gate behind a separate **quality** decision, not this backlog.

**Academic anchor.** Hermetic execution + fresh-context verifiers > self-critique (LLM-as-judge self-enhancement bias, [Zheng et al. 2023, arXiv:2306.05685](https://arxiv.org/abs/2306.05685)). omw's cold subprocess-per-node is the structural form of "separate fresh-context verifier"; the MCP-tax removal is the latency dividend it already banks.

---

## 7. Null-contract / failure isolation · ALREADY-EMBODIED (strict superset)

**Native principle.** `agent()` returns `null` on user-skip or terminal API death after retries (filter with `.filter(Boolean)`); `parallel`/`pipeline` isolate a throwing item to `null`; the call never rejects. The one documented THROW is **budget exhaustion**. Crucially the native null is **opaque** — skip and API-death collapse to the same kindless `null`; no failure taxonomy ([let-it-crash / supervisor trees, Erlang/OTP]; error-as-value vs exceptions; [crash-only, Candea & Fox]).

**omw reality.** Same core invariant **plus** the differentiation native lacks. `agent()` is `Promise<unknown | null>` wrapped in layered try/catch so it **never throws** (`src/runtime.ts:89,113-211`); three terminal boundaries each resolve to `null` AND journal a distinct `kind`: adapter-boundary throw → `spawn_failure` (`src/runtime.ts:131-135`); structured adapter failure → its own `r.kind` (`:141`); outer catch → `internal_error`, explicitly "so the authoring agent doesn't misread a schema bug as a flaky node" (`:202-208`). The closed union `AgentFailureKind = "timeout"|"nonzero_exit"|"spawn_failure"|"refusal"` (`src/adapters/types.ts:9`) keeps `refusal` distinct (HTTP 200, `stop_reason:"refusal"`) "so an abstain-quorum can treat declined ≠ failed." `schemaGate` never throws (`src/schema-gate.ts:112-116`); the journal's `agent_end` carries optional `kind/stderr/rawText/error` (`src/journal.ts:55,62-66`).

**Surviving verdict: ALREADY-EMBODIED (strict superset) — nothing to port.** `refuted:false`. On the named focus ("agent() never throws; terminal failure → null + journaled kind so the author repairs its own script") omw **is** the reference implementation; native is the weaker kindless-null form. Native's two broader behaviors (budget-ceiling THROW; user-skip null) are out of scope by design (no token-budget; non-interactive). `wallClockLever: low` — this is a **correctness/diagnosability** axis: failure isolation prevents one dead node from rejecting the batch (reliability, not speedup), and the taxonomy's only latency touch is *cross-run* (a kinded null lets the author fix the right thing on the first repair pass; `refusal≠crash` lets an abstain-quorum skip a wasteful retry). Neither shortens the in-flight run.

**Honesty caveat (completeness critic).** The `refusal` kind it leans on is **claude-only and explicitly unverified against a live CLI** (`src/adapters/claude.ts:27`); **codex has no refusal signal** — a soft decline returns `ok:true` as an invisible abstention (`src/adapters/codex.ts:54-59`). So "strict superset via `refusal≠crash`" is **claude-specific and unproven**; omw is still ahead overall, but soften "strict." Tie-in: omw's CLI exit-code taxonomy (exit 4 = completed-with-`internal_error`, result still on stdout, `src/cli/run.ts:209-221`) is the CLI-level realization of "author reads its own failure and repairs" — native has no analogue (it is in-harness).

**Academic anchor.** Error-as-value vs exceptions: native's bare `null` is the untagged form; omw's `null + AgentFailureKind` is the tagged-union (Go `(val, err)` / Rust `Result<T,E>`) form. Crash-only design: distinguishing a clean decline from a crash so recovery policy differs.

---

## 8. Quality patterns / idioms · WATCH (quality, not latency) + one docs ADOPT

**Native principle.** A composable library: adversarial verify (N skeptics refute, kill on majority), perspective-diverse verify (distinct lens each), judge panel (N attempts → parallel judges score → graft winner), loop-until-dry (K consecutive empty rounds), multi-modal sweep, completeness critic ("what's missing?"), no-silent-caps, pipeline-by-default ([self-consistency, Wang et al. 2022](https://arxiv.org/abs/2203.11171); [LLM-as-judge, Zheng et al. 2023](https://arxiv.org/abs/2306.05685); map-reduce; the verification gap).

**omw reality.** A subset taught in `skill/SKILL.md`, all on the null-contract. **At parity / ahead:** pipeline-by-default (near-verbatim, `skill/SKILL.md:122-129`), loop-until-dry (`:264-276`), and adversarial verify **with an abstain quorum native does not spell out** — skeptics "Try to REFUTE this claim. Default to refuted=true if unsure," requiring ≥2 *cast* votes so an all-abstain finding can't silently survive (`skill/SKILL.md:169-185`). It also goes **deeper** than native on the verification gap with executable-evidence verify (run the artifact, gate on `exitCode`, `skill/SKILL.md:205-250`). **Missing as documented idioms:** perspective-diverse verify, judge panel, multi-modal sweep, completeness critic. Engine-rooted absences acknowledged at `skill/SKILL.md:487-491`: no `opts.effort`/per-call model policy, no `agentType`, no `budget`.

**Surviving verdict: WATCH (mostly) + one narrow docs-only ADOPT.** `refuted:false`, `wallClockLever: low`. The latency-bearing patterns (pipeline-by-default, loop-until-dry) are **already embodied**. The four missing idioms are **quality/recall, not latency**: perspective-diverse verify and completeness-critic add at most one serialized round each (slightly *slower*, pure quality); judge-panel and multi-modal-sweep are fan-out shapes that run under the *existing* bounded `parallel()` — same critical path, just a new prompt-string arrangement of a lever omw already has. Every one is expressible **today** on the 5 hooks (a distinct prompt per `parallel` thunk; one trailing `agent()` for the critic), so there is no latency unlock waiting — only a docs/recall win. The engine gaps (budget/effort/agentType) are cost/quality/scale levers, not slowest-chain reducers. The docs ADOPT, **only if quality is separately prioritized**: ~35-40 LOC in `skill/SKILL.md` adding a judge-panel template + completeness-critic one-liner + a "distinct lens per skeptic" note. No `src/` or `examples/` engine changes.

**Honesty caveat (completeness critic).** The **only shipped worked example does not demonstrate verify-vote**: `examples/deep-research/workflow.ts:55-58` uses a **single** verifier, not the multi-skeptic `survives()` vote, and shows no 0-skip, dedup, or judge-panel. State plainly that every adopted pattern (here and in B4) is currently **un-exemplified in `examples/`**.

**Academic anchor.** Ensemble / self-consistency (sample-and-vote): the abstain-quorum is a self-consistency vote with a null/abstain ballot. LLM-as-judge bias (self-enhancement) is exactly why the judge must be a separate fresh-context agent — which omw already insists on.

---

## Implementation backlog (wall-clock ranked)

| Rank | Item | Bucket | Verdict | Difficulty | Wall-clock benefit | Files |
|---|---|---|---|---|---|---|
| 1 | **Surface `feedback.rawText` on the fresh retry path** | **B6** | ADOPT | trivial (~6 LOC, 1 file) | **med** — removes a whole subprocess from the longest node's tail on the malformed-output path; fewer fresh re-invokes | `src/runtime.ts` (retryPrompt 66-72) |
| 2 | **Plumb `opts.effort`** (codex `-c model_reasoning_effort`; claude no-op) | **B3** | ADOPT (partial) | small (~15-25 LOC, 4 files) | **high (codex)** — drops mechanical-node thinking latency on every critical-path link; soft/no-op on claude | `src/runtime.ts`, `src/adapters/types.ts`, `src/adapters/codex.ts`, `src/adapters/claude.ts`, `skill/SKILL.md` |
| 3 | **B4 idioms: 0-skip + dedup-before-verify + batched-verify template** | **B4** | ADOPT (docs) | small (~docs + 6-LOC helper) | **high** — 0-skip eliminates the verify+synth phase on empty rounds; dedup cuts N→N/r; batching cuts F×K→D×K (excess was serializing behind `?? 4`) | `skill/SKILL.md`, `examples/deep-research/workflow.ts` (0-skip demo) |
| 4 | **Cache-hit observability stat on resume** | B5/B2-adjacent | ADOPT-lite | trivial (~15-25 LOC, 2 files) | **low/indirect** — makes a should-have-been-cached re-run that drifted visible, so the author fixes the nondeterministic prompt and reclaims the cached fast path | `src/cli/run.ts` (209/225/308-311), `src/cli/replay.ts` |
| 5 | **Raise default concurrency `?? 4` → `?? 8`** (decoupled from `os.cpus()`) | concurrency | optional | trivial (1 line) | **low** — already overridable via `--concurrency`; magnitude is a guess | `src/runtime.ts:85` |
| 6 | **Journal `costUsd` + run-level total** (B1 measurement) | **B1** | WATCH | small (~15-25 LOC, 4 files) | **none (indirect)** — enables offline model/effort tuning; claude-only (codex emits no cost) | `src/journal.ts`, `src/runtime.ts`, `src/cli/run.ts`, `src/cli/replay.ts` |
| — | **Budget primitive (`spent()`/`remaining()` + throw-on-exhaustion)** | **B2** | REJECT | large | **anti-goal** — caps scale, never speeds a run; adaptive-fan-out *spends* wall-clock; and `throw` violates the null-contract | — |
| — | **Port `min(16, cores-2)` auto-sizing / hard caps** | concurrency | REJECT | — | **anti-goal** — models the wrong resource; risks 429s | — |
| — | **`isolation:'worktree'`** | isolation | REJECT (claude) / WATCH (codex) | medium | **regression** on claude (~200-500ms+disk); only codex `workspace-write` parallel mutation makes it reachable | — |
| — | **Per-node `agentType` / cross-CLI verifier** | isolation | WATCH | medium | **quality, not latency** — blocked by once-per-run `--agent` | — |
| — | **Alias-resolution table / per-stage tiering policy** | B3 | REJECT | large | **DX/cost, not latency** — model knob already works; delete the dangling `types.ts:31` comment instead | — |
| — | **Live/in-flight resume; determinism enforcement (sandbox)** | resume | WATCH | large | **negligible** — subprocess already avoided cross-run; enforcement fights plain-JS authoring | — |

---

## Ship-1 recommendation

**Ship: B6 — thread `feedback.rawText` into the fresh-invoke retry prompt (`src/runtime.ts:66-72`).**

**ship1Files:** `src/runtime.ts` (the `retryPrompt` seam only); a one-line test in `test/adapters.claude.test.ts` (or the gate test).

**Why this is the cheapest × highest-wall-clock ADOPT.** It is a true critical-path latency lever, not a cost or scale feature: in omw the subprocess spawn is the costliest unit and sits on the longest-running node's tail, so a repair that lands in one fresh re-invoke instead of two — or instead of exhausting to `null` and re-running — removes a whole subprocess from the critical path on the malformed-output failure path. The fix is **~6 LOC in one file**: `GateFeedback.rawText` already exists (`src/schema-gate.ts:100`) and the gate already populates it (`:148,160`), so there is **zero** type or schema-gate change; the followUp path is left untouched (rawText is redundant in-session). The only risk surface is a length guard — cap `rawText` (e.g. last ~4KB) so a huge prior dump can't blow the fresh prompt.

**TDD-able description.**
1. *Red:* in the gate/adapter test, drive a fresh-path retry (no `sessionId`, so `gateCall` takes the `fresh=true` branch at `src/runtime.ts:167`) where attempt 1 returns schema-invalid JSON and attempt 2 returns valid; assert the **second** prompt passed to `adapter.invoke` **contains a slice of the prior non-conforming output** (e.g. a fenced block of `feedback.rawText`). With today's code this fails — only `feedback.errors` is embedded.
2. *Green:* change `retryPrompt(original, feedback, fresh)` so that when `fresh===true` it appends a fenced, length-capped block of `feedback.rawText` before the error list; keep the `fresh===false` branch (followUp) exactly as is. No other call site changes — `gateCall` already passes `fresh=false` at `:152` and `fresh=true` at `:159/167`.
3. *Refactor:* extract the cap constant; assert the followUp-path prompt is unchanged (no `rawText`) so the in-session path stays lean.
Commit scope: `fix(runtime)` — a behavior fix on the repair path, not docs/feature.

**ship1Rationale (vs the runner-up).** The strongest runner-up is the **concurrency default bump (`?? 4` → `?? 8`)** — even cheaper at one character. It loses on three honest counts: (1) `wallClockLever` is **low**, not med — fan-out concurrency is *already* user-tunable via `--concurrency`, so the default only helps users who never pass the flag; (2) the magnitude `8` is a **guess** with a real downside (over-fanning toward provider 429s), i.e. it carries judgment risk B6 does not; (3) it is **untestable as a latency claim** without a live provider, whereas B6 ships *with* a deterministic fake-adapter test that proves the mechanism. B6 is the better latency-per-effort port: comparable cost, a lever that bites on the critical path, no magic-number risk, and a green test gating it. (The effort plumb-through and B4 docs are close seconds and should follow immediately, but each touches 4-5 files or is quality-gated, so B6 ships first.)

---

## Honesty boundary

**Where omw is genuinely at parity — do not overclaim.**
- **Scheduling model.** TOCTOU-correct counting semaphore at the `agent()` boundary, with pipeline-no-barrier vs parallel-barrier faithfully reproduced (`src/runtime.ts:45-62,113,213-245`). Arguably reasoned *more* carefully than native's cap. Nothing to port.
- **Null-contract.** `agent()` never throws; terminal failure → `null` + journaled `kind`; `filter(Boolean)` idiom. omw is a **superset** (native's null is kindless) — but soften "strict": the `refusal≠crash` evidence is **claude-only and unverified** (`src/adapters/claude.ts:27`), and codex has no refusal signal (`src/adapters/codex.ts:54-59`).
- **MCP isolation** as a wall-clock lever is **already banked** by the `--strict-mcp-config` default (`src/adapters/claude.ts:139-141`).
- **Resume key.** Parity on the *wall-clock-exclusion guarantee* (hashes exclude time, ok-only cache, durationMs:0 hit). **But NOT "longest-unchanged-prefix parity"** — the code comments saying so are inaccurate against the implementation; omw is **per-node memoization** (`src/resume.ts:20-41`, `skill/SKILL.md:458,470`): *better* for parallel fan-out, *weaker* for linear dependency chains (can serve **silently stale** downstream when an upstream's filesystem effects change), and **positionally sensitive** (inserting an early `agent()` shifts all downstream call-index keys).
- **Quality idioms.** pipeline-by-default and loop-until-dry are at parity; the abstain-quorum is **ahead** of native. The four missing idioms are quality, not latency.

**What native WF does that omw structurally CANNOT (or should not chase).**
- **Tool-forced, logit-constrained structured output, in-process.** Native validates and retries at the StructuredOutput tool-call layer; omw drives a CLI emitting free text and can only prompt-and-parse-then-repair. **Chasing parity here is wrong altitude** — omw's deterministic-extract + Ajv + never-throw self-repair is the correct black-box analogue, and B6 is the only thing to fix.
- **A shared output-token budget with throw-on-exhaustion across nested workflows.** omw has no nested-workflow primitive and no token budget; and `agent()` THROWing on a ceiling would **violate the null-contract** that the whole design stands on. Off-goal under a latency lens anyway (a budget caps scale, never speeds a run).
- **CPU-adaptive concurrency (`min(16, cores-2)`).** A category error for omw, whose nodes are network/LLM-latency-bound subprocesses; local core count is uncorrelated with the real bottleneck (remote inference + provider rate limits).
- **Per-agent persona/`agentType` and per-node cross-CLI verifiers.** Blocked today by the once-per-run `--agent` binding (`src/cli/run.ts:43`); a future *quality* initiative, not a latency one.

**The structure-vs-capability line (consistent with the Fable-5 sibling note).** Every ADOPT here is **procedure**, not cognition: surfacing `rawText`, plumbing an effort flag, teaching 0-skip/dedup, counting cache hits. omw structures the orchestration around any node; **it does not upgrade the node model's judgment** — and none of these ports pretend to.


---

## Appendix A — Primary-source evidence (binary archaeology, v2.1.179)

The body above mapped the native primitive from its in-harness tool spec. This appendix
**grounds those verdicts in the compiled binary on disk** — the same `claude` that runs this
session (`~/.local/share/claude/versions/2.1.179`, 226M Mach-O arm64, Bun-compiled; strings
dumped to `/tmp/cc_2.1.179_strings.txt`). Every snippet is verbatim. Headline confirmations:

- **§4 concurrency** — the cap is `Math.min(16,Math.max(2,H-2))` with `H=os.cpus().length`, a
  detail the spec omits (a **floor of 2**). Does **not** change the REJECT: it still sizes the
  wrong resource for omw I/O-bound subprocess nodes.
- **§4 scheduling (ALREADY-EMBODIED)** — native's limiter `Oq_` is **algorithmically identical**
  to omw's `makeLimiter` (`src/runtime.ts:45`): on release it hands the slot to the next waiter,
  else decrements. Both sides now primary-confirmed, not merely asserted.
- **§1 B6 (the ship-1)** — native's `StructuredOutput` validates with the **same Ajv error shape**
  omw uses (`${instancePath}: ${message}`) and returns it **in-conversation**, so the model retries
  while seeing its own prior attempt. Primary-source vindication of B6: omw's fresh path must
  reconstruct what native gets for free.
- **Honesty boundary (warm cache)** — native's token accounting aggregates `cacheReadInputTokens`
  per model: in-process subagents **share the prompt cache**. omw's cold `claude -p` per node
  cannot — the structural ceiling the memo names, now evidenced.

### A.1 Concurrency cap (computed once at startup)
```js
function Z0O(H){return Math.min(16,Math.max(2,H-2))}
// ...
G0O=Z0O(RmK.cpus().length)   // RmK=require("os")
```

### A.2 Limiter (counting semaphore) — identical to omw `makeLimiter`
```js
function Oq_(H,_){let q=0,K=[];
  function O(){if(q<H)return q++,Promise.resolve();return new Promise((z)=>K.push(z))}
  function T(){let z=K.shift();if(z)z();else q--}
  return async(...z)=>{await O();try{return await _(...z)}finally{T()}}}
```

### A.3 Caps as typed errors (1000-agent cap + token-budget hard ceiling)
```js
class kmK extends Error{constructor(){super(L0O);this.name="WorkflowAgentCapError"}}
// L0O warns: budget.remaining() returns Infinity when budget.total is null → add a hard cap
class ymK extends Error{constructor(H,_){super(`Workflow token budget exceeded
(${H} / ${_} output tokens). Stopping further agent() calls. In-flight agents will
complete; their results are preserved.`);this.name="WorkflowBudgetExceededError"}}
```
→ budget is OUTPUT tokens; on exceed, STOP new `agent()` but in-flight finish (graceful).
Confirms §"Honesty boundary": a budget that THROWs would violate omw's null-contract.

### A.4 StructuredOutput — forced ajv tool-call, error returned in-conversation
```js
Bz="StructuredOutput"  // name; searchHint:"return the final response as structured JSON"
async call(O){
  if(!K(O)){                                  // K = compiled ajv validator
    let z=K.errors?.map((Y)=>`${Y.instancePath||"root"}: ${Y.message}`).join(", "),
        $=K.errors?.map((Y)=>Y.keyword).join(",");
    throw new w3(`Output does not match required schema: ${z}`,
                 `StructuredOutput schema mismatch: ${$??""}`)}
  return{data:"Structured output provided successfully",structured_output:O}}
```
Failure-mode strings: "subagent completed without calling StructuredOutput (after 2
in-conversation nudges)"; result carries `structuredOutputAttempts`, `lastStructuredOutputInput`.
→ Same Ajv `instancePath: message` shape as omw `schema-gate.ts:87`. The schema-mismatch error is
fed back **in-conversation** (the model sees its prior failing input). This is exactly the in-session
`--resume` path omw already has; the **fresh** path is where B6 reconstructs it (`runtime.ts:66`
drops the already-collected `feedback.rawText`).

### A.5 Resume + per-agent abort
"longest unchanged prefix of agent() calls returns cached results instantly; the first edited/new
call and everything after it runs live. Same script+args → 100% cache hit." Resume handle:
`Workflow({scriptPath, resumeFromRunId})`. Per-agent `agentControllers.get(_)` → `z.abort(q)`
(user-skip/kill). → omw resume is **per-node memoization** (§5), not prefix; omw lacks per-agent abort.

### A.6 Token accounting is cache-aware (the invocation-cost root)
```js
z.inputTokens+=O.inputTokens, z.outputTokens+=O.outputTokens,
z.cacheReadInputTokens+=O.cacheReadInputTokens,
z.cacheCreationInputTokens+=O.cacheCreationInputTokens,
z.webSearchRequests+=O.webSearchRequests, z.costUSD+=O.costUSD   // aggregated per model
```
→ token accounting tracks `cacheRead`/`cacheCreation` per model. **[CORRECTED in Appendix B.2]** —
the original claim "in-process subagents share the warm cache" is too strong: *default* subagents are
**cold on first call**; the warm-prefix-sharing mechanism is the **fork**, and cold `claude -p`
siblings in the **same cwd within TTL** *do* read each other's prefix (≈10% input) when machine+dir+
git+model+effort match. So the ceiling is **fragility, not impossibility** — and partly in omw's
control (Appendix B.3). (omw's intra-node `--resume`/followUp DOES hit the session cache, so
self-repair is cheap.)

### A.7 Worktree isolation (REJECT for omw, scoped)
Native ships full machinery: `worktreePath/worktreeBranch`, git sparse-checkout (cone), symlink
`node_modules`/`.cache` to "avoid disk bloat", base ref `fresh`(origin default) vs `head`(local HEAD).
→ claude nodes return text, not parallel file mutations → REJECT; but codex (`workspace-write`) can
mutate the cwd under `parallel()` — the one place isolation is not purely anti-goal (§6).


---

## Appendix B — Public-docs corroboration + the warm-cache correction

After the body and Appendix A were written from the in-harness spec and the binary, a recon pass
found the native Workflow primitive is **now officially documented**, and Anthropic's prompt-cache
docs **correct one overstatement in Appendix A.6**. Sources fetched verbatim.

### B.1 The Workflow primitive is public (strengthens the whole memo)
[code.claude.com/docs/en/workflows](https://code.claude.com/docs/en/workflows) (primitive introduced v2.1.154):
- *"A dynamic workflow is a JavaScript script that orchestrates subagents at scale… a runtime
  executes it in the background while your session stays responsive."*
- *"The workflow runtime executes the script in an isolated environment, separate from your
  conversation. Intermediate results stay in script variables instead of landing in Claude's
  context."* — the orchestration-state-never-re-enters-context win.
- *"Up to 16 concurrent agents, fewer on machines with limited CPU cores"* + *"1,000 agents total
  per run."* → **corroborates the binary's `min(16,max(2,cpus-2))` + the 1000 cap** (Appendix A.1/A.3).
- *"agents that already completed return their cached results, and the rest run live… Resume works
  within the same Claude Code session."* → corroborates §5: native resume is **live, in-session**;
  omw's is **cross-run from a prior journal** — a different (and for CI, more useful) model.
- *"Every agent in a workflow uses your session's model unless the script routes a stage to a
  different one."* → corroborates §2 (B3): per-stage model routing is the intended cost lever.

The exact `agent()/pipeline()/parallel()/budget` function-name surface is **not** in any readable
on-disk SDK file (the readable SDK is `@anthropic-ai/claude-code@1.0.103`, which *predates* the
primitive) nor named in public docs — so the binary mining (Appendix A) remains the sole source for
the API shape, now backed by the public behavioral docs above.

### B.2 The warm-cache correction (revises Appendix A.6 and the Honesty boundary)
Appendix A.6 said "in-process subagents SHARE the prompt cache (warm)." That is **too strong for
the *default* subagent.** Per [code.claude.com/docs/en/prompt-caching](https://code.claude.com/docs/en/prompt-caching) §"Subagents and the cache":
- **Default subagent = COLD first call:** *"A subagent starts its own conversation with its own
  system prompt… It builds its own cache, starting with no cache hits on its first call and warming
  up across its own turns."*
- **The warm-prefix mechanism is the FORK:** *"a fork… inherits the parent's system prompt, tools,
  and conversation history exactly, so its first request reads the parent's cache."*
  ([sub-agents docs](https://code.claude.com/docs/en/sub-agents) §Fork; requires v2.1.117+, `CLAUDE_CODE_FORK_SUBAGENT=1`).
- **Cold subprocesses CAN still share a warm prefix:** *"Sessions you run in parallel in the same
  directory build matching prefixes and read each other's cache… the cache is effectively scoped to
  one machine and directory."* `cache_read_input_tokens` is *"billed at roughly 10% of the standard
  input rate."*

**Corrected claim.** The §6 / A.6 "structural ceiling" is not *impossibility* — it is **fragility**.
omw's cold `claude -p` siblings, launched into the **same cwd within the cache TTL** (5 min API /
1 h subscription), **do** read each other's warm prefix at ≈10% input cost — but only when
**machine + directory + git snapshot + model + effort all match**, and any per-node prompt drift or
model/effort divergence forces a fresh cold write. So omw is *not* categorically cache-cold; it is
cache-warm-by-accident, and could be cache-warm-by-design.

### B.3 New backlog candidate (latency+token, modest) — prefix-stable, same-cwd fan-out
A lever the body's table does not list, surfaced only by B.2:
- **Construct node prompts static-prefix-first, dynamic-last** (Anthropic's own rule: *"static
  content first, dynamic content last… maximize how many sessions share cache hits"*), and keep
  fan-out siblings in **one cwd**, so after the first node writes the cache the rest read it (~10%
  input, and faster — less to re-process). ~docs + a prompt-assembly convention; no engine change.
- **Tension with B3 (effort/model tiering):** cross-session cache match requires **same model AND
  same effort**, so a tier that routes mechanical nodes to a *different* model/effort **forfeits**
  the shared prefix with the other tier. Within a tier (all map nodes same model) sharing holds.
  Net: tiering and prefix-sharing are both real levers but partly **mutually exclusive per node** —
  document the trade, don't pretend both apply to the same node.
- **Honest altitude:** this is mostly a **token/$**-and-modest-latency lever, the axis the user
  de-prioritized; it earns a WATCH, not an ADOPT — but it materially changes the Honesty-boundary
  framing from "can't" to "fragile, and partially in omw's control."

### B.4 SDK substrate corroboration (1.0.103, readable)
The readable `@anthropic-ai/claude-code@1.0.103` predates the Workflow tool but corroborates its
substrate: a **10-way in-process** tool/subagent pool (`_1B` bounded async-generator, cap `_O5=10`
— the plain Task scheduler; Workflow raises it to 16), the `Usage` shape
(`input_tokens/output_tokens/cache_creation_input_tokens/cache_read_input_tokens` + `total_cost_usd`),
client-side `cache_control:{type:"ephemeral"}` breakpoints, one shared `Anthropic` client per
process, `maxThinkingTokens` (a thinking budget; no `effort` field in this version), and the
stateless-subagent contract (*"Each agent invocation is stateless… Launch multiple agents
concurrently whenever possible"*). No `StructuredOutput` / run-level `budget` / `Workflow` in
1.0.103 — confirming those are post-1.0.103 binary-only, consistent with Appendix A.

### B.5 Token economics (why any of this matters)
[Anthropic multi-agent research-system post](https://www.anthropic.com/engineering/multi-agent-research-system):
*"token usage by itself explains 80% of the variance"* in performance; multi-agent *"use about 15×
more tokens than chats."* [Prompt-caching-is-everything post](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything):
*"you want as many of your requests to share a prefix as possible."* → For any fan-out orchestrator
(omw included) the repeated-prefix token bill is the dominant cost, and warm-prefix reuse is the
highest-leverage knob — which is exactly the B.3 lever, bounded by the B.3 tension.
