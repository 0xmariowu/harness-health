#!/usr/bin/env bash
# install.sh — AgentLint Claude Code plugin installer
set -uo pipefail

# ── colours ────────────────────────────────────────────────────────────────────
G=$'\033[32m'  # green
D=$'\033[2m'   # dim
Y=$'\033[33m'  # yellow
R=$'\033[0m'   # reset

ok()   { printf "  ${G}✓${R} %-28s %s\n" "$1" "$2"; }
skip() { printf "  ${D}o${R} %-28s ${D}%s${R}\n" "$1" "$2"; }
warn() { printf "  ${Y}!${R} %-28s %s\n" "$1" "$2"; }
info() { printf "    %s\n" "$1"; }

box() {
  local w=62
  local line; line=$(printf '%*s' "$w" '' | tr ' ' '-')
  printf '+%s+\n' "$line"
  while IFS= read -r l; do printf '| %-*s|\n' "$w" "$l"; done
  printf '+%s+\n' "$line"
}

# ── guard ──────────────────────────────────────────────────────────────────────
if ! command -v claude &>/dev/null; then
  warn "Claude Code" "[not found]"
  info "Install Claude Code first: https://claude.com/download"
  exit 1
fi

# ── Claude Code plugin ─────────────────────────────────────────────────────────
echo ""

# Marketplace
if claude plugin marketplace add 0xmariowu/agent-lint 2>&1 | grep -q "already on disk\|Successfully added"; then
  ok "AgentLint marketplace" "[registered]"
else
  claude plugin marketplace remove agent-lint 2>/dev/null || true
  claude plugin marketplace add 0xmariowu/agent-lint 2>/dev/null \
    && ok "AgentLint marketplace" "[refreshed]" \
    || warn "AgentLint marketplace" "[failed]"
fi

# Plugin install
INSTALL_OUT=$(claude plugin install agent-lint@agent-lint 2>&1)
INSTALLED_VER=$(ls -t "$HOME/.claude/plugins/cache/agent-lint/agent-lint/" 2>/dev/null | head -1)
if echo "$INSTALL_OUT" | grep -q "Successfully installed\|already installed"; then
  ok "Claude Code plugin" "[v${INSTALLED_VER:-?} installed]"
else
  warn "Claude Code plugin" "[install failed]"
fi

# /al global command
PLUGIN_CACHE="$HOME/.claude/plugins/cache/agent-lint/agent-lint"
LATEST=$(ls -t "$PLUGIN_CACHE" 2>/dev/null | head -1)
CMD_SRC="$PLUGIN_CACHE/$LATEST/commands/al.md"
CMD_DST="$HOME/.claude/commands/al.md"

if [ -f "$CMD_SRC" ]; then
  mkdir -p "$HOME/.claude/commands"
  cp "$CMD_SRC" "$CMD_DST"
  ok "/al command" "[installed]"
else
  skip "/al command" "[use /agent-lint:al instead]"
fi

# ── other AI tools ─────────────────────────────────────────────────────────────
echo ""
echo "Other AI tools detected:"
echo ""
command -v cursor   &>/dev/null && ok   "Cursor"    "[detected — .cursorrules supported]"    || skip "Cursor"    "[not found]"
command -v codex    &>/dev/null && ok   "Codex"     "[detected — AGENTS.md supported]"       || skip "Codex"     "[not found]"
command -v gemini   &>/dev/null && ok   "Gemini"    "[detected — GEMINI.md supported]"       || skip "Gemini"    "[not found]"
command -v windsurf &>/dev/null && ok   "Windsurf"  "[detected — .windsurfrules supported]"  || skip "Windsurf"  "[not found]"

# ── final box ──────────────────────────────────────────────────────────────────
echo ""
{
  echo "AgentLint is ready!"
  echo ""
  echo "In Claude Code, start a new session and run:"
  echo "  /al"
  echo ""
  echo "Or use the CLI directly:"
  echo "  agentlint check --project-dir <path>"
  echo "  agentlint fix W11"
  echo "  agentlint setup --lang ts <path>"
} | box
