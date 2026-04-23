#!/usr/bin/env bash
# check-deps.sh — Ensure required external CLIs are installed
# Usage:
#   check-deps.sh node npm git
#   VIBEKIT_REQUIRED_DEPS="node npm git" check-deps.sh

set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[0;33m'; GREEN='\033[0;32m'; NC='\033[0m'

usage() {
  cat >&2 <<'EOF'
check-deps.sh — fail-fast check that required CLIs are on PATH.

usage:
  scripts/check-deps.sh <tool>...          pass tool names as args
  VIBEKIT_REQUIRED_DEPS="node npm git" scripts/check-deps.sh

examples:
  scripts/check-deps.sh git node npm       exit 1 if any is missing
  VIBEKIT_REQUIRED_DEPS="docker" scripts/check-deps.sh
EOF
}

case "${1:-}" in -h|--help) usage; exit 0 ;; esac

DEPS=()
MISSING=()

if [ "$#" -gt 0 ]; then
  DEPS=("$@")
elif [ -n "${VIBEKIT_REQUIRED_DEPS:-}" ]; then
  read -r -a DEPS <<< "$VIBEKIT_REQUIRED_DEPS"
fi

if [ "${#DEPS[@]}" -eq 0 ]; then
  usage
  printf "${YELLOW}warning:${NC} no dependencies specified — pass args or set VIBEKIT_REQUIRED_DEPS\n"
  exit 0
fi

for dep in "${DEPS[@]}"; do
  if command -v "$dep" >/dev/null 2>&1; then
    printf "${GREEN}ok:${NC} found %s\n" "$dep"
  else
    printf "${RED}error:${NC} missing %s\n" "$dep"
    MISSING+=("$dep")
  fi
done

if [ "${#MISSING[@]}" -gt 0 ]; then
  exit 1
fi
