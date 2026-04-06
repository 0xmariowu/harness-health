# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.4.x   | Yes       |
| < 0.4   | No        |

## Reporting a vulnerability

If you find a security issue, please email **security@0xmariowu.dev** instead of opening a public issue. You can also use [GitHub's private vulnerability reporting](https://github.com/0xmariowu/agent-lint/security/advisories/new).

**Response times:**
- Critical (code execution, data leakage): 24 hours
- Other security issues: 48 hours

## Scope

Security concerns include:

- Command injection or code execution
- Data exposure or leakage
- File system access beyond intended scope
- API key or secret exposure in logs or artifacts

## Session Analysis data access

AgentLint's session analysis module reads Claude Code session data from `~/.claude/projects/` to detect repeated instructions and friction patterns. This data may contain conversation content and tool outputs. Session analysis is opt-in (not selected by default) and all processing is local.
