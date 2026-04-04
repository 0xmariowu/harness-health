# AgentLint

[![CI](https://github.com/0xmariowu/agent-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/0xmariowu/agent-lint/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/0xmariowu/agent-lint)](https://github.com/0xmariowu/agent-lint/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Checks](https://img.shields.io/badge/checks-31-00b48c)](https://github.com/0xmariowu/agent-lint#what-it-checks)

**Lint your repo for AI agent compatibility.** 31 evidence-backed checks, one command.

> AI coding agents are only as good as the repo they work in. AgentLint checks what most developers miss — file structure, instruction quality, build setup, session continuity, and security posture. Every check backed by data, not opinions.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/0xmariowu/agent-lint/main/scripts/install.sh | bash
```

Then start a new Claude Code session:

```
/al
```

That's it. AgentLint scans your projects, scores them, shows what's wrong, and fixes what it can.

## What you get

```
$ /al

AgentLint — Score: 68/100

Findability      ██████████████░░░░░░  7/10
Instructions     ████████████████░░░░  8/10
Workability      ████████████░░░░░░░░  6/10
Safety           ██████████░░░░░░░░░░  5/10
Continuity       ██████████████░░░░░░  7/10

Fix Plan (7 items):
  [guided]   Pin 8 GitHub Actions to SHA (supply chain risk)
  [guided]   Add .env to .gitignore (AI exposes secrets)
  [assisted] Generate HANDOFF.md
  [guided]   Reduce IMPORTANT keywords (7 found, Anthropic uses 4)

Select items → AgentLint fixes → re-scores → saves HTML report
```

## Why this matters

AI coding agents don't just read your code — they read your repo structure, your docs, your CI config, your handoff notes. They also `git push`, trigger CI pipelines, and write files. A repo that's set up right gets dramatically better AI output. One that isn't wastes tokens, ignores rules, repeats mistakes, and may silently expose secrets or trigger vulnerable workflows.

The problem: **nobody knows what makes a repo AI-friendly.** Until now.

AgentLint is built on data from places most developers never look:

- **265 versions** of Anthropic's own Claude Code system prompt — we tracked every word they added, deleted, and rewrote
- **Claude Code source code** — we found the hard limits (40K char max, 256KB file read limit, pre-commit hook behavior) that silently break your setup
- **4,533 real repos** analyzed — 58% use floating Action tags, 92% have no SECURITY.md, 1% have `.env` committed
- **6 academic papers** on instruction-following, context file effectiveness, and documentation decay

## What it checks

### 🔍 Findability — can AI find what it needs?

| Check | What | Why |
|-------|------|-----|
| F1 | Entry file exists | No CLAUDE.md = AI starts blind |
| F2 | Project description in first 10 lines | AI needs context before rules |
| F3 | Conditional loading guidance | "If working on X, read Y" prevents context bloat |
| F4 | Large directories have INDEX | >10 files without index = AI reads everything |
| F5 | All references resolve | Broken links waste tokens on dead-end reads |
| F6 | Standard file naming | README.md, CLAUDE.md are auto-discovered |
| F7 | @include directives resolve | Missing targets are silently ignored — you think it's loaded, it isn't |

### 📝 Instructions — are your rules well-written?

| Check | What | Why |
|-------|------|-----|
| I1 | Emphasis keyword count | Anthropic cut IMPORTANT from 12 to 4 across 265 versions |
| I2 | Keyword density | More emphasis = less compliance. Anthropic: 7.5 → 1.4 per 1K words |
| I3 | Rule specificity | "Don't X. Instead Y. Because Z." — Anthropic's golden formula |
| I4 | Action-oriented headings | Anthropic deleted all "You are a..." identity sections |
| I5 | No identity language | "Follow conventions" removed — model already does this |
| I6 | Entry file length | 60-120 lines is the sweet spot. Longer dilutes priority |
| I7 | Under 40,000 characters | Claude Code hard limit. Above this, your file is truncated |

### 🔨 Workability — can AI build and test?

| Check | What | Why |
|-------|------|-----|
| W1 | Build/test commands documented | AI can't guess your test runner |
| W2 | CI exists | Rules without enforcement are suggestions |
| W3 | Tests exist (not empty shell) | A CI that runs pytest with 0 test files always "passes" |
| W4 | Linter configured | Mechanical formatting frees AI from guessing style |
| W5 | No files over 256 KB | Claude Code cannot read them — hard error |
| W6 | Pre-commit hooks are fast | Claude Code never uses --no-verify. Slow hooks = stuck commits |

### 🔄 Continuity — can next session pick up?

| Check | What | Why |
|-------|------|-----|
| C1 | Document freshness | Stale instructions are worse than no instructions |
| C2 | Handoff file exists | Without it, every session starts from zero |
| C3 | Changelog has "why" | "Updated INDEX" says nothing. "Fixed broken path" says everything |
| C4 | Plans in repo | Plans in Jira don't exist for AI |
| C5 | CLAUDE.local.md not in git | Private per-user file. Claude Code requires .gitignore |

### 🔒 Safety — is AI working securely?

| Check | What | Why |
|-------|------|-----|
| S1 | .env in .gitignore | AI's Glob tool ignores .gitignore by default — secrets are visible |
| S2 | Actions SHA pinned | AI push triggers CI. Floating tags = supply chain attack vector |
| S3 | Secret scanning configured | AI won't self-check for accidentally written API keys |
| S4 | SECURITY.md exists | AI needs security context for sensitive code decisions |
| S5 | Workflow permissions minimized | AI-triggered workflows shouldn't have write access by default |
| S6 | No hardcoded secrets | Detects `sk-`, `ghp_`, `AKIA`, private key patterns in source |

### 🧠 Optional: AI Deep Analysis

Spawns AI subagents to find what mechanical checks can't:
- Contradictory rules that confuse the model
- Dead-weight rules the model would follow without being told
- Vague rules without decision boundaries

### 📊 Optional: Session Analysis

Reads your Claude Code session logs to find:
- Instructions you repeat across sessions (should be in CLAUDE.md)
- Rules AI keeps ignoring (need rewriting)
- Friction hotspots by project

## How scoring works

Each check → score (0-1) → weighted by dimension → total out of 100.

| Dimension | Weight | Why? |
|-----------|--------|------|
| Instructions | 30% | Unique value. No other tool checks CLAUDE.md quality |
| Findability | 20% | AI can't follow rules it can't find |
| Workability | 20% | Can AI actually run your code? |
| Safety | 15% | Is AI working without exposing secrets or triggering vulnerabilities? |
| Continuity | 15% | Does knowledge survive across sessions? |

Scores are **measurements, not judgments**. Reference values come from Anthropic's own data. You decide what to fix.

## Update

```bash
claude plugin update agent-lint@agent-lint
```

## Evidence

Every check cites its source. No opinions, no best practices — data.

| Source | Type |
|--------|------|
| [Anthropic 265 versions](https://cchistory.mariozechner.at) | Primary dataset |
| Claude Code source code | Hard limits and internal behavior |
| [IFScale](https://arxiv.org/abs/2507.11538) (NeurIPS) | Instruction compliance at scale |
| [ETH Zurich](https://arxiv.org/abs/2602.11988) | Do context files help coding agents? |
| [Codified Context](https://arxiv.org/abs/2602.20478) | Stale content as #1 failure mode |
| [Agent READMEs](https://arxiv.org/abs/2511.12884) | Concrete vs abstract effectiveness |

Full citations in [`standards/evidence.json`](standards/evidence.json).

## Requirements

- [Claude Code](https://claude.com/download)
- `jq` and `node` 20+

## License

MIT
