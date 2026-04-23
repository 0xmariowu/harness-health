#!/usr/bin/env bash
# agentlint — Setup, check, and fix your repo for AI-native development.
#
# Usage:
#   agentlint setup --lang <ts|python|node> [options] <project-path>
#   agentlint check [--project-dir PATH]
#   agentlint fix   [--project-dir PATH]
#   agentlint help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  setup)
    shift
    exec "$SCRIPT_DIR/setup.sh" "$@"
    ;;
  check)
    shift
    exec bash "$SCRIPT_DIR/../src/scanner.sh" "$@" \
      | node "$SCRIPT_DIR/../src/scorer.js" \
      | node "$SCRIPT_DIR/../src/reporter.js"
    ;;
  fix)
    shift
    exec bash "$SCRIPT_DIR/../src/scanner.sh" "$@" \
      | node "$SCRIPT_DIR/../src/scorer.js" \
      | node "$SCRIPT_DIR/../src/plan-generator.js" \
      | node "$SCRIPT_DIR/../src/fixer.js"
    ;;
  help|--help|-h|"")
    cat <<'EOF'
agentlint — AI-native development toolkit

Commands:
  setup   Bootstrap a repo with AI-native CI/CD, hooks, and templates
          agentlint setup --lang <ts|python|node> [--visibility public|private] <path>

  check   Diagnose your repo's AI-friendliness (49 checks, 8 dimensions)
          agentlint check [--project-dir <path>]

  fix     Auto-fix issues found by check
          agentlint fix [--project-dir <path>]

  help    Show this help

Examples:
  agentlint setup --lang python ~/Projects/my-repo
  agentlint check --project-dir ~/Projects/my-repo
  agentlint fix   --project-dir ~/Projects/my-repo
EOF
    ;;
  *)
    echo "error: unknown command '$1'. Run 'agentlint help' for usage." >&2
    exit 1
    ;;
esac
