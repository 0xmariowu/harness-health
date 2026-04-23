#!/usr/bin/env bash
set -euo pipefail

SCENARIO_TYPE="${SCENARIO_TYPE:-check}"
OUTPUT_PATH="${OUTPUT_PATH:-/tmp/scenario-output}"
REPO_NAME="${REPO_NAME:-empty-repo}"
CORPUS_PATH="${CORPUS_PATH:-/tmp/corpus}"
mkdir -p "$OUTPUT_PATH"

result_file="$OUTPUT_PATH/result.json"

echo "[run] Accuracy scenario type: $SCENARIO_TYPE"

run_check_on_repo() {
  local repo_path="$1"
  local project_name="$2"
  local scanner_file
  local scored_file
  scanner_file="$(mktemp)"
  scored_file="$(mktemp)"

  bash /tmp/agentlint-src/src/scanner.sh --project-dir "$repo_path" >"$scanner_file" 2>/dev/null || true

  if [ ! -s "$scanner_file" ]; then
    rm -f "$scanner_file" "$scored_file"
    printf '{"checks": {}, "total_score": 0, "project": "%s"}\n' "$project_name"
    return
  fi

  node /tmp/agentlint-src/src/scorer.js <"$scanner_file" >"$scored_file" 2>/dev/null || printf '{}' >"$scored_file"

  python3 - "$scanner_file" "$scored_file" "$project_name" <<'PY'
import json
import sys
from pathlib import Path

scanner_path, scored_path, project_name = sys.argv[1:4]
checks = {}
for line in Path(scanner_path).read_text(errors="replace").splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        continue
    check_id = record.get("check_id") or record.get("id") or ""
    score = record.get("score", 0)
    try:
        checks[check_id] = float(score) if score is not None else 0.0
    except (TypeError, ValueError):
        checks[check_id] = 0.0

try:
    scored = json.loads(Path(scored_path).read_text(errors="replace") or "{}")
    total = scored.get("total_score", 0)
except json.JSONDecodeError:
    total = 0

print(json.dumps({"checks": checks, "total_score": total, "project": project_name}))
PY
  rm -f "$scanner_file" "$scored_file"
}

case "$SCENARIO_TYPE" in
  check)
    REPO_PATH="/tmp/synthetic-repos/$REPO_NAME"

    if [ ! -d "$REPO_PATH" ]; then
      echo "[error] Synthetic repo not found: $REPO_PATH" >&2
      echo '{"checks": {}, "error": "synthetic repo not found"}' >"$result_file"
      exit 1
    fi

    check_data="$(run_check_on_repo "$REPO_PATH" "$REPO_NAME")"

    python3 - "$result_file" "$check_data" <<'PY'
import json
import os
import sys
from pathlib import Path

result_path = sys.argv[1]
data = json.loads(sys.argv[2])
checks_by_id = data.get("checks", {})
total_score = data.get("total_score", 0)

try:
    spec_checks = json.loads(os.environ.get("EXPECTED_CHECKS", "{}"))
    spec_score = json.loads(os.environ.get("EXPECTED_SCORE", '{"range": [0, 100]}'))
except json.JSONDecodeError:
    spec_checks = {}
    spec_score = {"range": [0, 100]}

result_checks = {}
for check_id, spec in spec_checks.items():
    actual = checks_by_id.get(check_id)
    expected_range = spec.get("range", [0, 1])
    if actual is None:
        result_checks[f"check_{check_id}"] = {"pass": False, "value": "not emitted", "expected": str(expected_range)}
    else:
        in_range = expected_range[0] <= actual <= expected_range[1]
        result_checks[f"check_{check_id}"] = {"pass": in_range, "value": actual, "expected": str(expected_range)}

score_range = spec_score.get("range", [0, 100])
score_ok = score_range[0] <= total_score <= score_range[1]
result_checks["total_score"] = {"pass": score_ok, "value": total_score, "expected": str(score_range)}

Path(result_path).write_text(json.dumps({"checks": result_checks, "data": {"total_score": total_score, "per_check": checks_by_id}}, indent=2))
print("Checks:", {k: v["pass"] for k, v in result_checks.items()})
PY
    ;;

  corpus-batch)
    echo "[run] Running corpus batch..."

    python3 - "$result_file" "$CORPUS_PATH" <<'PY'
import json
import os
import subprocess
import sys
from pathlib import Path

result_path, corpus_path = sys.argv[1:3]
corpus_repos = json.loads(os.environ.get("CORPUS_REPOS", "[]"))
tier_scores = {"A": [], "B": [], "C": []}
crashes = []

for repo_info in corpus_repos:
    name = repo_info["name"]
    tier = repo_info["tier"]
    repo_path = Path(corpus_path) / name

    if not repo_path.is_dir():
        print(f"  [skip] {name}: not available in sandbox", file=sys.stderr)
        tier_scores[tier].append(None)
        continue

    try:
        result = subprocess.run(
            ["bash", "/tmp/agentlint-src/src/scanner.sh", "--project-dir", str(repo_path)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        scorer_result = subprocess.run(
            ["node", "/tmp/agentlint-src/src/scorer.js"],
            input=result.stdout,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        try:
            scored = json.loads(scorer_result.stdout or "{}")
            score = scored.get("total_score", 0)
        except json.JSONDecodeError:
            score = 0
    except Exception as exc:
        crashes.append(f"{name}: {exc}")
        score = 0

    tier_scores[tier].append(score)
    print(f"  {name} ({tier}): {score}")

checks = {}
a_scores = [s for s in tier_scores["A"] if s is not None]
b_scores = [s for s in tier_scores["B"] if s is not None]
c_scores = [s for s in tier_scores["C"] if s is not None]

if a_scores and b_scores:
    a_avg = sum(a_scores) / len(a_scores)
    b_avg = sum(b_scores) / len(b_scores)
    checks["tier_a_gt_b"] = {"pass": a_avg > b_avg, "value": f"A={a_avg:.1f} B={b_avg:.1f}"}

if b_scores and c_scores:
    b_avg = sum(b_scores) / len(b_scores)
    c_avg = sum(c_scores) / len(c_scores)
    checks["tier_b_gt_c"] = {"pass": b_avg > c_avg, "value": f"B={b_avg:.1f} C={c_avg:.1f}"}

scanned_count = len([s for tier in tier_scores.values() for s in tier if s is not None])
checks["no_crashes"] = {"pass": not crashes, "value": f"{scanned_count} repos scanned" if not crashes else "; ".join(crashes)}

Path(result_path).write_text(json.dumps({"checks": checks, "data": {"tier_scores": {k: [s for s in v if s is not None] for k, v in tier_scores.items()}}}, indent=2))
print("Checks:", {k: v["pass"] for k, v in checks.items()})
PY
    ;;

  *)
    echo "[error] Unknown accuracy scenario type: $SCENARIO_TYPE" >&2
    echo '{"checks": {}, "error": "unknown scenario type"}' >"$result_file"
    exit 1
    ;;
esac

echo "[run] Done."
