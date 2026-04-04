#!/usr/bin/env bash
set -euo pipefail
# F002: Install script validation.
# Can't test `claude plugin install` without Claude Code, but can verify:
# - Script syntax is valid bash
# - No macOS-only commands
# - Plugin structure is correct for manual install
set -euo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL="${ROOT_DIR}/scripts/install.sh"

pass=0; fail=0; total=0

check() {
  total=$((total + 1))
  if eval "$2" 2>/dev/null; then pass=$((pass + 1)); printf 'PASS: %s\n' "$1"
  else fail=$((fail + 1)); printf 'FAIL: %s\n' "$1"; fi
}

echo "=== Install Script Validation ==="
echo ""

# 1. Script exists and is valid bash
check "install.sh exists" "[ -f '$INSTALL' ]"
check "install.sh valid bash syntax" "bash -n '$INSTALL'"

# 2. No macOS-only commands (pbcopy, open, osascript, say, afplay, defaults)
check "no macOS-only commands" "! grep -qE 'pbcopy|pbpaste|osascript|afplay|defaults write' '$INSTALL'"

# 3. Plugin structure is valid
check ".claude-plugin/plugin.json exists" "[ -f '${ROOT_DIR}/.claude-plugin/plugin.json' ]"
check "plugin.json is valid JSON" "jq -e . '${ROOT_DIR}/.claude-plugin/plugin.json' >/dev/null"
check "commands/al.md exists" "[ -f '${ROOT_DIR}/commands/al.md' ]"
check "src/scanner.sh is executable or valid bash" "bash -n '${ROOT_DIR}/src/scanner.sh'"

# 4. Plugin.json has required fields
plugin_name="$(jq -r '.name' "${ROOT_DIR}/.claude-plugin/plugin.json" 2>/dev/null)"
check "plugin.json has name" "[ -n '${plugin_name}' ] && [ '${plugin_name}' != 'null' ]"

# 5. All src/*.sh and src/*.js are valid
for f in "${ROOT_DIR}"/src/*.sh; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  check "${name}: valid bash" "bash -n '$f'"
done
for f in "${ROOT_DIR}"/src/*.js; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  check "${name}: valid node syntax" "node --check '$f'"
done

# 6. Install script references correct plugin name
check "install.sh references agent-lint" "grep -q 'agent-lint' '$INSTALL'"

# 7. Install script has old /hh comment (bug: should say /al)
old_hh="$(grep -c '/hh' "$INSTALL" || echo 0)"
if [ "$old_hh" -gt 0 ]; then
  printf 'NOTE: install.sh still references /hh (should be /al)\n'
fi

echo ""
echo "=== Summary ==="
echo "Total: ${total}  Pass: ${pass}  Fail: ${fail}"
[ "$fail" -eq 0 ] && exit 0 || exit 1
