// withWorktree against a REAL temp git repo: it must create an ephemeral
// worktree, run the body there, and remove it afterward when left unchanged.
// A non-git dir must fail closed rather than running an isolated node in place.

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

  test("a non-git dir fails closed without running the body", async () => {
    const plain = mkdtempSync(join(tmpdir(), "omw-plain-"));
    let ran = false;
    await expect(withWorktree(plain, async () => { ran = true; return null; })).rejects.toThrow("refusing to run");
    expect(ran).toBe(false);
  });

  test("cleanup failure does not replace a successful node result", async () => {
    const warns: string[] = [];
    let call = 0;
    const spawn = async () => {
      call += 1;
      if (call === 1) return { code: 0, stdout: "/repo\n", stderr: "" };
      if (call === 2) return { code: 0, stdout: "", stderr: "" };
      throw new Error("status failed");
    };

    expect(await withWorktree("/repo", async () => "ok", { spawn, warn: (m) => warns.push(m) })).toBe("ok");
    expect(warns.join("")).toContain("cleanup failed (status failed)");
  });
});
