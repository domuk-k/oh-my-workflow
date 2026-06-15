// loadWorkflow resolution: a path may be a workflow file directly, or a
// directory containing a conventional entry (workflow.ts / index.ts). The
// default export is the orchestration fn; `fake` fixtures ride alongside.

import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { loadWorkflow } from "../src/cli/run";

const FIX = join(import.meta.dir, "fixtures");

describe("loadWorkflow", () => {
  test("loads a workflow file directly and exposes default export + fake fixtures", async () => {
    const loaded = await loadWorkflow(join(FIX, "wf-ok.ts"));
    expect(typeof loaded.workflow).toBe("function");
    expect(loaded.fake).toEqual({ default: { text: "fixture-result" } });
  });

  test("resolves a directory to its conventional entry file", async () => {
    // FIX/wf-dir/ contains workflow.ts
    const loaded = await loadWorkflow(join(FIX, "wf-dir"));
    expect(typeof loaded.workflow).toBe("function");
  });

  test("throws when the module has no default export (script bug surfaced as load error)", async () => {
    await expect(loadWorkflow(join(FIX, "wf-nodefault.ts"))).rejects.toThrow();
  });
});
