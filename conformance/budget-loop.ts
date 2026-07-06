// Conformance: a budget-bounded loop terminates when the ceiling is hit. Run
// with `--budget 100`; each node spends 40, so agent() throws BudgetExceededError
// on the third call and the run halts (exit 1, "budget exhausted").

export const meta = { name: "budget-loop" };

export default async function ({ agent }, _args) {
  const done = [];
  // No budget.remaining() guard on purpose: the ceiling itself must halt the
  // loop (agent() throws BudgetExceededError once spent >= total).
  while (true) {
    done.push(await agent(`step ${done.length}`));
  }
}

export const fake = { default: { text: "x", outputTokens: 40 } };
