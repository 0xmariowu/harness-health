#!/usr/bin/env bash
# CLI wrapper regression tests — exercise scripts/agentlint.sh under macOS
# system Bash (3.2) to catch Bash 4+ syntax and default-argument regressions.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WRAPPER="$REPO_ROOT/scripts/agentlint.sh"
PASS=0
FAIL=0

ok()   { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# ---------------------------------------------------------------------------
# Pick the oldest bash on PATH — /bin/bash on macOS is 3.2. On Linux systems
# without bash 3, fall back to whatever bash is available (still exercises
# the `tr` portable uppercase path).
# ---------------------------------------------------------------------------
BASH_BIN="/bin/bash"
if [ ! -x "$BASH_BIN" ]; then
  BASH_BIN="$(command -v bash)"
fi
BASH_VER="$($BASH_BIN --version | head -1 | grep -oE 'version [0-9]+' | awk '{print $2}')"
echo "Using bash: $BASH_BIN (major version $BASH_VER)"

# ---------------------------------------------------------------------------
# Test 1: `fix <lowercase>` does not trigger "bad substitution" on Bash 3.2
# (regression test for `${1^^}` which is Bash 4+ only).
# ---------------------------------------------------------------------------
tmp_repo="$(mktemp -d)"
git -C "$tmp_repo" init -q
git -C "$tmp_repo" config user.email "test@test.com"
git -C "$tmp_repo" config user.name "Test"
git -C "$tmp_repo" commit --allow-empty -q -m "init"

out="$($BASH_BIN "$WRAPPER" fix w11 --project-dir "$tmp_repo" 2>&1 || true)"
if echo "$out" | grep -q "bad substitution"; then
  fail "case-insensitive check id triggers 'bad substitution' on $BASH_BIN"
else
  ok "case-insensitive check id parses on $BASH_BIN"
fi

# Confirm lowercase 'w11' was normalized to uppercase W11 somewhere in the
# pipeline output (fixer echoes the check_id in its result JSON).
if echo "$out" | grep -q '"check_id": "W11"'; then
  ok "lowercase 'w11' normalized to 'W11'"
else
  fail "lowercase 'w11' did not normalize — output: $(echo "$out" | head -3)"
fi

rm -rf "$tmp_repo"

# ---------------------------------------------------------------------------
# Test 2: `fix` without `--project-dir` defaults to current directory
# (regression: previously failed with "--project-dir is required").
# ---------------------------------------------------------------------------
tmp_repo2="$(mktemp -d)"
git -C "$tmp_repo2" init -q
git -C "$tmp_repo2" config user.email "test@test.com"
git -C "$tmp_repo2" config user.name "Test"
git -C "$tmp_repo2" commit --allow-empty -q -m "init"

out2="$(cd "$tmp_repo2" && $BASH_BIN "$WRAPPER" fix w11 2>&1 || true)"
if echo "$out2" | grep -q -- "--project-dir is required"; then
  fail "fix without --project-dir does not default to cwd"
else
  ok "fix without --project-dir defaults to cwd"
fi

rm -rf "$tmp_repo2"

# ---------------------------------------------------------------------------
# Test 3: explicit `--project-dir` still works (don't break existing callers)
# ---------------------------------------------------------------------------
tmp_repo3="$(mktemp -d)"
git -C "$tmp_repo3" init -q
git -C "$tmp_repo3" config user.email "test@test.com"
git -C "$tmp_repo3" config user.name "Test"
git -C "$tmp_repo3" commit --allow-empty -q -m "init"

out3="$($BASH_BIN "$WRAPPER" fix W11 --project-dir "$tmp_repo3" 2>&1 || true)"
if echo "$out3" | grep -q '"check_id": "W11"'; then
  ok "explicit --project-dir still works"
else
  fail "explicit --project-dir regressed — output: $(echo "$out3" | head -3)"
fi

rm -rf "$tmp_repo3"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "$((PASS + FAIL)) tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
