// Ephemeral git worktree per node, for `agent(prompt, { isolation: 'worktree' })`.
// When several nodes mutate files in parallel they would clobber each other in a
// shared checkout; giving each its own `git worktree` isolates them. The worktree
// is auto-removed when the node left it unchanged, and LEFT IN PLACE (with a warn)
// when it has changes, so a caller can inspect/merge them. A non-git cwd has no
// worktree to make — we run in place and warn rather than fail (honest-scope:
// isolation is best-effort, the null-contract still holds).

import { join } from "node:path";

export type GitSpawnResult = { code: number; stdout: string; stderr: string };
export type GitSpawn = (args: string[], cwd: string) => Promise<GitSpawnResult>;

export type WorktreeDeps = {
  /** Injected so the unit under test drives git without a subprocess; defaults
   *  to a real `git` over Bun.spawn. */
  spawn?: GitSpawn;
  warn?: (msg: string) => void;
};

function defaultGitSpawn(): GitSpawn {
  return async (args, cwd) => {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { code, stdout, stderr };
  };
}

// Per-process counter so concurrent worktrees get distinct dirs WITHOUT Date.now
// or Math.random (kept deterministic-friendly, mirroring the rest of the engine).
let wtCounter = 0;

/** Run `fn` with an ephemeral detached git worktree as its working directory,
 *  then clean up. Returns whatever `fn` returns. */
export async function withWorktree<T>(
  repoCwd: string,
  fn: (worktreeDir: string) => Promise<T>,
  deps: WorktreeDeps = {},
): Promise<T> {
  const spawn = deps.spawn ?? defaultGitSpawn();
  const warn = deps.warn ?? ((m: string) => console.error(m));

  const top = await spawn(["rev-parse", "--show-toplevel"], repoCwd);
  if (top.code !== 0) {
    warn(`omw(worktree): ${repoCwd} is not a git repo; running the node in place.`);
    return fn(repoCwd);
  }

  const dir = join(repoCwd, ".omw-worktrees", `wt-${process.pid}-${++wtCounter}`);
  const add = await spawn(["worktree", "add", "--detach", dir], repoCwd);
  if (add.code !== 0) {
    warn(`omw(worktree): \`git worktree add\` failed (${add.stderr.trim()}); running in place.`);
    return fn(repoCwd);
  }

  try {
    return await fn(dir);
  } finally {
    // Auto-remove only when the node left the worktree clean; otherwise keep it
    // so the changes aren't silently discarded.
    const status = await spawn(["status", "--porcelain"], dir);
    if (status.code === 0 && status.stdout.trim() === "") {
      await spawn(["worktree", "remove", "--force", dir], repoCwd);
    } else {
      warn(`omw(worktree): ${dir} has uncommitted changes; leaving it for inspection.`);
    }
  }
}
