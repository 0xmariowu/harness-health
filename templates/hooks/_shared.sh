# shellcheck shell=bash
# _shared.sh — Sourced by language pre-commit hooks.
# Provides: committer gate, author identity check, codename scan, PII scan, secret detection.
# Callers must define run_lint() before sourcing this file.

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

# Four-part failure helper: what / Rule / Fix / See.
# Every hook error tells the reader (human or agent) these four things so
# they can act without opening the hook source.
fail_with_help() {
  local what="$1" rule="$2" fix="$3" see="${4:-}"
  printf 'error: %s\n' "$what" >&2
  printf '  Rule: %s\n' "$rule" >&2
  printf '  Fix:  %s\n' "$fix" >&2
  [ -n "$see" ] && printf '  See:  %s\n' "$see" >&2
  exit 1
}

# Gate: all commits must go through scripts/committer
if [ -z "${VIBEKIT_COMMITTER_ACTIVE:-}" ]; then
  fail_with_help \
    "direct 'git commit' blocked — this repo uses scripts/committer" \
    "All commits go through scripts/committer so they can be scoped, audited, and PII-scanned." \
    "scripts/committer \"<message>\" <file...>" \
    "docs/rules-style.md — Commit protocol"
fi

# Author identity check — opt-in allowlist via .vibekit-committer (absent = no gating; public-template default)
AUTHOR_EMAIL=$(git config user.email)
AUTHOR_NAME=$(git config user.name)
VIBEKIT_COMMITTER_FILE="$(git rev-parse --show-toplevel 2>/dev/null)/.vibekit-committer"
if [[ -f "$VIBEKIT_COMMITTER_FILE" ]]; then
  if ! printf '%s\n%s\n' "$AUTHOR_NAME" "$AUTHOR_EMAIL" | grep -Eqf "$VIBEKIT_COMMITTER_FILE"; then
    fail_with_help \
      "git author '$AUTHOR_NAME <$AUTHOR_EMAIL>' is not allow-listed" \
      "This repo uses .vibekit-committer to pin who can commit (set by a maintainer)." \
      "Add a grep -E pattern matching your name/email to .vibekit-committer, then retry. Or delete .vibekit-committer to disable the gate." \
      ".vibekit-committer at repo root"
  fi
fi

# Content scan on staged files — codenames (opt-in via .internal-codenames), personal paths, hostnames
# Exclude: config files that legitimately contain detection patterns
SCAN_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -v -E '(\.gitleaks\.toml$|\.example$|\.husky/|\.github/workflows/|^\.internal-codenames$)' || true)
if [ -n "$SCAN_FILES" ]; then
  # Internal project codenames — opt-in via .internal-codenames file (one grep -E pattern per line)
  INTERNAL_CODENAMES_FILE="$(git rev-parse --show-toplevel 2>/dev/null)/.internal-codenames"
  if [[ -f "$INTERNAL_CODENAMES_FILE" ]]; then
    CN_MATCHES=$(echo "$SCAN_FILES" | while IFS= read -r f; do grep -nEHf "$INTERNAL_CODENAMES_FILE" "$f" 2>/dev/null; done || true)
    if [ -n "$CN_MATCHES" ]; then
      printf 'error: internal project codenames in staged files:\n%s\n' "$CN_MATCHES" >&2
      fail_with_help \
        "internal codenames found in staged diff (matches above)" \
        "Public repos must not expose codenames listed in .internal-codenames." \
        "Rename the reference, remove the line, or update .internal-codenames if the codename is no longer internal." \
        ".internal-codenames at repo root"
    fi
  fi
  # Personal paths and hostnames — placeholder usernames whitelisted per-match (not per-line)
  _PII_RAW=$(echo "$SCAN_FILES" | while IFS= read -r f; do grep -nEH '/Users/[a-zA-Z]|/home/[a-z]|\.ts\.net' "$f" 2>/dev/null; done || true)
  # shellcheck disable=SC2016
  PII_MATCHES=$(printf '%s' "$_PII_RAW" | python3 -c '
import sys, re
OK = {"xxx", "yourusername", "example", "your-username"}
for line in sys.stdin:
    users = re.findall(r"/Users/([A-Za-z][A-Za-z0-9_-]*)", line)
    if any(u not in OK for u in users) or (not users and ("/home/" in line or ".ts.net" in line)):
        sys.stdout.write(line)
' 2>/dev/null || printf '%s' "$_PII_RAW")
  if [ -n "$PII_MATCHES" ]; then
    printf 'error: personal paths or hostnames in staged files:\n%s\n' "$PII_MATCHES" >&2
    fail_with_help \
      "personal filesystem paths or hostnames detected" \
      "Never commit /Users/<name>, /home/<name>, or .ts.net hostnames — they leak identity and infra." \
      "Use \$HOME, \$TMPDIR, or parameterised paths. If the match is a detection pattern, exclude the file in configs/.gitleaks.toml." \
      "configs/.gitleaks.toml — PII patterns"
  fi
fi

# Secret detection
SECRET_PATTERNS='(API_KEY|SECRET_KEY|PRIVATE_KEY|AUTH_TOKEN|PASSWORD)\s*=\s*["\x27][^\s"'\'']+|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AIzaSy[a-zA-Z0-9_-]{33}|AKIA[0-9A-Z]{16}|xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}|npm_[a-zA-Z0-9]{36}|sk-ant-[a-zA-Z0-9_-]{40,}|sk-or-[a-zA-Z0-9_-]{20,}|tvly-[a-zA-Z0-9_-]{20,}|github_pat_[a-zA-Z0-9_]{22,}|exa-[a-zA-Z0-9_-]{20,}'
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -v -E '(\.example$|\.test\.(ts|js|py)$|tests/fixtures/|\.md$)' || true)
if [ -n "$STAGED_FILES" ]; then
  MATCHES=$(echo "$STAGED_FILES" | while IFS= read -r f; do grep -nEH "$SECRET_PATTERNS" "$f" 2>/dev/null; done || true)
  if [ -n "$MATCHES" ]; then
    printf 'error: potential secrets detected in staged files:\n%s\n' "$MATCHES" >&2
    fail_with_help \
      "potential secret in staged diff (matches above)" \
      "Never commit credentials — gitleaks will flag them in CI too, and history rewrites are expensive." \
      "Move to env var or secrets manager. If test fixture: add to .secrets.baseline, or commit --no-verify after explicit review." \
      "configs/.pre-commit-config.yaml.template — detect-secrets hook"
  fi
fi

# ShellCheck on staged shell scripts
SH_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep '\.sh$' || true)
if [ -n "$SH_FILES" ] && command -v shellcheck >/dev/null 2>&1; then
  echo "$SH_FILES" | xargs shellcheck --severity=error
fi

# Run language-specific lint (defined by caller before sourcing)
run_lint
