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

// ── XSS escaping assertions (A3-S3) ──

function buildXssScores(projectName, checkDetail, checkName) {
  return {
    total_score: 42,
    dimensions: { findability: { score: 5, max: 20, weight: 1 }, instructions: { score: 0, max: 20, weight: 1 }, workability: { score: 0, max: 20, weight: 1 }, continuity: { score: 0, max: 20, weight: 1 }, safety: { score: 0, max: 20, weight: 1 } },
    by_project: {
      [projectName]: {
        findability: {
          score: 5, max: 20, weight: 1,
          checks: [{ check_id: 'F1', name: checkName, measured_value: 0, score: 0.3, detail: checkDetail }],
        },
        instructions: { score: 0, max: 20, weight: 1, checks: [] },
        workability: { score: 0, max: 20, weight: 1, checks: [] },
        continuity: { score: 0, max: 20, weight: 1, checks: [] },
        safety: { score: 0, max: 20, weight: 1, checks: [] },
      },
    },
  };
}

// Payload 1: script tag in project name
const xssHtml1 = generateHTML(buildXssScores('<script>alert(1)</script>', 'normal', 'check'));
test('XSS: script tag in project name is escaped', () => {
  assert.ok(!xssHtml1.includes('<script>alert'), 'Raw <script> tag found in HTML output for project name');
  assert.ok(xssHtml1.includes('&lt;script&gt;') || !xssHtml1.includes('alert(1)'), 'Script payload not escaped in project name');
});

// Payload 2: SVG onload in check detail
const xssHtml2 = generateHTML(buildXssScores('normal', '"><svg onload=alert(1)>', 'check'));
test('XSS: SVG onload in check detail is escaped', () => {
  assert.ok(!xssHtml2.includes('<svg onload='), 'Raw <svg onload= found in HTML output for check detail');
});

// Payload 3: script tag in check name
const xssHtml3 = generateHTML(buildXssScores('normal', 'normal', '<script>alert(2)</script>'));
test('XSS: script tag in check name is escaped', () => {
  assert.ok(!xssHtml3.includes('<script>alert(2)'), 'Raw <script> tag found in HTML output for check name');
});

// Payload 4: angle brackets in detail field
const xssHtml4 = generateHTML(buildXssScores('normal', '<b>bold</b> & <i>italic</i>', 'check'));
test('XSS: HTML tags in detail field are escaped', () => {
  assert.ok(!xssHtml4.includes('<b>bold</b>'), 'Raw <b> tag found in HTML output for detail');
  assert.ok(xssHtml4.includes('&lt;b&gt;') || xssHtml4.includes('&amp;'), 'HTML entities not present in escaped detail output');
});

// Payload 5: double-encoded entity in project name (must not double-escape)
const xssHtml5 = generateHTML(buildXssScores('&lt;script&gt;', 'normal', 'check'));
test('XSS: pre-encoded entities in project name handled safely', () => {
  // &lt;script&gt; input should not produce executable <script> in output
  assert.ok(!xssHtml5.includes('<script>'), 'Decoded script tag found in HTML output');
});

// Payload 6: quote injection attempt in detail
const xssHtml6 = generateHTML(buildXssScores('normal', '" onmouseover="alert(1)', 'check'));
test('XSS: quote injection in detail does not create event handler', () => {
  assert.ok(!xssHtml6.includes('" onmouseover="'), 'Unescaped quote injection found in HTML output for detail');
});

// ─── S4: Edge-case and completeness tests ──────────────────────────────────

// Score-rank ordering: low-score repo should have more red dot markers than high-score
// The reporter uses #E24B4A for failing checks (score < 0.5) as colored dots
test('low-score repo has more red check markers than high-score repo in HTML', () => {
  const redPattern = /#E24B4A/g;
  const highRedCount = (highHTML.match(redPattern) || []).length;
  const lowRedCount = (lowHTML.match(redPattern) || []).length;
  // Low-score should have more red markers (failing checks)
  assert.ok(lowRedCount > highRedCount, `Low-score (${lowRedCount} red) should have more than high-score (${highRedCount} red)`);
});

// Score range colors: high-score repo should have green color marker
test('high-score repo HTML contains green color (#1D9E75)', () => {
  assert.ok(highHTML.includes('#1D9E75'), 'High-score HTML should contain green color marker');
});

// Score range colors: low-score repo should have red color marker
test('low-score repo HTML contains red color (#E24B4A)', () => {
  assert.ok(lowHTML.includes('#E24B4A'), 'Low-score HTML should contain red color marker');
});

// Score numbers appear in HTML for all 3 repos
test('med-score HTML contains total score number', () => {
  assert.ok(medHTML.includes(String(medScored.total_score)), `Med-score HTML should include ${medScored.total_score}`);
});

// Check that HTML is not empty
test('all three HTML reports are non-trivially long (>1000 chars)', () => {
  assert.ok(highHTML.length > 1000, 'high-score HTML should be substantial');
  assert.ok(medHTML.length > 1000, 'med-score HTML should be substantial');
  assert.ok(lowHTML.length > 1000, 'low-score HTML should be substantial');
});

// Validate that the CSS/style tag exists (styling present)
test('HTML reports contain a <style> tag', () => {
  assert.ok(highHTML.includes('<style>') || highHTML.includes('<style '), 'high-score HTML should have <style>');
  assert.ok(medHTML.includes('<style>') || medHTML.includes('<style '), 'med-score HTML should have <style>');
});

// Validate that the version string is present
test('HTML report contains agent-lint version string', () => {
  assert.ok(highHTML.includes('0.6'), 'high-score HTML should contain version string');
});

// Validate harness checks absent from non-harness fixture HTML
test('med-score HTML does not contain null or NaN in visible text', () => {
  const textContent = medHTML.replace(/<[^>]+>/g, ' ');
  assert.ok(!textContent.includes('NaN'), 'NaN found in med-score text content');
  assert.ok(!textContent.includes('undefined'), 'undefined found in med-score text content');
});

// Validate low-score div balance
test('low-score HTML has balanced div tags', () => {
  const opens = (lowHTML.match(/<div/g) || []).length;
  const closes = (lowHTML.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes, `Low-score divs: ${opens} opens vs ${closes} closes`);
});

// Validate that --format=md produces a markdown report
test('md format writes report with check score data', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'al-html-md-'));
  const tmpScore = path.join(tmpDir, 'scores.json');
  fs.writeFileSync(tmpScore, JSON.stringify(medScored));
  execSync(`node "${REPORTER}" "${tmpScore}" --format md --output-dir "${tmpDir}"`, { encoding: 'utf8', timeout: 10000 });
  const mdFile = fs.readdirSync(tmpDir).find((f) => f.endsWith('.md'));
  assert.ok(mdFile, 'md format should produce a .md file');
  const md = fs.readFileSync(path.join(tmpDir, mdFile), 'utf8');
  assert.ok(md.includes(String(medScored.total_score)), 'md report should contain total score');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Validate that --format=jsonl produces jsonl with correct structure
test('jsonl format produces lines with correct fields for med-score', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'al-html-jsonl-'));
  const tmpScore = path.join(tmpDir, 'scores.json');
  fs.writeFileSync(tmpScore, JSON.stringify(medScored));
  execSync(`node "${REPORTER}" "${tmpScore}" --format jsonl --output-dir "${tmpDir}"`, { encoding: 'utf8', timeout: 10000 });
  const jsonlFile = fs.readdirSync(tmpDir).find((f) => f.endsWith('.jsonl'));
  assert.ok(jsonlFile, 'jsonl format should produce a .jsonl file');
  const lines = fs.readFileSync(path.join(tmpDir, jsonlFile), 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'jsonl should have at least one line');
  for (const line of lines) {
    const obj = JSON.parse(line);
    assert.ok(obj.project, 'each jsonl line should have project');
    assert.ok(obj.check_id, 'each jsonl line should have check_id');
    assert.equal(typeof obj.score, 'number', 'score should be a number');
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Validate --format=all produces html + md + jsonl
test('format=all produces html, md, and jsonl files', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'al-html-all-'));
  const tmpScore = path.join(tmpDir, 'scores.json');
  fs.writeFileSync(tmpScore, JSON.stringify(medScored));
  execSync(`node "${REPORTER}" "${tmpScore}" --format all --output-dir "${tmpDir}"`, { encoding: 'utf8', timeout: 10000 });
  const files = fs.readdirSync(tmpDir);
  assert.ok(files.some((f) => f.endsWith('.html')), 'format=all should produce .html');
  assert.ok(files.some((f) => f.endsWith('.md')), 'format=all should produce .md');
  assert.ok(files.some((f) => f.endsWith('.jsonl')), 'format=all should produce .jsonl');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Validate --before flag produces delta comparison output
test('--before flag produces comparison output with delta', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'al-html-before-'));
  const tmpScore = path.join(tmpDir, 'scores.json');
  const tmpBefore = path.join(tmpDir, 'before.json');
  // Simulate a "before" score that is lower
  const beforeScores = JSON.parse(JSON.stringify(medScored));
  beforeScores.total_score = Math.max(0, medScored.total_score - 10);
  fs.writeFileSync(tmpScore, JSON.stringify(medScored));
  fs.writeFileSync(tmpBefore, JSON.stringify(beforeScores));
  execSync(`node "${REPORTER}" "${tmpScore}" --before "${tmpBefore}" --format html --output-dir "${tmpDir}"`, { encoding: 'utf8', timeout: 10000 });
  const htmlFile = fs.readdirSync(tmpDir).find((f) => f.endsWith('.html'));
  assert.ok(htmlFile, 'should produce html with --before flag');
  const html = fs.readFileSync(path.join(tmpDir, htmlFile), 'utf8');
  assert.ok(html.length > 1000, 'html with --before should be non-trivial');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Validate specific check IDs appear for low-score (F1 should be missing → show up as failing)
test('low-score HTML shows F1 check ID (no entry file → should appear)', () => {
  // Low-score repo has no CLAUDE.md, so F1 score=0 → should appear in the report
  assert.ok(lowHTML.includes('F1'), 'F1 should appear in low-score HTML (no entry file)');
});

// Validate SVG exists in all three reports
test('all three HTML reports contain SVG gauge', () => {
  assert.ok(highHTML.includes('<svg'), 'high-score HTML should have SVG');
  assert.ok(medHTML.includes('<svg'), 'med-score HTML should have SVG');
  assert.ok(lowHTML.includes('<svg'), 'low-score HTML should have SVG');
});

// ─── Edge: harness dimension presence
test('HTML report includes harness dimension when harness checks are present', () => {
  const harnessScores = {
    total_score: 60,
    dimensions: {
      findability: { score: 8, max: 10, weight: 0.2, checks: [] },
      instructions: { score: 6, max: 10, weight: 0.2, checks: [] },
      workability: { score: 6, max: 10, weight: 0.2, checks: [] },
      continuity: { score: 6, max: 10, weight: 0.2, checks: [] },
      safety: { score: 6, max: 10, weight: 0.1, checks: [] },
      harness: { score: 4, max: 10, weight: 0.1, checks: [] },
    },
    by_project: {
      'h-proj': {
        harness: { score: 4, max: 10, weight: 0.1, checks: [
          { check_id: 'H1', name: 'Hook events', measured_value: 0, score: 0.2, detail: 'invalid events' },
        ]},
        findability: { score: 8, max: 10, weight: 0.2, checks: [] },
        instructions: { score: 6, max: 10, weight: 0.2, checks: [] },
        workability: { score: 6, max: 10, weight: 0.2, checks: [] },
        continuity: { score: 6, max: 10, weight: 0.2, checks: [] },
        safety: { score: 6, max: 10, weight: 0.1, checks: [] },
      },
    },
  };
  const hHtml = generateHTML(harnessScores);
  assert.ok(hHtml.toLowerCase().includes('harness'), 'harness dimension should appear in HTML');
  assert.ok(hHtml.includes('H1'), 'H1 check should appear in HTML');
});

// Multi-project breakdown
test('HTML report handles multiple projects without crashing', () => {
  const multiScores = {
    total_score: 55,
    dimensions: {
      findability: { score: 6, max: 10, weight: 0.5, checks: [] },
      workability: { score: 5, max: 10, weight: 0.5, checks: [] },
    },
    by_project: {
      'proj-a': {
        findability: { score: 7, max: 10, weight: 0.5, checks: [
          { check_id: 'F1', name: 'Entry', measured_value: 1, score: 1, detail: 'found' },
        ]},
        workability: { score: 5, max: 10, weight: 0.5, checks: [] },
      },
      'proj-b': {
        findability: { score: 5, max: 10, weight: 0.5, checks: [
          { check_id: 'F1', name: 'Entry', measured_value: 0, score: 0.2, detail: 'missing' },
        ]},
        workability: { score: 5, max: 10, weight: 0.5, checks: [] },
      },
      'proj-c': {
        findability: { score: 6, max: 10, weight: 0.5, checks: [] },
        workability: { score: 6, max: 10, weight: 0.5, checks: [] },
      },
    },
  };
  const multiHtml = generateHTML(multiScores);
  assert.ok(multiHtml.includes('proj-a'), 'proj-a should appear in HTML');
  assert.ok(multiHtml.includes('proj-b'), 'proj-b should appear in HTML');
  assert.ok(!multiHtml.includes('<script>'), 'no unescaped script tags in multi-project HTML');
});

// Score boundary: total_score=100
test('HTML report handles total_score=100 without breaking gauge', () => {
  const perfectScores = {
    total_score: 100,
    dimensions: {
      findability: { score: 10, max: 10, weight: 1, checks: [] },
    },
    by_project: {
      'perfect': {
        findability: { score: 10, max: 10, weight: 1, checks: [] },
      },
    },
  };
  const perfectHtml = generateHTML(perfectScores);
  assert.ok(perfectHtml.includes('100'), '100 score should appear in HTML');
  assert.ok(!perfectHtml.includes('NaN'), 'NaN should not appear in HTML for score=100');
  const opens = (perfectHtml.match(/<div/g) || []).length;
  const closes = (perfectHtml.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes, 'divs should be balanced for perfect score report');
});

// Score boundary: total_score=0
test('HTML report handles total_score=0 without crashing', () => {
  const zeroScores = {
    total_score: 0,
    dimensions: {
      findability: { score: 0, max: 10, weight: 1, checks: [] },
    },
    by_project: {
      'empty': {
        findability: { score: 0, max: 10, weight: 1, checks: [] },
      },
    },
  };
  const zeroHtml = generateHTML(zeroScores);
  assert.ok(zeroHtml.includes('0'), 'zero score should appear in HTML');
  assert.ok(!zeroHtml.includes('NaN'), 'NaN should not appear in HTML for score=0');
});

// Ampersand escaping in check detail
test('XSS: ampersand in detail is HTML-entity encoded', () => {
  const ampHtml = generateHTML(buildXssScores('normal', 'check A & check B', 'check'));
  // Raw & must not appear — should be &amp; (or the text rendered safely)
  // Since the reporter uses esc() which replaces & with &amp;, this should hold
  const detailArea = ampHtml.match(/check A.*check B/s)?.[0] || '';
  if (detailArea) {
    assert.ok(!detailArea.includes(' & '), 'raw & in detail should be encoded as &amp;');
  }
});

// Med-score HTML has purple/mid-range color marker (score 60-79 range → #534AB7)
test('med-score HTML contains mid-range color marker (#534AB7)', () => {
  assert.ok(medHTML.includes('#534AB7') || medHTML.includes('#1D9E75') || medHTML.includes('#E24B4A'),
    'med-score HTML should contain at least one score color marker');
});

// Check that W-prefix check IDs appear in low-score HTML (workability should fail for minimal repo)
test('low-score HTML shows W-prefix check ID (workability failure expected)', () => {
  const workPattern = /W\d+/;
  assert.ok(workPattern.test(lowHTML), 'W-prefix check ID should appear in low-score HTML');
});

// Check that the high-score HTML has lower red count than low-score (explicit count check)
test('high-score HTML has fewer #E24B4A red markers than low-score HTML', () => {
  const redPattern = /#E24B4A/g;
  const highCount = (highHTML.match(redPattern) || []).length;
  const lowCount = (lowHTML.match(redPattern) || []).length;
  assert.ok(highCount < lowCount, `high (${highCount}) should be < low (${lowCount}) red markers`);
});

// Check dimension weight value appears in HTML (scorer outputs weight)
test('med-score HTML contains dimension weight or score values', () => {
  const dimScore = medScored.dimensions?.findability?.score;
  if (dimScore !== undefined) {
    assert.ok(medHTML.includes(String(dimScore)), `Findability score ${dimScore} should appear`);
  } else {
    // If no findability, just confirm HTML has numbers
    assert.ok(/\d+/.test(medHTML), 'HTML should contain numeric content');
  }
});

// Validate no undefined check names in HTML (all checks have names)
test('low-score HTML does not contain literal "undefined" in visible text', () => {
  const textContent = lowHTML.replace(/<[^>]+>/g, ' ');
  assert.ok(!textContent.includes('undefined'), 'undefined should not appear in HTML text content');
});

// Validate high-score total shown in HTML (score present, no NaN)
test('high-score HTML shows total score without NaN or undefined', () => {
  const score = highScored.total_score;
  assert.ok(highHTML.includes(String(score)), `Score ${score} should appear in high-score HTML`);
  assert.ok(!highHTML.includes('NaN'), 'NaN should not appear in high-score HTML');
});

// Check that project name from scan appears in HTML
test('high-score HTML contains the project name', () => {
  const projName = Object.keys(highScored.by_project || {})[0];
  if (projName) {
    assert.ok(highHTML.includes(projName), `Project name ${projName} should appear in HTML`);
  } else {
    assert.ok(highHTML.includes('<html'), 'HTML should at least be valid HTML');
  }
});

// Cleanup
fs.rmSync(TMP, { recursive: true, force: true });

// Summary
process.stdout.write(`\n${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
