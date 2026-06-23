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
}): Runtime {
  const { adapter, journal, resume } = deps;
  const limit = makeLimiter(deps.concurrency ?? 4);
  let callCounter = 0;
  let currentPhase: string | undefined;
  const budgetTotal = deps.budget ?? null;
  const budgetState: BudgetState = deps.budgetState ?? { spent: 0 };

  async function agent(prompt: string, opts: AgentOpts = {}): Promise<unknown | null> {
    const call = ++callCounter;
    const phase = opts.phase ?? currentPhase;
    const pHash = promptHash(prompt);
    const oHash = optsHash(opts);
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

    return limit(async () => {
      let durationMs = 0;
      const account = (r: AgentResult) => {
        durationMs += r.ok ? r.meta.durationMs : (r.meta?.durationMs ?? 0);
        if (r.ok) budgetState.spent += r.meta.outputTokens ?? 0;
      };
      // A fresh node invocation carrying this call's options. Built in one place
      // so the next InvokeRequest field is threaded once, not per call site.
      const invokeFresh = (p: string) =>
        adapter.invoke({
          prompt: p,
          model: opts.model,
          cwd: opts.cwd,
          timeoutMs: opts.timeoutMs,
          inheritMcp: opts.inheritMcp,
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
              cwd: opts.cwd,
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
