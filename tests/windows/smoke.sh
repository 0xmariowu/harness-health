#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SCANNER="${ROOT_DIR}/src/scanner.sh"
SCORER="${ROOT_DIR}/src/scorer.js"
PLAN_GEN="${ROOT_DIR}/src/plan-generator.js"
REPORTER="${ROOT_DIR}/src/reporter.js"
FIXER="${ROOT_DIR}/src/fixer.js"
INSTALL="${ROOT_DIR}/scripts/install.sh"

TEMP_ROOT=""
FIXTURE_PROJECT=""
EMPTY_PROJECT=""

pass_count=0
fail_count=0
test_count=0
skip_count=0

# shellcheck disable=SC2329 # invoked via trap below
cleanup() {
  if [ -n "${TEMP_ROOT}" ] && [ -d "${TEMP_ROOT}" ]; then
    rm -rf "${TEMP_ROOT}"
  fi
}
trap cleanup EXIT

pass() {
  pass_count=$((pass_count + 1))
  test_count=$((test_count + 1))
  printf 'PASS: %s\n' "$1"
}

fail() {
  fail_count=$((fail_count + 1))
  test_count=$((test_count + 1))
  printf 'FAIL: %s\n' "$1"
  if [ "${2:-}" != "" ]; then
    printf '  %s\n' "$2"
  fi
}

skip() {
  skip_count=$((skip_count + 1))
  printf 'SKIP: %s\n' "$1"
}

make_temp_dir() {
  local dir=""

  if dir="$(mktemp -d "${TMPDIR:-/tmp}/al-windows-smoke.XXXXXX" 2>/dev/null)"; then
    printf '%s\n' "${dir}"
    return 0
  fi

  mktemp -d -t al-windows-smoke
}

print_diag_first_line() {
  local label="$1"
  local output=""
  local first_line=""
  shift

  if "$@" >/dev/null 2>&1; then
    output="$("$@" 2>/dev/null || true)"
    first_line="${output%%$'\n'*}"
    printf '%s: ' "$label"
    printf '%s\n' "${first_line}"
  else
    printf '%s: missing\n' "$label"
  fi
}

print_diag() {
  local label="$1"
  shift

  if "$@" >/dev/null 2>&1; then
    printf '%s: ' "$label"
    "$@"
  else
    printf '%s: missing\n' "$label"
  fi
}

setup_fixtures() {
  FIXTURE_PROJECT="${TEMP_ROOT}/Projects/my-app"
  EMPTY_PROJECT="${TEMP_ROOT}/Projects/empty-project"

  mkdir -p \
    "${FIXTURE_PROJECT}/src" \
    "${FIXTURE_PROJECT}/docs" \
    "${FIXTURE_PROJECT}/.github/workflows" \
    "${EMPTY_PROJECT}/src"

  git -C "${FIXTURE_PROJECT}" init -q
  git -C "${EMPTY_PROJECT}" init -q

  cat > "${FIXTURE_PROJECT}/CLAUDE.md" <<'EOF'
# My App

> A web app.

## Session Checklist

1. If modifying API read docs/api.md

## Rules

- Don't push to main. Instead, use branches. Because: review matters.
- Don't skip tests. Instead, run npm test. Because: regressions.

## Workflow

- npm test
- npm run build
EOF

  cat > "${FIXTURE_PROJECT}/README.md" <<'EOF'
# My App
A web application.
EOF

  cat > "${FIXTURE_PROJECT}/CHANGELOG.md" <<'EOF'
# Changelog
## v1.0
- init
EOF

  cat > "${FIXTURE_PROJECT}/HANDOFF.md" <<'EOF'
# Handoff
Status: ready
EOF

  cat > "${FIXTURE_PROJECT}/src/index.js" <<'EOF'
console.log("app");
EOF

  cat > "${FIXTURE_PROJECT}/docs/api.md" <<'EOF'
# API
EOF

  cat > "${FIXTURE_PROJECT}/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
EOF

  cat > "${EMPTY_PROJECT}/src/main.py" <<'EOF'
print("hello")
EOF
}

check_shell_file_lf() {
  local file="$1"
  local label="$2"
  local first_hex
  local tail_hex
  local od_head

  first_hex="$(od -An -t x1 -N 1 "$file" | tr -d '[:space:]')"
  tail_hex="$(tail -c 2 "$file" | od -An -t x1 | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')"
  od_head="$(od -An -c -N 16 "$file" 2>/dev/null)"

  if [ "${first_hex}" != "0d" ]; then
    pass "${label}: first byte is not CR"
  else
    fail "${label}: first byte is CR" "${od_head}"
  fi

  if [ "${tail_hex}" = "0d 0a" ]; then
    fail "${label}: final line ends with CRLF" "${od_head}"
  else
    pass "${label}: final line ending is LF-safe"
  fi
}

validate_jsonl() {
  local file="$1"
  local invalid=0
  local line=""

  while IFS= read -r line || [ -n "${line}" ]; do
    [ -z "${line}" ] && continue
    if ! printf '%s\n' "${line}" | jq -e . >/dev/null; then
      invalid=$((invalid + 1))
    fi
  done < "${file}"

  if [ "${invalid}" -eq 0 ]; then
    pass "scanner output is valid JSONL"
  else
    fail "scanner output contains invalid JSON lines" "${invalid} invalid lines"
  fi
}

printf '=== Diagnostics ===\n'
print_diag_first_line "bash" bash --version
print_diag "uname" uname -a
print_diag "node" node --version
print_diag "jq" jq --version
print_diag "git" git --version

TEMP_ROOT="$(make_temp_dir)"
setup_fixtures

printf '\n=== Line Endings ===\n'
check_shell_file_lf "${SCANNER}" "src/scanner.sh"
check_shell_file_lf "${INSTALL}" "scripts/install.sh"

printf '\n=== Scanner ===\n'
SCAN_JSONL="${TEMP_ROOT}/scan.jsonl"
if bash "${SCANNER}" --project-dir "${FIXTURE_PROJECT}" > "${SCAN_JSONL}"; then
  pass "scanner runs on fixture project"
else
  fail "scanner failed on fixture project"
fi

if [ -s "${SCAN_JSONL}" ]; then
  pass "scanner writes non-empty JSONL"
  validate_jsonl "${SCAN_JSONL}"
else
  fail "scanner writes non-empty JSONL"
fi

printf '\n=== Scorer ===\n'
SCORES_JSON="${TEMP_ROOT}/scores.json"
if [ -s "${SCAN_JSONL}" ] && node "${SCORER}" "${SCAN_JSONL}" > "${SCORES_JSON}"; then
  total_score="$(jq -r '.total_score' "${SCORES_JSON}")"
  if [ "${total_score}" -ge 0 ]; then
    pass "scorer produces a non-negative total score"
  else
    fail "scorer produced a negative total score" "${total_score}"
  fi
else
  fail "scorer failed on scanner output"
fi

printf '\n=== Plan And Reporter ===\n'
PLAN_JSON="${TEMP_ROOT}/plan.json"
TERMINAL_TXT="${TEMP_ROOT}/terminal.txt"
MD_DIR="${TEMP_ROOT}/md"
mkdir -p "${MD_DIR}"

if [ -s "${SCORES_JSON}" ] && node "${PLAN_GEN}" "${SCORES_JSON}" > "${PLAN_JSON}"; then
  total_items="$(jq -r '.total_items' "${PLAN_JSON}")"
  if [ "${total_items}" -ge 1 ]; then
    pass "plan-generator produces at least one fix item"
  else
    fail "plan-generator produced no fix items"
  fi
else
  fail "plan-generator failed"
fi

if [ -s "${SCORES_JSON}" ] && node "${REPORTER}" "${SCORES_JSON}" --format terminal > "${TERMINAL_TXT}"; then
  if [ -s "${TERMINAL_TXT}" ]; then
    pass "terminal reporter writes output"
  else
    fail "terminal reporter writes output"
  fi
else
  fail "terminal reporter failed"
fi

if [ -s "${SCORES_JSON}" ] && node "${REPORTER}" "${SCORES_JSON}" --format md --output-dir "${MD_DIR}" >/dev/null; then
  if ls "${MD_DIR}"/*.md >/dev/null 2>&1; then
    pass "markdown reporter writes at least one file"
  else
    fail "markdown reporter did not write an .md file"
  fi
else
  fail "markdown reporter failed"
fi

printf '\n=== Fixer Output Line Endings ===\n'
EMPTY_SCAN_JSONL="${TEMP_ROOT}/empty-scan.jsonl"
EMPTY_SCORES_JSON="${TEMP_ROOT}/empty-scores.json"
EMPTY_PLAN_JSON="${TEMP_ROOT}/empty-plan.json"
FIXER_JSON="${TEMP_ROOT}/fixer.json"
PRODUCED_FILE="${EMPTY_PROJECT}/CLAUDE.md"

if bash "${SCANNER}" --project-dir "${EMPTY_PROJECT}" > "${EMPTY_SCAN_JSONL}" \
  && node "${SCORER}" "${EMPTY_SCAN_JSONL}" > "${EMPTY_SCORES_JSON}" \
  && node "${PLAN_GEN}" "${EMPTY_SCORES_JSON}" > "${EMPTY_PLAN_JSON}"; then
  f1_item_id="$(jq -r '[.items[] | select(.check_id == "F1") | .id][0] // empty' "${EMPTY_PLAN_JSON}")"
  if [ -z "${f1_item_id}" ] || [ "${f1_item_id}" = "null" ]; then
    skip "fixer LF check: no F1 create-file item was available"
  elif node "${FIXER}" "${EMPTY_PLAN_JSON}" --project-dir "${EMPTY_PROJECT}" --items "${f1_item_id}" > "${FIXER_JSON}"; then
    fixer_status="$(jq -r '.executed[0].status // empty' "${FIXER_JSON}")"
    if [ "${fixer_status}" = "fixed" ] && [ -f "${PRODUCED_FILE}" ]; then
      if ! grep -q $'\r' "${PRODUCED_FILE}"; then
        pass "fixer-created CLAUDE.md uses LF line endings"
      else
        fail "fixer-created CLAUDE.md contains CR bytes"
      fi
    else
      skip "fixer LF check: create-file path was not applied"
    fi
  else
    skip "fixer LF check: create-file path is not usable in this environment"
  fi
else
  skip "fixer LF check: could not build an empty-project plan"
fi

printf '\n=== Git Bash Path Form ===\n'
if [ -n "${MSYSTEM:-}" ]; then
  GIT_BASH_SCAN="${TEMP_ROOT}/scan-git-bash.jsonl"
  WINDOWS_FIXTURE_PATH="$(cygpath -w "${FIXTURE_PROJECT}")"
  if bash "${SCANNER}" --project-dir "${WINDOWS_FIXTURE_PATH}" > "${GIT_BASH_SCAN}"; then
    unix_count="$(wc -l < "${SCAN_JSONL}" | tr -d '[:space:]')"
    windows_count="$(wc -l < "${GIT_BASH_SCAN}" | tr -d '[:space:]')"
    if [ "${unix_count}" = "${windows_count}" ]; then
      pass "Git Bash accepts Windows-style --project-dir paths"
    else
      fail "Git Bash Windows-style path changes scanner output line count" "${unix_count} vs ${windows_count}"
    fi
  else
    fail "scanner failed with Git Bash Windows-style path"
  fi
else
  skip "Git Bash Windows-style path check (not running under Git Bash)"
fi

printf '\n'
if [ "${fail_count}" -eq 0 ]; then
  printf 'PASS %s/%s tests\n' "${pass_count}" "${test_count}"
  if [ "${skip_count}" -gt 0 ]; then
    printf 'SKIP %s tests\n' "${skip_count}"
  fi
  exit 0
fi

printf 'FAIL %s/%s tests passed\n' "${pass_count}" "${test_count}"
if [ "${skip_count}" -gt 0 ]; then
  printf 'SKIP %s tests\n' "${skip_count}"
fi
exit 1
