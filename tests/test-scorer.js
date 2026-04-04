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

runTest('dimension scores use weighted averages and total score is out of 100', () => {
  const output = runScorer([
    { check_id: 'F1', project: 'test-proj', score: 0.9, name: 'Entry file', measured_value: 1 },
    { check_id: 'F2', project: 'test-proj', score: 0.5, name: 'Project description', measured_value: 1 },
    { check_id: 'W1', project: 'test-proj', score: 0.3, name: 'Build commands', measured_value: 0 },
  ]);

  assert.equal(output.dimensions.findability.score, 8);
  assert.equal(output.dimensions.workability.score, 3);
  assert.equal(output.total_score, 22);
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

  assert.equal(output.total_score, 20);
  assert.equal(output.by_project.ignored.findability.checks.length, 1);
  assert.equal(output.by_project.ignored.findability.checks[0].check_id, 'F1');
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
