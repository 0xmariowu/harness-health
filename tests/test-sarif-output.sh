#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCANNER="${ROOT_DIR}/src/scanner.sh"
SCORER="${ROOT_DIR}/src/scorer.js"
PLAN_GENERATOR="${ROOT_DIR}/src/plan-generator.js"
REPORTER="${ROOT_DIR}/src/reporter.js"
WORKFLOW_COMMANDS="${ROOT_DIR}/scripts/emit-workflow-commands.js"

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/al-sarif-test.XXXXXX")"
PROJECT_DIR="${TEMP_ROOT}/fixture-repo"
OUTPUT_DIR="${TEMP_ROOT}/output"
SCAN_FILE="${TEMP_ROOT}/scan.jsonl"
SCORES_FILE="${TEMP_ROOT}/scores.json"
PLAN_FILE="${TEMP_ROOT}/plan.json"
WORKFLOW_OUTPUT="${TEMP_ROOT}/workflow-commands.txt"

pass_count=0
fail_count=0
test_count=0

pipeline_ready=0
pipeline_failed=0
PIPELINE_ERROR=""
SARIF_FILE=""

cleanup() {
  rm -rf "${TEMP_ROOT}"
}

trap cleanup EXIT

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
    fail_count=$((fail_count + 1))
    fail "$name" "${TEST_ERROR:-Unknown error}"
  fi
}

assert_jq() {
  local filter="$1"

  if ! jq -e "${filter}" "${SARIF_FILE}" >/dev/null; then
    TEST_ERROR="jq assertion failed: ${filter}"
    return 1
  fi
}

ensure_pipeline() {
  if [ "${pipeline_ready}" -eq 1 ]; then
    return 0
  fi

  if [ "${pipeline_failed}" -eq 1 ]; then
    TEST_ERROR="${PIPELINE_ERROR}"
    return 1
  fi

  mkdir -p "${PROJECT_DIR}/src" "${OUTPUT_DIR}"
  git -C "${PROJECT_DIR}" init --quiet 2>/dev/null || true

  cat > "${PROJECT_DIR}/CLAUDE.md" <<'EOF'
# Fixture Repo

This repo intentionally has AgentLint issues.

## Rules

- Check `./docs/runbook.md` before making changes.
- Keep changes small and reviewable.
EOF

  cat > "${PROJECT_DIR}/src/index.js" <<'EOF'
console.log('fixture');
EOF

  if ! bash "${SCANNER}" --project-dir "${PROJECT_DIR}" >"${SCAN_FILE}" 2>"${TEMP_ROOT}/scanner.stderr"; then
    PIPELINE_ERROR="scanner failed: $(cat "${TEMP_ROOT}/scanner.stderr")"
    pipeline_failed=1
    TEST_ERROR="${PIPELINE_ERROR}"
    return 1
  fi

  if ! node "${SCORER}" "${SCAN_FILE}" >"${SCORES_FILE}" 2>"${TEMP_ROOT}/scorer.stderr"; then
    PIPELINE_ERROR="scorer failed: $(cat "${TEMP_ROOT}/scorer.stderr")"
    pipeline_failed=1
    TEST_ERROR="${PIPELINE_ERROR}"
    return 1
  fi

  if ! node "${PLAN_GENERATOR}" "${SCORES_FILE}" >"${PLAN_FILE}" 2>"${TEMP_ROOT}/plan.stderr"; then
    PIPELINE_ERROR="plan-generator failed: $(cat "${TEMP_ROOT}/plan.stderr")"
    pipeline_failed=1
    TEST_ERROR="${PIPELINE_ERROR}"
    return 1
  fi

  if ! node "${REPORTER}" "${SCORES_FILE}" --plan "${PLAN_FILE}" --format sarif --output-dir "${OUTPUT_DIR}" >"${TEMP_ROOT}/reporter.stdout" 2>"${TEMP_ROOT}/reporter.stderr"; then
    PIPELINE_ERROR="reporter failed: $(cat "${TEMP_ROOT}/reporter.stderr")"
    pipeline_failed=1
    TEST_ERROR="${PIPELINE_ERROR}"
    return 1
  fi

  SARIF_FILE="$(find "${OUTPUT_DIR}" -maxdepth 1 -type f -name 'al-*.sarif' -print -quit)"
  if [ -z "${SARIF_FILE}" ]; then
    PIPELINE_ERROR="reporter did not create a SARIF file"
    pipeline_failed=1
    TEST_ERROR="${PIPELINE_ERROR}"
    return 1
  fi

  if ! node "${WORKFLOW_COMMANDS}" "${SCORES_FILE}" "${PLAN_FILE}" >"${WORKFLOW_OUTPUT}" 2>"${TEMP_ROOT}/workflow.stderr"; then
    PIPELINE_ERROR="emit-workflow-commands failed: $(cat "${TEMP_ROOT}/workflow.stderr")"
    pipeline_failed=1
    TEST_ERROR="${PIPELINE_ERROR}"
    return 1
  fi

  pipeline_ready=1
}

test_sarif_file_exists() {
  ensure_pipeline || return 1

  if [ ! -s "${SARIF_FILE}" ]; then
    TEST_ERROR="SARIF file missing or empty: ${SARIF_FILE}"
    return 1
  fi
}

test_sarif_is_valid_json() {
  ensure_pipeline || return 1

  if ! jq -e '.' "${SARIF_FILE}" >/dev/null; then
    TEST_ERROR="SARIF is not valid JSON"
    return 1
  fi
}

test_sarif_version() {
  ensure_pipeline || return 1
  assert_jq '.version == "2.1.0"'
}

test_sarif_driver_name() {
  ensure_pipeline || return 1
  assert_jq '.runs[0].tool.driver.name == "AgentLint"'
}

test_sarif_rules_count() {
  ensure_pipeline || return 1
  assert_jq '(.runs[0].tool.driver.rules | length) >= 30'
}

test_sarif_results_count() {
  ensure_pipeline || return 1
  assert_jq '(.runs[0].results | length) >= 1'
}

test_sarif_rule_id_prefixes() {
  ensure_pipeline || return 1
  assert_jq 'all(.runs[0].results[]; (.ruleId? // "" | test("^(SS|[FIWCSDH])")) )'
}

test_sarif_locations_are_real_paths() {
  ensure_pipeline || return 1
  assert_jq 'all(.runs[0].results[]; ((.locations[0].physicalLocation.artifactLocation.uri? // "") | length > 0 and (startswith(".agent-lint") | not)))'
}

test_sarif_levels_are_valid() {
  ensure_pipeline || return 1
  assert_jq 'all(.runs[0].results[]; (.level? == "error" or .level? == "warning" or .level? == "note"))'
}

test_workflow_commands_emit_annotations() {
  ensure_pipeline || return 1

  if ! grep -Eq '^::(error|warning) file=' "${WORKFLOW_OUTPUT}"; then
    TEST_ERROR="expected at least one workflow command annotation"
    return 1
  fi
}

run_test "SARIF file exists and is non-empty" test_sarif_file_exists
run_test "SARIF is valid JSON" test_sarif_is_valid_json
run_test "SARIF version is 2.1.0" test_sarif_version
run_test "SARIF driver name is AgentLint" test_sarif_driver_name
run_test "SARIF contains >= 30 rules" test_sarif_rules_count
run_test "SARIF contains >= 1 result" test_sarif_results_count
run_test "SARIF result ruleIds use valid prefixes" test_sarif_rule_id_prefixes
run_test "SARIF result locations use non-virtual artifact paths" test_sarif_locations_are_real_paths
run_test "SARIF result levels are valid" test_sarif_levels_are_valid
run_test "Workflow commands emit PR annotations" test_workflow_commands_emit_annotations

printf '%s/%s tests passed\n' "${pass_count}" "${test_count}"

if [ "${fail_count}" -eq 0 ]; then
  exit 0
fi
exit 1
