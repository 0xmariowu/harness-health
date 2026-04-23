# AgentLint Setup

Bootstrap a repository with AI-native CI/CD, hooks, and templates in one command.

## When to use

- Starting a new project and want the full AI-native development stack
- Adding CI/CD and hooks to an existing project
- After `agentlint check` shows missing workflows or hooks

## What gets installed

**Universal CI workflows** (all languages):
gitleaks · semgrep · trivy · test-required (blocking) · pr-lint · release · author-email · commit-message-scan · hygiene · stale · workflow-sanity · lock

**Language-specific workflows** (Python / TypeScript / Node):
CI matrix · CodeQL · labeler · autofix

**Git hooks**:
- Pre-commit: author identity (noreply email) + PII scan + secrets detection + staged-file lint
- Pre-push: rebase on main before push
- Commit-msg: conventional commits enforcement

**Templates**:
- `CLAUDE.md` with Local test section, Session Checklist, Harness architecture
- `plan.md` atomic task format
- `tests/compliance_check.sh` (SECURITY.md / gitleaks / git email / paths)
- `HANDOFF.md`, `CHANGELOG.md`

**Scripts**:
- `scripts/committer` — atomic commit wrapper (prevents `git add .`)
- `scripts/check-deps.sh` — dependency checker

## Usage

```bash
# Bootstrap a Python project
agentlint setup --lang python ~/Projects/my-repo

# Bootstrap a TypeScript project (public repo)
agentlint setup --lang ts --visibility public ~/Projects/my-repo

# Add only workflows to existing project
agentlint setup --lang python --workflows-only ~/Projects/my-repo
```

## Steps

1. Detect language from args (`--lang ts|python|node`)
2. Run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh --lang <lang> [options] <path>`
3. Report what was installed
4. Suggest next steps: `pre-commit install`, first commit, `agentlint check`

## After setup

Run `agentlint check` to verify everything is configured correctly.
