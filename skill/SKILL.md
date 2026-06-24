---
name: oh-my-workflow
description: Use when a task decomposes into multiple coding-agent CLI calls (claude -p / codex exec) that should run as one structured, schema-gated, journaled workflow — fan-out search, verify-vote, pipeline, or loop-until-dry. Teaches you to author a plain-JS omw script, run it with `omw run`, read the JSONL journal, and repair your own script from structured failures.
---

# oh-my-workflow (omw)

You write a **plain-JS orchestration script**. Its nodes are whole coding-agent
CLIs you already pay for (`claude -p`, `codex exec`). omw is the thin glue: it
runs your script, schema-gates each node's output, and journals every step — so
you can read your own failure and fix your own script. (What's "deterministic" is
scoped below — the engine's guarantees and `--agent fake`, not your script unless
you pass `--strict`.)

omw is the **open twin of Claude Code's native dynamic Workflow**: the same
authoring shape and vocabulary (`agent` / `parallel` / `pipeline` / `workflow` /
`budget`), but the nodes are *external coding-agent CLIs*, it runs from any host,
and there is **no magic** — no source transform, no ambient globals, no
sandbox-by-default. Your script is ordinary JavaScript; the runtime hands it a
**hooks object** as the first argument. There is no DSL to learn.

## When to use this

Reach for omw when a task is a **multi-step pipeline over agent calls** that
benefits from structure you'd otherwise hand-roll:

- **Fan-out**: run N independent agent calls concurrently, collect results.
- **Verify / vote**: produce a finding, then have K independent agents judge it.
- **Pipeline**: each item flows scope → search → verify → synthesize independently.
- **Loop-until-dry**: keep spawning finders until a round returns nothing new.
- **Budget-bounded loop**: keep working until a token ceiling is reached.

You want: bounded concurrency, schema-validated node output with automatic
node-level retry, a replayable journal, and a `null`-on-failure contract so one
bad node never crashes the run.

**Don't** use omw for a single agent call, or where a node is a single raw LLM
API call (that's LangGraph/Mastra territory; an omw node is a *whole coding
agent*). omw has no sandbox by default — your script is trusted code — though you
can opt into a determinism sandbox with `--strict`.

## The 30-second free demo (no API key, nothing to clone)

omw is on npm, so you can run the whole thing in one line — no install step, no
key, no cost:

```sh
bunx oh-my-workflow@latest run examples/deep-research --agent fake
# → {"confirmed":[…],"summary":{…}}    exit 0 · no key · no cost · deterministic
```

> Tip: use `@latest`. A bare `bunx oh-my-workflow` can serve a stale cached copy.

That single command runs the **whole spine** for you — a fan-out search, a
pipeline, a scripted schema-fail→self-repair, and a scripted timeout→drop — and
prints one result JSON. Want to watch it happen? Add `--pretty` for the
phase/fan-out tree on stderr:

```sh
bunx oh-my-workflow@latest run examples/deep-research --agent fake --pretty
```

`--agent fake` is a built-in, deterministic adapter — it's the no-key demo engine
and the test double. When you're ready for real work, log into your agent CLI once
and swap `--agent fake` → `--agent claude` (or `--agent codex`). Same script, real
nodes.

> **Reading this as a skill?** You already have it. To install/update it for a
> coding agent: `bunx oh-my-workflow@latest skill install` (→ `~/.claude/skills/`;
> `--codex` → `~/.codex/skills/`; `--opencode` → `~/.config/opencode/skills/`;
> `--project` for one repo). `omw skill path` prints the bundled copy for other
> hosts. Re-run `skill install` anytime to refresh.

---

## The hooks (the entire API)

Your script is a module that **default-exports** a function taking the **hooks**
as a destructured first argument and your `args` second:

```ts
export default async function ({ agent, parallel, pipeline, phase, log, workflow, budget }, args) {
  // destructure only the hooks you use
  return { /* whatever you want on stdout */ };
}
```

`args` is whatever `--args '{…}'` passed (parsed JSON). The returned value is
serialized to stdout as the run's single result JSON. (Legacy `(rt, args)` scripts
that call `rt.agent(…)` still run — the same object is passed — but they're
deprecated; run `omw codemod <file>` to migrate. The bridge is removed in 0.5.)

Optionally declare a `meta` block (a pure literal, like native):

```ts
export const meta = {
  name: "deep-research",
  description: "fan-out research with verify",
  phases: [{ title: "Search", model: "smart" }, { title: "Verify" }],
};
```

`meta.phases[].model` and `meta.model` set a default model per phase / for the
run; the effective model resolves along **`opts.model > phase model > meta.model`**.

### `agent(prompt, opts?) => Promise<result | null>`

Runs one coding-agent CLI node. **Never throws** (the one exception is `budget`
exhaustion — see below). A terminal failure resolves to `null` (and is journaled
with a failure `kind`). This is the load-bearing **null-contract** — build on it
with `filter(Boolean)` and abstain quorums.

```ts
const out = await agent("SCOPE the question into topics", {
  schema: { type: "object", required: ["topics"], properties: { topics: { type: "array" } } },
  label: "scope",         // shows in the journal / --pretty tree (cosmetic; not in resume key)
  phase: "Scope",         // overrides the ambient phase() for this call (cosmetic)
  model: "smart",         // tier alias or raw model string, passed to the adapter
  effort: "high",         // reasoning-effort hint: low|medium|high|xhigh|max (adapter maps it where supported)
  agentType: "Explore",   // cross-vendor node profile (named agent persona)
  isolation: "worktree",  // run this node in a fresh ephemeral git worktree (cwd = the worktree)
  timeoutMs: 120_000,     // kill the subprocess after this; failure kind = "timeout"
  cwd: "/path/to/repo",   // run the agent in this directory
  maxRetries: 2,          // schema-gate retries (default 2 → up to 3 attempts)
  inheritMcp: false,      // default: isolate from host MCP servers (fast). true = inherit (claude only; codex ignores)
});
```

- **With `schema`**: omw extracts JSON from the node's text, validates it with
  ajv, and on a mismatch **re-prompts the same node** with the validation errors
  (in-session via the adapter's resume if available, else fresh + error appended)
  up to `maxRetries` times. On success `agent()` returns the **validated object**.
  On exhaustion it returns `null`. **You never see schema noise** — only the
  structured outcome. The schema is plain JSON Schema.
- **Without `schema`**: one shot; returns the raw text string, or `null` on
  adapter failure.
- `effort`/`agentType` are passed through to adapters that support them; the
  `claude` adapter has no faithful CLI flag for them yet, so it **drops them with
  a one-time warn** (honest-scope) rather than silently pretending.
- `isolation: "worktree"` gives the node its own ephemeral `git worktree` as cwd,
  so parallel file-mutating nodes don't clobber each other; the worktree is
  auto-removed if the node left it clean. A non-git cwd runs in place with a warn.

### `parallel(thunks) => Promise<any[]>` — barrier

Runs thunks concurrently, awaits **all** of them. A thunk that throws (or whose
agent fails) becomes `null` in the result array — the call itself never rejects.
**`.filter(Boolean)` before using results.** Use only when you need every result
together (dedup, count, cross-comparison).

```ts
const results = (await parallel(
  topics.map((t) => () => agent(`SEARCH ${t}`, { schema: S, label: `search:${t}` })),
)).filter(Boolean);
```

### `pipeline(items, ...stages) => Promise<any[]>` — no barrier (default)

Runs each item through **all** stages independently. Item A can be in stage 3
while item B is still in stage 1 — wall-clock is the slowest single chain, not
the sum of slowest-per-stage. Each stage receives `(prev, item, index)`. A stage
that throws drops that item to `null` (skips its remaining stages). This is the
default for multi-stage work; only use `parallel` as a barrier when a stage
genuinely needs the whole previous result set at once.

```ts
const verified = (await pipeline(
  found,
  async (f) => {
    const v = await agent(`VERIFY ${JSON.stringify(f)}`, { schema: V });
    return v ? { ...f, ...v } : null;     // null → dropped by the filter below
  },
)).filter(Boolean);
```

### `workflow(ref, args?) => Promise<result>` — nested sub-workflow

Runs another workflow inline as a sub-step, **one level deep**, sharing this run's
adapter, journal, and budget pool. `ref` is a path string or `{ scriptPath }`.

```ts
const sub = await workflow({ scriptPath: "./refine.ts" }, { topic });
```

A `workflow()` call **inside** a child throws (`"workflow() nesting is one level
only"`) — a runaway-recursion backstop.

### `budget` — token ceiling

`budget` is `{ total, spent(), remaining() }`. Set a ceiling with `--budget N`;
`total` is `null` when unset and `remaining()` is then `Infinity`. Once spent
reaches `total`, `agent()` **throws `BudgetExceededError`** — the *one* documented
exception to the null-contract — so a bounded loop terminates instead of spinning.
A throw inside `parallel`/`pipeline` is still swallowed to `null` (matches native).

```ts
const out = [];
while (budget.remaining() > 50_000) {           // guard, or let agent() throw at the ceiling
  const r = await agent("find the next bug");
  if (r) out.push(r);
}
```

> `budget` counts **output tokens the adapter reports** (success or a failure
> envelope that carries `usage`). A token-less failure (a killed timeout reports
> no usage) can't be counted — so a loop on a purely-timing-out node isn't bounded
> by `--budget` alone; pair it with your own iteration cap.

### `phase(title)` and `log(msg)`

`phase` groups subsequent `agent()` calls under a heading in the journal and the
`--pretty` tree. `log` emits a narration line. Both are side-channel only — they
never touch stdout.

### Concurrency

The runtime bounds concurrency **at the `agent()` boundary** (default 4, set with
`--concurrency N`). `parallel`/`pipeline` themselves don't take a slot, so you can
pass hundreds of items — only ~N agent subprocesses run at once; the rest queue.

---

## Pattern templates (copy-paste, then adapt)

### Fan-out (barrier)

```ts
export default async function ({ agent, parallel, phase }, args) {
  phase("Search");
  const hits = (await parallel(
    args.queries.map((q) => () => agent(`SEARCH: ${q}`, { schema: HIT, label: `q:${q}` })),
  )).filter(Boolean);
  return { hits, count: hits.length };
}
```

### Verify-vote with an **abstain quorum**

A node that fails returns `null`, i.e. it **abstains** — it does not vote "no".
Count only real verdicts, and require a quorum of *cast* votes so an all-abstain
finding doesn't silently survive.

```ts
async function survives({ agent, parallel }, claim) {
  const votes = (await parallel(
    [1, 2, 3].map(() => () =>
      agent(`Try to REFUTE this claim. Default to refuted=true if unsure: ${claim}`, {
        schema: { type: "object", required: ["refuted"], properties: { refuted: { type: "boolean" } } },
      })),
  )).filter(Boolean);                       // drop abstainers (null)
  if (votes.length < 2) return false;       // quorum: need ≥2 cast votes
  return votes.filter((v) => !v.refuted).length >= 2;
}
```

**Fresh context is the point — not self-critique.** Each `agent()` call is a
brand-new subprocess with no memory of the producer's turn, so a verify-vote node
judges the claim cold. That is the structural form of Anthropic's own guidance for
its most capable model: *"Separate, fresh-context verifier subagents tend to
outperform self-critique"* ([Fable 5 prompting
guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5)).
omw gets it for free — **as long as you keep verification a separate `agent()`
call.** Do **not** verify by feeding the result back into the producer's own
session: the schema-gate's in-session self-repair (the `--resume` / `followUp`
path) deliberately *reuses* the producer's context to fix output **format**, which
is the exact opposite of fresh-context verification. Use self-repair to make a
node's JSON valid; use a new `agent()` to judge whether the *content* is true.
(A **cross-CLI** verifier — a different agent CLI than the producer, via per-node
`agentType` / a different adapter — is a natural extension but **not a feature
today**: omw binds one adapter per run. Verify with fresh same-CLI nodes for now.)

### Gate on evidence, not intent

The schema gate can only check the *shape* of what a node returns — so for an
**action-producing** node (one that builds, runs, edits, or fetches), make the
schema **`required` the evidence the action leaves behind** (an exit code, a test
count, a file path, the observed output), not just a plan or a `rationale`
string. A frontier model can fabricate status ("I'll now run the tests…") with no
tool call behind it; if "I did X" prose satisfies your gate, the gate verifies
nothing. Requiring the artifact makes an intent string fail validation — the node
must actually produce the proof:

```ts
// ✗ intent-only — "I ran the build" text passes this gate
const weak = { type: "object", required: ["summary"], properties: { summary: { type: "string" } } };

// ✓ evidence-bearing — the node must surface what the action actually produced
const strong = {
  type: "object",
  required: ["command", "exitCode", "testsPassed", "output"],
  properties: {
    command: { type: "string" },
    exitCode: { type: "number" },
    testsPassed: { type: "number" },
    output: { type: "string" },           // the observed tail, not a claim about it
  },
};
const built = await agent("Run the build and the test suite. Report the command, its exit code, the number of passing tests, and the tail of the output.", { schema: strong });
```

**Executable-evidence verify node** — combine this with fresh-context verification:
a separate node *runs what the producer built and observes the result* before the
finding is accepted, rather than judging the producer's description of it.

```ts
const verified = (await pipeline(
  artifacts,
  async (a) => {
    // a.path was written by an upstream node; this fresh node runs it and reports facts.
    const v = await agent(
      `Run \`${a.runCmd}\` in ${a.path}. Report exitCode and the output tail. Do not fix anything — only observe and report.`,
      { schema: { type: "object", required: ["exitCode", "output"], properties: { exitCode: { type: "number" }, output: { type: "string" } } } },
    );
    return v && (v as { exitCode: number }).exitCode === 0 ? { ...a, ...(v as object) } : null;
  },
)).filter(Boolean);                         // anything that didn't run clean abstains
```

### Pipeline (no barrier)

```ts
const out = (await pipeline(
  items,
  (item) => agent(`ANALYZE ${item.id}`, { schema: A, label: `analyze:${item.id}` }),
  (analysis, item) => (analysis ? agent(`SUMMARIZE ${item.id}: ${JSON.stringify(analysis)}`, { schema: S }) : null),
)).filter(Boolean);
```

### Loop-until-dry

For unknown-size discovery: keep going until K consecutive rounds find nothing new.

```ts
const seen = new Set(); const found = []; let dry = 0;
while (dry < 2) {
  const round = (await parallel(
    FINDERS.map((f) => () => agent(f.prompt, { schema: BUG })),
  )).filter(Boolean);
  const fresh = round.filter((b) => !seen.has(b.key));
  if (fresh.length === 0) { dry++; continue; }
  dry = 0; fresh.forEach((b) => seen.add(b.key)); found.push(...fresh);
}
```

### Loop-until-budget

Scale depth to a token ceiling — guard on `budget.total` so an unset budget
(`remaining()` = `Infinity`) doesn't loop forever.

```ts
const bugs = [];
while (budget.total && budget.remaining() > 50_000) {
  const r = await agent("Find one more bug.", { schema: BUG });
  if (r) bugs.push(r);
}
```

---

## The run → journal → fix loop (this is the UX)

```sh
bun src/cli/omw.ts run my-workflow.ts --agent claude --args '{"q":"…"}'
```

- **stdout** = the result JSON, one blob. Pipe it, parse it.
- **journal** = `.omw/<runId>.jsonl`, one event per line. This is where you read
  *why* a node failed and repair your script.
- **`--pretty`** = a phase/fan-out tree on **stderr** (never stdout).

### Exit codes

| code | meaning | where the detail is |
|---|---|---|
| `0` | run completed (node failures are absorbed by the null-contract) | stdout = result JSON |
| `1` | **script error** — your JS threw (incl. `BudgetExceededError`), or syntax/load failure | stderr: `{"error":"script_error"\|"load_failed",…}` |
| `2` | usage error (bad flags) | stderr: usage line |
| `3` | adapter CLI not on PATH | stderr: `{"error":"adapter_missing","install_hint":…}` |
| `4` | completed, but a node hit `internal_error` (author bug, e.g. invalid schema) | stdout = partial result; stderr: `{"error":"internal_error_nodes",…}` |

Exit `1` means **your script** threw (an `agent()` returning `null` does *not*
throw — only your own code, or an uncaught `BudgetExceededError`, does). Exit `0`
with fewer results than expected means nodes failed and were filtered — read the
journal.

### Reading a journal

The events are `run_start · phase · agent_start · attempt · agent_end · log ·
run_end`. A self-repair looks like this (excerpt from a real fake run, `ts`
fields elided — `search:a` returns invalid JSON, gets re-prompted, recovers):

```jsonl
{"ev":"agent_start","call":2,"label":"search:a","phase":"Search","adapter":"fake","promptHash":"sha256:…","optsHash":"sha256:…"}
{"ev":"attempt","call":2,"n":1,"kind":"schema_violation","errors":["/ must have required property 'topic'","/ must have required property 'hits'"],"rawText":"{\"oops\":1}"}
{"ev":"attempt","call":2,"n":2,"kind":"ok"}
{"ev":"agent_end","call":2,"ok":true,"result":{"topic":"a","hits":3},"durationMs":0}
```

A terminal failure carries the **kind** so you know what to fix:

```jsonl
{"ev":"agent_end","call":3,"ok":false,"kind":"timeout","durationMs":0}
```

Failure `kind`s on `agent_end`:

- **adapter**: `timeout` · `nonzero_exit` · `spawn_failure` (the CLI itself failed)
- **`refusal`**: the model **declined** the task (a safety/decline outcome — HTTP
  200, `stop_reason:"refusal"` — not a crash). Detected by the `claude` adapter;
  N/A for `codex` (no distinct refusal signal → it stays `nonzero_exit`). Kept
  separate so an abstain-quorum can treat **declined ≠ failed**: a node that
  *can't* answer and a node that *won't* are different signals, and the journaled
  kind makes *why* a null happened auditable. It still abstains (resolves to
  `null`, dropped by `filter(Boolean)`) — `refusal` is a journaled outcome, never
  a thrown error or a silent pass.
- **gate**: `no_json` · `schema_violation` (the node never produced valid JSON in
  `maxRetries+1` attempts — `rawText` is journaled so you can see what it said)
- **`internal_error`**: a bug in omw or your schema (e.g. an invalid JSON Schema
  that won't compile) — distinct from a flaky node, so you don't misdiagnose.

`omw replay .omw/<runId>.jsonl [--json]` reconstructs the tree / a stats summary
from a journal — a read-only **fixture replay** (reading back what a run
recorded). For *live* resume (re-running nodes whose key changed, reusing the
cached ones), use `omw run <wf> --resume <journal|runId>` — see Scope below.

`omw validate <wf> [--json]` is a pre-flight that loads the module and lints a
`fake` fixture for the silent-degradation traps (top-level `responses`, a string
`match`, no rules+default) **without spawning agents** — exit 0 clean, 1 on a
load/fixture problem.

---

## Conventions (follow these)

1. **Build on the null-contract.** `agent()` returns `null`, never throws (except
   `BudgetExceededError` at the ceiling). `.filter(Boolean)` after every
   `parallel`/`pipeline`. For votes, require a quorum of *cast* (non-null) results
   so all-abstain can't pass.
2. **Always pass a `schema` when you need structured data.** The gate's
   self-repair is the one genuine differentiator — use it instead of parsing
   prose yourself. Keep schemas tight (`required` + types).
3. **Stay deterministic.** Don't branch the *shape* of the run on `Date.now()` /
   `Math.random()` / wall-clock. The resume key is the **semantic** subset of
   `(callIndex, promptHash, optsHash)` — cosmetic `label`/`phase` changes don't
   bust the cache, but `model`/`schema`/`effort`/`isolation` do. If a re-run's
   `agent()` call order shifts, every key shifts and resume breaks; vary content
   by index, not by randomness. omw can't enforce determinism by default (no
   sandbox) — but pass **`--strict`** to freeze `Date`/`Math.random` to throw for
   a reproducible run.
4. **stdout is for the machine.** Return your result; use `log` / `--pretty`
   for humans. Never `console.log` to stdout from a workflow.
5. **Ship a `fake` fixture for your example.** Export `const fake` alongside your
   default export so `--agent fake` runs deterministically with no key. The shape:

   ```ts
   export const fake = {
     // Each rule's `match` is a PREDICATE FUNCTION over the prompt (not a string/regex).
     // `responses` is a cursor that advances per invocation and sticks on the last —
     // so [invalidJSON, validJSON] models a schema self-repair, and a single
     // { fail } models a hard failure. A FakeResponse is { text } (a raw JSON
     // STRING the gate then extracts + validates) or { fail, stderr }. Either may
     // carry { outputTokens } to drive budget tests.
     rules: [
       { match: (p) => p.includes("SCOPE"), responses: [{ text: '{"topics":["a","b"]}' }] },
       { match: (p) => p.includes("SEARCH a"),
         responses: [{ text: '{"oops":1}', sessionId: "sa" }, { text: '{"topic":"a","hits":3}' }] }, // self-repair
       { match: (p) => p.includes("SEARCH b"), responses: [{ fail: "timeout" }] },                    // dropped
     ],
     default: { text: "{}" }, // returned when no rule matches — keep it valid so unmatched nodes don't crash
   };
   ```

   Common mistake: a top-level `responses` array (instead of `rules`) or a string
   `match` is silently ignored — every node then returns `default` and the demo
   degenerates to an empty result. See `examples/deep-research/workflow.ts` for a
   full working fixture, and `conformance/*.ts` for native-shaped samples.

---

## Adapters

A node is a coding agent driven through its **headless prompt→result CLI**. Only
agents that expose such a CLI can be nodes.

| adapter | status | invoke | structured out | in-session follow-up |
|---|---|---|---|---|
| **fake** | built-in, free, deterministic | in-process fixtures | as scripted | yes (fixture) |
| **claude** | **full** (live-verified, claude 2.1.x) | `claude -p <p> --output-format json --strict-mcp-config` | parse `.result` | `--resume` (same cwd) |
| **codex** | **experimental** (live-verified, codex 0.137.x) | `codex exec --json -s workspace-write` | last `agent_message` from JSONL | `exec resume` (same cwd) |
| **hermes** | **experimental** | `hermes -z <prompt> --yolo` | stdout IS the response (heuristic JSON extract) | — (fresh retries) |
| **pi** | planned | `pi --print` | stdout | — |
| **kiro** | **not a fit** | — | — | — |

> The "in-session follow-up" column is the adapter flag the **schema gate** uses to
> re-prompt a node in the same session — *not* run-level resume. Run-level resume
> (`--resume`, skipping unchanged nodes across runs) is a separate path.

- **claude** renames its envelope onto omw's contract (`session_id→sessionId`,
  `total_cost_usd→costUsd`, `duration_ms→durationMs`, `usage.output_tokens→
  outputTokens`; `is_error`/non-success `subtype` → `ok:false`). By default a node
  runs **isolated from the host's MCP servers** (`--strict-mcp-config`) — booting
  figma/devtools/etc. on every node is the dominant fan-out latency, and a
  coding-agent node rarely needs them. Opt back in per call with `{ inheritMcp:
  true }`. `opts.effort`/`opts.agentType` have no faithful `claude -p` flag yet, so
  they're **dropped with a one-time warn** rather than silently honored. The
  schema-gate `--resume` runs in the **same cwd** as the original invoke and
  **mirrors the same MCP choice**.
- **codex** is experimental: it has **no cost field** (tokens only, so `costUsd`
  stays undefined), and its JSONL can include malformed lines under MCP
  (openai/codex#15451) — omw tolerates them line-by-line and fails *actionably*
  rather than returning empty. Default sandbox is `workspace-write`.
- **hermes** is experimental: `-z/--oneshot` prints only the response text, so the
  result is stdout (no JSON envelope; schema-gate extracts JSON heuristically).
  `--yolo` runs it non-interactively. No in-session followUp (no session id on
  stdout) → schema retries use fresh invokes. No cost field.
- **pi** isn't wired yet (`--agent pi` → exit 3 with an install hint).
- **kiro is excluded on purpose**: its CLI is a VS-Code-based IDE launcher, with
  no headless prompt→result interface — so it can't be an omw node.

Missing CLI → exit 3 with `install_hint`. Run `--agent fake` any time for the
free path.

---

## Honest scope — what omw resembles, and what it doesn't

omw externalizes a pattern Claude Code uses internally for dynamic workflows
("the model authors a deterministic orchestration script on the fly"). It is a
**faithful reconstruction of that pattern as OSS**, not a decompiled copy and not
a first/best/moat claim. Where it lands honestly:

| | who writes the script | where it runs | a node is | agent-agnostic |
|---|---|---|---|---|
| Bernstein, pi-builder | a human, ahead of time | external | varies | — |
| sub-agents-skills | per-turn routing (no standing script) | in-harness | a subagent | no |
| Claude Code Workflow | the model, on the fly | sealed sandbox | a subagent (one in-harness agent) | no (Claude only) |
| **oh-my-workflow** | **the model, on the fly (taught by this skill)** | **external** | **a whole coding-agent CLI** | **yes (claude/codex/…)** |

No single shipped project does all three of *(a) host-agent-authored on the fly +
(b) executed externally via reusable agent CLIs + (c) agent-agnostic*. omw is the
reference implementation of that **2-of-3 intersection** — plus the schema-gate
self-repair loop, which is the one piece a "subprocess + for-loop" doesn't have.

### Resemblance ledger (vs the CC dynamic-workflow surface)

**✅ Genuinely the same idea** — model-authored plain-JS orchestration with the
destructured-DI shape; the native vocabulary `agent`/`parallel`/`pipeline`/
`phase`/`log`/`workflow`/`budget`; an optional `meta`/`phases` block with model
precedence; `null`-resolution + `filter(Boolean)`; schema-forced structured
output; `agent` opts `effort`/`agentType`/`isolation:'worktree'`; `budget` with a
shared spend pool and a `BudgetExceededError` ceiling; nested `workflow()` (one
level); a step-by-step journal; the resume key `(callIndex, promptHash,
optsHash)` (frozen, byte-stable, and keyed on the **semantic** opts subset);
**live resume** via `omw run --resume <journal|runId>`; and an opt-in `--strict`
determinism sandbox.

> One honest altitude difference even here: a CC Workflow node is a single
> in-harness subagent; an **omw node is a whole external coding-agent CLI**
> subprocess. Same orchestration shape, heavier nodes. And the no-magic stance is
> deliberate: omw runs your script as-is (no source transform), hands hooks as an
> argument (no ambient globals), and leaves determinism opt-in (`--strict`).

**🟡 Designed-but-scoped** —
- *Determinism enforcement*: native throws on `Date.now`/`Math.random` always;
  omw makes it **opt-in** via `--strict` (the rest of the time it's a convention).
- *Resume is per-node, not dependency-aware*: it matches the semantic
  `(callIndex, promptHash, optsHash)`, so an upstream edit invalidates a
  downstream node **only if** that output is threaded into the downstream
  prompt/opts. This is deliberate — it preserves **parallel/pipeline sibling
  cache**. **The trap**: an omw node is a whole coding-agent CLI that works on the
  **filesystem**, so "node 1 writes files, node 2 reads them" is the *normal*
  idiom — and that channel is invisible to the key. Edit node 1 → on resume it
  re-runs and writes different files, but node 2 **hits its cache and serves a
  summary of the old files** (silently stale). Remedies: (a) re-run fresh (drop
  `--resume`), or (b) thread a content digest of the changed files into the
  downstream prompt so its hash moves. A dependency-aware cascade is v2.
- *`budget` counts reported output tokens only*: a token-less failure (a killed
  timeout) can't be counted, so pair `--budget` with your own iteration cap when a
  node may fail without producing tokens.

**❌ Not implemented** (native has these; omw does not) — `run_in_background`
(async node scheduling), and per-node verifier selection across *different*
adapters in one run (omw binds one adapter per run; `agentType` is passed through
but cross-CLI routing is future work). Don't write scripts that assume these.

---

## Quick reference

- Module: `export default async ({ agent, parallel, pipeline, phase, log, workflow, budget }, args) => result` · optional `export const meta` / `export const fake`. (Legacy `(rt, args)` still runs; `omw codemod <file>` migrates it.)
- Path resolves a directory to `workflow.ts` / `workflow.js` / `index.ts` / `index.js`.
- `omw run <wf> --agent <fake|claude|codex|pi> [--args JSON] [--concurrency N] [--budget N] [--resume <journal|runId>] [--strict] [--pretty]`
- `omw replay <journal.jsonl> [--json]`
- `omw validate <wf> [--json]` — pre-flight: load + fake-fixture lint, no agents spawned.
- `omw codemod <file> [--to-di] [--write]` — migrate a legacy `(rt, args)` workflow to destructured DI.
- `omw skill install [--codex|--opencode] [--project]` — install this skill for a coding agent.
- exit codes: `0` ok · `1` script/load error (incl. budget ceiling) · `2` usage · `3` adapter missing · `4` completed but a node hit `internal_error` (author bug; result still on stdout).
- stdout = result JSON · journal = `.omw/<runId>.jsonl` · `--pretty` tree = stderr.
- `agent()` never throws (except `BudgetExceededError`) → `filter(Boolean)`; quorum of cast votes for verify-vote.
