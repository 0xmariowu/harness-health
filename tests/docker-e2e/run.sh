#!/usr/bin/env bash
# One-click Docker E2E test with real corpus data.
# Usage: bash tests/docker-e2e/run.sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(CDPATH='' cd -- "${SCRIPT_DIR}/../.." && pwd)"
CORPUS_TAR="${SCRIPT_DIR}/corpus-data.tar.gz"

# Ensure corpus data is packaged
if [ ! -f "$CORPUS_TAR" ]; then
  echo "Packaging corpus data..."
  bash "${SCRIPT_DIR}/package-corpus.sh"
fi

echo "Building Docker image..."
docker build -t agentlint-e2e-real -f "${SCRIPT_DIR}/Dockerfile" "$ROOT_DIR"

echo ""
echo "Running E2E tests..."
docker run --rm agentlint-e2e-real
