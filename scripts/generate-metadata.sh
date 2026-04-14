#!/bin/bash
# Generate release-metadata.json from weights.json and plugin.json.
# This is the single source of truth for version, check counts, and dimension data.
# Usage: scripts/generate-metadata.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ROOT
WEIGHTS="$ROOT/standards/weights.json"

if [ ! -f "$WEIGHTS" ]; then
  echo "Error: $WEIGHTS not found" >&2
  exit 1
fi

python3 << 'PYEOF'
import json, os, re
from collections import defaultdict

root = os.environ["ROOT"]
weights = json.load(open(os.path.join(root, "standards/weights.json")))
plugin = json.load(open(os.path.join(root, ".claude-plugin/plugin.json")))

prefix_to_dimension = {
    "F": "findability",
    "I": "instructions",
    "W": "workability",
    "C": "continuity",
    "S": "safety",
    "H": "harness",
}

display_names = {
    "findability": "Findability",
    "instructions": "Instructions",
    "workability": "Workability",
    "continuity": "Continuity",
    "safety": "Safety",
    "harness": "Harness",
}

# Group checks by dimension
dim_checks = defaultdict(list)
for check_id in weights["check_weights"]:
    prefix = re.match(r"[A-Z]+", check_id).group()
    dim = prefix_to_dimension[prefix]
    dim_checks[dim].append(check_id)

# Sort checks naturally (F1, F2, ... F10, not F1, F10, F2)
for dim in dim_checks:
    dim_checks[dim].sort(key=lambda x: (re.match(r"[A-Z]+", x).group(), int(re.search(r"\d+", x).group())))

# Build dimensions array in display order
dim_order = ["findability", "instructions", "workability", "continuity", "safety", "harness"]
dimensions = []
for dim_id in dim_order:
    checks = dim_checks[dim_id]
    dimensions.append({
        "name": display_names[dim_id],
        "id": dim_id,
        "checks": checks,
        "count": len(checks),
    })

total = sum(d["count"] for d in dimensions)

metadata = {
    "version": plugin["version"],
    "check_count": total,
    "dimensions": dimensions,
    "stats": {
        "prompt_versions_analyzed": 265,
        "papers_referenced": 6,
    },
}

output_path = os.path.join(root, "release-metadata.json")
with open(output_path, "w") as f:
    json.dump(metadata, f, indent=2)
    f.write("\n")

print(f"Generated {output_path}")
print(f"  version: {metadata['version']}")
parts = ", ".join(d["name"] + "=" + str(d["count"]) for d in dimensions)
print(f"  checks:  {total} ({parts})")
PYEOF
