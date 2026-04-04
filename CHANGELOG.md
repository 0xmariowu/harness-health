# Changelog

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
