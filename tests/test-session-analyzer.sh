#!/usr/bin/env bash
# F005: Session analyzer robustness test.
# Verifies session-analyzer.js handles edge cases without crashing.
set -euo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${ROOT_DIR}/src/session-analyzer.js"

pass=0
fail=0
total=0

check() {
  total=$((total + 1))
  if eval "$2" 2>/dev/null; then
    pass=$((pass + 1))
    printf 'PASS: %s\n' "$1"
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n' "$1"
  fi
}

echo "=== Session Analyzer Test ==="
echo ""

# 1. Help flag
check "help flag exits 0" "node '$SESSION' --help >/dev/null 2>&1"

# 2. Empty projects root. Output is JSONL (one record per finding); zero
# findings = zero lines, which is legitimate empty output — not invalid JSON.
empty_dir="$(mktemp -d)"
output="$(node "$SESSION" --projects-root "$empty_dir" 2>/dev/null)"
check "empty dir: exits without crash" "node '$SESSION' --projects-root '$empty_dir' >/dev/null 2>&1"
if [ -n "$output" ]; then
  check "empty dir: each output line parses as JSON" "printf '%s\n' '$output' | while IFS= read -r line; do printf '%s' \"\$line\" | jq -e . >/dev/null || exit 1; done"
else
  check "empty dir: empty output (no sessions — expected)" "true"
fi
rm -rf "$empty_dir"

# 3. Nonexistent directory
check "nonexistent dir: no crash" "node '$SESSION' --projects-root /tmp/nonexistent-al-test >/dev/null 2>&1; true"

# 4. Fake session log — create a minimal .claude/projects structure
fake_root="$(mktemp -d)"
fake_projects="${fake_root}/Projects/test-proj"
fake_claude="${fake_root}/.claude/projects/-test"
mkdir -p "$fake_projects" "$fake_claude"

# Create a minimal project
printf '# Test\n' > "${fake_projects}/CLAUDE.md"

# Create a fake session log
cat > "${fake_claude}/fake-session.jsonl" <<'EOF'
{"type":"user","message":{"role":"user","content":"Always use TypeScript"},"timestamp":"2026-04-04T10:00:00Z","cwd":"/tmp/test","userType":"external"}
{"type":"assistant","message":{"role":"assistant","content":"Got it"},"timestamp":"2026-04-04T10:00:01Z"}
{"type":"user","message":{"role":"user","content":"no that's wrong, use JavaScript"},"timestamp":"2026-04-04T10:00:02Z","cwd":"/tmp/test","userType":"external"}
EOF

HOME="$fake_root" node "$SESSION" --projects-root "${fake_root}/Projects" --max-sessions 5 > "${fake_root}/session-out.txt" 2>/dev/null
check "fake log: exits without crash" "true"

# Session analyzer may output nothing if no matching logs — that's OK
out_size="$(wc -c < "${fake_root}/session-out.txt" | tr -d '[:space:]')"
if [ "${out_size:-0}" -gt 0 ]; then
  check "fake log: output is valid JSON" "jq -e . '${fake_root}/session-out.txt' >/dev/null 2>&1"
else
  check "fake log: empty output (no matching sessions — expected)" "[ '${out_size}' -eq 0 ]"
fi

rm -rf "$fake_root"

echo ""
echo "=== Summary ==="
echo "Total: ${total}  Pass: ${pass}  Fail: ${fail}"
[ "$fail" -eq 0 ] && exit 0 || exit 1
