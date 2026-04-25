> For global rules, see `~/CLAUDE.md`. This file contains project-specific overrides only.

# CLAUDE.md — __PROJECT_NAME__

## Scope

- **Project:** __PROJECT_NAME__
- **Language:** __LANGUAGE__
- **Package manager:** __PACKAGE_MANAGER__

Keep this file short. It should define only project-specific behavior that is not already in `~/CLAUDE.md`.

## Local test (run before push)

```bash
# TODO: fill in your fast local test command (target: < 5s)
# Examples: pytest tests/unit/ -x -q | npm test | bash tests/compliance_check.sh
```

## Session Checklist

1. If touching CI, tests, or release flow, read `.github/workflows/` first.
2. If changing hooks or commit flow, read `.husky/` and `scripts/committer`.
3. If resuming interrupted work, read `HANDOFF.md` section for your branch, then `CHANGELOG.md`.

## Harness architecture — Hook / AI / Human

Every guard in this repo belongs to one of three layers. Misclassifying = false positives block normal work, or the opposite: breaches slip through a layer that couldn't judge them.

| Layer | Does | Does NOT | Fires when |
|---|---|---|---|
| **Hook** | Mechanical checks — format, typecheck, branch protection, gitleaks, hygiene scans, size limits | Judgment (can't decide "is this code good") | Unconditionally, on every action |
| **AI** | Judgment — code review, security scan, build repair, test generation, architecture advice | Final approval of anything irreversible | The AI decides |
| **Human** | Approve irreversible actions — push, merge, release, data deletion | Sustain mechanical repetition | At critical junctures |

A reviewer agent's pass mark is **not** a substitute for a human approval on irreversible actions. See `docs/rules-style.md` §3.0 for the full explanation.

## Dangerous operations — ask before invoking

The agent must ASK the human and wait for explicit confirmation before running any of these. A reviewer agent's pass mark is not enough.

| Operation | Why dangerous | Instead |
|---|---|---|
| `rm -rf` / bulk file deletion | One misstep loses a day's work | List files first, confirm with human, then delete |
| `git push --force` / `git reset --hard` | Overwrites history, loses uncommitted work | Push-gate hook + human approval; never agent-initiated on `main` |
| DB migration (prod / staging) | Data is irreversible | Dry-run first, human approval, prod requires a second reviewer |
| Prod deploy | Affects real users | Agent opens a deploy PR; does not deploy directly |
| `git filter-repo` / history rewrite | Breaks every collaborator's local clone | Only during incident response — see `docs/history-rewrite-runbook.md`; must be announced |
| `drop table` / `truncate` / unscoped `delete from` | Data loss | Dedicated migration flow, never ad-hoc SQL |

**Secrets are a separate class — not in the table above.** The agent never reads, echoes, or writes back an `$API_KEY`-shaped value. Reference by name only (`$OPENROUTER_API_KEY`); let the shell expand it. If a pre-commit hook strips a secret from your diff, investigate upstream — don't `--no-verify`.

## Commit Rules

- Don't push direct from `main`. Instead work on `feature/{desc}` or `fix/{desc}` and use PRs. Because reviewers and CI gates depend on isolated histories.
- Don't stage broad changes with `git add .`. Instead stage only intended files per commit. Because unrelated changes weaken review clarity.
- Don't ignore static checks for speed. Instead rerun lint/tests before requesting review. Because merge quality degrades when checks are skipped.
- Don't open a feature PR without a corresponding `test(...)` commit in the same PR. Instead write the test commit alongside or immediately after the `feat(...)` / behavior-scoped `fix(...)` commit. Explicit opt-out via the PR template's "No tests needed because:" checkbox with a stated reason. The `test-required` workflow scans commit types and warns (or blocks in Phase 2) accordingly. Because unenforced rules become invisible and untested features are untested assumptions.

## Ship vs Local vs Never

Every file belongs to exactly one tier. See `docs/ship-boundary.md` for the full rule set.

- **SHIP** — tracked in git, published publicly. Product + governance (`configs/**`, root `README.md` / `CLAUDE.md` / `CHANGELOG.md` / `LICENSE`).
- **LOCAL** — on disk, gitignored. Session / per-contributor state (`HANDOFF.md`, `.claude/`, `experience/`, `docs/reports/`, `.ship-boundary-deny.local`).
- **NEVER** — must not exist in tracked files. Secrets, `/Users/<name>/` paths, inline API keys, internal codenames, past-tense "removed X" phrasing in CHANGELOG.

Before creating a new file: (1) will downstream users need it? → SHIP candidate; (2) does it contain personal identifiers or internal names? → scrub or demote to LOCAL; (3) is it only meaningful for this session? → LOCAL. Default unresolved answers to LOCAL.

## Truth Hierarchy

When documents, code, and runtime behavior disagree, resolve in this order:

1. **Runtime behavior** — what the code actually does. Reproduce the discrepancy first.
2. **Code + tests** — the source and the assertions that gate it.
3. **Configuration** — `configs/*`, `.github/workflows/*`.
4. **Documentation** — `CLAUDE.md`, `README.md`, `docs/*`.

Docs describe intent; code encodes behavior. When they conflict, the docs are stale — update them to match, don't patch the code to match the docs. The only exception is a behavior rule explicitly marked authoritative in `CLAUDE.md` (e.g. "all commits through scripts/committer"); those are contracts and the code is expected to follow.

## Session Protocol

At the end of each session:

1. Write an **experience note** in `notes/<YYYY-MM-DD>.md` with at least one observed lesson.
2. Update `INDEX.jsonl` to keep navigation current for new/renamed artifacts.
3. Update `CHANGELOG.md` with why/context, not just what changed.
