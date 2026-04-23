#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const { version: PKG_VERSION } = require("./package.json");

const LOGO = `
  █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗     ██╗███╗   ██╗████████╗
 ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║     ██║████╗  ██║╚══██╔══╝
 ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║     ██║██╔██╗ ██║   ██║
 ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║     ██║██║╚██╗██║   ██║
 ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ███████╗██║██║ ╚████║   ██║
 ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝╚═╝  ╚═══╝   ╚═╝
`;

function step(icon, label, status) {
  const icons = { ok: "\x1b[32m✓\x1b[0m", skip: "\x1b[2mo\x1b[0m", warn: "\x1b[33m!\x1b[0m" };
  const i = icons[icon] || icon;
  const padded = label.padEnd(28);
  console.log(`  ${i} ${padded} ${status}`);
}

function box(lines) {
  const width = 62;
  const border = "+" + "-".repeat(width) + "+";
  console.log(border);
  for (const line of lines) {
    const padded = line.padEnd(width);
    console.log(`| ${padded}|`);
  }
  console.log(border);
}

function main() {
  // Support both `npx agentlint-ai` and `npx agentlint-ai init`.
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] !== "init") {
    console.error("Usage: npx agentlint-ai [init]");
    process.exit(1);
  }

  console.log(LOGO);
  console.log("\x1b[1mAgentLint v" + PKG_VERSION + "\x1b[0m — AI-native repo diagnostics");
  console.log("─".repeat(62));
  console.log("\x1b[36mPrivacy first: agentlint reads your repo locally. Nothing leaves your machine.\x1b[0m");
  console.log("─".repeat(62));
  console.log();

  // Detect platform
  const isWin = process.platform === "win32";
  let hasBash = true;
  if (isWin) {
    try { execSync("bash --version", { stdio: "ignore" }); }
    catch {
      hasBash = false;
      step("warn", "bash (required on Windows)", "[not found]");
      console.log();
      console.log("  AgentLint requires bash on Windows. Install one of:");
      console.log("    - Git for Windows: https://git-scm.com/download/win");
      console.log("    - WSL: https://learn.microsoft.com/windows/wsl/install");
      console.log("  Then re-run: npx agentlint-ai");
      console.log();
      process.exit(1);
    }
  }

  // Detect Claude Code
  let hasClaudeCode = false;
  try {
    const check = isWin ? "where claude" : "command -v claude";
    execSync(check, { stdio: "ignore" });
    hasClaudeCode = true;
  } catch { /* not installed */ }

  console.log("Detecting environment...");
  console.log();

  step("ok",   "agentlint CLI", `[v${PKG_VERSION} installed]`);

  if (hasClaudeCode) {
    step("ok", "Claude Code", "[detected]");
  } else {
    step("skip", "Claude Code", "[not found — /al plugin skipped]");
  }

  if (isWin && hasBash) {
    step("ok", "bash (Windows)", "[Git Bash / WSL detected]");
  }

  if (!hasClaudeCode) {
    console.log();
    box([
      "agentlint CLI is ready.                              ",
      "                                                     ",
      "Run in any git repo:                                 ",
      "  agentlint check                                    ",
      "  agentlint fix                                      ",
      "  agentlint setup --lang ts                          ",
      "                                                     ",
      "To enable the /al Claude Code plugin:                ",
      "  https://claude.com/download                        ",
    ]);
    return;
  }

  // Run bundled install.sh for Claude Code plugin integration.
  console.log();
  console.log("Configuring Claude Code plugin...");
  console.log();

  try {
    execSync(`bash "${path.join(__dirname, "scripts", "install.sh")}"`, { stdio: "inherit" });
  } catch (err) {
    console.error(`\n  Installation failed: ${err.message}`);
    console.error("  Manual install:");
    console.error(`    bash "${path.join(__dirname, "scripts", "install.sh")}"`);
    console.error();
    process.exit(1);
  }
}

main();
