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
# Test 6: `check --format html --output-dir` writes an HTML report
# (P2-4 — exposes reporter flags through the CLI, previously Action-only).
# ---------------------------------------------------------------------------
check_repo="$(mktemp -d)"
check_out="$(mktemp -d)"
git -C "$check_repo" init -q
git -C "$check_repo" config user.email "test@test.com"
git -C "$check_repo" config user.name "Test"
printf '# Project\n' > "$check_repo/CLAUDE.md"
git -C "$check_repo" add -A
git -C "$check_repo" commit -q -m init

"$WRAPPER" check --project-dir "$check_repo" --format html --output-dir "$check_out" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ] && ls "$check_out"/*.html >/dev/null 2>&1; then
  ok "check --format html --output-dir writes HTML file"
else
  fail "check --format html --output-dir failed (rc=$rc)"
fi

rm -rf "$check_repo" "$check_out"

# ---------------------------------------------------------------------------
# Test 7: `check --fail-below N` gates on score.
# ---------------------------------------------------------------------------
gate_repo="$(mktemp -d)"
git -C "$gate_repo" init -q
git -C "$gate_repo" config user.email "test@test.com"
git -C "$gate_repo" config user.name "Test"
printf '# Project\n' > "$gate_repo/CLAUDE.md"
git -C "$gate_repo" add -A
git -C "$gate_repo" commit -q -m init

"$WRAPPER" check --project-dir "$gate_repo" --fail-below 99 >/dev/null 2>&1
if [ "$?" -ne 0 ]; then
  ok "check --fail-below 99 exits non-zero"
else
  fail "check --fail-below 99 did not exit non-zero"
fi

"$WRAPPER" check --project-dir "$gate_repo" --fail-below 0 >/dev/null 2>&1
if [ "$?" -eq 0 ]; then
  ok "check --fail-below 0 exits zero"
else
  fail "check --fail-below 0 did not exit zero"
fi

rm -rf "$gate_repo"

# ---------------------------------------------------------------------------
# Test 8: missing-value flags exit non-zero with a clear stderr message
# (post-remediation-deep-review High #2 — `fix --project-dir` previously
#  returned 0 with `$1: unbound variable` on stderr).
# ---------------------------------------------------------------------------
for combo in "check --format" "check --project-dir" "check --output-dir" \
             "check --fail-below" "check --before" "fix --project-dir"; do
  # shellcheck disable=SC2086
  err="$("$WRAPPER" $combo 2>&1 1>/dev/null)"
  rc=$?
  if [ "$rc" -ne 0 ] && echo "$err" | grep -q "requires a value"; then
    ok "missing value for ${combo##* } → clear error (combo: $combo)"
  else
    fail "missing value for '$combo' should error with 'requires a value', got rc=$rc err='$err'"
  fi
done

# ---------------------------------------------------------------------------
# Test 9: equals form `--flag=value` works end-to-end for check
# (post-remediation-deep-review Medium #3 — agentlint.sh accepted
#  `--format=html` but scanner.sh and reporter.js only understood space form,
#  so HTML silently didn't get written.)
# ---------------------------------------------------------------------------
eq_repo="$(mktemp -d)"
eq_out="$(mktemp -d)"
git -C "$eq_repo" init -q
git -C "$eq_repo" config user.email "t@t"
git -C "$eq_repo" config user.name "t"
printf '# Project\n' > "$eq_repo/CLAUDE.md"
git -C "$eq_repo" add -A
git -C "$eq_repo" commit -q -m init

"$WRAPPER" check --project-dir="$eq_repo" --format=html --output-dir="$eq_out" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ] && ls "$eq_out"/*.html >/dev/null 2>&1; then
  ok "--flag=value equals form writes HTML end-to-end"
else
  fail "--flag=value form failed (rc=$rc, no HTML in $eq_out)"
fi
rm -rf "$eq_repo" "$eq_out"

# ---------------------------------------------------------------------------
# Test 10: `check` with no target defaults to current directory
# (million-user-product-readiness-audit P0-1 — previously fell through to
#  scanner's auto-discovery of ~/Projects, surprising users inside unrelated
#  repos.)
# ---------------------------------------------------------------------------
default_repo="$(mktemp -d)"
git -C "$default_repo" init -q
git -C "$default_repo" config user.email "t@t"
git -C "$default_repo" config user.name "t"
# Signature entry so we can confirm this repo got scanned.
printf '# DefaultRepoFixture\n' > "$default_repo/CLAUDE.md"
git -C "$default_repo" add -A
git -C "$default_repo" commit -q -m init

# Run `check` with no --project-dir and no --all from inside the repo.
# Use a subshell so cd doesn't leak back into the test script.
(
  cd "$default_repo" || exit 1
  "$WRAPPER" check --format jsonl --output-dir "$default_repo/reports" >/dev/null 2>&1
) || true

if ls "$default_repo/reports"/*.jsonl >/dev/null 2>&1; then
  first_project="$(grep -oE '"project":"[^"]+"' "$default_repo"/reports/*.jsonl | head -1 | sed 's/.*":"//;s/"//')"
  # The project name in scanner output is the basename of the scanned dir.
  # For `.` in our tmp repo it should match the tmp-dir basename.
  expected_basename="$(basename "$default_repo")"
  if [ "$first_project" = "$expected_basename" ]; then
    ok "check (no args) scans current directory, not ~/Projects"
  else
    fail "check default scanned '$first_project' not '$expected_basename' — P0-1 regression"
  fi
else
  fail "check (no args) produced no JSONL report"
fi

rm -rf "$default_repo"

# ---------------------------------------------------------------------------
# Test 11: `check --all --projects-root ROOT` discovers child git repos
# ---------------------------------------------------------------------------
root="$(mktemp -d)"
mkdir -p "$root/alpha" "$root/beta"
for r in alpha beta; do
  git -C "$root/$r" init -q
  git -C "$root/$r" config user.email "t@t"
  git -C "$root/$r" config user.name "t"
  printf '# %s\n' "$r" > "$root/$r/CLAUDE.md"
  git -C "$root/$r" add -A
  git -C "$root/$r" commit -q -m init
done

# Invoke from unrelated cwd to prove --projects-root wins.
reports_dir="$(mktemp -d)"
(
  cd /tmp || exit 1
  "$WRAPPER" check --all --projects-root "$root" --format jsonl --output-dir "$reports_dir" >/dev/null 2>&1
) || true

if ls "$reports_dir"/*.jsonl >/dev/null 2>&1; then
  projects_seen="$(grep -oE '"project":"[^"]+"' "$reports_dir"/*.jsonl | sort -u | tr '\n' ',')"
  case ",$projects_seen," in
    *'"project":"alpha"'*'"project":"beta"'* | *'"project":"beta"'*'"project":"alpha"'*)
      ok "check --all --projects-root discovers both alpha and beta"
      ;;
    *)
      fail "check --all discovered: $projects_seen (expected alpha+beta)"
      ;;
  esac
else
  fail "check --all produced no JSONL report"
fi
rm -rf "$root" "$reports_dir"

# ---------------------------------------------------------------------------
# Test 12: `check --all` + `--project-dir` are mutually exclusive
# ---------------------------------------------------------------------------
combo_err="$("$WRAPPER" check --all --project-dir . 2>&1 1>/dev/null)"
combo_rc=$?
if [ "$combo_rc" -ne 0 ] && echo "$combo_err" | grep -q "mutually exclusive"; then
  ok "check --all + --project-dir error clearly"
else
  fail "check --all + --project-dir should error, got rc=$combo_rc err='$combo_err'"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "$((PASS + FAIL)) tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
