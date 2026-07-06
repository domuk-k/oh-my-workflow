import { test, expect, describe } from "bun:test";
import { makeFakeAdapter } from "../src/adapters/fake";

describe("makeFakeAdapter", () => {
  test("invoke returns canned text for a matching rule", async () => {
    const fake = makeFakeAdapter({
      rules: [{ match: (p) => p.includes("search"), responses: [{ text: '{"hits":3}' }] }],
    });
    const r = await fake.invoke({ prompt: "please search" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe('{"hits":3}');
      expect(typeof r.meta.durationMs).toBe("number");
    }
  });

  test("invoke carries outputTokens from the response into meta", async () => {
    const fake = makeFakeAdapter({
      rules: [{ match: () => true, responses: [{ text: "x", outputTokens: 30 }] }],
    });
    const r = await fake.invoke({ prompt: "x" });
    expect(r.ok && r.meta.outputTokens).toBe(30);
  });

  test("advances through a response sequence, sticking on the last", async () => {
    const fake = makeFakeAdapter({
      rules: [{ match: () => true, responses: [{ text: "first" }, { text: "second" }] }],
    });
    const a = await fake.invoke({ prompt: "x" });
    const b = await fake.invoke({ prompt: "x" });
    const c = await fake.invoke({ prompt: "x" });
    expect([a, b, c].map((r) => (r.ok ? r.text : "fail"))).toEqual(["first", "second", "second"]);
  });

  test("a fault rule returns ok:false with the given kind", async () => {
    const fake = makeFakeAdapter({
      rules: [{ match: () => true, responses: [{ fail: "timeout" }] }],
    });
    const r = await fake.invoke({ prompt: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("timeout");
  });

  test("falls back to the default response when no rule matches", async () => {
    const fake = makeFakeAdapter({
      rules: [{ match: (p) => p === "never", responses: [{ text: "no" }] }],
      default: { text: '{"default":true}' },
    });
    const r = await fake.invoke({ prompt: "anything" });
    expect(r.ok && r.text).toBe('{"default":true}');
  });

  test("followUp continues the same rule's sequence", async () => {
    const fake = makeFakeAdapter({
      rules: [
        { match: () => true, responses: [{ text: "bad", sessionId: "s1" }, { text: "good" }] },
      ],
    });
    const first = await fake.invoke({ prompt: "x" });
    expect(first.ok && first.meta.sessionId).toBe("s1");
    const second = await fake.followUp!("s1", "fix it");
    expect(second.ok && second.text).toBe("good");
  });

  test("followUp routes by sessionId to the issuing rule, even if the prompt changed", async () => {
    const fake = makeFakeAdapter({
      rules: [
        // The original rule only matches the original prompt.
        { match: (p) => p.includes("SEARCH a"), responses: [{ text: "v1", sessionId: "sa" }, { text: "v2" }] },
        // A decoy rule the *retry* prompt would otherwise match.
        { match: (p) => p.includes("corrected"), responses: [{ text: "decoy" }] },
      ],
    });
    await fake.invoke({ prompt: "SEARCH a" });
    // retry prompt no longer contains "SEARCH a"; sessionId must win over prompt match.
    const repaired = await fake.followUp!("sa", "return corrected JSON");
    expect(repaired.ok && repaired.text).toBe("v2");
  });
});
