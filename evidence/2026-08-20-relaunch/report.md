# 0.5.0 relaunch candidate — dogfood report

Status: **verified candidate, not published**  
Audited commit: `49d2f9ffda914bc759734a363fd28ace8b02fa52`  
Run: `r-mt1hd46x-1eeb-a64eeeb5`  
Workflow: [`.github/omw/relaunch-audit.ts`](../../.github/omw/relaunch-audit.ts)

## What ran

On 2026-08-20, oh-my-workflow ran its own release audit: six independent
source/repository checks, one schema-shaped synthesis, and one fresh-context
cross-check. Exact expected-node coverage was enforced before synthesis.

The three frozen-source analyses were resumed from a matching earlier journal.
The three repository checks, synthesis, and cross-check ran against the audited
commit above. The run ended successfully, and the cross-check returned
`accepted: true` with no issues. This is a consistency check, not independent
factual verification.

## Result

The narrowest supported position is:

> A pre-release, Bun-based workflow runtime for orchestrating concurrent
> repository checks into one shape-validated artifact, with bounded retries,
> shared budgets, journaling, resume support, and explicit partial-failure
> handling.

The strongest demonstrated use case is local and packed-artifact automation.
The audit identified four remaining release conditions: publish the registry
artifact, create the matching tag, resolve the 0.4.1 registry/tag sequencing,
and add a provenance-aware publish path before making stronger release claims.

This dogfood run led to concrete changes in the runtime and product surface:

- Codex output-token usage is parsed and budgeted; missing usage now fails a
  budgeted run instead of silently counting zero.
- nested workflow usage and resume-budget behavior have regression coverage;
- the removed positional workflow signature has a documented codemod path;
- onboarding claims now distinguish output shape from factual correctness;
- clean packed-artifact smoke tests cover the fake demo and project-local Skill
  installation;
- Codex Skill installation uses the current `.agents/skills` project path and
  replaces an existing install atomically.

Raw agent journals are retained locally rather than committed because prompts,
stderr, paths, and model output can contain sensitive repository material. The
public evidence is intentionally limited to this report and reproducibility
metadata.

## Independent release gates

The following checks passed at the audited commit:

- `bun run typecheck`
- `bun test`: 268 passed, 2 skipped, 0 failed
- opt-in live adapter tests: Claude 1 passed; Codex 1 passed
- `bun run docs:build`
- `bun run docs:check`
- clean install of the packed `oh-my-workflow-0.5.0.tgz`
- packed CLI execution of `examples/deep-research` with `--agent fake`
- packed Skill installation to `.agents/skills/omw`

The generated candidate tarball had SHA-256
`b51dc4e2654fba3356d3832c1d040e1733c832190cd2766453731b8c7fa1f8cc`.
It is not committed or published.

## Not released

At the time of this report:

- npm `latest` is still `0.4.0`;
- npm authentication was unavailable (`npm whoami` returned `E401`);
- no `v0.5.0` tag exists at the candidate;
- no branch, tag, or package was pushed or published.

The README therefore labels its `0.5.0` installation commands as post-publication
instructions and uses source-tree commands for the candidate demo.

## Claim boundary

This evidence does not claim a universal failure-receipt protocol, hard monetary
or input-token cost control, factual truth from JSON Schema, native-tool parity,
or production readiness across every adapter. Those require separate evidence.
