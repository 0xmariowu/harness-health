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
NPM_README="$ROOT/npm/README.md"
INTRO="$ROOT/docs/content/intro.md"

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

# ── 3. Regenerate metadata + sync check/dimension counts ─────────
#
# The source of truth is release-metadata.json. Every user-facing spot
# that prints these counts is rewritten here. If you add another such
# spot (e.g. a new doc file or landing page), add its sed below AND
# ideally a guard in release.yml Validate content sync, or the count
# will silently drift the next time the content is rephrased.

bash "$ROOT/scripts/generate-metadata.sh"
check_count=$(python3 -c "import json; print(json.load(open('$ROOT/release-metadata.json'))['check_count'])")
dim_count=$(python3 -c "import json; print(len(json.load(open('$ROOT/release-metadata.json'))['dimensions']))")

# README.md — badge + hero tagline "N checks. M dimensions."
sed -i '' "s|checks-[0-9][0-9]*-|checks-${check_count}-|g" "$README"
sed -i '' -E "s|[0-9]+ checks\\. [0-9]+ dimensions\\.|${check_count} checks. ${dim_count} dimensions.|g" "$README"
# Preserve the older prose form in case it gets reintroduced elsewhere.
sed -i '' -E "s|[0-9]+ checks, every one backed|${check_count} checks, every one backed|g" "$README"
echo "  README.md: badge + hero → ${check_count} checks / ${dim_count} dimensions"

# npm/README.md — "N checks. M dimensions. Evidence-backed."
if [ -f "$NPM_README" ]; then
  sed -i '' -E "s|[0-9]+ checks\\. [0-9]+ dimensions\\.|${check_count} checks. ${dim_count} dimensions.|g" "$NPM_README"
  echo "  npm/README.md: hero → ${check_count} checks / ${dim_count} dimensions"
fi

# docs/content/intro.md — GitBook source: "N checks across M dimensions"
if [ -f "$INTRO" ]; then
  sed -i '' -E "s|[0-9]+ checks across [0-9]+ dimensions|${check_count} checks across ${dim_count} dimensions|g" "$INTRO"
  sed -i '' -E "s|[0-9]+ checks\\. [0-9]+ dimensions\\.|${check_count} checks. ${dim_count} dimensions.|g" "$INTRO"
  echo "  docs/content/intro.md: hero → ${check_count} checks / ${dim_count} dimensions"
fi

# ── 4. Sync root docs to docs/content/ (GitBook source) ──────────

cp "$ROOT/CHANGELOG.md" "$ROOT/docs/content/changelog.md"
cp "$ROOT/SECURITY.md" "$ROOT/docs/content/security.md"
cp "$ROOT/CONTRIBUTING.md" "$ROOT/docs/content/contributing.md"
echo "  docs/content/: synced changelog, security, contributing"

# ── 5. Summary ────────────────────────────────────────────────────

echo ""
echo "Updated:"
echo "  $PLUGIN → $new"
echo "  $MARKETPLACE → $new"
echo "  $PACKAGE → $new"
echo "  $NPM_PACKAGE → $new"
echo "  $SECURITY → supported versions"
echo "  $README → badge + ${check_count} checks / ${dim_count} dimensions"
echo "  $NPM_README → ${check_count} checks / ${dim_count} dimensions"
echo "  $INTRO → ${check_count} checks / ${dim_count} dimensions"
echo "  $ROOT/release-metadata.json → regenerated"
echo "  docs/content/ → synced from root"
echo ""
echo "Next steps:"
echo "  1. Update CHANGELOG.md, then re-run this script (to sync to docs/)"
echo "  2. git add -A && git commit -m \"chore: bump version to $new\""
echo "  3. git tag v$new"
echo "  4. git push && git push --tags"
echo ""
echo "After push:"
echo "  - GitBook auto-syncs docs/content/ → docs.agentlint.app"
echo "  - release.yml: GitHub Release + npm publish + website sync"
