// `omw skill <install|path>` — make "installed npm package" → "active authoring
// skill" one ergonomic step. The bundled skill/SKILL.md is the primary product:
// it teaches a coding agent to author, run, and repair omw workflows. `install`
// copies it into a coding agent's skills dir (auto-discovered by Claude Code);
// `path` prints the bundled copy's location for piping / pointing an agent at it.
//
// fs is reachable directly (this is the IO wiring command, like run.ts); the arg
// parse is a pure function so the contract is testable without touching disk.

import { cpSync, existsSync, mkdirSync } from "node:fs";
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

export type SkillParse =
  | { ok: true; sub: "install"; project: boolean }
  | { ok: true; sub: "path" }
  | { ok: true; sub: "help" }
  | { ok: false; error: string };

const USAGE =
  "usage: omw skill <command>\n\n" +
  "commands:\n" +
  "  install [--project]   copy the skill into a skills dir so a coding agent picks it up\n" +
  "                        (default: ~/.claude/skills/oh-my-workflow; --project: ./.claude/skills/…)\n" +
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
    for (const tok of rest) {
      if (tok === "--project") project = true;
      else return { ok: false, error: `unexpected argument: ${tok}` };
    }
    return { ok: true, sub: "install", project };
  }
  return { ok: false, error: `unknown skill subcommand: ${sub}` };
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
  // resources) in place, and report installed vs updated.
  const base = parsed.project ? join(io.cwd ?? process.cwd(), ".claude") : join(io.homeDir ?? homedir(), ".claude");
  const destDir = join(base, "skills", SKILL_NAME);
  const dest = join(destDir, "SKILL.md");
  const updating = existsSync(dest);
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });

  io.stdout(
    `${updating ? "updated" : "installed"} ${SKILL_NAME} skill → ${dest}\n` +
      `${parsed.project ? "This project's" : "Claude Code"} agent auto-discovers skills here.\n` +
      `Next: ask your coding agent to "use oh-my-workflow to <your task>".\n`,
  );
  return 0;
}
