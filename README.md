# oh-my-workflow

> Run the coding-agent CLIs you already have — `claude -p`, `codex exec`, `pi --print` —
> as nodes in a plain-JS workflow your host agent writes. omw is the thin
> deterministic glue: it runs the script, schema-gates each node's output, and
> journals every step so the agent can read its own failure and repair its own script.

**Status: early WIP (2026-06-14).** The runtime core is built and green; it is not
yet a runnable CLI. This repo currently ships the engine + its test spine, not a
launch. The launch positioning, full docs, and `--agent fake` CLI are tracked in
the handoff (see below) — do not treat anything here as finished marketing copy.

## What's here today

The load-bearing core, built TDD-first, `bun test` green:

| Module | Role |
|---|---|
| `src/runtime.ts` | `makeRuntime` — the 5 hooks (`agent`/`pipeline`/`parallel`/`phase`/`log`), the null-contract, the concurrency limiter |
| `src/schema-gate.ts` | deterministic JSON extraction → ajv validate → ≤2 retries → `null` (never throws) |
| `src/journal.ts` | JSONL event log + stable resume keys `(callIndex, promptHash, optsHash)` |
| `src/adapters/types.ts` | the `AgentPort` contract every adapter implements |
| `src/adapters/fake.ts` | the deterministic fake adapter (test double **and** the future `--agent fake` demo) |

**The null-contract** is the invariant everything stands on: `agent()` never throws;
a terminal failure resolves to `null` and a journal entry carrying the failure
`kind` (+ `stderr`/`rawText` so the authoring agent can self-repair).

## Run the tests

```sh
bun install
bun test            # 66 tests, the full 5-hook spine + self-repair cycle
bun test --coverage # ~99% lines; runtime/journal/fake at 100%
bun run typecheck   # tsc --noEmit, clean
```

The gate test (`test/spine.test.ts`) runs one full `scope → search → verify →
synthesize` pass against the fake adapter, including a scripted
schema-fail → self-repair → `filter(Boolean)` survival cycle. Green here = the
walking skeleton exists. It is also exactly the `--agent fake` hero demo, once the
CLI runner lands.

## Design & strategy

- Product spec: [`docs/specs/2026-06-12-oh-my-workflow-design.md`](docs/specs/2026-06-12-oh-my-workflow-design.md)
- Launch strategy + evaluation scorecard: [`docs/specs/2026-06-14-omw-launch-strategy.md`](docs/specs/2026-06-14-omw-launch-strategy.md)
- Next steps (MVP → launch): [`docs/specs/2026-06-14-handoff.md`](docs/specs/2026-06-14-handoff.md)

## License

MIT
