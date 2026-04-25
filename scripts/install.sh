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
PLUGIN_INSTALL_OK=true

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
    || { warn "AgentLint marketplace" "[failed]"; PLUGIN_INSTALL_OK=false; }
fi

# Plugin install
INSTALL_OUT=$(claude plugin install agent-lint@agent-lint 2>&1)
INSTALLED_VER=$(ls -t "$HOME/.claude/plugins/cache/agent-lint/agent-lint/" 2>/dev/null | head -1)
if echo "$INSTALL_OUT" | grep -q "Successfully installed\|already installed"; then
  ok "Claude Code plugin" "[v${INSTALLED_VER:-?} installed]"
else
  warn "Claude Code plugin" "[install failed]"
  info "$INSTALL_OUT"
  PLUGIN_INSTALL_OK=false
fi

# /al global command
PLUGIN_CACHE="$HOME/.claude/plugins/cache/agent-lint/agent-lint"
LATEST=$(ls -t "$PLUGIN_CACHE" 2>/dev/null | head -1)
CMD_SRC="$PLUGIN_CACHE/$LATEST/commands/al.md"
CMD_DST="$HOME/.claude/commands/al.md"

if [ -f "$CMD_SRC" ]; then
  MKDIR_OUT=""
  COPY_OUT=""
  if ! MKDIR_OUT=$(mkdir -p "$HOME/.claude/commands" 2>&1); then
    warn "/al command" "[not installed]"
    info "Could not create $HOME/.claude/commands"
    [ -n "$MKDIR_OUT" ] && info "$MKDIR_OUT"
    PLUGIN_INSTALL_OK=false
  elif ! COPY_OUT=$(cp "$CMD_SRC" "$CMD_DST" 2>&1); then
    warn "/al command" "[not installed]"
    info "Could not copy $CMD_SRC to $CMD_DST"
    [ -n "$COPY_OUT" ] && info "$COPY_OUT"
    PLUGIN_INSTALL_OK=false
  else
    ok "/al command" "[installed]"
  fi
else
  warn "/al command" "[not installed]"
  info "npm CLI works, but /al will not be available until the Claude plugin install succeeds."
  PLUGIN_INSTALL_OK=false
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
  if [ "$PLUGIN_INSTALL_OK" = true ]; then
    echo "AgentLint is ready!"
  else
    echo "AgentLint CLI is installed."
    echo "Claude plugin install failed."
    echo "The npm CLI works, but /al will not be available yet."
  fi
  echo ""
  if [ "$PLUGIN_INSTALL_OK" = true ]; then
    echo "In Claude Code, start a new session and run:"
    echo "  /al"
    echo ""
  fi
  echo "Or use the CLI directly:"
  echo "  agentlint check --project-dir <path>"
  echo "  agentlint fix W11"
  echo "  agentlint setup --lang ts <path>"
} | box
