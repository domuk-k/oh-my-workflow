// withWorktree against a REAL temp git repo: it must create an ephemeral
// worktree, run the body there, and remove it afterward when left unchanged.
// A non-git dir must fall back to running in place with a warning.

import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withWorktree } from "../src/worktree";

async function git(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  await proc.exited;
}

async function makeRepo(): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), "omw-wt-"));
  await git(["init"], repo);
  await git(["config", "user.email", "t@t.dev"], repo);
  await git(["config", "user.name", "t"], repo);
  writeFileSync(join(repo, "f.txt"), "hi");
  await git(["add", "."], repo);
  await git(["commit", "-m", "init"], repo);
  return repo;
}

describe("withWorktree", () => {
  test("creates an ephemeral worktree, runs the body there, removes it when unchanged", async () => {
    const repo = await makeRepo();
    let captured = "";
    const ret = await withWorktree(repo, async (d) => {
      captured = d;
      expect(existsSync(d)).toBe(true);
      return readdirSync(d);
    });
    expect(captured).not.toBe(repo); // ran in a distinct dir
    expect(ret).toContain("f.txt"); // the worktree is a real checkout of the repo
    expect(existsSync(captured)).toBe(false); // removed after the body returned clean
  });

  test("a non-git dir runs the body in place and warns", async () => {
    const plain = mkdtempSync(join(tmpdir(), "omw-plain-"));
    const warns: string[] = [];
    let captured = "";
    await withWorktree(
      plain,
      async (d) => {
        captured = d;
        return null;
      },
      { warn: (m) => warns.push(m) },
    );
    expect(captured).toBe(plain); // fell back to running in place
    expect(warns.join("")).toContain("not a git repo");
  });
});
