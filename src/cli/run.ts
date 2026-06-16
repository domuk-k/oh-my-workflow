// `omw run <wf> --agent <a> [--args JSON] [--concurrency N] [--pretty]`.
// Parsing is a pure function so the input contract is testable without touching
// the filesystem, a clock, or a subprocess.

import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentPort } from "../adapters/types";
import { makeFakeAdapter, type FakeAdapterOptions } from "../adapters/fake";
import { makeClaudeAdapter } from "../adapters/claude";
import { makeCodexAdapter } from "../adapters/codex";
import type { Runtime } from "../runtime";
import { makeRuntime } from "../runtime";
import { makeJournal, parseJournalLines, type JournalEvent } from "../journal";
import type { ResumeIndex } from "../resume";
import { makeResumeIndexFromLines } from "../resume";

export type RunOptions = {
  wfPath: string;
  agent: string;
  args: unknown;
  concurrency?: number;
  pretty: boolean;
  /** Path to a prior run's journal to resume from (longest-unchanged-prefix). */
  resume?: string;
};

export type ParseResult =
  | { ok: true; value: RunOptions }
  | { ok: false; error: string };

export function parseRunArgs(argv: string[]): ParseResult {
  let wfPath: string | undefined;
  let agent: string | undefined;
  let args: unknown;
  let concurrency: number | undefined;
  let pretty = false;
  let resume: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    switch (tok) {
      case "--agent":
        agent = argv[++i];
        break;
      case "--args": {
        const raw = argv[++i];
        try {
          args = JSON.parse(raw!);
        } catch {
          return { ok: false, error: `--args must be valid JSON, got: ${raw}` };
        }
        break;
      }
      case "--concurrency":
        concurrency = Number(argv[++i]);
        break;
      case "--pretty":
        pretty = true;
        break;
      case "--resume":
        resume = argv[++i];
        if (!resume) return { ok: false, error: "--resume requires a journal path" };
        break;
      default:
        if (wfPath === undefined) wfPath = tok;
        else return { ok: false, error: `unexpected argument: ${tok}` };
    }
  }

  if (wfPath === undefined) return { ok: false, error: "missing workflow path" };
  if (agent === undefined) return { ok: false, error: "missing --agent <name>" };

  return { ok: true, value: { wfPath, agent, args, concurrency, pretty, resume } };
}

// ── workflow execution ──────────────────────────────────────────────────────

/** A loaded workflow module. The orchestration script the host agent authors is
 *  the default export; `fake` is optional fixtures used only by `--agent fake`
 *  so the example is deterministic green with no API key. */
export type LoadedWorkflow = {
  workflow: (rt: Runtime, args: unknown) => unknown | Promise<unknown>;
  fake?: FakeAdapterOptions;
};

/** Either a ready adapter, or a structured "not installed" signal (exit 3). */
export type AdapterResolution =
  | { adapter: AgentPort }
  | { missing: string; installHint: string };

/** Entry filenames tried, in order, when a workflow path is a directory. */
const ENTRY_NAMES = ["workflow.ts", "workflow.js", "index.ts", "index.js"];

/** Load a workflow module from a file path or a directory (resolved to its
 *  conventional entry). The default export is the orchestration fn; a missing
 *  default is an authoring bug surfaced as a load error, not a silent no-op. */
export async function loadWorkflow(wfPath: string): Promise<LoadedWorkflow> {
  const abs = isAbsolute(wfPath) ? wfPath : resolve(process.cwd(), wfPath);
  let entry = abs;
  let isDir = false;
  try {
    isDir = statSync(abs).isDirectory();
  } catch {
    throw new Error(`workflow path not found: ${wfPath}`);
  }
  if (isDir) {
    const found = ENTRY_NAMES.map((n) => join(abs, n)).find((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
    if (!found) throw new Error(`no workflow entry (${ENTRY_NAMES.join(", ")}) in directory: ${wfPath}`);
    entry = found;
  }

  const mod = await import(entry);
  if (typeof mod.default !== "function") {
    throw new Error(`workflow ${wfPath} must default-export a function (rt, args) => result`);
  }
  return { workflow: mod.default, fake: mod.fake };
}

export type RunDeps = {
  loadWorkflow: (wfPath: string) => Promise<LoadedWorkflow>;
  resolveAdapter: (name: string, wf: LoadedWorkflow) => AdapterResolution;
  journalSink: (line: string) => void;
  now: () => number;
  runId: () => string;
  /** A prior run's journal as a lookup; when present, nodes whose key hits are
   *  served from it and the adapter is skipped. Built by runCommand from the
   *  --resume file so runWorkflow stays fs-free. */
  resume?: ResumeIndex;
  /** Optional human-facing tree (--pretty). Pure side-channel; never stdout. */
  stderr?: (line: string) => void;
};

export type RunOutcome = {
  exitCode: number;
  /** The result JSON — a single blob, stdout only. Present on exit 0 and on
   *  exit 4 (completed, but a node hit internal_error). */
  stdout?: string;
  /** Structured error for stderr on a non-zero exit. */
  error?: object;
};

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function runWorkflow(opts: RunOptions, deps: RunDeps): Promise<RunOutcome> {
  let loaded: LoadedWorkflow;
  try {
    loaded = await deps.loadWorkflow(opts.wfPath);
  } catch (e) {
    return { exitCode: 1, error: { error: "load_failed", message: errMsg(e), wf: opts.wfPath } };
  }

  const resolved = deps.resolveAdapter(opts.agent, loaded);
  if ("missing" in resolved) {
    return {
      exitCode: 3,
      error: { error: "adapter_missing", adapter: resolved.missing, install_hint: resolved.installHint },
    };
  }

  const runId = deps.runId();
  const journal = makeJournal({ sink: deps.journalSink, now: deps.now });
  const rt = makeRuntime({ adapter: resolved.adapter, journal, concurrency: opts.concurrency, resume: deps.resume });

  journal.runStart({ run: runId, wf: opts.wfPath });
  try {
    const result = await loaded.workflow(rt, opts.args);
    // internal_error is an AUTHOR bug (e.g. a JSON Schema that won't compile),
    // not a flaky node — the null-contract absorbs it so the run completes, but
    // we escalate to exit 4 so a caller (or authoring agent) doesn't read the
    // null as a legitimate abstention. The partial result still goes to stdout.
    const internalErrors = journal
      .events()
      .filter((e): e is Extract<JournalEvent, { ev: "agent_end" }> => e.ev === "agent_end" && !e.ok && e.kind === "internal_error")
      .map((e) => e.call);
    journal.runEnd({ ok: internalErrors.length === 0 });
    if (internalErrors.length > 0) {
      return {
        exitCode: 4,
        stdout: JSON.stringify(result),
        error: {
          error: "internal_error_nodes",
          calls: internalErrors,
          hint: "a node failed to compile/execute (likely an invalid JSON Schema) — see the journal's internal_error entries",
        },
      };
    }
    return { exitCode: 0, stdout: JSON.stringify(result) };
  } catch (e) {
    // A throw escaping the workflow body is a SCRIPT error (the authored JS), not
    // a node failure — node failures are swallowed by the null-contract. Exit 1.
    journal.runEnd({ ok: false });
    return { exitCode: 1, error: { error: "script_error", message: errMsg(e), wf: opts.wfPath } };
  }
}

// ── adapter resolution ──────────────────────────────────────────────────────

/** Install hints surfaced (exit 3) when an adapter's CLI isn't on PATH. The
 *  `fake` adapter is always available — it is the free, no-key demo engine. */
const INSTALL_HINTS: Record<string, string> = {
  claude: "npm i -g @anthropic-ai/claude-code  (then `claude login`)",
  codex: "npm i -g @openai/codex  (experimental adapter)",
  pi: "see https://github.com/parallel-ai/pi  (experimental adapter)",
};

/** PATH probe — injected so the missing→installed branch is testable. */
const defaultBinExists = (bin: string): boolean => Bun.which(bin) != null;

export function resolveAdapter(
  name: string,
  wf: LoadedWorkflow,
  binExists: (bin: string) => boolean = defaultBinExists,
): AdapterResolution {
  if (name === "fake") return { adapter: makeFakeAdapter(wf.fake) };
  if (name === "claude") {
    // A real adapter exists, but exit 3 (adapter_missing) if the CLI isn't on
    // PATH — tell the user what to install rather than failing mid-run.
    if (!binExists("claude")) return { missing: "claude", installHint: INSTALL_HINTS.claude! };
    return { adapter: makeClaudeAdapter() };
  }
  if (name === "codex") {
    if (!binExists("codex")) return { missing: "codex", installHint: INSTALL_HINTS.codex! };
    return { adapter: makeCodexAdapter() };
  }
  // pi lands here as it is built; until then, fail actionably.
  return {
    missing: name,
    installHint: INSTALL_HINTS[name] ?? `unknown adapter "${name}". Try --agent fake for the free demo.`,
  };
}

// ── process wiring (the bin entry calls runCommand) ─────────────────────────

export type Io = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Directory for journal files; defaults to ".omw". */
  omwDir?: string;
  runId?: () => string;
};

const defaultRunId = (): string => "r-" + Date.now().toString(36);

/** Wire real fs/import deps and run. Returns the exit code; writes the result
 *  JSON to stdout, the journal to <omwDir>/<runId>.jsonl, and any error JSON to
 *  stderr. Usage errors (parse failures) are exit 2. */
export async function runCommand(argv: string[], io: Io): Promise<number> {
  const parsed = parseRunArgs(argv);
  if (!parsed.ok) {
    io.stderr(JSON.stringify({ error: "usage", message: parsed.error }));
    io.stderr(
      "\nusage: omw run <workflow> --agent <fake|claude|codex|pi> [--args JSON] [--concurrency N] [--resume <journal.jsonl>] [--pretty]",
    );
    return 2;
  }

  const omwDir = io.omwDir ?? ".omw";
  const runId = (io.runId ?? defaultRunId)();
  const journalPath = join(omwDir, `${runId}.jsonl`);
  mkdirSync(omwDir, { recursive: true });

  // Resume: load the prior journal into an index. A read failure is exit 1 (an
  // unreadable --resume path is a user error, not a reason to silently run live).
  let resume: ResumeIndex | undefined;
  if (parsed.value.resume) {
    let lines: string[];
    try {
      lines = readFileSync(parsed.value.resume, "utf8").split("\n");
    } catch {
      io.stderr(JSON.stringify({ error: "resume_read_failed", path: parsed.value.resume }) + "\n");
      return 1;
    }
    resume = makeResumeIndexFromLines(lines);
    if (resume.size === 0) {
      // Readable but no cached nodes (empty/truncated/wrong file). Warn instead
      // of silently re-running every node live — which the user would read as a
      // free resume while paying full adapter cost.
      io.stderr(JSON.stringify({ warning: "resume_empty", path: parsed.value.resume }) + "\n");
    }
  }

  const events: string[] = [];
  const outcome = await runWorkflow(parsed.value, {
    loadWorkflow,
    resolveAdapter,
    journalSink: (line) => {
      events.push(line);
      appendFileSync(journalPath, line + "\n");
    },
    now: () => Date.now(),
    runId: () => runId,
    resume,
  });

  if (outcome.stdout !== undefined) io.stdout(outcome.stdout + "\n");
  if (outcome.error) io.stderr(JSON.stringify(outcome.error) + "\n");

  // Only surface the journal when a run actually recorded one — a load/adapter
  // failure (exit 1/3) writes no events, so pointing at an empty file misleads.
  if (events.length > 0) {
    if (parsed.value.pretty) io.stderr(renderTree(events) + "\n");
    io.stderr(`journal: ${journalPath}\n`);
  }
  return outcome.exitCode;
}

/** A phase/fan-out tree from journal JSONL lines — the --pretty side-channel and
 *  the shared renderer reused by `omw replay`. Pure: events in, string out. */
export function renderTree(lines: string[]): string {
  const out: string[] = [];
  let ok = 0;
  let failed = 0;
  for (const e of parseJournalLines(lines)) {
    switch (e.ev) {
      case "run_start":
        out.push(`run ${e.run}${e.wf ? ` (${e.wf})` : ""}`);
        break;
      case "phase":
        out.push(`  ▸ ${e.title}`);
        break;
      case "agent_start":
        out.push(`    • ${e.label ?? `call#${e.call}`} [${e.adapter}]`);
        break;
      case "agent_end":
        if (e.ok) ok++;
        else failed++;
        out.push(`      ${e.ok ? "✓" : `✗ ${e.kind ?? "fail"}`} call#${e.call}`);
        break;
      case "run_end":
        out.push(`run_end ok=${e.ok} · ${ok} ok / ${failed} failed`);
        break;
    }
  }
  return out.join("\n");
}
