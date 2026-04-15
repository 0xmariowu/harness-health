#!/usr/bin/env bash
# Orchestrates the full 4533-repo accuracy run that produces accuracy-baseline.json.
# Extracts corpus-full.tar.gz, reconstructs each repo, scans it, merges JSONL,
# then compares against labels-full.jsonl via compare-results.js.
#
# Usage: bash tests/accuracy/run-full-baseline.sh [--parallel N]
# Default parallelism: 8. Takes ~10-30 minutes on modern hardware.
#
# Output: tests/accuracy/<timestamp>-accuracy.json
# Optional: copy to tests/accuracy/accuracy-baseline.json to update the committed baseline.

set -euo pipefail

PARALLEL=8
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --parallel) PARALLEL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(CDPATH='' cd -- "${SCRIPT_DIR}/../.." && pwd)"
SCANNER="${ROOT}/src/scanner.sh"
RECON="${ROOT}/tests/docker-e2e/reconstruct-repo.sh"
COMPARE="${ROOT}/tests/accuracy/compare-results.js"
TARBALL="${ROOT}/tests/docker-e2e/corpus-full.tar.gz"
LABELS="${ROOT}/tests/accuracy/labels-full.jsonl"

for f in "$SCANNER" "$RECON" "$COMPARE" "$TARBALL" "$LABELS"; do
  [ -e "$f" ] || { echo "Missing: $f" >&2; exit 1; }
done

if [ "$DRY_RUN" -eq 1 ]; then
  command -v bash >/dev/null 2>&1 || { echo "Missing required executable: bash" >&2; exit 1; }
  command -v node >/dev/null 2>&1 || { echo "Missing required executable: node" >&2; exit 1; }

  bash -n "$SCANNER"
  bash -n "$RECON"
  node --check "$COMPARE" >/dev/null
  tar -tzf "$TARBALL" >/dev/null

  expected_repo_count="$(tar -tzf "$TARBALL" | awk -F/ 'NF > 1 && $2 != "" { seen[$2] = 1 } END { print length(seen) }')"

  echo "[dry-run] Path checks passed"
  echo "[dry-run] Tarball readable: $TARBALL"
  echo "[dry-run] Scripts validated: scanner via bash, recon via bash, compare via node"
  echo "[dry-run] Would scan $expected_repo_count repos with parallel=$PARALLEL"
  echo "[dry-run] Would create temp work/output dirs and write ${ROOT}/tests/accuracy/<timestamp>-accuracy.json"
  exit 0
fi

WORK="$(mktemp -d)"
OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK" "$OUT_DIR"' EXIT
FAIL_LOG="${OUT_DIR}/_failures.log"
touch "$FAIL_LOG"

echo "[1/4] Extracting corpus..."
tar -xzf "$TARBALL" -C "$WORK"
repo_count="$(find "$WORK" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
echo "      Extracted $repo_count repos"

RECON_PARENT="$(mktemp -d)"
trap 'rm -rf "$WORK" "$OUT_DIR" "$RECON_PARENT"' EXIT

# Pick whichever timeout binary is available (Linux has 'timeout',
# macOS has 'gtimeout' via coreutils). Fall back to no timeout.
TIMEOUT_CMD=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout 60"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout 60"
fi

scan_one() {
  local src="$1"
  local name
  name="$(basename "$src")"
  # Use the corpus name as the recon dir basename so scanner's `project`
  # field matches the label key in labels-full.jsonl.
  local recon="${RECON_PARENT}/${name}"
  local jsonl="${OUT_DIR}/${name}.jsonl"
  local recon_status=0
  local status=0
  mkdir -p "$recon"
  bash "$RECON" "$src" "$recon" >/dev/null 2>&1 || recon_status=$?
  if [ "$recon_status" -ne 0 ]; then
    printf '%s reconstruct exit_%s\n' "$name" "$recon_status" >> "$FAIL_LOG"
    rm -rf "$recon"
    return
  fi

  if [ -n "$TIMEOUT_CMD" ]; then
    $TIMEOUT_CMD bash "$SCANNER" --project-dir "$recon" > "$jsonl" 2>/dev/null || status=$?
  else
    bash "$SCANNER" --project-dir "$recon" > "$jsonl" 2>/dev/null || status=$?
  fi

  if [ "$status" -eq 124 ]; then
    printf '%s scan timeout\n' "$name" >> "$FAIL_LOG"
  elif [ "$status" -ne 0 ] && [ ! -s "$jsonl" ]; then
    printf '%s scan exit_%s_no_output\n' "$name" "$status" >> "$FAIL_LOG"
  fi
  rm -rf "$recon"
}
export -f scan_one
export SCANNER RECON OUT_DIR RECON_PARENT TIMEOUT_CMD FAIL_LOG

echo "[2/4] Scanning $repo_count repos (parallel=$PARALLEL)..."
start="$(date +%s)"
find "$WORK" -maxdepth 1 -mindepth 1 -type d -print0 | \
  xargs -0 -I{} -P "$PARALLEL" bash -c 'scan_one "$@"' _ {}
elapsed=$(( $(date +%s) - start ))
scanned_count="$(find "$OUT_DIR" -maxdepth 1 -name '*.jsonl' -not -empty | wc -l | tr -d ' ')"
echo "      Scanned $scanned_count repos with non-empty output in ${elapsed}s"

reconstruct_failures=0
scan_timeouts=0
scanner_errors=0
failure_count=0
if [ -s "$FAIL_LOG" ]; then
  reconstruct_failures="$(awk '$2 == "reconstruct" { count++ } END { print count + 0 }' "$FAIL_LOG")"
  scan_timeouts="$(awk '$2 == "scan" && $3 == "timeout" { count++ } END { print count + 0 }' "$FAIL_LOG")"
  scanner_errors="$(awk '$2 == "scan" && $3 ~ /^exit_[0-9]+_no_output$/ { count++ } END { print count + 0 }' "$FAIL_LOG")"
  failure_count=$(( reconstruct_failures + scan_timeouts + scanner_errors ))
fi

echo "      ${reconstruct_failures} reconstruct failures, ${scan_timeouts} timeouts, ${scanner_errors} scanner errors"
if [ "$failure_count" -gt 0 ]; then
  failed_preview="$(awk 'seen[$1]++ == 0 { print $1; if (++count == 10) exit }' "$FAIL_LOG" | paste -sd ',' - | sed 's/,/, /g')"
  echo "      First failed repos: ${failed_preview}"
fi
if [ "$repo_count" -gt 0 ] && [ "$failure_count" -gt 0 ] && [ $(( failure_count * 100 )) -gt $(( repo_count * 5 )) ]; then
  printf 'WARNING: scan failure rate %.1f%% exceeded 5%% (%s/%s repos)\n' \
    "$(awk -v failures="$failure_count" -v total="$repo_count" 'BEGIN { printf "%.1f", (failures * 100) / total }')" \
    "$failure_count" "$repo_count" >&2
fi

echo "[3/4] Merging JSONL..."
MERGED="${OUT_DIR}/all-results.jsonl"
find "$OUT_DIR" -maxdepth 1 -name '*.jsonl' -not -empty -exec cat {} + > "$MERGED"
line_count="$(wc -l < "$MERGED" | tr -d ' ')"
echo "      Merged $line_count JSONL lines"

echo "[4/4] Running compare-results..."
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_JSON="${ROOT}/tests/accuracy/${TIMESTAMP}-accuracy.json"
# compare-results.js writes <input>.jsonl → <input>-accuracy.json, so name accordingly
WORK_JSONL="${ROOT}/tests/accuracy/${TIMESTAMP}.jsonl"
cp "$MERGED" "$WORK_JSONL"
node "$COMPARE" "$WORK_JSONL"
mv "${WORK_JSONL%.jsonl}-accuracy.json" "$OUT_JSON"
rm -f "$WORK_JSONL"

echo ""
echo "Output: $OUT_JSON"
echo "To update baseline: cp '$OUT_JSON' '${ROOT}/tests/accuracy/accuracy-baseline.json'"
