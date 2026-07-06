import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInSessionWorkflow } from "../src/in-session-run";

describe("runInSessionWorkflow", () => {
  test("returns exit 3 when no host callback exists (no CLI fallback)", async () => {
    const out = await runInSessionWorkflow(
      { wfPath: "examples/deep-research" },
      { probe: () => ({ ok: false, reason: "no host here" }) },
    );
    expect(out.exitCode).toBe(3);
    expect(out.error).toEqual({
      error: "in_session_unavailable",
      adapter: "in-session",
      install_hint: "no host here",
    });
  });

  test("runs green through a probed in-session adapter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omw-is-"));
    const wf = join(dir, "workflow.ts");
    writeFileSync(
      wf,
      `export default async function ({ agent }) {
        const v = await agent('ping', { schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } });
        return { v };
      }
      export const fake = { rules: [{ match: () => true, responses: [{ text: '{"ok":true}' }] }] };
      `,
    );

    const out = await runInSessionWorkflow(
      { wfPath: wf },
      {
        probe: () => ({
          ok: true,
          host: "test",
          adapter: {
            name: "in-session",
            async invoke() {
              return { ok: true, text: '{"ok":true}', meta: { durationMs: 1 } };
            },
          },
        }),
      },
    );

    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout!)).toEqual({ v: { ok: true } });
  });
});