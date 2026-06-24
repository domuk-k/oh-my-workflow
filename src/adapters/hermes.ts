// The hermes adapter (EXPERIMENTAL) — now just a config over the generic
// exec-adapter (src/adapters/exec.ts). `hermes -z/--oneshot <prompt>` prints ONLY
// the agent's final response text to stdout, so stdout IS the result (omw's
// schema gate extracts JSON from it when a `schema` is set). `--yolo` runs the
// node non-interactively. No in-session followUp (no session id on stdout) → the
// schema gate falls back to fresh invokes. No cost field.

import type { AgentPort } from "./types";
import { makeExecAdapter, type ExecAdapterConfig, type ExecAdapterDeps } from "./exec";

export const hermesExec: ExecAdapterConfig = {
  name: "hermes",
  bin: "hermes",
  // `--yolo` so a headless node isn't blocked on tool-confirmation prompts.
  argv: ({ prompt, model }) => {
    const args = ["-z", prompt, "--yolo"];
    if (model) args.push("-m", model);
    return args;
  },
};

export function makeHermesAdapter(deps: ExecAdapterDeps = {}): AgentPort {
  return makeExecAdapter(hermesExec, deps);
}
