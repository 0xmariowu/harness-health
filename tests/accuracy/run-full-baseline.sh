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
while [ $# -gt 0 ]; do
  case "$1" in
    --parallel) PARALLEL="$2"; shift 2 ;;
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

WORK="$(mktemp -d)"
OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK" "$OUT_DIR"' EXIT

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
  mkdir -p "$recon"
  if bash "$RECON" "$src" "$recon" >/dev/null 2>&1; then
    if [ -n "$TIMEOUT_CMD" ]; then
      $TIMEOUT_CMD bash "$SCANNER" --project-dir "$recon" > "${OUT_DIR}/${name}.jsonl" 2>/dev/null || true
    else
      bash "$SCANNER" --project-dir "$recon" > "${OUT_DIR}/${name}.jsonl" 2>/dev/null || true
    fi
  fi
  rm -rf "$recon"
}
export -f scan_one
export SCANNER RECON OUT_DIR RECON_PARENT TIMEOUT_CMD

echo "[2/4] Scanning $repo_count repos (parallel=$PARALLEL)..."
start="$(date +%s)"
find "$WORK" -maxdepth 1 -mindepth 1 -type d -print0 | \
  xargs -0 -I{} -P "$PARALLEL" bash -c 'scan_one "$@"' _ {}
elapsed=$(( $(date +%s) - start ))
scanned_count="$(find "$OUT_DIR" -maxdepth 1 -name '*.jsonl' -not -empty | wc -l | tr -d ' ')"
echo "      Scanned $scanned_count repos with non-empty output in ${elapsed}s"

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
