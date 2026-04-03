#!/bin/bash
set -e

echo "Installing Harness Health for Claude Code..."

if ! command -v claude &>/dev/null; then
    echo "Error: claude command not found. Install Claude Code first:"
    echo "  https://claude.com/download"
    exit 1
fi

claude plugin marketplace add 0xmariowu/harness-health
claude plugin install harness-health@harness-health

# Install /hh global command
PLUGIN_CACHE="$HOME/.claude/plugins/cache/harness-health/harness-health"
LATEST=$(ls -t "$PLUGIN_CACHE" 2>/dev/null | head -1)
CMD_SRC="$PLUGIN_CACHE/$LATEST/commands/hh.md"
CMD_DST="$HOME/.claude/commands/hh.md"

if [ -f "$CMD_SRC" ]; then
    mkdir -p "$HOME/.claude/commands"
    cp "$CMD_SRC" "$CMD_DST"
    echo "Installed /hh command"
else
    echo "Warning: could not find command template, use /harness-health:hh instead"
fi

echo ""
echo "Harness Health installed! Start a new Claude Code session and run:"
echo "  /hh"
