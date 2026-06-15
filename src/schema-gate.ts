// The schema gate turns probabilistic node output into a validated object — or
// null. Extraction MUST be deterministic so the same text always yields the same
// result (the journal/resume model depends on it). Precedence:
//   1. the LAST fenced code block that parses as JSON, else
//   2. the LARGEST balanced-brace span that parses as JSON, else
//   3. undefined.

import Ajv from "ajv";
import type { AgentResult, AgentFailureKind } from "./adapters/types";

function tryParse(s: string): unknown | undefined {
  const t = s.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** Top-level balanced `{...}` substrings, ignoring braces inside string literals. */
function balancedBraceSpans(text: string): string[] {
  const spans: string[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < n; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    if (depth === 0 && j < n) {
      spans.push(text.slice(i, j + 1));
      i = j + 1;
    } else {
      i++; // never closed — skip this brace
    }
  }
  return spans;
}

export function extractJson(text: string): unknown | undefined {
  // 1) Fenced code blocks — last parseable wins.
  const fences = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  for (let i = fences.length - 1; i >= 0; i--) {
    const parsed = tryParse(fences[i] ?? "");
    if (parsed !== undefined) return parsed;
  }
  // 2) Largest balanced-brace span that parses.
  let best: { value: unknown; len: number } | undefined;
  for (const span of balancedBraceSpans(text)) {
    const parsed = tryParse(span);
    if (parsed !== undefined && (best === undefined || span.length > best.len)) {
      best = { value: parsed, len: span.length };
    }
  }
  return best?.value;
}

// ── validation ──────────────────────────────────────────────────────────────

export type Validation = { valid: boolean; errors: string[] };
export type ValidateFn = (value: unknown) => Validation;

/** Compile a JSON Schema into a reusable validate function (errors as strings). */
export function makeValidator(schema: object): ValidateFn {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);
  return (value: unknown): Validation => {
    const valid = validateFn(value) as boolean;
    const errors = (validateFn.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`.trim(),
    );
    return { valid, errors };
  };
}

// ── the retry loop ────────────────────────────────────────────────────────────

/** Why a single attempt ended. "ok" plus the terminal kinds we journal. */
export type AttemptKind = "ok" | "no_json" | "schema_violation" | AgentFailureKind;

export type GateAttempt = { n: number; kind: AttemptKind; errors?: string[]; stderr?: string; rawText?: string };

export type GateFeedback = { errors: string[]; rawText: string };

/** Produce one node result. `n` is 1-based; `feedback` is null on the first try.
 *  The runtime supplies this — it decides followUp (in-session) vs fresh+error. */
export type GateCall = (n: number, feedback: GateFeedback | null) => Promise<AgentResult>;

export type GateOutcome =
  | { ok: true; value: unknown }
  // On failure we carry the diagnostic payload up so the runtime can journal it:
  // adapter stderr for hard failures, the node's raw text for schema/no_json.
  | { ok: false; kind: Exclude<AttemptKind, "ok">; stderr?: string; rawText?: string };

/**
 * Run a node through the gate. Schema noise (no_json / schema_violation) is
 * retried up to `maxRetries` times; a hard adapter failure short-circuits with
 * its own kind. NEVER throws — exhaustion or error resolves to { ok:false }.
 */
export async function schemaGate(opts: {
  call: GateCall;
  validate: ValidateFn;
  maxRetries?: number;
  onAttempt?: (a: GateAttempt) => void;
}): Promise<GateOutcome> {
  const maxRetries = opts.maxRetries ?? 2;
  let feedback: GateFeedback | null = null;
  let lastKind: Exclude<AttemptKind, "ok"> = "schema_violation";
  let lastRawText: string | undefined;

  for (let n = 1; n <= maxRetries + 1; n++) {
    let result: AgentResult;
    try {
      result = await opts.call(n, feedback);
    } catch {
      opts.onAttempt?.({ n, kind: "spawn_failure" });
      return { ok: false, kind: "spawn_failure" };
    }

    if (!result.ok) {
      // Adapter-level failure is not schema noise — short-circuit, keep stderr.
      opts.onAttempt?.({ n, kind: result.kind, stderr: result.stderr });
      return { ok: false, kind: result.kind, stderr: result.stderr };
    }

    lastRawText = result.text;
    const extracted = extractJson(result.text);
    if (extracted === undefined) {
      lastKind = "no_json";
      opts.onAttempt?.({ n, kind: "no_json", rawText: result.text });
      feedback = { errors: ["output contained no extractable JSON"], rawText: result.text };
      continue;
    }

    const { valid, errors } = opts.validate(extracted);
    if (valid) {
      opts.onAttempt?.({ n, kind: "ok" });
      return { ok: true, value: extracted };
    }

    lastKind = "schema_violation";
    opts.onAttempt?.({ n, kind: "schema_violation", errors, rawText: result.text });
    feedback = { errors, rawText: result.text };
  }

  return { ok: false, kind: lastKind, rawText: lastRawText };
}
