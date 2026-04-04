#!/usr/bin/env bash
# Packages selected corpus repos into a tarball for Docker build.
# Usage: bash tests/docker-e2e/package-corpus.sh

set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CORPUS="${AL_CORPUS_DIR:-${HOME}/corpus/corpus/claude-repo/repos}"
SELECTED="${SCRIPT_DIR}/selected-repos.json"
OUT="${SCRIPT_DIR}/corpus-data.tar.gz"
TMP="$(mktemp -d)"

if [ ! -f "$SELECTED" ]; then
  echo "Run select-repos.js first" >&2
  exit 1
fi

echo "Packaging corpus repos..."
repo_count="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${SELECTED}')).repos.length)")"

for i in $(seq 0 $((repo_count - 1))); do
  name="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${SELECTED}')).repos[$i].name)")"
  src="${CORPUS}/${name}"

  if [ ! -d "$src" ]; then
    echo "SKIP: $name (not found)" >&2
    continue
  fi

  dest="${TMP}/${name}"
  mkdir -p "$dest"

  # Copy only the files we need (no history.json, no _other, no _meta.json)
  for f in CLAUDE.md AGENTS.md root-tree.txt package.json pyproject.toml Cargo.toml go.mod Gemfile composer.json \
           eslint.config.mjs eslint.config.js .eslintrc.json .prettierrc .prettierrc.json biome.json biome.jsonc pytest.ini; do
    [ -f "${src}/${f}" ] && cp "${src}/${f}" "${dest}/${f}"
  done

  # Copy workflows directory
  if [ -d "${src}/workflows" ]; then
    mkdir -p "${dest}/workflows"
    cp "${src}/workflows/"* "${dest}/workflows/" 2>/dev/null || true
  fi

  # Copy rules directory
  if [ -d "${src}/rules" ]; then
    mkdir -p "${dest}/rules"
    cp "${src}/rules/"* "${dest}/rules/" 2>/dev/null || true
  fi

  echo "  Packed: $name"
done

# Create tarball
tar -czf "$OUT" -C "$TMP" .
rm -rf "$TMP"

size="$(du -h "$OUT" | cut -f1)"
echo ""
echo "Created: $OUT ($size)"
