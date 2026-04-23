# Plan: {topic}

> One plan = one outcome. Keep this file short. Each step must be a single
> atomic action with a mechanical verification. If you can't describe how to
> verify a step, it's not atomic yet — split it further.

## Goal

<!-- One sentence. What state does the codebase reach when this plan is done? -->

## Non-goals

<!-- What is explicitly out of scope. Prevents scope creep during execution. -->

## Steps

Each step has three parts:

- **Action** — a single command, edit, or concrete change
- **Verify** — a mechanical check that proves the step succeeded
- **Rollback** — how to undo if verify fails

### 1. {short description}

- **Action**: …
- **Verify**: `…` (a command whose exit code / output tells you pass or fail)
- **Rollback**: …

### 2. {short description}

- **Action**: …
- **Verify**: …
- **Rollback**: …

<!-- Add more steps as needed. If any step's Verify reads like
     "manually check that X feels right", it is not atomic — refine it until
     the check is executable. -->

## Risks

<!-- Known failure modes. For each: what would happen, how you'd detect it,
     and the mitigation built into the steps above. -->

## Commit strategy

<!-- Expected commit shape. Example:
     - Step 1-2: one commit — `feat(parser): add strict mode flag`
     - Step 3:   one commit — `test(parser): strict mode coverage`
     - Step 4:   one commit — `docs(parser): strict mode section`
-->
