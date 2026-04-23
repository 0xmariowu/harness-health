#!/usr/bin/env bash
set -euo pipefail

SCENARIO_TYPE="${SCENARIO_TYPE:-report-html}"
OUTPUT_PATH="${OUTPUT_PATH:-/tmp/scenario-output}"
REPO_NAME="${REPO_NAME:-well-configured}"
mkdir -p "$OUTPUT_PATH"
mkdir -p "$OUTPUT_PATH/reports"

result_file="$OUTPUT_PATH/result.json"
echo "[reports-run] Scenario: $SCENARIO_TYPE"

REPO_PATH="/tmp/synthetic-repos/$REPO_NAME"
scored_file="$OUTPUT_PATH/scored.json"

echo "[reports-run] Running agentlint check on $REPO_PATH..."
bash /tmp/agentlint-src/src/scanner.sh --project-dir "$REPO_PATH" 2>/dev/null \
  | node /tmp/agentlint-src/src/scorer.js >"$scored_file" 2>/dev/null || true
node /tmp/agentlint-src/src/reporter.js "$scored_file" --format all --output-dir "$OUTPUT_PATH/reports" 2>/dev/null || true

bash /tmp/agentlint-src/src/scanner.sh --project-dir "$REPO_PATH" 2>/dev/null \
  > "$OUTPUT_PATH/scanner.jsonl" || true

case "$SCENARIO_TYPE" in
  report-html)
    python3 - "$result_file" "$OUTPUT_PATH/reports" "$scored_file" <<'PY'
import json
import os
import sys

result_file, reports_dir, scored_file = sys.argv[1:4]
checks = {}

html_file = None
if os.path.isdir(reports_dir):
    for filename in os.listdir(reports_dir):
        if filename.endswith(".html"):
            html_file = os.path.join(reports_dir, filename)
            break

checks["html_file_exists"] = {"pass": html_file is not None, "value": html_file or "not found"}

if html_file:
    content = open(html_file, encoding="utf-8", errors="replace").read()

    dims = ["findability", "instructions", "workability", "continuity", "safety", "harness"]
    for dim in dims:
        present = dim.lower() in content.lower()
        checks[f"dim_{dim}"] = {"pass": present, "value": "found" if present else "missing"}

    try:
        scored = json.load(open(scored_file, encoding="utf-8"))
        total = scored.get("total_score", 0)
        score_str = str(int(round(total)))
        checks["score_in_html"] = {"pass": score_str in content, "value": f"looking for {score_str}"}
    except Exception as exc:
        checks["score_in_html"] = {"pass": False, "value": str(exc)}

    checks["valid_html_structure"] = {
        "pass": "<html" in content.lower() and "<body" in content.lower(),
        "value": "ok" if "<html" in content.lower() and "<body" in content.lower() else "malformed",
    }

with open(result_file, "w", encoding="utf-8") as f:
    json.dump({"checks": checks}, f, indent=2)
print("HTML checks:", {k: v["pass"] for k, v in checks.items()})
PY
    ;;

  report-sarif)
    python3 - "$result_file" "$OUTPUT_PATH/reports" <<'PY'
import json
import os
import sys

try:
    import jsonschema

    HAS_JSONSCHEMA = True
except ImportError:
    HAS_JSONSCHEMA = False

result_file, reports_dir = sys.argv[1:3]
schema_file = "/tmp/agentlint-src/tests/e2b/scenarios/reports/sarif-schema.json"
evidence_file = "/tmp/agentlint-src/standards/evidence.json"
checks = {}

sarif_file = None
if os.path.isdir(reports_dir):
    for filename in os.listdir(reports_dir):
        if filename.endswith(".sarif") or filename.endswith(".sarif.json"):
            sarif_file = os.path.join(reports_dir, filename)
            break

checks["sarif_file_exists"] = {"pass": sarif_file is not None, "value": sarif_file or "not found"}

if sarif_file:
    try:
        sarif = json.load(open(sarif_file, encoding="utf-8"))
        checks["sarif_version"] = {"pass": sarif.get("version") == "2.1.0", "value": sarif.get("version")}

        if HAS_JSONSCHEMA and os.path.exists(schema_file):
            schema = json.load(open(schema_file, encoding="utf-8"))
            try:
                jsonschema.validate(sarif, schema)
                checks["schema_valid"] = {"pass": True, "value": "valid"}
            except jsonschema.ValidationError as exc:
                checks["schema_valid"] = {"pass": False, "value": str(exc.message)[:100]}
        else:
            checks["schema_valid"] = {"pass": True, "value": "skipped (no jsonschema)"}

        rules = sarif.get("runs", [{}])[0].get("tool", {}).get("driver", {}).get("rules", [])
        rule_ids = {rule.get("id") for rule in rules}
        checks["rule_count"] = {"pass": len(rules) >= 40, "value": len(rules)}

        if os.path.exists(evidence_file):
            evidence = json.load(open(evidence_file, encoding="utf-8"))
            evidence_ids = set(evidence.get("checks", {}).keys())
            overlap = rule_ids & evidence_ids
            overlap_pct = len(overlap) / max(len(evidence_ids), 1)
            checks["rule_ids_match"] = {
                "pass": overlap_pct >= 0.8,
                "value": f"{len(overlap)}/{len(evidence_ids)} ({overlap_pct:.0%})",
            }

    except json.JSONDecodeError as exc:
        checks["sarif_parseable"] = {"pass": False, "value": str(exc)}

with open(result_file, "w", encoding="utf-8") as f:
    json.dump({"checks": checks}, f, indent=2)
print("SARIF checks:", {k: v["pass"] for k, v in checks.items()})
PY
    ;;

  report-jsonl)
    python3 - "$result_file" "$OUTPUT_PATH/scanner.jsonl" <<'PY'
import json
import os
import sys

result_file, scanner_jsonl = sys.argv[1:3]
checks = {}
required_fields = ["check_id", "dimension", "score", "detail"]

lines = []
parse_errors = []
if os.path.exists(scanner_jsonl):
    for i, line in enumerate(open(scanner_jsonl, encoding="utf-8", errors="replace")):
        line = line.strip()
        if not line:
            continue
        try:
            lines.append(json.loads(line))
        except json.JSONDecodeError as exc:
            parse_errors.append(f"line {i}: {exc}")

checks["all_lines_parse"] = {
    "pass": len(parse_errors) == 0,
    "value": f"{len(parse_errors)} errors out of {len(lines) + len(parse_errors)} lines",
}
checks["has_data"] = {"pass": len(lines) > 0, "value": f"{len(lines)} checks emitted"}

bad_scores = [
    (record.get("check_id", "?"), record.get("score"))
    for record in lines
    if not (0 <= float(record.get("score", 0.5)) <= 1)
]
checks["scores_in_range"] = {
    "pass": len(bad_scores) == 0,
    "value": str(bad_scores[:3]) if bad_scores else "all ok",
}

for field in required_fields:
    missing = [record.get("check_id", "?") for record in lines if field not in record]
    checks[f"has_{field}"] = {"pass": len(missing) == 0, "value": str(missing[:3]) if missing else "all ok"}

with open(result_file, "w", encoding="utf-8") as f:
    json.dump({"checks": checks, "data": {"line_count": len(lines)}}, f, indent=2)
print("JSONL checks:", {k: v["pass"] for k, v in checks.items()})
PY
    ;;

  fail-below-gate)
    set +e
    bash /tmp/agentlint-src/src/scanner.sh --project-dir "$REPO_PATH" 2>/dev/null \
      | node /tmp/agentlint-src/src/scorer.js >"$scored_file" 2>/dev/null
    node /tmp/agentlint-src/src/reporter.js "$scored_file" --fail-below 99 2>/dev/null
    exit_high=$?

    bash /tmp/agentlint-src/src/scanner.sh --project-dir "$REPO_PATH" 2>/dev/null \
      | node /tmp/agentlint-src/src/scorer.js >"$scored_file" 2>/dev/null
    node /tmp/agentlint-src/src/reporter.js "$scored_file" --fail-below 0 2>/dev/null
    exit_zero=$?
    set -e

    python3 - "$result_file" "$exit_high" "$exit_zero" <<'PY'
import json
import sys

result_file, exit_high, exit_zero = sys.argv[1:4]
checks = {
    "high_threshold_exits_1": {"pass": int(exit_high) == 1, "value": int(exit_high)},
    "zero_threshold_exits_0": {"pass": int(exit_zero) == 0, "value": int(exit_zero)},
}
with open(result_file, "w", encoding="utf-8") as f:
    json.dump({"checks": checks}, f, indent=2)
print("Gate checks:", {k: v["pass"] for k, v in checks.items()})
PY
    ;;

  *)
    echo "[error] Unknown reports scenario type: $SCENARIO_TYPE" >&2
    echo '{"checks": {}, "error": "unknown scenario type"}' >"$result_file"
    exit 1
    ;;
esac

echo "[reports-run] Done."
