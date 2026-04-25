# Ship vs Local vs Never - file-provenance boundary

> Every file in this repository belongs to exactly one tier. If you can't tell which tier a new file belongs to, default to LOCAL and promote only after deliberate review.

## The three tiers

| Tier | Destination | Purpose | Typical examples in this repo |
|---|---|---|---|
| **SHIP** | Tracked in git, published to the public repo. | Downstream-facing product + governance. | `src/**`, `lib/**`, `scripts/**`, `tests/**`, `.github/**`, `docs/**`, root `README.md` / `CLAUDE.md` / `CHANGELOG.md` / `LICENSE` / `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md` / `SECURITY.md`, `package.json`, `pyproject.toml`. |
| **LOCAL** | Present on disk, `.gitignored`. | Per-contributor or per-session state. | `HANDOFF.md`, `.claude/`, `notes/`, `coverage/`, `node_modules/`, `.venv/`, local run logs, throwaway plans. |
| **NEVER** | Must not exist in tracked files at all. | Credentials, personal identifiers, history-damaging phrasing. | `.env*` (except `.env.example`), inline API keys, `/Users/<name>/` or `/home/<name>/` paths, personal email addresses, internal project codenames, "removed X / previously Y" phrasing in CHANGELOG. |

## The three-question decision tree

When you're about to create a new file, answer these in order:

1. **Will downstream consumers of this repo (users, package consumers, CI runs, readers of the public repo) need this file?** - If yes, it's a SHIP candidate; continue to question 2. If no, skip to question 3.
2. **Does the file contain real project names, personal email, `/Users/<name>/` paths, API keys, or internal commentary?** - If yes, scrub it until the answer flips to no, or demote it to LOCAL. If no, SHIP it.
3. **Is this file only meaningful for the current session (handoff, plan, bug report, run log)?** - If yes, LOCAL (add to `.gitignore`). If all three questions resolved "no", default to LOCAL until someone explicitly promotes it.

## Rules (Don't / Instead / Because)

Don't enumerate specific internal codenames in any SHIP-tier file (contracts, docs, gitignore comments, hook scripts). Instead describe the category of identifier and keep specifics in a contributor-local file referenced by hooks and workflows via `.ship-boundary-deny.local` or an equivalent private patterns file. Because every SHIP-tier file is a public advertisement of whatever it names; the rule that forbids leaks must not leak itself.

Don't phrase CHANGELOG entries as "removed X" / "dropped Y" / "previously private Z". Instead describe the current state ("now points at the public repo", "check renamed for clarity"). Because past-tense removal phrasing points readers at git history - the exact search term you scrubbed is in the scrub note.

Don't hardcode `/Users/<name>/`, `/home/<name>/`, or machine hostnames in any tracked file. Instead use `$HOME`, environment variables, or repo-relative path resolvers (`$(dirname "$0")`, `${BASH_SOURCE%/*}`). Because personal paths reveal identity, machine layout, and directory structure, all of which are permanently embedded in git history once pushed.

Don't commit a file until you have answered the three decision-tree questions. Instead sit in LOCAL - the default - and promote only after deliberate review. Because promoting a file is cheap; un-leaking one is not.

## How this is enforced today

- **`.husky/pre-commit`** scans staged files for personal paths and contributor-specific patterns when installed by `agentlint setup`.
- **`.github/workflows/hygiene.yml`** re-runs personal-path and container-image-pin checks in CI.
- **`.github/workflows/commit-message-scan.yml`** scans PR commit subjects and bodies for NEVER-tier patterns.
- **`.github/workflows/gitleaks.yml`** and **`semgrep.yml`** catch leaked secrets and common insecure patterns.
- **`.github/workflows/author-email.yml`** enforces the noreply commit-author contract.

The `SHIP` / `LOCAL` / `NEVER` framework is the intent; these workflows and hooks are the current mechanical enforcement.

## When this rule fires in practice

- A new AI session asks "should `HANDOFF.md` be tracked?" - answer: LOCAL (already covered by `.gitignore`).
- A contributor writes local notes with real project names - question 2 demotes them to LOCAL (`notes/` or another gitignored location is the right home).
- A CI hygiene job lints a PR diff - `.github/workflows/hygiene.yml` checks for personal filesystem paths and other deterministic leaks, while placeholder patterns such as `/Users/xxx` and `/home/testuser` stay allowed.
- A reviewer sees a CHANGELOG bullet saying "previously private X paths" - rewrite it to describe the current state, not the removal.
