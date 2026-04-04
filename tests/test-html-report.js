#!/usr/bin/env node
'use strict';

// F003: HTML report content validation.
// Generates HTML reports for 3 score ranges and validates content consistency.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const SCANNER = path.join(ROOT, 'src', 'scanner.sh');
const SCORER = path.join(ROOT, 'src', 'scorer.js');
const REPORTER = path.join(ROOT, 'src', 'reporter.js');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'al-html-test-'));

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    process.stdout.write(`PASS: ${name}\n`);
  } catch (e) {
    process.stdout.write(`FAIL: ${name}\n  ${e.message}\n`);
  }
}

function makeRepo(name, claudeContent, extras) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  if (claudeContent) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeContent);
  if (extras) {
    for (const [p, content] of Object.entries(extras)) {
      const full = path.join(dir, p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }
  execSync(`git -C "${dir}" init -q && git -C "${dir}" add -A && git -C "${dir}" commit -q -m init`, {
    env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test' },
  });
  return dir;
}

function scanAndScore(repoDir) {
  const scan = execSync(`bash "${SCANNER}" --project-dir "${repoDir}"`, { encoding: 'utf8', timeout: 30000 });
  const score = execSync(`node "${SCORER}"`, { input: scan, encoding: 'utf8', timeout: 10000 });
  return JSON.parse(score);
}

function generateHTML(scoredJson) {
  const tmpScore = path.join(TMP, 'score-' + Date.now() + '.json');
  const tmpDir = path.join(TMP, 'reports-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(tmpScore, JSON.stringify(scoredJson));
  execSync(`node "${REPORTER}" "${tmpScore}" --format html --output-dir "${tmpDir}"`, { encoding: 'utf8', timeout: 10000 });
  const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.html'));
  if (files.length === 0) throw new Error('No HTML file generated');
  return fs.readFileSync(path.join(tmpDir, files[0]), 'utf8');
}

function validateHTML(html, scored, label) {
  test(`${label}: total score present`, () => {
    assert.ok(html.includes(String(scored.total_score)), `Expected ${scored.total_score} in HTML`);
  });

  const dims = ['findability', 'instructions', 'workability', 'continuity', 'safety'];
  test(`${label}: all 5 dimension names present`, () => {
    for (const d of dims) {
      // Check case-insensitive — reporter might capitalize
      assert.ok(html.toLowerCase().includes(d.toLowerCase()), `Missing dimension: ${d}`);
    }
  });

  test(`${label}: dimension scores match scorer`, () => {
    for (const d of dims) {
      const dimScore = scored.dimensions[d]?.score;
      if (dimScore !== undefined) {
        // Score should appear somewhere in HTML (as number)
        assert.ok(html.includes(String(dimScore)), `Dimension ${d} score ${dimScore} not found`);
      }
    }
  });

  test(`${label}: SVG gauge exists`, () => {
    assert.ok(html.includes('<svg'), 'No SVG element found');
  });

  test(`${label}: no broken values (NaN/undefined/null in visible text)`, () => {
    // Check for common rendering bugs — these should not appear outside of HTML attributes
    const textContent = html.replace(/<[^>]+>/g, ' ');
    assert.ok(!textContent.includes('NaN'), 'NaN found in text content');
    assert.ok(!textContent.includes('undefined'), 'undefined found in text content');
    // null might appear in JSON context, only check visible text areas
    const scoreArea = textContent.match(/Score.*?(?=Evidence|$)/s)?.[0] || '';
    assert.ok(!scoreArea.includes('null'), 'null found in score area');
  });

  test(`${label}: check IDs present in HTML`, () => {
    // Reporter shows failing/warning checks — at least some should appear
    const checkPattern = /[FIWCS]\d+/g;
    const matches = html.match(checkPattern) || [];
    const unique = new Set(matches);
    // High-score repos may have very few issues shown; low-score repos many
    // Just verify the HTML contains at least 1 check ID
    assert.ok(unique.size >= 1, `Expected at least 1 check ID, got ${unique.size}`);
  });

  test(`${label}: all div tags balanced`, () => {
    const opens = (html.match(/<div/g) || []).length;
    const closes = (html.match(/<\/div>/g) || []).length;
    assert.equal(opens, closes, `Unbalanced divs: ${opens} opens vs ${closes} closes`);
  });
}

// ── Test repos ──

// High score: well-configured repo
const highRepo = makeRepo('high-score', `# High Score Project

> A well-configured project for testing.

## Session Checklist

1. If modifying API → read docs/api.md

## Rules

- Don't push to main. Instead, use branches. Because: review matters.
- Don't skip tests. Instead, run \`npm test\`. Because: regressions hurt.
- Don't hardcode secrets. Instead, use env vars. Because: security.

## Workflow

- \`npm test\`
- \`npm run build\`
`, {
  'README.md': '# High Score\nA demo project.\n',
  'CHANGELOG.md': '# Changelog\n## v1.0\n- Initial release with full setup\n## v0.9\n- Pre-release testing\n',
  'HANDOFF.md': '# Handoff\nStatus: ready\n',
  'tests/app.test.js': 'test("works", () => expect(1).toBe(1));\n',
  '.github/workflows/ci.yml': 'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4\n      - run: npm test\n',
  '.gitignore': '.env\nnode_modules/\n',
  'SECURITY.md': '# Security\nReport vulnerabilities via email.\n',
  '.gitleaks.toml': 'title = "gitleaks"\n',
});

// Medium score: partial setup
const medRepo = makeRepo('med-score', '# Medium Project\n\nA project with some setup.\n', {
  'README.md': '# Medium\n',
  'src/index.js': 'console.log("hello");\n',
  '.github/workflows/ci.yml': 'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo ok\n',
});

// Low score: minimal
const lowRepo = makeRepo('low-score', null, {
  'README.md': '# Low\n',
  'src/main.py': 'print("hello")\n',
});

// ── Run ──

const highScored = scanAndScore(highRepo);
const medScored = scanAndScore(medRepo);
const lowScored = scanAndScore(lowRepo);

process.stdout.write(`\nScores: high=${highScored.total_score} med=${medScored.total_score} low=${lowScored.total_score}\n\n`);

const highHTML = generateHTML(highScored);
const medHTML = generateHTML(medScored);
const lowHTML = generateHTML(lowScored);

validateHTML(highHTML, highScored, 'high-score');
validateHTML(medHTML, medScored, 'med-score');
validateHTML(lowHTML, lowScored, 'low-score');

// Cleanup
fs.rmSync(TMP, { recursive: true, force: true });

// Summary
process.stdout.write(`\n${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
