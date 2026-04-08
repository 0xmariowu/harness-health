#!/usr/bin/env bash
# Reconstructs a scannable git repo from corpus data.
# Usage: bash reconstruct-repo.sh <corpus-repo-dir> <output-dir>

set -euo pipefail

CORPUS_REPO="$1"
OUTPUT_DIR="$2"

if [ ! -d "$CORPUS_REPO" ]; then
  echo "Corpus repo not found: $CORPUS_REPO" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

# 1. Create directory structure from root-tree.txt
if [ -f "${CORPUS_REPO}/root-tree.txt" ]; then
  while IFS=$'\t' read -r type name size || [ -n "$type" ]; do
    [ -z "$type" ] && continue
    case "$type" in
      dir)  mkdir -p "${OUTPUT_DIR}/${name}" ;;
      file) mkdir -p "$(dirname "${OUTPUT_DIR}/${name}")" && touch "${OUTPUT_DIR}/${name}" ;;
    esac
  done < "${CORPUS_REPO}/root-tree.txt"
fi

# 2. Copy real CLAUDE.md content
if [ -f "${CORPUS_REPO}/CLAUDE.md" ]; then
  cp "${CORPUS_REPO}/CLAUDE.md" "${OUTPUT_DIR}/CLAUDE.md"
fi

# 3. Copy real AGENTS.md content
if [ -f "${CORPUS_REPO}/AGENTS.md" ]; then
  cp "${CORPUS_REPO}/AGENTS.md" "${OUTPUT_DIR}/AGENTS.md"
fi

# 4. Copy workflow files → .github/workflows/
if [ -d "${CORPUS_REPO}/workflows" ]; then
  mkdir -p "${OUTPUT_DIR}/.github/workflows"
  for wf in "${CORPUS_REPO}/workflows/"*; do
    [ -f "$wf" ] && cp "$wf" "${OUTPUT_DIR}/.github/workflows/"
  done
fi

# 5. Copy build configs
for config in package.json pyproject.toml Cargo.toml go.mod Gemfile composer.json; do
  if [ -f "${CORPUS_REPO}/${config}" ]; then
    cp "${CORPUS_REPO}/${config}" "${OUTPUT_DIR}/${config}"
  fi
done

# 6. Copy linter configs
for linter in eslint.config.mjs eslint.config.js .eslintrc.json .eslintrc.cjs .prettierrc .prettierrc.json .prettierrc.js .prettierrc.yaml .prettierrc.toml prettier.config.mjs prettier.config.js biome.json biome.jsonc pytest.ini; do
  if [ -f "${CORPUS_REPO}/${linter}" ]; then
    cp "${CORPUS_REPO}/${linter}" "${OUTPUT_DIR}/${linter}"
  fi
done

# 7. Copy rules/ directory
if [ -d "${CORPUS_REPO}/rules" ]; then
  mkdir -p "${OUTPUT_DIR}/.claude/rules"
  for rule in "${CORPUS_REPO}/rules/"*; do
    [ -f "$rule" ] && cp "$rule" "${OUTPUT_DIR}/.claude/rules/"
  done
fi

# 8. Copy repo-level files that scanner checks for existence/content
# These are NOT in corpus as extracted files — use root-tree to determine
# if they existed in the original repo, then write placeholder content.
for doc in CHANGELOG.md SECURITY.md CONTRIBUTING.md README.md TODO.md HANDOFF.md PROGRESS.md; do
  if grep -q "^file	${doc}	" "${CORPUS_REPO}/root-tree.txt" 2>/dev/null; then
    if [ ! -s "${OUTPUT_DIR}/${doc}" ]; then
      printf '# %s\n' "${doc%.md}" > "${OUTPUT_DIR}/${doc}"
    fi
  fi
done

# 9. Copy security/scanning configs if present in root-tree
for secfile in .gitleaks.toml .pre-commit-config.yaml; do
  if grep -q "^file	${secfile}	" "${CORPUS_REPO}/root-tree.txt" 2>/dev/null; then
    if [ ! -s "${OUTPUT_DIR}/${secfile}" ]; then
      touch "${OUTPUT_DIR}/${secfile}"
    fi
  fi
done

# 10. Plant sentinel test files in test directories
# Scanner uses deep `find` for test files — empty dirs won't match
if [ -f "${CORPUS_REPO}/root-tree.txt" ]; then
  for testdir in tests test spec __tests__; do
    if grep -q "^dir	${testdir}	" "${CORPUS_REPO}/root-tree.txt" 2>/dev/null; then
      mkdir -p "${OUTPUT_DIR}/${testdir}"
      touch "${OUTPUT_DIR}/${testdir}/placeholder.test.js"
    fi
  done
fi

# 11. Do NOT inject .gitignore content — let the repo's original .gitignore
# (created empty by root-tree step 1) stand as-is for accurate S1 testing

# 9. Make it a git repo
git -C "${OUTPUT_DIR}" init -q 2>/dev/null
git -C "${OUTPUT_DIR}" add -A 2>/dev/null
git -C "${OUTPUT_DIR}" commit -q -m "init" 2>/dev/null || true
