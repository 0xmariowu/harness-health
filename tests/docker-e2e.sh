#!/usr/bin/env bash
# Run E2E tests inside a clean Docker container.
# Simulates: fresh machine, git clone, run full pipeline.
set -euo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building Docker test image..."
docker build -t al-e2e -f "${ROOT_DIR}/tests/Dockerfile.e2e" "${ROOT_DIR}"

echo ""
echo "Running E2E tests in Docker..."
docker run --rm al-e2e
