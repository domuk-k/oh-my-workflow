import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Check = { name: string; ok: boolean; detail?: string };

const root = process.cwd();
const landing = join(root, "dist", "docs", "index.html");
const docsPage = join(root, "dist", "docs", "docs", "index.html");
const skill = join(root, "skill", "SKILL.md");
const landingSource = join(root, "site", "src", "components", "Landing.astro");

const checks: Check[] = [];
const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

add("landing build output exists", existsSync(landing), landing);
add("docs page build output exists", existsSync(docsPage), docsPage);
add("skill exists", existsSync(skill), skill);

const html = [landing, docsPage].filter(existsSync).map((p) => readFileSync(p, "utf8")).join("\n");
const skillText = existsSync(skill) ? readFileSync(skill, "utf8") : "";
const landingText = existsSync(landingSource) ? readFileSync(landingSource, "utf8") : "";

for (const phrase of [
  "oh-my-workflow",
  "dynamic Workflow",
  "examples/deep-research",
  "--agent fake",
  "oh-my-workflow@0.5.0 skill install",
]) {
  add(`site contains: ${phrase}`, html.includes(phrase));
}

add("docs page has quickstart section", html.includes('id="quickstart"'));
add("site has no placeholder words", !/\b(TODO|TBD|lorem|placeholder)\b/i.test(html));
add("skill frontmatter exposes /omw", /^name:\s*omw\s*$/m.test(skillText));
add("skill teaches headless adapters", /--agent (auto|fake|claude)/.test(skillText));
add(
  "landing uses workflow args as the second parameter",
  landingText.includes('{"}"}<mark class="ins">, args</mark>)') && landingText.includes('<mark class="ins">args.</mark>topics'),
);

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "ok" : "fail"} - ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
}

if (failed.length > 0) {
  console.error(`docs check failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}
