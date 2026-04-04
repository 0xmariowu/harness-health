#!/usr/bin/env bash
# Creates 12 adversarial repo fixtures for scanner robustness testing.
# Each repo is a self-contained directory under $OUT_DIR.
# Usage: bash tests/robustness/make-edge-repos.sh [output-dir]

set -euo pipefail

# Git identity for temp repos (never pushed, only for local testing)
export GIT_AUTHOR_NAME="test"
export GIT_AUTHOR_EMAIL="test@test"
export GIT_COMMITTER_NAME="test"
export GIT_COMMITTER_EMAIL="test@test"

OUT_DIR="${1:-/tmp/al-validation/edge-repos}"
rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

pass=0
total=0

make_repo() {
  local name="$1"
  local dir="${OUT_DIR}/${name}"
  mkdir -p "${dir}"
  total=$((total + 1))
  printf 'Creating: %s\n' "${name}"
}

# 1. Empty repo — git init, no files
make_repo "01-empty"
git -C "${OUT_DIR}/01-empty" init -q

# 2. Binary-only repo — only .png and .wasm, no text files
make_repo "02-binary-only"
git -C "${OUT_DIR}/02-binary-only" init -q
# Create a minimal valid PNG (1x1 transparent pixel)
printf '\x89PNG\r\n\x1a\n' > "${OUT_DIR}/02-binary-only/image.png"
# Create a fake wasm file
printf '\x00asm\x01\x00\x00\x00' > "${OUT_DIR}/02-binary-only/module.wasm"
git -C "${OUT_DIR}/02-binary-only" add -A
git -C "${OUT_DIR}/02-binary-only" commit -q -m "init" --allow-empty 2>/dev/null || true

# 3. Oversized CLAUDE.md — 50K chars, exceeds 40K limit
make_repo "03-oversized-claudemd"
git -C "${OUT_DIR}/03-oversized-claudemd" init -q
{
  echo "# Giant CLAUDE.md"
  echo ""
  echo "This file is intentionally oversized to test the I7 check."
  echo ""
  # Generate 50K chars of plausible content
  for i in $(seq 1 1000); do
    echo "## Rule ${i}: Don't do thing ${i}. Instead do other thing ${i}. Because: reason ${i} is important for maintaining code quality and ensuring consistency across the project."
  done
} > "${OUT_DIR}/03-oversized-claudemd/CLAUDE.md"
git -C "${OUT_DIR}/03-oversized-claudemd" add -A
git -C "${OUT_DIR}/03-oversized-claudemd" commit -q -m "init"

# 4. Deep nesting — 10 levels of directories
make_repo "04-deep-nesting"
git -C "${OUT_DIR}/04-deep-nesting" init -q
deep_path="${OUT_DIR}/04-deep-nesting/a/b/c/d/e/f/g/h/i/j"
mkdir -p "${deep_path}"
echo "# Deep file" > "${deep_path}/README.md"
echo "# Root" > "${OUT_DIR}/04-deep-nesting/CLAUDE.md"
git -C "${OUT_DIR}/04-deep-nesting" add -A
git -C "${OUT_DIR}/04-deep-nesting" commit -q -m "init"

# 5. Unicode and spaces in filenames
make_repo "05-unicode-spaces"
git -C "${OUT_DIR}/05-unicode-spaces" init -q
echo "# 项目说明" > "${OUT_DIR}/05-unicode-spaces/项目 说明.md"
echo "# CLAUDE" > "${OUT_DIR}/05-unicode-spaces/CLAUDE.md"
mkdir -p "${OUT_DIR}/05-unicode-spaces/src with spaces"
echo "console.log('hi')" > "${OUT_DIR}/05-unicode-spaces/src with spaces/main.js"
git -C "${OUT_DIR}/05-unicode-spaces" add -A
git -C "${OUT_DIR}/05-unicode-spaces" commit -q -m "init"

# 6. Broken symlinks
make_repo "06-broken-symlinks"
git -C "${OUT_DIR}/06-broken-symlinks" init -q
echo "# Project" > "${OUT_DIR}/06-broken-symlinks/CLAUDE.md"
ln -s "/nonexistent/path/to/file.md" "${OUT_DIR}/06-broken-symlinks/docs.md"
ln -s "../../../nowhere/AGENTS.md" "${OUT_DIR}/06-broken-symlinks/AGENTS.md"
git -C "${OUT_DIR}/06-broken-symlinks" add -A
git -C "${OUT_DIR}/06-broken-symlinks" commit -q -m "init" 2>/dev/null || true

# 7. No .git — plain directory, not a repo
make_repo "07-no-git"
echo "# Not a repo" > "${OUT_DIR}/07-no-git/CLAUDE.md"
echo "# README" > "${OUT_DIR}/07-no-git/README.md"

# 8. Monorepo — 3 sub-projects each with CLAUDE.md
make_repo "08-monorepo"
git -C "${OUT_DIR}/08-monorepo" init -q
for pkg in api web shared; do
  mkdir -p "${OUT_DIR}/08-monorepo/packages/${pkg}"
  echo "# ${pkg}" > "${OUT_DIR}/08-monorepo/packages/${pkg}/CLAUDE.md"
  echo "# ${pkg}" > "${OUT_DIR}/08-monorepo/packages/${pkg}/README.md"
done
echo "# Monorepo root" > "${OUT_DIR}/08-monorepo/CLAUDE.md"
git -C "${OUT_DIR}/08-monorepo" add -A
git -C "${OUT_DIR}/08-monorepo" commit -q -m "init"

# 9. AGENTS.md only — no CLAUDE.md
make_repo "09-agents-only"
git -C "${OUT_DIR}/09-agents-only" init -q
cat > "${OUT_DIR}/09-agents-only/AGENTS.md" <<'EOF'
# Agents

> This project uses AGENTS.md instead of CLAUDE.md.

## Rules

- Don't modify the database schema without approval.
- Run `pytest` before committing.
EOF
echo "# Project" > "${OUT_DIR}/09-agents-only/README.md"
git -C "${OUT_DIR}/09-agents-only" add -A
git -C "${OUT_DIR}/09-agents-only" commit -q -m "init"

# 10. CLAUDE.md is a symlink to another file
make_repo "10-claudemd-symlink"
git -C "${OUT_DIR}/10-claudemd-symlink" init -q
mkdir -p "${OUT_DIR}/10-claudemd-symlink/docs"
echo "# Actual rules live here" > "${OUT_DIR}/10-claudemd-symlink/docs/rules.md"
ln -sf docs/rules.md "${OUT_DIR}/10-claudemd-symlink/CLAUDE.md"
git -C "${OUT_DIR}/10-claudemd-symlink" add -A
git -C "${OUT_DIR}/10-claudemd-symlink" commit -q -m "init"

# 11. Non-UTF8 encoded markdown
make_repo "11-non-utf8"
git -C "${OUT_DIR}/11-non-utf8" init -q
# Write Latin-1 encoded content (0xe9 = é in Latin-1, invalid standalone in UTF-8)
printf '# R\xe9sum\xe9\n\nThis file uses Latin-1 encoding.\n' > "${OUT_DIR}/11-non-utf8/CLAUDE.md"
git -C "${OUT_DIR}/11-non-utf8" add -A
git -C "${OUT_DIR}/11-non-utf8" commit -q -m "init"

# 12. Broken YAML in GitHub Actions workflow
make_repo "12-broken-yaml"
git -C "${OUT_DIR}/12-broken-yaml" init -q
echo "# Project" > "${OUT_DIR}/12-broken-yaml/CLAUDE.md"
mkdir -p "${OUT_DIR}/12-broken-yaml/.github/workflows"
cat > "${OUT_DIR}/12-broken-yaml/.github/workflows/ci.yml" <<'EOF'
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: broken step
        run: |
          echo "this yaml is
          intentionally broken
        with: bad-indentation
      - name: another step
        uses: actions/setup-node@v4
EOF
git -C "${OUT_DIR}/12-broken-yaml" add -A
git -C "${OUT_DIR}/12-broken-yaml" commit -q -m "init"

# Summary
echo ""
echo "Created ${total} edge-case repos in ${OUT_DIR}"
ls -1 "${OUT_DIR}"
