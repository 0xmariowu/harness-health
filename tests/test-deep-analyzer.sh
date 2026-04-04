#!/usr/bin/env bash
# F004: Deep analyzer prompt generation test.
set -u

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DEEP="${ROOT_DIR}/src/deep-analyzer.js"
CORPUS="${HOME}/corpus/corpus/claude-repo/repos"
TMP="$(mktemp -d)"

pass=0; fail=0; total=0

check() {
  total=$((total + 1))
  if eval "$2" 2>/dev/null; then pass=$((pass + 1)); printf 'PASS: %s\n' "$1"
  else fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; fi
}

# Select 3 CLAUDE.md files of different sizes
small="" medium="" large=""
for repo in "${CORPUS}"/*/; do
  [ -f "${repo}/CLAUDE.md" ] || continue
  size="$(wc -c < "${repo}/CLAUDE.md" | tr -d '[:space:]')"
  if [ -z "$small" ] && [ "$size" -lt 1000 ]; then small="${repo}"; fi
  if [ -z "$medium" ] && [ "$size" -ge 1000 ] && [ "$size" -lt 5000 ]; then medium="${repo}"; fi
  if [ -z "$large" ] && [ "$size" -ge 10000 ]; then large="${repo}"; fi
  [ -n "$small" ] && [ -n "$medium" ] && [ -n "$large" ] && break
done

echo "=== Deep Analyzer Test ==="
echo "Small:  $(basename "${small:-none}")"
echo "Medium: $(basename "${medium:-none}")"
echo "Large:  $(basename "${large:-none}")"
echo ""

for repo_dir in "$small" "$medium" "$large"; do
  [ -z "$repo_dir" ] && continue
  name="$(basename "$repo_dir")"
  out_file="${TMP}/${name}.json"
  printf '--- %s ---\n' "$name"

  node "$DEEP" --project-dir "$repo_dir" > "$out_file" 2>/dev/null
  check "${name}: exit code 0" "node '$DEEP' --project-dir '$repo_dir' >/dev/null 2>&1"
  check "${name}: valid JSON output" "jq -e . '$out_file' >/dev/null 2>&1"

  task_count="$(jq '.tasks | length' "$out_file" 2>/dev/null | tr -d '[:space:]')"
  check "${name}: 3 tasks (D1, D2, D3)" "[ '${task_count:-0}' -eq 3 ]"

  for i in 0 1 2; do
    check_id="$(jq -r ".tasks[$i].check_id" "$out_file" 2>/dev/null)"
    prompt_len="$(jq -r ".tasks[$i].prompt | length" "$out_file" 2>/dev/null | tr -d '[:space:]')"
    check "${name}: ${check_id} prompt non-empty (${prompt_len} chars)" "[ '${prompt_len:-0}' -gt 100 ]"
  done

  # Prompt should contain actual file content (check first heading)
  first_word="$(head -1 "${repo_dir}/CLAUDE.md" | sed 's/^#* *//' | cut -d' ' -f1)"
  if [ -n "$first_word" ] && [ ${#first_word} -gt 2 ]; then
    check "${name}: prompt contains CLAUDE.md content" "jq -r '.tasks[0].prompt' '$out_file' | grep -q '$first_word'"
  fi
  echo ""
done

# No entry file → 0 tasks
no_entry="$(mktemp -d)"
node "$DEEP" --project-dir "$no_entry" > "${TMP}/no-entry.json" 2>/dev/null
task_count="$(jq '.tasks | length' "${TMP}/no-entry.json" 2>/dev/null | tr -d '[:space:]')"
check "no entry file: 0 tasks" "[ '${task_count:-0}' -eq 0 ]"
rm -rf "$no_entry"

rm -rf "$TMP"
echo ""
echo "=== Summary ==="
echo "Total: ${total}  Pass: ${pass}  Fail: ${fail}"
[ "$fail" -eq 0 ] && exit 0 || exit 1
