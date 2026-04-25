#!/usr/bin/env bash
# fill-placeholders.sh — replace agentlint setup template tokens (__OWNER__,
# __PROJECT_NAME__, …) across a bootstrapped project.
#
# Use cases:
#   - After `agentlint setup` ran but OWNER couldn't be detected (no gh auth,
#     no remote) — you set up the remote later, then:
#         scripts/fill-placeholders.sh .
#     auto-detects OWNER from `git remote get-url origin` and fills every
#     file in-place.
#   - You renamed your repo / changed GitHub handle / set a PROJECT_DOMAIN
#     for SECURITY.md — rerun with explicit flags:
#         scripts/fill-placeholders.sh --owner acme --domain acme.com .
#   - You never ran `agentlint setup` but copied these templates by hand — this
#     tool still fills them.
#
# Safety: only replaces the exact `__TOKEN__` strings. Never touches tokens
# written as bare words (OWNER, PROJECT_NAME, …) which is important for
# shell variables like `OWNER=""` in scripts/protect.sh. Skips .git/,
# node_modules/, .venv/, __pycache__/, and binary files (detected via
# NUL byte sniff).
#
# Usage:
#   scripts/fill-placeholders.sh [OPTIONS] [TARGET_DIR]
#
# Options:
#   --owner <handle>        override __OWNER__
#   --project <name>        override __PROJECT_NAME__
#   --domain <domain>       override __PROJECT_DOMAIN__
#   --language <ts|py|…>    override __LANGUAGE__
#   --pkg-manager <npm|…>   override __PACKAGE_MANAGER__
#   --dry-run               show what would change, don't write
#   --help                  this help

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
die()  { printf "${RED}error:${NC} %s\n" "$*" >&2; exit 1; }
info() { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$*"; }

usage() { sed -n '2,30p' "$0" | sed 's/^# //; s/^#$//'; exit 0; }

# --- Parse flags ---
OWNER=""; PROJECT_NAME=""; PROJECT_DOMAIN=""; LANGUAGE=""; PKG_MANAGER=""
DRY_RUN=false; TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner)        OWNER="$2";          shift 2 ;;
    --project)      PROJECT_NAME="$2";   shift 2 ;;
    --domain)       PROJECT_DOMAIN="$2"; shift 2 ;;
    --language)     LANGUAGE="$2";       shift 2 ;;
    --pkg-manager)  PKG_MANAGER="$2";    shift 2 ;;
    --dry-run)      DRY_RUN=true;        shift ;;
    -h|--help)      usage ;;
    -*)             die "unknown flag: $1" ;;
    *)              TARGET="$1";         shift ;;
  esac
done

TARGET="${TARGET:-.}"
[[ -d "$TARGET" ]] || die "not a directory: $TARGET"
TARGET="$(cd "$TARGET" && pwd)"

# --- Auto-detect __PROJECT_NAME__ from dir name ---
if [[ -z "$PROJECT_NAME" ]]; then
  PROJECT_NAME="$(basename "$TARGET")"
fi

# --- Auto-detect __OWNER__ (env → gh → git remote) ---
if [[ -z "$OWNER" ]]; then
  OWNER="${GITHUB_OWNER:-}"
fi
if [[ -z "$OWNER" ]] && command -v gh >/dev/null 2>&1; then
  OWNER=$(cd "$TARGET" && gh repo view --json owner -q '.owner.login' 2>/dev/null || echo "")
fi
if [[ -z "$OWNER" ]]; then
  remote_url=$(git -C "$TARGET" remote get-url origin 2>/dev/null || echo "")
  OWNER=$(printf '%s\n' "$remote_url" | sed -nE 's#.*[/:]([^/:]+)/[^/]+(\.git)?/?$#\1#p')
fi

# --- Auto-detect __LANGUAGE__ + __PACKAGE_MANAGER__ from lockfiles ---
if [[ -z "$LANGUAGE" ]]; then
  if   [[ -f "$TARGET/tsconfig.json"   ]]; then LANGUAGE=ts
  elif [[ -f "$TARGET/pyproject.toml" || -f "$TARGET/setup.py" ]]; then LANGUAGE=python
  elif [[ -f "$TARGET/package.json"    ]]; then LANGUAGE=node
  fi
fi
if [[ -z "$PKG_MANAGER" ]]; then
  if   [[ -f "$TARGET/bun.lock" || -f "$TARGET/bun.lockb" ]]; then PKG_MANAGER=bun
  elif [[ -f "$TARGET/pnpm-lock.yaml" ]]; then PKG_MANAGER=pnpm
  elif [[ -f "$TARGET/yarn.lock"     ]]; then PKG_MANAGER=yarn
  elif [[ -f "$TARGET/package.json"  ]]; then PKG_MANAGER=npm
  elif [[ "$LANGUAGE" == "python"    ]]; then PKG_MANAGER=pip
  fi
fi

info "target: $TARGET"
for kv in \
    "__OWNER__=$OWNER" \
    "__PROJECT_NAME__=$PROJECT_NAME" \
    "__PROJECT_DOMAIN__=$PROJECT_DOMAIN" \
    "__LANGUAGE__=$LANGUAGE" \
    "__PACKAGE_MANAGER__=$PKG_MANAGER"; do
  val="${kv#*=}"
  if [[ -n "$val" ]]; then
    printf "  %s\n" "$kv"
  else
    printf "  %s  ${YELLOW}(unset, placeholder will remain)${NC}\n" "$kv"
  fi
done
[[ "$DRY_RUN" == "true" ]] && info "dry-run mode — no files will be written"

# --- Walk the tree, skip junk, replace only __TOKEN__ patterns ---
python3 - "$TARGET" "$OWNER" "$PROJECT_NAME" "$PROJECT_DOMAIN" "$LANGUAGE" "$PKG_MANAGER" "$DRY_RUN" <<'PY'
import os, sys, pathlib

target, owner, project, domain, lang, pkg, dry_run = sys.argv[1:8]
dry_run = dry_run == "true"
replacements = {
    "__OWNER__":           owner,
    "__PROJECT_NAME__":    project,
    "__PROJECT_DOMAIN__":  domain,
    "__LANGUAGE__":        lang,
    "__PACKAGE_MANAGER__": pkg,
}
# Only substitute tokens whose value is non-empty — preserves the placeholder
# for the user to fill in later when a value is unknown.
active = {k: v for k, v in replacements.items() if v}

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__",
             "dist", "build", ".next", ".turbo", ".cache"}
# Self-skip: fill-placeholders.sh contains `__OWNER__` and friends as literal
# strings in its own replacement map. Without this guard the script rewrites
# its own source on every run, eventually breaking itself.
SKIP_FILES = {"fill-placeholders.sh"}

changed = []
for root, dirs, files in os.walk(target):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for name in files:
        if name in SKIP_FILES:
            continue
        p = pathlib.Path(root) / name
        try:
            raw = p.read_bytes()
        except Exception:
            continue
        if b"\x00" in raw[:8192]:
            continue  # binary
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        new = text
        for k, v in active.items():
            new = new.replace(k, v)
        if new != text:
            changed.append(p)
            if not dry_run:
                p.write_text(new, encoding="utf-8")

rel = lambda p: os.path.relpath(p, target)
if changed:
    print(f"{'would update' if dry_run else 'updated'} {len(changed)} file(s):")
    for p in changed:
        print(f"  {rel(p)}")
else:
    print("no files needed changes")
PY
