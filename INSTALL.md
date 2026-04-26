# Install AgentLint

> **For AI coding agents**: this file is the canonical install reference. Read once, act. Decision tables, not narrative.

## Side effects

`npm install -g agentlint-ai` writes to `~/.claude/` and registers the `/al` Claude Code plugin. To install without these side effects, use `npm install -g --ignore-scripts agentlint-ai` (also covered in Failure modes for read-only `~/.claude` environments).

## Default

```bash
npm install -g agentlint-ai
```

Success signal: `agentlint --version` prints a version string.

## Failure modes

| Symptom | Fix |
|---|---|
| `EACCES: permission denied` on global install | `npm install -g --prefix=$HOME/.npm-global agentlint-ai` and add `$HOME/.npm-global/bin` to PATH |
| Read-only `~/.claude` (CI runner / sandbox / enterprise security review) | `npm install -g --ignore-scripts agentlint-ai` (skips Claude Code plugin registration) |
| `bash: command not found` on Windows | Install Git for Windows (https://git-scm.com/download/win) or WSL, then re-run |
| `agentlint: command not found` after install | Add `$(npm prefix -g)/bin` to PATH |
| Installed but `/al` plugin missing in Claude Code | Re-run install without `--ignore-scripts`, or manually add the plugin via `claude plugin marketplace add` |

## GitHub Action

Complete copy-paste workflow:

```yaml
name: AgentLint

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  agentlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: 0xmariowu/AgentLint@v1
```

`@v1` is a moving major-version tag. Pin to a specific release (e.g. `@v1.1.5`) if you need reproducibility. The `actions/checkout@v4` step is required — without it, AgentLint scans an empty workspace. To gate CI on a minimum score, add `with: { fail-below: 80 }` after you've established a baseline; setting it before knowing your project's natural score will turn green builds red on day one.

## After install

```bash
agentlint check                    # scan current repo
agentlint fix W11                  # fix a specific check by ID
agentlint setup --lang ts .        # bootstrap CI / hooks / templates for a project
```

In Claude Code, run `/al` for the interactive scan-fix-report flow.

## Verify

```bash
agentlint --version
agentlint help
```

## Uninstall

| Remove | Command |
|---|---|
| npm CLI | `npm uninstall -g agentlint-ai` |
| Claude Code plugin | `claude plugin marketplace remove agent-lint` |
| Cached files | `rm -rf "$HOME/.claude/plugins/cache/agent-lint" "$HOME/.al"` |
| `/al` command file | `rm -f "$HOME/.claude/commands/al.md"` |

If you ran `agentlint setup` in a repo, review and remove paths it added (typically under `.github/workflows/`, `.claude/`, `CLAUDE.md`, `HANDOFF.md`).
