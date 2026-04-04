#!/usr/bin/env bash
# F003: Fixer safety test — runs full pipeline (scan→score→plan→fix) on real repos.
# Captures git diff for each repo, analyzes for unexpected modifications.
# Usage: bash tests/fixer-safety/run-fixer-safety.sh [--repos-file PATH]

set -u

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SCANNER="${ROOT_DIR}/src/scanner.sh"
SCORER="${ROOT_DIR}/src/scorer.js"
PLAN_GEN="${ROOT_DIR}/src/plan-generator.js"
FIXER="${ROOT_DIR}/src/fixer.js"
ARMORY_DIR="${HOME}/Armory/sources"
WORK_DIR="/tmp/al-validation/fixer-safety"
RESULTS_DIR="${ROOT_DIR}/tests/fixer-safety/results"

mkdir -p "${WORK_DIR}" "${RESULTS_DIR}"

# Collect repos: all Armory repos with CLAUDE.md
echo "=== Fixer Safety Test ==="
echo "Collecting repos with CLAUDE.md from Armory..."

repos=()
for d in "${ARMORY_DIR}"/*/; do
  [ -d "$d" ] || continue
  if [ -f "${d}/CLAUDE.md" ] || [ -f "${d}/AGENTS.md" ]; then
    repos+=("$d")
  fi
done
echo "Found ${#repos[@]} repos with entry files"
echo ""

pass=0
fail=0
total=0
red_flags=()

test_repo() {
  local src_dir="$1"
  local repo_name="$(basename "$src_dir")"
  local work_repo="${WORK_DIR}/${repo_name}"
  local diff_file="${RESULTS_DIR}/${repo_name}.diff"
  local diff_force_file="${RESULTS_DIR}/${repo_name}.force-f5.diff"
  total=$((total + 1))

  printf 'Testing: %-50s ' "$repo_name"

  # Copy repo to work dir
  rm -rf "$work_repo"
  cp -r "$src_dir" "$work_repo" 2>/dev/null || { echo "SKIP (copy failed)"; return; }

  # Ensure clean git state for diff tracking
  if [ -d "${work_repo}/.git" ]; then
    # Reset any symlink resolution artifacts from cp
    git -C "$work_repo" checkout -- . 2>/dev/null
    git -C "$work_repo" clean -fd 2>/dev/null
  else
    git -C "$work_repo" init -q 2>/dev/null
    GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@test GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@test \
      git -C "$work_repo" add -A 2>/dev/null
    GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@test GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@test \
      git -C "$work_repo" commit -q -m "init" 2>/dev/null
  fi

  # Run pipeline: scan → score → plan
  local scan_out plan_out
  scan_out="$(bash "$SCANNER" --project-dir "$work_repo" 2>/dev/null)"
  if [ -z "$scan_out" ]; then
    echo "SKIP (scanner empty)"
    return
  fi

  plan_out="$(echo "$scan_out" | node "$SCORER" 2>/dev/null | node "$PLAN_GEN" 2>/dev/null)"
  if [ -z "$plan_out" ]; then
    echo "SKIP (no plan)"
    return
  fi

  # Extract fixable items (auto + assisted)
  local items
  items="$(echo "$plan_out" | node -e "
    const chunks = [];
    process.stdin.on('data', d => chunks.push(d));
    process.stdin.on('end', () => {
      const data = JSON.parse(Buffer.concat(chunks).toString());
      const items = (data.items || data.plan || data || []);
      const fixable = items.filter(i => i.fix_type === 'auto' || i.fix_type === 'assisted');
      console.log(fixable.map(i => i.check_id || i.id).filter(Boolean).join(','));
    });
  " 2>/dev/null)"

  # Round 1: Normal pipeline — apply auto + assisted items
  local exit1=0
  if [ -n "$items" ]; then
    echo "$plan_out" | node "$FIXER" --project-dir "$work_repo" --items "$items" >/dev/null 2>&1 || exit1=$?
  fi

  # Capture diff
  git -C "$work_repo" diff > "$diff_file" 2>/dev/null
  local deleted_lines added_lines non_md_changed
  deleted_lines="$(grep -c '^-[^-]' "$diff_file" 2>/dev/null | tr -d '[:space:]' || echo 0)"
  added_lines="$(grep -c '^+[^+]' "$diff_file" 2>/dev/null | tr -d '[:space:]' || echo 0)"
  non_md_changed="$(grep '^diff --git' "$diff_file" 2>/dev/null | grep -cv '\.md$' | tr -d '[:space:]' || echo 0)"

  # Reset for Round 2
  git -C "$work_repo" checkout -- . 2>/dev/null

  # Round 2: Force apply F5 specifically
  local exit2=0
  if echo "$scan_out" | grep -q '"F5"'; then
    echo "$plan_out" | node "$FIXER" --project-dir "$work_repo" --items "F5" >/dev/null 2>&1 || exit2=$?
    git -C "$work_repo" diff > "$diff_force_file" 2>/dev/null
  else
    echo "" > "$diff_force_file"
  fi
  local f5_deleted
  f5_deleted="$(grep -c '^-[^-]' "$diff_force_file" 2>/dev/null | tr -d '[:space:]' || echo 0)"

  # Check RED FLAGS
  local flags=""
  if [ "$deleted_lines" -gt 10 ]; then flags="${flags}DEL>${deleted_lines} "; fi
  if [ "$non_md_changed" -gt 0 ]; then flags="${flags}NON-MD "; fi
  if [ "$exit1" -ne 0 ]; then flags="${flags}EXIT=${exit1} "; fi
  if [ "$f5_deleted" -gt 10 ]; then flags="${flags}F5-DEL>${f5_deleted} "; fi

  # Check for hardcoded paths in created files
  if grep -q '/Users/\|/home/' "$diff_file" 2>/dev/null; then
    flags="${flags}HARDCODED-PATH "
  fi

  if [ -n "$flags" ]; then
    fail=$((fail + 1))
    printf 'RED FLAG: %s  (items=%s del=%s add=%s)\n' "$flags" "$items" "$deleted_lines" "$added_lines"
    red_flags+=("${repo_name}: ${flags}")
  else
    pass=$((pass + 1))
    printf 'OK  (items=%s del=%s add=%s)\n' "${items:-none}" "$deleted_lines" "$added_lines"
  fi

  # Cleanup work copy
  rm -rf "$work_repo"
}

for repo in "${repos[@]}"; do
  test_repo "$repo"
done

# Summary
echo ""
echo "=== Summary ==="
echo "Total: ${total}  Pass: ${pass}  Red flags: ${fail}"
echo "Results dir: ${RESULTS_DIR}"

if [ "${#red_flags[@]}" -gt 0 ]; then
  echo ""
  echo "RED FLAGS:"
  printf '  %s\n' "${red_flags[@]}"
  exit 1
fi

exit 0
