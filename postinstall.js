#!/usr/bin/env node
"use strict";

const { execFileSync, execSync } = require("child_process");
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
  if (process.env.npm_lifecycle_event === "postinstall") {
    console.log("AgentLint npm package installed; agentlint CLI is on PATH.");
    console.log("To wire up the Claude Code plugin, run: npx agentlint-ai install");
    process.exit(0);
  }

  // Support `npx agentlint-ai`, `npx agentlint-ai init`, and `npx agentlint-ai install`.
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] !== "init" && args[0] !== "install") {
    console.error("Usage: npx agentlint-ai [init|install]");
    process.exit(1);
  }

  console.log(LOGO);
  console.log("\x1b[1mAgentLint v" + PKG_VERSION + "\x1b[0m — The linter for your agent harness");
  console.log("─".repeat(62));
  console.log("\x1b[36mPrivacy by mode:\x1b[0m");
  console.log("\x1b[36m  Core scan / GitHub Action — local only. No network, no AI.\x1b[0m");
  console.log("\x1b[36m  Deep (opt-in)   — sends selected entry files to a Claude sub-agent.\x1b[0m");
  console.log("\x1b[36m  Session (opt-in)— reads local ~/.claude/projects logs; output redacted by default.\x1b[0m");
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

  step("ok",   "agentlint CLI", `[v${PKG_VERSION} available]`);

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
      "AgentLint init completed.                            ",
      "                                                     ",
      "Claude Code not found; /al plugin skipped.           ",
      "                                                     ",
      "For a persistent CLI, run:                          ",
      "  npm install -g agentlint-ai                        ",
      "                                                     ",
      "Then run in any git repo:                           ",
      "  agentlint check                                    ",
      "  agentlint fix W11                                  ",
      "  agentlint setup --lang ts .                        ",
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

  const installPath = path.join(__dirname, "scripts", "install.sh");

  try {
    execFileSync("bash", [installPath], { stdio: "inherit" });
  } catch (err) {
    console.error(`\n  Installation failed: ${err.message}`);
    console.error("  npm package installed; CLI works when agentlint is on PATH.");
    console.error("  Claude plugin install failed, so /al is not available yet.");
    console.error("  Manual install:");
    console.error(`    bash "${installPath}"`);
    console.error();
    process.exit(1);
  }
}

main();
