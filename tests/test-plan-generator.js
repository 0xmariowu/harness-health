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

runTest('fix types are assigned from the capability registry', () => {
  const output = runPlanGenerator(scorerOutput);

  const f5 = output.items.find((item) => item.check_id === 'F5' && item.project === 'alpha');
  const f1 = output.items.find((item) => item.check_id === 'F1' && item.project === 'alpha');
  const i3 = output.items.find((item) => item.check_id === 'I3' && item.project === 'beta');

  // F5 is auto — fixer.js handles it via executeAutoFix (removeLinesWithBrokenReferences).
  assert.equal(f5.fix_type, 'auto');
  // F1 is assisted — fixer.js has executeAssistedF1.
  assert.equal(f1.fix_type, 'assisted');
  // I3 is guided — no automated handler.
  assert.equal(i3.fix_type, 'guided');
});

runTest('every item includes a fix_command for its check ID', () => {
  const output = runPlanGenerator(scorerOutput);

  assert.ok(output.items.length > 0, 'fixture should produce plan items');
  for (const item of output.items) {
    assert.equal(item.fix_command, `agentlint fix ${item.check_id}`);
    assert.match(item.fix_command, /^agentlint fix [A-Z][0-9]+$/);
  }
});

runTest('F5 is auto regardless of severity (matches fixer.js capability)', () => {
  const output = runPlanGenerator({
    by_project: {
      demo: {
        findability: makeDimension([
          { check_id: 'F5', project: 'demo', name: 'All references resolve', measured_value: 1, score: 0.6, detail: '1 broken ref' },
        ]),
      },
    },
  });

  const f5 = output.items.find((item) => item.check_id === 'F5');
  assert.ok(f5, 'F5 item should exist');
  assert.equal(f5.severity, 'medium');
  // F5 is always 'auto' — fix_type comes from the registry, not the score.
  assert.equal(f5.fix_type, 'auto');
});

runTest('unregistered low-score checks fall back to guided, not assisted', () => {
  // Regression: before the registry, any check with score<0.5 that wasn't in
  // the ASSISTED/AUTO/GUIDED sets got labeled 'assisted' — but the fixer had
  // no handler for it, so "High priority only" produced "No assisted strategy
  // for X" failures. F4, S5, S7, W4, W5 all hit this case.
  const output = runPlanGenerator({
    by_project: {
      demo: {
        findability: makeDimension([
          { check_id: 'F4', project: 'demo', name: 'Root file count', measured_value: 20, score: 0, detail: 'too many files' },
        ]),
        safety: makeDimension([
          { check_id: 'S5', project: 'demo', name: 'No contents:write', measured_value: 1, score: 0, detail: 'contents:write at top level' },
          { check_id: 'S7', project: 'demo', name: 'No secrets in code', measured_value: 1, score: 0, detail: 'secret-like string' },
        ]),
        workability: makeDimension([
          { check_id: 'W4', project: 'demo', name: 'Linter config present', measured_value: 0, score: 0, detail: 'no linter' },
          { check_id: 'W5', project: 'demo', name: 'No oversized source files', measured_value: 5, score: 0, detail: '5 files > 256KB' },
        ]),
      },
    },
  });

  for (const id of ['F4', 'S5', 'S7', 'W4', 'W5']) {
    const item = output.items.find((it) => it.check_id === id);
    assert.ok(item, `${id} should exist in plan`);
    assert.equal(item.fix_type, 'guided', `${id} must be guided — fixer has no handler`);
  }
});

runTest('merged items include item_ids and project_count', () => {
  const output = runPlanGenerator(scorerOutput);

  const highF5 = getMergedItem(output, 'high', 'F5');
  const mediumF1 = getMergedItem(output, 'medium', 'F1');

  // F5 is 'auto' (sort key 0) so its items get the first IDs after grouping.
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

// ─── S4: Edge-case tests ───────────────────────────────────────────────────

function runPlanGeneratorRaw(inputStr, expectZeroExit = true) {
  const result = spawnSync(process.execPath, [planGeneratorPath], {
    encoding: 'utf8',
    input: inputStr,
  });
  if (expectZeroExit) {
    assert.equal(result.status, 0, result.stderr || 'plan-generator exited non-zero');
  }
  return result;
}

runTest('empty by_project produces zero items', () => {
  const output = runPlanGenerator({ by_project: {} });
  assert.equal(output.total_items, 0);
  assert.equal(output.items.length, 0);
  assert.equal(output.grouped.high.count, 0);
  assert.equal(output.grouped.medium.count, 0);
  assert.equal(output.grouped.low.count, 0);
});

runTest('all checks at score ≥ 0.8 produce zero items', () => {
  const allPass = {
    by_project: {
      proj: {
        findability: makeDimension([
          { check_id: 'F1', project: 'proj', name: 'Entry', measured_value: 1, score: 1, detail: 'ok' },
          { check_id: 'F2', project: 'proj', name: 'Desc', measured_value: 1, score: 0.9, detail: 'ok' },
        ]),
      },
    },
  };
  const output = runPlanGenerator(allPass);
  assert.equal(output.total_items, 0);
});

runTest('harness (H-prefix) checks appear in output items', () => {
  const harnessInput = {
    by_project: {
      myrepo: {
        harness: makeDimension([
          { check_id: 'H1', project: 'myrepo', name: 'Hook events', measured_value: 0, score: 0.0, detail: 'invalid events' },
        ]),
      },
    },
  };
  const output = runPlanGenerator(harnessInput);
  assert.ok(output.total_items >= 1, 'H1 should produce at least 1 item');
  const h1 = output.items.find((item) => item.check_id === 'H1');
  assert.ok(h1, 'H1 item should be present');
});

runTest('missing by_project key is tolerated', () => {
  const output = runPlanGenerator({ total_score: 0, dimensions: {} });
  assert.equal(output.total_items, 0);
});

runTest('empty stdin causes non-zero exit', () => {
  const result = runPlanGeneratorRaw('\n', false);
  assert.notEqual(result.status, 0, 'empty input should cause non-zero exit');
});

runTest('malformed JSON input causes non-zero exit', () => {
  const result = runPlanGeneratorRaw('{not valid json}', false);
  assert.notEqual(result.status, 0, 'malformed JSON should cause non-zero exit');
});

runTest('score=0 produces high severity', () => {
  const zeroInput = {
    by_project: {
      p: {
        safety: makeDimension([
          { check_id: 'S1', project: 'p', name: 'gitignore', measured_value: 0, score: 0.0, detail: 'missing' },
        ]),
      },
    },
  };
  const output = runPlanGenerator(zeroInput);
  const s1 = output.items.find((item) => item.check_id === 'S1');
  assert.ok(s1, 'S1 item should exist');
  assert.equal(s1.severity, 'high');
});

runTest('score=0.75 produces low severity (threshold: <0.7 = medium, ≥0.7 = low)', () => {
  const lowInput = {
    by_project: {
      p: {
        findability: makeDimension([
          { check_id: 'F1', project: 'p', name: 'Entry', measured_value: 0, score: 0.75, detail: 'partial' },
        ]),
      },
    },
  };
  const output = runPlanGenerator(lowInput);
  const f1 = output.items.find((item) => item.check_id === 'F1');
  assert.ok(f1, 'F1 item should exist');
  assert.equal(f1.severity, 'low');
});

runTest('score=0.6 produces medium severity', () => {
  const medInput = {
    by_project: {
      p: {
        workability: makeDimension([
          { check_id: 'W1', project: 'p', name: 'Commands', measured_value: 0, score: 0.6, detail: 'partial' },
        ]),
      },
    },
  };
  const output = runPlanGenerator(medInput);
  const w1 = output.items.find((item) => item.check_id === 'W1');
  assert.ok(w1, 'W1 item should exist');
  assert.equal(w1.severity, 'medium');
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
