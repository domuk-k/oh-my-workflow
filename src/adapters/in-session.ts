import type { AgentFailureKind, AgentPort, AgentResult, FollowUpOpts, InvokeRequest } from "./types";

/** Host invoke may carry a prior session id on follow-up turns. */
export type InSessionRequest = InvokeRequest & { sessionId?: string };

export type InSessionInvoke = (req: InSessionRequest) => Promise<unknown>;

export type InSessionAdapterOptions = {
  /** Adapter name surfaced in the journal. Use the host name when useful. */
  name?: string;
  /** Host-provided agent/subagent callback. This is the only host-specific part. */
  invoke: InSessionInvoke;
  now?: () => number;
  extractText?: (result: unknown) => string | undefined;
  extractOutputTokens?: (result: unknown) => number | undefined;
  classifyError?: (error: unknown) => AgentFailureKind;
};

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAgentResult(value: unknown): value is AgentResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (value.ok) {
    return typeof value.text === "string" && isRecord(value.meta) && typeof value.meta.durationMs === "number";
  }
  return typeof value.kind === "string";
}

function joinExtracted(values: unknown[], depth: number): string | undefined {
  const parts = values
    .map((v) => extractInSessionTextInner(v, depth + 1))
    .filter((v): v is string => Boolean(v?.trim()));
  return parts.length ? parts.join("\n\n") : undefined;
}

function extractInSessionTextInner(value: unknown, depth: number): string | undefined {
  if (depth > 8) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return joinExtracted(value, depth);
  if (!isRecord(value)) return undefined;

  if (typeof value.Text === "string") return value.Text;
  if ("Json" in value) {
    const fromJson = extractInSessionTextInner(value.Json, depth + 1);
    return fromJson ?? JSON.stringify(value.Json);
  }
  if (value.kind === "text" && typeof value.data === "string") return value.data;
  if (value.kind === "json" && "data" in value) {
    const fromData = extractInSessionTextInner(value.data, depth + 1);
    return fromData ?? JSON.stringify(value.data);
  }

  for (const key of ["summary", "text", "output", "response", "message"] as const) {
    if (typeof value[key] === "string") return value[key];
  }

  for (const key of ["result", "summary", "content", "data", "results", "items"] as const) {
    if (!(key in value)) continue;
    const nested = value[key];
    const extracted = extractInSessionTextInner(nested, depth + 1);
    if (extracted?.trim()) return extracted;
    if ((key === "result" || key === "summary") && isRecord(nested)) return JSON.stringify(nested);
  }

  return undefined;
}

export function extractInSessionText(value: unknown): string | undefined {
  return extractInSessionTextInner(value, 0);
}

export function extractInSessionOutputTokens(value: unknown, depth = 0): number | undefined {
  if (depth > 8 || !isRecord(value)) return undefined;
  for (const key of ["outputTokens", "output_tokens"] as const) {
    const tokens = value[key];
    if (typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0) return tokens;
  }
  for (const key of ["usage", "meta", "result", "data"] as const) {
    const tokens = extractInSessionOutputTokens(value[key], depth + 1);
    if (tokens !== undefined) return tokens;
  }
  return undefined;
}

function preview(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return String(value).slice(0, 1000);
  }
}

function defaultClassifyError(e: unknown): AgentFailureKind {
  const text = errMsg(e).toLowerCase();
  return text.includes("timeout") || text.includes("timed out") ? "timeout" : "nonzero_exit";
}

function extractSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["sessionId", "session_id", "convo_id", "convoId", "thread_id"] as const) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }
  for (const key of ["result", "meta", "data"] as const) {
    const nested = value[key];
    const sid = extractSessionId(nested);
    if (sid) return sid;
  }
  return undefined;
}

async function runInSession(
  opts: InSessionAdapterOptions,
  req: InSessionRequest,
  start: number,
  duration: (s: number) => number,
  extractText: (value: unknown) => string | undefined,
  classifyError: (e: unknown) => AgentFailureKind,
): Promise<AgentResult> {
  try {
    const result = await opts.invoke(req);
    if (isAgentResult(result)) {
      const outputTokens = (opts.extractOutputTokens ?? extractInSessionOutputTokens)(result);
      if (req.requireOutputTokens && outputTokens === undefined) {
        return {
          ok: false,
          kind: "nonzero_exit",
          stderr: "in-session host did not report output tokens; --budget is unsupported for this run",
          meta: { durationMs: duration(start) },
        };
      }
      if (outputTokens === undefined || result.meta?.outputTokens !== undefined) return result;
      return result.ok
        ? { ...result, meta: { ...result.meta, outputTokens } }
        : { ...result, meta: { durationMs: result.meta?.durationMs ?? duration(start), ...result.meta, outputTokens } };
    }

    const text = extractText(result)?.trim();
    if (!text) {
      return {
        ok: false,
        kind: "nonzero_exit",
        stderr: `in-session adapter returned no text: ${preview(result)}`,
        meta: { durationMs: duration(start) },
      };
    }
    const sessionId = extractSessionId(result);
    const outputTokens = (opts.extractOutputTokens ?? extractInSessionOutputTokens)(result);
    if (req.requireOutputTokens && outputTokens === undefined) {
      return {
        ok: false,
        kind: "nonzero_exit",
        stderr: "in-session host did not report output tokens; --budget is unsupported for this run",
        meta: { durationMs: duration(start) },
      };
    }
    return { ok: true, text, meta: { durationMs: duration(start), sessionId, outputTokens } };
  } catch (e) {
    return {
      ok: false,
      kind: classifyError(e),
      stderr: errMsg(e),
      meta: { durationMs: duration(start) },
    };
  }
}

export function makeInSessionAdapter(opts: InSessionAdapterOptions): AgentPort {
  const now = opts.now ?? (() => Date.now());
  const extractText = opts.extractText ?? extractInSessionText;
  const classifyError = opts.classifyError ?? defaultClassifyError;

  const duration = (start: number): number => Math.max(0, now() - start);

  return {
    name: opts.name ?? "in-session",
    async invoke(req: InvokeRequest): Promise<AgentResult> {
      return runInSession(opts, req, now(), duration, extractText, classifyError);
    },
    async followUp(sessionId: string, prompt: string, followOpts?: FollowUpOpts): Promise<AgentResult> {
      return runInSession(
        opts,
        {
          prompt,
          sessionId,
          cwd: followOpts?.cwd,
          inheritMcp: followOpts?.inheritMcp,
          timeoutMs: followOpts?.timeoutMs,
          requireOutputTokens: followOpts?.requireOutputTokens,
          model: followOpts?.model,
        },
        now(),
        duration,
        extractText,
        classifyError,
      );
    },
  };
}
