#!/usr/bin/env python3
"""Verify fix scenario results."""
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
            errors.append(f"FAIL {name}: {check.get('value')} (expected pass)")
    return len(errors) == 0, errors


def main() -> None:
    if "--self-test" in sys.argv:
        fixture = {
            "id": "S13-fix-w11",
            "checks": {
                "fix_produced_output": {"pass": True, "value": "200 chars"},
                "file_created": {"pass": True, "value": ".github/workflows/test-required.yml"},
                "is_valid_yaml": {"pass": True, "value": "valid"},
                "has_exit_1": {"pass": True, "value": "found"},
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
