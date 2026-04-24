#!/usr/bin/env bash
# sandbox_setup.sh — E2B sandbox bootstrap for AgentLint tests
# Runs inside E2B sandbox (Ubuntu, user with sudo, Node 20 + git pre-installed).
# Installs jq and agentlint from the uploaded npm pack tarball.
# Sets up /tmp/agentlint-src as the canonical source path for scenario scripts.
set -uo pipefail

NODE_VERSION="${NODE_VERSION:-20}"
AGENTLINT_TAR="${AGENTLINT_TAR:-/tmp/agentlint.tar.gz}"
FROM_NPM="${FROM_NPM:-}"  # if set, install this package name from npm registry
FROM_NPX="${FROM_NPX:-}"  # if set, run npx <package> to test init UI, then also install -g for scenarios

echo "[setup] Node: $(node --version 2>/dev/null || echo missing), npm: $(npm --version 2>/dev/null || echo missing), git: $(git --version 2>/dev/null || echo missing)"

# Install jq (not in E2B base image)
if ! command -v jq &>/dev/null; then
  echo "[setup] Installing jq..."
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq 2>/dev/null || true
  sudo apt-get install -y -qq jq 2>/dev/null || true
fi
echo "[setup] jq: $(jq --version 2>/dev/null || echo missing)"

# Switch Node version if requested and different from installed
CURRENT_NODE="$(node -e 'process.version.slice(1).split(".")[0]' 2>/dev/null || echo 0)"
if [ "$CURRENT_NODE" != "$NODE_VERSION" ]; then
  echo "[setup] Switching to Node $NODE_VERSION (current: $CURRENT_NODE)..."
  export DEBIAN_FRONTEND=noninteractive
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | sudo bash - 2>/dev/null || true
  sudo apt-get install -y nodejs 2>/dev/null || true
fi
echo "[setup] Node: $(node --version), npm: $(npm --version)"

# Install agentlint — either from npm registry or from uploaded tarball
rm -rf /tmp/agentlint-src 2>/dev/null || true

if [ -n "$FROM_NPX" ]; then
  echo "[setup] Testing npx init flow for $FROM_NPX..."
  # Capture full output — this is what the user sees on a fresh machine
  npx "$FROM_NPX" > /tmp/npx-init-output.txt 2>&1 || true
  echo "[setup] npx output ($(wc -l < /tmp/npx-init-output.txt) lines):"
  head -10 /tmp/npx-init-output.txt
  # Also install globally so the rest of the scenarios (check/fix/report) work
  echo "[setup] Installing $FROM_NPX globally for scenario scripts..."
  npm install -g "$FROM_NPX" --no-fund 2>&1 | tail -3 || true
  NPM_ROOT="$(npm root -g 2>/dev/null || echo /usr/lib/node_modules)"
  INSTALL_DIR="$NPM_ROOT/agentlint-ai"
  [ -d "$INSTALL_DIR" ] || INSTALL_DIR="$NPM_ROOT/${FROM_NPX}"
  ln -s "$INSTALL_DIR" /tmp/agentlint-src
  echo "[setup] npx-mode: agentlint-src -> $INSTALL_DIR"
elif [ -n "$FROM_NPM" ]; then
  echo "[setup] Installing $FROM_NPM from npm registry..."
  npm install -g "$FROM_NPM" --no-fund 2>&1 | tail -5 || true
  NPM_ROOT="$(npm root -g 2>/dev/null || echo /usr/lib/node_modules)"
  # agentlint-ai installs as agentlint-ai in node_modules
  INSTALL_DIR="$NPM_ROOT/agentlint-ai"
  [ -d "$INSTALL_DIR" ] || INSTALL_DIR="$NPM_ROOT/${FROM_NPM}"
  ln -s "$INSTALL_DIR" /tmp/agentlint-src
  echo "[setup] npm-mode: agentlint-src -> $INSTALL_DIR ($(ls /tmp/agentlint-src/src/ 2>/dev/null | wc -l) src files)"
else
  # Extract git archive tarball (flat, no subdirectory wrapper)
  echo "[setup] Extracting AgentLint tarball..."
  EXTRACT_DIR="/tmp/al-extract-$$"
  mkdir -p "$EXTRACT_DIR"
  tar -xzf "$AGENTLINT_TAR" -C "$EXTRACT_DIR" 2>/dev/null || true

  # git archive: files extracted flat. npm pack: files under package/ subdir.
  if [ -d "$EXTRACT_DIR/package" ] && [ -f "$EXTRACT_DIR/package/package.json" ]; then
    INSTALL_DIR="$EXTRACT_DIR/package"
  else
    INSTALL_DIR="$EXTRACT_DIR"
  fi
  ln -s "$INSTALL_DIR" /tmp/agentlint-src
  echo "[setup] tarball-mode: agentlint-src -> $INSTALL_DIR ($(ls /tmp/agentlint-src/src/ 2>/dev/null | wc -l) src files)"

  # Install globally from tarball
  echo "[setup] Installing AgentLint globally from tarball..."
  cd "$INSTALL_DIR"
  npm install --silent --no-fund 2>/dev/null || true
  npm install -g . --silent --no-fund 2>/dev/null || true
fi

# Verify installation
echo "[setup] agentlint: $(agentlint --version 2>/dev/null || echo 'not found via PATH')"
echo "[setup] scanner: $(ls /tmp/agentlint-src/src/scanner.sh 2>/dev/null && echo OK || echo MISSING)"
echo "[setup] Bootstrap complete."
