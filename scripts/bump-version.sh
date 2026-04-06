#!/bin/bash
# Bump version across all files that contain it.
# Usage: scripts/bump-version.sh [version]
#   No args: auto-bump patch (0.1.4 → 0.1.5)
#   With arg: set to that version (e.g., scripts/bump-version.sh 0.2.0)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ROOT

PLUGIN="$ROOT/.claude-plugin/plugin.json"
MARKETPLACE="$ROOT/.claude-plugin/marketplace.json"
PACKAGE="$ROOT/package.json"
NPM_PACKAGE="$ROOT/npm/package.json"
SECURITY="$ROOT/SECURITY.md"
README="$ROOT/README.md"

current=$(python3 -c "import json; print(json.load(open('$PLUGIN'))['version'])")
echo "Current version: $current"

if [ "${1:-}" != "" ]; then
  new="$1"
else
  # Auto-bump patch
  IFS='.' read -r major minor patch <<< "$current"
  new="${major}.${minor}.$((patch + 1))"
fi

echo "New version: $new"

# ── 1. Update JSON files ─────────────────────────────────────────

PLUGIN="$PLUGIN" PACKAGE="$PACKAGE" NPM_PACKAGE="$NPM_PACKAGE" MARKETPLACE="$MARKETPLACE" NEW_VERSION="$new" python3 -c "
import json, os

nv = os.environ['NEW_VERSION']
for p in [os.environ['PLUGIN'], os.environ['PACKAGE'], os.environ['NPM_PACKAGE']]:
    with open(p) as f:
        data = json.load(f)
    data['version'] = nv
    with open(p, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

mp = os.environ['MARKETPLACE']
with open(mp) as f:
    data = json.load(f)
data['metadata']['version'] = nv
for plugin in data.get('plugins', []):
    plugin['version'] = nv
with open(mp, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"

# ── 2. Update SECURITY.md supported versions ─────────────────────

new_major_minor="${new%.*}"
current_major_minor="${current%.*}"

python3 << PYEOF
import re

new_mm = "$new_major_minor"
current_mm = "$current_major_minor"
security_path = "$SECURITY"

with open(security_path) as f:
    content = f.read()

if f"| {new_mm}.x" not in content:
    lines = content.split("\n")
    new_lines = []
    table_started = False
    header_done = False

    for line in lines:
        if line.startswith("| Version"):
            table_started = True
            new_lines.append(line)
            continue
        if table_started and line.startswith("|---"):
            header_done = True
            new_lines.append(line)
            new_lines.append(f"| {new_mm}.x   | Yes       |")
            continue
        if table_started and header_done and line.startswith("|"):
            match = re.match(r"\|\s*([\d.]+\.x|< [\d.]+)\s*\|", line)
            if match:
                ver = match.group(1)
                if ver == f"{current_mm}.x":
                    new_lines.append(f"| {current_mm}.x   | Yes       |")
                elif ver.startswith("<"):
                    new_lines.append(f"| < {current_mm}   | No        |")
                else:
                    continue
            else:
                new_lines.append(line)
            continue
        new_lines.append(line)

    with open(security_path, "w") as f:
        f.write("\n".join(new_lines))
    print(f"  SECURITY.md: added {new_mm}.x")
else:
    print(f"  SECURITY.md: {new_mm}.x already present")
PYEOF

# ── 3. Regenerate metadata + update README badge ─────────────────

bash "$ROOT/scripts/generate-metadata.sh"
check_count=$(python3 -c "import json; print(json.load(open('$ROOT/release-metadata.json'))['check_count'])")

sed -i '' "s|checks-[0-9]*-|checks-${check_count}-|g" "$README"
sed -i '' "s|[0-9]* checks, every one backed|${check_count} checks, every one backed|" "$README"
echo "  README.md: badge → checks-${check_count}"

# ── 4. Summary ────────────────────────────────────────────────────

echo ""
echo "Updated:"
echo "  $PLUGIN → $new"
echo "  $MARKETPLACE → $new"
echo "  $PACKAGE → $new"
echo "  $NPM_PACKAGE → $new"
echo "  $SECURITY → supported versions"
echo "  $README → badge + check count"
echo "  $ROOT/release-metadata.json → regenerated"
echo ""
echo "Next steps:"
echo "  1. Update CHANGELOG.md with release notes"
echo "  2. git add -A && git commit -m \"chore: bump version to $new\""
echo "  3. git tag v$new"
echo "  4. git push && git push --tags"
echo ""
echo "After tag push, release.yml will automatically:"
echo "  - Create GitHub Release + publish to npm"
echo "  - Sync docs to AgentLint repo (docs.agentlint.app)"
echo "  - Sync metadata to website repo (www.agentlint.app)"
