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

Record the normalized choices in shell variables for the config write in
Step 2. Core is currently all-or-nothing and defaults on; Deep/Session are
the only runtime-selectable modules.

```bash
RUN_CORE=true
RUN_DEEP=false     # set true only if Deep Analysis was selected
RUN_SESSION=false  # set true only if Session Analysis was selected
```

### Step 2: Init (first run only)

If `${CLAUDE_PLUGIN_DATA}/config.json` doesn't exist, ask with default:

```
Where are your projects? [~/Projects]: ↵
```

Press Enter → uses `~/Projects`. Save to `${CLAUDE_PLUGIN_DATA}/config.json`.
Never ask for the projects root again.

After Step 1, always persist the selected scan options back into the same
config file. The scan and verify steps must read this file instead of relying
on stale shell variables; otherwise the config is dead state and Deep/Session
choices are ignored.

```bash
CONFIG_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.al}"
CONFIG_FILE="$CONFIG_DIR/config.json"
mkdir -p "$CONFIG_DIR"

if [ ! -f "$CONFIG_FILE" ]; then
  PROJECTS_ROOT_INPUT="${PROJECTS_ROOT_INPUT:-$HOME/Projects}"
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const projectsRoot = process.argv[2];
    fs.writeFileSync(file, JSON.stringify({
      projects_root: projectsRoot,
      modules: { core: true, deep: false, session: false }
    }, null, 2) + "\n");
  ' "$CONFIG_FILE" "$PROJECTS_ROOT_INPUT"
fi

CONFIG_TMP="$(mktemp "$CONFIG_DIR/config.XXXXXX")"
node -e '
  const fs = require("fs");
  const [file, out, core, deep, session] = process.argv.slice(1);
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  cfg.modules = {
    ...(cfg.modules || {}),
    core: core === "true",
    deep: deep === "true",
    session: session === "true"
  };
  fs.writeFileSync(out, JSON.stringify(cfg, null, 2) + "\n");
' "$CONFIG_FILE" "$CONFIG_TMP" "$RUN_CORE" "$RUN_DEEP" "$RUN_SESSION"
mv "$CONFIG_TMP" "$CONFIG_FILE"
```

### Step 3: Core scan (no interaction, no scoring yet)

`scanner.sh`'s `--project-dir` is single-project. For `/al`'s multi-project
flow, use the env-var path so the scanner auto-discovers every git repo under
`PROJECTS_ROOT`:

```bash
CONFIG_FILE="${CLAUDE_PLUGIN_DATA:-$HOME/.al}/config.json"
PROJECTS_ROOT="$(jq -er '.projects_root' "$CONFIG_FILE")"
RUN_DEEP="$(jq -r '.modules.deep // false' "$CONFIG_FILE")"
RUN_SESSION="$(jq -r '.modules.session // false' "$CONFIG_FILE")"
AL_DIR="${CLAUDE_PLUGIN_ROOT}"
RUN_ROOT="${CLAUDE_PLUGIN_DATA:-$HOME/.al}/runs"
mkdir -p "$RUN_ROOT"
RUN_DIR="$(mktemp -d "$RUN_ROOT/$(date +%Y%m%d)-XXXXXX")"
PROJECTS_ROOT="$PROJECTS_ROOT" bash "$AL_DIR/src/scanner.sh" > "$RUN_DIR/scan.jsonl"
```

**Do NOT run scorer yet.** If Deep or Session modules were selected in
Step 1, they produce additional JSONL records that must be merged with
`scan.jsonl` before scoring. Scoring prematurely here would lock in a
core-only score and force a re-score later, producing inconsistent
intermediate reports.

`mkdir -p "$RUN_ROOT"` is required because `mktemp -d` fails if the parent
directory doesn't exist — which is exactly the state on a user's first `/al`
invocation after plugin install.

`RUN_DIR` replaces the old `/tmp/al-*.jsonl` paths so concurrent Claude
sessions on the same machine don't overwrite each other's runs.

### Step 3b: Extended analyzers (conditional)

If `RUN_DEEP` read from `${CLAUDE_PLUGIN_DATA}/config.json` is `true`, run
the Deep Analysis flow now (see "Deep Analysis" section further below) to
produce `$RUN_DIR/deep.jsonl`.

If `RUN_SESSION` read from `${CLAUDE_PLUGIN_DATA}/config.json` is `true`,
run the Session Analysis flow to produce `$RUN_DIR/session.jsonl`.

Neither produces output when not selected — that's fine, the merge step
handles a missing file gracefully.

### Step 3c: Merge + score + plan (no interaction)

```bash
: > "$RUN_DIR/combined.jsonl"
cat "$RUN_DIR/scan.jsonl" >> "$RUN_DIR/combined.jsonl"
[ -f "$RUN_DIR/deep.jsonl" ]    && cat "$RUN_DIR/deep.jsonl"    >> "$RUN_DIR/combined.jsonl"
[ -f "$RUN_DIR/session.jsonl" ] && cat "$RUN_DIR/session.jsonl" >> "$RUN_DIR/combined.jsonl"

node "$AL_DIR/src/scorer.js" "$RUN_DIR/combined.jsonl" > "$RUN_DIR/scores.json"
node "$AL_DIR/src/plan-generator.js" "$RUN_DIR/scores.json" > "$RUN_DIR/plan.json"
```

Scoring happens **once**, after every selected analyzer has written its
JSONL. `score_scope` is `core+extended` exactly when at least one of
`deep.jsonl` / `session.jsonl` is present, and `core` otherwise — no
coercion, no re-scoring.

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

`$RUN_DIR/plan.json` already exists — it was generated by Step 3c alongside
`scores.json` (planning and scoring share the merged JSONL; splitting them
risks the plan losing Deep/Session items). **First print the full plan as
readable text**, then AskUserQuestion.

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
# project_path is the canonical identity (avoids basename collisions
# like org1/app vs org2/app). Resolve every candidate to its real path
# before selection so symlinked/duplicate paths cannot point fixer at
# a different repo than the one the scan reported.
REALPATH_CMD='import os,sys; print(os.path.realpath(sys.argv[1]))'
UNIQUE_PATHS="$(
  jq -r '.project_path // .project // empty' "$RUN_DIR/scan.jsonl" \
    | while IFS= read -r candidate; do
        [ -z "$candidate" ] && continue
        python3 -c "$REALPATH_CMD" "$candidate"
      done \
    | sort -u
)"
PROJECT_COUNT="$(printf '%s\n' "$UNIQUE_PATHS" | grep -c .)"
```

If `PROJECT_COUNT` equals `1`: use that path automatically, set
`SELECTED_PATH="$UNIQUE_PATHS"`, skip AskUserQuestion.

If `PROJECT_COUNT` is greater than `1`: AskUserQuestion with **one
option per absolute path**. Label each option with the basename plus
a short parent-dir suffix for disambiguation so colliding basenames
stay distinguishable (e.g. `app (org1/app)` vs `app (org2/app)`).
Record the user's pick in `SELECTED_PATH` (absolute). If two or more
canonical paths remain, this is ambiguous by definition; list every
candidate and ask instead of silently picking one.

```bash
PROJECT_DIR="$(python3 -c "$REALPATH_CMD" "$SELECTED_PATH")"
SELECTED_PROJECT="$(basename "$PROJECT_DIR")"
if [ ! -d "$PROJECT_DIR" ]; then
  echo "Error: selected project path does not exist: $PROJECT_DIR" >&2
  exit 1
fi
if ! git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: selected project path is not a git repo: $PROJECT_DIR" >&2
  exit 1
fi
GIT_TOP="$(git -C "$PROJECT_DIR" rev-parse --show-toplevel)"
GIT_TOP="$(python3 -c "$REALPATH_CMD" "$GIT_TOP")"
case "$PROJECT_DIR" in
  "$GIT_TOP"|"$GIT_TOP"/*) ;;
  *)
    echo "Error: selected project path is outside its git worktree: $PROJECT_DIR" >&2
    exit 1
    ;;
esac
```

No `find` + basename match — that was the prior footgun: two repos
with the same basename made the resolver pick whichever came back
first from the walk and the fix was applied to the wrong repo.

Then narrow the plan to items that touch the selected project **by
path**, not basename. `plan-generator.js` items carry `project_path`
already; the filter prefers it and falls back to basename only for
legacy records without a path.

`plan-generator.js` emits two parallel structures: the top-level
`items` array (flat, one entry per project+check, consumed by
`fixer.js`) and a display-only `grouped` tree (merged by check, can
span multiple projects). **Both must be filtered**; grouping alone is
cosmetic. Without the top-level filter, `fixer.js` can apply
another project's fix to `$PROJECT_DIR` — a real data-corruption risk
for mutating checks (F5, I5, W11).

```bash
jq --arg pp "$SELECTED_PATH" --arg p "$SELECTED_PROJECT" '
  .items |= map(select(
    (.project_path // null) == $pp
    or (.project_path == null and .project == $p)
  )) |
  .grouped |= (
    to_entries
    | map(
        .value.items |= map(select(
          ((.project_paths // []) | index($pp) != null)
          or (((.project_paths // []) | length) == 0 and ((.projects // []) | index($p) != null))
        )) |
        .value.count = (.value.items | length)
      )
    | from_entries
  ) |
  .total_items = (.items | length)
' "$RUN_DIR/plan.json" > "$RUN_DIR/plan.filtered.json"
```

The `.project_path == $pp` comparator is the canonical selector; the
basename fallback keeps legacy records (pre-project_path scorer
output, extended analyzers that haven't been upgraded yet) working
during the migration window.

The filter uses `.project == $p` (single string) on top-level items
and `.projects | index($p)` (array membership) on grouped merged items
— they have different schemas by design.

### Step 6: Execute Fixes (no interaction)

Run fixer against the filtered plan + resolved project dir. `$PROJECT_DIR`
must be set by Step 5c — never reference it before that step has run.

```bash
node "$AL_DIR/src/fixer.js" --items "1,2,3" --project-dir "$PROJECT_DIR" < "$RUN_DIR/plan.filtered.json"
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

Re-run the **same** module set that produced the original score so the
delta is apples-to-apples. Core-only: just re-scan. With Deep or Session
selected: re-run those analyzers too before merging and scoring.

```bash
CONFIG_FILE="${CLAUDE_PLUGIN_DATA:-$HOME/.al}/config.json"
PROJECTS_ROOT="$(jq -er '.projects_root' "$CONFIG_FILE")"
RUN_DEEP="$(jq -r '.modules.deep // false' "$CONFIG_FILE")"
RUN_SESSION="$(jq -r '.modules.session // false' "$CONFIG_FILE")"
PROJECTS_ROOT="$PROJECTS_ROOT" bash "$AL_DIR/src/scanner.sh" > "$RUN_DIR/verify-scan.jsonl"

# If RUN_DEEP is true, re-run Deep here against the fixed repo
# (reuse the Deep Analysis section below, writing to verify-deep.jsonl).
# Same for RUN_SESSION → verify-session.jsonl.

: > "$RUN_DIR/verify-combined.jsonl"
cat "$RUN_DIR/verify-scan.jsonl" >> "$RUN_DIR/verify-combined.jsonl"
[ -f "$RUN_DIR/verify-deep.jsonl" ]    && cat "$RUN_DIR/verify-deep.jsonl"    >> "$RUN_DIR/verify-combined.jsonl"
[ -f "$RUN_DIR/verify-session.jsonl" ] && cat "$RUN_DIR/verify-session.jsonl" >> "$RUN_DIR/verify-combined.jsonl"

node "$AL_DIR/src/scorer.js" "$RUN_DIR/verify-combined.jsonl" > "$RUN_DIR/verify-scores.json"
```

If Deep/Session were selected but you're reporting only the core delta
(e.g. the user opted out of re-running extended analyzers), say so
explicitly in the verify summary — "verified against 6 core dimensions;
Deep/Session not re-run" — so the delta is not mistaken for a complete
re-verification.

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
REPORT_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.al}/reports"
mkdir -p "$REPORT_DIR"
cp "$RUN_DIR/verify-scores.json" "$REPORT_DIR/$(date +%F).json"
cp "$RUN_DIR/plan.json" "$REPORT_DIR/$(date +%F)-plan.json"
```

Clean up temp files.

---

## AI Deep Analysis (if selected in Step 1)

This is **Step 3b**. It runs AFTER the core scan (Step 3) and BEFORE the
merge/score step (Step 3c). No scoring happens until the JSONL files
below have been written and concatenated with `scan.jsonl` in Step 3c.

### The merge flow (for reference — executed by Step 3c, not here)

```text
core scan JSONL  (from $RUN_DIR/scan.jsonl)
+ deep-analyzer JSONL (D1, D2, D3 — from the flow below)
+ session-analyzer JSONL (SS1-SS4, if Session also selected)
→ cat into combined.jsonl    (done in Step 3c)
→ scorer.js  (produces core+extended score)
→ plan-generator.js
→ reporter / fixer
```

### Step-by-step

Note: the Deep analyzer needs a resolved absolute path per project. In
the multi-project flow, that resolution happens in Step 5c. Step 3b now
runs earlier, so it must use `scan.jsonl`'s `project_path` values
directly to avoid basename collision. Produce one deep.jsonl record per
(project, check) pair.

1. For each unique `project_path` value `$P_DIR` in scan output, generate
   Deep prompt tasks and process outputs in one loop:

```bash
: > "$RUN_DIR/deep.jsonl"
REALPATH_CMD='import os,sys; print(os.path.realpath(sys.argv[1]))'
PROJECT_PATHS="$(
  jq -r '.project_path // empty' "$RUN_DIR/scan.jsonl" \
    | while IFS= read -r candidate; do
        [ -z "$candidate" ] && continue
        python3 -c "$REALPATH_CMD" "$candidate"
      done \
    | sort -u
)"
printf '%s\n' "$PROJECT_PATHS" | while IFS= read -r P_DIR; do
  [ -z "$P_DIR" ] && continue
  [ ! -d "$P_DIR" ] && continue
  P="$(basename "$P_DIR")"
  P_HASH="$(node -e "console.log(require('crypto').createHash('sha1').update(process.argv[1]).digest('hex').slice(0, 8))" "$P_DIR")"
  PREFIX="${P}-${P_HASH}"
  TASKS_FILE="$RUN_DIR/${PREFIX}.deep-tasks.json"

  node "$AL_DIR/src/deep-analyzer.js" --project-dir "$P_DIR" > "$TASKS_FILE"

  for CHECK in D1 D2 D3; do
    CHECK_LOWER="$(printf '%s' "$CHECK" | tr '[:upper:]' '[:lower:]')"
    PROMPT_FILE="$RUN_DIR/${PREFIX}.${CHECK}.prompt.txt"
    AI_OUT="$RUN_DIR/${PREFIX}.${CHECK_LOWER}-ai.json"
    jq -er --arg check "$CHECK" '.tasks[] | select(.check_id == $check) | .prompt' "$TASKS_FILE" > "$PROMPT_FILE"

    # Spawn one sonnet subagent with the contents of $PROMPT_FILE.
    # Write the subagent's raw JSON-only answer to $AI_OUT.
    [ -s "$AI_OUT" ] || {
      echo "Error: missing Deep AI output for $P_DIR $CHECK: $AI_OUT" >&2
      exit 1
    }

    node "$AL_DIR/src/deep-analyzer.js" --format-result --project "$P" --project-path "$P_DIR" --check "$CHECK" < "$AI_OUT" >> "$RUN_DIR/deep.jsonl"
  done
done
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

3. Save each subagent's JSON output to **per-project** files so
   multi-project runs don't stomp on each other. Use a basename+hash
   prefix `${PREFIX}` so same basenames in different folders don't
   collide:

   `$RUN_DIR/${PREFIX}.d1-ai.json`, `$RUN_DIR/${PREFIX}.d2-ai.json`,
   `$RUN_DIR/${PREFIX}.d3-ai.json`.

   With N projects × 3 checks you get 3N files, not 3 shared ones.
   This is required — a shared `d1-ai.json` would be overwritten by
   every project after the first.

4. Convert each AI response to scorer-compatible JSONL, passing both
   `$P` and `$P_DIR` so the emitted records carry both basename + path.
   The loop above does this immediately after each `$AI_OUT` file is
   written; the equivalent explicit commands are:

```bash
node "$AL_DIR/src/deep-analyzer.js" --format-result --project "$P" --project-path "$P_DIR" --check D1 < "$RUN_DIR/${PREFIX}.d1-ai.json" >> "$RUN_DIR/deep.jsonl"
node "$AL_DIR/src/deep-analyzer.js" --format-result --project "$P" --project-path "$P_DIR" --check D2 < "$RUN_DIR/${PREFIX}.d2-ai.json" >> "$RUN_DIR/deep.jsonl"
node "$AL_DIR/src/deep-analyzer.js" --format-result --project "$P" --project-path "$P_DIR" --check D3 < "$RUN_DIR/${PREFIX}.d3-ai.json" >> "$RUN_DIR/deep.jsonl"
```

`deep.jsonl` is append-only across all projects; the per-project
`$P` in each line keeps findings distinguishable downstream.

If AI output is malformed or missing the required key, `--format-result`
exits non-zero — don't silently drop findings. Fix the prompt or retry
rather than scoring without that check.

5. Return control to the main flow. **Step 3c handles the merge + score +
   plan**. Do not call scorer or plan-generator from inside this Deep
   Analysis section — duplicating that call would produce two
   `scores.json` files and confuse which one Step 4 should present.

The scorer (when Step 3c runs) sees real Deep evidence, flips
`score_scope` to `core+extended`, and plan-generator produces `guided`
items for each finding via the shared fix registry (`null` fix_type →
guided fallback).

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

This is **Step 3b**. Runs AFTER the core scan (Step 3), BEFORE the
merge/score step (Step 3c). No scoring happens until `session.jsonl`
(and any `deep.jsonl`) has been merged with `scan.jsonl` in Step 3c.

```bash
node "$AL_DIR/src/session-analyzer.js" \
  --projects-root "$PROJECTS_ROOT" \
  --session-root "$HOME/.claude/projects" \
  --max-sessions 30 \
  > "$RUN_DIR/session.jsonl"
```

If the user opted into raw snippets:

```bash
node "$AL_DIR/src/session-analyzer.js" \
  --projects-root "$PROJECTS_ROOT" \
  --session-root "$HOME/.claude/projects" \
  --max-sessions 30 \
  --include-raw-snippets \
  > "$RUN_DIR/session.jsonl"
```

Do NOT invoke scorer or plan-generator from inside this section —
Step 3c owns that merge + score + plan. Duplicating the call
produces a competing scores.json.

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
