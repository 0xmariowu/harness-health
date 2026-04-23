#!/usr/bin/env bash
# agentlint — Setup, check, and fix your repo for AI-native development.
#
# Usage:
#   agentlint setup --lang <ts|python|node> [options] <project-path>
#   agentlint check [--project-dir PATH]
#   agentlint fix   [--project-dir PATH]
#   agentlint fix <CHECK_ID> [--project-dir PATH]
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
    # Separate check IDs (e.g. W11, S1) from path flags (e.g. --project-dir)
    check_ids=""
    path_args=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --project-dir|--project-dir=*)
          path_args+=("$1")
          if [[ "$1" == "--project-dir" ]]; then
            shift
            path_args+=("$1")
          fi
          ;;
        --*)
          path_args+=("$1")
          ;;
        *)
          # Looks like a check ID (case-insensitive: w11, W11, S3, s3 all accepted)
          upper="${1^^}"
          if [[ "$upper" =~ ^[A-Z][A-Z0-9-]+$ ]]; then
            if [[ -n "$check_ids" ]]; then
              check_ids="${check_ids},$upper"
            else
              check_ids="$upper"
            fi
          else
            path_args+=("$1")
          fi
          ;;
      esac
      shift
    done

    if [[ -n "$check_ids" ]]; then
      exec bash "$SCRIPT_DIR/../src/scanner.sh" "${path_args[@]}" \
        | node "$SCRIPT_DIR/../src/scorer.js" \
        | node "$SCRIPT_DIR/../src/plan-generator.js" \
        | node "$SCRIPT_DIR/../src/fixer.js" --checks "$check_ids" "${path_args[@]}"
    else
      exec bash "$SCRIPT_DIR/../src/scanner.sh" "${path_args[@]}" \
        | node "$SCRIPT_DIR/../src/scorer.js" \
        | node "$SCRIPT_DIR/../src/plan-generator.js" \
        | node "$SCRIPT_DIR/../src/fixer.js" "${path_args[@]}"
    fi
    ;;
  help|--help|-h|"")
    cat <<'EOF'
agentlint — AI-native development toolkit

Commands:
  setup   Bootstrap a repo with AI-native CI/CD, hooks, and templates
          agentlint setup --lang <ts|python|node> [--visibility public|private] <path>

  check   Diagnose your repo's AI-friendliness (58 checks, 8 dimensions)
          agentlint check [--project-dir <path>]

  fix     Auto-fix issues found by check
          agentlint fix [--project-dir <path>]
          agentlint fix <CHECK_ID>  Fix a specific check directly (e.g. agentlint fix W11)

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
