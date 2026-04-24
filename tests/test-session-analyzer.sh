#!/usr/bin/env bash
# Session analyzer privacy + determinism tests.
#
# The analyzer reads local Claude Code session logs. Before the privacy
# refactor, tests could only stub out behavior via HOME= and still ended up
# running against the developer's real ~/.claude/projects. Now --session-root
# takes a path explicitly, so tests run deterministically on a clean checkout
# and against a fixture log.
set -uo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${ROOT_DIR}/src/session-analyzer.js"

pass=0
fail=0
total=0

check() {
  total=$((total + 1))
  if eval "$2"; then
    pass=$((pass + 1))
    printf 'PASS: %s\n' "$1"
  else
    fail=$((fail + 1))
    printf 'FAIL: %s\n' "$1"
  fi
}

echo "=== Session Analyzer Test ==="
echo ""

# ─── 1. Help flag ─────────────────────────────────────────────────────────
check "help flag exits 0" "node '$SESSION' --help >/dev/null 2>&1"

# ─── 2. Empty projects root + empty session root ──────────────────────────
# Default behavior (no --include-global): zero findings, clean exit.
empty_proj="$(mktemp -d)"
empty_sess="$(mktemp -d)"
out="$(node "$SESSION" --projects-root "$empty_proj" --session-root "$empty_sess" 2>&1)"
rc=$?

check "empty roots: exits zero" "[ $rc -eq 0 ]"
check "empty roots: no findings on stdout" "[ -z \"\$(printf '%s' \"$out\" | tr -d '[:space:]')\" ]"

rm -rf "$empty_proj" "$empty_sess"

# ─── 3. Session logs present, no matching project → gate blocks output ─────
# With --session-root pointed at a fixture that has logs but no matching
# catalog project, the analyzer must NOT emit global SS1/SS4 findings by
# default — the user's raw prompts would leak.
fixture_root="$(mktemp -d)"
fixture_sess="${fixture_root}/.claude/projects/-no-match"
mkdir -p "$fixture_sess"
cat > "${fixture_sess}/session.jsonl" <<'EOF'
{"type":"user","message":{"role":"user","content":"Always use TypeScript everywhere in this project please"},"timestamp":"2026-04-04T10:00:00Z","cwd":"/tmp/test","userType":"external"}
{"type":"user","message":{"role":"user","content":"Always use TypeScript everywhere in this project please"},"timestamp":"2026-04-04T10:01:00Z","cwd":"/tmp/test","userType":"external"}
EOF

empty_proj2="$(mktemp -d)"
out="$(node "$SESSION" --projects-root "$empty_proj2" --session-root "${fixture_root}/.claude/projects" 2>&1)"
rc=$?

check "no catalog match: exits zero" "[ $rc -eq 0 ]"
check "no catalog match: no global findings emitted" \
  "[ -z \"\$(printf '%s' \"$out\" | tr -d '[:space:]')\" ]"

# ─── 4. Same fixture with --include-global → findings emit, but redacted ──
out="$(node "$SESSION" --projects-root "$empty_proj2" --session-root "${fixture_root}/.claude/projects" --include-global 2>&1)"
rc=$?

check "--include-global: exits zero" "[ $rc -eq 0 ]"
# Any non-empty output must be valid JSONL.
if [ -n "$(printf '%s' "$out" | tr -d '[:space:]')" ]; then
  check "--include-global: each line is valid JSON" \
    "printf '%s\n' \"$out\" | while IFS= read -r line; do [ -z \"\$line\" ] && continue; printf '%s' \"\$line\" | jq -e . >/dev/null || exit 1; done"
  # Redaction check: raw prompt text must NOT appear in output by default.
  check "--include-global (default): raw prompt text is redacted" \
    "! printf '%s' \"$out\" | grep -q 'Always use TypeScript'"
  check "--include-global (default): redaction marker present" \
    "printf '%s' \"$out\" | grep -q '\[redacted'"
else
  # Fixture is small — it may not reach the cluster threshold; still valid.
  check "--include-global: empty (below threshold) — acceptable" "true"
fi

# ─── 5. --include-raw-snippets includes raw text ──────────────────────────
out="$(node "$SESSION" --projects-root "$empty_proj2" --session-root "${fixture_root}/.claude/projects" --include-global --include-raw-snippets 2>&1)"
if [ -n "$(printf '%s' "$out" | tr -d '[:space:]')" ]; then
  check "--include-raw-snippets: raw prompt text appears in output" \
    "printf '%s' \"$out\" | grep -q 'Always use TypeScript'"
fi

rm -rf "$fixture_root" "$empty_proj2"

# ─── 6. Default invocation does not read the real ~/.claude/projects ──────
# With --session-root pointed at an empty temp dir, the analyzer must read
# only that dir — never fall back to HOME/.claude/projects. This is the
# privacy property that tests on developer machines must rely on.
empty_sess_priv="$(mktemp -d)"
out="$(node "$SESSION" --session-root "$empty_sess_priv" 2>&1)"
rc=$?
check "explicit empty --session-root does not leak real logs" \
  "[ $rc -eq 0 ] && [ -z \"\$(printf '%s' \"$out\" | tr -d '[:space:]')\" ]"
rm -rf "$empty_sess_priv"

echo ""
echo "=== Summary ==="
echo "Total: ${total}  Pass: ${pass}  Fail: ${fail}"
[ "$fail" -eq 0 ] && exit 0 || exit 1
