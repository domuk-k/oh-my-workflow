import { afterEach, describe, expect, test } from "bun:test";
import { probeInSessionHost, resolveInSessionAdapter } from "../src/adapters/in-session-probe";
import { resolveAdapter } from "../src/cli/run";

type HostGlobals = typeof globalThis & {
  use_subagent?: unknown;
  subagent?: unknown;
};

function withKiroTool<T>(fn: () => T): T {
  const g = globalThis as HostGlobals;
  const prevUse = g.use_subagent;
  const prevSub = g.subagent;
  g.use_subagent = async () => ({ summary: '{"ok":true}' });
  delete g.subagent;
  try {
    return fn();
  } finally {
    g.use_subagent = prevUse;
    g.subagent = prevSub;
  }
}

describe("probeInSessionHost", () => {
  afterEach(() => {
    const g = globalThis as HostGlobals;
    delete g.use_subagent;
    delete g.subagent;
  });

  test("returns ok:false when no host callback is present", () => {
    const hit = probeInSessionHost();
    expect(hit.ok).toBe(false);
    if (hit.ok) throw new Error("expected miss");
    expect(hit.reason).toContain("No in-session host callback");
  });

  test("detects Kiro subagent tooling and returns a unified in-session adapter", () => {
    withKiroTool(() => {
      const hit = probeInSessionHost();
      expect(hit.ok).toBe(true);
      if (!hit.ok) throw new Error("expected hit");
      expect(hit.host).toBe("kiro");
      expect(hit.adapter.name).toBe("in-session");
    });
  });
});

describe("resolveInSessionAdapter", () => {
  test("fails cleanly without falling back to CLI", () => {
    const r = resolveInSessionAdapter(() => ({ ok: false, reason: "no host" }));
    expect("missing" in r && r.missing).toBe("in-session");
    if (!("missing" in r)) throw new Error("expected missing");
    expect(r.installHint).toBe("no host");
  });
});

describe("resolveAdapter — CLI is headless only", () => {
  const wf = { workflow: async () => ({}) };

  test("--agent in-session is adapter_missing (embedder-only)", () => {
    const r = resolveAdapter("in-session", wf, () => true, {});
    expect("missing" in r && r.missing).toBe("in-session");
    if (!("missing" in r)) throw new Error("expected missing");
    expect(r.installHint).toContain("embedder-only");
  });

  test("auto ignores in-session even when a host callback exists", () => {
    withKiroTool(() => {
      const r = resolveAdapter("auto", wf, (bin) => bin === "claude", {});
      expect("adapter" in r && r.adapter.name).toBe("claude");
    });
  });

  test("OMW_AGENT=in-session fails with embedder hint", () => {
    const r = resolveAdapter("auto", wf, () => true, { OMW_AGENT: "in-session" });
    expect("missing" in r && r.missing).toBe("in-session");
    if (!("missing" in r)) throw new Error("expected missing");
    expect(r.installHint).toContain("embedder-only");
  });
});