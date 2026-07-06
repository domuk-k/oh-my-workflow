// Minimal liveness workflow for the smoke harness (scripts/smoke-live.sh).
// One node with a forgiving schema — it exercises the adapter plumbing + the
// schema gate end-to-end without depending on the agent doing anything clever.
// `--agent fake` returns the canned JSON; a live adapter must produce {"ok":true}.

export const meta = { name: "smoke" };

export default async function ({ agent }, _args) {
  const r = await agent('Reply with ONLY this JSON and nothing else: {"ok": true}', {
    schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } }, additionalProperties: false },
    label: "smoke",
  });
  return { ok: r?.ok === true };
}

export const fake = { default: { text: '{"ok":true}' } };
