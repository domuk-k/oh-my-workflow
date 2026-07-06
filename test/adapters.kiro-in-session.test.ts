import { describe, expect, test } from "bun:test";
import {
  buildKiroSubagentRequest,
  extractKiroSubagentText,
  makeKiroInSessionAdapter,
  type KiroSubagentToolRequest,
} from "../src/adapters/kiro-in-session";

describe("buildKiroSubagentRequest", () => {
  test("maps an omw invoke request to Kiro's InvokeSubagents command", () => {
    expect(
      buildKiroSubagentRequest(
        {
          prompt: "Find the issue",
          agentType: "kiro_planner",
          cwd: "/tmp/project",
          model: "smart",
          effort: "high",
        },
        {
          agentName: "kiro_default",
          trustAllTools: true,
          interactive: false,
          relevantContext: "Use repository context.",
          convoId: "omw-call-1",
        },
      ),
    ).toEqual({
      command: "InvokeSubagents",
      content: {
        subagents: [
          {
            query: "Find the issue",
            agent_name: "kiro_planner",
            dangerously_trust_all_tools: true,
            is_interactive: false,
            convo_id: "omw-call-1",
            relevant_context: "Use repository context.\ncwd: /tmp/project\nmodel: smart\neffort: high",
          },
        ],
      },
    });
  });
});

describe("extractKiroSubagentText", () => {
  test("extracts text from common Kiro tool result shapes", () => {
    expect(extractKiroSubagentText({ summary: "done" })).toBe("done");
    expect(
      extractKiroSubagentText({
        content: [{ kind: "toolResult", data: { content: [{ kind: "text", data: "nested" }] } }],
      }),
    ).toBe("nested");
    expect(extractKiroSubagentText({ Json: { ok: true } })).toBe('{"ok":true}');
  });
});

describe("makeKiroInSessionAdapter", () => {
  test("invokes the injected Kiro subagent tool and returns extracted text", async () => {
    let captured: KiroSubagentToolRequest | undefined;
    let clock = 100;
    const adapter = makeKiroInSessionAdapter({
      now: () => {
        clock += 10;
        return clock;
      },
      tool: async (req) => {
        captured = req;
        return { results: [{ summary: '{"ok":true}' }] };
      },
      trustAllTools: true,
    });

    const result = await adapter.invoke({ prompt: "Return JSON" });

    expect(captured).toEqual({
      command: "InvokeSubagents",
      content: { subagents: [{ query: "Return JSON", dangerously_trust_all_tools: true }] },
    });
    expect(result).toEqual({ ok: true, text: '{"ok":true}', meta: { durationMs: 10 } });
  });

  test("fails clearly when no host tool is available", async () => {
    const adapter = makeKiroInSessionAdapter({ tool: null, now: () => 0 });
    const result = await adapter.invoke({ prompt: "hello" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("spawn_failure");
      expect(result.stderr).toContain("Kiro subagent tool is not available");
    }
  });

  test("maps host errors to adapter failures", async () => {
    const adapter = makeKiroInSessionAdapter({
      tool: async () => {
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
});
