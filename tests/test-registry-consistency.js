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
  // Resolution must come from SELECTED_PROJECT (chosen via AskUserQuestion
  // on multi-project scans) mapped back to an absolute path.
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const usesProjectDir = src.includes('--project-dir "$PROJECT_DIR"');
  if (!usesProjectDir) return; // if the flag stops being used, nothing to guard
  const resolutionIdx = src.indexOf('PROJECT_DIR="$(find "$PROJECTS_ROOT"');
  // Match the executable invocation specifically, not prose mentions of fixer.js
  const fixerInvokeIdx = src.indexOf('node "$AL_DIR/src/fixer.js"');
  assert.ok(resolutionIdx >= 0,
    'commands/al.md must resolve PROJECT_DIR from SELECTED_PROJECT before calling fixer.js');
  assert.ok(fixerInvokeIdx > resolutionIdx,
    'PROJECT_DIR resolution must appear BEFORE the node ... fixer.js invocation');
  assert.match(src, /SELECTED_PROJECT/,
    'commands/al.md must introduce SELECTED_PROJECT (single or user-picked) ' +
    'to drive the resolution');
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
  // fixer.js) and `grouped` (display-only). An earlier version of Step 5c
  // filtered only `grouped`, leaving the full unfiltered `items` for fixer.
  // That let fixer apply another project's fix to $PROJECT_DIR — real data
  // corruption risk for F5/I5/W11 (mutating checks). Guard both filters
  // here so the regression cannot sneak back in.
  const src = fs.readFileSync(path.join(ROOT, 'commands', 'al.md'), 'utf8');
  const usesFixer = src.includes('node "$AL_DIR/src/fixer.js"');
  if (!usesFixer) return;
  assert.match(src, /\.items\s*\|=\s*map\(select\(\.project\s*==\s*\$p\)\)/,
    'al.md must filter top-level .items by .project == $p before passing plan to fixer');
  assert.match(src, /\.grouped\s*\|=/,
    'al.md must also filter the grouped display tree for UI consistency');
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

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
