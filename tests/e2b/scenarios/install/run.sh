#!/usr/bin/env bash
set -euo pipefail

SCENARIO_TYPE="${SCENARIO_TYPE:-install}"
OUTPUT_PATH="${OUTPUT_PATH:-/tmp/scenario-output}"
mkdir -p "$OUTPUT_PATH"

result_file="$OUTPUT_PATH/result.json"

echo "[run] Scenario type: $SCENARIO_TYPE"

init_repo() {
  local repo="$1"
  git -C "$repo" init -q
  git -C "$repo" config user.email "test@test.com"
  git -C "$repo" config user.name "Test"
  git -C "$repo" commit --allow-empty -q -m "init"
}

case "$SCENARIO_TYPE" in
  install)
    version_file="$OUTPUT_PATH/version.txt"
    help_file="$OUTPUT_PATH/help.txt"
    check_file="$OUTPUT_PATH/check.txt"

    agentlint --version >"$version_file" 2>/dev/null || true
    agentlint help >"$help_file" 2>&1 || true

    tmp_repo="$(mktemp -d)"
    init_repo "$tmp_repo"
    agentlint check --project-dir "$tmp_repo" >"$check_file" 2>&1 || true
    rm -rf "$tmp_repo"

    python3 - "$result_file" "$version_file" "$help_file" "$check_file" <<'PY'
import json
import re
import sys
from pathlib import Path

result_path, version_path, help_path, check_path = sys.argv[1:5]
version = Path(version_path).read_text(errors="replace").strip()
help_text = Path(help_path).read_text(errors="replace")
check_text = Path(check_path).read_text(errors="replace")

checks = {
    "version_present": {"pass": bool(version), "value": version},
    "version_semver": {"pass": bool(re.match(r"^\d+\.\d+\.\d+", version)), "value": version},
    "help_has_check": {"pass": "check" in help_text.lower(), "value": "ok" if "check" in help_text.lower() else "missing"},
    "help_has_fix": {"pass": "fix" in help_text.lower(), "value": "ok" if "fix" in help_text.lower() else "missing"},
    "help_has_setup": {"pass": "setup" in help_text.lower(), "value": "ok" if "setup" in help_text.lower() else "missing"},
    "check_produces_output": {"pass": len(check_text) > 10, "value": f"{len(check_text)} chars"},
}
Path(result_path).write_text(json.dumps({"checks": checks, "data": {"version": version}}, indent=2))
print("Checks:", {k: v["pass"] for k, v in checks.items()})
PY
    ;;

  setup-ts)
    tmp_repo="$(mktemp -d)"
    init_repo "$tmp_repo"

    agentlint setup --lang ts "$tmp_repo" >"$OUTPUT_PATH/setup-ts.log" 2>&1 || true

    python3 - "$result_file" "$tmp_repo" <<'PY'
import json
import os
import sys
from pathlib import Path

result_path, repo = sys.argv[1:3]
checks = {}
expected_files = [".github/workflows", "CLAUDE.md", "SECURITY.md"]
for filename in expected_files:
    path = os.path.join(repo, filename)
    exists = os.path.exists(path)
    key = f"file_{filename.replace('/', '_').replace('.', '')}"
    checks[key] = {"pass": exists, "value": path if exists else "missing"}

claude_path = Path(repo) / "CLAUDE.md"
if claude_path.exists():
    content = claude_path.read_text(errors="replace")
    has_placeholder = "[your project" in content.lower() or "{{" in content
    checks["no_placeholder"] = {"pass": not has_placeholder, "value": "ok" if not has_placeholder else "has placeholder"}

Path(result_path).write_text(json.dumps({"checks": checks, "data": {"repo": repo}}, indent=2))
print("Checks:", {k: v["pass"] for k, v in checks.items()})
PY
    rm -rf "$tmp_repo"
    ;;

  setup-python)
    tmp_repo="$(mktemp -d)"
    init_repo "$tmp_repo"

    agentlint setup --lang python "$tmp_repo" >"$OUTPUT_PATH/setup-python.log" 2>&1 || true

    python3 - "$result_file" "$tmp_repo" <<'PY'
import json
import os
import sys
from pathlib import Path

result_path, repo = sys.argv[1:3]
checks = {}
expected_files = [".github/workflows", "CLAUDE.md", "SECURITY.md"]
for filename in expected_files:
    path = os.path.join(repo, filename)
    exists = os.path.exists(path)
    key = f"file_{filename.replace('/', '_').replace('.', '')}"
    checks[key] = {"pass": exists, "value": path if exists else "missing"}

claude_path = Path(repo) / "CLAUDE.md"
if claude_path.exists():
    content = claude_path.read_text(errors="replace")
    has_placeholder = "[your project" in content.lower() or "{{" in content
    checks["no_placeholder"] = {"pass": not has_placeholder, "value": "ok" if not has_placeholder else "has placeholder"}

Path(result_path).write_text(json.dumps({"checks": checks, "data": {"repo": repo}}, indent=2))
print("Checks:", {k: v["pass"] for k, v in checks.items()})
PY
    rm -rf "$tmp_repo"
    ;;

  npx-init)
    # Verify npx agentlint-ai init screen output (written by sandbox_setup.sh FROM_NPX mode)
    npx_output_file="/tmp/npx-init-output.txt"
    cp "$npx_output_file" "$OUTPUT_PATH/npx-init.txt" 2>/dev/null || true

    python3 - "$result_file" "$npx_output_file" <<'PY'
import json
import sys
from pathlib import Path

result_path, npx_path = sys.argv[1:3]
output = Path(npx_path).read_text(errors="replace") if Path(npx_path).exists() else ""

checks = {
    "npx_produced_output":  {"pass": len(output) > 50,                                  "value": f"{len(output)} chars"},
    "logo_present":         {"pass": "AGENTLINT" in output or "AgentLint" in output,     "value": "ok" if "AgentLint" in output else "missing"},
    "tagline_present":      {"pass": "linter for your agent harness" in output,          "value": "ok" if "linter for your agent harness" in output else "missing"},
    "version_shown":        {"pass": "v1." in output,                                    "value": "ok" if "v1." in output else "missing"},
    "no_crash":             {"pass": "Error:" not in output and "Traceback" not in output,"value": "ok" if "Error:" not in output else "crashed"},
    "env_detection_ran":    {"pass": "agentlint CLI" in output or "Detecting" in output, "value": "ok" if "Detecting" in output else "missing"},
}
Path(result_path).write_text(json.dumps({"checks": checks, "data": {"output_len": len(output)}}, indent=2))
print("Checks:", {k: v["pass"] for k, v in checks.items()})
PY
    ;;

  *)
    echo "[error] Unknown install scenario type: $SCENARIO_TYPE" >&2
    echo '{"checks": {}, "error": "unknown scenario type"}' >"$result_file"
    exit 1
    ;;
esac

echo "[run] Done. Result: $result_file"
