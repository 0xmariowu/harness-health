#!/usr/bin/env bash
# Audit compliance checks — repo-level security and hygiene baseline.
# Exit 0 = all pass. Exit 1 = at least one failure.
# Add to CI: `bash tests/compliance_check.sh`
# Run locally: `bash tests/compliance_check.sh`
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

ok()   { echo "PASS: $1"; ((PASS++)) || true; }
fail() { echo "FAIL: $1"; ((FAIL++)) || true; }

# C1: SECURITY.md exists
if [ -f "$REPO_ROOT/SECURITY.md" ]; then
  ok "SECURITY.md exists"
else
  fail "SECURITY.md missing from repo root"
fi

# C2: .gitleaks.toml exists
if [ -f "$REPO_ROOT/.gitleaks.toml" ]; then
  ok ".gitleaks.toml exists"
else
  fail ".gitleaks.toml missing from repo root"
fi

# C3: no personal email in git history
personal_emails=$(git -C "$REPO_ROOT" log --all --format="%ae" \
  | grep -vE "(noreply|github-actions|dependabot|action@github\.com)" \
  | grep "@" || true)
if [ -z "$personal_emails" ]; then
  ok "no personal email in git history"
else
  fail "personal email(s) found in git history: $personal_emails"
fi

# C4: no personal /Users/<name>/ paths in tracked source files
# Exclude shell scripts (may contain detection regexes), docs, config.
hits=$(git -C "$REPO_ROOT" ls-files \
  | grep -vE "\.(sh|json|toml|md|yaml|yml|txt)$" \
  | grep -vE "^(tests/|\.husky/|scripts/)" \
  | xargs grep -lE "/Users/[a-zA-Z]" 2>/dev/null || true)
if [ -z "$hits" ]; then
  ok "no personal paths in tracked source files"
else
  fail "/Users/ path found in: $hits"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
