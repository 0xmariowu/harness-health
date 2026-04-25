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

runTest('sarif format prefixes locations with project_path when present', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-sarif-project-path-'));

  try {
    const scores = {
      total_score: 45,
      dimensions: {},
      by_project: {
        'org1/app': {
          project: 'app',
          project_path: 'org1/app',
          findability: makeDimension(4, 0.25, [
            { check_id: 'F5', name: 'All references resolve', score: 0.4, measured_value: 1, detail: 'broken refs' },
          ]),
        },
        'org2/app': {
          project: 'app',
          project_path: 'org2/app',
          findability: makeDimension(3, 0.25, [
            { check_id: 'F5', name: 'All references resolve', score: 0.3, measured_value: 1, detail: 'broken refs' },
          ]),
        },
      },
    };
    const scoresPath = path.join(tempDir, 'scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2));
    runReporter([scoresPath, '--format', 'sarif', '--output-dir', tempDir]);

    const sarifFile = fs.readdirSync(tempDir).find((name) => name.endsWith('.sarif'));
    assert.ok(sarifFile, 'expected a sarif report file');

    const sarif = JSON.parse(fs.readFileSync(path.join(tempDir, sarifFile), 'utf8'));
    const uris = sarif.runs[0].results.map((result) => (
      result.locations[0].physicalLocation.artifactLocation.uri
    )).sort();
    assert.deepEqual(uris, ['org1/app/CLAUDE.md', 'org2/app/CLAUDE.md']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('sarif format uses AGENTS.md as the project entry URI when that is what scanner found', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-sarif-agents-entry-'));

  try {
    const scores = {
      total_score: 50,
      dimensions: {},
      by_project: {
        'org/agents-only': {
          project: 'agents-only',
          project_path: 'org/agents-only',
          findability: makeDimension(8, 0.25, [
            {
              check_id: 'F1',
              name: 'Entry file exists',
              score: 1,
              measured_value: { entry_file: 'AGENTS.md', platform: 'openai', all_files: ['AGENTS.md'] },
              detail: 'AGENTS.md found',
            },
          ]),
          instructions: makeDimension(4, 0.35, [
            { check_id: 'I1', name: 'Project overview present', score: 0.2, measured_value: 0, detail: 'missing overview' },
          ]),
        },
      },
    };
    const scoresPath = path.join(tempDir, 'scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2));
    runReporter([scoresPath, '--format', 'sarif', '--output-dir', tempDir]);

    const sarifFile = fs.readdirSync(tempDir).find((name) => name.endsWith('.sarif'));
    assert.ok(sarifFile, 'expected a sarif report file');

    const sarif = JSON.parse(fs.readFileSync(path.join(tempDir, sarifFile), 'utf8'));
    const i1 = sarif.runs[0].results.find((result) => result.ruleId === 'I1');
    assert.ok(i1, 'expected failing I1 result');
    assert.equal(i1.locations[0].physicalLocation.artifactLocation.uri, 'org/agents-only/AGENTS.md');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('report file names include a unique suffix so same-second reporter calls do not collide', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-unique-names-'));

  try {
    const scoresPath = writeFixtureScores(tempDir);
    runReporter([scoresPath, '--format', 'html', '--output-dir', tempDir]);
    runReporter([scoresPath, '--format', 'html', '--output-dir', tempDir]);

    const htmlFiles = fs.readdirSync(tempDir)
      .filter((name) => /^al-\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{8}\.html$/.test(name))
      .sort();
    assert.equal(htmlFiles.length, 2, `expected two unique HTML reports, got ${htmlFiles.join(', ')}`);
    assert.notEqual(htmlFiles[0], htmlFiles[1], 'report filenames must not collide');
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

runTest('fail-below without a value exits 1 with a clear message', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-fail-below-no-val-'));
  try {
    const scoresPath = writeFixtureScores(tempDir);
    const result = spawnSync(process.execPath, [reporterPath, scoresPath, '--fail-below'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    // New contract: missing-value check fires in the arg parser before we
    // reach the "must be a number" path, so stderr mentions "requires a value".
    assert.match(result.stderr, /--fail-below.*requires a value/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('fail-below with an empty value exits 1 with a numeric-value message', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-fail-below-empty-'));
  try {
    const scoresPath = writeFixtureScores(tempDir);
    for (const args of [
      [scoresPath, '--fail-below='],
      [scoresPath, '--fail-below', ''],
    ]) {
      const result = spawnSync(process.execPath, [reporterPath, ...args], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /--fail-below requires a numeric value \(0-100\)/);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('fail-below with a non-numeric value exits 1 with numeric-range message', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-fail-below-nan-'));
  try {
    const scoresPath = writeFixtureScores(tempDir);
    const result = spawnSync(process.execPath, [reporterPath, scoresPath, '--fail-below', 'banana'], {
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

// ─── not_run regression tests ──────────────────────────────────────────────

function makeDim(score, weight, status = 'run') {
  return { status, score, max: 10, weight, checks: [] };
}

runTest('By-Project panel skips not_run dimensions when averaging (regression: would drag per-project score down)', () => {
  // Two projects, each with F=9, I=9, W=9 (ran) and deep/session (not_run).
  // If not_run dims are included in denominator, per-project score = 9 * 0.63 / (0.63 + 0.1) ≈ 78 instead of 90.
  // The By-Project panel must match the scorer's contract: only average run dims.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-byproj-'));
  try {
    const scores = {
      total_score: 90,
      score_scope: 'core',
      dimensions: {
        findability: makeDim(9, 0.2),
        instructions: makeDim(9, 0.25),
        workability: makeDim(9, 0.18),
        deep: makeDim(null, 0.05, 'not_run'),
        session: makeDim(null, 0.05, 'not_run'),
      },
      by_project: {
        alpha: {
          findability: makeDim(9, 0.2),
          instructions: makeDim(9, 0.25),
          workability: makeDim(9, 0.18),
          deep: makeDim(null, 0.05, 'not_run'),
          session: makeDim(null, 0.05, 'not_run'),
        },
        beta: {
          findability: makeDim(9, 0.2),
          instructions: makeDim(9, 0.25),
          workability: makeDim(9, 0.18),
          deep: makeDim(null, 0.05, 'not_run'),
          session: makeDim(null, 0.05, 'not_run'),
        },
      },
    };
    const scoresPath = path.join(tempDir, 'scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify(scores));
    const result = runReporter([scoresPath, '--format', 'terminal']);
    // Per-project score should be 9 (the avg of run dims), not ~8 (polluted by
    // counting weights of deep/session in the denominator with a null*weight=0).
    // Terminal renders as "   9" padded right. We match any 9 after the project name.
    assert.match(result.stdout, /alpha\s+9\b/);
    assert.match(result.stdout, /beta\s+9\b/);
    // Must not show 7 or 8 (the buggy values).
    assert.doesNotMatch(result.stdout, /alpha\s+[78]\b/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('HTML compare mode: not_run dimension does not render a negative delta (null-arithmetic regression)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-delta-'));
  try {
    // After scan: deep is not_run. Before scan: deep had score 8.
    // Bug: `dim.score - bd.score` = `null - 8` = -8 → fake "-8" delta pill.
    const scores = {
      total_score: 90,
      score_scope: 'core',
      dimensions: {
        findability: makeDim(9, 0.2),
        deep: makeDim(null, 0.05, 'not_run'),
      },
      by_project: {},
    };
    const before = {
      total_score: 80,
      dimensions: {
        findability: makeDim(9, 0.2),
        deep: makeDim(8, 0.05),
      },
      by_project: {},
    };
    const scoresPath = path.join(tempDir, 'scores.json');
    const beforePath = path.join(tempDir, 'before.json');
    fs.writeFileSync(scoresPath, JSON.stringify(scores));
    fs.writeFileSync(beforePath, JSON.stringify(before));
    runReporter([scoresPath, '--format', 'html', '--before', beforePath, '--output-dir', tempDir]);
    const htmlFile = fs.readdirSync(tempDir).find((n) => n.endsWith('.html'));
    assert.ok(htmlFile, 'expected html file');
    const html = fs.readFileSync(path.join(tempDir, htmlFile), 'utf8');
    // The Deep dimension section must NOT contain a delta-down pill with -8.
    const deepSection = html.match(/dim-label">Deep<\/span>[\s\S]{0,800}?<\/summary>/);
    assert.ok(deepSection, 'expected Deep dimension row in HTML');
    assert.doesNotMatch(deepSection[0], /delta-down[^>]*>-\d/);
    assert.doesNotMatch(deepSection[0], /-8</);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('HTML renders score_scope suffix: "(core)" when extended did not run', () => {
  // post-remediation-deep-review High #1: the HTML hero previously showed
  // just "90" with no scope indicator, so the E2B assertion
  // `html_shows_core_suffix` failed even against correct data.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-scope-core-'));
  try {
    const scores = {
      total_score: 90,
      score_scope: 'core',
      dimensions: {
        findability: makeDim(9, 0.2),
        deep: makeDim(null, 0.05, 'not_run'),
      },
      by_project: {},
    };
    const p = path.join(tempDir, 'scores.json');
    fs.writeFileSync(p, JSON.stringify(scores));
    runReporter([p, '--format', 'html', '--output-dir', tempDir]);
    const htmlFile = fs.readdirSync(tempDir).find((n) => n.endsWith('.html'));
    const html = fs.readFileSync(path.join(tempDir, htmlFile), 'utf8');
    assert.match(html, /\(core\)/, 'HTML must show "(core)" next to the total score');
    assert.doesNotMatch(html, /core \+ extended/, 'must NOT show "core + extended" when deep is not_run');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('HTML renders "core + extended" when deep or session ran', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-scope-ext-'));
  try {
    const scores = {
      total_score: 86,
      score_scope: 'core+extended',
      dimensions: {
        findability: makeDim(9, 0.2),
        deep: makeDim(7, 0.05),
      },
      by_project: {},
    };
    const p = path.join(tempDir, 'scores.json');
    fs.writeFileSync(p, JSON.stringify(scores));
    runReporter([p, '--format', 'html', '--output-dir', tempDir]);
    const htmlFile = fs.readdirSync(tempDir).find((n) => n.endsWith('.html'));
    const html = fs.readFileSync(path.join(tempDir, htmlFile), 'utf8');
    assert.match(html, /core \+ extended/, 'HTML must show "core + extended" when extended ran');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('reporter accepts --flag=value equals form (not just space-separated)', () => {
  // post-remediation-deep-review Medium #3 — equals form used to silently
  // write nothing because only space-separated parsing was implemented.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-reporter-eq-'));
  try {
    const scores = {
      total_score: 80,
      score_scope: 'core',
      dimensions: { findability: makeDim(8, 0.2) },
      by_project: {},
    };
    const p = path.join(tempDir, 'scores.json');
    fs.writeFileSync(p, JSON.stringify(scores));
    spawnSync(process.execPath, [reporterPath, p, `--format=html`, `--output-dir=${tempDir}`], { encoding: 'utf8' });
    const htmlFile = fs.readdirSync(tempDir).find((n) => n.endsWith('.html'));
    assert.ok(htmlFile, 'expected an HTML report file with equals-form flags');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
