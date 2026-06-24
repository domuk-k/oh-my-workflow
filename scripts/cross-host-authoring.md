# Cross-host authoring test

Proves the **agent-agnostic** claim: a *host* coding agent (Claude Code, Codex,
opencode, Hermes), given the omw skill, can author a runnable omw workflow and run
it. This is distinct from the *node adapter* (`--agent X`): here X is the **author**,
not the node runtime.

> Node-adapter coverage (X as the runtime) is the smoke harness:
> `OMW_LIVE=1 ./scripts/smoke-live.sh`. This doc covers X as the **author**.

## 1. Install the skill into each host

```sh
omw skill install              # Claude Code   → ~/.claude/skills/oh-my-workflow
omw skill install --codex      # Codex         → ~/.codex/skills/oh-my-workflow
omw skill install --opencode   # opencode      → ~/.config/opencode/skills/oh-my-workflow
# Hermes: it has its own skills system — `hermes skills` — or point it at the file:
omw skill path                 # prints the bundled SKILL.md to feed any host
```

## 2. Canonical authoring task (paste into each host)

> Use oh-my-workflow to write `wf.ts`: fan out 3 searches over a `queries` arg with
> `parallel`, each a schema-gated `agent()` returning `{ topic, hits }`, drop
> failures with `filter(Boolean)`, and return `{ found, count }`. Co-export a
> `fake` fixture so `omw run wf.ts --agent fake` is green. Then run it.

A correct host produces a destructured-DI default export
(`export default async function ({ agent, parallel }, args)`), a JSON Schema per
node, and a `fake` fixture with `rules[].match` predicates.

## 3. Verify whatever the host authored (host-agnostic)

```sh
omw validate wf.ts                       # loads + lints the fake fixture, spawns nothing
omw run wf.ts --agent fake --pretty      # must exit 0 with a schema-valid result JSON
omw run wf.ts --agent fake --args '{"queries":["a","b","c"]}'
```

Pass = `validate` clean + `run --agent fake` exit 0 + a result matching the task.

## 4. Scorecard (fill per host)

| host | skill found | authored DI shape | fake fixture valid | `--agent fake` green | notes |
|------|-------------|-------------------|--------------------|----------------------|-------|
| Claude Code | | | | | |
| Codex | | | | | |
| opencode | | | | | |
| Hermes | | | | | |

A host that produces legacy `(rt, args)` or a broken fixture is a SKILL clarity
bug — feed the failure back into SKILL.md (the skill is the product).
