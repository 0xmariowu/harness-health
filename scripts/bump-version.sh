#!/bin/bash
# Bump version across all files that contain it.
# Usage: scripts/bump-version.sh [version]
#   No args: auto-bump patch (0.1.4 → 0.1.5)
#   With arg: set to that version (e.g., scripts/bump-version.sh 0.2.0)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT/.claude-plugin/plugin.json"
MARKETPLACE="$ROOT/.claude-plugin/marketplace.json"
PACKAGE="$ROOT/package.json"
NPM_PACKAGE="$ROOT/npm/package.json"

current=$(PLUGIN="$PLUGIN" python3 -c "import json, os; print(json.load(open(os.environ['PLUGIN']))['version'])")
echo "Current version: $current"

if [ "${1:-}" != "" ]; then
  new="$1"
else
  # Auto-bump patch
  IFS='.' read -r major minor patch <<< "$current"
  new="${major}.${minor}.$((patch + 1))"
fi

echo "New version: $new"

# Update all three files
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

echo ""
echo "Updated:"
echo "  $PLUGIN → $new"
echo "  $MARKETPLACE → $new"
echo "  $PACKAGE → $new"
echo "  $NPM_PACKAGE → $new"
echo ""
echo "Next steps:"
echo "  1. Update CHANGELOG.md with release notes"
echo "  2. git add .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json npm/package.json CHANGELOG.md"
echo "  3. git commit -m \"chore: bump version to $new\""
echo "  4. git tag v$new"
echo "  5. git push && git push --tags"
