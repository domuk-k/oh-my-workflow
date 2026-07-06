import type { AgentPort, AgentResult, FollowUpOpts, InvokeRequest } from "./types";
import type { InSessionRequest } from "./in-session";

export type KiroSubagentConfig = {
  query: string;
  agent_name?: string;
  relevant_context?: string;
  dangerously_trust_all_tools?: boolean;
  is_interactive?: boolean;
  convo_id?: string;
};

export type KiroSubagentToolRequest =
  | { command: "ListAgents" }
  | { command: "InvokeSubagents"; content: { subagents: KiroSubagentConfig[] } };

export type KiroSubagentTool = (req: KiroSubagentToolRequest) => Promise<unknown>;

export type KiroInSessionAdapterOptions = {
  /** The Kiro host's internal use_subagent/subagent tool callback. When omitted,
   *  the adapter looks for globalThis.use_subagent or globalThis.subagent. */
  tool?: KiroSubagentTool | null;
  name?: string;
  agentName?: string;
  trustAllTools?: boolean;
  interactive?: boolean;
  convoId?: string | ((req: InvokeRequest) => string | undefined);
  relevantContext?: string | ((req: InvokeRequest) => string | undefined);
  now?: () => number;
  extractText?: (result: unknown) => string | undefined;
};

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compact(parts: Array<string | undefined>): string | undefined {
  const body = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return body.length ? body.join("\n") : undefined;
}

function resolveMaybeFn<T>(value: T | ((req: InvokeRequest) => T), req: InvokeRequest): T {
  return typeof value === "function" ? (value as (r: InvokeRequest) => T)(req) : value;
}

/** True when the current process is a Kiro host that exposes subagent tooling. */
export function detectKiroSubagentTool(): KiroSubagentTool | undefined {
  const g = globalThis as typeof globalThis & {
    use_subagent?: unknown;
    subagent?: unknown;
  };
  const candidate = g.use_subagent ?? g.subagent;
  return typeof candidate === "function" ? (candidate as KiroSubagentTool) : undefined;
}

export function buildKiroSubagentRequest(
  req: InSessionRequest,
  opts: Pick<
    KiroInSessionAdapterOptions,
    "agentName" | "trustAllTools" | "interactive" | "convoId" | "relevantContext"
  > = {},
): KiroSubagentToolRequest {
  const subagent: KiroSubagentConfig = {
    query: req.prompt,
  };
  const agentName = req.agentType ?? opts.agentName;
  if (agentName) subagent.agent_name = agentName;
  if (opts.trustAllTools !== undefined) subagent.dangerously_trust_all_tools = opts.trustAllTools;
  if (opts.interactive !== undefined) subagent.is_interactive = opts.interactive;
  const sessionConvo = req.sessionId;
  if (sessionConvo) {
    subagent.convo_id = sessionConvo;
  } else if (opts.convoId !== undefined) {
    const convoId = resolveMaybeFn(opts.convoId, req);
    if (convoId) subagent.convo_id = convoId;
  }

  const explicitContext = opts.relevantContext === undefined ? undefined : resolveMaybeFn(opts.relevantContext, req);
  const requestContext = compact([
    explicitContext,
    req.cwd ? `cwd: ${req.cwd}` : undefined,
    req.model ? `model: ${req.model}` : undefined,
    req.effort ? `effort: ${req.effort}` : undefined,
  ]);
  if (requestContext) subagent.relevant_context = requestContext;

  return { command: "InvokeSubagents", content: { subagents: [subagent] } };
}

function joinExtracted(values: unknown[], depth: number): string | undefined {
  const parts = values
    .map((v) => extractKiroSubagentTextInner(v, depth + 1))
    .filter((v): v is string => Boolean(v?.trim()));
  return parts.length ? parts.join("\n\n") : undefined;
}

function extractKiroSubagentTextInner(value: unknown, depth: number): string | undefined {
  if (depth > 8) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return joinExtracted(value, depth);
  if (!isRecord(value)) return undefined;

  if (typeof value.Text === "string") return value.Text;
  if ("Json" in value) {
    const fromJson = extractKiroSubagentTextInner(value.Json, depth + 1);
    return fromJson ?? JSON.stringify(value.Json);
  }
  if (value.kind === "text" && typeof value.data === "string") return value.data;
  if (value.kind === "json" && "data" in value) {
    const fromData = extractKiroSubagentTextInner(value.data, depth + 1);
    return fromData ?? JSON.stringify(value.data);
  }

  for (const key of ["summary", "text", "output", "response", "message"] as const) {
    if (typeof value[key] === "string") return value[key];
  }

  for (const key of ["result", "summary", "content", "data", "results", "subagents", "items"] as const) {
    if (!(key in value)) continue;
    const nested = value[key];
    const extracted = extractKiroSubagentTextInner(nested, depth + 1);
    if (extracted?.trim()) return extracted;
    if ((key === "result" || key === "summary") && isRecord(nested)) return JSON.stringify(nested);
  }

  return undefined;
}

export function extractKiroSubagentText(value: unknown): string | undefined {
  return extractKiroSubagentTextInner(value, 0);
}

function preview(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return String(value).slice(0, 1000);
  }
}

class KiroSubagentTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`kiro subagent timed out after ${timeoutMs}ms`);
    this.name = "KiroSubagentTimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new KiroSubagentTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractKiroSessionId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["convo_id", "convoId", "sessionId", "session_id"] as const) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }
  for (const key of ["result", "subagents", "content", "data"] as const) {
    const nested = value[key];
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const sid = extractKiroSessionId(item);
        if (sid) return sid;
      }
    } else {
      const sid = extractKiroSessionId(nested);
      if (sid) return sid;
    }
  }
  return undefined;
}

async function runKiroNode(
  req: InSessionRequest,
  opts: KiroInSessionAdapterOptions,
  tool: KiroSubagentTool,
  start: number,
  duration: (s: number) => number,
  extractText: (value: unknown) => string | undefined,
): Promise<AgentResult> {
  try {
    const kiroReq = buildKiroSubagentRequest(req, opts);
    const result = await withTimeout(tool(kiroReq), req.timeoutMs);
    const text = extractText(result)?.trim();
    if (!text) {
      return {
        ok: false,
        kind: "nonzero_exit",
        stderr: `kiro subagent returned no text: ${preview(result)}`,
        meta: { durationMs: duration(start) },
      };
    }
    const sessionId = extractKiroSessionId(result) ?? req.sessionId;
    return { ok: true, text, meta: { durationMs: duration(start), sessionId } };
  } catch (e) {
    return {
      ok: false,
      kind: e instanceof KiroSubagentTimeoutError ? "timeout" : "nonzero_exit",
      stderr: errMsg(e),
      meta: { durationMs: duration(start) },
    };
  }
}

export function makeKiroInSessionAdapter(opts: KiroInSessionAdapterOptions = {}): AgentPort {
  const now = opts.now ?? (() => Date.now());
  const extractText = opts.extractText ?? extractKiroSubagentText;

  const duration = (start: number): number => Math.max(0, now() - start);

  const resolveTool = (): KiroSubagentTool | undefined => {
    const tool = opts.tool === undefined ? detectKiroSubagentTool() : opts.tool;
    return tool ?? undefined;
  };

  return {
    name: opts.name ?? "kiro-in-session",
    async invoke(req: InvokeRequest): Promise<AgentResult> {
      const start = now();
      const tool = resolveTool();
      if (!tool) {
        return {
          ok: false,
          kind: "spawn_failure",
          stderr: "Kiro subagent tool is not available. Provide opts.tool or run in a host that exposes use_subagent/subagent.",
          meta: { durationMs: duration(start) },
        };
      }
      return runKiroNode(req, opts, tool, start, duration, extractText);
    },
    async followUp(sessionId: string, prompt: string, followOpts?: FollowUpOpts): Promise<AgentResult> {
      const start = now();
      const tool = resolveTool();
      if (!tool) {
        return {
          ok: false,
          kind: "spawn_failure",
          stderr: "Kiro subagent tool is not available. Provide opts.tool or run in a host that exposes use_subagent/subagent.",
          meta: { durationMs: duration(start) },
        };
      }
      return runKiroNode(
        {
          prompt,
          sessionId,
          cwd: followOpts?.cwd,
          inheritMcp: followOpts?.inheritMcp,
          timeoutMs: followOpts?.timeoutMs,
        },
        opts,
        tool,
        start,
        duration,
        extractText,
      );
    },
  };
}
