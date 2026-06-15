// `omw replay <journal.jsonl> [--json]`. Re-derives the phase / fan-out / stats
// view from a recorded journal. This is honestly a FIXTURE REPLAY — reading back
// what a run already recorded — NOT a live resume (re-executing from the longest
// unchanged prefix), which is v2 and layers on without a format change.

import { readFileSync } from "node:fs";
import type { Io } from "./run";
import { renderTree } from "./run";

export type ReplayArgs = { path: string; json: boolean };

export type ReplayParse = { ok: true; value: ReplayArgs } | { ok: false; error: string };

export function parseReplayArgs(argv: string[]): ReplayParse {
  let path: string | undefined;
  let json = false;
  for (const tok of argv) {
    if (tok === "--json") json = true;
    else if (path === undefined) path = tok;
    else return { ok: false, error: `unexpected argument: ${tok}` };
  }
  if (path === undefined) return { ok: false, error: "missing journal path" };
  return { ok: true, value: { path, json } };
}

export type ReplaySummary = {
  run?: string;
  wf?: string;
  phases: string[];
  calls: { total: number; ok: number; failed: number };
  failures: Array<{ call: number; kind?: string }>;
  ok?: boolean;
};

export function summarizeJournal(lines: string[]): ReplaySummary {
  const phases: string[] = [];
  const failures: Array<{ call: number; kind?: string }> = [];
  let run: string | undefined;
  let wf: string | undefined;
  let ok: boolean | undefined;
  let total = 0;
  let okCount = 0;
  let failed = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    switch (e.ev) {
      case "run_start":
        run = e.run;
        wf = e.wf;
        break;
      case "phase":
        phases.push(e.title);
        break;
      case "agent_end":
        total++;
        if (e.ok) okCount++;
        else {
          failed++;
          failures.push({ call: e.call, kind: e.kind });
        }
        break;
      case "run_end":
        ok = e.ok;
        break;
    }
  }

  return { run, wf, phases, calls: { total, ok: okCount, failed }, failures, ok };
}

/** Read a journal file and print either its reconstructed tree (default) or a
 *  structured summary (--json). Exit 2 on usage error, 1 if the file is
 *  unreadable, 0 otherwise. */
export function replayCommand(argv: string[], io: Io): number {
  const parsed = parseReplayArgs(argv);
  if (!parsed.ok) {
    io.stderr(JSON.stringify({ error: "usage", message: parsed.error }) + "\n");
    io.stderr("usage: omw replay <journal.jsonl> [--json]\n");
    return 2;
  }

  let lines: string[];
  try {
    lines = readFileSync(parsed.value.path, "utf8").split("\n");
  } catch (e) {
    io.stderr(JSON.stringify({ error: "read_failed", path: parsed.value.path }) + "\n");
    return 1;
  }

  if (parsed.value.json) {
    io.stdout(JSON.stringify(summarizeJournal(lines)) + "\n");
  } else {
    io.stdout(renderTree(lines) + "\n");
    io.stderr("(fixture replay — reconstructed from recorded journal, not a live resume)\n");
  }
  return 0;
}
