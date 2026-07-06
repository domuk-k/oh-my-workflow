// omw codemod --to-di: rewrite a legacy (rt, args) workflow to destructured DI.
// The transform is a text rewrite; the round-trip test proves the OUTPUT both
// parses and runs under --agent fake.

import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toDi, parseCodemodArgs, codemodCommand } from "../src/cli/codemod";
import { loadWorkflow, runWorkflow, resolveAdapter } from "../src/cli/run";

const LEGACY_FN =
  `export const fake = { default: { text: "ok" } };\n` +
  `export default async function (rt, args) {\n` +
  `  rt.phase("Go");\n` +
  `  const x = await rt.agent("hi");\n` +
  `  return { x, args };\n` +
  `}\n`;

describe("toDi", () => {
  test("rewrites the (rt, args) signature to destructured hooks and drops rt.", () => {
    const r = toDi(LEGACY_FN);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.output).toContain("({ agent, parallel, pipeline, phase, log, workflow, budget }, args)");
    expect(r.output).toContain('phase("Go")');
    expect(r.output).toContain('await agent("hi")');
    expect(r.output).not.toContain("rt.");
  });

  test("rewrites an arrow default export too", () => {
    const arrow = `export default async (rt, args) => ({ x: await rt.agent("hi") });\n`;
    const r = toDi(arrow);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.output).toContain("({ agent, parallel, pipeline, phase, log, workflow, budget }, args) =>");
    expect(r.output).toContain('await agent("hi")');
  });

  test("reports an error when there is no legacy default export to migrate", () => {
    const di = `export default async function ({ agent }, args) { return agent("x"); }\n`;
    const r = toDi(di);
    expect(r.ok).toBe(false);
  });
});

describe("codemod round-trip", () => {
  test("the migrated source loads and runs green under --agent fake", async () => {
    const r = toDi(LEGACY_FN);
    if (!r.ok) throw new Error(r.error);
    const dir = mkdtempSync(join(tmpdir(), "omw-codemod-"));
    const file = join(dir, "workflow.ts");
    writeFileSync(file, r.output);

    const loaded = await loadWorkflow(file);
    const out = await runWorkflow(
      { wfPath: file, agent: "fake", args: { q: 1 }, pretty: false } as any,
      {
        loadWorkflow: async () => loaded,
        resolveAdapter,
        journalSink: () => {},
        now: () => 0,
        runId: () => "t",
      },
    );
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout!)).toEqual({ x: "ok", args: { q: 1 } });
  });
});

describe("codemodCommand", () => {
  test("--write rewrites the file in place; default prints to stdout; exit 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omw-codemod-cmd-"));
    const file = join(dir, "wf.ts");
    writeFileSync(file, LEGACY_FN);

    const outs: string[] = [];
    const printCode = await codemodCommand([file], { stdout: (s) => outs.push(s), stderr: () => {} });
    expect(printCode).toBe(0);
    expect(outs.join("")).toContain("({ agent, parallel, pipeline, phase, log, workflow, budget }, args)");
    expect(readFileSync(file, "utf8")).toBe(LEGACY_FN); // unchanged without --write

    const writeCode = await codemodCommand([file, "--write"], { stdout: () => {}, stderr: () => {} });
    expect(writeCode).toBe(0);
    expect(readFileSync(file, "utf8")).not.toContain("rt.");
  });

  test("--to-omw is reported as not implemented (exit 1)", async () => {
    const errs: string[] = [];
    const code = await codemodCommand(["x.ts", "--to-omw"], { stdout: () => {}, stderr: (s) => errs.push(s) });
    expect(code).toBe(1);
    expect(errs.join("")).toContain("not_implemented");
  });

  test("missing file path is a usage error (exit 2)", async () => {
    const code = await codemodCommand([], { stdout: () => {}, stderr: () => {} });
    expect(code).toBe(2);
  });
});

describe("parseCodemodArgs", () => {
  test("defaults to --to-di and parses --write", () => {
    const r = parseCodemodArgs(["f.ts", "--write"]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.value).toEqual({ file: "f.ts", transform: "to-di", write: true });
  });
});
