// The hermes adapter (EXPERIMENTAL). A node is a whole `hermes -z` (one-shot) run.
// `hermes -z/--oneshot <prompt>` prints ONLY the agent's final response text to
// stdout — no JSON envelope — so the result IS stdout; omw's schema-gate extracts
// JSON from it heuristically when a `schema` is set. `--yolo` runs the node
// non-interactively (a headless node can't answer tool-confirmation prompts).
//
// No in-session followUp: because `-z` prints ONLY the response, there is no
// session id on stdout to resume from. The schema gate therefore falls back to a
// fresh invoke with the validation error appended (the documented no-followUp
// path) — correct, just without context reuse. No cost field (text only).
//
// Modeled on the documented hermes 0.13.x CLI (`-z`, `-m`, `--resume`, `--yolo`).
// NOT yet live-verified end-to-end; the invoke path is the load-bearing one and
// degrades safely (a failed node abstains via the null-contract).

import type { AgentPort, AgentResult, InvokeRequest } from "./types";
import type { ClaudeSpawn as Spawn, ClaudeSpawnResult as SpawnResult } from "./claude";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type HermesAdapterDeps = {
  spawn?: Spawn;
  /** Binary name/path; defaults to "hermes" on PATH. */
  bin?: string;
};

function defaultSpawn(bin: string): Spawn {
  return async (args, opts) => {
    const proc = Bun.spawn([bin, ...args], {
      cwd: opts?.cwd,
      stdin: "ignore", // one-shot mode; don't let it block waiting on stdin
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

/** Map a `hermes -z` run onto AgentResult: stdout IS the response text. A
 *  non-zero exit or empty output is a terminal failure (no distinct refusal
 *  signal — like codex, a soft decline arrives as normal text). */
export function parseHermesResult(res: SpawnResult): AgentResult {
  if (res.timedOut) {
    return { ok: false, kind: "timeout", stderr: res.stderr || "hermes timed out", meta: { durationMs: 0 } };
  }
  const out = res.stdout.trim();
  if (res.code !== 0) {
    return {
      ok: false,
      kind: "nonzero_exit",
      stderr: res.stderr || out || `hermes exited ${res.code}`,
      meta: { durationMs: 0 },
    };
  }
  if (!out) {
    return { ok: false, kind: "nonzero_exit", stderr: res.stderr || "hermes produced no output", meta: { durationMs: 0 } };
  }
  return { ok: true, text: out, meta: { durationMs: 0 } };
}

export function makeHermesAdapter(deps: HermesAdapterDeps = {}): AgentPort {
  const spawn = deps.spawn ?? defaultSpawn(deps.bin ?? "hermes");

  async function run(args: string[], cwd?: string, timeoutMs?: number): Promise<AgentResult> {
    let res: SpawnResult;
    try {
      res = await spawn(args, { cwd, timeoutMs });
    } catch (e) {
      return { ok: false, kind: "spawn_failure", stderr: errMsg(e), meta: { durationMs: 0 } };
    }
    return parseHermesResult(res);
  }

  return {
    name: "hermes",
    invoke(req: InvokeRequest): Promise<AgentResult> {
      // `--yolo` so a headless node isn't blocked on tool-confirmation prompts.
      const args = ["-z", req.prompt, "--yolo"];
      if (req.model) args.push("-m", req.model);
      return run(args, req.cwd, req.timeoutMs);
    },
    // No followUp: `-z` emits only the response, so there's no session id to
    // resume. The schema gate falls back to fresh invokes (documented contract).
  };
}
