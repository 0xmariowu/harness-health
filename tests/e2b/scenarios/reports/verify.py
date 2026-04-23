#!/usr/bin/env python3
"""Verify report quality scenario results."""
import json
import sys
from pathlib import Path


def verify_scenario(result: dict) -> tuple[bool, list[str]]:
    errors = []
    checks = result.get("checks", {})
    if not checks:
        errors.append("No checks recorded")
        return False, errors
    for name, check in checks.items():
        if not check.get("pass"):
            errors.append(f"FAIL {name}: {check.get('value')}")
    return len(errors) == 0, errors


def main() -> None:
    if "--self-test" in sys.argv:
        fixture = {
            "id": "S17-report-html",
            "checks": {
                "html_file_exists": {"pass": True, "value": "/tmp/report.html"},
                "dim_findability": {"pass": True, "value": "found"},
                "score_in_html": {"pass": True, "value": "looking for 72"},
                "valid_html_structure": {"pass": True, "value": "ok"},
            },
        }
        ok, errors = verify_scenario(fixture)
        assert ok, f"Self-test failed: {errors}"
        print("Self-test: PASS")
        sys.exit(0)

    result_file = sys.argv[1] if len(sys.argv) > 1 else "/tmp/scenario-output/result.json"
    result = json.loads(Path(result_file).read_text())
    ok, errors = verify_scenario(result)
    if ok:
        print(f"PASS: {result.get('id', 'unknown')}")
    else:
        print(f"FAIL: {result.get('id', 'unknown')}")
        for err in errors:
            print(f"  {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
