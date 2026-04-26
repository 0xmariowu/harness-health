#!/usr/bin/env bash
# Test scripts/lib/resolve-self.sh against three symlink scenarios under a
# simulated BSD-style readlink (no -f flag). Verifies the function never
# falls back to readlink -f even when GNU coreutils is not installed.

set -eu

REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
LIB="$REPO_ROOT/scripts/lib/resolve-self.sh"

[ -f "$LIB" ] || { echo "FAIL: $LIB not found" >&2; exit 1; }

# Build an isolated fixture root. Canonicalize via pwd -P so expected paths
# match what resolve_self produces (macOS /var is a symlink to /private/var).
FIX=$(mktemp -d)
FIX=$(CDPATH='' cd -- "$FIX" && pwd -P)
trap 'rm -rf "$FIX"' EXIT

mkdir -p "$FIX/real" "$FIX/binstub" "$FIX/relchain/sub"
echo "real-script" > "$FIX/real/agentlint.sh"
chmod +x "$FIX/real/agentlint.sh"

# BSD-style readlink stub: rejects -f, defers everything else to /usr/bin/readlink.
cat > "$FIX/binstub/readlink" <<'EOF'
#!/bin/bash
if [ "${1:-}" = "-f" ]; then
    echo "readlink: illegal option -- f" >&2
    exit 1
fi
exec /usr/bin/readlink "$@"
EOF
chmod +x "$FIX/binstub/readlink"

run_with_bsd_readlink() {
    PATH="$FIX/binstub:$PATH" bash -c "set -eu; source '$LIB'; resolve_self \"\$1\"" _ "$1"
}

assert_eq() {
    local label="$1" expected="$2" got="$3"
    if [ "$expected" = "$got" ]; then
        echo "  PASS: $label"
    else
        echo "  FAIL: $label" >&2
        echo "    expected: $expected" >&2
        echo "    got:      $got" >&2
        exit 1
    fi
}

# Case 1: non-symlink. Must canonicalize to its real absolute path.
echo "case 1: non-symlink"
result=$(run_with_bsd_readlink "$FIX/real/agentlint.sh")
assert_eq "non-symlink resolves to itself (canonical)" "$FIX/real/agentlint.sh" "$result"

# Case 2: absolute symlink target.
ln -sf "$FIX/real/agentlint.sh" "$FIX/abs-link"
echo "case 2: absolute symlink target"
result=$(run_with_bsd_readlink "$FIX/abs-link")
assert_eq "absolute symlink resolves to real target" "$FIX/real/agentlint.sh" "$result"

# Case 3: relative symlink target — must resolve against the symlink's
# directory, not the caller's cwd. This is the npm bin case.
ln -sf "../../real/agentlint.sh" "$FIX/relchain/sub/rel-link"
echo "case 3: relative symlink target (npm bin shape)"
# Run from a totally unrelated cwd to prove the resolver does NOT use cwd.
( cd /tmp && result=$(run_with_bsd_readlink "$FIX/relchain/sub/rel-link") && \
  assert_eq "relative symlink resolves to real target" "$FIX/real/agentlint.sh" "$result" )

# Case 4: chained symlinks (link -> link -> real). Resolver must follow.
ln -sf "$FIX/abs-link" "$FIX/chain-link"
echo "case 4: chained symlink"
result=$(run_with_bsd_readlink "$FIX/chain-link")
assert_eq "chained symlink resolves to ultimate target" "$FIX/real/agentlint.sh" "$result"

# Case 5: confirm BSD-stub really blocks readlink -f (negative control —
# proves the test harness is meaningful, not silently passing on GNU).
echo "case 5: BSD stub negative control"
if PATH="$FIX/binstub:$PATH" readlink -f "$FIX/real/agentlint.sh" 2>/dev/null; then
    echo "  FAIL: BSD stub did not block readlink -f" >&2
    exit 1
fi
echo "  PASS: BSD stub blocks readlink -f as expected"

echo "OK: all resolve_self tests passed"
