import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Runtime } from "../../src/runtime";
import type { FakeAdapterOptions } from "../../src/adapters/fake";

const analysisSchema = {
  type: "object",
  required: ["id", "strengths", "risks", "evidence"],
  properties: {
    id: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
  },
};

const reportSchema = {
  type: "object",
  required: ["positioning", "strengths", "risks", "recommendations"],
  properties: {
    positioning: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
};

const checkSchema = {
  type: "object",
  required: ["accepted", "issues"],
  properties: {
    accepted: { type: "boolean" },
    issues: { type: "array", items: { type: "string" } },
  },
};

type Source = { id: string; inputFile: string; bytes: number; sha256: string; canonicalUrl: string };
type Args = { repoRoot?: string; sourceRoot?: string; mode?: "ci" };

const repoChecks = ["runtime-contract", "onboarding-claims", "release-surface"];
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function assertCoverage(results: unknown[], expected: string[]) {
  const ids = results.map((result) => (result as { id?: string } | null)?.id).filter(Boolean) as string[];
  const missing = expected.filter((id) => !ids.includes(id));
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (results.some((result) => result === null) || ids.length !== expected.length || missing.length || duplicates.length) {
    throw new Error(`incomplete audit: expected=${expected.join(",")} observed=${ids.join(",")} missing=${missing.join(",")} duplicates=${duplicates.join(",")}`);
  }
}

export default async function relaunchAudit({ agent, parallel, phase }: Runtime, args: Args = {}) {
  const repoRoot = resolve(args.repoRoot ?? process.cwd());
  const manifestPath = join(repoRoot, "evidence/2026-08-20-relaunch/source-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { sources: Source[] };
  const sources = manifest.sources;

  if (args.mode !== "ci") {
    if (!args.sourceRoot) throw new Error("sourceRoot is required outside CI fixture mode");
    for (const source of sources) {
      const path = join(resolve(args.sourceRoot), source.inputFile);
      const bytes = readFileSync(path);
      if (statSync(path).size !== source.bytes || sha256(bytes) !== source.sha256) {
        throw new Error(`frozen source mismatch: ${source.id}`);
      }
    }
  }

  phase("Analyze fixed sources and repository");
  const sourceCalls = sources.map((source) => () =>
    agent(
      `READ-ONLY MARKET CHECK ${source.id}. Read the frozen official source at ${join(resolve(args.sourceRoot ?? repoRoot), source.inputFile)}. ` +
        `Assess overlap with this job: run independent coding-agent repo checks in parallel and return one shape-validated artifact with explicit partial-failure receipts. ` +
        `Return concise JSON. id must be ${source.id}. Cite short source anchors in evidence; do not claim the schema proves truth.`,
      { schema: analysisSchema, label: source.id, cwd: repoRoot, timeoutMs: 180_000, maxRetries: 0 },
    ),
  );
  const repoCalls = repoChecks.map((id) => () =>
    agent(
      `READ-ONLY REPO CHECK ${id}. Inspect ${repoRoot}. Evaluate only this facet: ${id}. ` +
        `Find concrete strengths, overclaims, and release blockers for the narrow job. Return concise JSON; id must be ${id}. Evidence must name repo paths or commands.`,
      { schema: analysisSchema, label: id, cwd: repoRoot, timeoutMs: 180_000, maxRetries: 0 },
    ),
  );
  const analyses = await parallel([...sourceCalls, ...repoCalls]);
  const expected = [...sources.map((source) => source.id), ...repoChecks];
  assertCoverage(analyses, expected);

  phase("Synthesize");
  const report = await agent(
    `Synthesize this fixed-coverage audit into the narrowest credible product position. Do not add facts not present in the analyses. Return JSON.\n${JSON.stringify(analyses)}`,
    { schema: reportSchema, label: "synthesis", cwd: repoRoot, timeoutMs: 180_000, maxRetries: 0 },
  );
  if (!report) throw new Error("synthesis failed");

  phase("Fresh-context cross-check");
  const crosscheck = await agent(
    `Fresh-context cross-check only; this is not independent verification. Check the draft against the six supplied analyses. Return accepted=false for unsupported claims and list them.\n${JSON.stringify({ analyses, report })}`,
    { schema: checkSchema, label: "crosscheck", cwd: repoRoot, timeoutMs: 180_000, maxRetries: 0 },
  );
  if (!crosscheck) throw new Error("cross-check failed");

  return { expected, analyses, report, crosscheck };
}

const ok = (id: string) => JSON.stringify({ id, strengths: [`${id} strength`], risks: [], evidence: [`${id} evidence`] });
export const fake: FakeAdapterOptions = {
  rules: [
    { match: (prompt) => prompt.includes("Synthesize"), responses: [{ text: '{"positioning":"narrow job","strengths":[],"risks":[],"recommendations":[]}', outputTokens: 10 }] },
    { match: (prompt) => prompt.includes("Fresh-context"), responses: [{ text: '{"accepted":true,"issues":[]}', outputTokens: 10 }] },
    ...["claude-subagents", "codex-cli", "langgraph-workflows-agents", ...repoChecks].map((id) => ({
      match: (prompt: string) => prompt.includes(id),
      responses: [{ text: ok(id), outputTokens: 10 }],
    })),
  ],
};
