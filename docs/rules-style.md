# AI Rule Style Guide for Project-Specific CLAUDE.md

This guide is for writing short, high-signal, low-noise rules in project CLAUDE.md files.

## 3.1 Golden formula

Use: `Don't X. Instead Y. Because Z.`

- Good: `Don't push secrets or config artifacts. Instead commit only source and lockfiles. Because secrets and host-path leaks are hard to scrub from history.`
- Bad: `Don't do bad things with secrets. Instead be safe.`
- Bad: `Write secure code. Because security matters.`  

Keep formulas concrete and tied to real behavior.

## 3.2 Survival test (4 conditions)

Rule passes only if all four conditions hold:
1. The model cannot infer this action itself.
2. It prevents a recorded failure pattern.
3. It has explicit scope and boundary.
4. It does not create worse edge-case failures.

- Pass: `Don't merge before tests pass. Instead run `npm test` / `pytest` and capture output. Because unverified behavior blocks future debugging.`
- Fail: `Don't be careless.` (model can infer, no boundary, no failure story).
- Fail: `Don't use Python.` (no context-specific failure, and blocks broad adoption).

## 3.3 Specificity has two mechanisms

### Pattern matching

- Good: `Don't add `console.log` to `src/` except in temporary debug scripts. Instead use structured logs in `runtime/`. Because ad-hoc logs can leak internals.`
- Good: `Don't import from `lodash/flatten`. Instead use `Array.prototype.flat()`. Because dependency surface stays smaller.`
- Bad: `Don't use bad imports.` (too vague to match reliably).

### Reasoning interception

- Good: `"Looks fine in my head" → `"looks fine" is an untested signal. Run tests and linters.` because false confidence is common.
- Good: `"Likely harmless" → `"likely" is insufficient for shared state. Verify with a focused run.` because uncertainty cannot be a release gate.
- Bad: `"I think this is okay" → [no follow-up action]`.

## 3.4 Emphasis budget table

| marker | upper bound / file | intended use | forbidden use |
|---|---:|---|---|
| IMPORTANT | ≤ 4 | irreversible operations, safety, data integrity | style preferences |
| NEVER | ≤ 4 | high-impact destructive actions | optional conventions |
| CRITICAL | 0 | reserved for platform-level safety system rules | custom project rules |

- Good: `IMPORTANT: Don't rewrite lockfiles manually in feature commits. Instead regenerate with package manager only. Because lockfile drift hides dependency intent.`
- Bad: `IMPORTANT` on cosmetic naming notes.
- Bad: `CRITICAL` for local conventions.

## 3.5 Density target

Target density: 1–2 keyword-marked rules per 1000 words.

- Good: A short file with 12 lines has one `IMPORTANT` and one `NEVER`, both behavior blockers.
- Good: A 900-word file keeps one `NEVER` and one `IMPORTANT`.
- Bad: The same file has 10 tagged warnings and loses compliance.

## 3.6 Negative-first: Don't → Instead → Because

This ordering narrows action space before opening alternatives.

- Good: `Don't overwrite another branch's HANDOFF section. Instead update only `## {branch}` for your branch. Because parallel sessions can share context safely.`
- Good: `Don't skip pre-push tests for risky refactors. Instead run `npm test`/`pytest` first. Because broken changes are cheapest to catch before sharing.`
- Bad: `Run tests, and don't skip because this is small.` (opens with action, weak boundary).

## 3.7 Scope boundaries

Each boundary rule must state when it does not apply.

- Good: `Create a branch for `docs/` only updates? No, create one for feature, bugfix, and refactor; exception: typo-only documentation patches are allowed directly in `docs/` branches.`
- Good: `NEVER commit generated binaries. Always stage source and lockfiles. Exception: emergency patch branches that rebuild release artifacts with explicit maintainer approval.`
- Bad: `Always create a branch.` without exception for no-op docs fixes.

## 3.8 Context frame > rule list

Organize rules as a decision frame, not a giant numbered checklist.

- Good:  
  `Evaluate action by impact (shared state, reversibility, validation needs), then choose one rule group.`  
- Good:  
  `Start from intent (what must stay unchanged), then apply specific constraints (who, when, where).`
- Bad:  
  `15 rules with no shared ordering` (scanner-like list causes model fatigue).

Use sections such as:
- `Execution safety`
- `Commit protocol`
- `Review and handoff`

and keep each section tied to practical decision flow.

## 3.9 Subsystem CLAUDE.md — grow by failure, not by template

The root `CLAUDE.md` answers "what is this repo?". A subsystem `CLAUDE.md` (e.g. `src/parser/CLAUDE.md`) answers "what does an agent need to know before touching *this* directory?".

Rules:

- Start the file empty (just the skeleton from `configs/templates/subsystem-CLAUDE.md`).
- Add a line *only* when an agent made a mistake here that a rule would have prevented. Every line cites a real failure.
- Delete lines that no longer apply. Old "gotchas" create noise when the underlying cause is fixed.
- Scope is *only this directory*. Anything broader belongs in the root `CLAUDE.md`.

Why: agent attention is finite (IFScale). Subsystem rules that only load when work happens *in that directory* stay out of the global context budget and still catch recurring mistakes at their origin.

## 3.10 Plan files — one step, one verify

For multi-step work (3+ sequential actions, or 2+ files that must change in lockstep), write a plan first. Use `configs/templates/plan.md`. The rule:

- **One step = one atomic action + one mechanical verify.**
- If `Verify` reads as "check manually that it feels right", the step isn't atomic — split further.
- Each step declares its rollback before the next step starts.

Good step:

```
### 3. Add strict-mode flag to parser

- Action: Edit src/parser/config.ts to accept `strict: boolean`, default false.
- Verify: `npm test -- parser/config` passes 4 tests including new "strict flag accepted" case.
- Rollback: git restore src/parser/config.ts tests/parser/config.test.ts
```

Bad step:

```
### 3. Make parser better

- Action: Improve error handling.
- Verify: Review output.
```

Why: without mechanical verify, you can't tell whether AI actually completed the step or hallucinated success. Atomic verify turns agent work into a loop the harness can drive — see `atomic-dev-environment.md` §任务原子化.

## 3.11 Delete Chat Test — the honest repo-quality check

A simple way to tell whether your repo is actually AI-friendly or whether the context lives in your head:

1. Delete the current chat history (or start a fresh agent session).
2. Hand the agent the same task you were just working on.
3. Watch what happens.

If the new agent succeeds: your repo carries the context — the harness works.

If the new agent gets stuck / asks you things you already "knew" / rebuilds something that was almost done: context was in *your* head, not the repo. That gap is an asset for today but a liability for every future session (your own included). Fix the harness: write the missing fact into `CLAUDE.md`, a subsystem `CLAUDE.md`, a comment, a test, or a plan file — wherever an agent would look for it next time.

This is the same reflex as wiki B7 ("fix the harness, not try harder"), made testable. Run it whenever the same thing keeps frustrating you across sessions.

## 3.12 Error messages — four-part format

Every hook, script, or linter error that a human or agent will see should answer four questions:

```
error: <what went wrong>
  Rule: <the policy being enforced, in one sentence>
  Fix:  <concrete action the reader should take next>
  See:  <file or section pointing at more context>
```

Good — from VibeKit's pre-commit hook:

```
error: direct git commit blocked — use scripts/committer
  Rule: This repo routes every commit through scripts/committer for scoping + PII scan.
  Fix:  scripts/committer "<message>" <file...>
  See:  docs/rules-style.md — Commit protocol
```

Bad:

```
error: commit blocked
```

(What blocked it? Why? What do I do now?)

Why it matters: an agent that hits a hook error decides its next action from the error text alone. Without Fix/See, it will retry the same command and fail again. With them, it has a scripted recovery path.
