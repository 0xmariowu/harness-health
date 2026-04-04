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

# Update all three files
python3 -c "
import json

for path in ['$PLUGIN', '$PACKAGE']:
    with open(path) as f:
        data = json.load(f)
    data['version'] = '$new'
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

with open('$MARKETPLACE') as f:
    data = json.load(f)
data['metadata']['version'] = '$new'
for plugin in data.get('plugins', []):
    plugin['version'] = '$new'
with open('$MARKETPLACE', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"

echo ""
echo "Updated:"
echo "  $PLUGIN → $new"
echo "  $MARKETPLACE → $new"
echo "  $PACKAGE → $new"
echo ""
echo "Next steps:"
echo "  1. Update CHANGELOG.md with release notes"
echo "  2. git add .claude-plugin/plugin.json .claude-plugin/marketplace.json package.json CHANGELOG.md"
echo "  3. git commit -m \"chore: bump version to $new\""
echo "  4. git tag v$new"
echo "  5. git push && git push --tags"
