# Install AgentLint

> **For AI coding agents**: this file is the canonical install reference. Read once, act. Decision tables, not narrative.

## Side effects

`npm install -g agentlint-ai` installs the `agentlint` CLI to npm's global prefix. It does **not** write to `~/.claude/` and does **not** register the Claude Code plugin — the postinstall lifecycle hook just prints a one-line hint and exits.

To register the `/al` Claude Code plugin (one-time, opt-in), run `npx agentlint-ai install` after the global install. That command detects Claude Code, copies the slash command into `~/.claude/commands/al.md`, and adds the marketplace plugin entry. Skip it on CI runners, sandboxed environments, or read-only `~/.claude` setups; the CLI works without it.

If you previously installed via `--ignore-scripts` to avoid the old auto-write, that flag is no longer needed (lifecycle install no longer writes anywhere outside `node_modules`). Keep it if your environment policy requires it; the resulting CLI is identical.

## Default

```bash
npm install -g agentlint-ai           # CLI only — no Claude plugin
npx agentlint-ai install              # opt-in: register /al Claude Code plugin
```

Success signals: `agentlint --version` prints a version string after the first command; the second command prints `✓ /al command [installed]` when Claude Code is detected.

## Failure modes

| Symptom | Fix |
|---|---|
| `EACCES: permission denied` on global install | `npm install -g --prefix=$HOME/.npm-global agentlint-ai` and add `$HOME/.npm-global/bin` to PATH |
| Read-only `~/.claude` (CI runner / sandbox / enterprise security review) | Skip `npx agentlint-ai install`; the CLI from `npm install -g` works without writing to `~/.claude/` |
| `bash: command not found` on Windows | Install Git for Windows (https://git-scm.com/download/win) or WSL, then re-run `npx agentlint-ai install` |
| `agentlint: command not found` after install | Add `$(npm prefix -g)/bin` to PATH |
| `/al` plugin missing in Claude Code | Run `npx agentlint-ai install`, or manually add the plugin via `claude plugin marketplace add 0xmariowu/AgentLint` |

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
agentlint setup --lang ts .        # bootstrap CI / hooks / templates for a project (uses --ignore-scripts by default)
# agentlint setup --lang ts --with-scripts .   # opt-in: also run dependency lifecycle hooks
```

In Claude Code (after `npx agentlint-ai install`): run `/al` for the interactive scan-fix-report flow.

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
