# Changelog

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
