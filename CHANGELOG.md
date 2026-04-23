# Changelog

## Unreleased

## v0.9.0 (2026-04-23)

### New: `agentlint setup` — AI-native project bootstrap

You can now bootstrap any repo with a full AI-native development stack in one command:

```bash
agentlint setup --lang python ~/Projects/my-repo
agentlint setup --lang ts --visibility public ~/Projects/my-repo
```

Installs 12 universal CI workflows (gitleaks, semgrep, trivy, test-required, pr-lint, release, and more), language-specific CI (CodeQL, cross-platform matrix), git hooks (author identity, PII scan, staged-file lint, conventional commits, pre-push rebase), and file templates (CLAUDE.md, plan.md, compliance_check.sh, HANDOFF.md).

This merges VibeKit's bootstrap capability directly into AgentLint. The full lifecycle is now: **`agentlint setup` → `agentlint check` → `agentlint fix`**.

### New: `agentlint` unified CLI

You can now use `agentlint` as a single entry point:
- `agentlint setup` — bootstrap (new)
- `agentlint check` — diagnose (existing, now accessible via unified CLI)
- `agentlint fix` — auto-fix (existing, now accessible via unified CLI)

### Fixes

- weights: W7/W8/H7/S9 checks now correctly factor into the total score (were scanned but weighted zero in v0.8.6)

## v0.8.6 (2026-04-23)

### New checks (4)

- **W7** You can now see when `CLAUDE.md` is missing a documented local fast test command — AI agents need a single runnable command (e.g. `pytest tests/unit/` or `npm test`) to verify before pushing.
- **W8** You can now detect Node.js projects where `package.json` has no `scripts.test` entry — `npm test` silently fails with "missing script" when agents try to run it.
- **H7** You can now detect gate workflows (`test-required`, `*-check`, etc.) that always `exit 0` — warn-only gates never block merge despite appearing to enforce rules.
- **S9** You can now detect personal email addresses in git history — PII leak in public commit history that survives even after source code is cleaned.

### Fixes

- ci: fix codex-autofix-dispatch marker mismatch — loop-prevention guard searched `codex-autofix-dispatch:` but write-block emitted `copilot-autofix-dispatch:`, so repeat CI failures on the same PR head spammed fresh `@copilot please fix` comments. Unified both to `copilot-autofix-dispatch:`.
- npm: add `scripts.test` to `package.json` — `npm test` now works as the canonical local test entry point.

## v0.8.5 (2026-04-19)

### Infrastructure

- **`scripts/sanitize.sh`** — new read-only pre-release PII audit. Eight checks cover author emails (git log), personal paths (tracked files + commit messages + recent history), Tailscale and mDNS machine hostnames, and optional `.internal-codenames` enforcement across files / commits / branches. Scans tracked-only so untracked test artifacts don't create noise. Mirrors the placeholder filter from `.husky/pre-commit` so documentation examples don't trip it.
- **Commit-message PII scan workflow.** New `.github/workflows/commit-message-scan.yml` rejects PRs whose commit messages contain personal paths or machine hostnames. Closes the gap where `.husky/pre-commit` and `hygiene.yml` only scanned staged file contents, not commit metadata.

### Chore

- **`.husky/pre-commit`** now excludes `scripts/sanitize.sh` from the private-pattern scan — same rationale as the existing `.gitleaks.toml` exclusion: detection tools must be allowed to mention the patterns they detect.

### Notes

- Docs and tooling only. No scanner behavior, check set, or scoring changes. Check count stays 49.

## v0.8.4 (2026-04-18)

### Fixed

- **`docs/ship-boundary.md`** no longer references artifacts that don't exist in this repo. The v0.8.3 import from VibeKit left behind pointers to `standards/ship-boundary.json`, `.ship-boundary-deny.local`, `bootstrap.sh`, `tests/e2b/`, `configs/**`, `hooks/**`, and rule IDs like `SB-L-01` / `SB-N-05`. SHIP / LOCAL / NEVER examples now match agent-lint's actual layout, and a new "How this is enforced today" section points to the real enforcement surface (`.husky/pre-commit`, `hygiene.yml`, `author-email.yml`, `gitleaks.yml`, `semgrep.yml`).
- **`docs/rules-style.md`** `§3.12` error-message example now uses `.husky/pre-push`'s real rebase-failure message instead of VibeKit's `scripts/committer`. Dead pointers to `configs/templates/*`, `atomic-dev-environment.md`, and external wiki sections removed.

### Notes

- Docs only. No scanner behavior, check set, or scoring changes. Check count stays 49.

## v0.8.3 (2026-04-18)

### Infrastructure

- **Public Repo Hygiene workflow.** New `hygiene.yml` enforces codename, personal-path, and container-image-pin checks on every PR — complementing the existing `author-email.yml` commit-identity gate.
- **Workflow Sanity workflow.** New `workflow-sanity.yml` runs actionlint (with shellcheck) plus no-tabs and no-conflict-marker checks whenever `.github/workflows/**` changes.
- **CodeQL analysis.** New `codeql.yml` runs `javascript-typescript` scans on every PR, push to `main`, and weekly cron. Closes the CodeQL gap from the public-repo security audit.
- **Composite actions.** `ensure-base-commit` progressively deepens shallow clones until a required base SHA is reachable; `detect-docs-changes` emits `docs_only=true` when a PR touches only docs — reusable building blocks for future workflows.
- **`.shellcheckrc`** sets the repo-wide shellcheck baseline (warning severity, bash dialect, sourced-file following).
- **`.husky/pre-push`** rebases feature branches on `origin/main` before push so CI always sees an up-to-date branch.
- **Test aggregator job** (`test (20)` / `test (22)`) wraps the OS × Node test matrix to satisfy stable branch-protection contexts without pinning individual OS variants as required.

### Chore

- **`docs/rules-style.md`** and **`docs/ship-boundary.md`** — rule-authoring style guide and file-tier decision framework imported from VibeKit.
- **`github/codeql-action` 3.35.2 → 4.35.2** (dependabot). Unifies `init`, `analyze`, and `upload-sarif` on v4 and ships CodeQL bundle 2.25.2.
- **Shellcheck cleanups** in `accuracy.yml` (find/xargs null-byte handling, `ls`→`find` for counting, noop-truncate prefix) and `release.yml` (useless `cat` removed) to satisfy the new actionlint gate.

### Notes

- No new checks, no scoring changes, no scanner behavior changes. Check count stays 49. Dimensions unchanged.

## v0.8.2 (2026-04-16)

### Security

- **Symlink attack protection across scanner, fixer, and analyzers.** A malicious repository could place a symlinked `CLAUDE.md` (or `AGENTS.md`, `.cursorrules`, `.cursor/rules/*.mdc`) pointing to sensitive host files like `~/.ssh/id_rsa` or `/etc/passwd`. Running scanner, fixer, deep-analyzer, or session-analyzer on such a repo would read, leak (to LLM prompts or output), or overwrite the symlink target. All entry-file resolution now uses `lstat`-based checks that reject symlinks.
- **I1 keyword scan no longer buffers entire entry file in memory.** v0.8.1 introduced a bash variable accumulator that grew unbounded — a 29 MB `CLAUDE.md` could crash the scanner with `xrealloc: cannot allocate N bytes` under constrained memory. Replaced with streaming awk that uses O(1) memory regardless of file size.
- **S6 hardcoded secrets check now inspects `.env` files.** Previous `':!*.env'` exclusion allowed committed secrets in `.env` / `.env.local` / `.env.production` to bypass detection.
- **Hook script paths confined to project directory.** `extract_script_path` (used by H3/H6) refuses absolute paths and traversal sequences that escape the scanned repo.
- **F8 rules directory check rejects symlinks and non-regular files.** Symlinked `.claude/rules` or non-regular `.md` rule files could cause tool crashes or unexpected reads.
- **S3 secret-scan detection refuses symlinked `.github/workflows`.** `grep -rl` follows symlinks passed as command-line arguments; a symlinked workflows directory could cause the scanner to traverse outside the repo.

### Notes

- Addresses 10 security findings from Codex code review.
- All local tests pass (scorer 15, fixer 20, reporter 11, scanner 93, e2e 45, sarif 10, action-smoke 6, install-script 16, traversal 7, malicious-fixtures 10) plus E2B extreme correctness suite 33/33.

## v0.8.1 (2026-04-16)

### Fixed

- **S7 personal paths check no longer silently fails on git < 2.40.** The `:!__tests__/*` pathspec exclusion triggered `fatal: Unimplemented pathspec magic '_'` on git 2.39 (Debian 12 default). The error was swallowed by `|| true`, causing the check to always report "no personal paths" — even when files contained `/Users/` or `/home/` paths. Fix moves the exclusion from git pathspec to a grep pipe filter.
- **I1 emphasis keywords are no longer counted inside code blocks.** `IMPORTANT`, `NEVER`, `MUST`, and `CRITICAL` inside fenced code blocks (` ``` `) and indented code (4-space) were inflating keyword density for CLAUDE.md files with code examples. Fix strips code blocks before counting.

### Notes

- Found via E2B cloud sandbox testing: 541 tests across 20 real repos, 22 edge cases, GitHub Action simulation, and Claude Code E2E — all passing after fix.

## v0.8.0 (2026-04-16)

### Added

- **You can now get AgentLint findings in GitHub's Security tab and as inline PR annotations.** Enable with `sarif-upload: 'true'` in your workflow. Findings appear alongside CodeQL and Dependabot alerts — persistent, trackable, and integrated with your existing security notification workflow. SARIF upload requires Code scanning enabled (free for public repos, GHAS for private).
- **Inline PR annotations now appear on every run** — even without SARIF/Code scanning. AgentLint emits `::warning` and `::error` workflow commands that GitHub renders as yellow/red annotations on the PR Files changed tab. No configuration needed.

## v0.7.1 (2026-04-16)

### Added

- **You can now install AgentLint on Windows** from inside Git Bash or WSL (#82). `npm install -g @0xmariowu/agent-lint` previously rejected Windows with `EBADPLATFORM` before the installer could even run; that block is gone.
- **Clear guidance when bash is missing on Windows.** Running the installer from `cmd.exe` or PowerShell now exits with a message pointing to Git for Windows or WSL instead of a cryptic shell error.

### Fixed

- Postinstall detects `claude` cross-platform (`where` on win32, `command -v` elsewhere) and verifies `bash` availability on Windows before invoking the installer.
- `.gitattributes` now forces LF on `*.sh`, `*.js`, `*.md`, and other text files so Windows checkouts with default `core.autocrlf=true` no longer convert shell scripts to CRLF and break shebangs.

### Notes

- The scanner itself (`src/scanner.sh`) is still bash. Running it on Windows requires Git Bash or WSL — see the Platform requirements table in `README.md`. A native cmd.exe / PowerShell flow is out of scope for this patch.

## v0.7.0 (2026-04-15)

Audit-driven minor release. Dimension count grows from 6 to 8, check count from 42 to 49 — your repo score will shift, because the scanner is now finally counting checks it had been silently dropping.

### Added — two new dimensions, seven new checks

`deep-analyzer` and `session-analyzer` were already emitting `D1`-`D3` and `SS1`-`SS4` results, but `weights.json` had no dimension entry for either prefix, so `scorer.js` silently dropped every contribution. The audit caught this and the dimensions are now first-class:

- **Deep (weight 0.05)** — D1, D2, D3 from `deep-analyzer.js`
- **Session (weight 0.05)** — SS1-SS4 from `session-analyzer.js`

Total dimension weight is now 1.10 instead of 1.0, so existing dimensions each contribute ~9% less of the total — see `standards/weights.json` for the rationale. This is intentional and the score formula now reflects every check the analyzers emit.

### Fixed — pipeline contract bugs

- **F5 medium-severity findings now actually auto-fix.** `inferFixType` was returning `'guided'` for F5 with score ∈ [0.5, 0.8), but `fixer.js` only handled F5 in the `assisted` branch — so medium-severity broken-reference findings fell through to text guidance and never ran `executeAutoFix`.
- **`scorer.js` no longer crashes silently on missing input.** A bad path (`scorer.js /no/such/file`) used to surface as an unhandled stream error stack trace; now it prints `scorer: cannot read input '...': ENOENT` and exits 1.
- **`reporter.js --plan plan.json scores.json` no longer eats `plan.json` as the scores file.** Positional argument lookup now skips indices that are values for `--plan`, `--output-dir`, `--format`, and `--before`.
- **S1-S4 evidence sources** corrected to `corpus-4533` — the `evidence_text` quoted 4,533-repo statistics but the `evidence_sources` field referenced the small qualitative `practical-audit` set.
- **PR #72 regression coverage** — added scanner tests for BASH_REMATCH multi-link isolation and the three `emit_result` defense paths (unknown check_id, jq failure, empty jq output).

### Added — accuracy baseline observability

The full-corpus baseline runner used to swallow per-repo failures with `2>/dev/null || true`, leaving the operator no signal about how many of the 4,533 repos silently failed reconstruction or scanner timeout:

- **Per-stage failure counters** in `tests/accuracy/run-full-baseline.sh` — separate counts for reconstruct / timeout / scanner-error, list of first 10 failed repo names, warning when failure rate exceeds 5%.
- **`--dry-run` flag** validates paths, tarball, and script binaries without running the 10-30 minute scan.
- **Wilson 95% confidence intervals** in `tests/accuracy/compare-results.js`. Several checks have small N (S6=25, S7=354) where the headline accuracy point estimate can swing several percentage points just from labelling noise. The console table is unchanged; a new "Low-N warning" section flags checks where the CI width exceeds 10 percentage points. CI bounds are saved to JSON output for cross-run comparison.

### Engineering hygiene

- All three Dockerfiles (`tests/Dockerfile.e2e`, `tests/docker-e2e/Dockerfile`, `tests/docker-e2e/Dockerfile.full-corpus`) pin `node:20-slim` to a SHA256 digest. Dependabot's `docker` ecosystem can now propose explicit upgrades.
- New `.dockerignore` keeps `.env`, `.git/`, `node_modules/`, and the multi-MB corpus tarballs out of the build context — both a leak fix and a build-time bloat fix, since all three Dockerfiles use `COPY . /app/`.
- `npm/package-lock.json` is now committed for reproducible consumer installs.
- `.gitignore` excludes `__pycache__/`, `*.pyc`, and `state/`.

### Known follow-up

- [#79](https://github.com/0xmariowu/AgentLint/issues/79) — C2 (CHANGELOG) recall regression: 60% → 12% in the v0.6.1 baseline. Wilson CI in this release surfaces the kind of regression that's currently invisible.

## v0.6.2 (2026-04-14)

Scanner correctness fixes. Your repo score may change — it is now what scanner says it is.

### Fixed — six silent-failure bugs in scanner

All of these made scanner report higher scores than reality:

- **S2 (SHA pinning)** now actually checks standard workflow syntax. The grep only matched bare `uses:` keys; the `- uses:` list-item form used by every normal workflow slipped through, so wf_total stayed at 0 and S2 always scored 1 regardless of pinning.
- **W6 (pre-commit hook speed)** now emits score 0 when a slow command (tsc / eslint --fix / jest / pytest / etc.) is detected. Both branches previously returned 1.
- **F5 (broken references)** no longer follows `../` paths out of the project. A CLAUDE.md that linked to `../../../etc/passwd` used to resolve against the real filesystem and score as "valid." The check also stopped resolving against the shell's CWD, which let bare references match wherever the user happened to run scanner from.
- **emit_result** now validates jq output. Unknown check_ids used to emit the literal string `"null"` as dimension, poisoning scorer/plan-generator/reporter downstream. A broken jq returning exit 0 with empty stdout used to produce an empty JSONL line.
- **F5 reference extraction** no longer crashes on markdown links. Helper functions reset `BASH_REMATCH`, and the tail of the while-loop then hit an unbound variable under `set -u` — F5 emitted 0 broken references regardless of content. Matches are now cached into locals before the helper call.

### Fixed — accuracy benchmark

Rebuilt against v0.6.2 scanner + all fixes. The tarball now also packages `.claude/settings.json` (1,574 of 4,533 corpus repos have it) so H1-H6 harness checks see real config:

- Overall precision 95.2% → **97.8%** (+2.6)
- Overall recall 94.3% → **95.9%** (+1.6)
- Overall F1 94.7% → **96.8%** (+2.1)
- Overall accuracy 93.9% → **96.4%** (+2.5)

### Added

- **`tests/robustness/malicious-fixtures.sh`** — 10-fixture robustness harness (paths with spaces/newlines, `../` traversal, symlink loops, files > 256 KB, non-UTF-8 CLAUDE.md, corrupt `.git/HEAD`, emoji filenames).
- **`tests/fixer-safety/test-traversal.js`** — 7 path-traversal guard assertions against `fixer.js`.
- **`tests/accuracy/run-full-baseline.sh`** — one-shot orchestrator for rebuilding accuracy baselines. Extract → reconstruct → parallel scan → compare.
- +99 scanner / JS test assertions (94 → 193). Four previously-orphan test files now run in CI: `test-e2e.sh`, `test-install-script.sh`, `test-session-analyzer.sh`, `test-deep-analyzer.sh`.

### Security

- npm `postinstall.js` now fetches `install.sh` from the git tag matching the published package version, not `main`. Before, any commit to `main` silently changed install behavior for every prior version.
- `.husky/pre-commit` moved private patterns out of the public repo. Load from `~/.agentlint-private-patterns` (opt-in per-user file), missing file means scan is skipped.
- `release.yml` now declares top-level least-privilege `permissions: contents: read`. The release job still elevates locally for creating the GitHub Release.

### Quality

- `reporter.js` validates `--format` and exits non-zero on unknown values (previously silently exited 0 with no output).
- `reporter.js` `esc()` now also escapes single quotes (defense-in-depth).
- `scorer.js` warns to stderr when a JSONL line fails to parse (was silent skip).
- Dead code removed across `reporter.js`, `scorer.js`, and `session-analyzer.js`.

## v0.6.1 (2026-04-14)

Docs patch. No functional changes.

The npm listing for v0.6.0 carried the pre-release README which still said "33 checks / 5 dimensions" and only mentioned Claude Code. This publishes the updated README that documents all 42 checks, 6 dimensions, and multi-platform support (Claude Code, Cursor, Copilot, Gemini, Windsurf, Cline).

## v0.6.0 (2026-04-14)

You can now check Claude Code hook and permission config, scan more AI platforms, and wire AgentLint into CI as a GitHub Action.

**42 checks across 6 dimensions** (up from 33 across 5).

### New dimension: Harness
- H1 — Hook event names valid (catches typos like `preCommit`, `sessionStart` that silently never fire)
- H2 — PreToolUse hooks have matcher field (91% of corpus hooks fire on every tool call — major perf tax)
- H3 — Stop hook has loop-protection guard (only 5/92 corpus Stop hooks guard against infinite loops)
- H4 — No dangerous auto-approve permissions (`Bash(*)`, `*`, `mcp__*`, `sudo`, `rm -rf`, `git push --force`)
- H5 — `.env` deny rules cover `.env.*` variants
- H6 — Hook scripts network access detection (curl/wget/fetch → data exfiltration risk)

All Harness checks safe-default to pass when no `.claude/settings.json` exists. Evidence from analysis of 4,533 real Claude Code repos.

### New checks in existing dimensions
- F8 — `.claude/rules/*.md` frontmatter uses documented `globs:` (not `paths:` — which silently doesn't scope)
- F9 — No unfilled template placeholders (`[your project name]`, `<framework>`, `TODO:`)
- I8 — Total injected content within budget (CLAUDE.md + AGENTS.md + rules/*.md, reference 60-200 non-empty lines)

### Multi-platform support
You can now scan repos using Copilot, Gemini CLI, Windsurf, or Cline. AgentLint detects:
- `.github/copilot-instructions.md` (GitHub Copilot)
- `GEMINI.md` (Google Gemini CLI)
- `.windsurfrules` (Windsurf)
- `.clinerules` (Cline)
- `.cursor/rules/*.mdc` (Cursor MDC rules)

Claude Code-specific checks (F7 `@include`, C5 `CLAUDE.local.md`) now skip gracefully on non-Claude repos instead of penalizing them.

### GitHub Action
You can now add AgentLint to CI in three lines:
```yaml
- uses: 0xmariowu/agent-lint@v0
  with:
    fail-below: '60'
```
Outputs: total score (0-100) plus per-dimension scores.

### Scanner precision improved
Five bug fixes that were hurting the accuracy benchmark:
- C2: removed `grep 'status'` false positive — was matching every CLAUDE.md (3.5% precision → ~90%+)
- I3: now matches `Do not` variant with case-insensitive flag, widens Because window from 3 to 5 lines (0% recall → significant)
- I4: heading keyword list expanded to 20+ (Build/Testing/Deploy/Setup/Install/etc.) — was 43.4% recall
- S6: `sk-` pattern now requires 48+ chars to avoid matching `sklearn` (0% precision → ~95%+)
- S7: excludes `tests/`, `fixtures/`, test files from personal path scan (23.1% precision → ~70%+)

### Weight rebalancing
Making room for Harness (0.10) required shrinking three existing dimensions:
- instructions 0.30 → 0.25
- workability 0.20 → 0.18
- continuity 0.15 → 0.12

Your repo's total score may shift 1-2 points after upgrading, reflecting the reallocation.

## v0.5.1 (2026-04-12)

Release pipeline verification. No functional changes.

- Chore: CI — allow `dependabot[bot]` in author name check (#55)
- Chore: bump actions/setup-node 4.4.0 → 6.3.0 (#51)
- Chore: bump actions/upload-artifact 4.6.2 → 7.0.0 (#52)
- Chore: bump actions/checkout 4.2.2 → 6.0.2 (#53)
- Chore: bump actions/labeler 5.0.0 → 6.0.1 (#54)
- Chore: untrack HANDOFF.md as local dev notes (#56)

## v0.5.0 (2026-04-10)

You can now measure scanner accuracy against 4,533 real repos.

- New: Corpus-wide accuracy benchmark — 149,589 labeled data points (4,533 repos x 33 checks)
- New: Deterministic + LLM labeling pipeline (auto-label-full.js + DashScope qwen-plus batch)
- New: Cross-validation merge with conflict detection (merge-labels.js)
- New: Per-check precision/recall/F1 comparison with regression detection (compare-results.js)
- New: CI accuracy workflow — blocks PRs if scanner precision or recall drops >5%
- New: accuracy-baseline.json — 93.9% overall accuracy snapshot
- Fix: reconstruct-repo.sh now copies CHANGELOG.md, SECURITY.md, and other scanner-relevant files
- Fix: reconstruct-repo.sh plants sentinel test files in test directories for accurate W3 detection
- Fix: reconstruct-repo.sh no longer injects .gitignore content (was causing S1 false passes)
- Fix: auto-label-full.js aligned with scanner logic for F2, F4, W1, S3

## v0.4.3 (2026-04-06)

Release pipeline test. No functional changes.

- Test: full release pipeline verification (bump → CI → docs → website)

## v0.4.2 (2026-04-06)

Docs site consolidated, release pipeline simplified.

- Changed: Docusaurus docs moved into main repo (was separate AgentLint repo)
- Changed: Push to main auto-deploys docs via GitHub Pages workflow
- Changed: Release pipeline no longer needs cross-repo sync for docs
- Changed: Release validates check_count consistency (weights.json vs metadata vs README)
- New: SVG favicon (green A on brand color)
- Fix: MDX angle-bracket parsing (switched to markdown format)

## v0.4.1 (2026-04-06)

Docs site, npm fixes, release automation.

- New: Docusaurus docs site at docs.agentlint.app (replaces Jekyll)
- New: Ionic-inspired theme with SCSS component partials, dark mode, custom Prism syntax colors
- New: `release-metadata.json` — single source of truth for version, check counts, dimension data
- New: `scripts/generate-metadata.sh` — auto-derives counts from weights.json
- New: Cross-repo release sync — tag push auto-updates docs site and website
- Changed: `scripts/bump-version.sh` now also updates SECURITY.md and README badge
- Fix: npm package dimension names corrected (was: discoverability, context quality, etc.)
- Fix: npm package engine requirement >=18 → >=20 to match README
- Fix: SECURITY.md missing v0.4.x in supported versions table
- Fix: serialize-javascript override to >=7.0.3 (GHSA-5c6j-r48x-rmvq)
- CI: npm distribution with auto-publish on release

## v0.4.0 (2026-04-04)

33 checks. Two new safety checks, hardened dev workflow.

- New: S7 — detects personal filesystem paths in source files
- New: S8 — detects `pull_request_target` trigger in GitHub Actions workflows
- New: pre-commit hook with author whitelist, codename scan, PII scan, secret detection, shellcheck
- New: CI author-email check — validates commit author uses noreply email and pseudonym
- Fix: `set -euo pipefail` in all shell scripts with guarded pipe exits
- Fix: gitleaks allowlist for documentation files containing example paths
- Fix: CI name check skips push events (squash merge uses GitHub profile display name)
- Docs: README brand refresh — sharper opening, updated check count, softened language

## v0.3.2 (2026-04-04)

Security hardening + privacy cleanup.

- Fix: eliminate RCE in W6 hook check — static analysis replaces direct execution of user repo hooks
- Fix: `pull_request_target` → `pull_request` in PR lint workflow
- Fix: path traversal guard in fixer (rejects non-git directories)
- Fix: file probe oracle in scanner (skips absolute paths in reference resolution)
- Fix: XSS escaping for all HTML report template values
- Fix: Python injection in bump-version.sh (environment variables, not string interpolation)
- Fix: glob character escaping in find -name for reference resolution
- Fix: `set -euo pipefail` in scanner.sh with guarded pipe exits
- Fix: remaining `/hh` → `/al` in hooks and commands
- Fix: F5 DEFAULT_ITEM_IDS auto → assisted (matches documented behavior)
- New: test-html-report.js added to CI
- Docs: checks.md updated from 20 → 31 checks, scoring.md corrected weights + Safety dimension
- Docs: SECURITY.md updated with version table, response times, session data access
- Privacy: removed private hostnames, corpus paths, old product references, internal exec plans
- Privacy: git history cleaned — removed experience/ directory, unified author name
- Release workflow improved — version validation, better changelog extraction, idempotent creation

## v0.3.1 (2026-04-04)

HTML report redesign.

- New: HTML report matches approved visual design — segmented arc gauge, expandable dimension rows, check items with status dots, numbered issues list
- New: Before/after comparison in HTML — ghost gauge segments, delta pills, fixed/improved badges on checks
- New: HTML escaping for all user-provided content (XSS safety)
- New: Version badge in report header (read from package.json)
- Removed: radar chart, metric cards grid, data table, topbar from HTML report

## v0.3.0 (2026-04-04)

New Safety dimension. 31 checks total.

- New: Safety dimension (15% weight) with 6 checks — .env exposure, Actions SHA pinning, secret scanning, SECURITY.md, workflow permissions, hardcoded secrets
- Fix: F5 broken reference detection no longer deletes valid content (was removing code examples from real repos)
- Fix: F5 demoted from auto-fix to assisted (too dangerous to auto-delete lines)
- Fix: I3 detail string had escaped quotes that broke JSON parsing
- Validated on 10 real open-source repos (bun, streamlit, tldraw, n8n, nx, etc.)

## v0.2.0 (2026-04-04)

New brand, new command: `/al`.

- New name: AgentLint. Command: `/al`
- New: HTML report with radar chart, dimension bars, before/after comparison (`--format html`)
- New: `--before` flag for reporter to show fix delta
- New: 5 checks from Claude Code behavior analysis (I7, F7, W5, W6, C5) — total 25 checks
- New: SessionStart hook checks jq + node on startup
- New: `${CLAUDE_PLUGIN_DATA}` for persistent config/reports
- New: version sync + `scripts/bump-version.sh`
- New: one-line install script
- Repo standards: badges, CONTRIBUTING, CODE_OF_CONDUCT, PR template, SECURITY upgrade
- Git history rewritten to remove personal information

## v0.1.4 (2026-04-04)

You can now see what needs fixing before choosing. Scanner finds nested repos.

- Fix plan prints a readable summary before asking which items to fix (was hidden in collapsed output)
- Scanner discovers projects up to 3 levels deep (was 1 — missed nested repos)
- Fix: plan-generator now includes score in output items (was dropped, showed as -1)
- Fix: severity thresholds in docs now match code (<0.5 = high)
- Fix: 3 security workflows using nonexistent actions/checkout@v6
- Fix: broken reference to docs/evidence-sources.md in README
- Cleaned internal development notes
- Cleaned .gitignore, package.json, hardcoded paths
- Upgraded issue templates to YAML form format
- Added Dependabot grouped updates
- Added 10 fixer.js tests (auto-fix, assisted, guided, backup)
- Suppressed 17 Semgrep false positives (path-traversal on local CLI tool)
- All CI checks green (24 tests, shellcheck, semgrep, gitleaks, trivy)

## v0.1.3 (2026-04-03)

Fix: plugin was not discoverable — missing marketplace.json.

- You can now actually install with `extraKnownMarketplaces` + `enabledPlugins`
- Fix: added `.claude-plugin/marketplace.json` (tells Claude Code this repo is a marketplace with a plugin)

## v0.1.2 (2026-04-03)

Fix: `/al` is a user command, not an internal skill.

- You can now `/al` in any Claude Code session after install
- Fix: moved `skills/hh/SKILL.md` → `commands/al.md` (command = user-invocable, skill = internal)
- Fix: simplified plugin.json to match official plugins (name + description + author only)
- Fix: added `allowed-tools` to command frontmatter

## v0.1.1 (2026-04-03)

Fix: plugin format was wrong, users couldn't install from GitHub.

- You can now install via `extraKnownMarketplaces` and it actually works
- Fix: moved `plugin.json` to `.claude-plugin/plugin.json`
- Fix: moved `skills/al.md` to `skills/hh/SKILL.md` (directory format)
- Fix: removed explicit skills array from plugin.json (auto-discovered)

## v0.1.0 (2026-04-03)

First release. You can now:

- Run `/al` in Claude Code to diagnose all your projects
- See a score out of 100 across 4 dimensions (Findability, Instructions, Workability, Continuity)
- Get a fix plan grouped by severity with auto/assisted/guided actions
- Execute fixes automatically (broken references, missing files) or get guidance
- Optionally run AI Deep Analysis to find contradictions, dead-weight rules, and vague rules
- Optionally run Session Analysis to find repeated instructions and friction patterns

### Technical

- 20 evidence-backed checks (scanner.sh)
- Weighted scoring algorithm (scorer.js)
- Fix plan generator with severity grouping and item merging (plan-generator.js)
- Terminal, Markdown, and JSONL report formats (reporter.js)
- AI deep analysis via subagents (deep-analyzer.js)
- Session log analysis (session-analyzer.js)
- Auto-fix engine (fixer.js)
- CI: shellcheck, syntax check, 14 tests, security scanning (gitleaks, trivy, semgrep)
- Claude Code plugin format with `${CLAUDE_PLUGIN_ROOT}` paths

## [Unreleased] — AI-native env sync

- feat(ci): bootstrap AI-native dev environment from sync pack v1.4 (Closes #106)
