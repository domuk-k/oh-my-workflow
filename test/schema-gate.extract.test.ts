import { test, expect, describe } from "bun:test";
import { extractJson } from "../src/schema-gate";

describe("extractJson — deterministic precedence", () => {
  test("parses a bare JSON object", () => {
    expect(extractJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  test("extracts JSON from a ```json fenced block", () => {
    const text = 'Here is the result:\n```json\n{"ok": true}\n```\n';
    expect(extractJson(text)).toEqual({ ok: true });
  });

  test("extracts from a fence without a language tag", () => {
    const text = "```\n{\"n\": 42}\n```";
    expect(extractJson(text)).toEqual({ n: 42 });
  });

  test("when multiple fenced blocks exist, the LAST parseable one wins", () => {
    const text = [
      "First draft:",
      "```json",
      '{"draft": 1}',
      "```",
      "Corrected:",
      "```json",
      '{"draft": 2, "final": true}',
      "```",
    ].join("\n");
    expect(extractJson(text)).toEqual({ draft: 2, final: true });
  });

  test("skips a trailing non-JSON fence and uses the last JSON fence", () => {
    const text = [
      "```json",
      '{"value": 7}',
      "```",
      "Run it with:",
      "```bash",
      "omw run wf.js",
      "```",
    ].join("\n");
    expect(extractJson(text)).toEqual({ value: 7 });
  });

  test("extracts the largest balanced-brace span from prose (no fences)", () => {
    const text =
      'I considered {"partial": 1} but the answer is {"answer": 42, "reason": "largest"}.';
    expect(extractJson(text)).toEqual({ answer: 42, reason: "largest" });
  });

  test("handles braces inside string values without breaking balance", () => {
    const text = 'Result: {"note": "use { and } carefully", "ok": true}';
    expect(extractJson(text)).toEqual({ note: "use { and } carefully", ok: true });
  });

  test("handles nested objects, returning the outer object", () => {
    const text = 'prefix {"outer": {"inner": [1, 2]}, "k": "v"} suffix';
    expect(extractJson(text)).toEqual({ outer: { inner: [1, 2] }, k: "v" });
  });

  test("returns undefined when there is no JSON", () => {
    expect(extractJson("no json here, sorry")).toBeUndefined();
  });

  test("returns undefined for empty input", () => {
    expect(extractJson("")).toBeUndefined();
  });

  test("prefers a fenced block over a stray brace span elsewhere", () => {
    const text = 'noise {"stray": 0} more\n```json\n{"chosen": true}\n```';
    expect(extractJson(text)).toEqual({ chosen: true });
  });
});
