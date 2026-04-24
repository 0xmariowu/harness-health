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

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
