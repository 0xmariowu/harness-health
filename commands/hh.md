---
description: "Run Harness Health diagnostic across all projects. Use when: user says /hh, 'check all projects', 'harness health', or '体检'."
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Agent(*)
---

# /hh — Harness Health

Diagnose, plan, fix. One command. User presses Enter twice at most.

## Flow

### Step 1: Module Selection

AskUserQuestion with **defaults pre-selected** (user can press Enter to accept):

```
Harness Health — which checks to run?

☑ Findability — can AI find what it needs?
☑ Instruction Quality — are your rules well-written?
☑ Workability — can AI build and test?
☑ Continuity — can next session pick up?
☐ AI Deep Analysis — find contradictions, dead weight, vague rules
☐ Session Analysis — discover issues from your usage history

[Enter to run with defaults]
```

**Default: first 4 checked.** User presses Enter → runs immediately.

### Step 2: Init (first run only)

If `~/.hh/config.json` doesn't exist, ask with default:

```
Where are your projects? [~/Projects]: ↵
```

Press Enter → uses `~/Projects`. Save to `~/.hh/config.json`. Never ask again.

### Step 3: Scan + Score (no interaction)

```bash
HH_DIR="${CLAUDE_PLUGIN_ROOT}"
bash "$HH_DIR/src/scanner.sh" > /tmp/hh-scan.jsonl
node "$HH_DIR/src/scorer.js" /tmp/hh-scan.jsonl > /tmp/hh-scores.json
```

### Step 4: Present Scores (no interaction)

Read `/tmp/hh-scores.json` and present:

```
🏥 Harness Health — Score: 78/100

Findability      ████████████████░░░░  8/10
Instructions     ██████████████████░░  9/10
Workability      ████████████░░░░░░░░  6/10
Continuity       ██████████████░░░░░░  7/10

By Project:
  my-api                 9  ██████████████████░░
  web-app                8  ████████████████░░░░
  cli-tool               6  ████████████░░░░░░░░
  new-project            4  ████████░░░░░░░░░░░░
```

### Step 5: Fix Plan + Select

Run plan generator:
```bash
node "$HH_DIR/src/plan-generator.js" /tmp/hh-scores.json > /tmp/hh-plan.json
```

Read `/tmp/hh-plan.json`. **First print the full plan as readable text**, then AskUserQuestion.

**Step 5a: Print fix plan (no interaction)**

Read the grouped items from the plan JSON and output a summary like this:

```
📋 Fix Plan — 12 items

🔴 High (8 items):
  [auto] All references resolve — 3 projects (my-api, web-app, cli-tool)
  [assisted] Missing HANDOFF — my-api, web-app
  [guided] Missing tests — my-api, cli-tool
  [guided] Missing linter config — my-api, web-app
  [guided] No build/test commands in entry file — cli-tool

🟡 Medium (2 items):
  [guided] Rule specificity < 50% — web-app
  [guided] Entry file too short — cli-tool

⚪ Low (2 items):
  [guided] Entry file length — my-api
  [guided] Keyword density — web-app
```

For each grouped item, show: `[fix_type] check name — project list`. Use the merged items from `plan.grouped.{severity}.items`. List all project names (from the `projects` array on merged items).

**Step 5b: AskUserQuestion**

After printing the plan, ask which items to fix:

```
Which items to fix?
1. High priority only (Recommended) — {high_count} items
2. High + Medium — {high_count + med_count} items
3. All {total} items
4. Skip fixes, just show report
```

Severity grouping logic (matches plan-generator.js `inferSeverity`):
- 🔴 High: check score < 0.5
- 🟡 Medium: check score 0.5 - 0.7
- ⚪ Low: check score 0.7 - 0.8

### Step 6: Execute Fixes (no interaction)

For selected items:
```bash
node "$HH_DIR/src/fixer.js" --items "1,2,3" --project-dir ~/Projects < /tmp/hh-plan.json
```

Present results:
```
✓ 3 projects: cleaned 12 broken references
✓ cli-tool: generated CLAUDE.md from template
ℹ 2 projects: add test files (manual — see details below)
ℹ 2 projects: add linter config (manual — see details below)

  Manual items:
  - my-api: no tests/ directory. Run: mkdir tests && touch tests/test_smoke.py
  - new-project: no tests/ directory (no code yet — skip for now)
```

### Step 7: Verify + Report (no interaction)

Re-run scanner + scorer:
```bash
bash "$HH_DIR/src/scanner.sh" > /tmp/hh-verify.jsonl
node "$HH_DIR/src/scorer.js" /tmp/hh-verify.jsonl > /tmp/hh-verify-scores.json
```

Show delta:
```
🏥 Score: 78 → 82/100 (+4)
  Findability: 8 → 9 (+1)
  Instructions: 9 → 9 (=)
  Workability: 6 → 6 (=)
  Continuity: 7 → 8 (+1)

📄 Report saved to ~/.hh/reports/2026-04-03.json
```

Save report:
```bash
mkdir -p ~/.hh/reports
cp /tmp/hh-verify-scores.json ~/.hh/reports/$(date +%F).json
cp /tmp/hh-plan.json ~/.hh/reports/$(date +%F)-plan.json
```

Clean up temp files.

---

## AI Deep Analysis (if selected in Step 1)

After Step 4, before Step 5, for each project with an entry file:

```bash
tasks=$(node "$HH_DIR/src/deep-analyzer.js" --project-dir ~/Projects/my-project)
```

For each task, spawn a subagent (model: sonnet):

```
Read this file and answer three questions. Be strict — only flag clear issues.

1. CONTRADICTIONS: Are there rules that contradict each other? Quote both rules.
2. DEAD WEIGHT: Are there rules the AI would follow without being told?
3. VAGUE RULES: Are there rules too abstract to act on?

File: {path}
```

Add results to the fix plan as `guided` items in the 🟡 medium section.

## Session Analysis (if selected in Step 1)

After Step 4, before Step 5:

```bash
node "$HH_DIR/src/session-analyzer.js" --max-sessions 30 > /tmp/hh-session.jsonl
```

Present findings inline:
```
📊 Session Analysis (30 sessions):

💡 Should be in your CLAUDE.md:
  1. "don't modify lockfile" — you said it 7 times
  2. "use scripts/committer" — you said it 5 times

⚠️ Rules that may not be working:
  1. "Don't stage the entire repo" — 13 potential violations in 3 sessions
```

Session findings become fix items:
- Repeated instructions → `assisted` type (add rule to CLAUDE.md)
- Ignored rules → `guided` type (review rule wording)

---

## Summary: User Interaction Points

| Step | Interaction | Default |
|------|------------|---------|
| 1. Module selection | AskUserQuestion | First 4 checked, Enter to accept |
| 2. Init (first run) | AskUserQuestion | ~/Projects, Enter to accept |
| 3. Scan + Score | None | Automatic |
| 4. Show scores | None | Automatic |
| 5. Fix plan | AskUserQuestion | High priority selected, Enter to accept |
| 6. Execute | None | Automatic |
| 7. Verify + Report | None | Automatic |

**Typical session: 2 presses of Enter.** Power users adjust selections.
