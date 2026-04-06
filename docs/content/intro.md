---
title: Introduction
sidebar_position: 1
slug: /
---

# AgentLint

**Your AI agent is only as good as your repo.** AgentLint finds what's broken — file structure, instruction quality, build setup, session continuity, security posture — and fixes it. 33 checks, every one backed by data.

> We analyzed 265 versions of Anthropic's Claude Code system prompt, documented the hard limits, audited thousands of real repos, and reviewed the academic research. The result: a single command that tells you exactly what your AI agent is struggling with and why.

## Install

```bash
npm install -g @0xmariowu/agent-lint
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

The HTML report shows a segmented gauge, expandable dimension breakdowns with per-check detail, and a prioritized issues list. Before/after comparison when fixes are applied.

![AgentLint report](/img/report-example.png)

## Why this matters

AI coding agents read your repo structure, docs, CI config, and handoff notes. They `git push`, trigger pipelines, and write files. A well-structured repo gets dramatically better AI output. A poorly structured one wastes tokens, ignores rules, repeats mistakes, and may expose secrets.

AgentLint is built on data most developers never see:

- **265 versions** of Anthropic's Claude Code system prompt — every word added, deleted, and rewritten
- **Claude Code internals** — hard limits (40K char max, 256KB file read limit, pre-commit hook behavior) that silently break your setup
- **Production security audits** across open-source codebases — the gaps AI agents walk into
- **6 academic papers** on instruction-following, context files, and documentation decay

## How scoring works

Each check produces a 0-1 score, weighted by dimension, scaled to 100.

| Dimension | Weight | Why? |
|-----------|--------|------|
| Instructions | 30% | Unique value. No other tool checks CLAUDE.md quality |
| Findability | 20% | AI can't follow rules it can't find |
| Workability | 20% | Can AI actually run your code? |
| Safety | 15% | Is AI working without exposing secrets or triggering vulnerabilities? |
| Continuity | 15% | Does knowledge survive across sessions? |

Scores are measurements, not judgments. Reference values come from Anthropic's own data. You decide what to fix.

## Evidence

Every check cites its source. Full citations in [`standards/evidence.json`](https://github.com/0xmariowu/AgentLint/blob/main/standards/evidence.json).

| Source | Type |
|--------|------|
| [Anthropic 265 versions](https://cchistory.mariozechner.at) | Primary dataset |
| Claude Code internals | Hard limits and observed behavior |
| [IFScale](https://arxiv.org/abs/2507.11538) (NeurIPS) | Instruction compliance at scale |
| [ETH Zurich](https://arxiv.org/abs/2602.11988) | Do context files help coding agents? |
| [Codified Context](https://arxiv.org/abs/2602.20478) | Stale content as #1 failure mode |
| [Agent READMEs](https://arxiv.org/abs/2511.12884) | Concrete vs abstract effectiveness |

## Requirements

- [Claude Code](https://claude.com/download)
- `jq` and `node` 20+

## Update

```bash
npm update -g @0xmariowu/agent-lint
```
