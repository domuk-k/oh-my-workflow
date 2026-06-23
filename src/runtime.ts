// makeRuntime assembles the 5 hooks over an injected AgentPort + journal — this
// is the whole core. The orchestration script the host agent writes is plain JS;
// these hooks are the only surface it touches. The load-bearing invariant is the
// null-contract: agent() NEVER throws; a terminal failure resolves to null and a
// journal entry carrying the failure `kind`, so the authoring agent can read its
// own failure and repair its own script. Workflow patterns (filter(Boolean),
// abstain quorums) stand on top of that contract.

import type { AgentPort, AgentResult } from "./adapters/types";
import type { Journal } from "./journal";
import { promptHash, optsHash } from "./journal";
import type { ResumeIndex } from "./resume";
import { schemaGate, makeValidator, type GateCall, type GateFeedback } from "./schema-gate";
import { withWorktree as defaultWithWorktree } from "./worktree";

/** Optional `export const meta` a workflow can declare to describe itself and
 *  its phases. Mirrors native dynamic-workflow's meta block: a pure literal the
 *  loader reads for naming, phase titles, and per-phase/default model hints. */
export type WorkflowMeta = {
  name?: string;
  description?: string;
  whenToUse?: string;
  model?: string;
  phases?: Array<{ title: string; model?: string; detail?: string }>;
};

export type AgentOpts = {
  label?: string;
  phase?: string;
  schema?: object;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Inherit the host's MCP servers in this node (default false → isolated, fast). */
  inheritMcp?: boolean;
  /** Reasoning-effort hint for this node (adapter maps it where supported). */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Cross-vendor node profile (named agent persona) for this node. */
  agentType?: string;
  /** Run this node in a fresh ephemeral git worktree (cwd = the worktree), so
   *  parallel file-mutating nodes don't clobber each other. Best-effort: a
   *  non-git cwd runs in place with a warning. */
  isolation?: "worktree";
};

// `prev`/`item` are intentionally `any`: orchestration scripts are plain JS the
// host agent authors, so a stage may declare concrete param types (`x: number`)
// without fighting the type system. The runtime treats every value opaquely.
export type Stage = (prev: any, item: any, index: number) => unknown | Promise<unknown>;

/** Shared, mutable token-spend accumulator. Lives outside makeRuntime so a
 *  parent and any nested workflow() child can point at the SAME counter — the
 *  token pool is shared across the whole run, not per-runtime. */
export type BudgetState = { spent: number };

export type Runtime = {
  agent(prompt: string, opts?: AgentOpts): Promise<unknown | null>;
  pipeline(items: unknown[], ...stages: Stage[]): Promise<unknown[]>;
  parallel(thunks: Array<() => Promise<unknown>>): Promise<unknown[]>;
  phase(title: string): void;
  log(msg: string): void;
  /** Token budget view. `total` is the ceiling (null = unbounded); `spent()`
   *  reads the shared accumulator; `remaining()` is `total - spent` (Infinity
   *  when unbounded). The ceiling is enforced in agent() (BudgetExceededError). */
  budget: { total: number | null; spent(): number; remaining(): number };
};

/** Bounded-concurrency gate: at most `max` bodies run at once; the rest queue.
 *  Canonical counting-semaphore: a release HANDS its slot directly to the next
 *  waiter (active unchanged) rather than decrementing first — otherwise a fresh
 *  caller could slip past the `active >= max` check between the wake and the
 *  woken waiter resuming, pushing in-flight above `max` (a TOCTOU race). */
export function makeLimiter(max: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((res) => waiters.push(res)); // slot transferred to us
    } else {
      active++;
    }
    try {
      return await fn();
    } finally {
      const next = waiters.shift();
      if (next) next(); // hand our slot to the next waiter; active stays the same
      else active--;
    }
  };
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The semantic subset of a node's options — everything that changes WHAT the
 *  node computes, and nothing cosmetic. The resume key hashes only this, so a
 *  display-only change (label/phase) or a retry-policy tweak (timeoutMs/
 *  maxRetries) re-uses the cached result instead of needlessly re-running. The
 *  resolved model (after the opts>phase>meta chain) is passed in so a meta/phase
 *  model change still busts the cache even when opts.model is unset. */
function pickSemantic(opts: AgentOpts, model: string | undefined) {
  return {
    model,
    schema: opts.schema,
    effort: opts.effort,
    isolation: opts.isolation,
    agentType: opts.agentType,
    cwd: opts.cwd,
    inheritMcp: opts.inheritMcp,
  };
}

/** The ONE documented exception to the null-contract: when a token budget is set
 *  and already exhausted, agent() throws this instead of returning null, so a
 *  budget-bounded loop terminates instead of silently spinning out null nodes.
 *  It is thrown OUTSIDE the per-node try, so it propagates; a throw that lands
 *  inside parallel()/pipeline() is still swallowed to null (matches native). */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

// Cap the echoed prior output so a huge malformed dump can't blow the fresh prompt.
const RETRY_RAWTEXT_CAP = 4000;

function retryPrompt(original: string, feedback: GateFeedback, fresh: boolean): string {
  const note =
    "Your previous output failed validation:\n" +
    feedback.errors.map((e) => `- ${e}`).join("\n") +
    "\nReturn ONLY corrected JSON, no prose.";
  // In-session followUp (fresh=false): the prior attempt is still in the live
  // transcript, so the errors alone are enough. Fresh invoke (fresh=true): a
  // brand-new subprocess has NO memory of what it produced, so hand its own
  // non-conforming output back (capped) to repair against — otherwise it repairs
  // blind and tends to regress on a different field (the B6 whack-a-mole).
  if (!fresh) return note;
  const prior = feedback.rawText.trim();
  const echo = prior
    ? "\nYour previous output (fix THIS, do not start over):\n```\n" +
      (prior.length > RETRY_RAWTEXT_CAP ? prior.slice(0, RETRY_RAWTEXT_CAP) + "\n…(truncated)" : prior) +
      "\n```\n"
    : "";
  return `${original}${echo}\n${note}`;
}

export function makeRuntime(deps: {
  adapter: AgentPort;
  journal: Journal;
  concurrency?: number;
  /** A prior run's journal as a lookup. When a node's (call, promptHash,
   *  optsHash) key hits, the adapter is skipped and the cached result returned —
   *  the longest-unchanged-prefix resume model. A miss (incl. a prior failure)
   *  runs live, so resume only re-executes failed/changed nodes. */
  resume?: ResumeIndex;
  /** Token ceiling for the run (null/undefined = unbounded). */
  budget?: number | null;
  /** Shared spend accumulator. When omitted, a local one is created; a nested
   *  workflow() passes the parent's so the pool is shared across the run. */
  budgetState?: BudgetState;
  /** The workflow's meta, used to resolve the effective model per node along the
   *  `opts.model > phase model > meta.model` chain. */
  meta?: WorkflowMeta;
  /** Injected for isolation:'worktree'; defaults to the real git-backed helper.
   *  Overridable so the runtime is testable without a git subprocess. */
  withWorktree?: typeof defaultWithWorktree;
}): Runtime {
  const { adapter, journal, resume } = deps;
  const withWorktree = deps.withWorktree ?? defaultWithWorktree;
  const limit = makeLimiter(deps.concurrency ?? 4);
  let callCounter = 0;
  let currentPhase: string | undefined;
  const budgetTotal = deps.budget ?? null;
  const budgetState: BudgetState = deps.budgetState ?? { spent: 0 };

  // Effective model along the precedence chain opts > phase > meta default.
  // Resolved per node so a phase or meta default applies without the script
  // repeating `model` on every agent() call.
  const resolveModel = (opts: AgentOpts, phase: string | undefined): string | undefined => {
    if (opts.model !== undefined) return opts.model;
    // `?.` guards null/undefined but NOT a wrong type — an author typo like
    // `phases: "scan"` would make `.find` throw. Array.isArray closes that gap so
    // a malformed meta degrades to the default model instead of killing the run.
    const phases = deps.meta?.phases;
    const phaseModel = phase && Array.isArray(phases) ? phases.find((p) => p.title === phase)?.model : undefined;
    return phaseModel ?? deps.meta?.model;
  };

  async function agent(prompt: string, opts: AgentOpts = {}): Promise<unknown | null> {
    const call = ++callCounter;
    const phase = opts.phase ?? currentPhase;
    const model = resolveModel(opts, phase);
    const pHash = promptHash(prompt);
    const oHash = optsHash(pickSemantic(opts, model));
    journal.agentStart({
      call,
      label: opts.label,
      phase,
      adapter: adapter.name,
      promptHash: pHash,
      optsHash: oHash,
    });

    // Resume short-circuit: a hit skips the limiter + adapter entirely, but still
    // emits agent_end so every start has a matching end (the spine invariant).
    if (resume) {
      const hit = resume.lookup({ call, promptHash: pHash, optsHash: oHash });
      if (hit.found) {
        journal.agentEnd({ call, ok: true, result: hit.value, durationMs: 0, cached: true });
        return hit.value;
      }
    }

    // Budget ceiling: checked AFTER the resume short-circuit (a cached hit costs
    // nothing) and OUTSIDE limit()'s try, so it propagates as the one sanctioned
    // null-contract exception rather than being swallowed to null.
    if (budgetTotal != null && budgetState.spent >= budgetTotal) {
      throw new BudgetExceededError(`budget exhausted: ${budgetState.spent}/${budgetTotal} tokens`);
    }

    return limit(async () => {
      // The node body, parameterized by the effective working directory so an
      // isolation:'worktree' node runs the SAME logic with cwd = the worktree.
      const body = async (effCwd: string | undefined): Promise<unknown | null> => {
      let durationMs = 0;
      const account = (r: AgentResult) => {
        durationMs += r.ok ? r.meta.durationMs : (r.meta?.durationMs ?? 0);
        // Count tokens whether the node succeeded or failed: a failed node that
        // still reported `usage` (error/refusal envelope) consumed real budget,
        // so a loop on a failing node trips the ceiling instead of spinning.
        budgetState.spent += (r.ok ? r.meta.outputTokens : r.meta?.outputTokens) ?? 0;
      };
      // A fresh node invocation carrying this call's options. Built in one place
      // so the next InvokeRequest field is threaded once, not per call site.
      const invokeFresh = (p: string) =>
        adapter.invoke({
          prompt: p,
          model,
          cwd: effCwd,
          timeoutMs: opts.timeoutMs,
          inheritMcp: opts.inheritMcp,
          effort: opts.effort,
          agentType: opts.agentType,
        });

      try {
        // No schema: one shot, raw text out (or null).
        if (!opts.schema) {
          let r: AgentResult;
          try {
            r = await invokeFresh(prompt);
          } catch (e) {
            // A throw at the adapter boundary IS an adapter failure.
            journal.agentEnd({ call, ok: false, kind: "spawn_failure", stderr: errMsg(e), durationMs });
            return null;
          }
          account(r);
          if (r.ok) {
            journal.agentEnd({ call, ok: true, result: r.text, durationMs });
            return r.text;
          }
          journal.agentEnd({ call, ok: false, kind: r.kind, stderr: r.stderr, durationMs });
          return null;
        }

        // Schema path: gate retries node-level noise; followUp in-session if we
        // have a sessionId, else fresh+error. The authoring agent never sees this.
        const validate = makeValidator(opts.schema);
        let lastSessionId: string | undefined;
        const gateCall: GateCall = async (_n, feedback) => {
          let r: AgentResult;
          if (feedback && lastSessionId && adapter.followUp) {
            // Resume in the original cwd and with the same MCP choice, so the
            // repair turn runs in the same environment as the turn it continues.
            r = await adapter.followUp(lastSessionId, retryPrompt(prompt, feedback, false), {
              cwd: effCwd,
              inheritMcp: opts.inheritMcp,
            });
            // Resume can fail even when the format hiccup was recoverable (e.g. a
            // killed/expired session). Don't let a broken resume be terminal —
            // fall back to a fresh invoke with the error appended (the contract
            // AgentPort documents for the no-followUp case). Account the failed
            // resume too: it spawned a real subprocess, so its time is real cost.
            if (!r.ok) {
              account(r);
              r = await invokeFresh(retryPrompt(prompt, feedback, true));
            }
          } else {
            r = await invokeFresh(feedback ? retryPrompt(prompt, feedback, true) : prompt);
          }
          account(r);
          if (r.ok && r.meta.sessionId) lastSessionId = r.meta.sessionId;
          return r;
        };

        const outcome = await schemaGate({
          call: gateCall,
          validate,
          maxRetries: opts.maxRetries,
          onAttempt: (a) =>
            journal.attempt({ call, n: a.n, kind: a.kind, errors: a.errors, stderr: a.stderr, rawText: a.rawText }),
        });

        if (outcome.ok) {
          journal.agentEnd({ call, ok: true, result: outcome.value, durationMs });
          return outcome.value;
        }
        journal.agentEnd({
          call,
          ok: false,
          kind: outcome.kind,
          stderr: outcome.stderr,
          rawText: outcome.rawText,
          durationMs,
        });
        return null;
      } catch (e) {
        // Last-resort guard: the null-contract holds even on an unexpected throw
        // in OUR code (e.g. an invalid schema fails to compile). Labeled
        // internal_error — distinct from adapter failures — so the authoring
        // agent doesn't misread a schema bug as a flaky node.
        journal.agentEnd({ call, ok: false, kind: "internal_error", error: errMsg(e), durationMs });
        return null;
      }
      };

      // isolation:'worktree' gives the node its own ephemeral checkout as cwd;
      // otherwise it runs in the caller-provided cwd (or the process cwd).
      if (opts.isolation === "worktree") {
        return withWorktree(opts.cwd ?? process.cwd(), (wt) => body(wt));
      }
      return body(opts.cwd);
    });
  }

  // NOTE: parallel/pipeline do NOT acquire the limiter themselves — the limiter
  // is held at the agent() boundary (the heavy subprocess node). Wrapping these
  // combinators too would deadlock: their thunks call agent(), which would wait
  // for a slot the combinator already holds. Bounding cheap glue is a non-goal.
  async function parallel(thunks: Array<() => Promise<unknown>>): Promise<unknown[]> {
    return Promise.all(
      thunks.map((t, i) =>
        Promise.resolve()
          .then(t)
          .catch((e) => {
            journal.log(`parallel thunk ${i} threw: ${errMsg(e)}`);
            return null;
          }),
      ),
    );
  }

  async function pipeline(items: unknown[], ...stages: Stage[]): Promise<unknown[]> {
    return Promise.all(
      items.map(async (item, index) => {
        let acc: unknown = item;
        for (const stage of stages) {
          try {
            acc = await stage(acc, item, index);
          } catch (e) {
            journal.log(`pipeline item ${index} stage threw: ${errMsg(e)}`);
            return null;
          }
        }
        return acc;
      }),
    );
  }

  return {
    agent,
    parallel,
    pipeline,
    phase: (title: string) => {
      currentPhase = title;
      journal.phase(title);
    },
    log: (msg: string) => journal.log(msg),
    budget: {
      total: budgetTotal,
      spent: () => budgetState.spent,
      remaining: () => (budgetTotal == null ? Infinity : budgetTotal - budgetState.spent),
    },
  };
}
