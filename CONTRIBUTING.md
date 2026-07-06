# Contributing

Thanks for looking at oh-my-workflow. This is a small, sharp runtime — contributions that keep the spine tests green are welcome.

## Setup

```sh
bun install
bun test
bun run typecheck
```

Live adapter tests (`claude`, `codex`) run only with `OMW_LIVE=1` and the corresponding CLI installed.

## What to change where

| Change | Touch |
|--------|--------|
| Runtime contract (null-contract, journal events) | `src/runtime.ts`, `src/journal.ts`, tests in `test/runtime.test.ts` |
| Schema gate / JSON extract | `src/schema-gate.ts`, `test/schema-gate.*.test.ts` |
| CLI flags / exit codes | `src/cli/run.ts`, `test/cli.run.test.ts` |
| Adapters | `src/adapters/*`, matching `test/adapters.*.test.ts` |
| Agent authoring docs | `skill/SKILL.md` (keep in sync with CLI behavior) |
| Human docs / positioning | `README.md`, `ROADMAP.md`, `docs/site` via `bun run docs:build` |

## PR expectations

- Tests for behavior changes (red-green preferred for non-trivial logic).
- No drive-by refactors unrelated to the PR.
- Update `CHANGELOG.md` under `[Unreleased]` for user-visible changes.
- If you change CLI or skill behavior, update **both** `skill/SKILL.md` and `README.md`.

## Product shape

- **Agent-first:** `skill/SKILL.md` is the primary interface; humans read README + roadmap.
- **Nodes are whole agent CLIs**, not raw LLM API calls.
- **Honest scope:** label experimental adapters; do not silently no-op options (warn once).

See [ROADMAP.md](ROADMAP.md) for direction.