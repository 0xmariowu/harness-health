<div align="center">

<h1>AgentLint</h1>

<p><strong>The linter for your agent harness.</strong></p>
<p><em>ESLint was for the code humans wrote.<br/>AgentLint is for the context agents read.</em></p>

[![CI](https://github.com/0xmariowu/AgentLint/actions/workflows/ci.yml/badge.svg)](https://github.com/0xmariowu/AgentLint/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/0xmariowu/AgentLint)](https://github.com/0xmariowu/AgentLint/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Checks](https://img.shields.io/badge/checks-58-00b48c)](#what-it-checks)
[![npm](https://img.shields.io/npm/v/agentlint-ai)](https://www.npmjs.com/package/agentlint-ai)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-cc785c)](https://claude.com/download)

<p><a href="https://www.agentlint.app"><strong>🌐 Site</strong></a> · <a href="https://www.agentlint.app/blog">Blog</a> · <a href="#install">Install</a> · <a href="#what-you-get">Demo</a> · <a href="#the-harness-problem">Harness 101</a> · <a href="#what-it-checks">Checks</a> · <a href="#evidence">Evidence</a> · <a href="#faq">FAQ</a> · <a href="README_CN.md">中文</a></p>

</div>

---

> **Agent = Model + Harness.** The model isn't the bottleneck anymore — the harness is.
>
> Your `AGENTS.md`, `CLAUDE.md`, CI config, hooks, and `.gitignore` *are* the harness. When they're wrong, Claude Code, Cursor, and Codex ship AI slop. When they're right, agents compound.
>
> AgentLint scores your harness across **51 deterministic checks on 6 core dimensions**, plus **7 opt-in extended checks** (Deep + Session) that use AI sub-agents and local Claude Code session logs when available. Evidence-backed. Zero opinions.

> 📚 **Full docs, 20+ long-form guides, and the complete check catalog live at [agentlint.app](https://www.agentlint.app/).** Highlights: [Writing a Good CLAUDE.md](https://www.agentlint.app/blog/writing-a-good-claude-md) · [The 33-Check Catalog](https://www.agentlint.app/blog/the-33-checks-every-claude-md-should-pass) · [AGENTS.md vs CLAUDE.md](https://www.agentlint.app/blog/agents-md-vs-claude-md) · [中文博客](https://www.agentlint.app/zh/blog).

## Install

```bash
npm install -g agentlint-ai           # CLI only — no Claude plugin yet
npx agentlint-ai install              # opt-in: register /al Claude Code plugin
```

> The first command installs the `agentlint` CLI on `$PATH` and does **not** touch `~/.claude/`. The second command (one-time, opt-in) detects Claude Code, copies the `/al` slash command into `~/.claude/commands/`, and registers the marketplace plugin. Side-effect details and uninstall path in [INSTALL.md](./INSTALL.md#side-effects).

Then in any git repo:

```bash
agentlint check
```

In Claude Code (after running `npx agentlint-ai install`): run `/al` for the interactive scan-fix-report flow.

> **Using an AI coding agent?** Point it at [INSTALL.md](./INSTALL.md) — it's written to be read once and acted on.

## What you get

```
$ /al

AgentLint — Score: 72/100 (core)

Findability      ██████████████░░░░░░  7/10
Instructions     ████████████████░░░░  8/10
Workability      ████████████░░░░░░░░  6/10
Safety           ██████████░░░░░░░░░░  5/10
Continuity       ██████████████░░░░░░  7/10
Harness          ████████████████████  10/10
Deep             ░░░░░░░░░░░░░░░░░░░░  n/a   (opt-in)
Session          ░░░░░░░░░░░░░░░░░░░░  n/a   (opt-in)

Fix Plan (7 items):
  [guided]   Pin 8 GitHub Actions to SHA (supply chain risk)
  [guided]   Add .env to .gitignore (AI exposes secrets)
  [assisted] Generate HANDOFF.md
  [guided]   Reduce IMPORTANT keywords (7 found, Anthropic uses 4)

Select items → AgentLint fixes → re-scores → saves HTML report
```

## The harness problem

In February 2026, Mitchell Hashimoto (HashiCorp) coined the term. OpenAI's Ryan Lopopolo formalized it days later. LangChain's Vivek Trivedy gave it the cleanest definition:

> **Agent = Model + Harness.** If you're not the model, you're the harness.

The **harness** is every piece of code, configuration, and instruction that wraps an LLM and turns it into an agent. For coding agents, your harness includes:

- `AGENTS.md` / `CLAUDE.md` — the persistent rules injected at session start
- `.cursor/rules/`, `.github/copilot-instructions.md` — tool-specific instruction layers
- CI, pre-commit hooks, `.gitignore` — the deterministic constraints the agent can't override
- `SECURITY.md`, changelogs, handoff notes — the context that survives across sessions

**Harness engineering** is the discipline of designing those pieces so the agent stays reliable across hundreds of tool calls, not just the first ten.

The research is blunt:

- Anthropic's **2026 Agentic Coding Trends Report** found that teams maintaining a good context file report **40% fewer "bad suggestion" sessions**
- **DORA 2025 State of AI-Assisted Software Development** reached the same conclusion: AI is an amplifier — it accelerates teams with good harnesses and amplifies dysfunction in teams without them
- An **ETH Zurich study** found that *auto-generated* context files actually **reduce** agent success rates in 5 of 8 tested settings, and increase inference cost by **20–23%**
- A randomized controlled trial found developers using AI were **19% slower** on complex tasks — while believing they were 20% faster
- LangChain's February 2026 report: **70% of agent performance lives outside the model**. Same weights, different harness, different results.

Translation: a bad harness is worse than no harness. And almost nobody knows what a good one looks like.

**AgentLint is the first linter for the harness itself.**

## What makes AgentLint different

Every check is backed by data, not opinions. The data comes from places most developers never look — and it's what lets us measure harness health rigorously:

- **265 versions** of Anthropic's own Claude Code system prompt — we tracked every single word they added, deleted, and rewrote. When they cut `IMPORTANT` from 12 uses to 4, we knew. When they removed every "You are a helpful assistant..." identity section, we knew.
- **Claude Code source code** — which is where the harness hard limits live. 40,000-character entry files get silently truncated. 256 KB files can't be read at all. Pre-commit hooks that take too long cause commits to hang forever because Claude Code never uses `--no-verify`.
- **Real production audits** across open-source codebases — the security gaps that agents walk straight into.
- **6 academic papers** on instruction compliance, context-file effectiveness, and documentation decay.

If a check can't cite a source, it doesn't ship.

## What it checks

**58 checks total: 51 deterministic core checks across 6 dimensions (always run), plus 7 opt-in extended checks** (Deep: 3 AI-powered analysis checks; Session: 4 Claude Code log-reading checks). Default `agentlint check` and the GitHub Action only run the 51 core checks — the extended ones need AI sub-agents or local Claude Code session logs, so they're opt-in via `/al` inside Claude Code.

The total score is averaged only over dimensions that actually ran. A default CI run shows `Score: NN/100 (core)` and marks Deep/Session as `n/a`, never as `0/10`. When extended checks do run, the header shows `(core+extended)`.

### 🔍 Findability — can AI find what it needs? *(20%)*

| Check | What | Why |
| --- | --- | --- |
| F1 | Entry file exists | No CLAUDE.md / AGENTS.md = AI starts blind |
| F2 | Project description in first 10 lines | AI needs context before rules |
| F3 | Conditional loading guidance | "If working on X, read Y" prevents context bloat |
| F4 | Large directories have INDEX | >10 files without index = AI reads everything |
| F5 | All references resolve | Broken links waste tokens on dead-end reads |
| F6 | Standard file naming | README.md, CLAUDE.md are auto-discovered |
| F7 | `@include` directives resolve | Missing targets are silently ignored — you think it's loaded, it isn't |
| F8 | Rule file frontmatter uses globs | `.cursor/rules/` MDC files should match glob patterns, not exact paths |
| F9 | No unfilled template placeholders | `{{variables}}` left in context files waste tokens and confuse the model |

### 📝 Instructions — are your rules well-written? *(25% — highest weight)*

| Check | What | Why |
| --- | --- | --- |
| I1 | Emphasis keyword count | Anthropic cut `IMPORTANT` from 12 to 4 across 265 versions |
| I2 | Keyword density | More emphasis = less compliance. Anthropic: 7.5 → 1.4 per 1K words |
| I3 | Rule specificity | "Don't X. Instead Y. Because Z." — Anthropic's golden formula |
| I4 | Action-oriented headings | Anthropic deleted all "You are a..." identity sections |
| I5 | No identity language | "Follow conventions" removed — model already does this |
| I6 | Entry file length | 60–120 lines is the sweet spot. Longer dilutes priority |
| I7 | Under 40,000 characters | Claude Code hard limit. Above this, your file is truncated — silently |
| I8 | Total injected content within budget | All auto-injected files stay within the 200K context budget |

### 🔨 Workability — can AI build and test? *(18%)*

| Check | What | Why |
| --- | --- | --- |
| W1 | Build/test commands documented | AI can't guess your test runner |
| W2 | CI exists | Rules without enforcement are suggestions |
| W3 | Tests exist (not empty shell) | A CI that runs `pytest` with 0 test files always "passes" |
| W4 | Linter configured | Mechanical formatting frees AI from guessing style |
| W5 | No files over 256 KB | Claude Code cannot read them — hard error |
| W6 | Pre-commit hooks are fast | Claude Code never uses `--no-verify`. Slow hooks = stuck commits |
| W7 | Local fast test command documented | Entry file documents a fast (<30s) test command for mid-session verification |
| W8 | npm test script exists | JS/Node repos need `npm test` so AI can run tests without guessing |
| W9 | Release workflow validates version consistency | Automated drift detection across package.json, CHANGELOG, and badges |
| W10 | Test cost tiers defined (pytest markers) | `@pytest.mark.fast` lets AI run the cheap subset, not the full 10-minute suite |
| W11 | feat/fix commits paired with test commits | Gate that catches features landing without corresponding tests |

### 🔄 Continuity — can the next session pick up? *(12%)*

| Check | What | Why |
| --- | --- | --- |
| C1 | Document freshness | Stale instructions are worse than no instructions |
| C2 | Handoff file exists | Without it, every session starts from zero |
| C3 | Changelog has "why" | "Updated INDEX" says nothing. "Fixed broken path" says everything |
| C4 | Plans in repo | Plans in Jira don't exist for AI |
| C5 | `CLAUDE.local.md` not in git | Private per-user file — must be in `.gitignore` |
| C6 | HANDOFF.md has verify conditions | Notes with evidence (`score ≥ X`, `tests pass`) let the next session skip full re-audit |

### 🔒 Safety — is AI working securely? *(15%)*

| Check | What | Why |
| --- | --- | --- |
| S1 | `.env` in `.gitignore` | AI's Glob tool ignores `.gitignore` by default — secrets visible |
| S2 | Actions SHA pinned | AI push triggers CI. Floating tags = supply chain attack vector |
| S3 | Secret scanning configured | AI won't self-check for accidentally written API keys |
| S4 | `SECURITY.md` exists | AI needs security context for sensitive code decisions |
| S5 | Workflow permissions minimized | AI-triggered workflows shouldn't have write access by default |
| S6 | No hardcoded secrets | Detects `sk-`, `ghp_`, `AKIA`, private key patterns in source |
| S7 | No personal paths in source | Absolute home-dir paths leak machine identity and break on other machines |
| S8 | No `pull_request_target` trigger | Runs in privileged context — supply chain attack vector for external PRs |
| S9 | No personal email in git history | Personal email in commits is a privacy and identity leak |

### ⚙️ Harness — is your Claude Code setup correct? *(10%)*

| Check | What | Why |
| --- | --- | --- |
| H1 | Hook event names valid | `PoToolUse` vs `PostToolUse` — typos silently prevent hooks from ever firing |
| H2 | PreToolUse hooks have matcher | Without a tool matcher, the hook runs before *every* tool call |
| H3 | Stop hook has circuit breaker | Stop hooks without an exit condition run forever |
| H4 | No dangerous auto-approve | `*` or `.*` grant unlimited tool execution with no human check |
| H5 | Env deny coverage complete | Missing deny patterns let secrets leak to untrusted tools |
| H6 | Hook scripts network access | Outbound calls from hooks can exfiltrate data triggered by the agent |
| H7 | Gate workflows are blocking | Warn-only CI gates are effectively disabled — agents merge despite failures |
| H8 | Hook errors use structured format | `what/rule/fix` lets the agent self-correct; unstructured errors leave it stuck |

### 🧠 Deep — AI-powered instruction analysis *(opt-in, extended)*

Spawns AI subagents to find what pattern-matching can't:

| Check | What | Why |
| --- | --- | --- |
| D1 | Contradictory rules | Two rules that conflict cause the model to pick one — usually the wrong one |
| D2 | Dead-weight rules | Rules the model would follow anyway waste tokens and dilute priority |
| D3 | Vague rules without decision boundary | "Use good judgment" gives the model nothing to evaluate against |

### 📊 Session — learn from your Claude Code logs *(opt-in, extended)*

Reads your session history to surface patterns you'd never notice manually:

| Check | What | Why |
| --- | --- | --- |
| SS1 | Repeated instructions | Instructions you type every session belong in `CLAUDE.md` |
| SS2 | Ignored rules | Rules AI keeps bypassing need rewriting, not repeating |
| SS3 | Friction hotspots | Which projects and tasks generate the most re-work |
| SS4 | Missing rule suggestions | Common corrections that aren't captured anywhere yet |

## How is this different from `/init`?

`/init` generates a template `CLAUDE.md` from scratch. Useful on day one. **Useless on day fifty** — when the file is stale, bloated with emphasis keywords the model ignores, missing `.env` in `.gitignore`, and silently exceeds the 40K hard limit.

`/init` writes a file. AgentLint audits the whole system:

| | `/init` | AgentLint |
|---|:---:|:---:|
| Generates template `CLAUDE.md` | ✅ | — |
| Checks entry-file quality | — | ✅ |
| Finds broken `@include` references | — | ✅ |
| Enforces the 40K character hard limit | — | ✅ |
| Audits CI, hooks, `.gitignore`, Actions SHA pinning | — | ✅ |
| Detects instruction rot over time | — | ✅ |
| Audits Claude Code hook configuration | — | ✅ |
| Auto-fixes what it can | — | ✅ |
| Every check backed by a cited data source | — | ✅ |

## Who this is for

- **Solo developers** using Claude Code, Cursor, or Codex who want the agent to stop ignoring your rules
- **Team leads** who need every repo in the org to be AI-ready before agents ship to prod
- **OSS maintainers** whose external contributors (and their agents) should write code in your style
- **Security-conscious engineers** worried about agents exfiltrating `.env` or triggering vulnerable workflows

## Compatibility

AgentLint ships as a **Claude Code plugin** and standalone **CLI**. When it runs, it audits any of the following if present in your repo:

- `CLAUDE.md` (Anthropic's Claude Code)
- `AGENTS.md` (the universal standard — used by OpenAI Codex, Cursor, Windsurf, Kilo, GitHub Copilot, Gemini CLI, and [60,000+ open-source repos](https://agents.md/))
- `.cursor/rules/`
- `.github/copilot-instructions.md`

**Roadmap:** native Cursor and Codex integrations. [Star the repo](https://github.com/0xmariowu/AgentLint) to follow.

## Update

```bash
npm install -g agentlint-ai
```

Or update the Claude Code plugin directly:

```bash
claude plugin update agent-lint@agent-lint
```

## Evidence

Every check cites its source. No opinions, no best practices — data.

| Source | Type |
| --- | --- |
| [Anthropic 265 prompt versions](https://cchistory.mariozechner.at) | Primary dataset |
| Claude Code source code | Hard limits and internal behavior |
| [IFScale (NeurIPS)](https://arxiv.org/abs/2507.11538) | Instruction compliance at scale |
| [ETH Zurich](https://arxiv.org/abs/2602.11988) | Do context files help coding agents? |
| [Codified Context](https://arxiv.org/abs/2602.20478) | Stale content as #1 failure mode |
| [Agent READMEs](https://arxiv.org/abs/2511.12884) | Concrete vs abstract effectiveness |

Full citations in [`standards/evidence.json`](https://github.com/0xmariowu/AgentLint/blob/main/standards/evidence.json).

## FAQ

<details>
<summary><strong>What exactly is an "agent harness"?</strong></summary>

The term got popular in early 2026 (Mitchell Hashimoto, OpenAI, LangChain). Shortest definition: <strong>Agent = Model + Harness</strong>. The harness is everything that wraps an LLM and turns it into an agent — tools, state management, feedback loops, and the persistent rules it reads at session start. For coding agents, that last part is your <code>AGENTS.md</code>, <code>CLAUDE.md</code>, <code>.cursor/rules</code>, CI, pre-commit hooks, and <code>.gitignore</code>. AgentLint is the first linter built specifically to audit that layer.
</details>

<details>
<summary><strong>Why not just use <code>/init</code> and call it a day?</strong></summary>

See the table above. `/init` writes a file; it doesn't audit your repo. AgentLint does 51 deterministic checks across 6 core dimensions (plus 7 opt-in extended checks) — and fixes what it finds.
</details>

<details>
<summary><strong>Does this work with Cursor, Codex, or GitHub Copilot?</strong></summary>

Today AgentLint runs *inside* Claude Code, but the checks apply to repo assets every agent reads: `AGENTS.md`, `.cursor/rules`, `.github/copilot-instructions.md`. A well-linted repo makes every agent better, not just Claude. Native Cursor and Codex integrations are on the roadmap.
</details>

<details>
<summary><strong>Is my code sent anywhere?</strong></summary>

It depends on which mode you run. The default (`agentlint check` and the GitHub Action) is local-only and runs zero AI. The two opt-in extended modes do touch AI or local session logs — we spell it out so there's no surprise:

| Mode | Data accessed | Network / AI |
|------|---------------|--------------|
| `agentlint check` (default) | files in the repo being scanned | **Local only, no AI** |
| GitHub Action | files in the checked-out repo inside the runner | **Local only, no AI** |
| `/al` (core dims only) | git repos under the configured `PROJECTS_ROOT` | **Local only, no AI** |
| `/al` with Deep (opt-in) | selected entry files (e.g. `CLAUDE.md`) | **Sends file contents to a Claude sub-agent** |
| `/al` with Session (opt-in) | `~/.claude/projects/` logs on your machine | Local analyzer. Output is redacted by default; raw snippets require `--include-raw-snippets` |

Deep is the only mode that transmits file contents off your machine, and it only runs when you explicitly ask for it inside Claude Code. Everything the default scan produces — the `Score: NN/100 (core)` output, the JSONL, the SARIF, the GitHub Action annotations — comes from pattern checks on disk, no API calls.
</details>

<details>
<summary><strong>Does <code>npm install</code> write outside node_modules?</strong></summary>

**No.** `npm install -g agentlint-ai` only installs the `agentlint` CLI to npm's global prefix (just like any other CLI tool). The Claude Code plugin install is **opt-in**: run `npx agentlint-ai install` (one-time) to detect Claude Code and register the `/al` slash command in `~/.claude/commands/`. The CLI works without that step; the `/al` slash command does not.

Failure-mode fallbacks live in [INSTALL.md](./INSTALL.md).
</details>

<details>
<summary><strong>Isn't this just "best practices"?</strong></summary>

No. Every check cites a specific source — Anthropic's 265 prompt versions, Claude Code source code, peer-reviewed papers, or real production audits. If a check can't be backed by data, it doesn't ship.
</details>

<details>
<summary><strong>Why do you lint <code>AGENTS.md</code> if this is a Claude Code plugin?</strong></summary>

Because good context engineering is cross-tool. If you're using any combination of Claude Code, Cursor, and Codex, the same `AGENTS.md` serves all of them. AgentLint checks it against the same evidence base regardless of which agent ends up reading it.
</details>

<details>
<summary><strong>How long does a scan take?</strong></summary>

Under 5 seconds for most repos. The Deep and Session dimensions take longer because they spawn subagents or read session logs.
</details>

## Requirements

- Node 20+
- `jq`
- [Claude Code](https://claude.com/download) (for `/al` plugin and Deep/Session analysis)

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

---

<div align="center">

**If AgentLint saved you from one bad agent session, please [⭐ star the repo](https://github.com/0xmariowu/AgentLint)** — it's how we find out it's useful.

<sub>Built by <a href="https://github.com/0xmariowu">@0xmariowu</a> · <a href="https://www.agentlint.app/">agentlint.app</a></sub>

</div>
