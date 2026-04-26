#!/usr/bin/env bash
# agentlint — Setup, check, and fix your repo for AI-native development.
#
# Usage:
#   agentlint setup --lang <ts|python|node> [options] <project-path>
#   agentlint check [--project-dir PATH]
#   agentlint fix   <CHECK_ID> [--project-dir PATH]
#   agentlint doctor
#   agentlint help

set -euo pipefail

# Follow symlinks so SCRIPT_DIR resolves to the real scripts/ directory
# when installed via npm -g (which creates a symlink in /usr/local/bin).
# Portable resolver — works on BSD/macOS where `readlink -f` is unavailable.
# Mirrors scripts/lib/resolve-self.sh; kept inline so the file is
# self-contained when extracted by tests or copied during install.
_al_resolve_self() {
    local current="$1"; local target current_dir; local i=0
    while [ -L "$current" ] && [ "$i" -lt 16 ]; do
        target=$(readlink "$current")
        case "$target" in
            /*) current="$target" ;;
            *) current_dir=$(dirname "$current"); current="$current_dir/$target" ;;
        esac
        i=$((i + 1))
    done
    local final_dir final_base
    final_dir=$(dirname "$current"); final_base=$(basename "$current")
    final_dir=$(CDPATH='' cd -- "$final_dir" 2>/dev/null && pwd -P) || return 1
    if [ "$final_base" = "/" ]; then echo "$final_dir"; else echo "$final_dir/$final_base"; fi
}
SCRIPT_DIR="$(dirname "$(_al_resolve_self "${BASH_SOURCE[0]}")")"

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

# Emit a concise error for flags called without a value. Without this helper,
# `agentlint fix --project-dir` (no value) hits `set -u` inside the parser and
# exits non-zero with `$1: unbound variable` — technically the right exit code,
# but stderr is unreadable and callers treat it as a bug report, not a usage
# error. Also catches `--foo --bar` where a value was expected.
require_value() {
  local flag="$1"
  local value="${2-}"
  if [[ -z "$value" || "$value" == --* ]]; then
    echo "agentlint: $flag requires a value" >&2
    exit 1
  fi
}

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
    #
    # Two target modes:
    #   (default)                     scan current directory `.`
    #   --project-dir PATH            scan that single repo
    #   --all [--projects-root PATH]  multi-project auto-discovery
    #                                 (scanner's PROJECTS_ROOT env-var path)
    #
    # Before this flag existed, `agentlint check` with no target silently
    # fell through to scanner's auto-discovery of `~/Projects`, which
    # surprised users running inside unrelated repos.
    scanner_args=()
    reporter_args=()
    has_project_dir=0
    want_all=0
    projects_root=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --project-dir)
          require_value "$1" "${2-}"
          has_project_dir=1
          scanner_args+=("$1" "$2")
          shift
          ;;
        --project-dir=*)
          has_project_dir=1
          scanner_args+=("$1")
          ;;
        --all)
          want_all=1
          ;;
        --projects-root)
          require_value "$1" "${2-}"
          projects_root="$2"
          shift
          ;;
        --projects-root=*)
          projects_root="${1#--projects-root=}"
          ;;
        --format|--output-dir|--fail-below|--before)
          require_value "$1" "${2-}"
          reporter_args+=("$1" "$2")
          shift
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

    if [[ "$want_all" -eq 1 && "$has_project_dir" -eq 1 ]]; then
      echo "agentlint: --all and --project-dir are mutually exclusive" >&2
      exit 1
    fi

    if [[ "$want_all" -eq 1 ]]; then
      # Multi-project auto-discovery. scanner reads PROJECTS_ROOT from env
      # (not --project-dir; that's single-project semantics).
      if [[ -n "$projects_root" ]]; then
        export PROJECTS_ROOT="$projects_root"
      fi
    elif [[ "$has_project_dir" -eq 0 ]]; then
      # Single-project default: current directory. Matches README examples
      # and what `fix` already does.
      scanner_args+=("--project-dir" ".")
    fi

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
        --project-dir)
          require_value "$1" "${2-}"
          has_project_dir=1
          path_args+=("$1" "$2")
          shift
          ;;
        --project-dir=*)
          has_project_dir=1
          path_args+=("$1")
          ;;
        --*)
          path_args+=("$1")
          ;;
        *)
          # Looks like a check ID (case-insensitive: w11, W11, S3 all accepted).
          # Also accept comma-separated lists like "W11,F5,S1" (documented in
          # help + README). Each segment must match the check-ID shape.
          # Use `tr` for uppercase — `${1^^}` is Bash 4+ and fails on macOS Bash 3.2.
          upper="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
          if [[ "$upper" =~ ^[A-Z][A-Z0-9-]+(,[A-Z][A-Z0-9-]+)*$ ]]; then
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

    # fixer.js requires --items or --checks. Without a check id the old
    # behavior piped scorer → plan-generator → fixer with neither flag, so
    # fixer threw "Usage: ... --items or --checks is required" and the
    # broken pipe on an earlier stage emitted an EPIPE Node stack trace.
    # That's a bad UX for the most obvious "fix what you found" entry
    # point. Option A: reject fast with a clear product-level message
    # pointing to the correct commands.
    if [[ -z "$check_ids" ]]; then
      cat >&2 <<'USAGE'
agentlint fix: a check id is required.

Run a scan first to see what needs fixing:

  agentlint check

Then fix a specific check:

  agentlint fix W11                 # fix one check
  agentlint fix W11,F5,S1           # fix several

Inside Claude Code, /al walks you through selecting and fixing items
interactively.
USAGE
      exit 2
    fi

    run_scan "${path_args[@]}" || exit $?

    node "${SCRIPT_DIR}/../src/scorer.js" "${_AL_SCAN_OUT}" \
      | node "${SCRIPT_DIR}/../src/plan-generator.js" \
      | node "${SCRIPT_DIR}/../src/fixer.js" --checks "$check_ids" "${path_args[@]}"
    ;;
  version|--version|-v)
    # Resolve symlinks to find real script location (handles npm global installs)
    _REAL="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || readlink "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
    _DIR="$(cd "$(dirname "$_REAL")" 2>/dev/null && pwd)"
    node -e "console.log(require('$_DIR/../package.json').version)" 2>/dev/null \
      || python3 -c "import json; print(json.load(open('$_DIR/../package.json'))['version'])" 2>/dev/null \
      || echo "unknown"
    ;;
  doctor)
    # Environment preflight: agentlint check silently fails without jq on
    # macOS (brew doesn't ship it by default) and silently fails without
    # bash ≥ 4 on Windows without WSL/Git Bash. doctor lists every required
    # dependency, its state, and platform-specific install hints. No scan
    # runs; just diagnostic output. Exit 1 if any required dep is missing.
    missing=0
    platform="$(uname -s 2>/dev/null || echo unknown)"
    printf 'AgentLint doctor — environment preflight\n\n'

    check_dep() {
      local name="$1"
      local version_cmd="$2"
      local hint_mac="$3"
      local hint_linux="$4"
      local hint_win="$5"
      if command -v "$name" >/dev/null 2>&1; then
        # Smoke-test: a binary on PATH may still be broken (corrupted,
        # wrong arch, missing shared lib). Require the version command
        # to exit 0 AND emit non-empty output before declaring OK.
        local ver
        local rc
        ver="$(eval "$version_cmd" 2>/dev/null | head -1)"
        rc=$?
        if [ "$rc" -ne 0 ] || [ -z "$ver" ]; then
          missing=$((missing + 1))
          printf '  \033[31m✗\033[0m %-8s  on PATH but broken (exit=%d, no version output)\n' "$name" "$rc"
          case "$platform" in
            Darwin) printf '            reinstall: %s\n' "$hint_mac" ;;
            Linux)  printf '            reinstall: %s\n' "$hint_linux" ;;
            MINGW*|MSYS*|CYGWIN*) printf '            reinstall: %s\n' "$hint_win" ;;
            *)      printf '            reinstall: %s\n' "$hint_linux" ;;
          esac
        else
          printf '  \033[32m✓\033[0m %-8s  %s\n' "$name" "$ver"
        fi
      else
        missing=$((missing + 1))
        printf '  \033[31m✗\033[0m %-8s  not found on PATH\n' "$name"
        case "$platform" in
          Darwin) printf '            install: %s\n' "$hint_mac" ;;
          Linux)  printf '            install: %s\n' "$hint_linux" ;;
          MINGW*|MSYS*|CYGWIN*) printf '            install: %s\n' "$hint_win" ;;
          *)      printf '            install: %s\n' "$hint_linux" ;;
        esac
      fi
    }

    check_dep node   'node --version'   'brew install node'        'sudo apt-get install -y nodejs'      'https://nodejs.org'
    check_dep bash   'bash --version'   'brew install bash'        'sudo apt-get install -y bash'        'install Git for Windows or WSL'
    check_dep jq     'jq --version'     'brew install jq'          'sudo apt-get install -y jq'          'choco install jq'
    check_dep git    'git --version'    'xcode-select --install'   'sudo apt-get install -y git'         'https://git-scm.com'

    # Node version must be >= 20 (see package.json engines).
    if command -v node >/dev/null 2>&1; then
      node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
      if [ "${node_major:-0}" -lt 20 ]; then
        missing=$((missing + 1))
        printf '  \033[31m✗\033[0m node      version %s is below the required Node 20+\n' "$node_major"
        printf '            upgrade: %s\n' "see nodejs.org or nvm"
      fi
    fi

    printf '\n'
    if [ "$missing" -eq 0 ]; then
      printf '\033[32mAll required dependencies present.\033[0m\n'
      exit 0
    fi
    printf '\033[31m%d missing dependency(ies). Install the listed packages and re-run.\033[0m\n' "$missing"
    exit 1
    ;;
  help|--help|-h|"")
    cat <<'EOF'
agentlint — AI-native development toolkit

Commands:
  setup   Bootstrap a repo with AI-native CI/CD, hooks, and templates
          agentlint setup --lang <ts|python|node> [--visibility public|private] [--init-git] [--with-auto-push] <path>

  check   Diagnose your repo's AI-friendliness (51 core checks + 7 opt-in)
          agentlint check                          # scan current directory
          agentlint check --project-dir <path>     # scan one specific repo
          agentlint check --all                    # multi-project discovery
                          [--projects-root <path>] # (default: ~/Projects)
          Reporter flags (any mode):
                          [--format <terminal|md|jsonl|html|sarif|all>]
                          [--output-dir <path>]      # used when format != terminal
                          [--fail-below <0-100>]     # exit non-zero below threshold
                          [--before <scores.json>]   # HTML delta vs a previous run

  fix     Auto-fix issues found by check
          agentlint fix <CHECK_ID>  Fix a specific check directly (e.g. agentlint fix W11)
          agentlint fix <CHECK_ID> --project-dir <path>

  doctor  Preflight check — verify node 20+, bash, jq, git are on PATH
          agentlint doctor                         # exits 0 if all present

  help    Show this help

Examples:
  agentlint setup --lang python ~/Projects/my-repo
  agentlint check                              # current repo
  agentlint check --project-dir ~/Projects/my-repo
  agentlint check --all --projects-root ~/Projects
  agentlint fix W11 --project-dir ~/Projects/my-repo
  agentlint fix W11,F5,S1                      # comma-separated
EOF
    ;;
  *)
    echo "error: unknown command '$1'. Run 'agentlint help' for usage." >&2
    exit 1
    ;;
esac
