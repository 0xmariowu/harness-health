# Copilot instructions for AgentLint

AgentLint is a shell-based linter for AI-friendly repos. It scans for CLAUDE.md/AGENTS.md quality, CI hygiene, and agent-ready patterns, then emits SARIF + scored reports. Primary language is bash (`src/scanner.sh` + 49 rules across 8 dimensions), with a TypeScript CLI wrapper and npm publishing pipeline.

Any Copilot agent (Coding Agent, Code Review, ci-doctor) working on this repo must follow the rules below.

## Hard rules — never violate

1. **No test assertion mutation.** If a test is failing, fix the code or file a bug — never change the expected value in an assertion to make it pass.
2. **No lint / type / test suppressions.** No `@ts-ignore`, `# noqa`, `// eslint-disable`, `it.skip`, `@pytest.mark.skip`, or equivalent. The tool raised it for a reason.
3. **No weakening of CI, workflows, or build config.** Do not edit `.github/workflows/**`, `Makefile`, `tsconfig.json`, `package.json` scripts, or test config to make things pass. Fix the code instead.
4. **No deleting or skipping tests** to resolve a failure.
5. **No unrelated refactors.** Only change lines directly required by the task. A bug fix does not need surrounding cleanup.
6. **No features, abstractions, or error handling the task did not ask for.** Three similar lines beats a premature abstraction. Don't validate scenarios that cannot happen.
7. **No absolute hardcoded paths** (`/Users/...`, `/home/...`). Use `${CLAUDE_PLUGIN_ROOT}`, env vars, or repo-relative paths.
8. **No emoji** in code, comments, commit messages, or markdown unless explicitly requested.
9. **No new top-level files** (README alternates, design docs, notes) unless the task explicitly asks.
10. **No commits to `main`.** All changes go through a PR.

## Scope discipline for this repo

- **Adding a check requires evidence.** Cite an Anthropic source, academic paper, or documented real-world failure in `standards/evidence.json`. Opinions are not acceptable.
- **Scanner output is a contract.** Changing the JSONL schema in `src/scanner.sh` requires updating the scorer, plan-generator, and reporter in the same PR.
- **Scoring changes require rationale in `standards/weights.json`.** Do not adjust weights silently.
- **Thresholds in shell code must match `standards/evidence.json`.** Do not hardcode a new number without updating the evidence file.
- **Skills in `commands/*.md`** must reference bundled assets via `${CLAUDE_PLUGIN_ROOT}`. Persistent data goes in `${CLAUDE_PLUGIN_DATA}` or `~/.al/`, never the plugin root.

## Commit and PR format

- Branch names: `feature/{desc}`, `fix/{desc}`, `chore/{desc}`. Never develop on `main`.
- Commit subject: `{type}: {description}` where type is one of `feat | fix | refactor | test | docs | chore | ci | style`.
- One commit = one logical change. Source code first, tests second, docs/config third. Do not batch unrelated changes.
- Feature commits without a paired test commit will fail the `test-required` check.
- Commit messages and PR descriptions: English, professional, no AI boilerplate ("Generated with...", "🤖").
- Do not stage `.env*`, credentials, `node_modules/`, `__pycache__/`, or `.git/` internals.

## CI-fix specific rules (ci-doctor / `@copilot fix CI`)

When asked to fix a failing CI check:

- **20-line soft cap on the diff.** If the minimal fix needs more than ~20 changed lines, post a diagnosis comment instead of pushing code.
- **Classify the failure first.** Environmental (flaky network, runner timeout, upstream outage) → recommend rerun, do not push. Permanent code issue → minimal fix only.
- **Never rewrite history** (no force-push, no `git commit --amend` on pushed commits, no rebasing the PR branch).
- **Enum / union / literal changes:** if the diff adds a new value to an enum or string-literal set, grep every consumer and verify each switch/match covers the new case. Unhandled values cause silent fallthrough.

## Testing

- Shell scanner rules have fixtures in `tests/test-scanner.sh`. Every rule change needs a matching fixture.
- Run `tests/test-scanner.sh` locally before pushing.
- Accuracy baseline lives in `standards/accuracy-baseline.json` — do not overwrite without running the full accuracy job.

## Language

- All code, comments, commits, and file content must be in English.
- Comments: default to none. Only explain a non-obvious WHY — a hidden constraint, a subtle invariant, a workaround for a specific upstream bug. Do not describe WHAT the code does. Do not reference the current task, PR, or issue number in comments.

## When to stop and ask

- The task requires editing `.github/workflows/**`, branch protection rules, or release configuration.
- The task touches `src/scanner.sh` rule output format.
- The fix requires more than 20 lines or touches more than 3 files.
- Any ambiguity about whether a test failure is real or environmental.

In these cases, post a diagnosis comment explaining what you found and what the human needs to decide. Do not push a guess.
