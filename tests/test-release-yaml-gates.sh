#!/usr/bin/env bash
# P0-2-tag regression test: assert the structural gates added to
# .github/workflows/release.yml + .github/rulesets/tag-protection.yml are
# in place and ordered correctly. This is a static-shape test — it does
# NOT need GitHub credentials and does NOT depend on PyYAML (so it runs
# clean in npm test / CI without a pip install step).

set -eu

REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
RELEASE_YAML="$REPO_ROOT/.github/workflows/release.yml"
RULESET_YAML="$REPO_ROOT/.github/rulesets/tag-protection.yml"

[ -f "$RELEASE_YAML" ] || { echo "FAIL: $RELEASE_YAML not found" >&2; exit 1; }
[ -f "$RULESET_YAML" ] || { echo "FAIL: $RULESET_YAML not found" >&2; exit 1; }

failures=0
fail() { echo "  FAIL: $1" >&2; failures=$((failures + 1)); }

# --- Test 1: tag-protection.yml shape (regex-based, no PyYAML) ---
echo "case 1: tag-protection.yml has the expected shape"
grep -qE '^target:[[:space:]]+tag([[:space:]]|$)' "$RULESET_YAML" \
    || fail "tag-protection.yml: target is not 'tag'"
grep -qE '^enforcement:[[:space:]]+active([[:space:]]|$)' "$RULESET_YAML" \
    || fail "tag-protection.yml: enforcement is not 'active'"
grep -q "refs/tags/v\\*" "$RULESET_YAML" \
    || fail "tag-protection.yml: missing refs/tags/v* in conditions.ref_name.include"
grep -qE '^[[:space:]]*-[[:space:]]+type:[[:space:]]+non_fast_forward' "$RULESET_YAML" \
    || fail "tag-protection.yml: missing rules type non_fast_forward"
grep -qE '^[[:space:]]*-[[:space:]]+type:[[:space:]]+deletion' "$RULESET_YAML" \
    || fail "tag-protection.yml: missing rules type deletion"
[ "$failures" -eq 0 ] && echo "  PASS: target=tag, enforcement=active, v* match, deletion+non_fast_forward rules"

# --- Test 2: release.yml structural gates ordering (Python stdlib only) ---
# We use a tiny stdlib parser that walks the steps section in source order
# without needing a YAML library — sufficient because the test only needs
# step-name and step-source-text matches plus their relative position.
echo "case 2: release.yml ancestor check is in the publish job and ordered before npm publish"
python3 - "$RELEASE_YAML" <<'PY'
import sys

path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    text = f.read()

# Walk the file as a list of `- name: ...` step blocks. For each block we
# capture the name and the contiguous block content up to the next sibling
# `- name:` or `- uses:` at the same indent.
import re
step_pattern = re.compile(r'(?m)^      - (?:name|uses): ')

starts = [m.start() for m in step_pattern.finditer(text)]
starts.append(len(text))

steps = []
for i in range(len(starts) - 1):
    block = text[starts[i]:starts[i + 1]]
    head = block.splitlines()[0] if block else ''
    name_m = re.match(r'\s*-\s+name:\s*(.*)', head)
    uses_m = re.match(r'\s*-\s+uses:\s*(.*)', head)
    label = name_m.group(1) if name_m else (uses_m.group(1) if uses_m else '')
    steps.append({'index': i, 'label': label.strip(), 'block': block})

def find_step(predicate):
    for s in steps:
        if predicate(s):
            return s['index']
    return -1

# Match by step label (line 0 of each block) instead of raw content,
# because comment blocks BETWEEN sibling steps land at the end of the
# previous step's block under our line-anchored regex split. Identifying
# steps by their `name:` / `uses:` text avoids that drift.
def label_has(s, *needles):
    label = s['label'].lower()
    return all(needle.lower() in label for needle in needles)

idx_checkout = find_step(lambda s: 'actions/checkout' in s['label'])
idx_ancestor = find_step(lambda s: label_has(s, 'verify tag sha is an ancestor'))
idx_checks   = find_step(lambda s: label_has(s, 'verify required ci checks'))
idx_publish  = find_step(lambda s: label_has(s, 'publish to npm'))

errors = []
if idx_checkout == -1: errors.append('actions/checkout step not found')
if idx_ancestor == -1: errors.append('git merge-base --is-ancestor step not found')
if idx_checks == -1:   errors.append('check-runs gate (with `!= "success"`) not found')
if idx_publish == -1:  errors.append('npm publish step not found')

if idx_checkout >= 0 and idx_ancestor >= 0 and idx_ancestor < idx_checkout:
    errors.append('ancestor check is BEFORE checkout (would lack git history)')
if idx_ancestor >= 0 and idx_publish >= 0 and idx_ancestor >= idx_publish:
    errors.append('ancestor check is AT OR AFTER npm publish (gate too late)')
if idx_checks >= 0 and idx_publish >= 0 and idx_checks >= idx_publish:
    errors.append('Checks-API gate is AT OR AFTER npm publish (gate too late)')

if errors:
    for e in errors:
        print(f'  FAIL: {e}', file=sys.stderr)
    sys.exit(1)

print(f'  PASS: checkout @{idx_checkout}, ancestor @{idx_ancestor}, checks @{idx_checks}, publish @{idx_publish}')
PY
case2_rc=$?
[ "$case2_rc" -eq 0 ] || fail "case 2 release.yml gate ordering"

if [ "$failures" -eq 0 ]; then
    echo "OK: release-yaml gates contract holds (P0-2-tag)"
    exit 0
fi
echo "FAIL: $failures assertion(s) failed" >&2
exit 1
