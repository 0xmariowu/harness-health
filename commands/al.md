---
description: "Run AgentLint diagnostic across all projects. Use when: user says /al, 'check all projects', 'agent lint', or '体检'."
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Agent(*)
---

# /al — AgentLint

Diagnose, plan, fix. One command. User presses Enter twice at most.

## Flow

### Step 1: Module Selection

AskUserQuestion with **defaults pre-selected** (user can press Enter to accept):

```
AgentLint — which checks to run?

Core (deterministic, no AI calls) — default ON:
  ☑ Findability         — can AI find what it needs?
  ☑ Instruction Quality — are your rules well-written?
  ☑ Workability         — can AI build and test?
  ☑ Continuity          — can next session pick up?
  ☑ Safety              — are secrets and CI locked down?
  ☑ Harness             — are Claude Code hooks/permissions safe?

Extended (opt-in, runtime-dependent):
  ☐ Deep Analysis       — find contradictions, dead weight, vague rules (uses AI)
  ☐ Session Analysis    — discover issues from your Claude Code session logs

[Enter to run with defaults]
```

**Default: all 6 core dimensions.** Extended analyzers are optional and will
show as `n/a` in the output unless explicitly checked. User presses Enter →
runs immediately.

### Step 2: Init (first run only)

If `${CLAUDE_PLUGIN_DATA}/config.json` doesn't exist, ask with default:

```
Where are your projects? [~/Projects]: ↵
```

Press Enter → uses `~/Projects`. Save to `${CLAUDE_PLUGIN_DATA}/config.json`. Never ask again.

### Step 3: Scan + Score (no interaction)

`scanner.sh`'s `--project-dir` is single-project. For `/al`'s multi-project
flow, use the env-var path so the scanner auto-discovers every git repo under
`PROJECTS_ROOT`:

```bash
AL_DIR="${CLAUDE_PLUGIN_ROOT}"
RUN_ROOT="${CLAUDE_PLUGIN_DATA:-$HOME/.al}/runs"
mkdir -p "$RUN_ROOT"
RUN_DIR="$(mktemp -d "$RUN_ROOT/$(date +%Y%m%d)-XXXXXX")"
PROJECTS_ROOT="$PROJECTS_ROOT" bash "$AL_DIR/src/scanner.sh" > "$RUN_DIR/scan.jsonl"
node "$AL_DIR/src/scorer.js" "$RUN_DIR/scan.jsonl" > "$RUN_DIR/scores.json"
```

`mkdir -p "$RUN_ROOT"` is required because `mktemp -d` fails if the parent
directory doesn't exist — which is exactly the state on a user's first `/al`
invocation after plugin install.

`RUN_DIR` replaces the old `/tmp/al-*.jsonl` paths so concurrent Claude
sessions on the same machine don't overwrite each other's runs.

### Step 4: Present Scores (no interaction)

Read `$RUN_DIR/scores.json` and present. The `(core)` suffix on the total
line appears when Deep/Session did not run — it signals that the score is
averaged over the 6 core dimensions only. Extended dimensions that didn't
run show as `n/a`, not `0/10`.

```
🏥 AgentLint — Score: 89/100 (core)

Findability      ████████████████░░░░  8/10
Instructions     ██████████████████░░  9/10
Workability      ████████████░░░░░░░░  6/10
Continuity       ██████████████░░░░░░  7/10
Safety           ██████████████████░░  9/10
Harness          ████████████████████  10/10
Deep             ░░░░░░░░░░░░░░░░░░░░  n/a
Session          ░░░░░░░░░░░░░░░░░░░░  n/a

By Project:
  my-api                 9  ██████████████████░░
  web-app                8  ████████████████░░░░
  cli-tool               6  ████████████░░░░░░░░
  new-project            4  ████████░░░░░░░░░░░░
```

### Step 5: Fix Plan + Select

Run plan generator:
```bash
node "$AL_DIR/src/plan-generator.js" $RUN_DIR/scores.json > $RUN_DIR/plan.json
```

Read `$RUN_DIR/plan.json`. **First print the full plan as readable text**, then AskUserQuestion.

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

### Step 5c: Select Project to Fix (if multi-project)

`fixer.js` applies changes to a single project at a time. When the scan
covered more than one project, pick exactly one repo for this fix run —
users can re-run `/al` against other projects afterwards.

```bash
UNIQUE_PROJECTS="$(jq -r '.project' "$RUN_DIR/scan.jsonl" | sort -u)"
PROJECT_COUNT="$(printf '%s\n' "$UNIQUE_PROJECTS" | grep -c .)"
```

If `PROJECT_COUNT` equals `1`: use that project automatically, set
`SELECTED_PROJECT="$UNIQUE_PROJECTS"`, skip AskUserQuestion.

If `PROJECT_COUNT` is greater than `1`: AskUserQuestion with the unique
project list as options (one option per project basename, ordered by
the number of findings attached to that project — most-findings first).
Record the user's pick in `SELECTED_PROJECT`.

Resolve `SELECTED_PROJECT` (a basename) back to its absolute path by
re-scanning `PROJECTS_ROOT` for its `.git` directory. The scanner's
discover logic uses `maxdepth 4`, so mirror that here:

```bash
PROJECT_DIR="$(find "$PROJECTS_ROOT" -maxdepth 4 -type d -name '.git' 2>/dev/null \
  | while IFS= read -r gd; do \
      p="$(dirname "$gd")"; \
      [ "$(basename "$p")" = "$SELECTED_PROJECT" ] && printf '%s\n' "$p" && break; \
    done | head -1)"
if [ -z "$PROJECT_DIR" ]; then
  echo "Error: cannot resolve project '$SELECTED_PROJECT' under '$PROJECTS_ROOT'" >&2
  exit 1
fi
```

Then narrow the plan to items that touch the selected project so
`fixer.js` only sees work it can actually perform.

`plan-generator.js` emits two parallel structures: the top-level
`items` array (flat, one entry per project+check, consumed by
`fixer.js`) and a display-only `grouped` tree (merged by check, can
span multiple projects). **Both must be filtered**; grouping alone is
cosmetic. Without the top-level filter, `fixer.js` can apply
another project's fix to `$PROJECT_DIR` — a real data-corruption risk
for mutating checks (F5, I5, W11).

```bash
jq --arg p "$SELECTED_PROJECT" '
  .items |= map(select(.project == $p)) |
  .grouped |= (
    to_entries
    | map(
        .value.items |= map(select(.projects | index($p))) |
        .value.count = (.value.items | length)
      )
    | from_entries
  ) |
  .total_items = (.items | length)
' "$RUN_DIR/plan.json" > "$RUN_DIR/plan.filtered.json"
```

The filter uses `.project == $p` (single string) on top-level items
and `.projects | index($p)` (array membership) on grouped merged items
— they have different schemas by design.

### Step 6: Execute Fixes (no interaction)

Run fixer against the filtered plan + resolved project dir. `$PROJECT_DIR`
must be set by Step 5c — never reference it before that step has run.

```bash
node "$AL_DIR/src/fixer.js" --items "1,2,3" --project-dir "$PROJECT_DIR" < $RUN_DIR/plan.filtered.json
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

Re-run scanner + scorer (same env-var form as Step 3):
```bash
PROJECTS_ROOT="$PROJECTS_ROOT" bash "$AL_DIR/src/scanner.sh" > $RUN_DIR/verify-scan.jsonl
node "$AL_DIR/src/scorer.js" $RUN_DIR/verify-scan.jsonl > $RUN_DIR/verify-scores.json
```

Show delta:
```
🏥 Score: 78 → 82/100 (+4)
  Findability: 8 → 9 (+1)
  Instructions: 9 → 9 (=)
  Workability: 6 → 6 (=)
  Continuity: 7 → 8 (+1)

📄 Report saved to ${CLAUDE_PLUGIN_DATA}/reports/2026-04-03.json
```

Save report:
```bash
mkdir -p ${CLAUDE_PLUGIN_DATA}/reports
cp $RUN_DIR/verify-scores.json ${CLAUDE_PLUGIN_DATA}/reports/$(date +%F).json
cp $RUN_DIR/plan.json ${CLAUDE_PLUGIN_DATA}/reports/$(date +%F)-plan.json
```

Clean up temp files.

---

## AI Deep Analysis (if selected in Step 1)

Runs AFTER Step 3 (core scan) and BEFORE Step 4 (scoring). Deep findings
are merged into the scorer via JSONL so they flow through the same
scorer → plan-generator → reporter pipeline as core checks — no manual
"inject into the plan" step. Score scope becomes `core+extended` only
after these JSONL records exist.

### The merge flow

```text
core scan JSONL  (from $RUN_DIR/scan.jsonl)
+ deep-analyzer JSONL (D1, D2, D3 — from the flow below)
+ session-analyzer JSONL (SS1-SS4, if Session also selected)
→ cat into combined.jsonl
→ scorer.js  (produces core+extended score)
→ plan-generator.js
→ reporter / fixer
```

### Step-by-step

1. Generate Deep prompt tasks for each project:

```bash
tasks=$(node "$AL_DIR/src/deep-analyzer.js" --project-dir "$PROJECT_DIR/my-project")
```

2. For each task in `tasks`, spawn a sonnet subagent with the prompt:

```
Read this file and answer three questions. Be strict — only flag clear issues.

1. CONTRADICTIONS: Are there rules that contradict each other? Quote both rules.
2. DEAD WEIGHT: Are there rules the AI would follow without being told?
3. VAGUE RULES: Are there rules too abstract to act on?

Respond with JSON only. Expected keys by check:
  D1 → { "contradictions": [ {rule_a, rule_b, explanation} ... ] }
  D2 → { "dead_weight":     [ {rule, explanation} ... ] }
  D3 → { "vague_rules":     [ {rule, explanation} ... ] }

File: {path}
```

3. Save each subagent's JSON output to `$RUN_DIR/d{1,2,3}-ai.json`.

4. Convert each AI response to scorer-compatible JSONL:

```bash
node "$AL_DIR/src/deep-analyzer.js" --format-result --project my-project --check D1 < $RUN_DIR/d1-ai.json >> $RUN_DIR/deep.jsonl
node "$AL_DIR/src/deep-analyzer.js" --format-result --project my-project --check D2 < $RUN_DIR/d2-ai.json >> $RUN_DIR/deep.jsonl
node "$AL_DIR/src/deep-analyzer.js" --format-result --project my-project --check D3 < $RUN_DIR/d3-ai.json >> $RUN_DIR/deep.jsonl
```

If AI output is malformed or missing the required key, `--format-result`
exits non-zero — don't silently drop findings. Fix the prompt or retry
rather than scoring without that check.

5. Merge into the scoring pipeline:

```bash
cat $RUN_DIR/scan.jsonl $RUN_DIR/deep.jsonl $RUN_DIR/session.jsonl 2>/dev/null \
  > $RUN_DIR/combined.jsonl

node "$AL_DIR/src/scorer.js" $RUN_DIR/combined.jsonl > $RUN_DIR/scores.json
node "$AL_DIR/src/plan-generator.js" $RUN_DIR/scores.json > $RUN_DIR/plan.json
```

The scorer sees real Deep/Session evidence, flips `score_scope` to
`core+extended`, and plan-generator produces `guided` items for each
finding via the shared fix registry (`null` fix_type → guided fallback).

No manual plan injection. No virtual "assisted" promises. Reporter and
fixer consume the combined plan exactly as they would for a pure-core
scan.

## Session Analysis (if selected in Step 1)

**Privacy note before running**: session analysis reads your local Claude
Code session logs at `~/.claude/projects/`. By default, the analyzer
**redacts** raw prompt text in its output (replaces it with a short hash
+ length + occurrence count) so findings are safe to paste into issues,
reports, or shared files. Pass `--include-raw-snippets` if you want to
see the original text locally. Confirm with the user before enabling
raw-snippet mode, especially if the report will leave their machine.

After Step 4, before Step 5:

```bash
node "$AL_DIR/src/session-analyzer.js" \
  --projects-root "$PROJECTS_ROOT" \
  --session-root ~/.claude/projects \
  --max-sessions 30 \
  > $RUN_DIR/session.jsonl
```

If the user opted into raw snippets:

```bash
node "$AL_DIR/src/session-analyzer.js" \
  --projects-root "$PROJECTS_ROOT" \
  --session-root ~/.claude/projects \
  --max-sessions 30 \
  --include-raw-snippets \
  > $RUN_DIR/session.jsonl
```

Present findings inline. With default redaction, the `instruction` and
`rule` fields show `[redacted <N>ch #<hash>]` — the hash is stable, so
users can still see "this instruction came up 7 times" without the
prompt itself appearing.

Session findings become fix items:
- Repeated instructions → `guided` (review + add rule to CLAUDE.md manually)
- Ignored rules → `guided` (review rule wording)

Session/Deep findings are always `guided` today — the fixer has no SS/D
handlers. `plan-generator.js` reads `fix_type` from evidence.json, which
has `null` for SS/D checks, so they surface as text recipes rather than
false "assisted" promises. See `src/fixer.js` for the current handler
set.

---

## Summary: User Interaction Points

| Step | Interaction | Default |
|------|------------|---------|
| 1. Module selection | AskUserQuestion | All 6 core checked (Deep/Session opt-in), Enter to accept |
| 2. Init (first run) | AskUserQuestion | default dir, Enter to accept |
| 3. Scan + Score | None | Automatic |
| 4. Show scores | None | Automatic |
| 5. Fix plan | AskUserQuestion | High priority selected, Enter to accept |
| 6. Execute | None | Automatic |
| 7. Verify + Report | None | Automatic |

**Typical session: 2 presses of Enter.** Power users adjust selections.
