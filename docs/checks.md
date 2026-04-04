# Check Reference

## Findability

| ID | Name | What | Evidence | Fix |
|---|---|---|---|---|
| F1 | Entry file exists | Checks whether the repo has a standard entry file such as `CLAUDE.md`, `AGENTS.md`, or `.cursorrules`. | `anthropic-265`, `openai-agents` | Add a root entry file with the project purpose, workflow, and reading order. |
| F2 | Entry file describes the project | Checks whether the entry file explains what the project is in its opening lines. | `anthropic-265` | Put a plain-language project description near the top of the entry file. |
| F3 | Conditional loading guidance | Checks whether the entry file tells the agent what to read for specific tasks. | `anthropic-265`, `eth-zurich` | Add task-based guidance such as "if X, read Y first." |
| F4 | Large directories have index | Checks whether a directory with more than 10 content files has an `INDEX` file for navigation. | `anthropic-265` | Add an `INDEX` file that maps the important files in large directories. |
| F5 | All references resolve | Checks whether file references in the entry file point to files that actually exist. | `practical-audit`, `codified-context` | Fix or remove broken file references in the entry file and indexes. |
| F6 | Predictable file naming | Checks whether standard discovery files such as `README.md`, an entry file, and `CHANGELOG.md` are present. | `openai-agents`, `harness-engineering` | Use standard root filenames so tools and agents can find them without extra instructions. |
| F7 | Include directives resolve | Checks whether `@include` paths in the entry file point to files that exist. | `anthropic-265` | Fix or remove broken `@include` paths — missing targets are silently ignored. |

## Instructions

| ID | Name | What | Evidence | Fix |
|---|---|---|---|---|
| I1 | Emphasis keyword usage | Measures how often the entry file uses heavy emphasis words such as `IMPORTANT`, `MUST`, `NEVER`, and `CRITICAL`. | `anthropic-265` | Reduce emphasis keywords and keep only the ones with a real decision boundary. |
| I2 | Keyword density | Measures the density of emphasis keywords per 1,000 words in the entry file. | `anthropic-265`, `ifscale` | Rewrite the file to say fewer things more directly and remove repeated imperatives. |
| I3 | Rule specificity | Measures how many "Don't ..." rules also explain the correct alternative and reason. | `anthropic-265`, `agent-readmes` | Rewrite vague rules into concrete "Don't X. Instead Y. Because Z." guidance. |
| I4 | Action-oriented organization | Measures whether section headings focus on workflows and actions instead of identity or persona. | `anthropic-265` | Rename and reorganize sections around tasks, workflows, and operating rules. |
| I5 | No identity language | Checks whether the entry file avoids identity phrases such as "You are a ..." or "As an AI ...". | `anthropic-265` | Delete identity framing and keep only operational instructions. |
| I6 | Entry file length | Measures whether the entry file length stays in a concise, usable reference range. | `anthropic-265`, `codified-context`, `ifscale` | Trim the entry file or split detail into linked docs if it is too long. |
| I7 | Entry file size within limit | Checks whether the entry file is under 40,000 characters (Claude Code hard limit). | `anthropic-265` | Split the entry file into smaller files with `@include` directives. |

## Workability

| ID | Name | What | Evidence | Fix |
|---|---|---|---|---|
| W1 | Build/test commands documented | Checks whether the entry file includes commands the agent can run to build or test the project. | `openai-agents` | Add the exact build and test commands to the entry file. |
| W2 | CI exists | Checks whether the repo has GitHub Actions workflow files. | `harness-engineering` | Add CI workflows so key checks run mechanically. |
| W3 | Tests exist and are non-empty | Checks whether the repo actually contains test files, not just test commands or empty CI. | `practical-audit` | Add real test files that exercise the project behavior. |
| W4 | Linter configured | Checks whether a linter or formatter configuration is present. | `harness-engineering` | Configure a linter or formatter and keep it in the repo. |
| W5 | No oversized source files | Checks whether any source file exceeds 256 KB (Claude Code hard read limit). | `anthropic-265` | Split large files or move generated content out of the source tree. |
| W6 | Pre-commit hooks are fast | Estimates whether pre-commit hooks contain slow commands that would stall Claude Code commits. | `anthropic-265` | Remove slow commands from pre-commit hooks or move them to CI. |

## Continuity

| ID | Name | What | Evidence | Fix |
|---|---|---|---|---|
| C1 | Document freshness | Measures how far the entry file lags behind recent code changes. | `codified-context`, `harness-engineering` | Update the entry file when workflows, structure, or commands change. |
| C2 | Handoff information exists | Checks whether the repo contains handoff, progress, or status information for the next session. | `anthropic-265` | Add `HANDOFF.md` or equivalent progress notes in the repo. |
| C3 | Changelog has why | Checks whether the repo has a non-empty `CHANGELOG.md` that records changes for future sessions. | `anthropic-265` | Keep a changelog with short entries that explain why something changed. |
| C4 | Plans in repo | Checks whether plan directories exist in the repo, such as `docs/plans` or `plans`. | `harness-engineering` | Store execution plans in the repo instead of external tools only. |
| C5 | CLAUDE.local.md not tracked | Checks whether `CLAUDE.local.md` is properly gitignored (not committed to git). | `anthropic-265` | Add `CLAUDE.local.md` to `.gitignore` — it contains per-user private preferences. |

## Safety

| ID | Name | What | Evidence | Fix |
|---|---|---|---|---|
| S1 | Env files gitignored | Checks whether `.env` is in `.gitignore` to prevent secret exposure via AI tools. | `anthropic-265`, `practical-audit` | Add `.env` and `.env.*` to `.gitignore`. |
| S2 | Actions SHA pinned | Checks whether GitHub Actions use immutable SHA pins instead of floating tags. | `practical-audit` | Pin all `uses:` references to full 40-character SHA hashes. |
| S3 | Secret scanning configured | Checks whether gitleaks or pre-commit secret scanning is configured. | `practical-audit` | Add `.gitleaks.toml` or a pre-commit hook for secret detection. |
| S4 | Security policy exists | Checks whether `SECURITY.md` exists at the repo root. | `practical-audit` | Add `SECURITY.md` with vulnerability reporting instructions. |
| S5 | Workflow permissions minimized | Checks whether workflow-level `contents: write` is avoided in favor of job-level permissions. | `practical-audit` | Use `permissions: contents: read` at workflow level, elevate per-job only where needed. |
| S6 | No hardcoded secrets | Scans source files for hardcoded API keys, tokens, and private key patterns. | `practical-audit` | Move secrets to environment variables or a secrets manager. |
