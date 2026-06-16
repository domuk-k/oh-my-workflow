#!/usr/bin/env bun
// The `omw` entry. Runs the .ts directly under bun (no build step) so
// `bunx oh-my-workflow run …` works on a stranger's machine. Dispatches the
// subcommand; the heavy lifting lives in the tested run/replay libraries.

import { runCommand } from "./run";
import { replayCommand } from "./replay";

const io = {
  stdout: (s: string) => process.stdout.write(s),
  stderr: (s: string) => process.stderr.write(s),
};

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "run":
      return runCommand(rest, io);
    case "replay":
      return replayCommand(rest, io);
    default:
      io.stderr(
        "usage: omw <command>\n\n" +
          "commands:\n" +
          "  run <workflow> --agent <fake|claude|codex|pi> [--args JSON] [--concurrency N] [--resume <journal.jsonl>] [--pretty]\n" +
          "  replay <journal.jsonl> [--json]\n\n" +
          "free demo (no API key):  omw run examples/deep-research --agent fake\n",
      );
      return cmd === undefined ? 2 : 2;
  }
}

main(process.argv.slice(2)).then((code) => process.exit(code));
