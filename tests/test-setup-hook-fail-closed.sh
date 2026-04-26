#!/usr/bin/env bash
# P0-3-followup regression test: `agentlint setup` must fail closed when an
# existing core.hooksPath or executable .git/hooks/* would be silently
# overwritten. --force opts back into the overwrite.
#
# Three fixtures:
#   1. Repo already sets core.hooksPath=.custom-hooks → setup must exit
#      non-zero AND leave the config untouched.
#   2. Repo has executable .git/hooks/pre-commit → setup must exit non-zero
#      AND leave the file untouched.
#   3. --force on the first fixture → setup completes and writes
#      core.hooksPath=.husky (i.e. the override path actually works).

set -eu

REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
SETUP="$REPO_ROOT/scripts/agentlint.sh"

[ -x "$SETUP" ] || { echo "FAIL: $SETUP not executable" >&2; exit 1; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/setup-hook-fail-closed.XXXXXX")
TMP=$(CDPATH='' cd -- "$TMP" && pwd -P)
trap 'rm -rf "$TMP"' EXIT

failures=0
fail() {
    echo "  FAIL: $1" >&2
    failures=$((failures + 1))
}
pass() {
    echo "  PASS: $1"
}

run_setup() {
    local proj="$1"; shift
    "$SETUP" setup --lang ts --no-install "$@" "$proj" >"$TMP/last.stdout" 2>"$TMP/last.stderr"
}

# --- Fixture 1: existing core.hooksPath ---
echo "case 1: existing core.hooksPath=.custom-hooks must block setup"
proj1="$TMP/repo1"
mkdir -p "$proj1/.custom-hooks"
git -C "$proj1" init -q
git -C "$proj1" config user.email "test@example.com"
git -C "$proj1" config user.name "Test"
git -C "$proj1" config core.hooksPath .custom-hooks
cat > "$proj1/.custom-hooks/pre-commit" <<'EOF'
#!/bin/bash
echo "ORG-LEVEL HOOK"
EOF
chmod +x "$proj1/.custom-hooks/pre-commit"
git -C "$proj1" add -A
git -C "$proj1" commit -q -m "seed"

if run_setup "$proj1"; then
    fail "case 1: setup should have exited non-zero"
else
    pass "case 1: setup refused to clobber existing core.hooksPath"
fi
got=$(git -C "$proj1" config core.hooksPath)
if [ "$got" = ".custom-hooks" ]; then
    pass "case 1: core.hooksPath preserved as .custom-hooks"
else
    fail "case 1: core.hooksPath was changed to '$got' (expected .custom-hooks)"
fi

# --- Fixture 2: executable .git/hooks/pre-commit ---
echo "case 2: existing executable .git/hooks/pre-commit must block setup"
proj2="$TMP/repo2"
mkdir -p "$proj2"
git -C "$proj2" init -q
git -C "$proj2" config user.email "test@example.com"
git -C "$proj2" config user.name "Test"
cat > "$proj2/.git/hooks/pre-commit" <<'EOF'
#!/bin/bash
echo "LEGACY HOOK"
EOF
chmod +x "$proj2/.git/hooks/pre-commit"

if run_setup "$proj2"; then
    fail "case 2: setup should have exited non-zero"
else
    pass "case 2: setup refused to clobber existing .git/hooks/pre-commit"
fi
if [ -x "$proj2/.git/hooks/pre-commit" ] && grep -q "LEGACY HOOK" "$proj2/.git/hooks/pre-commit"; then
    pass "case 2: existing pre-commit content preserved"
else
    fail "case 2: existing pre-commit was modified or removed"
fi

# --- Fixture 3: --force on case-1-style repo overrides the gate ---
echo "case 3: --force overrides the fail-closed gate"
proj3="$TMP/repo3"
mkdir -p "$proj3/.custom-hooks"
git -C "$proj3" init -q
git -C "$proj3" config user.email "test@example.com"
git -C "$proj3" config user.name "Test"
git -C "$proj3" config core.hooksPath .custom-hooks
cat > "$proj3/.custom-hooks/pre-commit" <<'EOF'
#!/bin/bash
echo "ORG-LEVEL HOOK"
EOF
chmod +x "$proj3/.custom-hooks/pre-commit"
git -C "$proj3" add -A
git -C "$proj3" commit -q -m "seed"

if run_setup "$proj3" --force; then
    pass "case 3: --force allowed setup to complete"
else
    cat "$TMP/last.stderr" >&2
    fail "case 3: setup --force should have succeeded"
fi
got3=$(git -C "$proj3" config core.hooksPath)
if [ "$got3" = ".husky" ]; then
    pass "case 3: --force updated core.hooksPath to .husky"
else
    fail "case 3: core.hooksPath after --force is '$got3' (expected .husky)"
fi

if [ "$failures" -eq 0 ]; then
    echo "OK: setup hook fail-closed contract holds (P0-3-followup)"
    exit 0
fi
echo "FAIL: $failures assertion(s) failed" >&2
exit 1
