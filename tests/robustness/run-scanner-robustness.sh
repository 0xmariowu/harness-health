#!/usr/bin/env bash
# Scanner robustness test — runs scanner on edge-case repos + corpus repos.
# Checks: no crashes, no hangs (30s timeout), valid JSONL output.
# Usage: bash tests/robustness/run-scanner-robustness.sh [--edge-only | --corpus-only]

set -u

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SCANNER="${ROOT_DIR}/src/scanner.sh"
EDGE_DIR="/tmp/al-validation/edge-repos"
CORPUS_DIR="${AL_CORPUS_DIR:-${HOME}/corpus/sources}"
RESULTS_FILE="${ROOT_DIR}/tests/robustness/results.json"
TIMEOUT_SECS=60

# macOS doesn't have `timeout` — use perl fallback
run_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "${secs}" "$@"
  else
    perl -e '
      use POSIX ":sys_wait_h";
      my $timeout = shift @ARGV;
      my $pid = fork();
      if ($pid == 0) { exec @ARGV; exit(127); }
      eval {
        local $SIG{ALRM} = sub { kill("TERM", $pid); die "timeout\n"; };
        alarm($timeout);
        waitpid($pid, 0);
        alarm(0);
      };
      if ($@ =~ /timeout/) { waitpid($pid, WNOHANG); exit(124); }
      exit($? >> 8);
    ' "${secs}" "$@"
  fi
}

pass=0
fail=0
total=0
results=()

run_scanner_on_repo() {
  local repo_path="$1"
  local repo_name="$2"
  local category="$3"
  total=$((total + 1))

  local tmp_out
  tmp_out="$(mktemp)"
  local start_ms
  start_ms=$(($(date +%s) * 1000))

  # Run scanner with timeout
  local exit_code=0
  run_with_timeout "${TIMEOUT_SECS}" bash "${SCANNER}" --project-dir "${repo_path}" > "${tmp_out}" 2>/dev/null || exit_code=$?

  local end_ms
  end_ms=$(($(date +%s) * 1000))
  local runtime_ms=$(( end_ms - start_ms ))

  # Check JSONL validity — each non-empty line must be valid JSON
  local jsonl_valid="true"
  local line_count=0
  if [ -s "${tmp_out}" ]; then
    while IFS= read -r line; do
      [ -z "${line}" ] && continue
      line_count=$((line_count + 1))
      if ! printf '%s' "${line}" | jq -e . >/dev/null 2>&1; then
        jsonl_valid="false"
        break
      fi
    done < "${tmp_out}"
  fi

  # Determine verdict
  local verdict="PASS"
  local failure_reason=""

  case ${exit_code} in
    0|1)
      # Normal exit
      if [ "${jsonl_valid}" = "false" ]; then
        verdict="FAIL"
        failure_reason="invalid JSONL output"
      fi
      ;;
    124)
      verdict="FAIL"
      failure_reason="hang (timeout ${TIMEOUT_SECS}s)"
      ;;
    130)
      verdict="FAIL"
      failure_reason="SIGINT (exit 130)"
      ;;
    137)
      verdict="FAIL"
      failure_reason="SIGKILL (exit 137)"
      ;;
    139)
      verdict="FAIL"
      failure_reason="SIGSEGV (exit 139)"
      ;;
    *)
      verdict="FAIL"
      failure_reason="unexpected exit code ${exit_code}"
      ;;
  esac

  if [ "${verdict}" = "PASS" ]; then
    pass=$((pass + 1))
    printf 'PASS  %-40s  %4dms  %3d lines\n' "${repo_name}" "${runtime_ms}" "${line_count}"
  else
    fail=$((fail + 1))
    printf 'FAIL  %-40s  %4dms  %s\n' "${repo_name}" "${runtime_ms}" "${failure_reason}"
  fi

  # Collect result for JSON output
  results+=("{\"repo\":\"${repo_name}\",\"category\":\"${category}\",\"exit_code\":${exit_code},\"runtime_ms\":${runtime_ms},\"jsonl_valid\":${jsonl_valid},\"jsonl_lines\":${line_count},\"verdict\":\"${verdict}\",\"failure_reason\":\"${failure_reason}\"}")

  rm -f "${tmp_out}"
}

# Parse args
mode="all"
if [ "${1:-}" = "--edge-only" ]; then
  mode="edge"
elif [ "${1:-}" = "--corpus-only" ]; then
  mode="corpus"
fi

echo "=== AgentLint Scanner Robustness Test ==="
echo ""

# Phase 1: Edge-case repos
if [ "${mode}" != "corpus" ]; then
  if [ ! -d "${EDGE_DIR}" ]; then
    echo "Edge repos not found. Run make-edge-repos.sh first."
    echo "  bash tests/robustness/make-edge-repos.sh"
    exit 1
  fi

  echo "--- Edge-case repos (${EDGE_DIR}) ---"
  for repo in "${EDGE_DIR}"/*/; do
    [ -d "${repo}" ] || continue
    name="$(basename "${repo}")"
    run_scanner_on_repo "${repo}" "edge/${name}" "edge"
  done
  echo ""
fi

# Phase 2: corpus repos
if [ "${mode}" != "edge" ]; then
  if [ ! -d "${CORPUS_DIR}" ]; then
    echo "corpus sources not found at ${CORPUS_DIR}. Skipping."
  else
    echo "--- corpus repos (${CORPUS_DIR}) ---"
    for repo in "${CORPUS_DIR}"/*/; do
      [ -d "${repo}" ] || continue
      name="$(basename "${repo}")"
      # Skip non-directory entries
      [ -d "${repo}" ] || continue
      run_scanner_on_repo "${repo}" "corpus/${name}" "corpus"
    done
    echo ""
  fi
fi

# Write results JSON
{
  printf '[\n'
  for i in "${!results[@]}"; do
    if [ "$i" -gt 0 ]; then
      printf ',\n'
    fi
    printf '  %s' "${results[$i]}"
  done
  printf '\n]\n'
} > "${RESULTS_FILE}"

# Summary
echo "=== Summary ==="
echo "Total: ${total}  Pass: ${pass}  Fail: ${fail}"
echo "Results: ${RESULTS_FILE}"

if [ "${fail}" -gt 0 ]; then
  echo ""
  echo "FAILURES:"
  printf '%s\n' "${results[@]}" | jq -r 'select(.verdict == "FAIL") | "  \(.repo): \(.failure_reason)"' 2>/dev/null || true
  exit 1
fi

exit 0
