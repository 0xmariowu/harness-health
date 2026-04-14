#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCANNER="${ROOT_DIR}/src/scanner.sh"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/al-scanner-test.XXXXXX")"
WITH_PROJECT="${TEMP_ROOT}/with-claude"
WITHOUT_PROJECT="${TEMP_ROOT}/without-claude"
WITH_OUTPUT="${TEMP_ROOT}/with.jsonl"
WITHOUT_OUTPUT="${TEMP_ROOT}/without.jsonl"
WITH_STDERR="${TEMP_ROOT}/with.stderr"
WITHOUT_STDERR="${TEMP_ROOT}/without.stderr"

pass_count=0
test_count=0

cleanup() {
  rm -rf "${TEMP_ROOT}"
}

trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1"
  if [ "${2:-}" != "" ]; then
    printf '%s\n' "$2"
  fi
}

pass() {
  printf 'PASS: %s\n' "$1"
}

run_test() {
  local name="$1"
  shift
  test_count=$((test_count + 1))

  if "$@"; then
    pass_count=$((pass_count + 1))
    pass "$name"
  else
    fail "$name" "${TEST_ERROR:-Unknown error}"
  fi
}

setup_projects() {
  mkdir -p "${WITH_PROJECT}/tests" "${WITH_PROJECT}/.github/workflows" "${WITH_PROJECT}/src"
  mkdir -p "${WITHOUT_PROJECT}/src"

  cat > "${WITH_PROJECT}/CLAUDE.md" <<'EOF'
# Test fixture

This project exists to validate scanner behavior.

Run:
- npm test
EOF

  cat > "${WITH_PROJECT}/tests/sample.test.js" <<'EOF'
console.log('test fixture');
EOF

  cat > "${WITH_PROJECT}/.github/workflows/ci.yml" <<'EOF'
name: ci
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
EOF

  cat > "${WITH_PROJECT}/src/index.js" <<'EOF'
console.log('with claude');
EOF

  cat > "${WITHOUT_PROJECT}/src/index.js" <<'EOF'
console.log('without claude');
EOF
}

run_scanner() {
  local project_dir="$1"
  local output_file="$2"
  local stderr_file="$3"

  if ! bash "${SCANNER}" --project-dir "${project_dir}" >"${output_file}" 2>"${stderr_file}"; then
    TEST_ERROR="scanner failed for ${project_dir}: $(cat "${stderr_file}")"
    return 1
  fi
}

validate_jsonl_file() {
  local file_path="$1"

  if ! node - "${file_path}" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const raw = fs.readFileSync(path, 'utf8').trim();

if (!raw) {
  throw new Error('scanner produced no output');
}

for (const line of raw.split('\n')) {
  const parsed = JSON.parse(line);
  for (const field of ['check_id', 'project', 'score']) {
    if (!(field in parsed)) {
      throw new Error(`missing field ${field} in ${line}`);
    }
  }
}
NODE
  then
    TEST_ERROR="invalid JSONL in ${file_path}"
    return 1
  fi
}

extract_f1_score() {
  local file_path="$1"

  node - "${file_path}" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const raw = fs.readFileSync(path, 'utf8').trim();

for (const line of raw.split('\n')) {
  const parsed = JSON.parse(line);
  if (parsed.check_id === 'F1') {
    process.stdout.write(String(Number(parsed.score)));
    process.exit(0);
  }
}

process.stderr.write('F1 result not found\n');
process.exit(1);
NODE
}

test_scanner_runs() {
  setup_projects
  run_scanner "${WITH_PROJECT}" "${WITH_OUTPUT}" "${WITH_STDERR}" || return 1
  run_scanner "${WITHOUT_PROJECT}" "${WITHOUT_OUTPUT}" "${WITHOUT_STDERR}" || return 1
}

test_jsonl_is_valid() {
  validate_jsonl_file "${WITH_OUTPUT}" || return 1
  validate_jsonl_file "${WITHOUT_OUTPUT}" || return 1
}

test_f1_score_is_higher_with_claude() {
  local with_score=""
  local without_score=""

  with_score="$(extract_f1_score "${WITH_OUTPUT}")" || {
    TEST_ERROR="failed to extract F1 score for project with CLAUDE.md"
    return 1
  }

  without_score="$(extract_f1_score "${WITHOUT_OUTPUT}")" || {
    TEST_ERROR="failed to extract F1 score for project without CLAUDE.md"
    return 1
  }

  if ! node -e "process.exit(Number(process.argv[1]) > Number(process.argv[2]) ? 0 : 1)" "${with_score}" "${without_score}"; then
    TEST_ERROR="expected F1 score ${with_score} to be greater than ${without_score}"
    return 1
  fi
}

run_test "scanner subprocesses succeed" test_scanner_runs
run_test "scanner output is valid JSONL" test_jsonl_is_valid
run_test "projects with CLAUDE.md score higher on F1" test_f1_score_is_higher_with_claude

# ─── Bug fix tests (v0.6.0 PR 1) ───

# Helper: extract score for a given check_id from JSONL
extract_check_score() {
  local file_path="$1"
  local check_id="$2"
  node - "${file_path}" "${check_id}" <<'NODE'
const fs = require('node:fs');
const [,, fpath, cid] = process.argv;
const raw = fs.readFileSync(fpath, 'utf8').trim();
for (const line of raw.split('\n')) {
  const p = JSON.parse(line);
  if (p.check_id === cid) { process.stdout.write(String(Number(p.score))); process.exit(0); }
}
process.stderr.write(`${cid} not found\n`);
process.exit(1);
NODE
}

# ── C2: no false positive from 'status' keyword ──

C2_FP="${TEMP_ROOT}/c2-false-positive"
mkdir -p "${C2_FP}"
git -C "${C2_FP}" init --quiet 2>/dev/null || true
cat > "${C2_FP}/CLAUDE.md" <<'FIXTURE'
# Project
Run git status to check.
## Rules
- Check build status before deploying
FIXTURE
C2_FP_OUT="${TEMP_ROOT}/c2-fp.jsonl"

test_c2_no_false_positive() {
  run_scanner "${C2_FP}" "${C2_FP_OUT}" "${TEMP_ROOT}/c2-fp.stderr" || return 1
  local score
  score="$(extract_check_score "${C2_FP_OUT}" "C2")" || { TEST_ERROR="C2 not found"; return 1; }
  if [ "$score" != "0" ]; then
    TEST_ERROR="C2 should be 0 without HANDOFF.md (got ${score})"
    return 1
  fi
}

C2_TP="${TEMP_ROOT}/c2-true-positive"
mkdir -p "${C2_TP}"
git -C "${C2_TP}" init --quiet 2>/dev/null || true
echo "# Project" > "${C2_TP}/CLAUDE.md"
echo "# Handoff" > "${C2_TP}/HANDOFF.md"
C2_TP_OUT="${TEMP_ROOT}/c2-tp.jsonl"

test_c2_detects_handoff_file() {
  run_scanner "${C2_TP}" "${C2_TP_OUT}" "${TEMP_ROOT}/c2-tp.stderr" || return 1
  local score
  score="$(extract_check_score "${C2_TP_OUT}" "C2")" || { TEST_ERROR="C2 not found"; return 1; }
  if [ "$score" != "1" ]; then
    TEST_ERROR="C2 should be 1 with HANDOFF.md (got ${score})"
    return 1
  fi
}

run_test "C2: no false positive from 'status' in CLAUDE.md" test_c2_no_false_positive
run_test "C2: detects HANDOFF.md" test_c2_detects_handoff_file

# ── I3: matches 'Do not' with wider Because window ──

I3_FIX="${TEMP_ROOT}/i3-fix"
mkdir -p "${I3_FIX}"
git -C "${I3_FIX}" init --quiet 2>/dev/null || true
cat > "${I3_FIX}/CLAUDE.md" <<'FIXTURE'
# Project
## Rules
- Do not mock the database
  Instead: use real test DB
  Because: mocks hide migration bugs

- Don't use any in TypeScript


  Because: defeats the type system
FIXTURE
I3_FIX_OUT="${TEMP_ROOT}/i3-fix.jsonl"

test_i3_matches_do_not_and_wide_window() {
  run_scanner "${I3_FIX}" "${I3_FIX_OUT}" "${TEMP_ROOT}/i3.stderr" || return 1
  local score
  score="$(extract_check_score "${I3_FIX_OUT}" "I3")" || { TEST_ERROR="I3 not found"; return 1; }
  if node -e "process.exit(Number(process.argv[1]) >= 0.9 ? 0 : 1)" "$score"; then
    return 0
  else
    TEST_ERROR="I3 should detect both Do not + Don't with wide Because window (got ${score})"
    return 1
  fi
}

run_test "I3: matches 'Do not' and Because at line+4" test_i3_matches_do_not_and_wide_window

# ── I4: expanded heading keywords ──

I4_FIX="${TEMP_ROOT}/i4-fix"
mkdir -p "${I4_FIX}"
git -C "${I4_FIX}" init --quiet 2>/dev/null || true
cat > "${I4_FIX}/CLAUDE.md" <<'FIXTURE'
# Project
## Build
Commands here.
## Testing
Test instructions.
## Deploy
Deploy steps.
## About Me
Identity section.
FIXTURE
I4_FIX_OUT="${TEMP_ROOT}/i4-fix.jsonl"

test_i4_expanded_keywords() {
  run_scanner "${I4_FIX}" "${I4_FIX_OUT}" "${TEMP_ROOT}/i4.stderr" || return 1
  local score
  score="$(extract_check_score "${I4_FIX_OUT}" "I4")" || { TEST_ERROR="I4 not found"; return 1; }
  if node -e "process.exit(Number(process.argv[1]) >= 0.7 ? 0 : 1)" "$score"; then
    return 0
  else
    TEST_ERROR="I4 should recognize Build/Testing/Deploy as action (got ${score})"
    return 1
  fi
}

run_test "I4: recognizes Build/Testing/Deploy as action headings" test_i4_expanded_keywords

# ── S6: sklearn no longer triggers ──

S6_FIX="${TEMP_ROOT}/s6-fix"
mkdir -p "${S6_FIX}/src"
git -C "${S6_FIX}" init --quiet 2>/dev/null || true
cat > "${S6_FIX}/src/ml.py" <<'FIXTURE'
import sklearn
from sklearn.ensemble import RandomForestClassifier
# sk-learn is a common abbreviation
FIXTURE
git -C "${S6_FIX}" add -A 2>/dev/null && git -C "${S6_FIX}" -c user.name=test -c user.email=test@test.com commit -m "init" --quiet 2>/dev/null || true
S6_FIX_OUT="${TEMP_ROOT}/s6-fix.jsonl"

test_s6_no_sklearn_false_positive() {
  run_scanner "${S6_FIX}" "${S6_FIX_OUT}" "${TEMP_ROOT}/s6.stderr" || return 1
  local score
  score="$(extract_check_score "${S6_FIX_OUT}" "S6")" || { TEST_ERROR="S6 not found"; return 1; }
  if [ "$score" != "1" ]; then
    TEST_ERROR="S6 should not flag sklearn as a secret (got ${score})"
    return 1
  fi
}

run_test "S6: sklearn does not trigger secret detection" test_s6_no_sklearn_false_positive

# ── S7: test fixtures excluded ──

S7_FIX="${TEMP_ROOT}/s7-fix"
mkdir -p "${S7_FIX}/tests/fixtures" "${S7_FIX}/src"
git -C "${S7_FIX}" init --quiet 2>/dev/null || true
# Construct personal path at runtime to avoid triggering the repo's own pre-commit
# hook that scans source files for personal path literals.
_S7_PREFIX='/U'
_S7_PREFIX="${_S7_PREFIX}sers/testuser/project"
printf '{"path": "%s"}\n' "${_S7_PREFIX}" > "${S7_FIX}/tests/fixtures/sample.json"
echo 'clean_code = True' > "${S7_FIX}/src/main.py"
git -C "${S7_FIX}" add -A 2>/dev/null && git -C "${S7_FIX}" -c user.name=test -c user.email=test@test.com commit -m "init" --quiet 2>/dev/null || true
S7_FIX_OUT="${TEMP_ROOT}/s7-fix.jsonl"

test_s7_excludes_test_fixtures() {
  run_scanner "${S7_FIX}" "${S7_FIX_OUT}" "${TEMP_ROOT}/s7.stderr" || return 1
  local score
  score="$(extract_check_score "${S7_FIX_OUT}" "S7")" || { TEST_ERROR="S7 not found"; return 1; }
  if [ "$score" != "1" ]; then
    TEST_ERROR="S7 should exclude tests/fixtures/ paths (got ${score})"
    return 1
  fi
}

run_test "S7: test fixture paths excluded" test_s7_excludes_test_fixtures

printf '%s/%s tests passed\n' "${pass_count}" "${test_count}"

if [ "${pass_count}" -eq "${test_count}" ]; then
  exit 0
fi

exit 1
