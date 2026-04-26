#!/usr/bin/env bash
# P0-7 regression test: `node src/reporter.js` must NOT block when invoked
# in a TTY without a scores file argument and without piped stdin. Pre-fix,
# fs.readFileSync(0) blocked indefinitely waiting for keyboard input.
#
# Strategy:
#   case 1 — non-TTY no stdin: drive node with </dev/null and confirm fast
#            exit + Usage banner.
#   case 2 — simulated TTY: a small node wrapper monkey-patches
#            fs.fstatSync(0) to return isCharacterDevice()=true before
#            requiring reporter.js. (Production code uses fs.fstatSync
#            instead of process.stdin.isTTY so accessing the TTY
#            indicator does not put FD 0 into non-blocking mode and break
#            the pipeline path.) A perl alarm watchdog catches any hang
#            regression as exit 142 (macOS ships no GNU `timeout`).
#
# This avoids needing a real PTY (script(1) flag set differs across BSD
# and GNU and was unreliable in CI).

set -eu

REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
REPORTER="$REPO_ROOT/src/reporter.js"

[ -f "$REPORTER" ] || { echo "FAIL: $REPORTER not found" >&2; exit 1; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/reporter-tty-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# Case 1: NON-TTY no-stdin (existing covered path) — must exit fast with
# usage. This is the easy case; just confirms the regression isn't
# stronger than the pre-fix behavior.
echo "case 1: non-TTY no stdin — fast exit + Usage banner"
out=$(node "$REPORTER" </dev/null 2>&1 || true)
echo "$out" | grep -q "^Usage: reporter.js" || {
    echo "  FAIL: case 1 missing Usage banner" >&2
    echo "$out" >&2
    exit 1
}
echo "  PASS: case 1 prints Usage and exits"

# Case 2: simulated TTY via a node wrapper that monkey-patches
# require('node:tty').isatty so isatty(0) returns true. (Production code
# checks fd 0 with tty.isatty rather than process.stdin.isTTY because
# process.stdin instantiation puts FD 0 into non-blocking mode and
# breaks the pipeline path with EAGAIN.) If the TTY branch is missing
# or fails to exit, the wrapper would block trying to read stdin. We
# bound the run with a perl alarm watchdog (macOS has no GNU `timeout`).
echo "case 2: TTY no stdin — must exit (not hang) and print Usage"
WRAPPER="$TMP/tty-wrapper.js"
cat > "$WRAPPER" <<EOF
'use strict';
// Force the TTY branch in reporter.js without a real PTY: monkey-patch
// require('node:tty').isatty so isatty(0) returns true. Production code
// uses tty.isatty(0) (not process.stdin.isTTY) so the FD is not
// instantiated as a Readable and the pipeline path keeps working.
const tty = require('node:tty');
const realIsatty = tty.isatty;
tty.isatty = function (fd) {
  if (fd === 0) return true;
  return realIsatty.call(this, fd);
};
require('$REPORTER');
EOF
run_with_timeout() {
    local seconds="$1"; shift
    perl -e '
        my $sec = shift @ARGV;
        my $pid = fork();
        if (!defined $pid) { exit 127; }
        if ($pid == 0) { exec(@ARGV) or exit 127; }
        $SIG{ALRM} = sub { kill 9, $pid; exit 142; };
        alarm($sec);
        waitpid($pid, 0);
        exit($? >> 8);
    ' "$seconds" "$@"
}
out=$(run_with_timeout 8 node "$WRAPPER" 2>&1) && ec=0 || ec=$?

if [ "$ec" -eq 142 ]; then
    echo "  FAIL: case 2 process did NOT exit within 8s (TTY hang regression)" >&2
    echo "  ec=$ec, last output: $out" >&2
    exit 1
fi

if [ "$ec" -eq 0 ]; then
    echo "  FAIL: case 2 exited 0 — should have exited non-zero on TTY no-stdin" >&2
    echo "  output: $out" >&2
    exit 1
fi

if echo "$out" | grep -q "Usage: reporter.js"; then
    echo "  PASS: case 2 exited fast (ec=$ec) and emitted Usage banner"
else
    echo "  FAIL: case 2 exited but did not emit Usage banner" >&2
    echo "  ec=$ec, output: $out" >&2
    exit 1
fi

echo "OK: reporter TTY no-stdin contract holds (P0-7)"
