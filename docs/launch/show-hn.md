# Show HN / GeekNews launch note

Title:

> Show HN: oh-my-workflow - add /omw workflow mode to your coding agent

Short post:

I built `oh-my-workflow`, a tiny Bun/TypeScript runtime plus agent skill for giving your coding agent a workflow mode. You add `/omw`, describe a multi-step job, and the agent writes and runs a plain-JS workflow whose nodes are whole coding-agent CLIs like `claude -p`, `codex exec`, and `hermes`.

The shape mirrors the dynamic workflow vocabulary people already reach for inside coding agents: `agent`, `parallel`, `pipeline`, `workflow`, `budget`, `phase`, and `log`. The difference is that omw runs outside any one host. It gives you a JSONL journal, bounded concurrency, schema-gated node output, automatic schema repair, run-level resume, and a deterministic fake adapter so anyone can try the full flow without an API key.

Try it from your coding agent:

```sh
npx skills add domuk-k/oh-my-workflow --skill omw
```

Then ask:

```text
/omw review this repo, fan out three bug-finding passes, verify the strongest claims, and return fixes with evidence.
```

The CLI defaults to `--agent auto`, so the generated workflow can run without making you choose Claude vs Codex in the onboarding path. For a no-key runtime demo, use `bunx github:domuk-k/oh-my-workflow run examples/deep-research --agent fake --pretty`.

Why now:

- Coding agents have become real CLIs, not just chat UIs.
- Multi-agent work keeps reimplementing the same glue: fan-out, verify, retry, resume, budget.
- Closed host-native workflow tools are useful, but the pattern should be portable across Claude Code, Codex, opencode, cron jobs, and CI.

What is deliberately small:

- No DSL.
- No source transform.
- No ambient globals.
- No sandbox by default.
- A node is a whole coding-agent CLI, not a raw LLM call.

Repo: https://github.com/domuk-k/oh-my-workflow
