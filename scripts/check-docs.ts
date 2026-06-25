import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Check = { name: string; ok: boolean; detail?: string };

const root = process.cwd();
const site = join(root, "dist", "docs", "index.html");
const robots = join(root, "dist", "docs", "robots.txt");
const launch = join(root, "docs", "launch", "show-hn.md");
const skill = join(root, "skill", "SKILL.md");

const checks: Check[] = [];
const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

add("docs build output exists", existsSync(site), site);
add("robots.txt exists", existsSync(robots), robots);
add("launch note exists", existsSync(launch), launch);
add("skill exists", existsSync(skill), skill);

const html = existsSync(site) ? readFileSync(site, "utf8") : "";
const launchText = existsSync(launch) ? readFileSync(launch, "utf8") : "";
const skillText = existsSync(skill) ? readFileSync(skill, "utf8") : "";

for (const phrase of [
  "Give your coding agent a workflow mode.",
  "Add one command to your coding agent.",
  "Why now",
  "The whole runtime is seven hooks.",
  "Launch proof",
  "npx skills add domuk-k/oh-my-workflow --skill omw",
  "--agent auto",
]) {
  add(`site contains: ${phrase}`, html.includes(phrase));
}

for (const id of ["quickstart", "api", "patterns", "deploy"]) {
  add(`section id #${id}`, html.includes(`id="${id}"`));
  add(`nav href #${id}`, html.includes(`href="#${id}"`));
}

add("site has meta description", /<meta\s+name="description"\s+content="[^"]{80,180}"/.test(html));
add("site has accessible nav label", html.includes('aria-label="Primary navigation"'));
add("site has no placeholder words", !/\b(TODO|TBD|lorem|placeholder)\b/i.test(html + "\n" + launchText));
add("launch note has title", /^Title:\n\n> Show HN:/m.test(launchText));
add("launch note has skill install command", launchText.includes("npx skills add domuk-k/oh-my-workflow --skill omw"));
add("launch note explains why now", launchText.includes("Why now:"));
add("skill frontmatter exposes /omw", /^name:\s*omw\s*$/m.test(skillText));
add("skill teaches auto adapter", skillText.includes("--agent auto"));

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "ok" : "fail"} - ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
}

if (failed.length > 0) {
  console.error(`docs check failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
