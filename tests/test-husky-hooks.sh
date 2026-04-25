#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/al-husky-hooks.XXXXXX")"
TEST_COUNT=0
PASS_COUNT=0
FAIL_COUNT=0

cleanup() {
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT

pass() {
  printf 'PASS: %s\n' "$1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  printf 'FAIL: %s\n' "$1"
  if [[ -n "${2:-}" ]]; then
    printf '%s\n' "$2"
  fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

run_test() {
  local name="$1"
  shift
  TEST_COUNT=$((TEST_COUNT + 1))
  TEST_ERROR=""
  if "$@"; then
    pass "$name"
  else
    fail "$name" "${TEST_ERROR:-unknown failure}"
  fi
}

test_positive_hooks_installed() {
  local repo
  repo="$TMP_ROOT/positive"
  mkdir -p "$repo"
  git -C "$repo" init --initial-branch=main >/dev/null

  if ! bash "$ROOT_DIR/scripts/setup.sh" --lang ts --no-install "$repo" >/tmp/positive-setup.log 2>&1; then
    TEST_ERROR="agentlint setup failed"
    return 1
  fi

  [[ -x "$repo/.husky/pre-commit" ]] || { TEST_ERROR="missing executable: $repo/.husky/pre-commit"; return 1; }
  [[ -x "$repo/.husky/pre-push" ]] || { TEST_ERROR="missing executable: $repo/.husky/pre-push"; return 1; }
  [[ -x "$repo/.husky/commit-msg" ]] || { TEST_ERROR="missing executable: $repo/.husky/commit-msg"; return 1; }
  [[ "$(git -C "$repo" config --get core.hooksPath || true)" == ".husky" ]] || {
    TEST_ERROR="core.hooksPath is not .husky"
    return 1
  }
}

test_negative_no_hooks_no_husky_dir() {
  local repo fake_root
  repo="$TMP_ROOT/negative"
  fake_root="$TMP_ROOT/fake-root"
  mkdir -p "$repo" "$fake_root/scripts"
  git -C "$repo" init --initial-branch=main >/dev/null

  cp "$ROOT_DIR/scripts/setup.sh" "$fake_root/scripts/setup.sh"
  cp -R "$ROOT_DIR/templates" "$fake_root/templates"
  rm -f "$fake_root/templates/hooks/husky/"*

  if bash "$fake_root/scripts/setup.sh" --lang ts --no-install "$repo" >/tmp/negative-setup.log 2>&1; then
    TEST_ERROR="setup should fail when husky template directory is empty"
    return 1
  fi

  if ! grep -q "no husky hooks generated; refusing to set core.hooksPath" /tmp/negative-setup.log; then
    TEST_ERROR="setup did not report missing husky hooks"
    return 1
  fi

  if [[ -f "$repo/.husky/pre-commit" || -f "$repo/.husky/pre-push" || -f "$repo/.husky/commit-msg" ]]; then
    TEST_ERROR="hooks should not be generated when template hook source is absent"
    return 1
  fi
  if [[ -n "$(git -C "$repo" config --get core.hooksPath || true)" ]]; then
    TEST_ERROR="core.hooksPath should stay unset when husky copy is skipped"
    return 1
  fi
}

run_test "positive: setup writes executable husky hooks and sets core.hooksPath" test_positive_hooks_installed
run_test "negative: setup refuses when no husky templates are available" test_negative_no_hooks_no_husky_dir

echo "Summary: total=$TEST_COUNT passed=$PASS_COUNT failed=$FAIL_COUNT"
[[ "$FAIL_COUNT" -eq 0 ]]
