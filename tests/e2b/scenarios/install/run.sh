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

  *)
    echo "[error] Unknown install scenario type: $SCENARIO_TYPE" >&2
    echo '{"checks": {}, "error": "unknown scenario type"}' >"$result_file"
    exit 1
    ;;
esac

echo "[run] Done. Result: $result_file"
