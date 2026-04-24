#!/usr/bin/env node
'use strict';

// Registry drift guard. Fails if any of the following contracts break:
//
//   1. Every check in evidence.json has: dimension, name, scope, fix_type.
//   2. scope is "core" xor "extended"; scope == "extended" iff dimension is
//      one of {deep, session}.
//   3. fix_type is one of "auto" | "assisted" | "guided" | null.
//   4. Every check in evidence.json has a matching entry in weights.json's
//      check_weights (and vice versa) — the two files describe the same
//      universe of checks.
//   5. Every check with fix_type in {auto, assisted} is actually handled by
//      fixer.js (detected via source-text grep for its dispatch branches).
//   6. Core dimension weights sum to 1.0; extended adds exactly 0.1.
//
// When these assertions fail, do not change the test — change the data.
// If you add a new check: update evidence.json AND weights.json AND fixer.js
// (if it needs a handler). This test makes that requirement unambiguous.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EVIDENCE = JSON.parse(fs.readFileSync(path.join(ROOT, 'standards', 'evidence.json'), 'utf8'));
const WEIGHTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'standards', 'weights.json'), 'utf8'));
const FIXER_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'fixer.js'), 'utf8');

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total += 1;
  try {
    fn();
    passed += 1;
    process.stdout.write(`PASS: ${name}\n`);
  } catch (error) {
    process.stdout.write(`FAIL: ${name}\n`);
    process.stdout.write(`${error.message}\n`);
  }
}

const CHECK_IDS = Object.keys(EVIDENCE.checks);
const EXTENDED_DIMS = new Set(['deep', 'session']);
const VALID_FIX_TYPES = new Set(['auto', 'assisted', 'guided', null]);

runTest('every check has required metadata fields', () => {
  for (const id of CHECK_IDS) {
    const c = EVIDENCE.checks[id];
    assert.ok(typeof c.dimension === 'string' && c.dimension, `${id}: missing dimension`);
    assert.ok(typeof c.name === 'string' && c.name, `${id}: missing name`);
    assert.ok(typeof c.scope === 'string' && c.scope, `${id}: missing scope`);
    assert.ok('fix_type' in c, `${id}: missing fix_type (must be set, possibly to null)`);
  }
});

runTest('scope is "core" or "extended" and matches dimension', () => {
  for (const id of CHECK_IDS) {
    const c = EVIDENCE.checks[id];
    assert.ok(c.scope === 'core' || c.scope === 'extended',
      `${id}: scope must be "core" or "extended", got ${JSON.stringify(c.scope)}`);
    const shouldBeExtended = EXTENDED_DIMS.has(c.dimension);
    const isExtended = c.scope === 'extended';
    assert.equal(isExtended, shouldBeExtended,
      `${id} (${c.dimension}): scope "${c.scope}" disagrees with dimension — ` +
      `deep/session checks must be "extended", all others "core"`);
  }
});

runTest('fix_type is one of auto/assisted/guided/null', () => {
  for (const id of CHECK_IDS) {
    const c = EVIDENCE.checks[id];
    assert.ok(VALID_FIX_TYPES.has(c.fix_type),
      `${id}: fix_type must be auto/assisted/guided/null, got ${JSON.stringify(c.fix_type)}`);
  }
});

runTest('evidence.json and weights.json describe the same set of check IDs', () => {
  const weightIds = new Set(Object.keys(WEIGHTS.check_weights || {}));
  const evidenceIds = new Set(CHECK_IDS);
  const missingInWeights = [...evidenceIds].filter((id) => !weightIds.has(id));
  const missingInEvidence = [...weightIds].filter((id) => !evidenceIds.has(id));
  assert.deepEqual(missingInWeights, [],
    `these checks are in evidence.json but not weights.json: ${missingInWeights.join(', ')}`);
  assert.deepEqual(missingInEvidence, [],
    `these checks are in weights.json but not evidence.json: ${missingInEvidence.join(', ')}`);
});

runTest('every auto/assisted fix_type has a matching handler in fixer.js', () => {
  for (const id of CHECK_IDS) {
    const c = EVIDENCE.checks[id];
    if (c.fix_type !== 'auto' && c.fix_type !== 'assisted') continue;
    // fixer.js handlers appear as either a dispatch branch like
    // `checkId === 'W11'` / `selected.check_id === 'F1'` or a named function
    // like `executeAutoW11` / `executeAssistedF1`. Either match is enough.
    const patterns = [
      new RegExp(`(?:checkId|selected\\.check_id)\\s*===\\s*['"]${id}['"]`),
      new RegExp(`execute(?:Auto|Assisted)${id}\\b`),
    ];
    const hasHandler = patterns.some((re) => re.test(FIXER_SOURCE));
    assert.ok(hasHandler,
      `${id} declares fix_type="${c.fix_type}" in evidence.json but fixer.js ` +
      `has no dispatch branch or executeAuto${id}/executeAssisted${id} function. ` +
      `Either implement the handler or change fix_type to null/guided.`);
  }
});

runTest('core dimension weights sum to 1.0; extended adds 0.1', () => {
  const dims = WEIGHTS.dimensions || {};
  let coreSum = 0;
  let extendedSum = 0;
  for (const [name, cfg] of Object.entries(dims)) {
    const w = Number(cfg.weight);
    if (EXTENDED_DIMS.has(name)) {
      extendedSum += w;
    } else {
      coreSum += w;
    }
  }
  // Allow tiny floating-point slop
  const approxEq = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(approxEq(coreSum, 1.0),
    `6 core dimensions must have weights summing to 1.0, got ${coreSum}`);
  assert.ok(approxEq(extendedSum, 0.1),
    `extended dimensions (deep+session) must have weights summing to 0.1, got ${extendedSum}`);
});

runTest('exactly 6 core dimensions and 2 extended dimensions', () => {
  const dimsInWeights = Object.keys(WEIGHTS.dimensions || {});
  const coreDims = dimsInWeights.filter((d) => !EXTENDED_DIMS.has(d));
  const extDims = dimsInWeights.filter((d) => EXTENDED_DIMS.has(d));
  assert.equal(coreDims.length, 6, `expected 6 core dims, got: ${coreDims.join(', ')}`);
  assert.equal(extDims.length, 2, `expected 2 extended dims (deep, session), got: ${extDims.join(', ')}`);
});

runTest('every check dimension is defined in weights.json', () => {
  const dimsInWeights = new Set(Object.keys(WEIGHTS.dimensions || {}));
  for (const id of CHECK_IDS) {
    const c = EVIDENCE.checks[id];
    assert.ok(dimsInWeights.has(c.dimension),
      `${id}: dimension "${c.dimension}" is not declared in weights.json`);
  }
});

runTest('accuracy compare-results.js derives ALL_CHECKS from evidence.json', () => {
  // Guard against a hardcoded ALL_CHECKS array that silently drifts from
  // evidence.json. Must read evidence.json at runtime and filter to
  // scope === "core" (extended dims come from other analyzers).
  const src = fs.readFileSync(
    path.join(ROOT, 'tests', 'accuracy', 'compare-results.js'),
    'utf8',
  );
  assert.match(src, /evidence\.json/,
    'compare-results.js must reference evidence.json as the check source');
  assert.match(src, /scope\s*===\s*['"]core['"]/,
    'compare-results.js must filter to scope === "core"');
  assert.doesNotMatch(src, /const ALL_CHECKS\s*=\s*\[\s*['"]F1['"]/,
    'compare-results.js must not re-hardcode ALL_CHECKS — derive from evidence.json');
});

runTest('README "is my code sent" FAQ does not overclaim local-only', () => {
  // Prior wording answered "No. AgentLint runs locally." flat-out, which is
  // inaccurate: Deep (opt-in) sends selected entry files to a Claude
  // sub-agent. The FAQ must describe the mode-dependent data flow instead.
  const en = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const cn = fs.readFileSync(path.join(ROOT, 'README_CN.md'), 'utf8');
  assert.doesNotMatch(en, /No\. AgentLint runs locally\./,
    'README must not re-introduce "No. AgentLint runs locally" — Deep opt-in sends files off-machine');
  assert.doesNotMatch(cn, /不会。AgentLint 在本地运行/,
    'README_CN must not re-introduce "不会。AgentLint 在本地运行" — Deep opt-in sends files off-machine');
  assert.match(en, /Deep[\s\S]{0,500}sub-agent/i,
    'README must describe Deep sub-agent data flow near the "Is my code sent anywhere" FAQ');
  assert.match(cn, /Deep[\s\S]{0,500}sub-agent/i,
    'README_CN must describe Deep sub-agent data flow near the same FAQ');
});

runTest('commands/al.md creates RUN_DIR parent before mktemp', () => {
  // Without mkdir -p, mktemp -d fails on first /al invocation because
  // ${CLAUDE_PLUGIN_DATA}/runs does not exist yet on a fresh plugin install.
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const mkdirIdx = src.indexOf('mkdir -p "$RUN_ROOT"');
  const mktempIdx = src.indexOf('mktemp -d "$RUN_ROOT');
  assert.ok(mkdirIdx >= 0,
    'commands/al.md must mkdir -p the RUN_ROOT parent directory');
  assert.ok(mktempIdx >= 0,
    'commands/al.md must create RUN_DIR via mktemp -d under RUN_ROOT');
  assert.ok(mktempIdx > mkdirIdx,
    'mktemp -d must appear AFTER mkdir -p so the parent exists first');
});

runTest('commands/al.md resolves $PROJECT_DIR before fixer.js invocation', () => {
  // Step 6 calls `fixer.js --project-dir "$PROJECT_DIR"`. Without a prior
  // resolution step, $PROJECT_DIR is undefined and fixer either errors or
  // (worse) picks the wrong repo if the shell happens to have the var set.
  // Resolution now uses SELECTED_PATH (absolute) directly — Step 5c picks
  // a project_path from scan.jsonl so the find-by-basename footgun is
  // gone entirely.
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const usesProjectDir = src.includes('--project-dir "$PROJECT_DIR"');
  if (!usesProjectDir) return;
  const resolutionIdx = src.indexOf('PROJECT_DIR="$SELECTED_PATH"');
  const fixerInvokeIdx = src.indexOf('node "$AL_DIR/src/fixer.js"');
  assert.ok(resolutionIdx >= 0,
    'commands/al.md must set PROJECT_DIR from SELECTED_PATH (absolute, canonical)');
  assert.ok(fixerInvokeIdx > resolutionIdx,
    'PROJECT_DIR resolution must appear BEFORE the node ... fixer.js invocation');
  assert.match(src, /SELECTED_PATH/,
    'commands/al.md must introduce SELECTED_PATH as the canonical project identifier');
});

runTest('E2B orchestrator and workflow gate treat PARTIAL as failure by default', () => {
  // Without this, an E2B scenario passing only 80% of its checks returned
  // PARTIAL and the release gate shrugged — letting degraded behavior ship.
  // Default must fail on PARTIAL; exploratory runs opt out via
  // orchestrator.py --allow-partial.
  const orch = fs.readFileSync(path.join(ROOT, 'tests', 'e2b', 'orchestrator.py'), 'utf8');
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'e2b-comprehensive.yml'), 'utf8');
  assert.match(orch, /if not args\.allow_partial:\s+fail_count \+= partial_count/,
    'orchestrator.py must count PARTIAL toward failure by default (--allow-partial opts out)');
  assert.match(wf, /total_partial\s*>\s*0/,
    'e2b-comprehensive.yml release gate must fail when total_partial > 0');
});

runTest('/al filter narrows top-level items, not just grouped display', () => {
  // CRITICAL: plan-generator.js emits both `items` (flat, consumed by
  // fixer.js) and `grouped` (display-only). Filter must hit both,
  // preferring project_path (canonical) and falling back to basename
  // only for legacy records.
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const usesFixer = src.includes('node "$AL_DIR/src/fixer.js"');
  if (!usesFixer) return;
  assert.match(src, /\.items\s*\|=\s*map\(select\([\s\S]{0,200}\.project_path[\s\S]{0,50}==\s*\$pp/,
    'al.md must filter top-level .items by .project_path == $pp before passing plan to fixer');
  assert.match(src, /\.grouped\s*\|=/,
    'al.md must also filter the grouped display tree for UI consistency');
  assert.match(src, /project_paths[\s\S]{0,100}\$pp/,
    'al.md grouped filter must consult .project_paths (the canonical array)');
});

runTest('action.yml fails closed on plan-generator errors and invalid fail-below', () => {
  // Two historical footguns in action.yml:
  //   1. `plan-generator.js 2>/dev/null || echo '{"items":[]}' > ...` silently
  //      converted any plan-generator failure (malformed scores, crash) into
  //      a fake empty plan — CI stayed green despite a real product failure.
  //   2. `[ "${AL_FAIL_BELOW}" -gt 0 ]` with non-integer values like "abc" or
  //      "60.5" emits "integer expression expected" to stderr and then the
  //      comparison evaluates to false — silently accepting invalid input.
  //      `101` also passed though docs say range is 0-100.
  const yml = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8');
  assert.doesNotMatch(yml, /plan-generator\.js.*2>\/dev\/null.*\|\|/,
    'action.yml must not swallow plan-generator stderr + fall back to empty plan');
  assert.match(yml, /AgentLint plan generation failed[\s\S]{0,200}exit 1/,
    'action.yml plan step must emit an error + exit 1 on plan-generator failure');
  assert.match(yml, /\/\^\(100\|\[1-9\]\?\[0-9\]\)\$\//,
    'action.yml Threshold check must validate fail-below against the 0-100 integer regex');
});

runTest('agentlint fix without a check id fails fast with a product-level message', () => {
  // Prior behavior: `agentlint fix --project-dir <repo>` piped
  // scorer → plan-generator → fixer with no --checks or --items,
  // which tripped fixer.js's "--items or --checks is required" throw
  // and also emitted an EPIPE Node stack trace upstream. Option A:
  // reject the no-check-id path fast with a clear message pointing
  // to the correct usage.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'agentlint.sh'), 'utf8');
  assert.match(src, /a check id is required/,
    'agentlint.sh fix branch must emit a clear product-level message when no check id is supplied');
  // Must not pipe into fixer.js without passing --checks or --items.
  // The specific prior-buggy pattern was `fixer.js" "${path_args[@]}"` with
  // no flag in between — reject it.
  assert.doesNotMatch(src, /fixer\.js"\s+"\$\{path_args\[@\]\}"/,
    'agentlint.sh must not invoke fixer.js without --checks or --items');
  // Parser must accept comma-separated check ids like `W11,F5,S1` (help
  // advertises the form; README too). Prior regex was `^[A-Z][A-Z0-9-]+$`
  // with no comma, so `fix W11,F5` hit the `path_args` fallback and then
  // tripped the no-check-id error.
  assert.match(src, /\^\[A-Z\]\[A-Z0-9-\]\+\(,\[A-Z\]\[A-Z0-9-\]\+\)\*\$/,
    'agentlint.sh fix parser must accept comma-separated check IDs');
  assert.match(src, /agentlint fix W11,F5,S1/,
    'agentlint help output must document the comma-separated form');
});

runTest('setup.sh validates flag values and is non-destructive by default', () => {
  // `agentlint setup --lang` (no value) used to trip `$2: unbound variable`
  // under `set -euo pipefail` — a confusing shell error for a user mistake.
  // Also: CODEOWNERS, PR template, and ISSUE_TEMPLATE used to be copied
  // unconditionally, silently overwriting existing files in the target repo.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'setup.sh'), 'utf8');
  assert.match(src, /require_value\s*\(\)\s*{/,
    'setup.sh must define a require_value helper that checks flag values');
  assert.match(src, /agentlint setup: \$flag requires a value/,
    'setup.sh require_value must emit a product-level message');
  assert.match(src, /require_value --lang /,
    'setup.sh --lang branch must call require_value');
  assert.match(src, /copy_guarded/,
    'setup.sh must use copy_guarded (or equivalent) to avoid overwriting existing files by default');
  assert.match(src, /--force/,
    'setup.sh must document a --force flag to allow explicit overwrite');
});

runTest('fixer.js F5 reference resolution aligns with scanner semantics', () => {
  // Scanner rejects absolute paths and `..` traversal for F5 references
  // (src/scanner.sh:390-406). Fixer used to accept absolute paths whenever
  // the host filesystem had a match, and it also probed process.cwd().
  // Drift between scanner and fixer meant an absolute home-directory
  // reference could be "broken" to the scanner but "present" to the fixer
  // — bad for portability and for checks that mutate entry files.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'fixer.js'), 'utf8');
  const fn = src.slice(
    src.indexOf('function referenceExists'),
    src.indexOf('function removeLinesWithBrokenReferences'),
  );
  assert.match(fn, /path\.isAbsolute\(raw\)\)\s*return\s*false/,
    'referenceExists must reject absolute paths (scanner alignment)');
  assert.match(fn, /\.\./,
    'referenceExists must reject parent-dir traversal (scanner alignment)');
  assert.doesNotMatch(fn, /fs\.existsSync\(path\.join\(process\.cwd/,
    'referenceExists must not probe process.cwd() — scanner stays inside projectDir only');
});

runTest('agentlint doctor command exists and checks required deps', () => {
  // Fresh users can install successfully then fail on first scan with a
  // missing dependency. Doctor surfaces the problem upfront: `node 20+`,
  // `bash`, `jq`, `git`, with platform-specific install hints.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'agentlint.sh'), 'utf8');
  assert.match(src, /^\s*doctor\)\s*$/m,
    'agentlint.sh must dispatch a `doctor` subcommand');
  for (const dep of ['node', 'bash', 'jq', 'git']) {
    assert.match(src, new RegExp(`check_dep\\s+${dep}\\b`),
      `agentlint doctor must check for ${dep}`);
  }
  assert.match(src, /node_major.*-lt\s+20/,
    'agentlint doctor must enforce Node 20+ (package.json engines contract)');
});

runTest('/al Deep/Session flow scores only after all selected analyzers run', () => {
  // Previously Step 3 in commands/al.md ran scanner + scorer immediately,
  // then Deep Analysis text said it runs "AFTER Step 3 and BEFORE Step 4
  // (scoring)" — but Step 3 had already scored. Extended analyzers had
  // no way to flip score_scope without re-scoring. Correct pipeline:
  // Step 3 (scan-only) → Step 3b (optional Deep/Session) → Step 3c
  // (merge all JSONL → score → plan) → Step 4 (present).
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  assert.match(src, /### Step 3: Core scan \(no interaction, no scoring yet\)/,
    'Step 3 must be scan-only, explicitly deferring scoring');
  assert.match(src, /### Step 3b: Extended analyzers/,
    'Step 3b must conditionally run Deep/Session before scoring');
  assert.match(src, /### Step 3c: Merge \+ score \+ plan/,
    'Step 3c must do the merge + score + plan in one pass');
  // Step 3 must NOT call scorer directly — that defeats the whole point.
  const step3Body = src.slice(
    src.indexOf('### Step 3: Core scan'),
    src.indexOf('### Step 3b:'),
  );
  assert.doesNotMatch(step3Body, /node\s+"\$AL_DIR\/src\/scorer\.js"/,
    'Step 3 must not invoke scorer.js — scoring belongs to Step 3c after analyzers have merged');
});

runTest('/al Session section aligns with Step 3b positioning', () => {
  // PR #156 moved Session into Step 3b but left the Session subsection's
  // original "After Step 4, before Step 5" text intact — a direct
  // contradiction. Session must be described as Step 3b and must not
  // claim a post-scoring position.
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const sessionSection = src.slice(src.indexOf('## Session Analysis'));
  assert.doesNotMatch(sessionSection, /After Step 4, before Step 5/,
    'Session section must not claim a post-scoring position — it runs in Step 3b');
  assert.match(sessionSection, /Step 3b/,
    'Session section must identify itself as Step 3b');
});

runTest('/al Deep conversion uses per-project file names, not shared literals', () => {
  // Previously the Deep conversion example used `--project my-project`
  // (literal) and `$RUN_DIR/d1-ai.json` (shared across all projects).
  // Multi-project runs would mis-attribute findings or overwrite files.
  // Must use `$P` and `$RUN_DIR/${P}.d1-ai.json` form.
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const deepSection = src.slice(src.indexOf('## AI Deep Analysis'));
  assert.doesNotMatch(deepSection, /--project my-project/,
    'Deep conversion must not use the literal project name "my-project" — pass "$P"');
  assert.doesNotMatch(deepSection, /\$RUN_DIR\/d1-ai\.json\b/,
    'Deep conversion must not use shared per-check filenames — prefix with per-project "$P"');
  assert.match(deepSection, /\$\{P\}\.d1-ai\.json/,
    'Deep conversion must use per-project file names like "${P}.d1-ai.json"');
});

runTest('deep-analyzer --format-result validates --check against D1/D2/D3', () => {
  // Previously `expectedKey && !Array.isArray(...)` — when --check was
  // missing or anything other than D1/D2/D3, expectedKey was undefined
  // and the whole condition short-circuited false, letting invalid
  // checks like D4 / d1 / garbage produce empty output with exit 0.
  // Validate the check id up front with an explicit allowlist.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'deep-analyzer.js'), 'utf8');
  assert.match(src, /VALID_CHECK_IDS\s*=\s*new Set\(\[['"]D1['"],\s*['"]D2['"],\s*['"]D3['"]\]\)/,
    'deep-analyzer.js must define a VALID_CHECK_IDS allowlist');
  assert.match(src, /!VALID_CHECK_IDS\.has\(checkId\)/,
    'deep-analyzer.js must reject check IDs outside the allowlist before formatting');
  assert.doesNotMatch(src, /const checkId = args\[args\.indexOf\('--check'\) \+ 1\] \|\| 'D1'/,
    'deep-analyzer.js must not default missing --check to D1 (hides the bug)');
});

runTest('session-analyzer emits "ran, no issue" sentinels so scope flips on clean repos', () => {
  // Previously session-analyzer only emitted records for actual findings.
  // A clean repo (sessions scanned, nothing flagged) produced 0 records;
  // scorer's `state.checks.length > 0` test then marked Session as
  // `not_run`, and `score_scope` stayed `core` despite the user selecting
  // Session. Sentinel records for SS1..SS4 with `score: 1` (no issues)
  // flip the dimension to `run` with full score — matching intent.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'session-analyzer.js'), 'utf8');
  assert.match(src, /SS_CHECK_NAMES\s*=\s*\{[\s\S]{0,300}SS1[\s\S]{0,300}SS4/,
    'session-analyzer.js must define SS_CHECK_NAMES covering SS1..SS4');
  assert.match(src, /reportedCheckIds\s*=\s*new Set\(findings\.map/,
    'session-analyzer.js must compute the set of check IDs that got findings');
  assert.match(src, /No issues found in analyzed sessions/,
    'sentinel records must carry a recognizable "no issues" detail string');
});

runTest('scanner + scorer + plan-generator bucket by project_path (not basename)', () => {
  // Same-basename repos under different parent dirs (e.g. org1/app +
  // org2/app) used to collide into one bucket end-to-end. Every layer
  // of the pipeline must propagate project_path or the collision
  // returns silently — data corruption risk for mutating fixes.
  const scanner = fs.readFileSync(path.join(ROOT, 'src', 'scanner.sh'), 'utf8');
  const scorer = fs.readFileSync(path.join(ROOT, 'src', 'scorer.js'), 'utf8');
  const planGen = fs.readFileSync(path.join(ROOT, 'src', 'plan-generator.js'), 'utf8');

  assert.match(scanner, /project_path:\s*\$project_path/,
    'scanner.sh emit_result must include a project_path field in every JSONL record');
  assert.match(scorer, /const pathKey = record\.project_path/,
    'scorer.js mergeRecord must key byProject on project_path (basename fallback only)');
  assert.match(planGen, /dedupeProject = normalized\.project_path \|\| normalized\.project/,
    'plan-generator.js dedupe key must use project_path when available');
});

runTest('/al Step 5c selects by project_path, not basename', () => {
  // commands/al.md used to pick projects via `.project` (basename) and
  // resolve via find-first-match. On basename collision this silently
  // picked the wrong repo and fixer applied changes to the wrong dir.
  // Step 5c must now use `.project_path` for both the option list and
  // the filter.
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const step5c = src.slice(src.indexOf('Step 5c'));
  assert.match(step5c, /UNIQUE_PATHS.*\.project_path/,
    'Step 5c must enumerate projects by .project_path (not .project)');
  assert.match(step5c, /\.project_path == \$pp|\.project_path\s*==\s*\$pp/,
    'Step 5c plan filter must compare .project_path to the selected path');
  assert.doesNotMatch(step5c, /find "\$PROJECTS_ROOT".*basename.*SELECTED_PROJECT/s,
    'Step 5c must not use find + basename to resolve the project dir');
});

runTest('plan-generator grouped items carry project_paths array', () => {
  // Without project_paths on grouped items, /al Step 5c can only filter
  // by basename — which re-introduces the basename-collision bug at the
  // grouped-plan layer even after PR #162 fixed the flat items.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'plan-generator.js'), 'utf8');
  assert.match(src, /project_paths:\s*\[item\.project_path/,
    'plan-generator.js mergeItems must initialize project_paths array for grouped items');
  assert.match(src, /merged\.project_paths\.push/,
    'plan-generator.js mergeItems must append to project_paths when merging');
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
