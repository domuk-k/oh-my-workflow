import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const root = process.cwd();
const siteDir = join(root, "site");
const siteDist = join(siteDir, "dist");
const out = join(root, "dist", "docs");

if (!existsSync(siteDir)) {
  console.error("site workspace missing");
  process.exit(1);
}

await $`bun run build`.cwd(siteDir).quiet();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(siteDist, out, { recursive: true });

console.log(`docs built -> ${out} (from site/dist)`);