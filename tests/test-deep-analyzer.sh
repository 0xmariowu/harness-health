#!/usr/bin/env bash
# Deep analyzer tests. Default to the shipped fixture corpus so every
# contributor can run this on a clean checkout; set AL_CORPUS_DIR to point
# at a larger external corpus when you want broader coverage.
set -uo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DEEP="${ROOT_DIR}/src/deep-analyzer.js"
CORPUS="${AL_CORPUS_DIR:-${ROOT_DIR}/tests/fixtures/deep}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0; total=0

check() {
  total=$((total + 1))
  if eval "$2"; then
    pass=$((pass + 1)); printf 'PASS: %s\n' "$1"
  else
    fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"
  fi
}

echo "=== Deep Analyzer Test ==="
echo "Corpus: $CORPUS"
echo ""

# ─── 1. Fixture corpus: small / medium / large produce 3 D-tasks each ─────
for name in small medium large contradiction; do
  repo="${CORPUS}/${name}"
  [ -d "$repo" ] || continue
  [ -f "${repo}/CLAUDE.md" ] || continue

  out_file="${TMP}/${name}.json"
  node "$DEEP" --project-dir "$repo" > "$out_file" 2>/dev/null
  rc=$?

  check "${name}: exit code 0" "[ $rc -eq 0 ]"
  check "${name}: valid JSON output" "jq -e . '$out_file' >/dev/null 2>&1"

  task_count="$(jq '.tasks | length' "$out_file" 2>/dev/null | tr -d '[:space:]')"
  check "${name}: 3 tasks (D1, D2, D3)" "[ '${task_count:-0}' -eq 3 ]"

  for i in 0 1 2; do
    check_id="$(jq -r ".tasks[$i].check_id" "$out_file" 2>/dev/null)"
    prompt_len="$(jq -r ".tasks[$i].prompt | length" "$out_file" 2>/dev/null | tr -d '[:space:]')"
    check "${name}: ${check_id} prompt non-empty (${prompt_len} chars)" "[ '${prompt_len:-0}' -gt 100 ]"
  done

  # Prompt should embed actual CLAUDE.md content (check for a signature word)
  first_word="$(head -1 "${repo}/CLAUDE.md" | sed 's/^#* *//' | cut -d' ' -f1)"
  if [ -n "$first_word" ] && [ ${#first_word} -gt 2 ]; then
    check "${name}: prompt contains CLAUDE.md content" "jq -r '.tasks[0].prompt' '$out_file' | grep -q '$first_word'"
  fi
done

# ─── 2. no-entry fixture: 0 tasks, clean exit ─────────────────────────────
no_entry="${CORPUS}/no-entry"
if [ ! -d "$no_entry" ]; then
  no_entry="$(mktemp -d)"
  cleanup_no_entry=1
fi
node "$DEEP" --project-dir "$no_entry" > "${TMP}/no-entry.json" 2>/dev/null
task_count="$(jq '.tasks | length' "${TMP}/no-entry.json" 2>/dev/null | tr -d '[:space:]')"
check "no entry file: 0 tasks" "[ '${task_count:-0}' -eq 0 ]"
[ "${cleanup_no_entry:-0}" -eq 1 ] && rm -rf "$no_entry"

# ─── 3. --format-result emits scorer-compatible JSONL ────────────────────
# D1 input: contradiction findings → JSONL record with score < 1
cat > "${TMP}/d1-input.json" <<'EOF'
{"contradictions":[{"rule_a":"Always use TypeScript","rule_b":"Always use JavaScript","explanation":"direct conflict"}]}
EOF
node "$DEEP" --format-result --project fixture-proj --check D1 < "${TMP}/d1-input.json" > "${TMP}/d1-jsonl.txt" 2>/dev/null
check "--format-result D1: emits one JSONL line" "[ \"\$(wc -l < '${TMP}/d1-jsonl.txt' | tr -d '[:space:]')\" -eq 1 ]"
check "--format-result D1: line is valid JSON" "jq -e . '${TMP}/d1-jsonl.txt' >/dev/null"
check "--format-result D1: dimension is 'deep'" "[ \"\$(jq -r '.dimension' '${TMP}/d1-jsonl.txt')\" = 'deep' ]"
check "--format-result D1: check_id is 'D1'" "[ \"\$(jq -r '.check_id' '${TMP}/d1-jsonl.txt')\" = 'D1' ]"
check "--format-result D1: score < 1 (contradiction found)" "[ \"\$(jq -r '.score' '${TMP}/d1-jsonl.txt')\" != '1' ]"

# D1 clean input → score == 1
cat > "${TMP}/d1-clean.json" <<'EOF'
{"contradictions":[]}
EOF
node "$DEEP" --format-result --project fixture-proj --check D1 < "${TMP}/d1-clean.json" > "${TMP}/d1-clean.txt" 2>/dev/null
check "--format-result D1 clean: score == 1" "[ \"\$(jq -r '.score' '${TMP}/d1-clean.txt')\" = '1' ]"

# D2 vague_rules
cat > "${TMP}/d2-input.json" <<'EOF'
{"dead_weight":[{"rule":"Write correct code","explanation":"restates defaults"}]}
EOF
node "$DEEP" --format-result --project fixture-proj --check D2 < "${TMP}/d2-input.json" > "${TMP}/d2.txt" 2>/dev/null
check "--format-result D2: check_id is 'D2'" "[ \"\$(jq -r '.check_id' '${TMP}/d2.txt')\" = 'D2' ]"

# D3 vague
cat > "${TMP}/d3-input.json" <<'EOF'
{"vague_rules":[{"rule":"Use good judgment","explanation":"no decision boundary"}]}
EOF
node "$DEEP" --format-result --project fixture-proj --check D3 < "${TMP}/d3-input.json" > "${TMP}/d3.txt" 2>/dev/null
check "--format-result D3: check_id is 'D3'" "[ \"\$(jq -r '.check_id' '${TMP}/d3.txt')\" = 'D3' ]"

# Composite: feed scorer the three JSONL records and verify deep dim runs.
# Write scorer output to a file to avoid shell-quoting gymnastics in the
# assertion arguments.
cat "${TMP}/d1-jsonl.txt" "${TMP}/d2.txt" "${TMP}/d3.txt" > "${TMP}/deep-all.jsonl"
node "${ROOT_DIR}/src/scorer.js" "${TMP}/deep-all.jsonl" > "${TMP}/scored.json" 2>/dev/null
check "scorer accepts deep JSONL: deep.status == run" \
  "jq -e '.dimensions.deep.status == \"run\"' '${TMP}/scored.json' >/dev/null"
check "scorer accepts deep JSONL: score_scope == core+extended" \
  "jq -e '.score_scope == \"core+extended\"' '${TMP}/scored.json' >/dev/null"

echo ""
echo "=== Summary ==="
echo "Total: ${total}  Pass: ${pass}  Fail: ${fail}"
[ "$fail" -eq 0 ] && exit 0 || exit 1
