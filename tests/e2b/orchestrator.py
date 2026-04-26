#!/usr/bin/env python3
"""AgentLint E2B Comprehensive Test Orchestrator."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from e2b import Sandbox
    E2B_AVAILABLE = True
except ImportError:
    E2B_AVAILABLE = False

ROOT = Path(__file__).resolve().parent.parent.parent  # agent-lint root
SCENARIOS_DIR = Path(__file__).resolve().parent / "scenarios"
RESULTS_DIR = Path(__file__).resolve().parent / "results"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

_TARBALL_LOCK = threading.Lock()
_tarball_cache: dict[str, bytes] = {}

LAYER_ORDER = ["install", "accuracy", "fix", "reports"]


def load_scenarios(layer: str) -> list[dict]:
    """Load scenario specs for a given layer."""
    specs_path = SCENARIOS_DIR / layer / "specs.json"
    if not specs_path.exists():
        raise FileNotFoundError(f"No specs found: {specs_path}")
    data = json.loads(specs_path.read_text())
    return data["scenarios"]


def build_agentlint_tarball() -> bytes:
    """Build a tarball of the agentlint source tree (cached per process)."""
    cache_key = "agentlint"
    with _TARBALL_LOCK:
        if cache_key in _tarball_cache:
            return _tarball_cache[cache_key]
        
        EXCLUDE = {".git", "node_modules", "tests/e2b/results", "__pycache__", ".cache"}
        buf = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
        buf.close()
        
        # Use git archive to get all tracked files (includes src/, templates/, standards/, scripts/)
        # This is correct for E2B testing where we need the full source tree.
        archive_result = subprocess.run(
            ["git", "archive", "--format=tar.gz", "HEAD", "-o", buf.name],
            cwd=str(ROOT),
            capture_output=True,
        )
        if archive_result.returncode == 0:
            data = Path(buf.name).read_bytes()
            os.unlink(buf.name)
            _tarball_cache[cache_key] = data
            return data

        # Fallback: manual tar excluding large directories
        with tarfile.open(buf.name, "w:gz") as tar:
            for item in sorted(ROOT.rglob("*")):
                rel = item.relative_to(ROOT)
                if any(part in EXCLUDE for part in rel.parts):
                    continue
                if item.is_file():
                    tar.add(item, arcname=str(rel))
        
        data = Path(buf.name).read_bytes()
        os.unlink(buf.name)
        _tarball_cache[cache_key] = data
        return data


def run_one(spec: dict, tarball_bytes: bytes, run_dir: Path, dry_run: bool = False, from_npm: str = "", from_npx: str = "") -> dict:
    """Run a single scenario in an E2B sandbox. Returns result dict."""
    scenario_id = spec["id"]
    layer = spec["layer"]
    timeout = spec.get("timeout", 300)
    result: dict[str, Any] = {
        "id": scenario_id,
        "layer": layer,
        "overall": "ERROR",
        "spec": spec,
        "checks": {},
        "stdout": "",
        "stderr": "",
        "exit_code": -1,
        "wall_seconds": 0.0,
    }
    
    t_start = time.time()
    
    if dry_run:
        result["overall"] = "SKIP"
        result["wall_seconds"] = 0.0
        _save_result(run_dir, scenario_id, result)
        return result
    
    if not E2B_AVAILABLE:
        result["overall"] = "ERROR"
        result["stderr"] = "e2b package not installed. Run: pip install e2b"
        _save_result(run_dir, scenario_id, result)
        return result
    
    if not os.environ.get("E2B_API_KEY"):
        result["overall"] = "ERROR"
        result["stderr"] = "E2B_API_KEY not set"
        _save_result(run_dir, scenario_id, result)
        return result

    try:
        # E2B SDK v2: use Sandbox.create() — picks up E2B_API_KEY from env
        with Sandbox.create(timeout=timeout + 60) as sbx:
            # Upload agentlint source (skip in npm/npx-mode — install from registry instead)
            if not from_npm and not from_npx:
                sbx.files.write("/tmp/agentlint.tar.gz", tarball_bytes)
            
            # Set env vars from spec
            envs: dict[str, str] = {
                "NODE_VERSION": spec.get("node_version", "20"),
                "SCENARIO_ID": scenario_id,
                "SCENARIO_TYPE": spec.get("scenario_type", layer),
                "OUTPUT_PATH": "/tmp/scenario-output",
            }
            if from_npx:
                envs["FROM_NPX"] = from_npx
            elif from_npm:
                envs["FROM_NPM"] = from_npm
            if "repo_name" in spec:
                envs["REPO_NAME"] = spec["repo_name"]
            if "expected_checks" in spec:
                envs["EXPECTED_CHECKS"] = json.dumps(spec["expected_checks"])
            if "expected_total_score" in spec:
                envs["EXPECTED_SCORE"] = json.dumps(spec["expected_total_score"])
            if "corpus_repos" in spec:
                envs["CORPUS_REPOS"] = json.dumps(spec["corpus_repos"])
            envs.update(spec.get("env", {}))
            
            # Helper: run command, never raise on non-zero exit
            def sh(cmd: str, t: int = 60) -> tuple[int, str, str]:
                try:
                    r = sbx.commands.run(cmd + " || true", timeout=t, envs=envs)
                    return r.exit_code, r.stdout or "", r.stderr or ""
                except Exception as exc:
                    return -1, "", str(exc)

            # Bootstrap sandbox
            setup_script = (Path(__file__).parent / "sandbox_setup.sh").read_text()
            sbx.files.write("/tmp/sandbox_setup.sh", setup_script.encode())
            code, out, err = sh("bash /tmp/sandbox_setup.sh", t=180)
            if code not in (0, None) and "error" in err.lower() and "agentlint" not in out.lower():
                result["overall"] = "ERROR"
                result["stderr"] = f"Setup failed (exit {code}):\n{err[:500]}"
                result["wall_seconds"] = time.time() - t_start
                _save_result(run_dir, scenario_id, result)
                return result

            # Upload synthetic fixtures if needed
            if spec.get("use_synthetic"):
                _upload_synthetic_fixtures(sbx, spec)

            # Run scenario script
            run_script_path = SCENARIOS_DIR / layer / "run.sh"
            if run_script_path.exists():
                sbx.files.write("/tmp/scenario_run.sh", run_script_path.read_bytes())
                code2, out2, err2 = sh("bash /tmp/scenario_run.sh", t=timeout)
                result["stdout"] = out2
                result["stderr"] = err2
                result["exit_code"] = code2
            
            # Collect output
            try:
                raw_output = sbx.files.read("/tmp/scenario-output/result.json")
                scenario_result = json.loads(raw_output)
                result["checks"] = scenario_result.get("checks", {})
                result["data"] = scenario_result.get("data", {})
            except Exception:
                result["checks"] = {}
            
            # Determine overall
            result["overall"] = _determine_overall(result, spec)
    
    except Exception as exc:
        result["overall"] = "ERROR"
        result["stderr"] = str(exc)
    
    result["wall_seconds"] = round(time.time() - t_start, 2)
    _save_result(run_dir, scenario_id, result)
    return result


def _upload_synthetic_fixtures(sbx: Any, spec: dict) -> None:
    """Upload synthetic test repos to sandbox if needed."""
    fixtures_dir = FIXTURES_DIR
    create_script = fixtures_dir / "create_synthetic.sh"
    if create_script.exists():
        sbx.files.write("/tmp/create_synthetic.sh", create_script.read_bytes())
        sbx.commands.run("bash /tmp/create_synthetic.sh /tmp/synthetic-repos", timeout=60)


def _determine_overall(result: dict, spec: dict) -> str:
    """Determine PASS/PARTIAL/FAIL/ERROR from checks."""
    if result["exit_code"] == -1:
        return "ERROR"
    checks = result.get("checks", {})
    if not checks:
        return "FAIL" if result["exit_code"] != 0 else "PASS"
    
    passed = sum(1 for v in checks.values() if v.get("pass"))
    total = len(checks)
    if passed == total:
        return "PASS"
    elif passed >= total * 0.8:
        return "PARTIAL"
    return "FAIL"


def _save_result(run_dir: Path, scenario_id: str, result: dict) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / f"{scenario_id}.json").write_text(json.dumps(result, indent=2))


def summarize(r: dict) -> str:
    wall = r.get("wall_seconds", 0)
    checks = r.get("checks", {})
    passed = sum(1 for v in checks.values() if v.get("pass")) if checks else "?"
    total = len(checks) if checks else "?"
    return f"[{r['overall']:8s}] {r['id']} wall={wall:.1f}s checks={passed}/{total}"


def generate_summary(run_dir: Path, results: list[dict]) -> dict:
    counts: dict[str, int] = {}
    for r in results:
        counts[r["overall"]] = counts.get(r["overall"], 0) + 1
    
    summary = {
        "run_id": run_dir.name,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "n": len(results),
        "elapsed_seconds": round(sum(r.get("wall_seconds", 0) for r in results), 1),
        "counts": counts,
        "pass_rate": f"{counts.get('PASS', 0) / max(len(results), 1) * 100:.1f}%",
        "results": [
            {"id": r["id"], "layer": r["layer"], "overall": r["overall"], "wall": r.get("wall_seconds", 0)}
            for r in sorted(results, key=lambda x: (x["layer"], x["id"]))
        ],
    }
    (run_dir / "SUMMARY.json").write_text(json.dumps(summary, indent=2))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="AgentLint E2B Comprehensive Test Orchestrator")
    parser.add_argument("--layer", default="all", choices=["all"] + LAYER_ORDER,
                        help="Which test layer to run (default: all)")
    parser.add_argument("--concurrency", type=int, default=20,
                        help="Max parallel E2B sandboxes (default: 20, E2B limit)")
    parser.add_argument("--run-id", default=None,
                        help="Run identifier (default: YYYY-MM-DD-{layer})")
    parser.add_argument("--limit", type=int, default=None,
                        help="Run only first N scenarios per layer")
    parser.add_argument("--dry-run", action="store_true",
                        help="Skip sandbox creation, just list scenarios")
    parser.add_argument("--e2b-api-key", default=None,
                        help="E2B API key (default: $E2B_API_KEY)")
    parser.add_argument("--from-npm", default=None, metavar="PACKAGE",
                        help="Install from npm registry instead of local tarball (e.g. agentlint-ai)")
    parser.add_argument("--from-npx", default=None, metavar="PACKAGE",
                        help="Test npx init flow: run 'npx PACKAGE', capture output, then install -g (e.g. agentlint-ai)")
    parser.add_argument("--allow-partial", action="store_true",
                        help="Exit 0 on PARTIAL outcomes (soft-pass). Default treats PARTIAL "
                             "as failure; only set this for exploratory / scheduled runs where "
                             "degraded success is expected.")
    args = parser.parse_args()
    
    if args.e2b_api_key:
        os.environ["E2B_API_KEY"] = args.e2b_api_key
    
    layers = LAYER_ORDER if args.layer == "all" else [args.layer]
    if args.from_npx:
        pkg_suffix = f"-npx-{args.from_npx.replace('/', '-')}"
    elif args.from_npm:
        pkg_suffix = f"-npm-{args.from_npm.replace('/', '-')}"
    else:
        pkg_suffix = ""
    run_id = args.run_id or f"{datetime.utcnow().strftime('%Y-%m-%d')}-{args.layer}{pkg_suffix}"
    run_dir = RESULTS_DIR / run_id
    
    # Collect all scenarios
    all_scenarios: list[dict] = []
    for layer in layers:
        try:
            scenarios = load_scenarios(layer)
            if args.limit:
                scenarios = scenarios[:args.limit]
            all_scenarios.extend(scenarios)
        except FileNotFoundError as e:
            print(f"[warn] {e}", file=sys.stderr)
    
    # Filter: npx-init scenarios only run in npx-mode; skip them otherwise.
    # Surface the skip count so a 21-of-23 result doesn't look like
    # something silently disappeared.
    total_loaded = len(all_scenarios)
    if args.from_npx:
        kept = [s for s in all_scenarios if s.get("scenario_type") == "npx-init"]
        skipped_kind = "non-npx scenarios in npx-mode"
    else:
        kept = [s for s in all_scenarios if s.get("scenario_type") != "npx-init"]
        skipped_kind = "npx-only scenarios in npm/tarball-mode"
    skipped_count = total_loaded - len(kept)
    all_scenarios = kept

    if skipped_count > 0:
        print(f"[orchestrator] Loaded {total_loaded} scenarios; skipping {skipped_count} {skipped_kind} (running {len(all_scenarios)})")

    if not all_scenarios:
        print("No scenarios found.", file=sys.stderr)
        sys.exit(1)

    print(f"Run ID: {run_id}")
    print(f"Scenarios: {len(all_scenarios)} across layers: {layers}")
    print(f"Concurrency: {args.concurrency}")
    if args.dry_run:
        print("[dry-run] Listing scenarios:")
        for s in all_scenarios:
            print(f"  {s['id']} ({s['layer']})")
        sys.exit(0)
    
    # Build tarball (skip in npm/npx-mode)
    from_npm = args.from_npm or ""
    from_npx = args.from_npx or ""
    if from_npx:
        print(f"[orchestrator] npx-mode: will run 'npx {from_npx}' and capture output in each sandbox")
        tarball_bytes = b""
    elif from_npm:
        print(f"[orchestrator] npm-mode: will install {from_npm!r} from registry in each sandbox")
        tarball_bytes = b""
    else:
        print("[orchestrator] Building agentlint tarball...")
        tarball_bytes = build_agentlint_tarball()
        print(f"[orchestrator] Tarball: {len(tarball_bytes):,} bytes")

    # Run in parallel
    results: list[dict] = []
    t_start = time.time()

    with ThreadPoolExecutor(max_workers=min(args.concurrency, len(all_scenarios))) as executor:
        futures = {
            executor.submit(run_one, spec, tarball_bytes, run_dir, args.dry_run, from_npm, from_npx): spec
            for spec in all_scenarios
        }
        for future in as_completed(futures):
            try:
                result = future.result()
            except Exception as exc:
                spec = futures[future]
                result = {"id": spec["id"], "layer": spec["layer"], "overall": "ERROR",
                          "stderr": str(exc), "wall_seconds": 0.0, "checks": {}}
                _save_result(run_dir, spec["id"], result)
            results.append(result)
            print(summarize(result))
    
    # Generate summary
    summary = generate_summary(run_dir, results)
    elapsed = time.time() - t_start
    
    print(f"\n{'='*60}")
    print(f"Run complete: {run_id}")
    print(f"Elapsed: {elapsed:.1f}s | Scenarios: {summary['n']} | Pass rate: {summary['pass_rate']}")
    print(f"Counts: {summary['counts']}")
    print(f"Results: {run_dir}/SUMMARY.json")
    print(f"{'='*60}")
    
    # Exit 1 on any FAIL, ERROR, or PARTIAL by default. PARTIAL means a
    # scenario passed some but not all of its checks — for release gates
    # that's a regression, not a soft warning. Use --allow-partial to
    # opt into the old soft-pass behavior for exploratory runs.
    counts = summary["counts"]
    fail_count = counts.get("FAIL", 0) + counts.get("ERROR", 0)
    partial_count = counts.get("PARTIAL", 0)
    if not args.allow_partial:
        fail_count += partial_count
    elif partial_count > 0:
        print(f"Note: {partial_count} PARTIAL outcome(s) tolerated via --allow-partial")
    sys.exit(1 if fail_count > 0 else 0)


if __name__ == "__main__":
    main()
