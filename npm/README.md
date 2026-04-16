<p align="center">
  <img src="https://raw.githubusercontent.com/0xmariowu/agent-lint/main/assets/favicon.svg" alt="AgentLint" width="80">
</p>

<h1 align="center">AgentLint</h1>

<p align="center">
  <strong>Your AI agent is only as good as your repo.</strong><br>
  33 checks. 5 dimensions. Evidence-backed.
</p>

<p align="center">
  <a href="https://github.com/0xmariowu/agent-lint">GitHub</a> &middot;
  <a href="https://docs.agentlint.app">Docs</a>
</p>

---

Check how well your repo supports AI coding agents. A [Claude Code](https://claude.com/download) plugin.

## Install

```bash
npm install -g @0xmariowu/agent-lint
```

Then start a new Claude Code session and run:

```
/al
```

## What it does

AgentLint scans your repository and scores how well it supports AI coding agents across 5 dimensions: Findability, Instructions, Workability, Safety, and Continuity.

## Requirements

- [Claude Code](https://claude.com/download)
- Node.js 20+
- `bash`, `jq`, `git` on `PATH`
- **Windows**: install from inside **Git Bash** (ships with [Git for Windows](https://git-scm.com/download/win)) or **WSL** ([install guide](https://learn.microsoft.com/windows/wsl/install)). Installing from `cmd.exe` / PowerShell will exit with a guidance message.

## Links

- [GitHub](https://github.com/0xmariowu/AgentLint)
