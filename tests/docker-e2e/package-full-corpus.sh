#!/usr/bin/env bash
# Packages ALL 4533 corpus repos for full Docker robustness test.
# Only includes files scanner needs — no history.json, no _other, no _meta.json.
# Usage: bash tests/docker-e2e/package-full-corpus.sh

set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CORPUS="${AL_CORPUS_DIR:-${HOME}/corpus/repos}"
OUT="${SCRIPT_DIR}/corpus-full.tar.gz"
TMP="$(mktemp -d)"

if [ ! -d "$CORPUS" ]; then
  echo "Corpus not found at $CORPUS" >&2
  exit 1
fi

echo "Packaging full corpus..."
count=0
for src in "${CORPUS}"/*/; do
  [ -d "$src" ] || continue
  name="$(basename "$src")"

  dest="${TMP}/${name}"
  mkdir -p "$dest"

  # Copy only scanner-relevant files
  for f in CLAUDE.md AGENTS.md .cursorrules root-tree.txt package.json pyproject.toml Cargo.toml go.mod Gemfile composer.json \
           eslint.config.mjs eslint.config.js .eslintrc.json .eslintrc.cjs .prettierrc .prettierrc.json biome.json biome.jsonc pytest.ini \
           _meta.json; do
    [ -f "${src}/${f}" ] && cp "${src}/${f}" "${dest}/${f}"
  done

  # Copy workflows
  if [ -d "${src}/workflows" ]; then
    mkdir -p "${dest}/workflows"
    cp "${src}/workflows/"* "${dest}/workflows/" 2>/dev/null || true
  fi

  # Copy rules
  if [ -d "${src}/rules" ]; then
    mkdir -p "${dest}/rules"
    cp "${src}/rules/"* "${dest}/rules/" 2>/dev/null || true
  fi

  count=$((count + 1))
  [ $((count % 500)) -eq 0 ] && echo "  Packed: ${count}..."
done

echo "  Packed: ${count} total repos"

# Create tarball
tar -czf "$OUT" -C "$TMP" .
rm -rf "$TMP"

size="$(du -h "$OUT" | cut -f1)"
echo "Created: $OUT ($size, $count repos)"
