#!/usr/bin/env node
'use strict';

// Integration test: two repos with the same basename (e.g. org1/app + org2/app)
// must stay distinct through scorer → plan-generator. Before this fix, both
// paths collided under a single `byProject[app]` bucket and findings got
// merged — real data-corruption risk for multi-project scans.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCORER = path.join(ROOT, 'src', 'scorer.js');
const PLAN = path.join(ROOT, 'src', 'plan-generator.js');
const SESSION = path.join(ROOT, 'src', 'session-analyzer.js');

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total += 1;
  try {
    fn();
    passed += 1;
    process.stdout.write(`PASS: ${name}\n`);
  } catch (e) {
    process.stdout.write(`FAIL: ${name}\n  ${e.message}\n`);
  }
}

// Synthesize scanner JSONL: two repos both named "app" but under
// different parent dirs. F5 score differs between them so we can tell
// which record produced what in the output.
const syntheticJsonl = [
  {
    project: 'app',
    project_path: '/tmp/org1/app',
    dimension: 'findability',
    check_id: 'F5',
    name: 'All references resolve',
    measured_value: 0.3,
    reference_value: 1.0,
    score: 0.3,
    detail: 'org1 has 3 broken refs',
    evidence_id: 'F5',
  },
  {
    project: 'app',
    project_path: '/tmp/org2/app',
    dimension: 'findability',
    check_id: 'F5',
    name: 'All references resolve',
    measured_value: 0.6,
    reference_value: 1.0,
    // Stay below 0.8 so plan-generator creates a fix item; above 0.8 is
    // "passing" and plan-gen drops it — that behavior is correct but
    // would make this test a no-op.
    score: 0.6,
    detail: 'org2 has 2 broken refs',
    evidence_id: 'F5',
  },
].map((r) => JSON.stringify(r)).join('\n') + '\n';

runTest('scorer keeps same-basename repos in distinct by_project buckets', () => {
  const out = execFileSync('node', [SCORER], {
    input: syntheticJsonl,
    encoding: 'utf8',
  });
  const scores = JSON.parse(out);
  const keys = Object.keys(scores.by_project);
  assert.equal(
    keys.length,
    2,
    `expected 2 by_project entries (one per path), got ${keys.length}: ${keys.join(', ')}`,
  );
  // Both entries must carry distinct project_path.
  const paths = new Set(Object.values(scores.by_project).map((e) => e.project_path));
  assert.equal(paths.size, 2, 'two entries must have distinct project_path values');
  assert.ok(paths.has('/tmp/org1/app') && paths.has('/tmp/org2/app'),
    `expected /tmp/org1/app and /tmp/org2/app, got ${[...paths].join(', ')}`);
  // Each entry exposes the display basename.
  for (const entry of Object.values(scores.by_project)) {
    assert.equal(entry.project, 'app', 'display .project should be the basename');
  }
});

runTest('plan-generator dedupe-by-path keeps both same-basename items', () => {
  // Scorer output piped through plan-generator. Previously dedupe key was
  // `${project}|${check_id}` — both "app|F5" records collapsed to one item,
  // losing the worse-scoring repo. Now dedupe uses project_path so both
  // items survive.
  const scoresOut = execFileSync('node', [SCORER], {
    input: syntheticJsonl,
    encoding: 'utf8',
  });
  const planOut = execFileSync('node', [PLAN], {
    input: scoresOut,
    encoding: 'utf8',
  });
  const plan = JSON.parse(planOut);
  const f5Items = plan.items.filter((it) => it.check_id === 'F5');
  assert.equal(
    f5Items.length,
    2,
    `expected 2 F5 items (one per repo path), got ${f5Items.length}`,
  );
  const itemPaths = new Set(f5Items.map((it) => it.project_path));
  assert.equal(itemPaths.size, 2, 'the two F5 items must carry distinct project_path values');
});

runTest('plan-generator grouped items track project_paths + disambiguate display', () => {
  // Same fixture, same severity so the two F5 items go into the same
  // grouped bucket. grouped.items[0] must (a) carry both paths in
  // `project_paths` so /al Step 5c can filter by path, and (b) render a
  // disambiguated display label ("org1/app, org2/app") rather than the
  // prior ambiguous "app, app".
  const sameSeverityJsonl = [
    {
      project: 'app', project_path: '/tmp/org1/app', dimension: 'findability',
      check_id: 'F5', name: 'x', measured_value: 3, reference_value: 1.0,
      score: 0.3, detail: 'a', evidence_id: 'F5',
    },
    {
      project: 'app', project_path: '/tmp/org2/app', dimension: 'findability',
      check_id: 'F5', name: 'x', measured_value: 2, reference_value: 1.0,
      score: 0.4, detail: 'b', evidence_id: 'F5',
    },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';

  const scoresOut = execFileSync('node', [SCORER], { input: sameSeverityJsonl, encoding: 'utf8' });
  const planOut = execFileSync('node', [PLAN], { input: scoresOut, encoding: 'utf8' });
  const plan = JSON.parse(planOut);
  const groupedF5 = (plan.grouped.high?.items || []).find((it) => it.check_id === 'F5');
  assert.ok(groupedF5, 'expected grouped.high.items[F5] to exist');
  assert.deepEqual(
    groupedF5.project_paths,
    ['/tmp/org1/app', '/tmp/org2/app'],
    'grouped F5 must carry both project_paths',
  );
  assert.notEqual(
    groupedF5.project,
    'app, app',
    'grouped F5 display label must disambiguate colliding basenames (got "app, app")',
  );
  assert.match(
    groupedF5.project,
    /org1\/app[\s\S]*org2\/app|org2\/app[\s\S]*org1\/app/,
    'grouped display should include parent-dir suffix for colliding basenames',
  );
});

runTest('session-analyzer SS3 keeps same-basename projects in distinct buckets', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'al-ss3-collision-'));
  const projectsRoot = path.join(tmp, 'projects');
  const sessionRoot = path.join(tmp, 'sessions');

  function sanitize(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function makeProject(parent, basename) {
    const dir = path.join(projectsRoot, parent, basename);
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), "# Project\n- NEVER skip tests before finishing.\n", 'utf8');
    return dir;
  }

  function makeSession(projectDir, corrections) {
    const dir = path.join(sessionRoot, sanitize(projectDir));
    fs.mkdirSync(dir, { recursive: true });
    const lines = [];
    for (let i = 0; i < corrections; i += 1) {
      lines.push(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: `wrong approach ${i}; run npm test again` },
      }));
    }
    if (corrections === 0) {
      lines.push(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'please continue with the current implementation' },
      }));
    }
    fs.writeFileSync(path.join(dir, 'session.jsonl'), `${lines.join('\n')}\n`, 'utf8');
  }

  try {
    const org1App = makeProject('org1', 'app');
    const org2App = makeProject('org2', 'app');
    const other = makeProject('org3', 'other');
    makeSession(org1App, 3);
    makeSession(org2App, 2);
    makeSession(other, 0);

    const out = execFileSync('node', [SESSION, '--projects-root', projectsRoot, '--session-root', sessionRoot], {
      encoding: 'utf8',
    });
    const ss3 = out.trim().split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((record) => record.check_id === 'SS3' && record.score === 0);

    assert.equal(ss3.length, 2, `expected 2 SS3 findings, got ${ss3.length}: ${out}`);
    assert.deepEqual(new Set(ss3.map((record) => record.project_path)), new Set([org1App, org2App]));
    assert.equal(new Set(ss3.map((record) => record.project)).size, 1, 'both findings should display the same basename');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
