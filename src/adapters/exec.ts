// Config-driven adapter for the simple "prompt in → response text out" coding-agent
// CLI shape. Every adapter repeats the same spawn / timeout / exit-code / parse
// boilerplate; this collapses it so a plain one-shot CLI is a few lines of config
// instead of a bespoke ~100-line file.
//
// Use a bespoke adapter (claude.ts, codex.ts) when a CLI has real quirks the
// generic shape can't carry: a JSON/JSONL envelope, in-session resume (`followUp`,
// which the schema gate uses for self-repair), a distinct refusal signal, or a
// cost field. This generic adapter has NO followUp on purpose — a config-only CLI
// that prints plain text has no session id to resume, so the schema gate falls
// back to fresh invokes (the documented no-followUp path).

import type { AgentPort, AgentResult, InvokeRequest } from "./types";
import type { ClaudeSpawn as Spawn, ClaudeSpawnResult as SpawnResult } from "./claude";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type ExecAdapterConfig = {
  /** Adapter name, surfaced as AgentResult source + in resolveAdapter. */
  name: string;
  /** Default binary; overridable via deps.bin. */
  bin: string;
  /** Build the args (after the bin) from the request. */
  argv: (req: { prompt: string; model?: string }) => string[];
  /** Turn stdout into the response text. Default: trimmed stdout. Returning an
   *  empty string is treated as "no output" (a terminal failure). */
  parse?: (stdout: string) => string;
};

export type ExecAdapterDeps = {
  spawn?: Spawn;
  /** Binary name/path; defaults to the config's `bin`. */
  bin?: string;
};

/** Shared spawn boilerplate (Bun.spawn + timeout kill + stdout/stderr capture).
 *  Exported so simple adapters reuse it instead of re-implementing it. */
export function defaultExecSpawn(bin: string): Spawn {
  return async (args, opts) => {
    const proc = Bun.spawn([bin, ...args], {
      cwd: opts?.cwd,
      stdin: "ignore", // one-shot mode; don't block waiting on stdin
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

/** Map a spawn result onto AgentResult for a plain-text CLI: parsed stdout IS the
 *  response. A timeout, non-zero exit, or empty parse is a terminal failure (no
 *  distinct refusal signal — a soft decline arrives as normal text). */
export function parseExecResult(res: SpawnResult, parse: (s: string) => string, name: string): AgentResult {
  if (res.timedOut) {
    return { ok: false, kind: "timeout", stderr: res.stderr || `${name} timed out`, meta: { durationMs: 0 } };
  }
  const text = parse(res.stdout).trim();
  if (res.code !== 0) {
    return {
      ok: false,
      kind: "nonzero_exit",
      stderr: res.stderr || text || `${name} exited ${res.code}`,
      meta: { durationMs: 0 },
    };
  }
  if (!text) {
    return { ok: false, kind: "nonzero_exit", stderr: res.stderr || `${name} produced no output`, meta: { durationMs: 0 } };
  }
  return { ok: true, text, meta: { durationMs: 0 } };
}

export function makeExecAdapter(config: ExecAdapterConfig, deps: ExecAdapterDeps = {}): AgentPort {
  const spawn = deps.spawn ?? defaultExecSpawn(deps.bin ?? config.bin);
  const parse = config.parse ?? ((s: string) => s);

  return {
    name: config.name,
    async invoke(req: InvokeRequest): Promise<AgentResult> {
      let res: SpawnResult;
      try {
        res = await spawn(config.argv({ prompt: req.prompt, model: req.model }), { cwd: req.cwd, timeoutMs: req.timeoutMs });
      } catch (e) {
        return { ok: false, kind: "spawn_failure", stderr: errMsg(e), meta: { durationMs: 0 } };
      }
      return parseExecResult(res, parse, config.name);
    },
    // No followUp: a plain-text CLI has no session id to resume — see header.
  };
}
