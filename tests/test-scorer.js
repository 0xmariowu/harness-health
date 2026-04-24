#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const scorerPath = path.join(__dirname, '..', 'src', 'scorer.js');

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
    process.stdout.write(`${error.stack}\n`);
  }
}

function runScorer(records) {
  const input = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  const result = spawnSync(process.execPath, [scorerPath], {
    encoding: 'utf8',
    input,
  });

  assert.equal(result.status, 0, result.stderr || 'scorer exited with a non-zero status');
  assert.equal(result.stderr, '', 'expected scorer to write no stderr output');

  return JSON.parse(result.stdout);
}

runTest('dimension scores use weighted averages and total score only counts dimensions that ran', () => {
  const output = runScorer([
    { check_id: 'F1', project: 'test-proj', score: 0.9, name: 'Entry file', measured_value: 1 },
    { check_id: 'F2', project: 'test-proj', score: 0.5, name: 'Project description', measured_value: 1 },
    { check_id: 'W1', project: 'test-proj', score: 0.3, name: 'Build commands', measured_value: 0 },
  ]);

  assert.equal(output.dimensions.findability.score, 8);
  assert.equal(output.dimensions.workability.score, 3);
  // Total is averaged only over dimensions whose checks actually ran (F and W).
  // Dimensions with no inputs (D/I/C/S/H/session) are `not_run` and must not
  // pollute the denominator with a spurious 0.
  assert.equal(output.total_score, 56);
  assert.equal(output.dimensions.findability.status, 'run');
  assert.equal(output.dimensions.workability.status, 'run');
  assert.equal(output.dimensions.instructions.status, 'not_run');
  assert.equal(output.dimensions.deep.status, 'not_run');
});

runTest('per-project breakdown exists and retains project checks', () => {
  const output = runScorer([
    { check_id: 'F1', project: 'alpha', score: 1, name: 'Entry file', measured_value: 1 },
    { check_id: 'W1', project: 'alpha', score: 0.3, name: 'Build commands', measured_value: 0 },
    { check_id: 'F1', project: 'beta', score: 0, name: 'Entry file', measured_value: 0 },
  ]);

  assert.ok(output.by_project.alpha);
  assert.ok(output.by_project.beta);
  assert.equal(output.by_project.alpha.findability.checks.length, 1);
  assert.equal(output.by_project.alpha.workability.checks.length, 1);
  assert.equal(output.by_project.beta.findability.checks.length, 1);
});

runTest('score coercion normalizes 0.8, 8, and 80 to the same score', () => {
  const output = runScorer([
    { check_id: 'F1', project: 'coerce', score: 0.8, name: 'Entry file', measured_value: 1 },
    { check_id: 'F2', project: 'coerce', score: 8, name: 'Project description', measured_value: 1 },
    { check_id: 'F3', project: 'coerce', score: 80, name: 'Conditional loading', measured_value: 1 },
  ]);

  const scores = output.by_project.coerce.findability.checks
    .map((check) => check.score)
    .sort((left, right) => left - right);

  assert.deepEqual(scores, [0.8, 0.8, 0.8]);
});

runTest('unknown check prefixes are ignored without crashing', () => {
  const output = runScorer([
    { check_id: 'X1', project: 'ignored', score: 1, name: 'Unknown check', measured_value: 1 },
    { check_id: 'F1', project: 'ignored', score: 1, name: 'Entry file', measured_value: 1 },
  ]);

  // Only F1 ran → only findability dimension counts toward total.
  // F1 scored 1.0 across the only-run dim → total = 100.
  assert.equal(output.total_score, 100);
  assert.equal(output.by_project.ignored.findability.checks.length, 1);
  assert.equal(output.by_project.ignored.findability.checks[0].check_id, 'F1');
});

runTest('H prefix check is routed to harness dimension', () => {
  const output = runScorer([
    { check_id: 'H1', project: 'hp', score: 1, name: 'Hook event names', measured_value: { total: 2, valid: 2 } },
    { check_id: 'F1', project: 'hp', score: 1, name: 'Entry file', measured_value: 1 },
  ]);

  assert.ok(output.dimensions.harness, 'harness dimension should exist in output');
  assert.equal(output.dimensions.harness.checks.length, 1);
  assert.equal(output.dimensions.harness.checks[0].check_id, 'H1');
  assert.ok(output.by_project.hp.harness, 'per-project harness should exist');
});

runTest('deep and session analyzer checks contribute to their own dimensions', () => {
  const output = runScorer([
    { check_id: 'D1', project: 'demo', score: 1, name: 'Contradictory rules' },
    { check_id: 'SS1', project: 'demo', score: 0, name: 'Repeated instructions' },
  ]);

  assert.equal(output.dimensions.deep.checks.length, 1);
  assert.equal(output.dimensions.deep.checks[0].check_id, 'D1');
  assert.equal(output.dimensions.session.checks.length, 1);
  assert.equal(output.dimensions.session.checks[0].check_id, 'SS1');
  assert.ok(output.total_score > 0, 'deep/session weights should affect the total score');
});

// ─── S4: Edge-case tests ───────────────────────────────────────────────────

function runScorerRaw(inputStr, expectZeroExit = true) {
  const result = spawnSync(process.execPath, [scorerPath], {
    encoding: 'utf8',
    input: inputStr,
  });
  if (expectZeroExit) {
    assert.equal(result.status, 0, result.stderr || 'scorer exited non-zero');
  }
  return result;
}

runTest('empty stdin produces valid JSON with total_score=0', () => {
  const result = runScorerRaw('\n');
  const output = JSON.parse(result.stdout);
  assert.equal(output.total_score, 0);
  assert.ok(output.dimensions, 'dimensions should exist');
  assert.deepEqual(output.by_project, {}, 'by_project should be empty');
});

runTest('malformed JSONL lines are skipped without crashing', () => {
  const input = `not-json\n{"check_id":"F1","project":"test","score":1,"name":"Entry"}\n{broken\n`;
  const result = runScorerRaw(input);
  const output = JSON.parse(result.stdout);
  // F1 line is valid — findability should have a score
  assert.ok(output.by_project.test, 'valid record should still be processed');
  assert.equal(output.by_project.test.findability.checks.length, 1);
});

runTest('negative score is coerced to 0', () => {
  const result = runScorerRaw(
    JSON.stringify({ check_id: 'F1', project: 'neg', score: -5, name: 'Entry' }) + '\n'
  );
  const output = JSON.parse(result.stdout);
  const check = output.by_project.neg.findability.checks[0];
  assert.equal(check.score, 0);
});

runTest('score > 100 is coerced to 0 (out of range)', () => {
  const result = runScorerRaw(
    JSON.stringify({ check_id: 'F1', project: 'big', score: 999, name: 'Entry' }) + '\n'
  );
  const output = JSON.parse(result.stdout);
  const check = output.by_project.big.findability.checks[0];
  assert.equal(check.score, 0);
});

runTest('missing project identity stays in global dimension scope only', () => {
  const result = runScorerRaw(
    JSON.stringify({ check_id: 'F1', score: 1, name: 'Entry' }) + '\n'
  );
  const output = JSON.parse(result.stdout);
  assert.ok(output.dimensions.findability.status, 'run');
  assert.equal(output.dimensions.findability.checks.length, 1);
  assert.ok(!output.by_project.unknown, 'records without project identity should not create by_project/unknown');
  assert.equal(output.total_score, 100);
});

runTest('all-zero scores produce total_score=0', () => {
  const records = ['F1', 'F2', 'I1', 'W1', 'C1', 'S1'].map((id) =>
    JSON.stringify({ check_id: id, project: 'zeroes', score: 0, name: id })
  );
  const result = runScorerRaw(records.join('\n') + '\n');
  const output = JSON.parse(result.stdout);
  assert.equal(output.total_score, 0);
});

runTest('all-one scores produce total_score=100', () => {
  const records = ['F1', 'D1', 'I1', 'W1', 'C1', 'SS1', 'S1', 'H1'].map((id) =>
    JSON.stringify({ check_id: id, project: 'perfect', score: 1, name: id })
  );
  const result = runScorerRaw(records.join('\n') + '\n');
  const output = JSON.parse(result.stdout);
  assert.equal(output.total_score, 100);
});

runTest('JSON array input processes all records', () => {
  const records = [
    { check_id: 'F1', project: 'arr', score: 1, name: 'Entry' },
    { check_id: 'W1', project: 'arr', score: 0.5, name: 'Build' },
  ];
  const result = runScorerRaw(JSON.stringify(records) + '\n');
  const output = JSON.parse(result.stdout);
  assert.equal(output.by_project.arr.findability.checks.length, 1);
  assert.equal(output.by_project.arr.workability.checks.length, 1);
});

runTest('missing input file exits with a concise read error', () => {
  const missingPath = path.join(__dirname, 'fixtures', 'does-not-exist.jsonl');
  const result = spawnSync(process.execPath, [scorerPath, missingPath], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0, 'missing file should cause non-zero exit');
  assert.match(result.stderr, /scorer: cannot read input .*does-not-exist\.jsonl/i);
});

// ─── not_run dimension semantics ────────────────────────────────────────────

runTest('dimensions with no checks are marked not_run with score=null', () => {
  const output = runScorer([
    { check_id: 'F1', project: 'p', score: 1, name: 'Entry' },
  ]);
  assert.equal(output.dimensions.findability.status, 'run');
  assert.equal(output.dimensions.findability.score, 10);
  assert.equal(output.dimensions.deep.status, 'not_run');
  assert.equal(output.dimensions.deep.score, null);
  assert.equal(output.dimensions.session.status, 'not_run');
  assert.equal(output.dimensions.session.score, null);
});

runTest('score_scope is "core" when no extended dimension ran', () => {
  const output = runScorer([
    { check_id: 'F1', project: 'p', score: 1, name: 'F1' },
    { check_id: 'H1', project: 'p', score: 1, name: 'H1' },
  ]);
  assert.equal(output.score_scope, 'core');
});

runTest('score_scope is "core+extended" when a Deep or Session check ran', () => {
  const withDeep = runScorer([
    { check_id: 'F1', project: 'p', score: 1, name: 'F1' },
    { check_id: 'D1', project: 'p', score: 0.5, name: 'D1' },
  ]);
  assert.equal(withDeep.score_scope, 'core+extended');

  const withSession = runScorer([
    { check_id: 'F1', project: 'p', score: 1, name: 'F1' },
    { check_id: 'SS1', project: 'p', score: 0.5, name: 'SS1' },
  ]);
  assert.equal(withSession.score_scope, 'core+extended');
});

runTest('not_run dimensions do not pull down total score (regression: 51-core = 89, not 81)', () => {
  // Replicate the AgentLint self-scan shape: all 6 core dims populated with
  // good scores, Deep and Session absent. Before the fix this produced ~81;
  // after the fix it produces the correct weighted average of the 6 core dims.
  const records = [
    { check_id: 'F1', project: 'self', score: 1, name: 'F1' },
    { check_id: 'I1', project: 'self', score: 1, name: 'I1' },
    { check_id: 'W1', project: 'self', score: 1, name: 'W1' },
    { check_id: 'C1', project: 'self', score: 1, name: 'C1' },
    { check_id: 'S1', project: 'self', score: 1, name: 'S1' },
    { check_id: 'H1', project: 'self', score: 1, name: 'H1' },
  ];
  const output = runScorer(records);
  assert.equal(output.total_score, 100, 'all-ones on 6 core dims must be 100, not 91 (which would be 100*1.0/1.1)');
  assert.equal(output.score_scope, 'core');
  assert.equal(output.dimensions.deep.status, 'not_run');
  assert.equal(output.dimensions.session.status, 'not_run');
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
