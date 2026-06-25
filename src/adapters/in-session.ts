import type { AgentFailureKind, AgentPort, AgentResult, InvokeRequest } from "./types";

export type InSessionInvoke = (req: InvokeRequest) => Promise<unknown>;

export type InSessionAdapterOptions = {
  /** Adapter name surfaced in the journal. Use the host name when useful. */
  name?: string;
  /** Host-provided agent/subagent callback. This is the only host-specific part. */
  invoke: InSessionInvoke;
  now?: () => number;
  extractText?: (result: unknown) => string | undefined;
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

export function makeInSessionAdapter(opts: InSessionAdapterOptions): AgentPort {
  const now = opts.now ?? (() => Date.now());
  const extractText = opts.extractText ?? extractInSessionText;
  const classifyError = opts.classifyError ?? defaultClassifyError;

  const duration = (start: number): number => Math.max(0, now() - start);

  return {
    name: opts.name ?? "in-session",
    async invoke(req: InvokeRequest): Promise<AgentResult> {
      const start = now();
      try {
        const result = await opts.invoke(req);
        if (isAgentResult(result)) return result;

        const text = extractText(result)?.trim();
        if (!text) {
          return {
            ok: false,
            kind: "nonzero_exit",
            stderr: `in-session adapter returned no text: ${preview(result)}`,
            meta: { durationMs: duration(start) },
          };
        }
        return { ok: true, text, meta: { durationMs: duration(start) } };
      } catch (e) {
        return {
          ok: false,
          kind: classifyError(e),
          stderr: errMsg(e),
          meta: { durationMs: duration(start) },
        };
      }
    },
  };
}
