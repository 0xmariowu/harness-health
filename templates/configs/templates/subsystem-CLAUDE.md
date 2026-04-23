# CLAUDE.md — {subsystem name}

> This file overrides the repo-root CLAUDE.md *only* for work inside this directory.
> Start this file empty. Add a line *only* when an agent working here makes a
> mistake that a rule would have prevented. Every line earns its place by
> answering a real failure.

## What this directory owns

<!-- One sentence. What is this subsystem responsible for? What is it *not*? -->

## Boundary rules

<!-- Rules that apply *only* inside this directory. Each one must cite the
     specific mistake it prevents. Delete rules that stop being relevant.

     Good: "Don't import from ../api/*. Instead use the request helper in
     ./client.ts. Because cross-layer imports broke the mock in 2026-03."

     Bad: "Write clean code."
-->

## Known gotchas

<!-- Subtle things an agent has gotten wrong here. One bullet per issue.
     Example: "Tests in this directory need TZ=UTC — otherwise the
     snapshot fixtures drift by one day on macOS runners."
-->

## Session checklist

<!-- Conditional pointers: "if you're doing X, read Y first".
     Example:
     1. Adding a new endpoint → read ./router.ts + ./schemas/*.ts
     2. Changing an error path → run `npm run test:errors`
-->
