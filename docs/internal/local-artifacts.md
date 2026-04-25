# Local artifacts policy

> Files that must stay LOCAL and never enter `git ls-files`. Enforced by `.gitignore` and a hygiene test in `tests/test-registry-consistency.js`.

## Always LOCAL

| Path | Why |
|---|---|
| `.env`, `.env.local` | Secrets and per-machine config (`.env.example` is fine; it is a template). |
| `.claude/` | Per-session Claude Code state, plan drafts, dogfood diaries. |
| `coverage/` | Generated test coverage reports. |
| `node_modules/` | Resolved npm dependencies. |
| `experience/` | Per-session experience notes (cross-session knowledge lives in your contributor's external notes directory, not in-repo). |
| `tests/accuracy/batch-input/`, `tests/accuracy/batch-output/`, `tests/accuracy/conflicts.jsonl`, `tests/accuracy/deterministic-labels.jsonl` | Generated artifacts from accuracy CI runs. |

## Why this exists

These paths were tracked in earlier prototypes and leaked into npm tarballs / public surface. The policy plus the regression test prevent regression.

## Enforcement

- `.gitignore` blocks them from `git add`.
- `tests/test-registry-consistency.js` fails CI if any of these paths returns from `git ls-files`.
- `npm pack --dry-run` is the final gate; if anything sneaks past `.gitignore`, the published tarball would include it.
