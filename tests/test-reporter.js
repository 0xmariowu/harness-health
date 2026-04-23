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

runTest('sarif format writes a SARIF report and filters note-level results by default', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-sarif-'));

  try {
    const scoresPath = writeFixtureScores(tempDir);
    runReporter([scoresPath, '--format', 'sarif', '--output-dir', tempDir]);

    const sarifFile = fs.readdirSync(tempDir).find((name) => name.endsWith('.sarif'));
    assert.ok(sarifFile, 'expected a sarif report file');

    const sarif = JSON.parse(fs.readFileSync(path.join(tempDir, sarifFile), 'utf8'));
    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.runs[0].tool.driver.name, 'AgentLint');

    const resultRuleIds = sarif.runs[0].results.map((result) => result.ruleId);
    assert.deepEqual(resultRuleIds.sort(), ['F5', 'W1']);

    const w1 = sarif.runs[0].results.find((result) => result.ruleId === 'W1');
    assert.equal(w1.level, 'error');

    const f5 = sarif.runs[0].results.find((result) => result.ruleId === 'F5');
    assert.equal(f5.locations[0].physicalLocation.artifactLocation.uri, 'CLAUDE.md');

    const f1Rule = sarif.runs[0].tool.driver.rules.find((rule) => rule.id === 'F1');
    assert.ok(f1Rule, 'expected F1 rule metadata to be present');
    assert.match(f1Rule.helpUri, /evidence\.json#check-F1$/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('sarif format includes note-level results when --sarif-include-all is set', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-sarif-all-'));

  try {
    const scoresPath = writeFixtureScores(tempDir);
    runReporter([scoresPath, '--format', 'sarif', '--sarif-include-all', '--output-dir', tempDir]);

    const sarifFile = fs.readdirSync(tempDir).find((name) => name.endsWith('.sarif'));
    assert.ok(sarifFile, 'expected a sarif report file');

    const sarif = JSON.parse(fs.readFileSync(path.join(tempDir, sarifFile), 'utf8'));
    const f1 = sarif.runs[0].results.find((result) => result.ruleId === 'F1');
    assert.ok(f1, 'expected note-level result to be included');
    assert.equal(f1.level, 'note');
    assert.equal(f1.locations[0].physicalLocation.artifactLocation.uri, 'CLAUDE.md');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('scores file is not confused with --plan value', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-plan-'));

  try {
    const scoresPath = writeFixtureScores(tempDir);
    const planPath = path.join(tempDir, 'plan.json');
    fs.writeFileSync(planPath, '[]\n');

    const result = runReporter(['--plan', planPath, scoresPath, '--format', 'terminal']);
    assert.match(result.stdout, /Score: 73\/100/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ─── S4: Edge-case tests ───────────────────────────────────────────────────

runTest('missing input file causes non-zero exit', () => {
  const result = spawnSync(process.execPath, [reporterPath, '/nonexistent/path/scores.json'], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'missing file should cause non-zero exit');
});

runTest('unknown --format arg exits non-zero with error message on stderr', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-badformat-'));
  try {
    const scoresPath = writeFixtureScores(tempDir);
    const result = spawnSync(process.execPath, [reporterPath, scoresPath, '--format', 'invalid-format-xyz', '--output-dir', tempDir], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'unknown format should cause non-zero exit');
    assert.match(result.stderr, /unknown --format/i, 'stderr should name the invalid format');
    const filesAfter = fs.readdirSync(tempDir).filter((f) => f !== path.basename(scoresPath) && !f.endsWith('.json'));
    assert.equal(filesAfter.length, 0, 'unknown format should produce no output files');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('terminal format with zero total_score does not crash', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-zero-'));
  try {
    const zeroScores = {
      total_score: 0,
      dimensions: {
        findability: makeDimension(0, 0.25, []),
        instructions: makeDimension(0, 0.35, []),
        workability: makeDimension(0, 0.20, []),
        continuity: makeDimension(0, 0.20, []),
      },
      by_project: {},
    };
    const scoresPath = path.join(tempDir, 'zero-scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify(zeroScores, null, 2));
    const result = spawnSync(process.execPath, [reporterPath, scoresPath, '--format', 'terminal'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || 'reporter crashed on zero scores');
    assert.match(result.stdout, /Score: 0\/100/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('fail-below exits non-zero when total score is below threshold', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-fail-below-'));
  try {
    const scoresPath = writeFixtureScores(tempDir);
    const result = spawnSync(process.execPath, [reporterPath, scoresPath, '--fail-below', '99'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /below minimum 99/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('fail-below exits zero when threshold is disabled', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-fail-below-zero-'));
  try {
    const scoresPath = writeFixtureScores(tempDir);
    const result = runReporter([scoresPath, '--fail-below', '0']);
    assert.match(result.stdout, /Score: 73\/100/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('fail-below requires a numeric threshold', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-fail-below-invalid-'));
  try {
    const scoresPath = writeFixtureScores(tempDir);
    const result = spawnSync(process.execPath, [reporterPath, scoresPath, '--fail-below'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be a number between 0 and 100/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('html format output contains project name escaped (XSS prevention)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-xss-'));
  try {
    const xssScores = {
      total_score: 50,
      dimensions: {
        findability: makeDimension(5, 0.25, []),
        instructions: makeDimension(5, 0.35, []),
        workability: makeDimension(5, 0.20, []),
        continuity: makeDimension(5, 0.20, []),
        harness: makeDimension(5, 0.0, []),
      },
      by_project: {
        'xss-test': {
          findability: makeDimension(5, 0.25, [
            {
              check_id: 'F1',
              name: '<script>alert(1)</script>',
              score: 0.3,
              measured_value: 0,
              detail: '"><svg onload=alert(1)>',
            },
          ]),
          instructions: makeDimension(5, 0.35, []),
          workability: makeDimension(5, 0.20, []),
          continuity: makeDimension(5, 0.20, []),
          harness: makeDimension(5, 0.0, []),
        },
      },
    };
    const scoresPath = path.join(tempDir, 'xss-scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify(xssScores, null, 2));
    const result = spawnSync(process.execPath, [reporterPath, scoresPath, '--format', 'html', '--output-dir', tempDir], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || 'reporter crashed on XSS input');

    const htmlFile = fs.readdirSync(tempDir).find((name) => name.endsWith('.html'));
    assert.ok(htmlFile, 'expected an HTML report file');

    const html = fs.readFileSync(path.join(tempDir, htmlFile), 'utf8');
    // Raw script tag must not appear unescaped
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw <script> tag should be escaped in HTML output');
    // The escaped form should appear (or the content should not include raw svg event handlers)
    assert.ok(!html.includes('"><svg onload=alert(1)>'), 'raw SVG injection should be escaped in HTML output');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('jsonl format output with empty by_project produces no lines', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-empty-'));
  try {
    const emptyScores = {
      total_score: 0,
      dimensions: {
        findability: makeDimension(0, 0.25, []),
      },
      by_project: {},
    };
    const scoresPath = path.join(tempDir, 'empty-scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify(emptyScores, null, 2));
    const result = spawnSync(process.execPath, [reporterPath, scoresPath, '--format', 'jsonl', '--output-dir', tempDir], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || 'reporter crashed on empty by_project');

    const jsonlFile = fs.readdirSync(tempDir).find((name) => name.endsWith('.jsonl'));
    assert.ok(jsonlFile, 'expected a jsonl file even with empty by_project');

    const content = fs.readFileSync(path.join(tempDir, jsonlFile), 'utf8').trim();
    assert.equal(content, '', 'empty by_project should produce no JSONL lines');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
