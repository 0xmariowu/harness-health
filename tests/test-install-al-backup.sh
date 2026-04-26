#!/usr/bin/env bash
# F003 S5: scripts/install.sh must back up an existing different
# ~/.claude/commands/al.md before overwriting it. Stubs `claude` so the
# test is hermetic and never touches the real plugin marketplace.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/al-install-backup.XXXXXX")"
TEST_COUNT=0
PASS_COUNT=0
FAIL_COUNT=0

cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT

pass() { printf 'PASS: %s\n' "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() {
  printf 'FAIL: %s\n' "$1"
  if [[ -n "${2:-}" ]]; then printf '%s\n' "$2"; fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
}
run_test() {
  local name="$1"; shift
  TEST_COUNT=$((TEST_COUNT + 1)); TEST_ERROR=""
  if "$@"; then pass "$name"; else fail "$name" "${TEST_ERROR:-unknown failure}"; fi
}

# Build a fake plugin cache + matching `claude` stub so install.sh's
# Claude Code branch progresses to the al.md copy block without hitting
# the network or the real CLI.
setup_sandbox() {
  local home="$1"
  mkdir -p "$home/.claude/plugins/cache/agent-lint/agent-lint/0.0.0-test/commands"
  printf 'NEW al.md content\n' > "$home/.claude/plugins/cache/agent-lint/agent-lint/0.0.0-test/commands/al.md"

  mkdir -p "$home/bin"
  cat > "$home/bin/claude" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  plugin)
    case "${2:-}" in
      marketplace)
        case "${3:-}" in
          add) echo "Successfully added marketplace"; exit 0 ;;
          remove) exit 0 ;;
        esac ;;
      install) echo "Successfully installed agent-lint@agent-lint"; exit 0 ;;
    esac ;;
esac
exit 0
EOF
  chmod +x "$home/bin/claude"
}

run_install() {
  local home="$1"
  HOME="$home" PATH="$home/bin:$PATH" \
    bash "$ROOT_DIR/scripts/install.sh" \
    >"$TMP_ROOT/install.log" 2>&1
}

test_clobber_creates_backup() {
  local home="$TMP_ROOT/case-clobber"
  setup_sandbox "$home"
  mkdir -p "$home/.claude/commands"
  printf 'OLD CUSTOM CONTENT\n' > "$home/.claude/commands/al.md"

  if ! run_install "$home"; then
    TEST_ERROR="install.sh failed; see $TMP_ROOT/install.log"
    return 1
  fi

  # Backup file must exist with the OLD content.
  local backup
  backup=$(find "$home/.claude/commands" -maxdepth 1 -name 'al.md.bak.*' -print -quit)
  if [[ -z "$backup" ]]; then
    TEST_ERROR="no al.md.bak.* backup created in $home/.claude/commands"
    return 1
  fi
  if ! grep -q 'OLD CUSTOM CONTENT' "$backup"; then
    TEST_ERROR="backup does not contain original content"
    return 1
  fi

  # New file must contain the NEW content.
  if ! grep -q 'NEW al.md content' "$home/.claude/commands/al.md"; then
    TEST_ERROR="al.md was not replaced with the new template"
    return 1
  fi

  # The user-facing log should mention the backup so they know.
  if ! grep -q 'backed up to' "$TMP_ROOT/install.log"; then
    TEST_ERROR="install.sh did not announce the backup in stdout"
    return 1
  fi
}

test_identical_does_not_backup() {
  local home="$TMP_ROOT/case-identical"
  setup_sandbox "$home"
  mkdir -p "$home/.claude/commands"
  cp "$home/.claude/plugins/cache/agent-lint/agent-lint/0.0.0-test/commands/al.md" \
     "$home/.claude/commands/al.md"

  if ! run_install "$home"; then
    TEST_ERROR="install.sh failed; see $TMP_ROOT/install.log"
    return 1
  fi

  # Identical content → no backup churn.
  if find "$home/.claude/commands" -maxdepth 1 -name 'al.md.bak.*' -print -quit | grep -q .; then
    TEST_ERROR="install.sh created a spurious backup when content was already identical"
    return 1
  fi
}

test_fresh_install_no_backup() {
  local home="$TMP_ROOT/case-fresh"
  setup_sandbox "$home"

  if ! run_install "$home"; then
    TEST_ERROR="install.sh failed on a fresh HOME; see $TMP_ROOT/install.log"
    return 1
  fi

  if [[ ! -f "$home/.claude/commands/al.md" ]]; then
    TEST_ERROR="install.sh did not install al.md on fresh HOME"
    return 1
  fi
  if find "$home/.claude/commands" -maxdepth 1 -name 'al.md.bak.*' -print -quit | grep -q .; then
    TEST_ERROR="install.sh created an unnecessary backup on a fresh HOME"
    return 1
  fi
}

run_test "clobber: existing different al.md backed up before overwrite" test_clobber_creates_backup
run_test "identical: existing matching al.md leaves no backup churn" test_identical_does_not_backup
run_test "fresh: no preexisting al.md installs cleanly without backup" test_fresh_install_no_backup

echo "Summary: total=$TEST_COUNT passed=$PASS_COUNT failed=$FAIL_COUNT"
[[ "$FAIL_COUNT" -eq 0 ]]
