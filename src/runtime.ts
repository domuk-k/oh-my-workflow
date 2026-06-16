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

export type AgentOpts = {
  label?: string;
  phase?: string;
  schema?: object;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

// `prev`/`item` are intentionally `any`: orchestration scripts are plain JS the
// host agent authors, so a stage may declare concrete param types (`x: number`)
// without fighting the type system. The runtime treats every value opaquely.
export type Stage = (prev: any, item: any, index: number) => unknown | Promise<unknown>;

export type Runtime = {
  agent(prompt: string, opts?: AgentOpts): Promise<unknown | null>;
  pipeline(items: unknown[], ...stages: Stage[]): Promise<unknown[]>;
  parallel(thunks: Array<() => Promise<unknown>>): Promise<unknown[]>;
  phase(title: string): void;
  log(msg: string): void;
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

function retryPrompt(original: string, feedback: GateFeedback, fresh: boolean): string {
  const note =
    "Your previous output failed validation:\n" +
    feedback.errors.map((e) => `- ${e}`).join("\n") +
    "\nReturn ONLY corrected JSON, no prose.";
  return fresh ? `${original}\n\n${note}` : note;
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
}): Runtime {
  const { adapter, journal, resume } = deps;
  const limit = makeLimiter(deps.concurrency ?? 4);
  let callCounter = 0;
  let currentPhase: string | undefined;

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
      };

      try {
        // No schema: one shot, raw text out (or null).
        if (!opts.schema) {
          let r: AgentResult;
          try {
            r = await adapter.invoke({
              prompt,
              model: opts.model,
              cwd: opts.cwd,
              timeoutMs: opts.timeoutMs,
            });
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
            r = await adapter.followUp(lastSessionId, retryPrompt(prompt, feedback, false));
          } else {
            const p = feedback ? retryPrompt(prompt, feedback, true) : prompt;
            r = await adapter.invoke({ prompt: p, model: opts.model, cwd: opts.cwd, timeoutMs: opts.timeoutMs });
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
  };
}
