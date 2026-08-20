import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CLI flushes a large JSON artifact before exiting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omw-entry-"));
  const workflow = join(dir, "workflow.ts");
  writeFileSync(workflow, 'export default async function () { return { blob: "x".repeat(2_000_000) }; }\n');

  const proc = Bun.spawn([process.execPath, "src/cli/omw.ts", "run", workflow, "--agent", "fake"], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(code).toBe(0);
  expect(JSON.parse(stdout).blob.length).toBe(2_000_000);
  expect(stderr).toContain("journal:");
});
