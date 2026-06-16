# Handoff — omw resume cache model: per-node vs prefix vs dependency-aware (a DESIGN decision, not a bug)

> Repo: `/Users/dwkim/dev/personal/oh-my-workflow` · remote `github.com/domuk-k/oh-my-workflow` (private) · branch `main`, clean.
> This is the **#3** item deferred from the live-resume work. #1 (docs honesty) and #2
> (`omw validate` + exit-4) are DONE and pushed. This handoff = decide what (if anything) to
> build for resume's invalidation semantics.

## The one question to resolve

omw's `--resume` reuses **any node whose `(callIndex, promptHash, optsHash)` key matches** a
prior run. It is **per-node key-match, NOT dependency-aware**. Decide whether that is the
final model, or whether to add cascade/prefix invalidation — and if so, how.

**Why it matters (the trap):** editing an *upstream* node invalidates a *downstream* node
**only if** the upstream's output flows into the downstream prompt/opts (which changes its
hash). A workflow that passes state out-of-band (closure vars, shared mutable) can resume a
downstream node built from an upstream that changed → **stale result served silently**.

This is NOT currently a code bug — it's a model choice. The immediate correctness *trap* is
already closed by honest docs (commit `cf36f99`); an agent reading SKILL.md is now warned.
So this handoff is about whether to go further, deliberately.

## Don't re-derive — already established

- **Empirical proof of the per-node behavior**: a dogfood probe edited only the *scope* (first)
  node's prompt and resumed; calls 2, 3, **and 4** stayed `cached:true` while call 1 re-ran —
  decisively showing NO upstream→downstream cascade. (Probe was this-session; not committed. The
  behavior is reproducible: run `examples/deep-research --agent fake`, note the `.omw/<id>.jsonl`,
  edit a node, `--resume` it, diff `cached` flags.)
- **Where per-node coincides with "prefix"**: `docs/specs/2026-06-15-resume-internals-deepdive.md`
  실증 2 tested the *data-flow-threading* shape (deep-research threads `scope.topics` into
  `SEARCH ${t}` prompts), where an upstream change naturally cascades because downstream hashes
  change. The "longest-unchanged-prefix" framing is only accurate for that shape — now corrected
  in README + SKILL (`cf36f99`).
- **Code** (small, ~50 lines total): key built in `src/journal.ts::resumeKey`; index in
  `src/resume.ts::makeResumeIndex` (`byCall`→`results` join, keyed by `resumeKey`); consumed in
  `src/runtime.ts::agent()` resume short-circuit (right after `journal.agentStart`, before the
  limiter). `callCounter` is assigned synchronously at the top of `agent()`, so call indices are
  deterministic across runs (incl. parallel — microtask FIFO; see deepdive §메커니즘).

## The three options (with the trade that kills the naive one)

- **(a) Prefix truncation** — after the first key MISS by call index, force every later node live
  (CC-faithful "live from first MISS"). **Rejected-by-default**: call index ≠ data dependency. In a
  `parallel` fan-out, calls 2/3/4 are independent siblings; if 2 misses, (a) needlessly re-runs 3/4,
  **throwing away valid cache**. Strictly worse than current for parallel/pipeline shapes. Do NOT
  ship this as the default.
- **(b) Dependency-aware** — invalidate a node iff a true upstream dependency changed. omw's
  orchestration is **opaque JS**; it cannot see which output fed which prompt without tracing data
  flow (instrumentation / proxies). Expensive, maybe infeasible cleanly. High cost.
- **(c) Keep per-node + honest docs** — what exists now (post `cf36f99`). Preserves parallel
  independence; staleness only bites the "state out-of-band" anti-pattern, which SKILL already
  steers against ("thread outputs through prompts"). **Possibly the correct final answer.**

**Middle path worth weighing:** an opt-in `omw run --strict-resume` that applies (a)'s
prefix-truncation for users who want CC-exact safety over cache reuse — keep (c) as default.

## Recommendation to the next agent

Lean **(c)** unless grilling surfaces a real workflow class that (i) can't thread state through
prompts and (ii) needs resume. If so, prefer the opt-in `--strict-resume` flag over changing the
default. Treat (a)-as-default as a regression. Validate any decision against the parallel/pipeline
shapes, not just the linear deep-research example.

## Suggested skills for the next session

- `grill-with-docs` (or `superpowers:brainstorming`) — this is a design fork; pressure-test (c)
  vs `--strict-resume` against real workflow shapes before writing code. Update the SKILL/README
  resume section + the deepdive if the model changes.
- `superpowers:test-driven-development` if a `--strict-resume` lands — the seam is the same
  `makeRuntime({resume})` DI point; existing resume tests in `test/runtime.test.ts` +
  `test/resume.test.ts` are the pattern (cached-hit, partial-failure recompute, edited-last-node).

## Adjacent still-open work (not this handoff, but the map)

The original live-resume handoff's other v2 items remain open: **determinism enforcement**
(guard `Date.now`/`Math.random` in resume mode) and the **interface-gap ledger**
(`budget`, nested `workflow()`, `meta`/`phases`, `opts.agentType`/`effort`, `run_in_background`,
`isolation:'worktree'`) — see SKILL.md's 🟡/❌ resemblance ledger and
`docs/specs/2026-06-14-handoff.md`.

## Honest-language lock (still in force)

No first/best/moat; "deterministic" scoped to engine + `--agent fake`; determinism enforcement
labeled v2. Don't let a resume change quietly unlock these. See
`docs/specs/2026-06-14-omw-launch-strategy.md` §2.

## Method / conventions (this repo)

- Single-writer personal repo: commit to `main` directly, conventional commits, scope = area,
  **NO co-authored-by**, split by scope (the ax-conta lint-staged/multi-writer gotchas do NOT apply).
- **A `Write|Edit`-scoped formatter hook reflows files to single-quote/no-semicolon**, but the
  repo is 100% double-quote/semicolon. Apply edits via **Bash (python/heredoc)**, NOT the
  Write/Edit tools, to avoid a whole-file restyle churn. (Verified this session.)
- After any contract-touching change: `bun test` + `bunx tsc --noEmit`. Journal is the SoT; add a
  golden assertion if event shape changes.
