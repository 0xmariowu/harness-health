#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:?Usage: create_synthetic.sh <target-dir>}"
mkdir -p "$TARGET"

write_base_claude() {
  local dir="$1"
  cat > "$dir/CLAUDE.md" <<'EOF'
# MyProject

> For global rules, see ~/.claude/CLAUDE.md. This file contains project-specific rules.

## Local test (run before push)

```bash
npm test
```

## Rules
- Don't commit .env files. Because: secrets leak.
- Don't use console.log in production code. Instead, use a logger. Because: logs are hard to filter.
EOF
}

write_well_configured_claude() {
  local dir="$1"
  cat > "$dir/CLAUDE.md" <<'EOF'
# MyProject

> For global rules, see ~/.claude/CLAUDE.md. This file contains project-specific rules.

## Local test (run before push)

```bash
npm test
```

## Session checklist
- Read HANDOFF.md before making changes.
- Confirm the requested scope before editing files.
- Inspect git status before starting work.
- Keep unrelated user changes intact.
- Run the local test command before handing off.
- Update HANDOFF.md when readiness conditions change.
- Record known risks in the final response.
- Avoid changing generated files unless asked.
- Prefer small commits with clear messages.
- Check CI workflow changes for pinned actions.
- Check security-sensitive files for leaked secrets.
- Review package scripts before relying on them.
- Preserve existing project conventions.
- Note skipped verification steps.
- Leave the repo in a reproducible state.

## Rules
- Don't commit .env files. Because: secrets leak.
- Don't use console.log in production code. Instead, use a logger. Because: logs are hard to filter.
- Keep dependency changes minimal. Because: broad updates create review noise.
- Pin GitHub Actions by SHA. Because: floating tags can change without review.
- Keep tests close to the behavior they verify. Because: focused tests fail clearly.
- Use structured config files instead of parsing text ad hoc. Because: structure reduces false positives.
- Prefer project-local scripts over global tools. Because: local scripts match CI.
- Add changelog entries for user-visible fixes. Because: release notes need traceability.
- Document security reporting paths. Because: users need a safe disclosure route.
- Avoid TODOs without owners. Because: orphaned TODOs become stale.
- Keep handoffs specific and testable. Because: future sessions need concrete readiness checks.
- Avoid broad refactors in fix commits. Because: scoped changes are easier to verify.
- Include failure context in error messages. Because: operators need actionable output.
- Treat warnings as useful signals. Because: repeated warnings hide real regressions.
- Keep sample secrets fake and obvious. Because: scanners should not see plausible live keys.
- Use deterministic fixtures. Because: E2B tests must be repeatable.
- Prefer fast unit tests for default checks. Because: feedback speed matters.
- Keep live network tests opt-in. Because: sandboxes can be rate-limited.
- Keep public APIs backward compatible. Because: downstream users depend on stable commands.
- Validate JSON output with a parser. Because: formatting bugs break automation.

## Workflow expectations
- Start with the smallest file set that can solve the request.
- Add tests when behavior changes.
- Re-run the exact command listed in this file.
- Read scanner JSONL when a score looks surprising.
- Keep evidence tied to file paths and commands.
- Prefer plain Markdown for handoff notes.
- Keep CI green before declaring readiness.
- Explain any intentional deviation from these rules.
EOF
}

commit_repo() {
  local dir="$1"
  local name="$2"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "init: $name"
}

create_repo() {
  local name="$1"
  local dir="$TARGET/$name"
  rm -rf "$dir"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@agentlint.test"
  git -C "$dir" config user.name "AgentLint Test"

  case "$name" in
    empty-repo)
      git -C "$dir" commit --allow-empty -q -m "init: $name"
      ;;

    claude-only)
      write_base_claude "$dir"
      commit_repo "$dir" "$name"
      ;;

    floating-tags)
      write_base_claude "$dir"
      mkdir -p "$dir/.github/workflows"
      cat > "$dir/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm test
EOF
      commit_repo "$dir" "$name"
      ;;

    hardcoded-secret)
      write_base_claude "$dir"
      mkdir -p "$dir/src"
      cat > "$dir/src/config.js" <<'EOF'
const API_KEY = "sk-abc123xyz789secretkey";
const DB_PASSWORD = "hunter2";
module.exports = { API_KEY, DB_PASSWORD };
EOF
      commit_repo "$dir" "$name"
      ;;

    well-configured)
      write_well_configured_claude "$dir"
      mkdir -p "$dir/.github/workflows" "$dir/tests"
      cat > "$dir/HANDOFF.md" <<'EOF'
# Handoff
E2B Phase 1: 96.3/100 🟢 READY
CI: 33/33 ✅
EOF
      cat > "$dir/SECURITY.md" <<'EOF'
## Reporting
Email security@example.com
EOF
      cat > "$dir/CHANGELOG.md" <<'EOF'
# Changelog
## v1.0.0 — Fixed auth bypass bug because tokens weren't validated
EOF
      cat > "$dir/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
      - run: npm test
EOF
      cat > "$dir/.gitignore" <<'EOF'
.env
EOF
      cat > "$dir/tests/unit.test.js" <<'EOF'
test('basic', () => expect(1).toBe(1));
EOF
      cat > "$dir/package.json" <<'EOF'
{"name":"test","version":"1.0.0","scripts":{"test":"node tests/unit.test.js"}}
EOF
      commit_repo "$dir" "$name"
      ;;

    python-project)
      mkdir -p "$dir/.github/workflows" "$dir/tests"
      cat > "$dir/CLAUDE.md" <<'EOF'
# MyProject

## Local test
```bash
pytest tests/unit/ -x -q -m 'not live'
```
EOF
      cat > "$dir/pyproject.toml" <<'EOF'
[project]
name = "myproject"
version = "0.1.0"

[tool.pytest.ini_options]
markers = [
    "unit: fast unit tests",
    "smoke: subprocess tests",
    "live: live network tests",
    "perf: performance tests",
]
EOF
      : > "$dir/tests/__init__.py"
      cat > "$dir/tests/test_basic.py" <<'EOF'
def test_example(): assert 1 == 1
EOF
      cat > "$dir/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
      - run: pytest tests/unit/ -x -q -m 'not live'
EOF
      commit_repo "$dir" "$name"
      ;;

    *)
      echo "Unknown synthetic repo: $name" >&2
      return 1
      ;;
  esac

  echo "  created: $name"
}

echo "Creating synthetic repos in $TARGET..."
create_repo "empty-repo"
create_repo "claude-only"
create_repo "floating-tags"
create_repo "hardcoded-secret"
create_repo "well-configured"
create_repo "python-project"
echo "Done: 6 synthetic repos created."
