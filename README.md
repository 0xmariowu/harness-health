# Harness Health

[![CI](https://github.com/0xmariowu/harness-health/actions/workflows/ci.yml/badge.svg)](https://github.com/0xmariowu/harness-health/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/0xmariowu/harness-health)](https://github.com/0xmariowu/harness-health/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Check if your repo is AI-friendly.** One command: scan, score, fix.

20 evidence-backed checks across findability, instruction quality, workability, and continuity. Based on [Anthropic's 265 Claude Code system prompt versions](https://cchistory.mariozechner.at), academic research, and real-world audits.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/0xmariowu/harness-health/main/scripts/install.sh | bash
```

Then start a new Claude Code session and run:

```
/hh
```

### Update

```bash
claude plugin update harness-health@harness-health
```

### Requirements

- Claude Code
- `jq`
- `node` 20+

## What it does

```
$ /hh

🏥 Harness Health — Score: 72/100

Findability      ██████████████░░░░░░  7/10
Instructions     ████████████████░░░░  8/10
Workability      ████████████░░░░░░░░  6/10
Continuity       ██████████████░░░░░░  7/10

📋 Fix Plan (5 items):
  [auto]     Remove 12 broken INDEX references
  [assisted] Generate HANDOFF.md for session continuity
  [guided]   Reduce IMPORTANT keywords (7 found, Anthropic uses 4)

Select items to fix → HH executes automatically → re-scores
```

## What it checks

Four dimensions, 20 evidence-backed checks:

### Findability — can AI find what it needs?

| Check | What | Evidence |
|-------|------|----------|
| F1 | Entry file exists (CLAUDE.md / AGENTS.md) | Anthropic auto-loads CLAUDE.md. OpenAI uses 88 AGENTS.md files. |
| F2 | Entry file describes the project | AI-Friendly Standard: "answers three questions — nothing more" |
| F3 | Conditional loading guidance | ETH Zurich: generic overviews hurt performance, targeted loading helps |
| F4 | Large directories have index | Directories with >10 files need INDEX for navigation |
| F5 | All file references resolve | Broken links waste tokens on dead-end reads |
| F6 | Predictable file naming | Standard names (README.md, CLAUDE.md) are auto-discovered |

### Instruction Quality — are your rules well-written?

| Check | What | Evidence |
|-------|------|----------|
| I1 | Emphasis keyword count | Anthropic: IMPORTANT 12→4, MUST 7→1 across 265 versions |
| I2 | Keyword density | Anthropic: 7.5→1.4 per 1K words. IFScale: 500 rules → 69% compliance |
| I3 | Rule specificity ratio | Anthropic golden formula: "Don't X. Instead Y. Because Z." |
| I4 | Action-oriented structure | Anthropic deleted all identity sections ("You are a...") |
| I5 | No identity language | "Follow coding conventions" deleted — model already does this |
| I6 | Entry file length | Reference points: 60-120 lines typical, 660 lines (Codified Context) |

### Workability — can AI build and test?

| Check | What | Evidence |
|-------|------|----------|
| W1 | Build/test commands in docs | GitHub: build/test commands are one of 6 core AGENTS.md areas |
| W2 | CI exists | Harness Engineering: "Put rules in CI, not just docs" |
| W3 | Tests exist (not empty shell) | Real audit: project had CI running pytest but 0 test files |
| W4 | Linter configured | Mechanical enforcement frees AI from guessing conventions |

### Continuity — can next session pick up?

| Check | What | Evidence |
|-------|------|----------|
| C1 | Document freshness | Codified Context paper: stale content is #1 failure mode |
| C2 | Handoff info exists | Anthropic: "structured progress files for session continuity" |
| C3 | Changelog has "why" | "Updated INDEX" says nothing. "Fixed broken path" says everything. |
| C4 | Plans in repo | Harness Engineering: "Plans in Jira don't exist for AI" |

### Optional: AI Deep Analysis

- Find contradictory rules
- Find dead-weight rules (AI follows without being told)
- Find vague rules without decision boundaries

### Optional: Session Analysis

- Detect instructions you repeat across sessions
- Find rules that AI keeps ignoring
- Identify friction hotspots by file/directory

## How scoring works

Each check produces a score (0-1). Checks are weighted within dimensions. Dimensions are weighted for the total:

| Dimension | Weight | Why |
|-----------|--------|-----|
| Instructions | 35% | Unique value — evidence-based CLAUDE.md quality assessment |
| Findability | 25% | Foundation — AI can't work if it can't find things |
| Workability | 20% | Essential — build/test capability |
| Continuity | 20% | Important — session-to-session handoff |

Scores are **measurements, not judgments**. Reference values come from Anthropic's data. You decide what to fix.

## Evidence sources

Every check is backed by empirical data:

- **Anthropic 265 versions** — Primary dataset: cchistory.mariozechner.at
- **IFScale** (NeurIPS, arXiv:2507.11538) — Instruction compliance at scale
- **ETH Zurich** (arXiv:2602.11988) — Do context files help coding agents?
- **Codified Context** (arXiv:2602.20478) — Stale content as #1 failure mode
- **Agent READMEs** (arXiv:2511.12884) — Concrete vs abstract instruction effectiveness
- **Harness Engineering Guide** — Industry practice for AI-friendly environments

Full citations in `standards/evidence.json`.

## License

MIT
