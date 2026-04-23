#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Pin the install-script fetch to the tag that matches this published package.
// Fetching from main would let any commit on main silently change what every
// prior package version installs — a supply-chain foot-gun. The release
// workflow writes the correct version into package.json just before npm publish,
// so reading our own version here gives us the tag we shipped alongside.
const { version: PKG_VERSION } = require("./package.json");
const INSTALL_URL =
  `https://raw.githubusercontent.com/0xmariowu/AgentLint/v${PKG_VERSION}/scripts/install.sh`;

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return download(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  try {
    // Check if Claude Code is available — if not, CLI still works, plugin won't.
    let hasClaudeCode = false;
    try {
      const claudeCheck = process.platform === "win32" ? "where claude" : "command -v claude";
      execSync(claudeCheck, { stdio: "ignore" });
      hasClaudeCode = true;
    } catch {
      console.log(
        "\n  Note: Claude Code not found — agentlint CLI installed, but the /al plugin won't be registered.\n" +
        "  To enable the Claude Code plugin: https://claude.com/download\n"
      );
      // CLI commands (agentlint check / fix / setup) work without Claude Code.
      return;
    }

    if (process.platform === "win32") {
      try {
        execSync("bash --version", { stdio: "ignore" });
      } catch {
        console.error(
          "\nAgentLint requires bash on Windows. Install one of:\n" +
            "  - Git for Windows (includes Git Bash): https://git-scm.com/download/win\n" +
            "  - WSL: https://learn.microsoft.com/windows/wsl/install\n" +
            "Then re-run: npm install -g @0xmariowu/agent-lint\n"
        );
        process.exit(1);
      }
    }

    console.log("Downloading AgentLint installer...");
    const script = await download(INSTALL_URL);

    const tmp = path.join(os.tmpdir(), `agent-lint-install-${Date.now()}.sh`);
    fs.writeFileSync(tmp, script, { mode: 0o755 });

    console.log("Installing AgentLint for Claude Code...\n");
    execSync(`bash "${tmp}"`, { stdio: "inherit" });

    fs.unlinkSync(tmp);
  } catch (err) {
    console.error(`\nInstallation failed: ${err.message}`);
    console.error("Try the manual method:");
    console.error(
      `  curl -fsSL https://raw.githubusercontent.com/0xmariowu/AgentLint/v${PKG_VERSION}/scripts/install.sh | bash`
    );
    if (process.platform === "win32") {
      console.error(
        "\nOn Windows, run the command above from inside Git Bash or WSL — it will not work in cmd.exe or PowerShell."
      );
    }
    console.error("");
    process.exit(1);
  }
}

main();
