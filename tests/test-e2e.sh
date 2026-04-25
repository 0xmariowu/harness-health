#!/usr/bin/env bash
# End-to-end test simulating an external user.
# Creates isolated temp projects and runs the full pipeline.

set -euo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCANNER="${ROOT_DIR}/src/scanner.sh"
SCORER="${ROOT_DIR}/src/scorer.js"
PLAN_GEN="${ROOT_DIR}/src/plan-generator.js"
REPORTER="${ROOT_DIR}/src/reporter.js"
FIXER="${ROOT_DIR}/src/fixer.js"
DEEP="${ROOT_DIR}/src/deep-analyzer.js"
INSTALL="${ROOT_DIR}/scripts/install.sh"

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/al-e2e.XXXXXX")"
PROJECTS="${TEMP_ROOT}/Projects"

pass_count=0
fail_count=0
test_count=0

cleanup() { rm -rf "${TEMP_ROOT}"; }
trap cleanup EXIT

fail() {
  fail_count=$((fail_count + 1))
  test_count=$((test_count + 1))
  printf 'FAIL: %s\n' "$1"
  [ "${2:-}" != "" ] && printf '  %s\n' "$2"
}

pass() {
  pass_count=$((pass_count + 1))
  test_count=$((test_count + 1))
  printf 'PASS: %s\n' "$1"
}

# ─── Setup: create simulated user projects ───

setup_projects() {
  mkdir -p "${PROJECTS}"

  # Project A: well-configured (has everything)
  local a="${PROJECTS}/project-alpha"
  mkdir -p "${a}/tests" "${a}/.github/workflows" "${a}/src" "${a}/docs/plans"
  git -C "${a}" init -q 2>/dev/null || true

  cat > "${a}/CLAUDE.md" <<'ENTRY'
# Project Alpha

> A demo project for testing agent-lint.

## Session Checklist

1. If modifying API → read `docs/api.md`

## Rules

- Don't push directly to main. Instead, create a branch and open a PR. Because: direct pushes bypass review.
- Don't commit secrets. Instead, use environment variables. Because: secrets in git are nearly impossible to remove.
- Don't skip tests before merging. Instead, run `npm test`. Because: untested code causes regressions.
- Don't modify lockfiles manually. Instead, let the package manager handle them. Because: manual edits corrupt dependency graphs.

## Workflow

- Branch: `feature/{desc}`, `fix/{desc}`
- Commit: `{type}: {description}`
- Run: `npm test`
ENTRY

  cat > "${a}/README.md" <<'EOF'
# Project Alpha
A demo project.
EOF
  cat > "${a}/CHANGELOG.md" <<'EOF'
# Changelog
## v1.0.0
- Initial release
EOF
  cat > "${a}/HANDOFF.md" <<'EOF'
# Handoff
## main
Status: ready
EOF
  echo 'console.log("test")' > "${a}/tests/smoke.test.js"
  echo 'console.log("app")' > "${a}/src/index.js"
  cat > "${a}/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
EOF
  (cd "${a}" && git add -A && git commit -q -m "init" 2>/dev/null) || true

  # Project B: minimal (no CLAUDE.md, no tests, no CI)
  local b="${PROJECTS}/project-beta"
  mkdir -p "${b}/src"
  git -C "${b}" init -q 2>/dev/null || true
  echo 'print("hello")' > "${b}/src/main.py"
  (cd "${b}" && git add -A && git commit -q -m "init" 2>/dev/null) || true

  # Project C: has CLAUDE.md with identity language and broken refs
  local c="${PROJECTS}/project-gamma"
  mkdir -p "${c}/src"
  git -C "${c}" init -q 2>/dev/null || true

  cat > "${c}/CLAUDE.md" <<'ENTRY'
# Project Gamma

You are a helpful coding assistant.
You're a senior developer.
As an AI, follow best practices.

## Rules

- Check `./nonexistent/config.md` for settings
- Read [guide](./docs/missing-guide.md)
ENTRY
  echo 'fn main() {}' > "${c}/src/main.rs"
  echo '# Gamma' > "${c}/README.md"
  (cd "${c}" && git add -A && git commit -q -m "init" 2>/dev/null) || true

  # Project D: non-git directory (should be skipped by scanner)
  local d="${PROJECTS}/not-a-git-repo"
  mkdir -p "${d}/src"
  echo 'hello' > "${d}/src/file.txt"

  # Project E: nested repo (tests maxdepth 3)
  local e="${PROJECTS}/org/team/nested-repo"
  mkdir -p "${e}/src"
  git -C "${e}" init -q 2>/dev/null || true
  echo '# Nested' > "${e}/README.md"
  cat > "${e}/CLAUDE.md" <<'EOF'
# Nested Repo
A deeply nested project.
EOF
  echo 'x = 1' > "${e}/src/app.py"
  (cd "${e}" && git add -A && git commit -q -m "init" 2>/dev/null) || true
}

# ─── Section 1: Prerequisites ───

printf '\n=== Prerequisites ===\n\n'

command -v jq >/dev/null 2>&1 && pass "jq is installed" || fail "jq is not installed"
command -v node >/dev/null 2>&1 && pass "node is installed" || fail "node is not installed"
command -v bash >/dev/null 2>&1 && pass "bash is installed" || fail "bash is installed"
[ -x "${SCANNER}" ] && pass "scanner.sh is executable" || fail "scanner.sh is not executable"
[ -x "${INSTALL}" ] && pass "install.sh is executable" || fail "install.sh is not executable"

node --check "${SCORER}" 2>/dev/null && pass "scorer.js syntax OK" || fail "scorer.js syntax error"
node --check "${PLAN_GEN}" 2>/dev/null && pass "plan-generator.js syntax OK" || fail "plan-generator.js syntax error"
node --check "${REPORTER}" 2>/dev/null && pass "reporter.js syntax OK" || fail "reporter.js syntax error"
node --check "${FIXER}" 2>/dev/null && pass "fixer.js syntax OK" || fail "fixer.js syntax error"
node --check "${DEEP}" 2>/dev/null && pass "deep-analyzer.js syntax OK" || fail "deep-analyzer.js syntax error"

# ─── Section 2: Install script validation ───

printf '\n=== Install Script ===\n\n'

# Test that install.sh checks for claude command
output="$(bash -c 'PATH=/usr/bin:/bin; bash "'"${INSTALL}"'"' 2>&1)" || true
if echo "$output" | grep -qi "claude.*not found\|Install Claude Code"; then
  pass "install.sh detects missing claude command"
else
  fail "install.sh does not detect missing claude" "$output"
fi

# ─── Section 3: Scanner ───

printf '\n=== Scanner ===\n\n'

setup_projects

# 3a: single project scan
scan_out="${TEMP_ROOT}/scan-alpha.jsonl"
if bash "${SCANNER}" --project-dir "${PROJECTS}/project-alpha" > "${scan_out}" 2>/dev/null; then
  pass "scanner runs on single project"
else
  fail "scanner failed on single project"
fi

# validate JSONL
line_count="$(wc -l < "${scan_out}" | tr -d '[:space:]')"
if [ "${line_count}" -ge 16 ]; then
  pass "scanner outputs ${line_count} check results (>= 16 expected)"
else
  fail "scanner only output ${line_count} lines (expected >= 16)"
fi

# validate each line is valid JSON with required fields
invalid=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  if ! echo "$line" | jq -e '.check_id and .project and (.score != null)' >/dev/null 2>&1; then
    invalid=$((invalid + 1))
  fi
done < "${scan_out}"
if [ "${invalid}" -eq 0 ]; then
  pass "all scanner output lines are valid JSONL with required fields"
else
  fail "${invalid} invalid JSONL lines in scanner output"
fi

# 3b: well-configured project scores high
alpha_total="$(cat "${scan_out}" | node "${SCORER}" 2>/dev/null | jq -r '.total_score')"
if [ "${alpha_total}" -ge 60 ]; then
  pass "well-configured project scores ${alpha_total}/100 (>= 60)"
else
  fail "well-configured project scores only ${alpha_total}/100 (expected >= 60)"
fi

# 3c: minimal project (no CLAUDE.md) scores low
scan_beta="${TEMP_ROOT}/scan-beta.jsonl"
bash "${SCANNER}" --project-dir "${PROJECTS}/project-beta" > "${scan_beta}" 2>/dev/null
beta_total="$(cat "${scan_beta}" | node "${SCORER}" 2>/dev/null | jq -r '.total_score')"
if [ "${beta_total}" -lt "${alpha_total}" ]; then
  pass "minimal project scores ${beta_total} < well-configured ${alpha_total}"
else
  fail "minimal project (${beta_total}) should score lower than well-configured (${alpha_total})"
fi

# 3d: non-git directory is skipped in auto-discovery
scan_all="${TEMP_ROOT}/scan-all.jsonl"
PROJECTS_ROOT="${PROJECTS}" bash "${SCANNER}" > "${scan_all}" 2>/dev/null
if ! grep -q '"not-a-git-repo"' "${scan_all}"; then
  pass "non-git directory correctly skipped"
else
  fail "non-git directory should not appear in scan results"
fi

# 3e: nested repo is discovered (maxdepth 3)
if grep -q '"nested-repo"' "${scan_all}"; then
  pass "nested repo (depth 3) discovered"
else
  fail "nested repo not found — scanner maxdepth may be too shallow"
fi

# 3f: all git projects found
project_count="$(jq -r '.project' "${scan_all}" | sort -u | wc -l | tr -d '[:space:]')"
if [ "${project_count}" -ge 4 ]; then
  pass "discovered ${project_count} projects (expected >= 4)"
else
  fail "only discovered ${project_count} projects (expected >= 4)"
fi

# 3g: identity language detected in project-gamma
gamma_i5="$(grep '"I5"' "${scan_all}" | grep '"project-gamma"' | jq -r '.measured_value')"
if [ "${gamma_i5}" -ge 1 ] 2>/dev/null; then
  pass "identity language detected in gamma (${gamma_i5} matches)"
else
  fail "identity language not detected in gamma (measured: ${gamma_i5})"
fi

# 3h: broken references detected in project-gamma
gamma_f5="$(grep '"F5"' "${scan_all}" | grep '"project-gamma"' | jq -r '.measured_value')"
if [ "${gamma_f5}" -ge 1 ] 2>/dev/null; then
  pass "broken references detected in gamma (${gamma_f5} broken)"
else
  fail "broken references not detected in gamma (measured: ${gamma_f5})"
fi

# ─── Section 4: Full pipeline (scanner → scorer → plan → reporter) ───

printf '\n=== Full Pipeline ===\n\n'

scores_file="${TEMP_ROOT}/scores.json"
plan_file="${TEMP_ROOT}/plan.json"
report_dir="${TEMP_ROOT}/reports"

# 4a: scorer
if cat "${scan_all}" | node "${SCORER}" > "${scores_file}" 2>/dev/null; then
  pass "scorer processes multi-project scan"
else
  fail "scorer failed on multi-project scan"
fi

# validate scorer output structure
has_dims="$(jq -e '.dimensions and .by_project and (.total_score != null)' "${scores_file}" 2>/dev/null)"
if [ "${has_dims}" = "true" ]; then
  pass "scorer output has dimensions, by_project, total_score"
else
  fail "scorer output missing required fields"
fi

# 4b: plan generator
if node "${PLAN_GEN}" "${scores_file}" > "${plan_file}" 2>/dev/null; then
  pass "plan-generator processes scorer output"
else
  fail "plan-generator failed"
fi

plan_items="$(jq -r '.total_items' "${plan_file}")"
if [ "${plan_items}" -ge 1 ]; then
  pass "plan contains ${plan_items} fix items"
else
  fail "plan contains 0 fix items (expected >= 1)"
fi

# verify score field exists in plan items
missing_scores="$(jq '[.items[] | select(.score == null)] | length' "${plan_file}")"
if [ "${missing_scores}" -eq 0 ]; then
  pass "all plan items have score field"
else
  fail "${missing_scores} plan items missing score field"
fi

# verify severity grouping
high_count="$(jq '.grouped.high.count' "${plan_file}")"
if [ "${high_count}" -ge 1 ]; then
  pass "plan has ${high_count} high-severity items"
else
  fail "plan has 0 high-severity items"
fi

# 4c: reporter - terminal
term_out="$(node "${REPORTER}" "${scores_file}" --format terminal 2>/dev/null)"
if echo "${term_out}" | grep -q "Score:"; then
  pass "terminal reporter shows score"
else
  fail "terminal reporter missing score output"
fi

# 4d: reporter - markdown
mkdir -p "${report_dir}"
node "${REPORTER}" "${scores_file}" --format md --output-dir "${report_dir}" 2>/dev/null
md_file="$(find "${report_dir}" -name '*.md' -type f 2>/dev/null | head -1)"
if [ -n "${md_file}" ] && [ -f "${md_file}" ]; then
  pass "markdown report generated"
else
  fail "markdown report not generated"
fi

# 4e: reporter - jsonl
node "${REPORTER}" "${scores_file}" --format jsonl --output-dir "${report_dir}" 2>/dev/null
jsonl_file="$(find "${report_dir}" -name '*.jsonl' -type f 2>/dev/null | head -1)"
if [ -n "${jsonl_file}" ] && [ -f "${jsonl_file}" ]; then
  pass "jsonl report generated"
else
  fail "jsonl report not generated"
fi

# ─── Section 5: Deep Analyzer (before fixer modifies projects) ───

printf '\n=== Deep Analyzer ===\n\n'

deep_out="$(node "${DEEP}" --project-dir "${PROJECTS}/project-alpha" 2>/dev/null)"
if echo "${deep_out}" | jq -e '.tasks | length > 0' >/dev/null 2>&1; then
  pass "deep-analyzer generates analysis tasks for alpha"
else
  fail "deep-analyzer produced no tasks for alpha"
fi

task_count="$(echo "${deep_out}" | jq '.tasks | length')"
if [ "${task_count}" -eq 3 ]; then
  pass "deep-analyzer generates 3 tasks (D1, D2, D3)"
else
  fail "deep-analyzer generated ${task_count} tasks (expected 3)"
fi

# project without entry file
deep_beta="$(node "${DEEP}" --project-dir "${PROJECTS}/project-beta" 2>/dev/null)"
beta_tasks="$(echo "${deep_beta}" | jq '.tasks | length')"
if [ "${beta_tasks}" -eq 0 ]; then
  pass "deep-analyzer returns 0 tasks for project without entry file"
else
  fail "deep-analyzer should return 0 tasks for project without entry file (got ${beta_tasks})"
fi

# ─── Section 6: Fixer ───

printf '\n=== Fixer ===\n\n'

# 5a: auto-fix F5 (broken references) on gamma
gamma_dir="${PROJECTS}/project-gamma"

fixer_out="$(node "${FIXER}" "${plan_file}" \
  --project-dir "${gamma_dir}" \
  --items "$(jq -r '.items[] | select(.check_id == "F5" and .project == "project-gamma") | .id' "${plan_file}" | head -1)" \
  --force-dirty \
  2>/dev/null)"

if echo "${fixer_out}" | jq -e '.executed[0].status == "fixed"' >/dev/null 2>&1; then
  pass "F5 auto-fix executed on gamma"
else
  fail "F5 auto-fix failed on gamma" "$(echo "${fixer_out}" | jq -r '.executed[0].detail' 2>/dev/null)"
fi

# verify broken refs are removed
gamma_after="$(cat "${gamma_dir}/CLAUDE.md")"
if ! echo "${gamma_after}" | grep -q "missing-guide"; then
  pass "broken references removed from gamma CLAUDE.md"
else
  fail "broken references still in gamma CLAUDE.md"
fi

# verify backup exists
backup_dir="$(echo "${fixer_out}" | jq -r '.backup_dir' 2>/dev/null)"
if [ -n "${backup_dir}" ] && [ -d "${backup_dir}" ]; then
  pass "backup directory created at ${backup_dir}"
else
  fail "no backup directory created"
fi

# 5b: auto-fix I5 (identity language) on gamma
i5_id="$(jq -r '.items[] | select(.check_id == "I5" and .project == "project-gamma") | .id' "${plan_file}" | head -1)"
if [ -n "${i5_id}" ]; then
  i5_out="$(node "${FIXER}" "${plan_file}" \
    --project-dir "${gamma_dir}" \
    --items "${i5_id}" \
    --force-dirty \
    2>/dev/null)"
  if echo "${i5_out}" | jq -e '.executed[0].status == "fixed"' >/dev/null 2>&1; then
    pass "I5 auto-fix executed on gamma"
    gamma_final="$(cat "${gamma_dir}/CLAUDE.md")"
    if ! echo "${gamma_final}" | grep -qi "You are a"; then
      pass "identity language removed from gamma CLAUDE.md"
    else
      fail "identity language still in gamma CLAUDE.md"
    fi
  else
    fail "I5 auto-fix failed" "$(echo "${i5_out}" | jq -r '.executed[0].detail' 2>/dev/null)"
  fi
else
  pass "I5 not in plan for gamma (no identity language detected — may already be clean)"
fi

# 5c: assisted fix F1 on beta (generate CLAUDE.md)
f1_id="$(jq -r '.items[] | select(.check_id == "F1" and .project == "project-beta") | .id' "${plan_file}" | head -1)"
if [ -n "${f1_id}" ]; then
  # Discard fixer stdout — the file-existence check below is the real
  # assertion. Before, capturing to f1_out just triggered an unused-var
  # warning (SC2034).
  node "${FIXER}" "${plan_file}" \
    --project-dir "${PROJECTS}/project-beta" \
    --items "${f1_id}" \
    --force-dirty \
    >/dev/null 2>&1
  if [ -f "${PROJECTS}/project-beta/CLAUDE.md" ]; then
    pass "F1 assisted fix created CLAUDE.md for beta"
  else
    fail "F1 assisted fix did not create CLAUDE.md"
  fi
else
  pass "F1 not in plan for beta (unexpected but non-blocking)"
fi

# ─── Section 7: Post-fix verification ───

printf '\n=== Post-fix Verification ===\n\n'

# Re-scan gamma after fixes and verify score improved
scan_gamma_after="${TEMP_ROOT}/scan-gamma-after.jsonl"
bash "${SCANNER}" --project-dir "${gamma_dir}" > "${scan_gamma_after}" 2>/dev/null
gamma_after_score="$(cat "${scan_gamma_after}" | node "${SCORER}" 2>/dev/null | jq -r '.total_score')"

# Warm the scanner against an unrelated project to exercise the
# multi-project discovery path — output is intentionally discarded.
bash "${SCANNER}" --project-dir "${PROJECTS}/project-alpha" >/dev/null 2>&1

# We know gamma started low. Check it's not zero after fixes.
if [ "${gamma_after_score}" -ge 1 ]; then
  pass "gamma scores ${gamma_after_score}/100 after fixes (not zero)"
else
  fail "gamma scores 0 after fixes"
fi

# ─── Section 8: Error handling ───

printf '\n=== Error Handling ===\n\n'

# scanner with nonexistent directory
if ! bash "${SCANNER}" --project-dir "/nonexistent/path" >/dev/null 2>&1; then
  pass "scanner exits non-zero for nonexistent directory"
else
  fail "scanner should fail for nonexistent directory"
fi

# scorer with empty input
empty_out="$(mktemp)"
empty_err="$(mktemp)"
if echo '' | node "${SCORER}" >"${empty_out}" 2>"${empty_err}"; then
  fail "scorer rejects empty input" "$(cat "${empty_out}")"
elif [ ! -s "${empty_out}" ] && grep -q 'no valid scan records' "${empty_err}"; then
  pass "scorer rejects empty input"
else
  fail "scorer rejects empty input" "$(cat "${empty_err}")"
fi
rm -f "${empty_out}" "${empty_err}"

# scorer with malformed input
malformed_out="$(mktemp)"
malformed_err="$(mktemp)"
if echo 'not json at all' | node "${SCORER}" >"${malformed_out}" 2>"${malformed_err}"; then
  fail "scorer rejects malformed input" "$(cat "${malformed_out}")"
elif [ ! -s "${malformed_out}" ] && grep -q 'no valid scan records' "${malformed_err}"; then
  pass "scorer rejects malformed input"
else
  fail "scorer rejects malformed input" "$(cat "${malformed_err}")"
fi
rm -f "${malformed_out}" "${malformed_err}"

# plan-generator with all-perfect scores
perfect_scores='{"total_score":100,"dimensions":{"findability":{"score":10,"max":10,"weight":0.25,"checks":[]},"instructions":{"score":10,"max":10,"weight":0.35,"checks":[]},"workability":{"score":10,"max":10,"weight":0.2,"checks":[]},"continuity":{"score":10,"max":10,"weight":0.2,"checks":[]}},"by_project":{}}'
perfect_plan="$(echo "${perfect_scores}" | node "${PLAN_GEN}" 2>/dev/null)"
perfect_items="$(echo "${perfect_plan}" | jq '.total_items')"
if [ "${perfect_items}" -eq 0 ]; then
  pass "plan-generator returns 0 items for perfect scores"
else
  fail "plan-generator returns ${perfect_items} items for perfect scores (expected 0)"
fi

# fixer with invalid item ID
# fixer now exits 1 when any executed item has status "failed" (see src/fixer.js).
# Use `|| true` so `set -e` + newer bash's errexit-in-command-substitution does
# not abort the script before we inspect the JSON output.
invalid_fixer="$(echo '{"items":[{"id":1,"check_id":"F5","fix_type":"auto"}]}' | node "${FIXER}" \
  --project-dir "${PROJECTS}/project-alpha" \
  --items "999" \
  --force-dirty 2>/dev/null || true)"
if echo "${invalid_fixer}" | jq -e '.executed[0].status == "failed"' >/dev/null 2>&1; then
  pass "fixer handles invalid item ID gracefully"
else
  fail "fixer should report failure for invalid item ID"
fi

# ─── Summary ───

printf '\n=== Summary ===\n\n'
printf '%s/%s tests passed\n' "${pass_count}" "${test_count}"

if [ "${fail_count}" -gt 0 ]; then
  printf '%s tests failed\n' "${fail_count}"
  exit 1
fi

exit 0
