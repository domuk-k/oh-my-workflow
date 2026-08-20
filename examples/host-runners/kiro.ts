#!/usr/bin/env bun
// Tiny Kiro host runner: probe the live subagent tool → runInSessionWorkflow.
// Usage: bun examples/host-runners/kiro.ts <workflow> [--args JSON]

import { probeInSessionHost } from "oh-my-workflow/adapters/in-session-probe";
import { runInSessionWorkflow } from "oh-my-workflow/in-session";

const [wfPath, ...rest] = process.argv.slice(2);
if (!wfPath) {
  console.error("usage: bun examples/host-runners/kiro.ts <workflow> [--args JSON]");
  process.exit(2);
}

let args: unknown;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--args") args = JSON.parse(rest[++i]!);
}

const outcome = await runInSessionWorkflow(
  { wfPath, args, strictResume: true },
  {
    probe: probeInSessionHost,
    stderr: (line) => process.stderr.write(line),
  },
);

if (outcome.stdout) process.stdout.write(outcome.stdout + "\n");
if (outcome.error) process.stderr.write(JSON.stringify(outcome.error) + "\n");
process.exit(outcome.exitCode);