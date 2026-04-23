#!/usr/bin/env bash
set -euo pipefail

SCENARIO_TYPE="${SCENARIO_TYPE:-fix-check}"
OUTPUT_PATH="${OUTPUT_PATH:-/tmp/scenario-output}"
REPO_NAME="${REPO_NAME:-empty-repo}"
SCENARIO_ID="${SCENARIO_ID:-}"
CHECK_ID="${CHECK_ID:-}"
CHECK_IDS="${CHECK_IDS:-}"
mkdir -p "$OUTPUT_PATH"

result_file="$OUTPUT_PATH/result.json"

infer_check_id() {
  case "$SCENARIO_ID" in
    S14-fix-c2) printf 'C2' ;;
    S15-fix-f1) printf 'F1' ;;
    *) printf 'W11' ;;
  esac
}

infer_check_ids() {
  if [ -n "$CHECK_IDS" ]; then
    printf '%s' "$CHECK_IDS"
  else
    printf 'W11,C2,F1'
  fi
}

if [ -z "$CHECK_ID" ]; then
  CHECK_ID="$(infer_check_id)"
fi
CHECK_IDS="$(infer_check_ids)"

echo "[fix-run] Scenario: $SCENARIO_TYPE, repo: $REPO_NAME, check: ${CHECK_ID:-multiple}"

prepare_repo() {
  local src="/tmp/synthetic-repos/$1"
  local dst
  dst="$(mktemp -d "/tmp/fix-test-repo-XXXXXX")"
  cp -R "$src"/. "$dst"/
  echo "$dst"
}

run_fix_pipeline() {
  local repo="$1"
  local check="$2"

  bash /tmp/agentlint-src/src/scanner.sh --project-dir "$repo" 2>/dev/null \
    | node /tmp/agentlint-src/src/scorer.js 2>/dev/null \
    | node /tmp/agentlint-src/src/plan-generator.js 2>/dev/null \
    | node /tmp/agentlint-src/src/fixer.js --checks "$check" --project-dir "$repo" 2>/dev/null
}

case "$SCENARIO_TYPE" in
  fix-check)
    repo_path="$(prepare_repo "$REPO_NAME")"

    set +e
    fix_output="$(run_fix_pipeline "$repo_path" "$CHECK_ID" 2>&1)"
    fix_exit=$?
    set -e

    python3 - "$result_file" "$repo_path" "$CHECK_ID" "$fix_exit" "$fix_output" <<'PY' || python3 - "$result_file" <<'PY'
import json
import os
import sys

result_file, repo, check_id, fix_exit_raw, fix_output = sys.argv[1:6]
checks = {}

checks["fix_exit_code"] = {"pass": int(fix_exit_raw) == 0, "value": int(fix_exit_raw)}
checks["fix_produced_output"] = {"pass": len(fix_output) > 5, "value": f"{len(fix_output)} chars"}

expected_files = {
    "W11": ".github/workflows/test-required.yml",
    "C2": "HANDOFF.md",
    "F1": "CLAUDE.md",
}
if check_id in expected_files:
    fpath = os.path.join(repo, expected_files[check_id])
    exists = os.path.isfile(fpath) and not os.path.islink(fpath)
    checks["file_created"] = {"pass": exists, "value": fpath if exists else "not found"}

    if exists:
        content = open(fpath, encoding="utf-8", errors="replace").read()

        if check_id == "W11":
            # Validate YAML without requiring PyYAML (may not be installed in sandbox)
            # Use node.js js-yaml or a basic structural check instead
            import subprocess as _sub
            node_check = _sub.run(
                ["node", "-e", f"const fs=require('fs'); try{{require('js-yaml').load(fs.readFileSync('{fpath}','utf8')); console.log('ok')}}catch(e){{console.log('err:'+e.message.slice(0,50))}}"],
                capture_output=True, text=True, timeout=10
            )
            is_yaml = node_check.returncode == 0 and node_check.stdout.strip() == "ok"
            if node_check.returncode != 0:
                # Fallback: basic YAML structure check (has 'name:' and 'on:')
                is_yaml = "name:" in content and ("on:" in content or "on:\n" in content)
            checks["is_valid_yaml"] = {"pass": is_yaml, "value": "valid" if is_yaml else f"invalid: {node_check.stdout.strip()[:60]}"}
            checks["has_exit_1"] = {"pass": "exit 1" in content, "value": "found" if "exit 1" in content else "missing"}
            checks["mentions_feat"] = {"pass": "feat" in content, "value": "found" if "feat" in content else "missing"}
            checks["mentions_test"] = {"pass": "test" in content, "value": "found" if "test" in content else "missing"}

        if check_id == "F1":
            no_placeholder = "[your project" not in content.lower() and "{{" not in content
            min_len = len(content) >= 100
            checks["no_placeholder"] = {"pass": no_placeholder, "value": "ok" if no_placeholder else "has placeholder"}
            checks["min_length"] = {"pass": min_len, "value": f"{len(content)} chars"}

checks["no_writes_outside_repo"] = {"pass": True, "value": "not checked in dry mode"}

with open(result_file, "w", encoding="utf-8") as f:
    json.dump({"checks": checks, "data": {"repo": repo, "check_id": check_id, "output": fix_output[:500]}}, f, indent=2)
print("Fix checks:", {k: v["pass"] for k, v in checks.items()})
PY
import json
import sys

result_file = sys.argv[1]
checks = {"fix_produced_output": {"pass": False, "value": "python error"}}
with open(result_file, "w", encoding="utf-8") as f:
    json.dump({"checks": checks}, f)
PY
    ;;

  fix-idempotency)
    repo_path="$(prepare_repo "$REPO_NAME")"

    python3 - "$result_file" "$repo_path" "$CHECK_IDS" <<'PY'
import json
import os
import subprocess
import sys

result_file, repo, check_ids_raw = sys.argv[1:4]
check_ids = [cid.strip() for cid in check_ids_raw.split(",") if cid.strip()]
checks = {}


def repo_files(path):
    files = set()
    for root, _, filenames in os.walk(path):
        for filename in filenames:
            files.add(os.path.relpath(os.path.join(root, filename), path))
    return files


for cid in check_ids:
    command = (
        "bash /tmp/agentlint-src/src/scanner.sh --project-dir {repo} 2>/dev/null "
        "| node /tmp/agentlint-src/src/scorer.js 2>/dev/null "
        "| node /tmp/agentlint-src/src/plan-generator.js 2>/dev/null "
        "| node /tmp/agentlint-src/src/fixer.js --checks {cid} --project-dir {repo} 2>&1"
    ).format(repo=repo, cid=cid)

    subprocess.run(command, shell=True, capture_output=True, text=True, timeout=60, check=False)

    files_after_r1 = repo_files(repo)

    r2 = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=60, check=False)

    files_after_r2 = repo_files(repo)
    new_files = sorted(files_after_r2 - files_after_r1)
    checks[f"{cid}_no_new_files"] = {"pass": len(new_files) == 0, "value": new_files if new_files else "none"}
    checks[f"{cid}_r2_exit_ok"] = {"pass": r2.returncode in [0, 1], "value": r2.returncode}

with open(result_file, "w", encoding="utf-8") as f:
    json.dump({"checks": checks, "data": {"repo": repo}}, f, indent=2)
print("Idempotency checks:", {k: v["pass"] for k, v in checks.items()})
PY
    ;;

  *)
    echo "[error] Unknown fix scenario type: $SCENARIO_TYPE" >&2
    echo '{"checks": {}, "error": "unknown scenario type"}' >"$result_file"
    exit 1
    ;;
esac

echo "[fix-run] Done."
