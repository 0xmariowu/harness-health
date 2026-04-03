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
  project-g                 10  ████████████████████
  project-a                 8  ████████████████░░░░
  harness-health         6  ████████████░░░░░░░░
  project-e               5  ██████████░░░░░░░░░░
```

### Step 5: Fix Plan + Select

Run plan generator:
```bash
node "$HH_DIR/src/plan-generator.js" /tmp/hh-scores.json > /tmp/hh-plan.json
```

Read plan, **group by severity**, **merge similar items**, present via AskUserQuestion with **defaults**:

```
📋 修复计划 — 50 项

🔴 高优先 (12 项) ← 默认全选
  
  Findability:
  ☑ [auto] 5 个项目有断链引用 (共 38 个)
  ☑ [assisted] harness-health: 缺少入口文件
  
  Workability:
  ☑ [guided] 3 个项目没有测试文件
  ☑ [guided] 2 个项目没有 linter 配置

🟡 中优先 (18 项) ← 默认不选
  
  Instructions:
  ☐ [guided] 4 个项目规则具体性 < 50%
  ☐ [guided] project-f CLAUDE.md 150 行太长
  
  Continuity:
  ☐ [assisted] 6 个项目没有 HANDOFF
  ☐ [guided] 3 个项目文档 30+ 天没更新

⚪ 低优先 (20 项) ← 折叠，默认不选
  ☐ 展开查看...

[Enter to fix all high-priority items]
```

**Default: 高优先全选，中低不选。** User presses Enter → only fixes high priority.

Severity grouping logic:
- 🔴 High: check score < 0.3
- 🟡 Medium: check score 0.3 - 0.6
- ⚪ Low: check score 0.6 - 0.8

Merge similar items: group by check_id, show "5 projects have broken refs (38 total)" instead of 5 separate lines.

### Step 6: Execute Fixes (no interaction)

For selected items:
```bash
node "$HH_DIR/src/fixer.js" --items "1,2,3" --project-dir ~/Projects < /tmp/hh-plan.json
```

Present results:
```
✓ 5 projects: cleaned 38 broken references
✓ harness-health: generated CLAUDE.md from template
ℹ 3 projects: add test files (manual — see details below)
ℹ 2 projects: add linter config (manual — see details below)

  Manual items:
  - project-b: no tests/ directory. Run: mkdir tests && touch tests/test_smoke.py
  - project-e: no tests/ directory (no code yet — skip for now)
  ...
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
tasks=$(node "$HH_DIR/src/deep-analyzer.js" --project-dir ~/Projects/project-a)
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
