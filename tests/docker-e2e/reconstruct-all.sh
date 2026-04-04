#!/usr/bin/env bash
# Reconstructs all corpus repos from /tmp/corpus-raw into /home/testuser/Projects
set -u

RAW="/tmp/corpus-raw"
OUT="/home/testuser/Projects"
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

count=0
for repo_dir in "${RAW}"/*/; do
  [ -d "$repo_dir" ] || continue
  name="$(basename "$repo_dir")"
  proj_name="$(echo "$name" | sed 's/.*__//')"
  bash "${SCRIPT_DIR}/reconstruct-repo.sh" "$repo_dir" "${OUT}/${proj_name}" 2>/dev/null || true
  count=$((count + 1))
  [ $((count % 500)) -eq 0 ] && echo "Reconstructed: ${count}..."
done

echo "Reconstructed ${count} repos total"
