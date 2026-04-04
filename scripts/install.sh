#!/bin/bash
set -e

echo "Installing AgentLint for Claude Code..."

if ! command -v claude &>/dev/null; then
    echo "Error: claude command not found. Install Claude Code first:"
    echo "  https://claude.com/download"
    exit 1
fi

claude plugin marketplace add 0xmariowu/agent-lint
claude plugin install agent-lint@agent-lint

# Install /hh global command
PLUGIN_CACHE="$HOME/.claude/plugins/cache/agent-lint/agent-lint"
LATEST=$(ls -t "$PLUGIN_CACHE" 2>/dev/null | head -1)
CMD_SRC="$PLUGIN_CACHE/$LATEST/commands/al.md"
CMD_DST="$HOME/.claude/commands/al.md"

if [ -f "$CMD_SRC" ]; then
    mkdir -p "$HOME/.claude/commands"
    cp "$CMD_SRC" "$CMD_DST"
    echo "Installed /hh command"
else
    echo "Warning: could not find command template, use /agent-lint:hh instead"
fi

echo ""
echo "AgentLint installed! Start a new Claude Code session and run:"
echo "  /al"
