#!/usr/bin/env python3
"""Generate Markdown summary from E2B test results."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path


STATUS_EMOJI = {
    "PASS": "✅",
    "PARTIAL": "⚠️",
    "FAIL": "❌",
    "ERROR": "🔴",
    "SKIP": "⏭️",
}

LAYER_ORDER = ["install", "accuracy", "fix", "reports"]


def load_results(run_dir: Path) -> list[dict]:
    """Load all scenario JSON files from all run subdirs."""
    results = []
    for json_file in sorted(run_dir.rglob("*.json")):
        if json_file.name in ("SUMMARY.json",) or json_file.name.startswith("REPORT"):
            continue
        try:
            data = json.loads(json_file.read_text())
            if "id" in data and "overall" in data:
                results.append(data)
        except Exception:
            continue
    return results


def load_summary(run_dir: Path) -> dict:
    """Load SUMMARY.json from most recent run subdir."""
    summaries = sorted(run_dir.rglob("SUMMARY.json"))
    if not summaries:
        return {}
    try:
        return json.loads(summaries[-1].read_text())
    except Exception:
        return {}


def generate_report(results: list[dict], summary: dict) -> str:
    """Generate Markdown report."""
    lines = []
    lines.append("# AgentLint E2B Comprehensive Test Results")
    lines.append(f"\n_Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}_\n")

    counts = summary.get("counts", {})
    total = summary.get("n", len(results))
    pass_rate = summary.get("pass_rate", "?")
    lines.append("## Summary\n")
    lines.append("| Total | Pass | Partial | Fail | Error | Pass Rate |")
    lines.append("|-------|------|---------|------|-------|-----------|")
    lines.append(
        f"| {total} "
        f"| {counts.get('PASS', 0)} "
        f"| {counts.get('PARTIAL', 0)} "
        f"| {counts.get('FAIL', 0)} "
        f"| {counts.get('ERROR', 0)} "
        f"| {pass_rate} |"
    )
    lines.append("")

    by_layer: dict[str, list[dict]] = {}
    for r in results:
        layer = r.get("layer", "unknown")
        by_layer.setdefault(layer, []).append(r)

    for layer in LAYER_ORDER:
        layer_results = by_layer.get(layer, [])
        if not layer_results:
            continue

        layer_pass = sum(1 for r in layer_results if r.get("overall") == "PASS")
        lines.append(f"## Layer: {layer.capitalize()} ({layer_pass}/{len(layer_results)} passed)\n")
        lines.append("| Slot | ID | Status | Wall | Key Findings |")
        lines.append("|------|----|--------|------|--------------|")

        for r in sorted(layer_results, key=lambda x: x.get("id", "")):
            overall = r.get("overall", "ERROR")
            emoji = STATUS_EMOJI.get(overall, "❓")
            wall = r.get("wall_seconds", 0)

            checks = r.get("checks", {})
            failed = [name for name, v in checks.items() if not v.get("pass")]
            findings = ", ".join(failed[:3]) if failed else "all pass"
            if len(failed) > 3:
                findings += f" (+{len(failed) - 3} more)"

            lines.append(
                f"| - | {r.get('id', '?')} | {emoji} {overall} | {wall:.1f}s | {findings} |"
            )
        lines.append("")

    failures = [r for r in results if r.get("overall") in ("FAIL", "ERROR", "PARTIAL")]
    if failures:
        lines.append("## Failures Detail\n")
        for r in failures:
            lines.append(f"### {r.get('id', '?')} — {r.get('overall', 'ERROR')}\n")
            checks = r.get("checks", {})
            failed_checks = [(k, v) for k, v in checks.items() if not v.get("pass")]
            if failed_checks:
                for name, check in failed_checks[:10]:
                    lines.append(
                        f"- **{name}**: value=`{check.get('value')}` "
                        f"expected=`{check.get('expected', 'pass')}`"
                    )
            if r.get("stderr"):
                lines.append(f"\n```\n{r['stderr'][:500]}\n```")
            lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate E2B test results report")
    parser.add_argument(
        "--run-dir",
        default="tests/e2b/results",
        help="Directory containing result JSON files",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output path for Markdown report (default: stdout)",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run self-test with fixture data",
    )
    args = parser.parse_args()

    if args.self_test:
        fixture_results = [
            {
                "id": "S01-install-node20",
                "layer": "install",
                "overall": "PASS",
                "wall_seconds": 45.2,
                "checks": {"version_present": {"pass": True, "value": "0.9.1"}},
            },
            {
                "id": "S06-check-empty-repo",
                "layer": "accuracy",
                "overall": "FAIL",
                "wall_seconds": 30.1,
                "checks": {"check_F1": {"pass": False, "value": 1.0, "expected": "[0,0]"}},
            },
        ]
        fixture_summary = {"n": 2, "counts": {"PASS": 1, "FAIL": 1}, "pass_rate": "50.0%"}
        report = generate_report(fixture_results, fixture_summary)
        assert "AgentLint E2B" in report
        assert "PASS" in report
        assert "FAIL" in report
        print("Self-test: PASS")
        sys.exit(0)

    run_dir = Path(args.run_dir)
    results = load_results(run_dir)
    summary = load_summary(run_dir)

    if not results and not summary:
        print("No results found. Did the orchestrator run?", file=sys.stderr)
        sys.exit(1)

    report = generate_report(results, summary)

    if args.output:
        Path(args.output).write_text(report)
        print(f"Report written to: {args.output}")
    else:
        print(report)


if __name__ == "__main__":
    main()
