// `omw run <wf> --agent <a> [--args JSON] [--concurrency N] [--pretty]`.
// Parsing is a pure function so the input contract is testable without touching
// the filesystem, a clock, or a subprocess.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentPort } from "../adapters/types";
import { makeFakeAdapter, type FakeAdapterOptions } from "../adapters/fake";
import { makeClaudeAdapter } from "../adapters/claude";
import { makeCodexAdapter } from "../adapters/codex";
import type { Runtime, WorkflowMeta } from "../runtime";
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
      case "--concurrency": {
        const raw = argv[++i];
        const n = Number(raw);
        if (raw === undefined || !Number.isInteger(n) || n < 1) {
          return { ok: false, error: `--concurrency must be a positive integer, got: ${raw}` };
        }
        concurrency = n;
        break;
      }
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
  /** Optional `export const meta` describing the workflow (name/phases/model). */
  meta?: WorkflowMeta;
};

/** Either a ready adapter, or a structured "not installed" signal (exit 3). */
export type AdapterResolution =
  | { adapter: AgentPort }
  | { missing: string; installHint: string };

/** Entry filenames tried, in order, when a workflow path is a directory. */
const ENTRY_NAMES = ["workflow.ts", "workflow.js", "index.ts", "index.js"];

/** Package root, so bundled paths (e.g. `examples/…`) resolve when omw is
 *  installed and invoked from an arbitrary cwd, not only from inside a clone. */
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Resolve a workflow path: an absolute path as-is; otherwise cwd-relative
 *  (the user's own workflows) first, then package-relative as a fallback so the
 *  shipped `examples/…` demo runs post-install. The cwd path is kept for the
 *  not-found error so the message points where the user actually looked. */
export function resolveWorkflowPath(wfPath: string): string {
  if (isAbsolute(wfPath)) return wfPath;
  const fromCwd = resolve(process.cwd(), wfPath);
  if (existsSync(fromCwd)) return fromCwd;
  // Fall back to the package-bundled demo ONLY for the `examples/` namespace, so
  // a user's mistyped workflow path can't silently resolve to a shipped file.
  if (wfPath === "examples" || wfPath.startsWith("examples/")) {
    const fromPkg = resolve(PKG_ROOT, wfPath);
    if (existsSync(fromPkg)) return fromPkg;
  }
  return fromCwd;
}

/** Load a workflow module from a file path or a directory (resolved to its
 *  conventional entry). The default export is the orchestration fn; a missing
 *  default is an authoring bug surfaced as a load error, not a silent no-op. */
export async function loadWorkflow(wfPath: string): Promise<LoadedWorkflow> {
  const abs = resolveWorkflowPath(wfPath);
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
    throw new Error(
      `workflow ${wfPath} must default-export a function ({ agent, parallel, pipeline, phase, log, workflow, budget }, args) => result (legacy (rt, args) still supported)`,
    );
  }
  return { workflow: mod.default, fake: mod.fake, meta: mod.meta };
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

/** True when a workflow's first param is NOT an object-destructuring pattern,
 *  i.e. the legacy positional `(rt, args)` shape. Used only to emit a
 *  deprecation nudge — never to dispatch, since the same object satisfies both
 *  contracts. A source sniff via Function.prototype.toString; heuristic by
 *  nature (it can't see through a bound/wrapped fn), but a non-fatal warning is
 *  the right altitude for a heuristic. */
function isLegacyShape(fn: Function): boolean {
  const src = Function.prototype.toString.call(fn);
  return !/^\s*(async\s+)?function\s*\*?\s*\(\s*\{|^\s*\(\s*\{|^\s*async\s*\(\s*\{/.test(src);
}

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
  // One spend accumulator for the whole run: parent + any nested workflow()
  // child point at it, so the token pool is shared (matches native).
  const budgetState = { spent: 0 };
  const rt = makeRuntime({
    adapter: resolved.adapter,
    journal,
    concurrency: opts.concurrency,
    resume: deps.resume,
    budgetState,
    meta: loaded.meta,
  });

  // workflow(ref, args?) runs another workflow inline as a sub-step, sharing the
  // resolved adapter + journal + spend pool. One level only: a workflow() inside
  // a child throws, so a runaway recursion can't hide behind the null-contract.
  const makeWorkflowHook = (depth: number) =>
    async (ref: string | { scriptPath: string }, childArgs?: unknown): Promise<unknown> => {
      if (depth >= 1) throw new Error("workflow() nesting is one level only");
      const childPath = typeof ref === "string" ? ref : ref.scriptPath;
      const childLoaded = await deps.loadWorkflow(childPath);
      const childRt = makeRuntime({
        adapter: resolved.adapter,
        journal,
        concurrency: opts.concurrency,
        resume: deps.resume,
        budgetState,
        meta: childLoaded.meta,
      });
      const childHooks = { ...childRt, workflow: makeWorkflowHook(depth + 1) };
      return await childLoaded.workflow(childHooks as unknown as Runtime, childArgs);
    };

  journal.runStart({ run: runId, wf: opts.wfPath });
  try {
    // The SAME runtime object satisfies both authoring contracts: a legacy
    // `(rt, args)` script reads `rt.agent`, a new `({ agent }, args)` script
    // destructures it. No execution-time dispatch — only the deprecation nudge
    // needs to detect the legacy positional shape. `workflow` is layered on here
    // (not in makeRuntime) since nesting needs the loader + resolved adapter.
    const hooks = { ...rt, workflow: makeWorkflowHook(0) };
    if (isLegacyShape(loaded.workflow)) {
      deps.stderr?.(
        "omw: deprecation — positional `rt` authoring is deprecated; destructure hooks `({ agent, ... }, args)`. Removed in 0.5. Run `omw codemod`.",
      );
    }
    const result = await loaded.workflow(hooks, opts.args);
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

  // Resume: load the prior journal into an index. A read failure is exit 1 (an
  // unreadable --resume path is a user error, not a reason to silently run live).
  let resume: ResumeIndex | undefined;
  if (parsed.value.resume) {
    // Accept either a journal path or a bare runId: if the arg isn't an existing
    // file, treat it as a runId and resolve <omwDir>/<runId>.jsonl (the path the
    // run wrote its journal to). Lets `--resume <runId>` mirror the runId printed
    // on the prior run without the caller reconstructing the path.
    const resumeArg = parsed.value.resume;
    const resumePath = existsSync(resumeArg) ? resumeArg : join(omwDir, `${resumeArg}.jsonl`);
    let lines: string[];
    try {
      lines = readFileSync(resumePath, "utf8").split("\n");
    } catch {
      io.stderr(JSON.stringify({ error: "resume_read_failed", path: resumePath }) + "\n");
      return 1;
    }
    resume = makeResumeIndexFromLines(lines);
    if (resume.size === 0) {
      // Readable but no cached nodes (empty/truncated/wrong file). Warn instead
      // of silently re-running every node live — which the user would read as a
      // free resume while paying full adapter cost.
      io.stderr(JSON.stringify({ warning: "resume_empty", path: resumePath }) + "\n");
    }
  }

  const events: string[] = [];
  const outcome = await runWorkflow(parsed.value, {
    loadWorkflow,
    resolveAdapter,
    journalSink: (line) => {
      events.push(line);
      // Create .omw/ lazily on the first journal line, so a failed load/adapter
      // resolution (which records nothing) doesn't litter an empty directory.
      if (events.length === 1) mkdirSync(omwDir, { recursive: true });
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
