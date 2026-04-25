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
const { execFileSync, execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
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

function yamlList(src, key) {
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start < 0) return [];
  const items = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('- ')) {
      items.push(trimmed.slice(2));
      continue;
    }
    if (!lines[i].startsWith(' ')) break;
  }
  return items;
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

runTest('accuracy compare-results.js fail-on-missing core checks with ACCURACY_ALLOW_MISSING support', () => {
  // Regression task added fail-closed behavior for missing core labeled data, with
  // explicit per-check exemptions via ACCURACY_ALLOW_MISSING.
  const src = fs.readFileSync(
    path.join(ROOT, 'tests', 'accuracy', 'compare-results.js'),
    'utf8',
  );
  assert.match(src, /ACCURACY_ALLOW_MISSING/,
    'compare-results.js must read ACCURACY_ALLOW_MISSING');
  assert.match(src, /split\(\s*['"]\s*,\s*['"]\s*\)/,
    'ACCURACY_ALLOW_MISSING must be parsed as comma-separated values');
  assert.match(src, /missingCoreChecks[\s\S]{0,140}process\.exit\(1\)/,
    'compare-results.js must fail closed on missing core checks');
  assert.match(src, /scope\s*===\s*['"]core['"]/,
    'compare-results.js must gate the missing-check fail path on core scope');
});

runTest('accuracy compare-results.js fails when fewer than 90% of labeled repos match scanner output', () => {
  // Empty or drifted scanner output must not pass the accuracy gate just
  // because every metric becomes unmeasurable.
  const src = fs.readFileSync(
    path.join(ROOT, 'tests', 'accuracy', 'compare-results.js'),
    'utf8',
  );
  assert.match(src, /matchedRepos\s*<\s*0\.9\s*\*\s*labeledRepos/,
    'compare-results.js must fail when matched repos are below 90% of labeled repos');
  assert.match(src, /Only \$\{matchedRepos\} \/ \$\{labeledRepos\} repos matched/,
    'compare-results.js must print a clear matched-repo threshold error');
  assert.match(src, /Likely scanner output empty or project naming drifted from labels/,
    'compare-results.js must explain the likely empty-output/project-name drift cause');
});

runTest('accuracy compare-results.js fails when matched core check totals are zero', () => {
  // Labels-side coverage alone is not enough: a core check with 0 matched
  // rows after scanner matching has no precision/recall denominator.
  const src = fs.readFileSync(
    path.join(ROOT, 'tests', 'accuracy', 'compare-results.js'),
    'utf8',
  );
  assert.match(src, /zeroMatchedCoreChecks[\s\S]{0,200}results\[check\]\.total\s*===\s*0/,
    'compare-results.js must detect core checks whose matched total === 0');
  assert.match(src, /zeroMatchedCoreChecks[\s\S]{0,200}ACCURACY_ALLOW_MISSING\.has\(check\)/,
    'matched-side zero-total gate must honor ACCURACY_ALLOW_MISSING');
  assert.match(src, /core check\(s\) have total === 0 after matching/,
    'compare-results.js must print a clear zero matched-total error');
});

runTest('package.json repository.url uses npm canonical git+https .git form', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.repository && pkg.repository.url, /^git\+https:\/\/.*\.git$/,
    'package.json repository.url must use git+https://... .git form');
});

runTest('reporter.js report filenames include an HHMMSS time component', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'reporter.js'), 'utf8');
  assert.match(src, /slice\(11,\s*19\)\.replace\(\s*\/:\/g,\s*['"]{2}\s*\)/,
    'reporter.js must derive an HHMMSS time component for report filenames');
  assert.match(src, /randomBytes\(4\)\.toString\(['"]hex['"]\)/,
    'reporter.js must add a short unique suffix so same-second reports do not collide');
  assert.match(src, /fileStamp\s*=\s*`\$\{date\}-\$\{time\}-\$\{unique\}`/,
    'reporter.js must append the time component and unique suffix to the date stamp');
  assert.match(src, /`al-\$\{fileStamp\}\.html`/,
    'reporter.js HTML filename must use the date+time stamp');
  assert.match(src, /`al-\$\{fileStamp\}\.md`/,
    'reporter.js Markdown filename must use the date+time stamp');
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
  const resolutionIdx = src.indexOf('PROJECT_DIR="$(python3 -c "$REALPATH_CMD" "$SELECTED_PATH")"');
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
  assert.match(yml, /v\.trim\(\)\s*===\s*[""]{2}[\s\S]{0,120}fail-below requires a numeric value/,
    'action.yml Threshold check must reject whitespace-only fail-below before numeric coercion');
});

runTest('action.yml surfaces annotation and SARIF upload failures', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8');
  assert.doesNotMatch(yml, /emit-workflow-commands\.js[\s\S]{0,160}\|\|\s*true/,
    'action.yml must not swallow annotation generation failures with `|| true`');
  assert.match(yml, /AgentLint annotation generation failed[\s\S]{0,120}exit 1/,
    'action.yml must emit a visible error and exit when annotation generation fails');
  assert.doesNotMatch(yml, /continue-on-error:\s*true/,
    'SARIF upload must not be soft-failed with continue-on-error: true');
  assert.match(yml, /github\/codeql-action\/upload-sarif/,
    'action.yml must still upload SARIF when sarif-upload is enabled');
});

runTest('reporter rejects empty --fail-below values', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-empty-fail-below-'));
  try {
    const scoresPath = path.join(tempDir, 'scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify({ total_score: 100, dimensions: {}, by_project: {} }));

    for (const args of [
      [path.join(ROOT, 'src', 'reporter.js'), scoresPath, '--fail-below='],
      [path.join(ROOT, 'src', 'reporter.js'), scoresPath, '--fail-below', ''],
    ]) {
      const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
      assert.equal(result.status, 1, `${args.join(' ')} must exit 1`);
      assert.match(result.stderr, /--fail-below requires a numeric value \(0-100\)/);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('branch-protection.yml declares the canonical required checks', () => {
  const protectionPath = path.join(ROOT, '.github', 'branch-protection.yml');
  assert.ok(fs.existsSync(protectionPath),
    '.github/branch-protection.yml must exist as the checked-in branch protection contract');

  const yml = fs.readFileSync(protectionPath, 'utf8');
  assert.match(yml, /repository:\s*0xmariowu\/AgentLint/);
  assert.match(yml, /branch:\s*main/);

  const required = [
    'lint (20)',
    'lint (22)',
    'test (20)',
    'test (22)',
    'scan',
    'label',
    'accuracy',
    'npm-e2e',
    'analyze',
    'Semgrep',
  ];
  assert.deepEqual(yamlList(yml, 'contexts'), required,
    'branch-protection.yml required_status_checks.contexts must match the canonical gate set');

  const scriptPath = path.join(ROOT, 'scripts', 'setup-branch-protection.sh');
  assert.ok(fs.existsSync(scriptPath),
    'scripts/setup-branch-protection.sh must exist for an admin to apply the checked-in contract manually');
  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.match(script, /branch-protection\.yml/,
    'setup script must read the checked-in branch-protection.yml file');
  assert.match(script, /protection\/required_status_checks/,
    'setup script must update required status checks, not unrelated branch protection settings');
});

runTest('stable required check contexts exist for npm-e2e and Semgrep', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /npm-e2e-summary:[\s\S]{0,120}name:\s*npm-e2e/,
    'ci.yml must emit a stable npm-e2e summary check for branch protection');

  const semgrep = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'semgrep.yml'), 'utf8');
  assert.match(semgrep, /jobs:[\s\S]*scan:[\s\S]{0,80}name:\s*Semgrep/,
    'semgrep.yml must emit a stable Semgrep check name for branch protection');
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

runTest('setup.sh guards symlink writes and backs up changed overwrites', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'setup.sh'), 'utf8');
  assert.doesNotMatch(src, /readlink -f/,
    'setup.sh must not depend on GNU readlink -f; macOS BSD readlink lacks it on older systems');
  assert.match(src, /realpath_portable\s*\(\)\s*{[\s\S]{0,260}pwd -P/,
    'setup.sh must resolve paths with a portable cd + pwd -P helper');
  assert.match(src, /assert_project_path\s*\(\)/,
    'setup.sh must assert resolved write targets stay under PROJECT_ROOT');
  assert.match(src, /al-backup-\$\{BACKUP_TS\}/,
    'setup.sh must create per-file .al-backup timestamp backups before changed overwrites');
  assert.match(src, /backed up/,
    'setup.sh must print a visible backup message');
});

runTest('setup.sh has rollback transaction and git top-level default', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'setup.sh'), 'utf8');
  assert.match(src, /--project-dir/,
    'setup.sh must expose --project-dir as the explicit root override');
  assert.match(src, /PROJECT_DIR_EXPLICIT/,
    'setup.sh must distinguish explicit project-dir from default root detection');
  assert.match(src, /rev-parse --show-toplevel/,
    'setup.sh must default setup to the git top-level when run from a subdirectory');
  assert.match(src, /rollback_setup\s*\(\)/,
    'setup.sh must define rollback_setup for partial-write failures');
  assert.match(src, /trap 'rollback_setup "\$\?"' EXIT/,
    'setup.sh must run rollback_setup on exit before the transaction is committed');
  assert.match(src, /track_path_before_write/,
    'setup.sh must record newly-created write targets before mutating them');
});

runTest('setup.sh refuses non-git dirs unless --init-git is explicit', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'setup.sh'), 'utf8');
  assert.match(src, /--init-git/,
    'setup.sh must expose --init-git as the explicit opt-in for git init');
  assert.match(src, /rev-parse --is-inside-work-tree/,
    'setup.sh must validate the target with git rev-parse');
  assert.match(src, /target is not a git repo[\s\S]{0,120}--init-git/,
    'setup.sh must refuse non-git targets by default and mention --init-git');
});

runTest('setup.sh makes auto-push workflow opt-in', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'setup.sh'), 'utf8');
  assert.match(src, /--with-auto-push/,
    'setup.sh must expose --with-auto-push for autofix workflows');
  assert.match(src, /basename "\$src"[\s\S]{0,120}autofix\.yml[\s\S]{0,120}WITH_AUTO_PUSH/,
    'setup.sh must skip autofix.yml unless --with-auto-push is set');
  assert.match(fs.readFileSync(path.join(ROOT, 'templates', 'ts', 'autofix.yml'), 'utf8'), /git push origin/,
    'templates/ts/autofix.yml is the auto-push workflow that must be opt-in');
});

runTest('setup gitignore templates ship in npm package and install as .gitignore', () => {
  const langs = ['ts', 'node', 'python'];
  for (const lang of langs) {
    const templatePath = path.join(ROOT, 'templates', 'configs', lang, 'gitignore');
    assert.ok(fs.existsSync(templatePath),
      `templates/configs/${lang}/gitignore must exist without a leading dot so npm ships it`);
  }

  const setup = fs.readFileSync(path.join(ROOT, 'scripts', 'setup.sh'), 'utf8');
  assert.match(setup, /\$TEMPLATE_DIR\/configs\/\$LANG\/gitignore/,
    'setup.sh must copy from configs/$LANG/gitignore to destination .gitignore');
  assert.match(setup, /copy_template "\$TEMPLATE_DIR\/configs\/\$LANG\/gitignore" "\$PROJECT\/\.gitignore"/,
    'setup.sh must route .gitignore install through guarded copy_template');
  assert.doesNotMatch(setup, /configs\/\$LANG\/\.gitignore/,
    'setup.sh must not copy from configs/$LANG/.gitignore because npm strips that file');

  const npmCache = fs.mkdtempSync(path.join(os.tmpdir(), 'agentlint-npm-cache-'));
  const packJson = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: npmCache },
  });
  const pack = JSON.parse(packJson);
  const files = new Set((pack[0] && pack[0].files || []).map((file) => file.path));
  for (const lang of langs) {
    const packagePath = `templates/configs/${lang}/gitignore`;
    assert.ok(files.has(packagePath),
      `npm pack must include ${packagePath}`);
  }
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

runTest('fixer.js validates git repo deeply and refuses dirty trees by default', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'fixer.js'), 'utf8');
  assert.match(src, /rev-parse['"],\s*['"]--show-toplevel/,
    'fixer.js must resolve the git working-tree root');
  assert.match(src, /path\.join\(gitDir,\s*'HEAD'\)/,
    'fixer.js must verify HEAD inside the resolved git dir');
  assert.match(src, /lstatSync\(headPath\)/,
    'fixer.js must lstat HEAD and validate its file type');
  assert.match(src, /status['"],\s*['"]--porcelain/,
    'fixer.js must check for uncommitted changes');
  assert.match(src, /--force-dirty/,
    'fixer.js must provide an explicit dirty-tree opt-out');
});

runTest('fixer.js resolves write targets before fs.writeFileSync', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'fixer.js'), 'utf8');
  assert.match(src, /function assertRealPathInsideProject/,
    'fixer.js must define a realpath-based project-boundary assertion');
  assert.match(src, /assertRealPathInsideProject\(projectDir,\s*filePath\)[\s\S]{0,80}fs\.writeFileSync\(filePath/,
    'fixer.js must assert filePath is inside the project before mutating entry files');
  assert.match(src, /assertRealPathInsideProject\(projectDir,\s*targetPath\)/,
    'fixer.js must assert generated target paths before writing workflow/hook files');
});

runTest('fixer.js rolls back multi-item transactions on failure', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'fixer.js'), 'utf8');
  assert.match(src, /function createTransaction/,
    'fixer.js must create a per-run transaction');
  assert.match(src, /function rollbackTransaction/,
    'fixer.js must define rollbackTransaction');
  assert.match(src, /transaction\.backups\.push/,
    'fixer.js must track backups for restoration');
  assert.match(src, /transaction\.createdPaths\.push/,
    'fixer.js must track created paths for cleanup');
  assert.match(src, /result\.status === 'failed'[\s\S]{0,80}rollbackTransaction/,
    'fixer.js must roll back the run when any selected item fails');
  assert.match(src, /rolled_back/,
    'fixer.js output must report when a transaction was rolled back');
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
  // Must use basename + hash prefix and path-stable file names.
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const deepSection = src.slice(src.indexOf('## AI Deep Analysis'));
  assert.doesNotMatch(deepSection, /--project my-project/,
    'Deep conversion must not use the literal project name "my-project" — pass "$P"');
  assert.doesNotMatch(deepSection, /\$RUN_DIR\/d1-ai\.json\b/,
    'Deep conversion must not use shared per-check filenames — prefix with per-project "$P"');
  assert.match(deepSection, /\$\{PREFIX\}\.d1-ai\.json/,
    'Deep conversion must use per-project path-keyed file names like "${PREFIX}.d1-ai.json"');
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

runTest('scanner.sh resolves symlinks + handles empty/missing PROJECTS_ROOT', () => {
  // Three failure modes that made scanner unusable in real setups:
  //   1. Invoked via an npm global-install symlink, SCRIPT_DIR ended up at
  //      the symlink location and REPO_ROOT/standards/evidence.json was
  //      nowhere on disk.
  //   2. `PROJECTS_ROOT='~/Projects'` (literal, from /al's saved config)
  //      never tilde-expanded, so find walked nothing.
  //   3. `"${projects[@]}"` on Bash 3.2 (macOS) with an empty array +
  //      `set -u` crashed with `projects[@]: unbound variable` instead of
  //      a product-level message.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'scanner.sh'), 'utf8');
  assert.match(src, /readlink -f "\$\{BASH_SOURCE\[0\]\}"/,
    'scanner.sh must resolve its own path through readlink so npm symlinks work');
  assert.match(src, /projects_root="\$HOME\/\$\{projects_root#'~\/'\}"/,
    'scanner.sh must expand a leading ~/ in PROJECTS_ROOT');
  assert.match(src, /\$\{#projects\[@\]\}"?\s*-eq\s*0/,
    'scanner.sh must guard an empty discovered-projects array before iterating');
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
  assert.match(scorer, /const projectPath = typeof record\.project_path/,
    'scorer.js mergeRecord must key byProject on project_path (basename fallback only)');
  assert.match(planGen, /dedupeProject = normalized\.project_path \|\| normalized\.project/,
    'plan-generator.js dedupe key must use project_path when available');
});

runTest('reporter SARIF artifact URIs preserve project_path identity', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-sarif-project-path-'));
  try {
    const scores = {
      total_score: 60,
      dimensions: {},
      by_project: {
        'org1/app': {
          project: 'app',
          project_path: 'org1/app',
          findability: {
            checks: [
              { check_id: 'F5', name: 'All references resolve', score: 0.4, measured_value: 1, detail: 'broken refs' },
            ],
          },
        },
        'org2/app': {
          project: 'app',
          project_path: 'org2/app',
          findability: {
            checks: [
              { check_id: 'F5', name: 'All references resolve', score: 0.3, measured_value: 1, detail: 'broken refs' },
            ],
          },
        },
      },
    };
    const scoresPath = path.join(tempDir, 'scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2));

    execFileSync(process.execPath, [
      path.join(ROOT, 'src', 'reporter.js'),
      scoresPath,
      '--format',
      'sarif',
      '--output-dir',
      tempDir,
    ], { cwd: ROOT });

    const sarifFile = fs.readdirSync(tempDir).find((file) => file.endsWith('.sarif'));
    assert.ok(sarifFile, 'reporter must write a SARIF file');
    const sarif = JSON.parse(fs.readFileSync(path.join(tempDir, sarifFile), 'utf8'));
    const uris = sarif.runs[0].results.map((result) => (
      result.locations[0].physicalLocation.artifactLocation.uri
    )).sort();
    assert.deepEqual(uris, ['org1/app/CLAUDE.md', 'org2/app/CLAUDE.md']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('reporter SARIF artifact URIs use AGENTS.md for AGENTS-only repos', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-sarif-agents-entry-'));
  try {
    const scores = {
      total_score: 60,
      dimensions: {},
      by_project: {
        'org/agents-only': {
          project: 'agents-only',
          project_path: 'org/agents-only',
          findability: {
            checks: [
              {
                check_id: 'F1',
                name: 'Entry file exists',
                score: 1,
                measured_value: { entry_file: 'AGENTS.md', platform: 'openai', all_files: ['AGENTS.md'] },
                detail: 'AGENTS.md found',
              },
            ],
          },
          instructions: {
            checks: [
              { check_id: 'I1', name: 'Project overview present', score: 0.2, measured_value: 0, detail: 'missing overview' },
            ],
          },
        },
      },
    };
    const scoresPath = path.join(tempDir, 'scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2));

    execFileSync(process.execPath, [
      path.join(ROOT, 'src', 'reporter.js'),
      scoresPath,
      '--format',
      'sarif',
      '--output-dir',
      tempDir,
    ], { cwd: ROOT });

    const sarifFile = fs.readdirSync(tempDir).find((file) => file.endsWith('.sarif'));
    assert.ok(sarifFile, 'reporter must write a SARIF file');
    const sarif = JSON.parse(fs.readFileSync(path.join(tempDir, sarifFile), 'utf8'));
    const i1 = sarif.runs[0].results.find((result) => result.ruleId === 'I1');
    assert.equal(i1.locations[0].physicalLocation.artifactLocation.uri, 'org/agents-only/AGENTS.md');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('session-analyzer sentinels never emit bare records lacking project identity', () => {
  const ss = fs.readFileSync(path.join(ROOT, 'src', 'session-analyzer.js'), 'utf8');
  const scorer = fs.readFileSync(path.join(ROOT, 'src', 'scorer.js'), 'utf8');
  assert.match(ss, /project:\s*null,[\s\S]*project_path:\s*null/,
    'session-analyzer sentinel output should include explicit null project + project_path');
  assert.match(scorer, /if\s*\(\s*!projectPath\s*&&\s*!projectName\s*\)\s*return;/,
    'scorer.mergeRecord must skip byProject bucketing for records without project identity');
});

runTest('session-analyzer SS1/SS4 clusters carry project identity, not global', () => {
  const ss = fs.readFileSync(path.join(ROOT, 'src', 'session-analyzer.js'), 'utf8');
  assert.doesNotMatch(ss, /buildS1Findings[\s\S]{0,500}project:\s*['"]global['"]/,
    'SS1 findings must not default project to global');
  assert.doesNotMatch(ss, /buildS4Findings[\s\S]{0,500}project:\s*['"]global['"]/,
    'SS4 findings must not default project to global');
});

runTest('session-analyzer SS2 hit keys use project path, not basename', () => {
  const ss = fs.readFileSync(path.join(ROOT, 'src', 'session-analyzer.js'), 'utf8');
  assert.match(ss, /project\.dir.*\\u0000.*rule\.text/s,
    'SS2 hit keys must include project.path (or equivalent path-keyed tuple)');
  assert.doesNotMatch(ss, /\$\{project\.name\}::\$\{rule\.text\}/,
    'SS2 must not use basename-only `${project.name}::` keying');
});

runTest('scanner malformed settings.json fails H1-H6 loud', () => {
  const scanner = fs.readFileSync(path.join(ROOT, 'src', 'scanner.sh'), 'utf8');
  assert.match(scanner, /settings_malformed=false/,
    'scanner.sh must track whether .claude/settings.json parsed successfully');
  assert.match(scanner, /jq -e type "\$settings_path" 2>&1 >\/dev\/null/,
    'scanner.sh must validate settings.json with jq and capture stderr before H1-H6 reads');
  assert.match(scanner, /settings\.json malformed: \$\{settings_error\}/,
    'scanner.sh must emit malformed-settings detail instead of silently passing H checks');
  for (const id of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) {
    assert.match(scanner, new RegExp(`emit_result "\\$project_name" "${id}" "null" "null" "0" "settings\\.json malformed:`),
      `${id} must score 0 when settings.json is malformed`);
  }
});

runTest('scorer rejects partially malformed JSONL with line numbers', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'src', 'scorer.js')], {
    encoding: 'utf8',
    input: '{"check_id":"F1","project":"x","score":1}\nnot-json garbage\n{"check_id":"F2","project":"x","score":0}\n',
  });
  assert.equal(result.status, 1, 'scorer must exit non-zero on any malformed nonblank line');
  assert.equal(result.stdout, '', 'scorer must not emit JSON after seeing malformed JSONL');
  assert.match(result.stderr, /malformed JSONL at line\(s\): 2/,
    'scorer error must list offending line numbers');
});

runTest('scorer refuses empty or all-malformed input', () => {
  const scorer = fs.readFileSync(path.join(ROOT, 'src', 'scorer.js'), 'utf8');
  assert.match(scorer, /let validRecordCount = 0/,
    'scorer.js must count accepted scan records');
  assert.match(scorer, /validRecordCount \+= 1/,
    'scorer.js must increment only after buildRecord returns a valid record');
  assert.match(scorer, /scorer\.js: no valid scan records — refusing to compute score/,
    'scorer.js must emit the refusal error for empty/all-malformed input');
  assert.match(scorer, /if \(validRecordCount === 0\)[\s\S]{0,180}process\.exit\(1\)/,
    'scorer.js must exit non-zero before emitting JSON when no records are valid');
});

runTest('session-analyzer leaves unmatched sessions unattributed', () => {
  const ss = fs.readFileSync(path.join(ROOT, 'src', 'session-analyzer.js'), 'utf8');
  assert.match(ss, /project:\s*projectMapping \? projectMapping\.name : null/,
    'unmatched sessions must carry project:null instead of the raw session dirname');
  assert.match(ss, /project_path:\s*projectMapping \? projectMapping\.dir : null/,
    'unmatched sessions must carry project_path:null');
  assert.match(ss, /const project = session\.project_entry;/,
    'SS2 must use the per-session catalog match only, not re-match unmatched sessions');
  assert.doesNotMatch(ss, /session\.project_entry \|\| catalog\.find/,
    'SS2 must not borrow identity from another catalog entry');
});

runTest('plan-generator includes session findings even when fix_type is null', () => {
  const planGen = fs.readFileSync(path.join(ROOT, 'src', 'plan-generator.js'), 'utf8');
  assert.match(planGen, /evidenceRecord\.dimension === 'session'/,
    'plan-generator.js must read session fix_type directly from evidence.json');
  assert.match(planGen, /normalized\.dimension !== 'session'/,
    'plan-generator.js must not drop low-scoring session records just because fix_type is null');
  assert.match(planGen, /fix_command: item\.fix_type \? `agentlint fix \$\{item\.check_id\}` : null/,
    'plan-generator.js must surface null-fix_type session findings as informational, not actionable');
});

runTest('session-analyzer SS3 buckets by project_path, not basename', () => {
  const ss = fs.readFileSync(path.join(ROOT, 'src', 'session-analyzer.js'), 'utf8');
  const s3 = ss.slice(ss.indexOf('function buildS3Findings'), ss.indexOf('async function run'));
  assert.match(s3, /const projectKey = projectPath \|\|/,
    'SS3 must key project stats by project_path when available');
  assert.match(s3, /project_path: stat\.project_path/,
    'SS3 findings must carry project_path for per-project attribution');
  assert.doesNotMatch(s3, /projectStats\.get\(project\)/,
    'SS3 must not use basename-only projectStats.get(project)');
  assert.doesNotMatch(s3, /projectStats\.set\(project,/,
    'SS3 must not use basename-only projectStats.set(project, ...)');
});

runTest('/al Step 3b Deep flow uses project_path, not basename resolution', () => {
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const deepSection = src.slice(src.indexOf('## AI Deep Analysis'), src.indexOf('## Session Analysis'));
  assert.match(deepSection, /--project-path/,
    'Deep format-result invocation must pass --project-path');
  assert.doesNotMatch(deepSection, /find "\$PROJECTS_ROOT"\s+.*-type d -name \.git \|\s*dirname \|\s*grep basename/s,
    'Deep Step 3b must not resolve by basename via find+grep');
  assert.match(deepSection, /project_path/i,
    'Deep Step 3b documentation must reference project_path values');
});

runTest('scanner.sh discovers .git directories and .git files (worktrees)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'scanner.sh'), 'utf8');
  assert.match(src, /find "\$projects_root"[\s\S]{0,160}-type d -name '\.git'[\s\S]{0,60}-o[\s\S]{0,60}-type f -name '\.git'/,
    'scanner.sh discover_projects must search both .git dirs and .git files');
});

runTest('scanner.sh discovery and --projects-root parsing are edge-case safe', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'scanner.sh'), 'utf8');
  assert.match(src, /--projects-root=\*\)[\s\S]{0,180}error: --projects-root requires a path/,
    'scanner.sh must reject --projects-root= with a clear error');
  assert.match(src, /-print0[\s\S]{0,80}while IFS= read -r -d '' gitdir/,
    'scanner.sh discover_projects must use NUL-delimited find output');
  assert.match(src, /while IFS= read -r -d '' arg[\s\S]{0,120}discover_projects "\$projects_root"/,
    'scanner.sh main must consume discovered projects as NUL-delimited paths');
});

runTest('scanner.sh git smoke catches broken git instead of silent skips', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'scanner.sh'), 'utf8');
  assert.match(src, /git --version >\/dev\/null 2>&1/,
    'scanner.sh must smoke-test the git binary');
  assert.match(src, /git -C "\$project_dir" rev-parse --is-inside-work-tree/,
    'scanner.sh must smoke-test git against project worktrees');
  assert.match(src, /error: git is not usable for project/,
    'scanner.sh must fail loudly when git exists but cannot read the project');
});

runTest('scanner.sh W8 parses package.json with jq, not python3', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'scanner.sh'), 'utf8');
  const w8 = src.slice(src.indexOf('# W8'), src.indexOf('# W9'));
  assert.match(w8, /jq -e '\.scripts\.test\? \| strings \| length > 0'/,
    'W8 must use jq to parse package.json scripts.test');
  assert.doesNotMatch(w8, /python3 -c|python -c/,
    'W8 must not require python for package.json parsing');
});

runTest('test-install-script.sh does not use grep -c || echo pattern', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tests', 'test-install-script.sh'), 'utf8');
  assert.doesNotMatch(src, /grep -c [^\n]*\s*\|\|\s*echo 0/,
    'test-install-script.sh must not use grep -c with || echo 0 anti-pattern');
});

runTest('/al Step 5c selects by project_path, not basename', () => {
  // commands/al.md used to pick projects via `.project` (basename) and
  // resolve via find-first-match. On basename collision this silently
  // picked the wrong repo and fixer applied changes to the wrong dir.
  // Step 5c must now use `.project_path` for both the option list and
  // the filter.
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const step5c = src.slice(src.indexOf('Step 5c'));
  assert.match(step5c, /UNIQUE_PATHS[\s\S]{0,300}\.project_path/,
    'Step 5c must enumerate projects by .project_path (not .project)');
  assert.match(step5c, /\.project_path == \$pp|\.project_path\s*==\s*\$pp/,
    'Step 5c plan filter must compare .project_path to the selected path');
  assert.doesNotMatch(step5c, /find "\$PROJECTS_ROOT".*basename.*SELECTED_PROJECT/s,
    'Step 5c must not use find + basename to resolve the project dir');
});

runTest('/al Step 5c canonicalizes selected project and validates git repo', () => {
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const step5c = src.slice(src.indexOf('Step 5c'), src.indexOf('### Step 6'));
  assert.match(step5c, /os\.path\.realpath/,
    'Step 5c must canonicalize project candidates with realpath');
  assert.match(step5c, /PROJECT_DIR="\$\(python3 -c "\$REALPATH_CMD" "\$SELECTED_PATH"\)"/,
    'Step 5c must set PROJECT_DIR to the canonical selected path');
  assert.match(step5c, /git -C "\$PROJECT_DIR" rev-parse --is-inside-work-tree/,
    'Step 5c must verify the selected path is a git repo before fixer.js');
});

runTest('/al Deep flow defines executable per-check loop and output files', () => {
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const deepSection = src.slice(src.indexOf('## AI Deep Analysis'), src.indexOf('## Session Analysis'));
  assert.match(deepSection, /: > "\$RUN_DIR\/deep\.jsonl"/,
    'Deep flow must initialize deep.jsonl before appending');
  assert.match(deepSection, /TASKS_FILE="\$RUN_DIR\/\$\{PREFIX\}\.deep-tasks\.json"/,
    'Deep flow must save generated tasks to a defined per-project file');
  assert.match(deepSection, /for CHECK in D1 D2 D3/,
    'Deep flow must iterate over all supported checks with a concrete loop');
  assert.match(deepSection, /AI_OUT="\$RUN_DIR\/\$\{PREFIX\}\.\$\{CHECK_LOWER\}-ai\.json"/,
    'Deep flow must define each AI output path before using it');
  assert.match(deepSection, /--format-result --project "\$P" --project-path "\$P_DIR" --check "\$CHECK"/,
    'Deep flow must convert each AI output with project and project_path');
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

runTest('deep-analyzer emits project_path + accepts --project-path flag', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'deep-analyzer.js'), 'utf8');
  assert.match(src, /project_path:\s*projectPath/,
    'deep-analyzer formatResultAsJsonl must include project_path in emitted records');
  assert.match(src, /indexOf\('--project-path'\)/,
    'deep-analyzer must parse --project-path flag');
});

runTest('session-analyzer loadProjectCatalog walks nested repos (maxdepth 4)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'session-analyzer.js'), 'utf8');
  assert.match(src, /MAX_DEPTH\s*=\s*4/,
    'session-analyzer must walk up to 4 levels deep to match scanner.sh');
  assert.match(src, /function walk\(dir, depth\)/,
    'session-analyzer must use a recursive walker rather than a single readdirSync');
});

runTest('package.json declares Node 20+ engine and E2B scenarios agree', () => {
  // Contract: docs say Node 20+, installer checks Node 20+, package.json
  // must declare the same. E2B Node 18 scenarios used to claim Node 18
  // as "minimum supported" — they must now assert Node 18 is REJECTED by
  // the engines field.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.engines && />=\s*20/.test(pkg.engines.node || ''),
    `package.json must declare "engines.node" >= 20, got ${JSON.stringify(pkg.engines)}`);
  const specs = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tests', 'e2b', 'scenarios', 'install', 'specs.json'), 'utf8'),
  );
  const node18Scenarios = (specs.scenarios || []).filter((s) => s.node_version === '18');
  assert.ok(node18Scenarios.length > 0,
    'E2B must include at least one Node 18 scenario to exercise the unsupported path');
  for (const s of node18Scenarios) {
    assert.match(s.description || '', /rejected|unsupported/i,
      `E2B scenario ${s.id} on Node 18 must describe rejection, not "minimum supported"`);
    assert.ok(s.expected && s.expected.exit_nonzero_or_engines_warning,
      `E2B scenario ${s.id} must expect a non-zero exit or engines warning on Node 18`);
  }
});

runTest('terminal reporter shows (core+extended) suffix when extended dims ran', () => {
  // Terminal output used to drop the suffix entirely on core+extended,
  // hiding which scoring contract produced the score. Must match the
  // Markdown / HTML formats: ' (core)' vs ' (core+extended)'.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'reporter.js'), 'utf8');
  assert.match(src, /score_scope\s*===\s*['"]core\+extended['"]\s*\?\s*['"]\s*\(core\+extended\)['"]/,
    'reporter.js terminal path must branch on score_scope === "core+extended" and output " (core+extended)"');
});

runTest('fixer.js exits non-zero when any executed item reports failure', () => {
  // Previously run() always process-exited 0, so CI scripts treated a
  // `{"status":"failed","detail":"No plan item found for check ID: Z9"}`
  // report as success and proceeded to a "verify" stage assuming the
  // fix landed. Exit 1 on any failed item.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'fixer.js'), 'utf8');
  assert.match(src, /executed\.some\(\(e\)\s*=>\s*e\s*&&\s*e\.status\s*===\s*['"]failed['"]\)/,
    'fixer.js must check executed[] for failed status');
  assert.match(src, /if\s*\(anyFailed\)\s*process\.exit\(1\)/,
    'fixer.js must process.exit(1) when any executed item failed');
});

runTest('setup.sh does not expose --protect flag (helper not implemented)', () => {
  // --protect required templates/scripts/protect.sh which never landed.
  // Removed in v1.1.1 to avoid the half-installed-then-fails UX. May
  // return in a future release if/when the helper is implemented.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'setup.sh'), 'utf8');
  assert.doesNotMatch(src, /--protect\)/,
    'setup.sh must not parse --protect — flag was removed (helper missing)');
  assert.doesNotMatch(src, /PROTECT=true/,
    'setup.sh must not set PROTECT=true anywhere');
});

runTest('INSTALL.md exists and is the canonical install reference', () => {
  // INSTALL.md is a top-level, AI-consumable fallback doc. README points to
  // it for failure-mode handling after the single default install path.
  // If someone deletes it or relocates it, README links break silently.
  const installPath = path.join(ROOT, 'INSTALL.md');
  assert.ok(fs.existsSync(installPath),
    'INSTALL.md must exist at repo root as the canonical install reference');
  const install = fs.readFileSync(installPath, 'utf8');
  assert.match(install, /For AI coding agents/,
    'INSTALL.md must identify itself as the AI coding agent install reference');
  assert.match(install, /npm install -g agentlint-ai/,
    'INSTALL.md must document the default global npm install path');
  assert.match(install, /--ignore-scripts/,
    'INSTALL.md must keep the `--ignore-scripts` fallback in failure modes');
});

runTest('public install docs use one default install command and point agents to INSTALL.md', () => {
  const install = fs.readFileSync(path.join(ROOT, 'INSTALL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const cn = fs.readFileSync(path.join(ROOT, 'README_CN.md'), 'utf8');
  const intro = fs.readFileSync(path.join(ROOT, 'docs', 'content', 'intro.md'), 'utf8');
  const foregroundFlag = ['--foreground', 'scripts'].join('-');

  for (const [name, src] of [
    ['README.md', readme],
    ['README_CN.md', cn],
    ['docs/content/intro.md', intro],
  ]) {
    assert.match(src, /npm install -g agentlint-ai/,
      `${name} must document the default global npm install path`);
    assert.match(src, /agentlint check/,
      `${name} must show agentlint check as the next shell command`);
    assert.match(src, /INSTALL\.md/,
      `${name} must point AI agents to INSTALL.md`);
    assert.doesNotMatch(src, /npx agentlint-ai init/,
      `${name} must not reintroduce the old npx init install path`);
    assert.doesNotMatch(src, new RegExp(foregroundFlag),
      `${name} must not document the foreground scripts workaround as an install path`);
    assert.doesNotMatch(src, /agentlint-ai@latest/,
      `${name} must not document redundant @latest installs`);
  }

  assert.match(install, /npm install -g agentlint-ai/,
    'INSTALL.md must direct users to the default global npm install path');
});

runTest('Claude plugin install failures are distinguished from npm CLI success', () => {
  const install = fs.readFileSync(path.join(ROOT, 'scripts', 'install.sh'), 'utf8');
  const postinstall = fs.readFileSync(path.join(ROOT, 'postinstall.js'), 'utf8');
  assert.match(install, /AgentLint CLI is installed/,
    'install.sh must distinguish CLI install success from Claude plugin failure');
  assert.match(install, /\/al will not be available/,
    'install.sh must clearly say /al is unavailable when plugin install fails');
  assert.match(postinstall, /npm package installed; CLI works/,
    'postinstall.js must not collapse plugin failure into generic install success');
});

runTest('README recommends npm global install path and links to INSTALL.md', () => {
  const en = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const cn = fs.readFileSync(path.join(ROOT, 'README_CN.md'), 'utf8');
  assert.match(en, /npm install -g agentlint-ai/,
    'README.md must recommend `npm install -g agentlint-ai` as the primary install path');
  assert.match(cn, /npm install -g agentlint-ai/,
    'README_CN.md must recommend `npm install -g agentlint-ai` as the primary install path');
  assert.match(en, /INSTALL\.md/,
    'README.md must link to INSTALL.md for AI-agent fallback install guidance');
  assert.match(cn, /INSTALL\.md/,
    'README_CN.md must link to INSTALL.md');
});

runTest('postinstall side-effect fallback is documented in INSTALL.md, not the main README path', () => {
  // The `npm install` → `~/.claude` side effect is a deliberate UX choice
  // for v1.x. The fallback belongs in INSTALL.md so the main install path
  // stays focused while AI agents still have a concrete failure-mode fix.
  const en = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const cn = fs.readFileSync(path.join(ROOT, 'README_CN.md'), 'utf8');
  const install = fs.readFileSync(path.join(ROOT, 'INSTALL.md'), 'utf8');
  assert.doesNotMatch(en, /--ignore-scripts/,
    'README.md must not show --ignore-scripts in the main install path');
  assert.doesNotMatch(cn, /--ignore-scripts/,
    'README_CN.md must not show --ignore-scripts in the main install path');
  assert.match(install, /--ignore-scripts/,
    'INSTALL.md must show the --ignore-scripts failure-mode fallback');
});

runTest('accuracy workflow fails closed on missing corpus + scanner failures', () => {
  // Prior behavior: `found=false` + `if found == 'true'` skip chain turned
  // a missing corpus into a green no-op, and `scanner.sh ... 2>/dev/null
  // || true` swallowed per-repo scanner crashes. PRs that touched scanner
  // rules could land with accuracy effectively unchecked.
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'accuracy.yml'), 'utf8');
  assert.doesNotMatch(yml, /found=false[\s\S]{0,50}outputs/,
    'accuracy workflow must not silently skip on missing corpus — fail the job instead');
  // Actual scanner loop (not the explanatory comment block) must not swallow
  // failures. Find the run block and assert no active `|| true` on scanner.
  const scannerStep = yml.slice(yml.indexOf('Run scanner on all repos'));
  // Allow `|| true` only inside comment lines (leading `#` after indent).
  const activeOrTrue = scannerStep
    .split(/\r?\n/)
    .some((ln) => ln.includes('|| true') && !ln.trimStart().startsWith('#'));
  assert.ok(!activeOrTrue,
    'accuracy workflow scanner loop must not swallow per-repo failures with `|| true`');
  assert.match(yml, /Scanner failed on \$fails\/\$total repos/,
    'accuracy workflow must report per-repo failure count and fail beyond a threshold');
});

runTest('release workflow validates tag against all version sources', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  for (const needle of [
    'package.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    'release-metadata.json',
  ]) {
    assert.match(yml, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `release.yml Validate tag step must read ${needle}`);
  }
  assert.match(yml, /\['metadata', 'version'\]/,
    'release.yml must validate marketplace.json metadata.version');
  assert.match(yml, /\['plugins', 0, 'version'\]/,
    'release.yml must validate marketplace.json plugins[0].version');
});

runTest('release workflow version validator fails on source version drift', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  const match = yml.match(/python3 - "\$VERSION" <<'PY'\n([\s\S]*?)\n\s*PY/);
  assert.ok(match, 'release.yml must keep the source-version validator in a Python heredoc');
  const validator = match[1].replace(/^ {10}/gm, '');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-release-version-'));
  try {
    fs.mkdirSync(path.join(tempDir, '.claude-plugin'), { recursive: true });
    for (const file of [
      'package.json',
      '.claude-plugin/plugin.json',
      '.claude-plugin/marketplace.json',
      'release-metadata.json',
    ]) {
      fs.copyFileSync(path.join(ROOT, file), path.join(tempDir, file));
    }

    const expected = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    execFileSync('python3', ['-', expected], { cwd: tempDir, input: validator, encoding: 'utf8' });

    const pkgPath = path.join(tempDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.version = '0.0.0-drift';
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const drift = spawnSync('python3', ['-', expected], {
      cwd: tempDir,
      input: validator,
      encoding: 'utf8',
    });
    assert.notEqual(drift.status, 0, 'validator must fail when package.json version drifts');
    assert.match(drift.stdout + drift.stderr, /package\.json version 0\.0\.0-drift/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('release workflow publishes npm before creating GitHub Release', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  const publishIdx = yml.indexOf('- name: Publish to npm');
  const releaseIdx = yml.indexOf('- name: Create GitHub Release');
  assert.ok(publishIdx >= 0, 'release.yml must include a Publish to npm step');
  assert.ok(releaseIdx >= 0, 'release.yml must include a Create GitHub Release step');
  assert.ok(publishIdx < releaseIdx,
    'release.yml must run npm publish before gh release create');
  assert.match(yml, /Publish npm first[\s\S]{0,300}GitHub[\s\S]{0,120}without an npm package/,
    'release.yml must document why npm publish precedes GitHub Release creation');
  assert.doesNotMatch(yml.slice(0, publishIdx), /gh release create/,
    'release.yml must not create the GitHub Release before npm publish');
});

runTest('release workflow is idempotent for existing npm versions and GitHub Releases', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(yml, /npm view "agentlint-ai@\$\{VERSION\}" version/,
    'release.yml must check whether the immutable npm version is already published');
  assert.match(yml, /npm versions are immutable[\s\S]{0,180}Use a new version/,
    'release.yml must print a clear message when a tag rerun targets an already-published npm version');
  assert.match(yml, /if:\s*steps\.npm\.outputs\.exists == 'false'[\s\S]{0,500}npm publish --access public/,
    'release.yml must skip npm publish when the package version already exists');
  assert.match(yml, /gh release view "\$TAG"[\s\S]{0,240}gh release edit "\$TAG"/,
    'release.yml must edit an existing GitHub Release instead of crashing on gh release create');
  assert.match(yml, /already exists; editing it instead of creating a duplicate/,
    'release.yml must explain the existing-release path clearly');
});

runTest('docs GitHub Action quickstart is a complete copy-paste workflow', () => {
  const intro = fs.readFileSync(path.join(ROOT, 'docs', 'content', 'intro.md'), 'utf8');
  const actionSection = intro.slice(intro.indexOf('## GitHub Action'), intro.indexOf('### SARIF integration'));
  assert.match(actionSection, /Create `\.github\/workflows\/agentlint\.yml`/,
    'docs quickstart must tell users which workflow file to create');
  for (const needle of [
    'name: AgentLint',
    'on:',
    'pull_request:',
    'push:',
    'permissions:',
    'contents: read',
    'jobs:',
    'runs-on: ubuntu-latest',
    'actions/checkout@v4',
    '0xmariowu/agent-lint@v1',
  ]) {
    assert.match(actionSection, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `docs GitHub Action quickstart must include ${needle}`);
  }
  assert.doesNotMatch(actionSection, /fail-below:\s*['"]60['"]/,
    'copy-paste quickstart must not include a score threshold that can fail a fresh repo before the first baseline');
});

runTest('documented GitHub Action refs are tag-safe', () => {
  const docs = [
    'README.md',
    'README_CN.md',
    path.join('docs', 'content', 'intro.md'),
    'INSTALL.md',
  ];
  const localTags = new Set(execSync('git tag -l', { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean));
  const refs = [];

  for (const file of docs) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const pattern = /0xmariowu\/(?:agent-lint|AgentLint)@([A-Za-z0-9._/-]+)/g;
    let match;
    while ((match = pattern.exec(src)) !== null) {
      refs.push({ file, ref: match[1] });
    }
  }

  assert.ok(refs.length > 0,
    'public docs must include at least one GitHub Action ref for AgentLint');

  for (const { file, ref } of refs) {
    assert.notEqual(ref, 'v0',
      `${file}: documented action ref @v0 no longer exists; use @v1 or a real semver tag`);
    assert.ok(ref !== 'main' && ref !== 'master',
      `${file}: documented action ref @${ref} is a mutable branch name and a security risk`);
    if (ref === 'v1') continue;

    assert.match(ref, /^v\d+\.\d+\.\d+$/,
      `${file}: documented action ref @${ref} must be @v1 or a semver release tag`);
    assert.ok(localTags.has(ref),
      `Documented action ref @${ref} not found in tags. Run 'git tag -l' to see valid tags.`);
    execSync(`git rev-parse --verify "refs/tags/${ref}"`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  }
});

runTest('/al scan reads persisted config for root and selected modules', () => {
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  assert.match(src, /CONFIG_FILE="\$\{CLAUDE_PLUGIN_DATA:-\$HOME\/\.al\}\/config\.json"/,
    '/al must use the persisted config file as the scan contract');
  assert.match(src, /jq -er '\.projects_root' "\$CONFIG_FILE"/,
    '/al scan must read projects_root back from config before invoking scanner.sh');
  assert.match(src, /jq -r '\.modules\.deep \/\/ false' "\$CONFIG_FILE"/,
    '/al scan must read the persisted Deep selection');
  assert.match(src, /jq -r '\.modules\.session \/\/ false' "\$CONFIG_FILE"/,
    '/al scan must read the persisted Session selection');
  assert.match(src, /PROJECTS_ROOT="\$PROJECTS_ROOT" bash "\$AL_DIR\/src\/scanner\.sh"/,
    '/al scan must apply the config-derived PROJECTS_ROOT to scanner execution');
  assert.match(src, /If `RUN_DEEP` read from/,
    '/al Deep branch must be driven by the config-derived RUN_DEEP value');
  assert.match(src, /If `RUN_SESSION` read from/,
    '/al Session branch must be driven by the config-derived RUN_SESSION value');
});

runTest('branch protection script has a verify mode that compares live protection to YAML', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'setup-branch-protection.sh'), 'utf8');
  assert.match(script, /--verify/,
    'setup-branch-protection.sh must expose a --verify mode');
  assert.match(script, /gh api "repos\/\$\{repo\}\/branches\/\$\{branch\}\/protection"/,
    '--verify must fetch live branch protection via gh api');
  assert.match(script, /required_status_checks/,
    '--verify must inspect required_status_checks from the live response');
  assert.match(script, /strict mismatch/,
    '--verify must fail on strictness drift');
  assert.match(script, /missing live checks/,
    '--verify must fail on missing required checks');
  assert.match(script, /extra live checks/,
    '--verify must fail on extra required checks');

  const contributing = fs.readFileSync(path.join(ROOT, 'docs', 'content', 'contributing.md'), 'utf8');
  assert.match(contributing, /scripts\/setup-branch-protection\.sh --verify/,
    'docs must describe the manual branch-protection verification command');
  assert.match(contributing, /gh api repos\/\.\.\.\/branches\/main\/protection/,
    'docs must state that verification checks live GitHub branch protection');
});

runTest('install.sh reports /al copy failures instead of unconditional success', () => {
  const install = fs.readFileSync(path.join(ROOT, 'scripts', 'install.sh'), 'utf8');
  const commandBlock = install.slice(install.indexOf('# /al global command'));
  assert.match(commandBlock, /elif ! COPY_OUT=\$\(cp "\$CMD_SRC" "\$CMD_DST" 2>&1\); then/,
    'install.sh must capture cp failure when installing /al command');
  assert.match(commandBlock, /Could not copy \$CMD_SRC to \$CMD_DST/,
    'install.sh must surface the failed copy source and destination');
  assert.match(commandBlock, /PLUGIN_INSTALL_OK=false/,
    'install.sh must mark plugin install unhealthy when /al copy fails');
  const copyIdx = commandBlock.indexOf('COPY_OUT=$(cp "$CMD_SRC" "$CMD_DST" 2>&1)');
  const okIdx = commandBlock.indexOf('ok "/al command" "[installed]"');
  assert.ok(copyIdx >= 0 && okIdx > copyIdx,
    'install.sh must only print /al installed after the cp branch succeeds');
});

runTest('public install docs keep npx init out of main install guidance', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const cn = fs.readFileSync(path.join(ROOT, 'README_CN.md'), 'utf8');
  const intro = fs.readFileSync(path.join(ROOT, 'docs', 'content', 'intro.md'), 'utf8');
  for (const [name, src] of [['README.md', readme], ['docs/content/intro.md', intro]]) {
    assert.match(src, /npm install -g agentlint-ai/,
      `${name} must use npm install -g as the default install command`);
    assert.match(src, /agentlint check/,
      `${name} must show the default post-install check command`);
    assert.match(src, /Using an AI coding agent\?/,
      `${name} must point AI coding agents to INSTALL.md`);
    assert.doesNotMatch(src, /npx agentlint-ai init/,
      `${name} must not reintroduce the npx init command`);
  }
  assert.match(cn, /npm install -g agentlint-ai/,
    'README_CN.md must use npm install -g as the default install command');
  assert.match(cn, /agentlint check/,
    'README_CN.md must show the default post-install check command');
  assert.match(cn, /AI 编程 agent/,
    'README_CN.md must point AI coding agents to INSTALL.md');
  assert.doesNotMatch(cn, /npx agentlint-ai init/,
    'README_CN.md must not reintroduce the npx init command');
  assert.doesNotMatch(intro, /```bash\nnpx agentlint-ai\n```/,
    'docs/content/intro.md must not reintroduce the ambiguous bare npx command');
});

runTest('/al shell snippets quote paths with spaces and special characters', () => {
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  assert.doesNotMatch(src, /< \$RUN_DIR\//,
    '/al snippets must quote redirected RUN_DIR paths');
  assert.doesNotMatch(src, /mkdir -p \$\{CLAUDE_PLUGIN_DATA\}/,
    '/al snippets must quote CLAUDE_PLUGIN_DATA-derived paths');
  assert.doesNotMatch(src, /cp \$RUN_DIR\//,
    '/al snippets must quote cp sources under RUN_DIR');
  assert.match(src, /< "\$RUN_DIR\/plan\.filtered\.json"/,
    'fixer invocation must quote the filtered plan path');
  assert.match(src, /REPORT_DIR="\$\{CLAUDE_PLUGIN_DATA:-\$HOME\/\.al\}\/reports"/,
    'report path must be built in a quoted variable with a fallback');
  assert.match(src, /--session-root "\$HOME\/\.claude\/projects"/,
    'session analyzer must quote the session-root path');
});

runTest('INSTALL.md stays short and AI-native', () => {
  const install = fs.readFileSync(path.join(ROOT, 'INSTALL.md'), 'utf8');
  assert.ok(install.split(/\r?\n/).length < 80,
    'INSTALL.md must stay short enough for agents to read once and act');
  for (const needle of [
    'For AI coding agents',
    '## Default',
    '## Failure modes',
    '## GitHub Action',
    '## After install',
    '## Verify',
    'npm install -g agentlint-ai',
    '0xmariowu/agent-lint@v1',
    'agentlint check',
  ]) {
    assert.match(install, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `INSTALL.md must include ${needle}`);
  }
});

runTest('CI workflows do not expose secret diagnostics or token introspection', () => {
  const workflowsDir = path.join(ROOT, '.github', 'workflows');
  const ALLOWLIST = new Set([
    // Add filenames here only with a written justification, never to silence a finding
  ]);
  const PROHIBITED_PATTERNS = [
    /npm token list/i,
    /npm whoami/i,
    /npm access list/i,
    /\bnodeauthtoken=\$\{node_auth_token\}/i,
    new RegExp('Diagnose ' + 'NPM_TOKEN'),
    /token-diag/i,
  ];
  for (const file of fs.readdirSync(workflowsDir)) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
    if (ALLOWLIST.has(file)) continue;
    const src = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    for (const pat of PROHIBITED_PATTERNS) {
      assert.doesNotMatch(src, pat,
        `${file} contains token-introspection pattern ${pat}; public repos must not echo token identity or capabilities into Actions logs`);
    }
  }
});

runTest('shipped templates do not reference missing files or VibeKit identity', () => {
  const PROHIBITED_PATTERNS = [
    /\bbootstrap\.sh\b/,                        // legacy filename, replaced by agentlint setup
    /standards\/ship-boundary\.json/,           // never existed in agent-lint
    /configs\/templates\/subsystem-CLAUDE\.md/, // VibeKit-only path
    /configs\/templates\/plan\.md/,             // VibeKit-only path
    /atomic-dev-environment\.md/,               // external doc not shipped here
    /\bvibekit(?:\b|_)/i,                       // upstream identity must not leak to downstream
  ];
  const skipFiles = new Set([
    // Test self-references (this file lives outside templates/, not skipped here)
  ]);
  const templatesDir = path.join(ROOT, 'templates');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (skipFiles.has(path.relative(ROOT, full))) continue;
      const src = fs.readFileSync(full, 'utf8');
      for (const pat of PROHIBITED_PATTERNS) {
        assert.doesNotMatch(src, pat,
          `${path.relative(ROOT, full)} contains stale pattern ${pat}; ` +
          'templates copy to user repos and must not carry VibeKit / dead-path references');
      }
    }
  };
  walk(templatesDir);
});

runTest('copilot-instructions.md product summary stays in sync with evidence.json', () => {
  const file = path.join(ROOT, '.github', 'copilot-instructions.md');
  const src = fs.readFileSync(file, 'utf8');
  for (const stale of [/49 rules?/i, /42 rules?/i, /42 checks?/i, /TypeScript CLI/i, /\b8 dimensions?\b/i]) {
    assert.doesNotMatch(src, stale,
      `copilot-instructions.md still contains stale claim matching ${stale}; product is currently 58 checks across 6 core + 2 extended dimensions, shell + JS implementation`);
  }
  assert.match(src, /58 (?:total|checks?)|51 (?:deterministic )?(?:core )?checks?|6 core dimensions/i,
    'copilot-instructions.md must reference current check/dimension counts');
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
