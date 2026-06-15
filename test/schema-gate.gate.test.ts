import { test, expect, describe } from "bun:test";
import { schemaGate, makeValidator, type GateAttempt } from "../src/schema-gate";
import type { AgentResult } from "../src/adapters/types";

const okText = (text: string): AgentResult => ({
  ok: true,
  text,
  meta: { durationMs: 1 },
});

const alwaysValid = () => ({ valid: true, errors: [] as string[] });
const alwaysInvalid = () => ({ valid: false, errors: ["must have required property 'x'"] });

describe("schemaGate — retry loop", () => {
  test("returns the value when the first attempt is schema-valid", async () => {
    let calls = 0;
    const out = await schemaGate({
      call: async () => {
        calls++;
        return okText('{"a":1}');
      },
      validate: alwaysValid,
    });
    expect(out).toEqual({ ok: true, value: { a: 1 } });
    expect(calls).toBe(1);
  });

  test("retries on schema violation, succeeds on the 2nd attempt", async () => {
    let calls = 0;
    const out = await schemaGate({
      call: async () => {
        calls++;
        return okText('{"n":' + calls + "}");
      },
      validate: (v: unknown) => {
        const valid = (v as { n: number }).n === 2;
        return { valid, errors: valid ? [] : ["n must be 2"] };
      },
    });
    expect(out).toEqual({ ok: true, value: { n: 2 } });
    expect(calls).toBe(2);
  });

  test("caps at exactly 2 retries (3 invocations) then returns schema_violation", async () => {
    let calls = 0;
    const out = await schemaGate({
      call: async () => {
        calls++;
        return okText('{"a":1}');
      },
      validate: alwaysInvalid,
    });
    expect(calls).toBe(3);
    expect(out).toMatchObject({ ok: false, kind: "schema_violation" });
  });

  test("returns no_json when no JSON can be extracted (after retries)", async () => {
    let calls = 0;
    const out = await schemaGate({
      call: async () => {
        calls++;
        return okText("sorry, no json this time");
      },
      validate: alwaysValid,
    });
    expect(calls).toBe(3);
    expect(out).toMatchObject({ ok: false, kind: "no_json" });
  });

  test("adapter failure short-circuits with no schema retries", async () => {
    let calls = 0;
    const out = await schemaGate({
      call: async () => {
        calls++;
        return { ok: false, kind: "timeout" } as AgentResult;
      },
      validate: alwaysValid,
    });
    expect(calls).toBe(1);
    expect(out).toEqual({ ok: false, kind: "timeout" });
  });

  test("a thrown call never escapes — mapped to spawn_failure, no retry", async () => {
    let calls = 0;
    const out = await schemaGate({
      call: async () => {
        calls++;
        throw new Error("spawn exploded");
      },
      validate: alwaysValid,
    });
    expect(calls).toBe(1);
    expect(out).toEqual({ ok: false, kind: "spawn_failure" });
  });

  test("records every attempt via onAttempt with 1-based index and kind", async () => {
    const attempts: GateAttempt[] = [];
    await schemaGate({
      call: async () => okText('{"a":1}'),
      validate: alwaysInvalid,
      onAttempt: (a) => attempts.push(a),
    });
    expect(attempts.map((a) => a.n)).toEqual([1, 2, 3]);
    expect(attempts.every((a) => a.kind === "schema_violation")).toBe(true);
    expect(attempts[0]?.errors).toEqual(["must have required property 'x'"]);
  });

  test("passes validation errors + raw text as feedback to retries", async () => {
    const feedbacks: (string | null)[] = [];
    let calls = 0;
    await schemaGate({
      call: async (_n, feedback) => {
        feedbacks.push(feedback ? feedback.errors.join(",") : null);
        calls++;
        return okText('{"bad":true}');
      },
      validate: alwaysInvalid,
    });
    expect(feedbacks[0]).toBeNull(); // first attempt has no feedback
    expect(feedbacks[1]).toBe("must have required property 'x'");
    expect(feedbacks[2]).toBe("must have required property 'x'");
  });

  test("respects a custom maxRetries", async () => {
    let calls = 0;
    const out = await schemaGate({
      call: async () => {
        calls++;
        return okText('{"a":1}');
      },
      validate: alwaysInvalid,
      maxRetries: 0,
    });
    expect(calls).toBe(1);
    expect(out).toMatchObject({ ok: false, kind: "schema_violation" });
  });
});

describe("makeValidator — ajv wrapper", () => {
  const schema = {
    type: "object",
    properties: { x: { type: "number" } },
    required: ["x"],
  };

  test("accepts a valid value", () => {
    const validate = makeValidator(schema);
    expect(validate({ x: 1 }).valid).toBe(true);
  });

  test("rejects an invalid value with non-empty errors", () => {
    const validate = makeValidator(schema);
    const res = validate({ y: 1 });
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});
