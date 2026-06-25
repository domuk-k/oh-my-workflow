import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const out = join(process.cwd(), "dist", "docs");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(process.cwd(), "docs", "site"), out, { recursive: true });

console.log(`docs built -> ${out}`);
