# Install

> **For AI coding agents**: this file is the canonical install reference. Terse, action-first. Pick one path, run the command, verify, done.

## Recommended path — `npx agentlint-ai init`

```bash
npx agentlint-ai init
```

- Installs the CLI globally (via `npx` cache).
- Detects Claude Code. If present, registers `/al` plugin in `~/.claude/`.
- Prints ASCII logo, privacy-by-mode summary, step-by-step environment detection.
- Safe to re-run; idempotent.

## Alternative — `npm install -g`

```bash
npm install -g --foreground-scripts agentlint-ai
```

- `--foreground-scripts` keeps the install UI visible (npm 9+ silences `postinstall` stdout by default, so plain `npm install -g` hides the logo + env check).
- Otherwise identical outcome to `npx ... init`: CLI on PATH, `/al` registered if Claude Code is present.

## No-side-effects path — corporate / CI / sandboxed

```bash
npm install -g --ignore-scripts agentlint-ai
agentlint-ai init   # explicit, opt-in mutation
```

- `--ignore-scripts` skips `postinstall` entirely. Nothing touches `~/.claude` on install.
- Run `agentlint-ai init` later if/when you want `/al` registered.
- Suitable for:
  - enterprise security review (supply-chain concern on `postinstall` side effects)
  - locked-down CI runners
  - read-only `$HOME` sandboxes

## Verify

```bash
agentlint --version          # prints version
agentlint check              # scans current directory
```

Inside Claude Code:

```text
/al
```

## Uninstall

```bash
npm uninstall -g agentlint-ai
```

If `/al` was registered, remove the plugin manually inside Claude Code:

```text
/claude plugin marketplace remove 0xmariowu/agent-lint
```

## Requirements

| Dep       | Minimum              | Install                                            |
|-----------|----------------------|----------------------------------------------------|
| `node`    | 20+                  | https://nodejs.org                                 |
| `bash`    | any                  | macOS/Linux built-in. Windows: Git for Windows or WSL. |
| `jq`      | any                  | macOS: `brew install jq`. Debian: `apt install jq`. Windows: `choco install jq`. |
| `git`     | any                  | https://git-scm.com                                |

## Common failure modes

- **`command not found: agentlint` after install** — Node global-bin not on `PATH`. Fix: `export PATH="$(npm prefix -g)/bin:$PATH"` (add to shell rc).
- **`npm install -g` printed nothing** — npm 9+ default. Use `npx agentlint-ai init` or add `--foreground-scripts`.
- **First `/al` says "command not found"** — plugin wasn't registered (install ran with `--ignore-scripts` or Claude Code wasn't detected at install time). Run `agentlint-ai init` explicitly.
- **macOS: `jq: command not found`** — macOS doesn't ship `jq` by default. `brew install jq`.
- **Windows: `bash: command not found`** — install Git for Windows or use WSL.

## Privacy by mode

| Mode | Data accessed | Network / AI |
|------|---------------|--------------|
| `agentlint check` (default) | files in the scanned repo | Local only, no AI |
| GitHub Action               | files in the checked-out repo | Local only, no AI |
| `/al` (core dims)           | repos under configured `PROJECTS_ROOT` | Local only, no AI |
| `/al` + Deep (opt-in)       | selected entry files (e.g. `CLAUDE.md`) | Sends file contents to a Claude sub-agent |
| `/al` + Session (opt-in)    | `~/.claude/projects/` logs | Local analyzer; output redacted by default |

## Design note — why `postinstall` configures Claude Code

`npm install -g agentlint-ai` intentionally registers the `/al` Claude Code plugin and writes to `~/.claude/`. AgentLint is Claude-Code-native; "install = ready to /al" is the expected UX for this class of tool.

If this design is not a fit (security audit, sandboxed runner), use the `--ignore-scripts` path above. Version 2.0 is likely to invert the default and require explicit `agentlint-ai init` for the Claude-Code side effect.
