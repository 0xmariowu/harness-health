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
# Test 4: `check` with invalid scanner args does NOT emit a fake score report
# (P0-1 regression — see docs/comprehensive-remediation-plan.md).
# Before the transactional pipeline fix, scanner failure let scorer read
# empty stdin, scorer emitted total_score=0, and reporter printed
# "🏥 AgentLint — Score: 0/100 (core)" to stdout. CI parsers treated this
# as a real scan.
# ---------------------------------------------------------------------------
bogus_stdout="$(mktemp)"
bogus_stderr="$(mktemp)"
"$WRAPPER" check --bogus-flag >"$bogus_stdout" 2>"$bogus_stderr"
bogus_rc=$?

if [ "$bogus_rc" -eq 0 ]; then
  fail "invalid scanner args should exit non-zero, got 0"
else
  ok "invalid scanner args exit non-zero (rc=$bogus_rc)"
fi

if grep -q "AgentLint.*Score" "$bogus_stdout"; then
  fail "invalid scanner args still emit fake score report to stdout"
else
  ok "invalid scanner args do not emit fake score report"
fi

if grep -q "Unknown argument" "$bogus_stderr"; then
  ok "scanner stderr is forwarded to wrapper stderr"
else
  fail "scanner error message was not forwarded — user sees no reason"
fi

rm -f "$bogus_stdout" "$bogus_stderr"

# ---------------------------------------------------------------------------
# Test 5: `fix` with invalid scanner args does NOT run plan/fixer
# ---------------------------------------------------------------------------
fix_stdout="$(mktemp)"
fix_stderr="$(mktemp)"
"$WRAPPER" fix --bad-flag >"$fix_stdout" 2>"$fix_stderr"
fix_rc=$?

if [ "$fix_rc" -eq 0 ]; then
  fail "fix with bad scanner flag should exit non-zero, got 0"
else
  ok "fix with bad scanner flag exits non-zero"
fi

# fixer emits its own status JSON ({"executed":[...]}) when it runs; the
# transactional wrapper should prevent that from ever appearing on bogus args.
if grep -q "executed" "$fix_stdout"; then
  fail "fix ran the fixer after scanner failure"
else
  ok "fix short-circuits before plan/fixer when scanner fails"
fi

rm -f "$fix_stdout" "$fix_stderr"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "$((PASS + FAIL)) tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
