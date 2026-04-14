#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION_FILE="${ROOT_DIR}/action.yml"

test_count=0
pass_count=0

fail() {
  printf 'FAIL: %s\n' "$1"
  [ -n "${2:-}" ] && printf '  %s\n' "$2"
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
    fail "$name" "${TEST_ERROR:-}"
  fi
}

test_action_file_exists() {
  [ -f "${ACTION_FILE}" ] || { TEST_ERROR="action.yml not found"; return 1; }
}

test_action_yaml_valid() {
  local err_file="${TMPDIR:-/tmp}/al-yaml-err.$$"
  if ! python3 -c "import sys, yaml; yaml.safe_load(open('${ACTION_FILE}'))" 2>"${err_file}"; then
    TEST_ERROR="$(cat "${err_file}" 2>/dev/null || echo 'YAML parse failed')"
    rm -f "${err_file}"
    return 1
  fi
  rm -f "${err_file}"
}

test_action_references_existing_scripts() {
  # action.yml references these via ${{ github.action_path }}/src/*
  for script in "src/scanner.sh" "src/scorer.js" "src/plan-generator.js" "src/reporter.js"; do
    if ! grep -q "src/$(basename "$script")" "${ACTION_FILE}"; then
      TEST_ERROR="action.yml does not reference ${script}"
      return 1
    fi
    if [ ! -f "${ROOT_DIR}/${script}" ]; then
      TEST_ERROR="action.yml references ${script} which does not exist"
      return 1
    fi
  done
}

test_action_declares_outputs() {
  # Must declare score + all 6 dimensions
  for field in "score" "findability" "instructions" "workability" "continuity" "safety" "harness"; do
    if ! grep -qE "^\s+${field}:" "${ACTION_FILE}"; then
      TEST_ERROR="action.yml missing output: ${field}"
      return 1
    fi
  done
}

test_action_declares_inputs() {
  for field in "project-dir" "fail-below" "format" "output-dir"; do
    if ! grep -qE "^\s+${field}:" "${ACTION_FILE}"; then
      TEST_ERROR="action.yml missing input: ${field}"
      return 1
    fi
  done
}

test_composite_type() {
  if ! grep -qE "^\s+using:\s*['\"]?composite['\"]?" "${ACTION_FILE}"; then
    TEST_ERROR="action.yml is not a composite action"
    return 1
  fi
}

run_test "action.yml exists" test_action_file_exists
run_test "action.yml is valid YAML" test_action_yaml_valid
run_test "action.yml references existing scripts" test_action_references_existing_scripts
run_test "action.yml declares all expected outputs" test_action_declares_outputs
run_test "action.yml declares all expected inputs" test_action_declares_inputs
run_test "action.yml is a composite action" test_composite_type

printf '%s/%s tests passed\n' "${pass_count}" "${test_count}"

if [ "${pass_count}" -eq "${test_count}" ]; then
  exit 0
fi
exit 1
