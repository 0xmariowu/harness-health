#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reporterPath = path.join(__dirname, '..', 'src', 'reporter.js');

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

function makeDimension(score, weight, checks) {
  return { score, max: 10, weight, checks };
}

function writeFixtureScores(dir) {
  const scores = {
    total_score: 73,
    dimensions: {
      findability: makeDimension(8, 0.25, []),
      instructions: makeDimension(7, 0.35, []),
      workability: makeDimension(6, 0.20, []),
      continuity: makeDimension(8, 0.20, []),
    },
    by_project: {
      alpha: {
        findability: makeDimension(8, 0.25, [
          { check_id: 'F1', name: 'Entry file exists', score: 1, measured_value: { entry_file: 'CLAUDE.md', platform: 'claude', all_files: ['CLAUDE.md'] }, detail: 'CLAUDE.md found' },
        ]),
        instructions: makeDimension(7, 0.35, []),
        workability: makeDimension(6, 0.20, [
          { check_id: 'W1', name: 'Build/test commands documented', score: 0.3, measured_value: 0, detail: 'missing commands' },
        ]),
        continuity: makeDimension(8, 0.20, []),
      },
      beta: {
        findability: makeDimension(5, 0.25, [
          { check_id: 'F5', name: 'All references resolve', score: 0.4, measured_value: 2, detail: 'broken refs' },
        ]),
        instructions: makeDimension(7, 0.35, []),
        workability: makeDimension(6, 0.20, []),
        continuity: makeDimension(8, 0.20, []),
      },
    },
  };

  const scoresPath = path.join(dir, 'scores.json');
  fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2));
  return scoresPath;
}

function runReporter(args) {
  const result = spawnSync(process.execPath, [reporterPath, ...args], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || 'reporter exited with a non-zero status');
  return result;
}

runTest('terminal format includes score bars and the total score', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-terminal-'));

  try {
    const scoresPath = writeFixtureScores(tempDir);
    const result = runReporter([scoresPath, '--format', 'terminal']);

    assert.match(result.stdout, /Score: 73\/100/);
    assert.match(result.stdout, /█/);
    assert.match(result.stdout, /░/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('md format writes a markdown report with table headers', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-md-'));

  try {
    const scoresPath = writeFixtureScores(tempDir);
    runReporter([scoresPath, '--format', 'md', '--output-dir', tempDir]);

    const mdFile = fs.readdirSync(tempDir).find((name) => name.endsWith('.md'));
    assert.ok(mdFile, 'expected a markdown report file');

    const md = fs.readFileSync(path.join(tempDir, mdFile), 'utf8');
    assert.match(md, /\| Dimension \| Score \| Max \|/);
    assert.match(md, /\|-----------\|-------\|-----\|/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('jsonl format writes valid JSON lines', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-jsonl-'));

  try {
    const scoresPath = writeFixtureScores(tempDir);
    runReporter([scoresPath, '--format', 'jsonl', '--output-dir', tempDir]);

    const jsonlFile = fs.readdirSync(tempDir).find((name) => name.endsWith('.jsonl'));
    assert.ok(jsonlFile, 'expected a jsonl report file');

    const lines = fs.readFileSync(path.join(tempDir, jsonlFile), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);

    assert.ok(lines.length > 0, 'expected at least one JSONL line');

    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.project);
      assert.ok(parsed.check_id);
      assert.equal(typeof parsed.score, 'number');
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
