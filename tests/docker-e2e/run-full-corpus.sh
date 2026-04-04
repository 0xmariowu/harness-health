#!/usr/bin/env bash
# Full corpus scanner+scorer test — runs on all reconstructed repos.
# Outputs results.json with per-repo scores and summary statistics.
set -u

ROOT="/app"
PROJECTS="/home/testuser/Projects"
SCANNER="${ROOT}/src/scanner.sh"
SCORER="${ROOT}/src/scorer.js"
RESULTS="/tmp/full-corpus-results.json"

echo "=== AgentLint Full Corpus Test ==="

total=0
crash=0
hang=0
valid=0
scores=()
with_claude_scores=()
no_claude_scores=()
start_time="$(date +%s)"

echo "[" > "$RESULTS"
first=true

MAX_REPOS="${AL_MAX_REPOS:-1500}"

for repo_dir in "${PROJECTS}"/*/; do
  [ -d "$repo_dir" ] || continue
  name="$(basename "$repo_dir")"
  total=$((total + 1))

  if [ "$total" -gt "$MAX_REPOS" ]; then
    break
  fi

  # Run scanner with timeout (perl fallback for Linux compat)
  tmp_out="$(mktemp)"
  exit_code=0
  timeout 60 bash "$SCANNER" --project-dir "$repo_dir" > "$tmp_out" 2>/dev/null || exit_code=$?

  case $exit_code in
    0|1) ;;
    124) hang=$((hang + 1)); rm -f "$tmp_out"; continue ;;
    *) crash=$((crash + 1)); rm -f "$tmp_out"; continue ;;
  esac

  # Validate JSONL
  jsonl_valid=true
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if ! printf '%s' "$line" | jq -e . >/dev/null 2>&1; then
      jsonl_valid=false
      break
    fi
  done < "$tmp_out"

  if [ "$jsonl_valid" != "true" ]; then
    rm -f "$tmp_out"
    continue
  fi

  # Score
  score_out="$(node "$SCORER" "$tmp_out" 2>/dev/null)"
  score="$(printf '%s' "$score_out" | jq '.total_score' 2>/dev/null | tr -d '[:space:]')"

  if [ -n "$score" ] && [ "$score" != "null" ]; then
    valid=$((valid + 1))
    scores+=("$score")

    # Classify by entry file
    has_claude="$(printf '%s' "$score_out" | jq -r '.dimensions.findability.checks[] | select(.check_id=="F1") | .score' 2>/dev/null | tr -d '[:space:]')"
    if [ "${has_claude:-0}" = "1" ]; then
      with_claude_scores+=("$score")
    else
      no_claude_scores+=("$score")
    fi
  fi

  # Write result
  if [ "$first" = true ]; then first=false; else printf ',\n' >> "$RESULTS"; fi
  printf '{"repo":"%s","score":%s,"exit_code":%s}' "$name" "${score:-null}" "$exit_code" >> "$RESULTS"

  rm -f "$tmp_out"

  # Progress
  if [ $((total % 500)) -eq 0 ]; then
    printf '  Processed: %d repos...\n' "$total" >&2
  fi
done

printf '\n]\n' >> "$RESULTS"

end_time="$(date +%s)"
elapsed=$((end_time - start_time))

# Calculate statistics
calc_stats() {
  local arr=("$@")
  local n=${#arr[@]}
  if [ "$n" -eq 0 ]; then echo "n=0"; return; fi

  # Sort
  local sorted=($(printf '%s\n' "${arr[@]}" | sort -n))
  local sum=0
  for v in "${sorted[@]}"; do sum=$((sum + v)); done
  local mean=$((sum / n))
  local min="${sorted[0]}"
  local max="${sorted[$((n-1))]}"
  local p25="${sorted[$((n/4))]}"
  local median="${sorted[$((n/2))]}"
  local p75="${sorted[$((n*3/4))]}"
  echo "n=$n min=$min p25=$p25 median=$median p75=$p75 max=$max mean=$mean"
}

echo ""
echo "=== Summary ==="
echo "Total repos:  $total"
echo "Scored:       $valid"
echo "Crashes:      $crash"
echo "Hangs:        $hang"
echo "Time:         ${elapsed}s"
echo ""
echo "Score distribution (all): $(calc_stats "${scores[@]}")"
echo "With entry file:          $(calc_stats "${with_claude_scores[@]}")"
echo "Without entry file:       $(calc_stats "${no_claude_scores[@]}")"
echo ""

# Validate criteria
all_pass=true

if [ "$crash" -gt 0 ]; then
  echo "FAIL: $crash crashes"
  all_pass=false
fi

if [ "$hang" -gt 0 ]; then
  echo "FAIL: $hang hangs"
  all_pass=false
fi

# Check separation between with/without entry file
if [ ${#with_claude_scores[@]} -gt 0 ] && [ ${#no_claude_scores[@]} -gt 0 ]; then
  with_sum=0; for v in "${with_claude_scores[@]}"; do with_sum=$((with_sum + v)); done
  with_mean=$((with_sum / ${#with_claude_scores[@]}))
  no_sum=0; for v in "${no_claude_scores[@]}"; do no_sum=$((no_sum + v)); done
  no_mean=$((no_sum / ${#no_claude_scores[@]}))
  gap=$((with_mean - no_mean))
  echo "Entry file gap: ${gap} points (with=${with_mean}, without=${no_mean})"
  if [ "$gap" -lt 15 ]; then
    echo "FAIL: gap < 15 (expected significant separation)"
    all_pass=false
  else
    echo "PASS: gap >= 15"
  fi
fi

echo ""
if [ "$all_pass" = true ]; then
  echo "RESULT: ALL PASSED"
  exit 0
else
  echo "RESULT: FAILED"
  exit 1
fi
