#!/usr/bin/env bash
# Verify that every local action a generated workflow references is also
# generated. Regression guard for v1.1.9: hygiene.yml's
# `uses: ./.github/actions/ensure-base-commit` shipped without the action.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/al-workflow-actions.XXXXXX")"
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

# Extract every `uses: ./<path>` reference from generated workflow files.
# Matches both step forms — `  uses: ./path` (separate-line) and
# `  - uses: ./path` (inline list-item). Strips `./` and any trailing
# `@ref`. The trailing `|| true` keeps the pipeline tolerant of
# `set -o pipefail` when grep finds no matches at all (a workflows
# directory with zero local-action references is a valid empty result).
list_local_action_paths() {
  local workflows_dir="$1"
  if [[ ! -d "$workflows_dir" ]]; then
    return 0
  fi
  { grep -rhE '^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*\./[^[:space:]]+' "$workflows_dir" 2>/dev/null || true; } \
    | sed -E 's|^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*\./([^[:space:]@]+).*|\2|' \
    | sort -u
}

test_setup_emits_referenced_local_actions() {
  local repo="$TMP_ROOT/setup-workflows-only"
  mkdir -p "$repo"

  if ! bash "$ROOT_DIR/scripts/setup.sh" --lang ts --project-dir "$repo" \
        --workflows-only --no-install --init-git \
        >"$TMP_ROOT/setup.log" 2>&1; then
    TEST_ERROR="setup --workflows-only --init-git failed; see $TMP_ROOT/setup.log"
    return 1
  fi

  local workflows_dir="$repo/.github/workflows"
  if [[ ! -d "$workflows_dir" ]]; then
    TEST_ERROR="setup did not create $workflows_dir"
    return 1
  fi

  local missing=()
  while IFS= read -r action_path; do
    [[ -z "$action_path" ]] && continue
    local target="$repo/$action_path"
    if [[ -d "$target" ]]; then
      if [[ ! -f "$target/action.yml" && ! -f "$target/action.yaml" ]]; then
        missing+=("$action_path (directory exists but no action.yml)")
      fi
    elif [[ ! -f "$target" ]]; then
      missing+=("$action_path")
    fi
  done < <(list_local_action_paths "$workflows_dir")

  if (( ${#missing[@]} > 0 )); then
    TEST_ERROR=$'workflows reference local actions that were not generated:\n  '"$(printf '%s\n  ' "${missing[@]}")"
    return 1
  fi
}

test_setup_actually_emits_ensure_base_commit() {
  # Tighter assertion: the v1.1.9 P0 was specifically the missing
  # ensure-base-commit composite. Lock that exact path in so a future
  # refactor cannot silently regress it.
  local repo="$TMP_ROOT/ensure-base-commit"
  mkdir -p "$repo"

  if ! bash "$ROOT_DIR/scripts/setup.sh" --lang ts --project-dir "$repo" \
        --workflows-only --no-install --init-git \
        >"$TMP_ROOT/ensure.log" 2>&1; then
    TEST_ERROR="setup --workflows-only --init-git failed; see $TMP_ROOT/ensure.log"
    return 1
  fi

  if ! grep -qE '^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*\./\.github/actions/ensure-base-commit([[:space:]]|$)' \
        "$repo/.github/workflows/hygiene.yml"; then
    TEST_ERROR="hygiene.yml does not reference ./.github/actions/ensure-base-commit (template drift)"
    return 1
  fi

  if [[ ! -f "$repo/.github/actions/ensure-base-commit/action.yml" ]]; then
    TEST_ERROR="setup did not generate .github/actions/ensure-base-commit/action.yml"
    return 1
  fi

  # The template is a duplicate of the in-tree authoritative copy. Lock them
  # together so a future edit to one cannot silently drift from the other —
  # downstream repos would otherwise inherit a stale ensure-base-commit.
  if ! diff -q "$repo/.github/actions/ensure-base-commit/action.yml" \
                "$ROOT_DIR/.github/actions/ensure-base-commit/action.yml" >/dev/null 2>&1; then
    TEST_ERROR="generated ensure-base-commit/action.yml drifted from $ROOT_DIR/.github/actions/ensure-base-commit/action.yml — re-sync templates/workflows/actions/ensure-base-commit/action.yml"
    return 1
  fi
}

# Lock security-critical content into specific generated workflows so a
# future drift (in-tree workflow updated, template forgotten) cannot ship
# a stripped-down version to end users — same regression class as v1.1.9.
# Each entry: <generated workflow> | <must-contain marker> | <must-NOT-contain marker, optional>
# Markers are extended-regex patterns evaluated by `grep -qE`.
test_setup_locks_security_critical_workflow_content() {
  local repo="$TMP_ROOT/content-locks"
  mkdir -p "$repo"

  if ! bash "$ROOT_DIR/scripts/setup.sh" --lang ts --project-dir "$repo" \
        --workflows-only --no-install --init-git \
        >"$TMP_ROOT/content.log" 2>&1; then
    TEST_ERROR="setup --workflows-only --init-git failed; see $TMP_ROOT/content.log"
    return 1
  fi

  local failures=()
  check_must_contain() {
    local path="$1" pattern="$2" reason="$3"
    if [[ ! -f "$path" ]]; then
      failures+=("$path missing — $reason")
      return
    fi
    if ! grep -qE "$pattern" "$path"; then
      failures+=("$path is missing required marker /$pattern/ — $reason")
    fi
  }
  check_must_not_contain() {
    local path="$1" pattern="$2" reason="$3"
    if [[ ! -f "$path" ]]; then
      return
    fi
    if grep -qE "$pattern" "$path"; then
      failures+=("$path still contains forbidden marker /$pattern/ — $reason")
    fi
  }

  # release.yml: P0-2-tag gates from v1.1.8 must be in every generated repo.
  check_must_contain "$repo/.github/workflows/release.yml" \
    'merge-base --is-ancestor' \
    "release.yml must enforce ancestor-of-main gate (v1.1.8 P0-2-tag)"
  check_must_contain "$repo/.github/workflows/release.yml" \
    'check-runs' \
    "release.yml must enforce required-checks-API gate (v1.1.8 P0-2-tag)"
  check_must_contain "$repo/.github/workflows/release.yml" \
    'AGENTLINT_RELEASE_GATE_OPT_OUT' \
    "release.yml must default fail-closed with explicit opt-out env var (v1.1.12 F002)"
  check_must_contain "$repo/.github/workflows/release.yml" \
    'Refusing to publish without a check-runs gate' \
    "release.yml must fail closed when required check-runs gate is absent (v1.1.12 F002)"
  check_must_not_contain "$repo/.github/workflows/release.yml" \
    'Skipping check-runs gate' \
    "release.yml must not keep the old fail-open check-runs warning (v1.1.12 F002)"
  check_must_contain "$repo/.github/branch-protection.yml" \
    'required_status_checks' \
    "branch-protection.yml must include required_status_checks wiring (F002 S3)"

  # hygiene.yml must use the PR base SHA composite action AND must not
  # use the `origin/main..HEAD` author-check that ate git log failures
  # silently (F003 S1 fail-closed hygiene).
  check_must_contain "$repo/.github/workflows/hygiene.yml" \
    'github\.event\.pull_request\.base\.sha' \
    "hygiene.yml must reference PR base SHA explicitly"
  check_must_not_contain "$repo/.github/workflows/hygiene.yml" \
    'origin/main\.\.HEAD' \
    "hygiene.yml must not use origin/main..HEAD (fail-open author check)"
  check_must_contain "$repo/.github/workflows/hygiene.yml" \
    'set -euo pipefail' \
    "hygiene.yml author checks must run under set -euo pipefail (fail-closed)"

  if (( ${#failures[@]} > 0 )); then
    TEST_ERROR=$'security-critical template content drifted:\n  '"$(printf '%s\n  ' "${failures[@]}")"
    return 1
  fi
}

run_test "every 'uses: ./<path>' in generated workflows resolves to a generated action" \
  test_setup_emits_referenced_local_actions
run_test "ensure-base-commit composite action is emitted alongside hygiene.yml" \
  test_setup_actually_emits_ensure_base_commit
run_test "security-critical template content stays locked (release gates, hygiene base SHA)" \
  test_setup_locks_security_critical_workflow_content

echo "Summary: total=$TEST_COUNT passed=$PASS_COUNT failed=$FAIL_COUNT"
[[ "$FAIL_COUNT" -eq 0 ]]
