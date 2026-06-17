// The codex adapter (EXPERIMENTAL). A node is a whole `codex exec` run. codex
// streams its result as JSONL dot-notation events on stdout:
//   thread.started{thread_id} → turn.started → item.completed{item:agent_message}
//   → turn.completed{usage}
// We take the LAST agent_message's text as the result and thread_id as the
// sessionId (for `exec resume` follow-ups). There is no cost field (tokens only),
// so costUsd stays undefined.
//
// Per openai/codex#15451 the stream can include malformed lines; parseCodexJsonl
// tolerates them line-by-line and, if no final agent_message is found, fails
// ACTIONABLY (surfaces the reason) rather than silently returning empty — the
// authoring agent can read WHY in the journal.

import type { AgentPort, AgentResult, FollowUpOpts, InvokeRequest } from "./types";
import type { ClaudeSpawn as Spawn, ClaudeSpawnResult as SpawnResult } from "./claude";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function parseCodexJsonl(stdout: string): AgentResult {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  let threadId: string | undefined;
  let lastMessage: string | undefined;
  let failure: string | undefined;
  let malformed = 0;

  for (const line of lines) {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      malformed++; // #15451 tolerance — skip junk, keep parsing
      continue;
    }
    switch (ev.type) {
      case "thread.started":
        threadId = ev.thread_id as string | undefined;
        break;
      case "item.completed": {
        const item = ev.item as { type?: string; text?: string } | undefined;
        if (item?.type === "agent_message" && typeof item.text === "string") lastMessage = item.text;
        break;
      }
      case "error":
        failure = typeof ev.message === "string" ? ev.message : JSON.stringify(ev);
        break;
      case "turn.failed": {
        const err = ev.error as { message?: string } | undefined;
        failure = failure ?? err?.message ?? "turn failed";
        break;
      }
    }
  }

  if (failure) {
    // No refusal kind for codex: its stream has no distinct decline signal. A
    // hard failure (`error` / `turn.failed`) is nonzero_exit; a SOFT decline
    // ("I can't help with that") instead arrives as a normal agent_message and
    // returns ok:true below — an invisible abstention we can't tell from a real
    // answer here. So codex declines are NOT nonzero_exit; refusal is claude-only.
    return { ok: false, kind: "nonzero_exit", stderr: `codex: ${failure}`, meta: { durationMs: 0 } };
  }
  if (lastMessage === undefined) {
    const hint = malformed > 0 ? ` (${malformed} malformed JSONL line(s))` : "";
    return {
      ok: false,
      kind: "nonzero_exit",
      stderr: `codex produced no agent_message${hint}`,
      meta: { durationMs: 0 },
    };
  }
  return { ok: true, text: lastMessage, meta: { durationMs: 0, sessionId: threadId } };
}

export type CodexAdapterDeps = {
  spawn?: Spawn;
  bin?: string;
  /** codex sandbox policy. Defaults to workspace-write (a coding node needs to
   *  write); override to read-only for safe demos or danger-full-access. */
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
};

function defaultSpawn(bin: string): Spawn {
  return async (args, opts) => {
    const proc = Bun.spawn([bin, ...args], {
      cwd: opts?.cwd,
      stdin: "ignore", // codex reads stdin otherwise and hangs waiting for EOF
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

export function makeCodexAdapter(deps: CodexAdapterDeps = {}): AgentPort {
  const spawn = deps.spawn ?? defaultSpawn(deps.bin ?? "codex");
  const sandbox = deps.sandbox ?? "workspace-write";

  async function run(args: string[], cwd?: string, timeoutMs?: number): Promise<AgentResult> {
    let res: SpawnResult;
    try {
      res = await spawn(args, { cwd, timeoutMs });
    } catch (e) {
      return { ok: false, kind: "spawn_failure", stderr: errMsg(e), meta: { durationMs: 0 } };
    }
    if (res.timedOut) {
      return { ok: false, kind: "timeout", stderr: res.stderr || `timed out after ${timeoutMs}ms`, meta: { durationMs: 0 } };
    }
    if (!res.stdout.trim()) {
      // No JSONL at all → fall back to the process-level failure.
      return {
        ok: false,
        kind: "nonzero_exit",
        stderr: res.stderr || `codex exited ${res.code} with no output`,
        meta: { durationMs: 0 },
      };
    }
    // JSONL present (even on a non-zero exit, e.g. turn.failed) → let the parser
    // decide ok/fail and surface the reason.
    return parseCodexJsonl(res.stdout);
  }

  return {
    name: "codex",
    invoke(req: InvokeRequest): Promise<AgentResult> {
      const args = ["exec", "--json", "-s", sandbox];
      if (req.model) args.push("-m", req.model);
      args.push(req.prompt);
      return run(args, req.cwd, req.timeoutMs);
    },
    // `cwd` must match the original invoke so resume finds the session.
    // (MCP isolation / inheritHostMcp is not yet implemented for codex.)
    followUp(sessionId: string, prompt: string, opts?: FollowUpOpts): Promise<AgentResult> {
      const args = ["exec", "resume", sessionId, "--json", "-s", sandbox, prompt];
      return run(args, opts?.cwd);
    },
  };
}
