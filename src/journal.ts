// The journal is the product's spine: a JSONL record of every step, so the
// authoring agent can read its own failure and repair its own script. The format
// is resume-compatible — the resume key (callIndex, promptHash, optsHash) is the
// same longest-unchanged-prefix idea Claude Code uses, so v2 live-resume layers
// on without a format change. Hashes exclude wall-clock time on purpose.

import { createHash } from "node:crypto";

const sha256 = (s: string): string => "sha256:" + createHash("sha256").update(s).digest("hex");

/** Stable JSON: object keys sorted recursively so hashing is order-independent.
 *  undefined-valued keys are dropped (matching JSON.stringify) so that an
 *  explicitly-undefined optional field hashes identically to an absent one —
 *  otherwise the resume key drifts between behaviorally-identical opts. */
function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return "[" + value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const body = keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",");
  return "{" + body + "}";
}

export const promptHash = (prompt: string): string => sha256(prompt);
export const optsHash = (opts: unknown): string => sha256(stableStringify(opts ?? null));

export const resumeKey = (k: { call: number; promptHash: string; optsHash: string }): string =>
  `${k.call}:${k.promptHash}:${k.optsHash}`;

// ── events ────────────────────────────────────────────────────────────────────

export type JournalEvent =
  | { ev: "run_start"; run: string; wf?: string; args?: string; ts: number }
  | { ev: "phase"; title: string }
  | {
      ev: "agent_start";
      call: number;
      label?: string;
      phase?: string;
      adapter: string;
      promptHash: string;
      optsHash: string;
      ts: number;
    }
  | { ev: "attempt"; call: number; n: number; kind: string; errors?: string[]; stderr?: string; rawText?: string }
  | {
      ev: "agent_end";
      call: number;
      ok: boolean;
      kind?: string;
      result?: unknown;
      durationMs?: number;
      // Diagnostic payload so the authoring agent can read WHY a node failed:
      // adapter stderr, the node's raw non-conforming text, or an internal error.
      stderr?: string;
      rawText?: string;
      error?: string;
    }
  | { ev: "log"; msg: string }
  | { ev: "run_end"; ok: boolean; stats?: Record<string, unknown> };

export type Sink = (line: string) => void;

export type Journal = {
  runStart(e: { run: string; wf?: string; args?: string }): void;
  phase(title: string): void;
  agentStart(e: {
    call: number;
    label?: string;
    phase?: string;
    adapter: string;
    promptHash: string;
    optsHash: string;
  }): void;
  attempt(e: { call: number; n: number; kind: string; errors?: string[]; stderr?: string; rawText?: string }): void;
  agentEnd(e: {
    call: number;
    ok: boolean;
    kind?: string;
    result?: unknown;
    durationMs?: number;
    stderr?: string;
    rawText?: string;
    error?: string;
  }): void;
  log(msg: string): void;
  runEnd(e: { ok: boolean; stats?: Record<string, unknown> }): void;
  events(): JournalEvent[];
};

export function makeJournal(opts?: { sink?: Sink; now?: () => number }): Journal {
  const now = opts?.now ?? (() => Date.now());
  const sink = opts?.sink;
  const events: JournalEvent[] = [];

  const emit = (e: JournalEvent): void => {
    events.push(e);
    sink?.(JSON.stringify(e));
  };

  return {
    runStart: (e) => emit({ ev: "run_start", ts: now(), ...e }),
    phase: (title) => emit({ ev: "phase", title }),
    agentStart: (e) => emit({ ev: "agent_start", ts: now(), ...e }),
    attempt: (e) => emit({ ev: "attempt", ...e }),
    agentEnd: (e) => emit({ ev: "agent_end", ...e }),
    log: (msg) => emit({ ev: "log", msg }),
    runEnd: (e) => emit({ ev: "run_end", ...e }),
    events: () => events,
  };
}
