import { describe, expect, test } from "bun:test";
import { extractInSessionText, makeInSessionAdapter } from "../src/adapters/in-session";

describe("extractInSessionText", () => {
  test("extracts text from common host result shapes", () => {
    expect(extractInSessionText("plain")).toBe("plain");
    expect(extractInSessionText({ summary: "done" })).toBe("done");
    expect(
      extractInSessionText({
        content: [{ kind: "toolResult", data: { content: [{ kind: "text", data: "nested" }] } }],
      }),
    ).toBe("nested");
    expect(extractInSessionText({ Json: { ok: true } })).toBe('{"ok":true}');
  });
});

describe("makeInSessionAdapter", () => {
  test("invokes the host callback with the omw request and returns text", async () => {
    let capturedPrompt = "";
    let clock = 100;
    const adapter = makeInSessionAdapter({
      name: "host-agent",
      now: () => {
        clock += 10;
        return clock;
      },
      invoke: async (req) => {
        capturedPrompt = req.prompt;
        return { results: [{ summary: '{"ok":true}' }] };
      },
    });

    const result = await adapter.invoke({ prompt: "Return JSON", model: "smart" });

    expect(capturedPrompt).toBe("Return JSON");
    expect(result).toEqual({ ok: true, text: '{"ok":true}', meta: { durationMs: 10 } });
  });

  test("accepts an AgentResult returned by the host", async () => {
    const adapter = makeInSessionAdapter({
      invoke: async () => ({ ok: true, text: "already-normalized", meta: { durationMs: 7 } }),
    });

    expect(await adapter.invoke({ prompt: "hello" })).toEqual({
      ok: true,
      text: "already-normalized",
      meta: { durationMs: 7 },
    });
  });

  test("fails clearly when the host returns no text", async () => {
    const adapter = makeInSessionAdapter({ invoke: async () => ({ empty: true }), now: () => 0 });
    const result = await adapter.invoke({ prompt: "hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("nonzero_exit");
      expect(result.stderr).toContain("returned no text");
    }
  });

  test("maps host errors to adapter failures", async () => {
    const adapter = makeInSessionAdapter({
      invoke: async () => {
        throw new Error("host rejected request");
      },
      now: () => 0,
    });

    const result = await adapter.invoke({ prompt: "hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("nonzero_exit");
      expect(result.stderr).toBe("host rejected request");
    }
  });

  test("classifies timeout-like host errors as timeout", async () => {
    const adapter = makeInSessionAdapter({
      invoke: async () => {
        throw new Error("timed out");
      },
      now: () => 0,
    });

    const result = await adapter.invoke({ prompt: "hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("timeout");
  });
});
