# Check Specification — Scanner Decision Rules

Extracted from `src/scanner.sh`. Use this to label repos for F002 accuracy testing.
For each check: **pass** = score > 0, **fail** = score == 0, **na** = check skipped.

## Findability

### F1: Entry file exists
- **pass**: `CLAUDE.md`, `AGENTS.md`, or `.cursorrules` exists in repo root
- **fail**: none of the above exist
- How to verify: `ls {CLAUDE.md,AGENTS.md,.cursorrules} 2>/dev/null`

### F2: Entry file describes the project
- **pass**: first 10 lines of entry file contain a heading (`#`) or a sentence > 20 chars
- **fail**: entry file exists but no description in first 10 lines
- **na**: no entry file (F1 fail)
- How to verify: `head -10 CLAUDE.md` — look for project description

### F3: Conditional loading guidance
- **pass**: entry file contains "if.*read", "Session Checklist", or "checklist" (case-insensitive)
- **fail**: none of those patterns found
- **na**: no entry file
- How to verify: `grep -Ei 'if.*read|Session Checklist|checklist' CLAUDE.md`

### F4: Large directories have index
- **pass**: root has <= 10 non-hidden files OR an INDEX file exists
- **fail**: root has > 10 non-hidden files and no INDEX file
- How to verify: `ls -1 | grep -v '^\.' | wc -l` + check for INDEX*

### F5: All references resolve
- **pass**: all markdown links `[text](path)` in entry file point to existing files
- **fail**: any markdown link points to a non-existent path
- **na**: no entry file
- Scope: only `[text](path)` links, not bare paths or inline code
- How to verify: extract `[...](...)` from entry file, check each path exists

### F6: Predictable file naming
- **pass**: README.md AND entry file AND CHANGELOG.md all exist
- **fail**: any of the three missing
- How to verify: `ls README.md CLAUDE.md CHANGELOG.md 2>/dev/null`

### F7: @include directives resolve
- **pass**: no `@` directives in entry file, OR all `@path` targets exist
- **fail**: `@path/to/file` in entry file but target doesn't exist
- **na**: no entry file
- Pattern matched: lines starting with `@` followed by a path
- How to verify: `grep '^@' CLAUDE.md` then check each path

## Instructions

### I1: Emphasis keyword count
- **pass**: score > 0 (partial scores allowed) — each keyword (IMPORTANT, NEVER, MUST, CRITICAL) scored against Anthropic reference values. Score = average of 4 sub-scores.
- **fail**: score == 0 (all keywords massively exceed reference)
- **na**: no entry file
- Reference values: from `standards/reference-thresholds.json` I1_emphasis
- How to verify: `grep -cow 'IMPORTANT\|NEVER\|MUST\|CRITICAL' CLAUDE.md`

### I2: Keyword density
- **pass**: keywords per 1K words <= reference threshold
- **fail**: density exceeds reference
- **na**: no entry file
- How to verify: count emphasis keywords / word count * 1000

### I3: Rule specificity (Don't/Because formula)
- **pass**: > 0% of "Don't" rules have a "Because:" explanation
- **fail**: file has "Don't" rules but 0% have "Because:"
- Score: ratio of Don't-with-Because / total-Don't
- **na**: no entry file or no "Don't" rules
- How to verify: `grep -c "Don't"` + `grep -c "Because:"`

### I4: Action-oriented headings
- **pass**: > 50% of headings use action words (## Rules, ## Workflow, ## How to)
- **fail**: > 50% use identity/description words (## About, ## Introduction, ## Overview)
- Score: ratio of action headings / total headings
- **na**: no entry file
- Identity keywords: about, introduction, overview, description, who, philosophy, you are, personality
- Action keywords: rules, workflow, how, when, commands, setup, getting started, checklist

### I5: No identity language
- **pass**: 0 instances of identity patterns ("You are a", "Act as a", "Your role is")
- **fail**: >= 1 instance found
- **na**: no entry file
- How to verify: `grep -Ei 'you are a|act as a|your role is|behave as|you should always' CLAUDE.md`

### I6: Entry file length
- **pass**: partial score based on line count vs reference range (60-120 lines sweet spot)
- **fail**: score == 0 means file is extremely long or extremely short
- **na**: no entry file
- How to verify: `wc -l CLAUDE.md`

### I7: Entry file size within 40,000 characters
- **pass**: entry file < 40,000 characters
- **fail**: entry file >= 40,000 characters
- **na**: no entry file
- How to verify: `wc -c CLAUDE.md`

## Workability

### W1: Build/test commands documented
- **pass**: entry file contains backtick-quoted commands (`npm test`, `pytest`, etc.)
- **fail**: no commands found in entry file
- **na**: no entry file
- How to verify: look for inline code blocks with tool names (npm, pytest, make, etc.)

### W2: CI exists
- **pass**: `.github/workflows/` contains >= 1 YAML file
- **fail**: no workflow files found
- How to verify: `ls .github/workflows/*.yml 2>/dev/null | wc -l`

### W3: Tests exist (non-empty)
- **pass**: >= 1 test file found (in tests/, test/, __tests__/, spec/, or *.test.*, *.spec.*)
- **fail**: 0 test files
- How to verify: `find . -path '*/tests/*' -o -path '*/test/*' -o -name '*.test.*' | head -1`

### W4: Linter configured
- **pass**: linter config file exists (eslint*, .prettierrc*, pyrightconfig*, .rubocop*, .golangci*, pyproject.toml with [tool.ruff])
- **fail**: no linter config found in repo root
- How to verify: `ls .eslint* .prettierrc* pyrightconfig* 2>/dev/null`

### W5: No oversized source files
- **pass**: 0 source files > 256 KB (excluding .git, node_modules, dist, build, vendor, lockfiles)
- **fail**: >= 1 source file > 256 KB
- How to verify: `find . -type f -size +262144c -name '*.js' -o -name '*.py' ... | head`

### W6: Pre-commit hooks are fast
- **pass**: no pre-commit hook, OR hook runs in < 10s
- **fail**: pre-commit hook takes >= 10s
- How to verify: check `.git/hooks/pre-commit` or `.husky/pre-commit` existence + approximate time

## Continuity

### C1: Document freshness
- **pass**: entry file modified within 90 days of last code change
- **fail**: entry file is stale (> 90 days behind code changes)
- **na**: no git history or no entry file
- How to verify: compare `git log -1 --format=%at -- CLAUDE.md` vs `git log -1 --format=%at -- '*.py' '*.js'`

### C2: Handoff file exists
- **pass**: HANDOFF.md, PROGRESS.md, or similar file exists
- **fail**: no handoff information found
- How to verify: `ls HANDOFF.md PROGRESS.md TODO.md 2>/dev/null`

### C3: Changelog has "why"
- **pass**: CHANGELOG.md has > 5 lines (substantive content)
- **fail**: no CHANGELOG.md or <= 5 lines
- How to verify: `wc -l CHANGELOG.md`

### C4: Plans in repo
- **pass**: plan directory exists (docs/plans/, .claude/plans/, plans/)
- **fail**: no plan directory found
- How to verify: `ls -d docs/plans .claude/plans plans 2>/dev/null`

### C5: CLAUDE.local.md not tracked
- **pass**: no CLAUDE.local.md, OR exists but not tracked in git
- **fail**: CLAUDE.local.md is tracked in git
- How to verify: `git ls-files CLAUDE.local.md`

## Safety

### S1: .env in .gitignore
- **pass**: .env is in .gitignore
- **fail**: .env is not in .gitignore, OR .env is tracked in git
- How to verify: `grep '\.env' .gitignore` + `git ls-files .env`

### S2: Actions SHA pinned
- **pass**: no GitHub Actions, OR all `uses:` lines have SHA (@40-char-hex)
- **fail**: any `uses:` line has a floating tag (@v4, @main, etc.)
- Score: ratio of pinned/total
- How to verify: `grep 'uses:' .github/workflows/*.yml | grep -v '@[0-9a-f]\{40\}'`

### S3: Secret scanning configured
- **pass**: .gitleaks.toml exists, OR .pre-commit-config.yaml with gitleaks/detect-secrets
- **fail**: no secret scanning configuration
- How to verify: `ls .gitleaks.toml .pre-commit-config.yaml 2>/dev/null`

### S4: SECURITY.md exists
- **pass**: SECURITY.md exists in repo root
- **fail**: no SECURITY.md
- How to verify: `ls SECURITY.md 2>/dev/null`

### S5: Workflow permissions minimized
- **pass**: no workflows have `contents: write` at workflow level (before `jobs:`)
- **fail**: >= 1 workflow has `contents: write` at workflow level
- How to verify: check each workflow YAML for `contents: write` before the `jobs:` key

### S6: No hardcoded secrets
- **pass**: no files match secret patterns (sk-*, ghp_*, AKIA*, BEGIN PRIVATE KEY)
- **fail**: >= 1 file contains hardcoded secret pattern
- Excludes: .env files, lockfiles, node_modules, .git, vendor, dist, build
- How to verify: `git grep -lE 'sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16}'`
