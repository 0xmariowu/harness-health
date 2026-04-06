#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");

const INSTALL_URL =
  "https://raw.githubusercontent.com/0xmariowu/AgentLint/main/scripts/install.sh";

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
    try {
      execSync("command -v claude", { stdio: "ignore" });
    } catch {
      console.error(
        "\n  Claude Code not found. Install it first: https://claude.com/download\n"
      );
      process.exit(1);
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
      "  curl -fsSL https://raw.githubusercontent.com/0xmariowu/AgentLint/main/scripts/install.sh | bash\n"
    );
    process.exit(1);
  }
}

main();
