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

# Follow symlinks so SCRIPT_DIR resolves to the real scripts/ directory
# when installed via npm -g (which creates a symlink in /usr/local/bin).
_SELF="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$_SELF")" && pwd)"

# ─── Transactional scan helper ─────────────────────────────────────────────
# Runs src/scanner.sh with the given args and captures stdout/stderr to temp
# files. Returns the scanner's exit code. Callers MUST check the exit code
# and bail before piping into scorer/reporter — otherwise a scanner failure
# will leak a fake "Score: 0/100" report to stdout (scorer accepts empty
# input). See docs/comprehensive-remediation-plan.md §P0-1.
#
# Sets globals:
#   _AL_SCAN_OUT — path to captured stdout (JSONL when scanner succeeded)
#   _AL_SCAN_ERR — path to captured stderr
_AL_TMPDIR=""

_al_cleanup() {
  if [[ -n "${_AL_TMPDIR}" && -d "${_AL_TMPDIR}" ]]; then
    rm -rf "${_AL_TMPDIR}" 2>/dev/null || true
  fi
}
trap _al_cleanup EXIT

run_scan() {
  _AL_TMPDIR="$(mktemp -d -t agentlint-XXXXXX)"
  _AL_SCAN_OUT="${_AL_TMPDIR}/scan.jsonl"
  _AL_SCAN_ERR="${_AL_TMPDIR}/scan.err"

  # Don't let pipefail kill us here — we want to inspect the exit code.
  set +e
  bash "${SCRIPT_DIR}/../src/scanner.sh" "$@" \
    >"${_AL_SCAN_OUT}" 2>"${_AL_SCAN_ERR}"
  local rc=$?
  set -e

  if [[ "$rc" -ne 0 ]]; then
    # Scanner failed — forward its stderr so the user sees the real error,
    # not a fabricated score report.
    if [[ -s "${_AL_SCAN_ERR}" ]]; then
      cat "${_AL_SCAN_ERR}" >&2
    else
      echo "agentlint: scanner exited with status ${rc}" >&2
    fi
    return "$rc"
  fi

  if [[ ! -s "${_AL_SCAN_OUT}" ]]; then
    echo "agentlint: scanner produced no output" >&2
    return 1
  fi

  return 0
}

case "${1:-}" in
  init)
    shift
    exec node "$SCRIPT_DIR/../postinstall.js" init "$@"
    ;;
  setup)
    shift
    exec "$SCRIPT_DIR/setup.sh" "$@"
    ;;
  check)
    shift
    # Split args into scanner-bound vs reporter-bound so the CLI can forward
    # report-formatting flags (--format, --output-dir, --fail-below, --before,
    # --sarif-include-all) that the GitHub Action already exposed. Unknown
    # flags reach the scanner and fail loudly there — the transactional
    # pipeline (P0-1) guarantees no fake score report leaks to stdout.
    scanner_args=()
    reporter_args=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --project-dir|--project-dir=*)
          scanner_args+=("$1")
          if [[ "$1" == "--project-dir" ]]; then
            shift
            scanner_args+=("${1-}")
          fi
          ;;
        --format|--output-dir|--fail-below|--before)
          reporter_args+=("$1")
          shift
          reporter_args+=("${1-}")
          ;;
        --format=*|--output-dir=*|--fail-below=*|--before=*|--sarif-include-all)
          reporter_args+=("$1")
          ;;
        *)
          scanner_args+=("$1")
          ;;
      esac
      shift
    done
    run_scan "${scanner_args[@]+"${scanner_args[@]}"}" || exit $?
    node "${SCRIPT_DIR}/../src/scorer.js" "${_AL_SCAN_OUT}" \
      | node "${SCRIPT_DIR}/../src/reporter.js" "${reporter_args[@]+"${reporter_args[@]}"}"
    ;;
  fix)
    shift
    # Separate check IDs (e.g. W11, S1) from path flags (e.g. --project-dir)
    check_ids=""
    path_args=()
    has_project_dir=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --project-dir|--project-dir=*)
          has_project_dir=1
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
          # Use `tr` for uppercase — `${1^^}` is Bash 4+ and fails on macOS Bash 3.2.
          upper="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
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

    # Default --project-dir to current directory if not specified
    if [[ "$has_project_dir" -eq 0 ]]; then
      path_args+=("--project-dir" ".")
    fi

    run_scan "${path_args[@]}" || exit $?

    if [[ -n "$check_ids" ]]; then
      node "${SCRIPT_DIR}/../src/scorer.js" "${_AL_SCAN_OUT}" \
        | node "${SCRIPT_DIR}/../src/plan-generator.js" \
        | node "${SCRIPT_DIR}/../src/fixer.js" --checks "$check_ids" "${path_args[@]}"
    else
      node "${SCRIPT_DIR}/../src/scorer.js" "${_AL_SCAN_OUT}" \
        | node "${SCRIPT_DIR}/../src/plan-generator.js" \
        | node "${SCRIPT_DIR}/../src/fixer.js" "${path_args[@]}"
    fi
    ;;
  version|--version|-v)
    # Resolve symlinks to find real script location (handles npm global installs)
    _REAL="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
    _DIR="$(cd "$(dirname "$_REAL")" 2>/dev/null && pwd)"
    node -e "console.log(require('$_DIR/../package.json').version)" 2>/dev/null \
      || python3 -c "import json; print(json.load(open('$_DIR/../package.json'))['version'])" 2>/dev/null \
      || echo "unknown"
    ;;
  help|--help|-h|"")
    cat <<'EOF'
agentlint — AI-native development toolkit

Commands:
  setup   Bootstrap a repo with AI-native CI/CD, hooks, and templates
          agentlint setup --lang <ts|python|node> [--visibility public|private] <path>

  check   Diagnose your repo's AI-friendliness (51 core checks + 7 opt-in)
          agentlint check [--project-dir <path>]
                          [--format <terminal|md|jsonl|html|sarif|all>]
                          [--output-dir <path>]      # used when format != terminal
                          [--fail-below <0-100>]     # exit non-zero below threshold
                          [--before <scores.json>]   # HTML delta vs a previous run

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
