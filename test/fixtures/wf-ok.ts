// A minimal workflow fixture: default export is the orchestration fn; `fake`
// supplies deterministic fixtures consumed only by `--agent fake`.
import type { Runtime } from "../../src/runtime";
import type { FakeAdapterOptions } from "../../src/adapters/fake";

export const fake: FakeAdapterOptions = { default: { text: "fixture-result" } };

export default async function (rt: Runtime, args: unknown) {
  rt.phase("Only");
  const out = await rt.agent("do the thing");
  return { out, args };
}
