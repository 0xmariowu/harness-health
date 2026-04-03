#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const planGeneratorPath = path.join(__dirname, '..', 'src', 'plan-generator.js');

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

function makeDimension(checks) {
  return {
    score: 0,
    max: 10,
    weight: 0.25,
    checks,
  };
}

function runPlanGenerator(inputObject) {
  const result = spawnSync(process.execPath, [planGeneratorPath], {
    encoding: 'utf8',
    input: `${JSON.stringify(inputObject, null, 2)}\n`,
  });

  assert.equal(result.status, 0, result.stderr || 'plan-generator exited with a non-zero status');
  return JSON.parse(result.stdout);
}

function getMergedItem(output, severity, checkId) {
  return output.grouped[severity].items.find((item) => item.check_id === checkId);
}

const scorerOutput = {
  by_project: {
    alpha: {
      findability: makeDimension([
        { check_id: 'F5', project: 'alpha', name: 'All references resolve', measured_value: 2, score: 0.4, detail: '2 broken refs' },
        { check_id: 'F1', project: 'alpha', name: 'Entry file exists', measured_value: 0, score: 0.6, detail: 'missing entry file' },
        { check_id: 'F2', project: 'alpha', name: 'Entry file describes the project', measured_value: 1, score: 0.8, detail: 'good enough' },
      ]),
      workability: makeDimension([
        { check_id: 'W2', project: 'alpha', name: 'CI exists', measured_value: 1, score: 0.45, detail: 'missing workflows' },
      ]),
    },
    beta: {
      findability: makeDimension([
        { check_id: 'F5', project: 'beta', name: 'All references resolve', measured_value: 3, score: 0.3, detail: '3 broken refs' },
        { check_id: 'F1', project: 'beta', name: 'Entry file exists', measured_value: 9, score: 0.65, detail: 'missing entry file' },
      ]),
      instructions: makeDimension([
        { check_id: 'I3', project: 'beta', name: 'Rule specificity', measured_value: 0.75, score: 0.75, detail: '75% of rules use the pattern' },
      ]),
    },
    gamma: {
      workability: makeDimension([
        { check_id: 'W2', project: 'gamma', name: 'CI exists', measured_value: 2, score: 0.4, detail: 'missing workflows' },
      ]),
    },
  },
};

runTest('items at or above 0.8 are filtered out and severities are grouped correctly', () => {
  const output = runPlanGenerator(scorerOutput);

  assert.equal(output.total_items, 7);
  assert.equal(output.items.some((item) => item.check_id === 'F2'), false);
  assert.equal(output.grouped.high.count, 4);
  assert.equal(output.grouped.medium.count, 2);
  assert.equal(output.grouped.low.count, 1);
});

runTest('fix types are assigned from check IDs', () => {
  const output = runPlanGenerator(scorerOutput);

  const f5 = output.items.find((item) => item.check_id === 'F5' && item.project === 'alpha');
  const f1 = output.items.find((item) => item.check_id === 'F1' && item.project === 'alpha');
  const i3 = output.items.find((item) => item.check_id === 'I3' && item.project === 'beta');

  assert.equal(f5.fix_type, 'auto');
  assert.equal(f1.fix_type, 'assisted');
  assert.equal(i3.fix_type, 'guided');
});

runTest('merged items include item_ids and project_count', () => {
  const output = runPlanGenerator(scorerOutput);

  const highF5 = getMergedItem(output, 'high', 'F5');
  const mediumF1 = getMergedItem(output, 'medium', 'F1');

  assert.deepEqual(highF5.item_ids, [1, 2]);
  assert.equal(highF5.project_count, 2);
  assert.deepEqual(mediumF1.item_ids, [5, 6]);
  assert.equal(mediumF1.project_count, 2);
});

runTest('summable checks aggregate measured_value and non-summable checks do not', () => {
  const output = runPlanGenerator(scorerOutput);

  const highF5 = getMergedItem(output, 'high', 'F5');
  const highW2 = getMergedItem(output, 'high', 'W2');
  const mediumF1 = getMergedItem(output, 'medium', 'F1');

  assert.equal(highF5.measured_value, 5);
  assert.equal(highW2.measured_value, 3);
  assert.equal(mediumF1.measured_value, 0);
  assert.match(highF5.description, /\(5 total\)/);
  assert.doesNotMatch(mediumF1.description, /total/);
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
