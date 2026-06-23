# omw "open dynamic-workflow twin" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Spec:** `docs/specs/2026-06-23-omw-open-dynamic-workflow-twin-design.md` (read it first — every task traces to a spec section).
> **Phased:** each Phase is an independently shippable milestone. Phases 3–4 tasks give exact files/interfaces/lines + test approach; expand each to full TDD steps (test → fail → impl → pass → commit) at execution time, mirroring the worked steps in Phases 0–2.

**Goal:** Re-surface omw as the standard-JS, portable twin of Claude Code's native dynamic Workflow — destructured-DI authoring, native vocabulary parity (budget/workflow/agent-opts), opt-in determinism — without source-transform magic.

**Architecture:** Keep the proven engine (`makeRuntime` hooks, null-contract, schema-gate, prefix-resume) unchanged in behavior. Change only (a) the script-facing surface: a single enriched hooks object `{agent,parallel,pipeline,phase,log,workflow,budget}` passed as the workflow's first arg (legacy `rt` scripts keep working — same object), (b) new primitives layered onto that object, (c) opt-in `--strict` sandbox + resume-key narrowing, (d) CLI flags + codemod + cross-agent skill.

**Tech Stack:** TypeScript run directly under Bun (no build step), `bun:test`, `node:crypto`/`node:child_process` via Bun, Ajv (existing schema-gate). No new runtime deps unless a task says so.

## Global Constraints

- Bun-native: `bin` is TS, no build. Engines require bun. `npx`/Node won't run the TS bin. (spec §0)
- NO barrel files. Every import is a direct relative path into `../src/<module>` (user ts-imports rule). Tests: `import { test, expect, describe } from "bun:test"`.
- Null-contract is sacred: `agent()` never throws on a node failure (→ null + journaled `agent_end{ok:false,kind}`). The ONLY exception is `BudgetExceededError` (Task 8). (spec §2, §3.budget)
- Exit codes (load-bearing, asserted in tests): `0` ok · `1` load_failed/script_error · `2` usage · `3` adapter_missing · `4` internal_error_nodes.
- Tests: frozen clock everywhere `makeJournal({ now: () => 0 })`; CLI deps `now: () => 0, runId: () => "test"`. Fake failure literals need `as const`: `{ fail: "timeout" as const }`. Run: `bun test`. Typecheck: `tsc --noEmit`.
- Commits: Conventional Commits, scope = package/area (`core`, `cli`, `adapters`, `resume`, `skill`, `specs`). NO `Co-authored-by` tag.
- Honest-scope preserved in docs: node altitude, heuristic JSON extraction, FS side-channel. (spec §8)

## File Structure

- `src/runtime.ts` — engine + hooks. **Most-touched.** Adds: `WorkflowMeta` type, budget state + `budget` member, `BudgetExceededError`, opts `effort`/`isolation`/`agentType`, semantic-opts resume key, threading at `invokeFresh`.
- `src/adapters/types.ts` — `AgentResult.meta.outputTokens?`, `InvokeRequest` new fields.
- `src/adapters/claude.ts` — read `usage.output_tokens`; map new flags to CLI args.
- `src/adapters/fake.ts` — `FakeResponse` token field for deterministic budget tests.
- `src/cli/run.ts` — enriched-hooks first arg + legacy bridge + deprecation warn; read `mod.meta`; `--budget`/`--strict` parse + thread; `--resume <runId>` resolution; `--strict` sandbox wrap.
- `src/cli/omw.ts` — dispatch `codemod`; usage block.
- `src/cli/codemod.ts` — **new.** `(rt,args)`→DI and native→omw transforms.
- `src/cli/skill.ts` — `install --codex/--opencode` target dirs.
- `src/worktree.ts` — **new.** ephemeral git-worktree helper for `isolation:'worktree'`.
- `skill/SKILL.md` — rewrite for new surface, cross-agent voice.
- `README.md`, `CHANGELOG.md`, `package.json`, `.github/workflows/ci.yml` — positioning, 0.4.0, provenance.
- `conformance/*.ts` + `test/conformance.test.ts` — **new.** drop-in proof.
- Extend existing `test/cli.load.test.ts`, `test/resume.test.ts`, `test/cli.run.test.ts`, `test/runtime.test.ts`.

---

# Phase 0 — Surface flip (enables everything)

**Milestone:** new destructured-DI scripts run; legacy `(rt,args)` scripts still run + get a deprecation nudge; `meta` is read.

### Task 1: `meta` export read + `WorkflowMeta` type

**Files:**
- Modify: `src/cli/run.ts:88-91` (LoadedWorkflow), `src/cli/run.ts:125-151` (loadWorkflow return)
- Create type in `src/runtime.ts` (top, near AgentOpts)
- Test: extend `test/cli.load.test.ts`

**Interfaces:**
- Produces: `export type WorkflowMeta = { name?: string; description?: string; whenToUse?: string; model?: string; phases?: Array<{ title: string; model?: string; detail?: string }> }`
- `LoadedWorkflow` gains `meta?: WorkflowMeta`.

- [ ] **Step 1: Failing test** — in `test/cli.load.test.ts`, add:
```ts
test("loadWorkflow surfaces a meta named export when present", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omw-meta-"));
  writeFileSync(join(dir, "workflow.ts"),
    `export const meta = { name: "m", phases: [{ title: "Scan" }] };\n` +
    `export default async function ({ agent }, args) { return await agent("x"); }\n`);
  const loaded = await loadWorkflow(dir);
  expect(loaded.meta).toEqual({ name: "m", phases: [{ title: "Scan" }] });
});
```
(import `mkdtempSync, writeFileSync` from `node:fs`, `join` from `node:path`, `tmpdir` from `node:os`, `loadWorkflow` from `../src/cli/run`.)
- [ ] **Step 2: Run, verify fail** — `bun test test/cli.load.test.ts` → FAIL (`loaded.meta` undefined).
- [ ] **Step 3: Implement** — add `WorkflowMeta` to `src/runtime.ts`; add `meta?: WorkflowMeta` to `LoadedWorkflow` (run.ts:88-91); at loadWorkflow return (run.ts:150) change to `return { workflow: mod.default, fake: mod.fake, meta: mod.meta };`.
- [ ] **Step 4: Run, verify pass** — `bun test test/cli.load.test.ts` PASS; `tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): read workflow meta named export"`

### Task 2: Enriched-hooks first arg + legacy bridge + deprecation warn

Key insight (ground truth, loader gotcha #3): the SAME object satisfies both contracts. Pass `hooks` (rt enriched with `workflow`/`budget`, added in later tasks) as the first arg always. Legacy scripts use it as `rt`; new scripts destructure it. No execution-time dispatch needed. Only the **deprecation warning** needs to detect legacy shape.

**Files:**
- Modify: `src/cli/run.ts:196-200` (build first arg + invoke), `src/cli/run.ts:148` (error text)
- Test: extend `test/cli.run.test.ts`

**Interfaces:**
- Consumes: `makeRuntime(...)` returning `{agent,parallel,pipeline,phase,log}` (runtime.ts:260-269). (`workflow`/`budget` added in Tasks 5/8 — until then the first arg has the 5 hooks; that's fine.)
- Produces: `isLegacyShape(fn: Function): boolean` (module-private helper in run.ts) — true when the first param is NOT a destructuring pattern.

- [ ] **Step 1: Failing test** — in `test/cli.run.test.ts`:
```ts
test("a destructured-DI workflow runs and a legacy (rt,args) workflow runs with a deprecation notice", async () => {
  const errs: string[] = [];
  const di = { workflow: async ({ agent }: any, args: any) => ({ di: await agent("go"), args }), fake: { default: { text: "ok" as const } } };
  const out1 = await runWorkflow(
    { wfPath: "x", agent: "fake", args: 7, pretty: false } as any,
    { loadWorkflow: async () => di as any, resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }), journalSink: () => {}, now: () => 0, runId: () => "t", stderr: (s) => errs.push(s) });
  expect(out1.exitCode).toBe(0);
  expect(JSON.parse(out1.stdout!)).toEqual({ di: "ok", args: 7 });
  expect(errs.join("")).not.toContain("deprecat");

  const legacy = { workflow: async (rt: any) => ({ leg: await rt.agent("go") }), fake: { default: { text: "ok" as const } } };
  const out2 = await runWorkflow(
    { wfPath: "x", agent: "fake", args: null, pretty: false } as any,
    { loadWorkflow: async () => legacy as any, resolveAdapter: (_n, wf) => ({ adapter: makeFakeAdapter((wf as any).fake) }), journalSink: () => {}, now: () => 0, runId: () => "t", stderr: (s) => errs.push(s) });
  expect(out2.exitCode).toBe(0);
  expect(errs.join("")).toContain("deprecat");
});
```
- [ ] **Step 2: Run, verify fail** — FAIL (destructured script: `rt.agent` undefined / no warn path).
- [ ] **Step 3: Implement** — in run.ts, before the invoke (was line 200):
```ts
const hooks = rt; // rt already has agent/parallel/pipeline/phase/log; workflow+budget injected in Tasks 5/8
if (isLegacyShape(loaded.workflow)) deps.stderr?.("omw: deprecation — positional `rt` authoring is deprecated; destructure hooks `({ agent, ... }, args)`. Removed in 0.5. Run `omw codemod`.");
const result = await loaded.workflow(hooks, opts.args);
```
Add helper (module scope):
```ts
function isLegacyShape(fn: Function): boolean {
  const src = Function.prototype.toString.call(fn);
  // first param destructures an object → new shape; else legacy positional rt
  return !/^\s*(async\s+)?function\s*\*?\s*\(\s*\{|^\s*\(\s*\{|^\s*async\s*\(\s*\{/.test(src);
}
```
Update the load-error string (run.ts:148) to: `must default-export a function ({ agent, parallel, pipeline, phase, log, workflow, budget }, args) => result (legacy (rt, args) still supported)`.
- [ ] **Step 4: Run, verify pass** — `bun test test/cli.run.test.ts` PASS; existing legacy fixtures (`test/fixtures/wf-ok.ts`, examples) still green: `bun test`.
- [ ] **Step 5: Commit** — `git commit -am "feat(cli): destructured-DI first arg + legacy rt bridge with deprecation"`

---

# Phase 1 — Primitives & vocabulary parity (spec §3)

### Task 3: Output-token field on AgentResult (+ both adapters)

**Files:** `src/adapters/types.ts:15-21`, `src/adapters/claude.ts:18-55` (parseClaudeResult), `src/adapters/fake.ts:9-33`; Test: `test/adapters.claude.test.ts`, `test/adapters.fake.test.ts`.

**Interfaces:** `AgentResult` success `meta` gains `outputTokens?: number`. `FakeResponse` success gains `outputTokens?: number`.

- [ ] **Step 1: Failing test** (claude parse) in `test/adapters.claude.test.ts`:
```ts
test("parseClaudeResult reads usage.output_tokens into meta", () => {
  const r = parseClaudeResult({ result: "hi", duration_ms: 5, usage: { output_tokens: 42 } });
  expect(r.ok && r.meta.outputTokens).toBe(42);
});
```
- [ ] **Step 2: Run → FAIL** (`outputTokens` undefined).
- [ ] **Step 3: Implement** — add `outputTokens?: number` to `AgentResult` success `meta` (types.ts:15-21). In parseClaudeResult success branch (claude.ts ~46-54) add `outputTokens: (raw as any)?.usage?.output_tokens`. In fake `toResult` (fake.ts:28-32) copy `outputTokens: ("text" in r ? r.outputTokens : undefined)` and add `outputTokens?: number` to FakeResponse success variant (fake.ts:9-11).
- [ ] **Step 4: Run → PASS**; `tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -am "feat(adapters): carry node output_tokens on AgentResult.meta"`

### Task 4: `budget` accounting + `budget` member on Runtime

**Files:** `src/runtime.ts:89-102` (makeRuntime deps + closure), `:130-132` (account), `:260-269` (return); `src/cli/run.ts:153-165` (RunDeps unchanged), `:196` (thread budget). Test: `test/runtime.test.ts`.

**Interfaces:**
- `makeRuntime` deps gains `budget?: number` (the total).
- Runtime gains `budget: { total: number | null; spent(): number; remaining(): number }`. `remaining()` = `Infinity` when total null.

- [ ] **Step 1: Failing test**:
```ts
test("budget.spent sums node output tokens; remaining counts down; Infinity when unset", async () => {
  const journal = makeJournal({ now: () => 0 });
  const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: "x", outputTokens: 30 }] }] });
  const rt = makeRuntime({ adapter, journal, budget: 100 });
  expect(rt.budget.total).toBe(100);
  await rt.agent("a");
  expect(rt.budget.spent()).toBe(30);
  expect(rt.budget.remaining()).toBe(70);
  const rt2 = makeRuntime({ adapter, journal });
  expect(rt2.budget.remaining()).toBe(Infinity);
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in makeRuntime: add `budget` to deps; `let spent = 0;` beside callCounter (runtime.ts:101); in `account` (130-132) add `if (r.ok) spent += r.meta.outputTokens ?? 0;`; add to the returned object (260-269): `budget: { total: deps.budget ?? null, spent: () => spent, remaining: () => deps.budget == null ? Infinity : deps.budget - spent }`. In run.ts:196 thread `budget: opts.budget` into makeRuntime (opts.budget arrives in Task 12; until then it's undefined → null, fine).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(core): budget accounting + budget hook on runtime"`

### Task 5: `workflow()` nested run hook (1 level)

**Files:** `src/cli/run.ts` (build `workflow` fn, add to hooks at :196-200); reuses `loadWorkflow`/`runWorkflow`. Test: `test/cli.run.test.ts`.

**Interfaces:** hooks gains `workflow(ref: string | { scriptPath: string }, args?: unknown): Promise<unknown>`. Shares journalSink + adapter + budget. Nested call inside a child → throw `Error("workflow() nesting is one level only")`.

- [ ] **Step 1: Failing test** — parent workflow calls `workflow({ scriptPath })`; child returns a value; assert parent result embeds it; assert a grandchild `workflow()` throws. (Model on cli.run.test.ts runWorkflow block; inject `loadWorkflow` returning parent then child by path.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in run.ts, construct `const workflow = makeWorkflowHook(deps, { adapter, journalSink, budget, depth: 0 })` that loads the ref via `deps.loadWorkflow`, builds a child runtime sharing the same journal + adapter + a SHARED `spent` (pass the same budget object through), invokes the child workflow with `depth+1`, and throws if `depth >= 1`. Add `workflow` to the `hooks` object in Task 2's invoke site.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(core): inline nested workflow() hook, one level"`

### Task 6: agent opts `effort` / `agentType` fields + adapter threading

**Files:** `src/runtime.ts:15-25` (AgentOpts), `:135-142` (invokeFresh), `src/adapters/types.ts:29-43` (InvokeRequest), `src/adapters/claude.ts:136-143` (arg-builder). Test: `test/runtime.test.ts`, `test/adapters.claude.test.ts`.

**Interfaces:** AgentOpts gains `effort?: "low"|"medium"|"high"|"xhigh"|"max"`, `agentType?: string`. InvokeRequest gains the same passthrough fields (`effort?`, `agentType?`). (`isolation` handled in Task 7.)

- [ ] **Step 1: Failing test** (claude arg-builder maps effort): build adapter with injected `spawn` capturing argv; `invoke({ prompt:"p", effort:"high" })`; assert argv includes the effort flag (decide flag name; if claude CLI has none, assert it is recorded but NOT pushed and a warn fires — pick one and test it).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — add fields to AgentOpts; thread in invokeFresh (the single seam, runtime.ts:135-142) onto the InvokeRequest; add fields to InvokeRequest; in claude.ts arg-builder push mapped flags where the CLI supports them, else emit a one-time warn via a deps hook and skip (honest-scope, spec §3). `optsHash` narrowing (Task 9) will include these as semantic.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(core,adapters): agent opts effort/agentType threaded to adapter"`

### Task 7: `isolation: 'worktree'`

**Files:** Create `src/worktree.ts`; wire in `src/runtime.ts` agent() around the adapter invoke (set `opts.cwd` to the worktree). Test: `test/worktree.test.ts` (real git temp repo).

**Interfaces:** `export async function withWorktree<T>(repoCwd: string, fn: (worktreeDir: string) => Promise<T>): Promise<T>` — `git worktree add` an ephemeral dir, run fn with it as cwd, `git worktree remove` after; auto-remove only if unchanged (else leave + warn). Non-git dir → temp copy + warn, or run in place + warn (pick one; test it).

- [ ] **Step 1: Failing test** — init a temp git repo (`git init`, one commit), call `withWorktree(repo, async (d) => { expect(existsSync(d)).toBe(true); return readdirSync(d); })`; after, assert the worktree dir is gone (`git worktree list` no longer lists it).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `src/worktree.ts` using `Bun.spawn(["git","worktree","add","--detach", dir])` / `remove`. In runtime.ts agent(): when `opts.isolation === "worktree"`, wrap the limit()-body adapter call so the node runs with `cwd` = the worktree dir.
- [ ] **Step 4: Run → PASS** (`bun test test/worktree.test.ts`).
- [ ] **Step 5: Commit** — `git commit -am "feat(core): isolation:'worktree' ephemeral git worktree per node"`

### Task 8: `BudgetExceededError` — `agent()` throws on exhaustion

**Files:** `src/runtime.ts` (error class near errMsg ~:64; throw site after resume short-circuit ~:127, BEFORE `limit()` at :128). Test: `test/runtime.test.ts`.

**Interfaces:** `export class BudgetExceededError extends Error`. Throw when `deps.budget != null && spent >= deps.budget`, placed OUTSIDE the try/catch (so it propagates, not swallowed to null). parallel/pipeline keep swallowing it to null (spec: matches native — do NOT special-case).

- [ ] **Step 1: Failing test**:
```ts
test("agent() throws BudgetExceededError once spent >= total (the one null-contract exception)", async () => {
  const journal = makeJournal({ now: () => 0 });
  const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: "x", outputTokens: 60 }] }] });
  const rt = makeRuntime({ adapter, journal, budget: 50 });
  await rt.agent("first"); // spends 60 ≥ 50 after this
  await expect(rt.agent("second")).rejects.toBeInstanceOf(BudgetExceededError);
});
test("a budget throw inside parallel() is swallowed to null (matches native)", async () => {
  const journal = makeJournal({ now: () => 0 });
  const adapter = makeFakeAdapter({ rules: [{ match: () => true, responses: [{ text: "x", outputTokens: 99 }] }] });
  const rt = makeRuntime({ adapter, journal, budget: 1 });
  await rt.agent("warmup").catch(() => {});
  const res = await rt.parallel([() => rt.agent("a")]);
  expect(res).toEqual([null]);
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — define `BudgetExceededError`; insert `if (deps.budget != null && spent >= deps.budget) throw new BudgetExceededError(\`budget exhausted: ${spent}/${deps.budget} tokens\`);` between the resume short-circuit (after runtime.ts:126) and `return limit(...)` (line 128). Confirm it sits outside the `try` that begins inside `limit()` (line 144).
- [ ] **Step 4: Run → PASS.** Re-run full `bun test` — null-contract suite + spine (no unhandled rejections) still green.
- [ ] **Step 5: Commit** — `git commit -am "feat(core): budget ceiling throws BudgetExceededError (documented null-contract exception)"`

---

# Phase 2 — Resume & determinism (spec §4)

### Task 9: optsHash semantic subset (exclude cosmetic label/phase)

**Files:** `src/runtime.ts:108` (the `optsHash(opts)` call site — pick semantic subset there) + `src/journal.ts:30` may stay generic. Test: `test/resume.test.ts` / `test/runtime.test.ts`.

**Interfaces:** module-private `pickSemantic(opts: AgentOpts)` → `{ model, schema, effort, isolation, agentType, cwd, inheritMcp }` (drops `label`, `phase`, `timeoutMs`, `maxRetries`). Call `optsHash(pickSemantic(opts))`.

- [ ] **Step 1: Failing test**: run 1 with `{ label: "a" }`, build resume index, run 2 with `{ label: "b" }` (same prompt) using a counting adapter → assert `adapter.calls === 0` (cache hit despite label change).
- [ ] **Step 2: Run → FAIL** (label currently in hash → miss).
- [ ] **Step 3: Implement** `pickSemantic`; change runtime.ts:108 to hash the picked subset. (Per ground truth: narrowing happens at the producer call site, not in journal.ts/resume.ts.)
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(resume): key on semantic opts only; cosmetic label/phase no longer bust cache"`

### Task 10: `--resume <runId>` resolution

**Files:** `src/cli/run.ts` runCommand (~:297-313 resume load). Test: `test/cli.run.test.ts` (real temp `.omw` dir).

**Interfaces:** in runCommand, if `opts.resume` is not an existing file path, treat it as a runId → resolve `join(omwDir, opts.resume + ".jsonl")` before reading.

- [ ] **Step 1: Failing test** — write a journal at `<omwDir>/r-abc.jsonl`; run with `--resume r-abc` (not a path) → assert it loads (no resume_read_failed exit 1).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `const resumeArg = opts.resume; const resumePath = existsSync(resumeArg) ? resumeArg : join(omwDir, resumeArg + ".jsonl");` then read as today.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(cli): --resume accepts a runId (resolves .omw/<runId>.jsonl)"`

### Task 11: `--strict` determinism sandbox

**Files:** `src/cli/run.ts` runWorkflow (~:200 invoke). Test: `test/cli.run.test.ts`.

**Interfaces:** when `opts.strict`, patch `globalThis.Date`/`Date.now`/`Math.random` to throw for the duration of the workflow invoke; restore in `finally`. Throw message names `--strict`.

- [ ] **Step 1: Failing test** — a workflow whose node-free body calls `Date.now()`; run with `strict:true` → exit 1 script_error, error mentions strict; run with `strict:false` → exit 0.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `withStrict(opts.strict, () => loaded.workflow(hooks, opts.args))` helper saving/restoring globals (mirror native's freeze-throw, scoped + restored). Keep it OUTSIDE the engine (run.ts only).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(cli): opt-in --strict determinism sandbox"`

---

# Phase 3 — CLI surface (expand each to full TDD steps at execution)

### Task 12: `--budget N` + `--strict` flags
**Files:** `src/cli/run.ts:18-26` (RunOptions: `+budget?: number; +strict: boolean`), `:32-81` (parseRunArgs), `:196` (thread budget into makeRuntime; strict into Task 11 wrap), `:286` (usage), `src/cli/omw.ts:31` (mirror usage). Test: `test/cli.run.test.ts`.
- `--budget`: copy the `--concurrency` case verbatim (run.ts:55-63), rename, message `--budget must be a positive integer, got: ${raw}`. `--strict`: copy the `--pretty` boolean case (run.ts:64-66). **Update BOTH usage strings** (run.ts:286 and omw.ts:31) — they are duplicated (gotcha). Test: parser asserts `value.budget`/`value.strict`; integration asserts a budget-loop workflow halts.
- Commit: `feat(cli): --budget and --strict flags`

### Task 13: `omw codemod` subcommand
**Files:** Create `src/cli/codemod.ts` (mirror `validate.ts` shape: pure `parseCodemodArgs` + `codemodCommand(argv, io: Io)`); `src/cli/omw.ts:6-9,18-38` (import + `case "codemod"` + usage line). Test: `test/cli.codemod.test.ts`.
- Two transforms (flags `--to-di` default, `--to-omw`): **(a) legacy→DI**: rewrite `export default async function (rt, args)` → `({ agent, parallel, pipeline, phase, log, workflow, budget }, args)` and `rt.X(` → `X(` (regex on the loaded source text; scope replacements to the default-export body). **(b) native→omw**: wrap ambient-global native body into `export default async function ({ ...hooks }, args) { <body> }`, convert top-level `return` (already valid inside the function), keep `export const meta`. Both are text transforms on a file the engineer passes; print to stdout or `--write`.
- Acceptance: round-trip a sample legacy fixture and a sample native script → output parses + runs under `--agent fake`. Exit 0 success / 1 failure / 2 usage.
- **Note:** the native→omw transform is the heaviest; if it grows, split into its own sub-plan. Start with `--to-di` (mechanical, high-value for the 0.4→0.5 migration) and land `--to-omw` second.
- Commit(s): `feat(cli): omw codemod --to-di` then `feat(cli): omw codemod --to-omw`.

### Task 14: `omw skill install --codex/--opencode`
**Files:** `src/cli/skill.ts:30-34` (SkillParse install variant `+ agent: "claude"|"codex"|"opencode"`), `:43-61` (parse loop recognizes `--codex`/`--opencode`), `:86-101` (per-agent dest dir map + message), `:36-41` (USAGE), `src/cli/omw.ts:34` (mirror). Test: `test/cli.skill.test.ts` (SkillIo homeDir/cwd overrides → temp dirs).
- Per-agent dest: claude=`<base>/.claude/skills/<name>`; codex→AGENTS.md target; opencode→its skills/config dir. Clean-replace stays (rmSync+cpSync) but each agent targets a DISTINCT dir (gotcha: don't wipe sibling installs).
- Commit: `feat(cli): cross-agent skill install (--codex/--opencode)`

---

# Phase 4 — Authoring product & positioning (content + proof)

### Task 15: Rewrite `skill/SKILL.md` for the new surface (content task)
**Acceptance:** teaches destructured-DI + bare calls + `meta` + budget/workflow/opts parity; cross-agent voice ("the authoring agent", not "Claude"); honest-scope section (node altitude, heuristic JSON, FS side-channel) retained; every code sample uses the new surface; the "Not implemented" list updated (budget/workflow/agentType/isolation now ARE implemented; `--strict` documented). Verify samples run: copy each SKILL.md code block into a temp workflow and run under `--agent fake`.
- Commit: `docs(skill): rewrite for destructured-DI surface + cross-agent`

### Task 16: README repositioning (content task)
**Acceptance:** new one-liner ("the open dynamic-workflow runtime"); native↔omw twin framing; magic-free differentiator paragraph (spec §5); migration note (0.4 bridge → 0.5; `omw codemod`); honest-scope intact. `--agent fake` quickstart still runs verbatim.
- Commit: `docs: reposition README as the open dynamic-workflow twin`

### Task 17: Conformance suite (drop-in proof)
**Files:** Create `conformance/{fanout,pipeline,budget-loop,nested-workflow,schema-gate,worktree-isolation,strict-throws}.ts` (each a new-surface workflow with a co-exported `fake`); `test/conformance.test.ts` runs each via `runWorkflow({agent:"fake"}, {loadWorkflow: async()=>mod, resolveAdapter:(_n,wf)=>({adapter:makeFakeAdapter(wf.fake)}), journalSink, now:()=>0, runId:()=>"t"})` and asserts `exitCode===0` + expected JSON. (budget-loop asserts halt; strict-throws run under a strict harness.)
- Acceptance: all green under `bun test test/conformance.test.ts`; documents that this IS the drop-in proof.
- Commit: `test(conformance): native-shaped scripts pass under --agent fake`

### Task 18: Version 0.4.0, CHANGELOG, CI provenance
**Files:** `package.json` (0.4.0), `CHANGELOG.md` (breaking authoring change + bridge→0.5 + new primitives + flags), `.github/workflows/ci.yml` (publish with `npm publish --provenance`). 
- Acceptance: `tsc --noEmit` + full `bun test` green; CHANGELOG lists every Phase 0–3 change; CI step added.
- Commit: `chore(release): 0.4.0 — open dynamic-workflow twin surface`

---

## Self-Review (done at authoring)

- **Spec coverage:** §1 strategy → Phase 0 framing + README (T16); §2 destructured DI + bridge → T1–T2; §3 primitives: args (already param), budget T3/T4/T8, workflow() T5, isolation T7, agentType/effort T6, meta T1, model precedence (T1 meta + T6 opts — note: implement precedence resolver inside invokeFresh/Task 6); §4 resume runId T10, semantic key T9, --strict T11; §5 naming/SKILL/README/codemod/versioning T13/T15/T16/T18; §6 conformance T17; §7 error handling folded into T2/T8/T13; §8 honest-scope kept in T15/T16. **Gap noted:** `meta.phases` per-phase model + the full model-precedence chain (`opts > phase > meta > default`) is implied by T1+T6 but has no dedicated task — add **Task 6b** at execution: resolve effective model in `invokeFresh` from that chain; test via two phases with different `meta.phases[].model`.
- **Placeholder scan:** none ("decide flag name … pick one and test it" in T6 is a real, scoped decision, not a TODO — the test pins whichever is chosen).
- **Type consistency:** `outputTokens` used identically across AgentResult/FakeResponse/account/budget; `WorkflowMeta`/`LoadedWorkflow.meta` consistent; `budget: { total, spent(), remaining() }` shape identical in T4 impl + T8 test + spec §3.
