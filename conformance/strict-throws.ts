// Conformance: a script that reaches for wall-clock time fails under `--strict`.
// Run with strict:true → exit 1 (script_error mentioning strict). The same script
// without --strict completes. Proves the determinism sandbox is enforced.

export const meta = { name: "strict-throws" };

export default async function ({ agent }, _args) {
  const t = Date.now(); // forbidden under --strict
  const x = await agent("go");
  return { t, x };
}

export const fake = { default: { text: "ok" } };
