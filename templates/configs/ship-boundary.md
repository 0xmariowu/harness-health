# Ship vs Local vs Never — file-provenance boundary

> Every file in this repository belongs to exactly one tier. If you can't tell which tier a new file belongs to, default to LOCAL and promote only after deliberate review.
>
> Machine-readable contract: `standards/ship-boundary.json` (module `m4`).
>
> **What counts as "private" in the NEVER tier** is defined separately in `configs/privacy-taxonomy.md` — three dimensions (Identity / Assets / Behavior) × 11 subcategories, each SB-N-XX rule tagged with its category code. Read the taxonomy before extending NEVER.

## The three tiers

| Tier | Destination | Purpose | Typical examples |
|---|---|---|---|
| **SHIP** | Tracked in git, published to the public repo. | Downstream-facing product + governance. | `configs/**`, `standards/*.json`, `bootstrap.sh`, `hooks/**`, `scripts/**`, `.github/**`, root `README.md` / `CLAUDE.md` / `CHANGELOG.md` / `LICENSE` / `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md` / `SECURITY.md`. |
| **LOCAL** | Present on disk, `.gitignored`. | Per-contributor or per-session state. | `HANDOFF.md`, `.claude/`, `experience/`, `docs/reports/`, `.ship-boundary-deny.local`. |
| **NEVER** | Must not exist in tracked files at all. | Credentials, personal identifiers, history-damaging phrasing. | `.env*` (except `.env.example`), inline API keys, `/Users/<name>/` paths, internal project codenames, tailnet hostnames (`*.ts.net`, `*.tailscale.*`), "removed X / previously Y" phrasing in CHANGELOG. |

## The three-question decision tree

When you're about to create a new file, answer these in order:

1. **Will downstream users of `bootstrap.sh` need this file?** — If yes, it's a SHIP candidate; continue to question 2. If no, skip to question 3.
2. **Does the file contain real project names, personal email, `/Users/<name>/` paths, API keys, or internal commentary?** — If yes, scrub it until the answer flips to no, or demote it to LOCAL. If no, SHIP it.
3. **Is this file only meaningful for the current session (handoff, plan, or internal notes)?** — If yes, LOCAL (add to `.gitignore`). If all three questions resolved "no", default to LOCAL until someone explicitly promotes it.

## Rules (Don't / Instead / Because)

Don't enumerate specific internal codenames in any SHIP-tier file (contracts, docs, gitignore comments, hook scripts). Instead describe the category of identifier and defer specifics to the repo-local `.ship-boundary-deny.local` file. Because every SHIP-tier file is a public advertisement of whatever it names; the contract that forbids leaks must not leak itself.

Don't phrase CHANGELOG entries as "removed X" / "dropped Y" / "previously private Z". Instead describe the current state ("now points at the public repo", "check renamed for clarity"). Because past-tense removal phrasing points readers at git history — the exact search term you scrubbed is in the scrub note.

Don't hardcode `/Users/<name>/`, `/home/<name>/`, or machine hostnames in any tracked file. Instead use `$HOME`, environment variables, or repo-relative path resolvers (`$(dirname "$0")`, `${BASH_SOURCE%/*}`). Because personal paths reveal identity, machine layout, and directory structure, all of which are permanently embedded in git history once pushed.

Don't commit a file until you have answered the three decision-tree questions. Instead sit in LOCAL — the default — and promote only after deliberate review. Because promoting a file is cheap; un-leaking one is not.

## Working with `.ship-boundary-deny.local`

The public contract does not list specific internal codenames. Each contributor maintains a LOCAL deny-file extending the `NEVER` tier with project-specific patterns.

1. Create `.ship-boundary-deny.local` at the repo root (already `.gitignored` via the `/.ship-boundary-deny.local` entry).
2. Add one pattern per line — literal strings or regex, with optional `#` comment.
3. When running a hygiene check, feed this file into your linter alongside `standards/ship-boundary.json`.

IMPORTANT: Don't share `.ship-boundary-deny.local` across contributors via any channel that ends up in a tracked file. Different contributors have different exposure surfaces; the deny list is a per-identity concern.

## Extending the contract

If a new tier is genuinely needed (e.g. "SHIP-REDACTED" for files that ship with secrets substituted), it goes through a pull request against `standards/ship-boundary.json` — not via ad-hoc `.gitignore` edits. Because the contract is the source of truth; `.gitignore` is its compiled artifact, and drifting the artifact without updating the contract re-introduces the ambiguity the contract exists to remove.

## When this rule fires in practice

- A new AI session asks "should `HANDOFF.md` be tracked?" — answer via tier LOCAL + `SB-L-01`; no deliberation needed.
- A contributor writes session notes that reference real project names — question 2 demotes it to LOCAL (covered by `.claude/` or a project-specific gitignore path).
- A CI hygiene job lints a PR diff — the regex patterns in the `never` tier of `standards/ship-boundary.json` are the source of truth.
- A reviewer sees a CHANGELOG bullet saying "previously private FooCorp paths" — `SB-N-05` flags it; the fix is to describe the current state, not the removal.
