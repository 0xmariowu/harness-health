#!/usr/bin/env bash

set -u

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCANNER="${ROOT_DIR}/src/scanner.sh"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/hh-scanner-test.XXXXXX")"
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
# Harness fixture

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

printf '%s/%s tests passed\n' "${pass_count}" "${test_count}"

if [ "${pass_count}" -eq "${test_count}" ]; then
  exit 0
fi

exit 1
