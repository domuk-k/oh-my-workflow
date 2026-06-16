// omw validate: pre-flight load + fake-fixture lint (no agents spawned).

import { test, expect, describe } from "bun:test";
import { lintFake, validateWorkflow, parseValidateArgs, validateCommand } from "../src/cli/validate";

describe("lintFake", () => {
  test("a well-formed fixture (rules with predicate match) is clean", () => {
    expect(
      lintFake({ rules: [{ match: (p: string) => p.includes("X"), responses: [{ text: "{}" }] }] }),
    ).toEqual([]);
  });

  test("no fixture at all is clean (real-agent workflow)", () => {
    expect(lintFake(undefined)).toEqual([]);
    expect(lintFake(null)).toEqual([]);
  });

  test("flags top-level `responses` (the classic silent-degradation footgun)", () => {
    const w = lintFake({ responses: [{ text: "{}" }] });
    expect(w.some((m) => m.includes("top level is ignored"))).toBe(true);
  });

  test("flags a string `match` (must be a predicate function)", () => {
    const w = lintFake({ rules: [{ match: "SEARCH", responses: [{ text: "{}" }] }] });
    expect(w.some((m) => m.includes("predicate function"))).toBe(true);
  });

  test("flags a fixture with neither rules nor default (matches nothing)", () => {
    const w = lintFake({});
    expect(w.some((m) => m.includes("no `rules` and no `default`"))).toBe(true);
  });

  test("a default-only fixture is acceptable (matches every node)", () => {
    expect(lintFake({ default: { text: "{}" } })).toEqual([]);
  });
});

describe("validateWorkflow", () => {
  test("a load failure → ok:false with the error", async () => {
    const report = await validateWorkflow("nope", async () => {
      throw new Error("workflow path not found: nope");
    });
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toContain("not found");
  });

  test("a loaded workflow with a malformed fake → ok:true but warnings", async () => {
    const report = await validateWorkflow("w", async () => ({
      workflow: async () => ({}),
      fake: { responses: [{ text: "{}" }] } as any,
    }));
    expect(report.ok).toBe(true);
    expect(report.warnings.length).toBeGreaterThan(0);
  });
});

describe("parseValidateArgs", () => {
  test("parses the workflow path and --json", () => {
    const r = parseValidateArgs(["examples/deep-research", "--json"]);
    expect(r.ok && r.value).toEqual({ wfPath: "examples/deep-research", json: true });
  });
  test("missing path is an error", () => {
    expect(parseValidateArgs(["--json"]).ok).toBe(false);
  });
});

describe("validateCommand", () => {
  test("the real deep-research example validates clean (exit 0)", async () => {
    const out: string[] = [];
    const code = await validateCommand(["examples/deep-research"], {
      stdout: (s) => out.push(s),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain("ok");
  });

  test("a missing workflow path is a usage error (exit 2)", async () => {
    const code = await validateCommand([], { stdout: () => {}, stderr: () => {} });
    expect(code).toBe(2);
  });
});
