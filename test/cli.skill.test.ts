import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkillArgs, skillCommand, type SkillIo } from "../src/cli/skill";

const tmps: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function mkIo(over: Partial<SkillIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: SkillIo = { stdout: (s) => out.push(s), stderr: (s) => err.push(s), ...over };
  return { io, out: () => out.join(""), err: () => err.join("") };
}

/** A bundled-skill source dir holding a SKILL.md fixture. */
function srcDir(body = "SKILL BODY"): string {
  const d = tmp("omw-src-");
  writeFileSync(join(d, "SKILL.md"), body);
  return d;
}

describe("parseSkillArgs", () => {
  test("no args / help -> help", () => {
    expect(parseSkillArgs([])).toEqual({ ok: true, sub: "help" });
    expect(parseSkillArgs(["--help"])).toEqual({ ok: true, sub: "help" });
  });
  test("install default + --project", () => {
    expect(parseSkillArgs(["install"])).toEqual({ ok: true, sub: "install", project: false });
    expect(parseSkillArgs(["install", "--project"])).toEqual({ ok: true, sub: "install", project: true });
  });
  test("path takes no args", () => {
    expect(parseSkillArgs(["path"])).toEqual({ ok: true, sub: "path" });
    expect(parseSkillArgs(["path", "x"]).ok).toBe(false);
  });
  test("unknown subcommand / flag -> error", () => {
    expect(parseSkillArgs(["bogus"]).ok).toBe(false);
    expect(parseSkillArgs(["install", "--nope"]).ok).toBe(false);
  });
});

describe("skillCommand install", () => {
  test("installs into ~/.claude/skills/oh-my-workflow and reports 'installed', then 'updated' (idempotent)", async () => {
    const home = tmp("omw-home-");
    const skillDir = srcDir("BODY-V1");
    const dest = join(home, ".claude", "skills", "oh-my-workflow", "SKILL.md");

    const a = mkIo({ homeDir: home, skillDir });
    expect(await skillCommand(["install"], a.io)).toBe(0);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe("BODY-V1");
    expect(a.out()).toContain("installed");
    expect(a.out()).not.toContain("updated");

    // re-run is idempotent and refreshes content
    writeFileSync(join(skillDir, "SKILL.md"), "BODY-V2");
    const b = mkIo({ homeDir: home, skillDir });
    expect(await skillCommand(["install"], b.io)).toBe(0);
    expect(readFileSync(dest, "utf8")).toBe("BODY-V2");
    expect(b.out()).toContain("updated");
  });

  test("re-install is a clean replace — a file dropped from the bundle is removed", async () => {
    const home = tmp("omw-home-");
    const skillDir = srcDir("BODY");
    writeFileSync(join(skillDir, "extra.md"), "OLD RESOURCE");
    expect(await skillCommand(["install"], mkIo({ homeDir: home, skillDir }).io)).toBe(0);
    const destExtra = join(home, ".claude", "skills", "oh-my-workflow", "extra.md");
    expect(existsSync(destExtra)).toBe(true);

    // drop the resource from the source, re-install → stale copy must be gone
    rmSync(join(skillDir, "extra.md"));
    expect(await skillCommand(["install"], mkIo({ homeDir: home, skillDir }).io)).toBe(0);
    expect(existsSync(destExtra)).toBe(false);
    expect(existsSync(join(home, ".claude", "skills", "oh-my-workflow", "SKILL.md"))).toBe(true);
  });

  test("--project installs into ./.claude/skills, not home", async () => {
    const home = tmp("omw-home-");
    const cwd = tmp("omw-proj-");
    const skillDir = srcDir();
    expect(await skillCommand(["install", "--project"], mkIo({ homeDir: home, cwd, skillDir }).io)).toBe(0);
    expect(existsSync(join(cwd, ".claude", "skills", "oh-my-workflow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  test("path prints the bundled SKILL.md location", async () => {
    const skillDir = srcDir();
    const r = mkIo({ skillDir });
    expect(await skillCommand(["path"], r.io)).toBe(0);
    expect(r.out().trim()).toBe(join(skillDir, "SKILL.md"));
  });

  test("missing bundled skill -> exit 1 with a clear message", async () => {
    const emptyDir = tmp("omw-empty-");
    const r = mkIo({ skillDir: emptyDir, homeDir: tmp("omw-home-") });
    expect(await skillCommand(["install"], r.io)).toBe(1);
    expect(r.err()).toContain("not found");
  });

  test("help prints usage to stdout, exit 0", async () => {
    const r = mkIo();
    expect(await skillCommand([], r.io)).toBe(0);
    expect(r.out()).toContain("omw skill");
  });
});
