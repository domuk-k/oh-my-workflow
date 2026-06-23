// The claude adapter: a node is a whole `claude -p` run, not a single LLM call.
// It shells out to `claude -p <prompt> --output-format json`, parses the single
// JSON result object, and renames claude's snake_case fields onto our AgentResult
// contract (session_id→sessionId, total_cost_usd→costUsd, duration_ms→durationMs;
// is_error/subtype collapse to ok:false). followUp uses `--resume <sessionId>` to
// continue the same session for schema-gate self-repair.
//
// Spawn is injected so the parse/argv logic is tested without a subprocess or an
// API call; the default spawn uses Bun.spawn and is exercised live under OMW_LIVE.

import type { AgentPort, AgentResult, FollowUpOpts, InvokeRequest } from "./types";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Map a parsed `claude -p --output-format json` payload onto AgentResult. A
 *  non-"result" type, is_error, or a non-success subtype all collapse to a
 *  terminal failure with the subtype + model message surfaced for the journal. */
export function parseClaudeResult(raw: unknown): AgentResult {
  const j = raw as Record<string, unknown> | null;
  const durationMs = Number(j?.duration_ms) || 0;

  // A safety/decline refusal (stop_reason "refusal") is a journaled DECLINE — not
  // a crash, and not a real answer. Classify it FIRST, before the is_error/subtype
  // envelope checks, so a decline that arrives as subtype:"success" isn't mistaken
  // for an empty success. Carrier per the API docs is stop_reason; subtype is
  // matched defensively. The decline category (stop_details.category) is journaled
  // so the reason stays auditable. Not yet verified against a live CLI refusal.
  if (j?.stop_reason === "refusal" || j?.subtype === "refusal") {
    const detail = typeof j?.result === "string" ? j.result : "";
    const sd = j?.stop_details as { category?: unknown } | undefined;
    const category = typeof sd?.category === "string" ? sd.category : "";
    return {
      ok: false,
      kind: "refusal",
      stderr: `refusal${category ? `(${category})` : ""}: ${detail}`.trim(),
      meta: { durationMs },
    };
  }

  if (!j || j.type !== "result" || j.is_error === true || j.subtype !== "success") {
    const subtype = (j?.subtype ?? j?.type ?? "unknown") as string;
    const detail = typeof j?.result === "string" ? j.result : "";
    return { ok: false, kind: "nonzero_exit", stderr: `${subtype}: ${detail}`.trim(), meta: { durationMs } };
  }

  return {
    ok: true,
    text: String(j.result ?? ""),
    meta: {
      durationMs,
      sessionId: j.session_id as string | undefined,
      costUsd: j.total_cost_usd as number | undefined,
      outputTokens: (j.usage as { output_tokens?: number } | undefined)?.output_tokens,
    },
  };
}

export type ClaudeSpawnResult = { code: number; stdout: string; stderr: string; timedOut?: boolean };
export type ClaudeSpawn = (
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
) => Promise<ClaudeSpawnResult>;

export type ClaudeAdapterDeps = {
  spawn?: ClaudeSpawn;
  /** Binary name/path; defaults to "claude" on PATH. */
  bin?: string;
  /** Diagnostic sink for honest-scope notices (e.g. an opt with no faithful CLI
   *  flag was dropped). Defaults to console.error. */
  warn?: (msg: string) => void;
};

/** Default spawn over Bun.spawn. Kills the child after timeoutMs and flags it so
 *  the result maps to a `timeout` kind rather than a generic nonzero exit. */
function defaultSpawn(bin: string): ClaudeSpawn {
  return async (args, opts) => {
    const proc = Bun.spawn([bin, ...args], {
      cwd: opts?.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts?.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, opts.timeoutMs);
    }
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (timer) clearTimeout(timer);
    return { code, stdout, stderr, timedOut };
  };
}

export function makeClaudeAdapter(deps: ClaudeAdapterDeps = {}): AgentPort {
  const spawn = deps.spawn ?? defaultSpawn(deps.bin ?? "claude");
  const warn = deps.warn ?? ((m: string) => console.error(m));
  // One-time per field: claude -p has no faithful flag for these yet, so they are
  // dropped rather than silently honored. Warn once so a fan-out isn't spammed.
  const warnedFields = new Set<string>();
  const warnUnmapped = (field: string, value: unknown) => {
    if (warnedFields.has(field)) return;
    warnedFields.add(field);
    warn(`omw(claude): \`${field}\` (=${String(value)}) has no claude -p flag; dropped for this run.`);
  };

  async function run(args: string[], cwd?: string, timeoutMs?: number): Promise<AgentResult> {
    let res: ClaudeSpawnResult;
    try {
      res = await spawn(args, { cwd, timeoutMs });
    } catch (e) {
      // A throw at the spawn boundary IS an adapter failure (e.g. ENOENT).
      return { ok: false, kind: "spawn_failure", stderr: errMsg(e), meta: { durationMs: 0 } };
    }

    if (res.timedOut) {
      return { ok: false, kind: "timeout", stderr: res.stderr || `timed out after ${timeoutMs}ms`, meta: { durationMs: 0 } };
    }
    if (res.code !== 0) {
      return {
        ok: false,
        kind: "nonzero_exit",
        stderr: res.stderr || res.stdout || `claude exited ${res.code}`,
        meta: { durationMs: 0 },
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(res.stdout);
    } catch {
      return {
        ok: false,
        kind: "nonzero_exit",
        stderr: `unparseable claude output: ${res.stdout.slice(0, 200)}`,
        meta: { durationMs: 0 },
      };
    }
    return parseClaudeResult(json);
  }

  return {
    name: "claude",
    invoke(req: InvokeRequest): Promise<AgentResult> {
      const args = ["-p", req.prompt, "--output-format", "json"];
      if (req.model) args.push("--model", req.model);
      if (req.effort !== undefined) warnUnmapped("effort", req.effort);
      if (req.agentType !== undefined) warnUnmapped("agentType", req.agentType);
      // Isolate the node from the host's MCP servers unless asked otherwise:
      // booting figma/devtools/etc. on every node is the dominant fan-out latency.
      if (!req.inheritMcp) args.push("--strict-mcp-config");
      return run(args, req.cwd, req.timeoutMs);
    },
    // `cwd` must match the original invoke — claude keys session history by
    // project directory, so resuming elsewhere yields "No conversation found".
    // MCP isolation must mirror the original invoke so the resume turn sees the
    // same environment as the turn it continues.
    followUp(sessionId: string, prompt: string, opts?: FollowUpOpts): Promise<AgentResult> {
      const args = ["-p", prompt, "--resume", sessionId, "--output-format", "json"];
      if (!opts?.inheritMcp) args.push("--strict-mcp-config");
      return run(args, opts?.cwd);
    },
  };
}
