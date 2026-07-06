// Conformance: the drop-in proof. Each conformance/*.ts is a native-shaped,
// destructured-DI workflow with a co-exported `fake`. Running them all green
// under `--agent fake` is the evidence that the open twin's surface behaves —
// fan-out, pipeline, schema gate, budget ceiling, and the --strict sandbox.
//
// They load through the REAL loadWorkflow/resolveAdapter (by path), so this also
// proves the loader maps `export default` + `meta` correctly — and keeps the
// untyped author-facing scripts out of the typecheck program.

import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { loadWorkflow, runWorkflow, resolveAdapter } from "../src/cli/run";

const CONF = join(import.meta.dir, "..", "conformance");

function run(name: string, opts: Record<string, unknown> = {}) {
  return runWorkflow(
    { wfPath: join(CONF, `${name}.ts`), agent: "fake", args: undefined, pretty: false, ...opts } as any,
    {
      loadWorkflow,
      resolveAdapter,
      journalSink: () => {},
      now: () => 0,
      runId: () => "t",
    },
  );
}

describe("conformance — native-shaped scripts pass under --agent fake", () => {
  test("fanout: parallel survivors through filter(Boolean)", async () => {
    const out = await run("fanout");
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout!)).toEqual({ found: ["A", "C"] });
  });

  test("pipeline: each item flows through both stages", async () => {
    const out = await run("pipeline");
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout!)).toEqual({ out: ["s2", "s2"] });
  });

  test("schema-gate: repairs an invalid first response into validated JSON", async () => {
    const out = await run("schema-gate");
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout!)).toEqual({ got: { n: 7 } });
  });

  test("budget-loop: the ceiling halts the loop (exit 1, budget exhausted)", async () => {
    const out = await run("budget-loop", { budget: 100 });
    expect(out.exitCode).toBe(1);
    expect((out.error as any).message).toContain("budget exhausted");
  });

  test("strict-throws: Date.now() is forbidden under --strict, allowed without", async () => {
    const strict = await run("strict-throws", { strict: true });
    expect(strict.exitCode).toBe(1);
    expect((strict.error as any).message).toContain("strict");

    const loose = await run("strict-throws", { strict: false });
    expect(loose.exitCode).toBe(0);
  });
});
