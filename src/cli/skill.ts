// `omw skill <install|path>` — make "installed npm package" → "active authoring
// skill" one ergonomic step. The bundled skill/SKILL.md is the primary product:
// it teaches a coding agent to author, run, and repair omw workflows. `install`
// copies it into a coding agent's skills dir (auto-discovered by Claude Code);
// `path` prints the bundled copy's location for piping / pointing an agent at it.
//
// fs is reachable directly (this is the IO wiring command, like run.ts); the arg
// parse is a pure function so the contract is testable without touching disk.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root, so the bundled skill resolves whether omw runs from a clone or
 *  an npm install invoked from any cwd. (Same technique as run.ts's PKG_ROOT.) */
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILL_NAME = "oh-my-workflow";

export type SkillIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Overridable for tests; default to the real environment. */
  homeDir?: string;
  cwd?: string;
  /** Directory holding the bundled SKILL.md; defaults to <pkg>/skill. */
  skillDir?: string;
};

export type SkillAgent = "claude" | "codex" | "opencode";

export type SkillParse =
  | { ok: true; sub: "install"; project: boolean; agent: SkillAgent }
  | { ok: true; sub: "path" }
  | { ok: true; sub: "help" }
  | { ok: false; error: string };

const USAGE =
  "usage: omw skill <command>\n\n" +
  "commands:\n" +
  "  install [--project] [--codex|--opencode]\n" +
  "                        copy the skill into a coding agent's skills dir so it's picked up\n" +
  "                        (default agent: claude → ~/.claude/skills/oh-my-workflow;\n" +
  "                         --codex → ~/.codex/skills/…; --opencode → ~/.config/opencode/skills/…;\n" +
  "                         --project targets the cwd instead of home)\n" +
  "  path                  print the bundled SKILL.md path (for cat / piping / pointing an agent at it)\n";

export function parseSkillArgs(argv: string[]): SkillParse {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "help" || sub === "--help" || sub === "-h") {
    return { ok: true, sub: "help" };
  }
  if (sub === "path") {
    if (rest.length > 0) return { ok: false, error: `unexpected argument: ${rest[0]}` };
    return { ok: true, sub: "path" };
  }
  if (sub === "install") {
    let project = false;
    let agent: SkillAgent = "claude";
    for (const tok of rest) {
      if (tok === "--project") project = true;
      else if (tok === "--codex") agent = "codex";
      else if (tok === "--opencode") agent = "opencode";
      else return { ok: false, error: `unexpected argument: ${tok}` };
    }
    return { ok: true, sub: "install", project, agent };
  }
  return { ok: false, error: `unknown skill subcommand: ${sub}` };
}

/** Per-agent destination for the skill, each a DISTINCT dir so a clean-replace
 *  install never wipes a sibling agent's copy. */
function skillDest(agent: SkillAgent, root: string): { destDir: string; discovers: string } {
  switch (agent) {
    case "codex":
      return { destDir: join(root, ".codex", "skills", SKILL_NAME), discovers: "Codex" };
    case "opencode":
      return { destDir: join(root, ".config", "opencode", "skills", SKILL_NAME), discovers: "opencode" };
    case "claude":
      return { destDir: join(root, ".claude", "skills", SKILL_NAME), discovers: "Claude Code" };
  }
}

export async function skillCommand(argv: string[], io: SkillIo): Promise<number> {
  const parsed = parseSkillArgs(argv);
  if (!parsed.ok) {
    io.stderr(`${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.sub === "help") {
    io.stdout(USAGE);
    return 0;
  }

  const srcDir = io.skillDir ?? join(PKG_ROOT, "skill");
  const srcFile = join(srcDir, "SKILL.md");
  if (!existsSync(srcFile)) {
    io.stderr(`bundled skill not found at ${srcFile} — reinstall oh-my-workflow?\n`);
    return 1;
  }

  if (parsed.sub === "path") {
    io.stdout(`${srcFile}\n`);
    return 0;
  }

  // install — idempotent: copy the whole skill dir (SKILL.md + any bundled
  // resources) in place, and report installed vs updated. The destination is
  // per-agent and DISTINCT, so the clean-replace below never wipes a sibling.
  const root = parsed.project ? (io.cwd ?? process.cwd()) : (io.homeDir ?? homedir());
  const { destDir, discovers } = skillDest(parsed.agent, root);
  const dest = join(destDir, "SKILL.md");
  const updating = existsSync(dest);
  // Clean replace, not an additive copy: drop a prior install first so a file
  // that was removed from the bundle doesn't linger as stale content.
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });

  io.stdout(
    `${updating ? "updated" : "installed"} ${SKILL_NAME} skill → ${dest}\n` +
      `${parsed.project ? "This project's" : discovers} agent auto-discovers skills here.\n` +
      `Next: ask your coding agent to "use oh-my-workflow to <your task>".\n`,
  );
  return 0;
}
