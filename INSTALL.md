# Install AgentLint

> **For AI coding agents**: this file is the canonical install reference. Read once, act. Decision tables, not narrative.

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

```yaml
- uses: 0xmariowu/agent-lint@v1
  with:
    fail-below: 80
```

`@v1` is a moving major-version tag. Pin to a specific release (e.g. `@v1.1.5`) if you need reproducibility.

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
agentlint check --help
```

## Uninstall

| Remove | Command |
|---|---|
| npm CLI | `npm uninstall -g agentlint-ai` |
| Claude Code plugin | `claude plugin marketplace remove agent-lint` |
| Cached files | `rm -rf "$HOME/.claude/plugins/cache/agent-lint" "$HOME/.al"` |
| `/al` command file | `rm -f "$HOME/.claude/commands/al.md"` |

If you ran `agentlint setup` in a repo, review and remove paths it added (typically under `.github/workflows/`, `.claude/`, `CLAUDE.md`, `HANDOFF.md`).
