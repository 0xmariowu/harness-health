#!/usr/bin/env node
'use strict';

// A3-S4: Fixer path traversal audit.
// Verifies fixer.js refuses to operate on --project-dir values that escape the
// intended project directory (non-git dirs, ../ traversal, symlinks outside scope).
// Does NOT require AL_CORPUS_DIR — uses self-contained fixtures.

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const assert = require('node:assert/strict');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const FIXER = path.join(ROOT, 'src', 'fixer.js');
const FIXTURES = path.join(__dirname, 'traversal-fixtures');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'al-traversal-test-'));

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

// Create a legit git repo that fixer CAN operate on (for baseline)
function makeLegitRepo(name) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execSync(`git -C "${dir}" init -q && git -C "${dir}" add -A && git -C "${dir}" commit -q -m init`, {
    env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@test', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@test' },
  });
  return dir;
}

// Run fixer with given args. Returns { exitCode, stdout, stderr }.
function runFixer(planFile, extraArgs) {
  const result = spawnSync('node', [FIXER, planFile, ...extraArgs], {
    encoding: 'utf8',
    timeout: 15000,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

const planFile = path.join(FIXTURES, 'relative-traversal-plan.json');
const dotdotPlan = path.join(FIXTURES, 'dotdot-plan.json');

// ── Test 1: Non-git directory is rejected ──
const nonGitDir = path.join(TMP, 'not-a-git-repo');
fs.mkdirSync(nonGitDir, { recursive: true });
fs.writeFileSync(path.join(nonGitDir, 'CLAUDE.md'), '# test\n');

test('Traversal: non-git directory rejected', () => {
  const r = runFixer(planFile, ['--project-dir', nonGitDir, '--items', 'F1']);
  assert.notEqual(r.exitCode, 0, `Expected non-zero exit, got 0. stderr: ${r.stderr}`);
  assert.ok(
    r.stderr.includes('Not a git repository') || r.stderr.includes('git'),
    `Expected "Not a git repository" in stderr, got: ${r.stderr}`
  );
});

// ── Test 2: ../ traversal in --project-dir is resolved and then rejected ──
// Create a real git repo, then try to escape via ../../tmp/escape path
const legitRepo = makeLegitRepo('legit-repo');
// Construct a traversal path: <legitRepo>/subdir/../../<nonGitDir>
const subdir = path.join(legitRepo, 'subdir');
fs.mkdirSync(subdir, { recursive: true });
const traversalPath = path.join(subdir, '..', '..', path.basename(nonGitDir));

test('Traversal: ../ path resolved to non-git dir is rejected', () => {
  const r = runFixer(planFile, ['--project-dir', traversalPath, '--items', 'F1']);
  assert.notEqual(r.exitCode, 0, `Expected non-zero exit, got 0. stderr: ${r.stderr}`);
  assert.ok(
    r.stderr.includes('Not a git repository') || r.stderr.includes('git'),
    `Expected git rejection in stderr, got: ${r.stderr}`
  );
});

// ── Test 3: Absolute path that has no .git is rejected ──
const absoluteEscape = '/tmp';

test('Traversal: /tmp (no .git) is rejected', () => {
  const r = runFixer(planFile, ['--project-dir', absoluteEscape, '--items', 'F1']);
  assert.notEqual(r.exitCode, 0, `Expected non-zero exit for /tmp, got 0. stderr: ${r.stderr}`);
});

// ── Test 4: Symlink pointing outside project dir is resolved and rejected ──
const symlinkTarget = path.join(TMP, 'symlink-escape');
const symlinkSrc = path.join(legitRepo, 'escape-link');
try {
  fs.symlinkSync(nonGitDir, symlinkSrc);
  test('Traversal: symlink pointing to non-git dir is rejected', () => {
    const r = runFixer(planFile, ['--project-dir', symlinkSrc, '--items', 'F1']);
    assert.notEqual(r.exitCode, 0, `Expected non-zero exit for symlink escape, got 0. stderr: ${r.stderr}`);
  });
} catch (e) {
  // symlink creation may fail in some sandboxes; mark as skip
  total++;
  process.stdout.write(`SKIP: Traversal: symlink pointing to non-git dir is rejected (symlink creation failed: ${e.message})\n`);
}

// ── Test 5: Missing --project-dir argument is rejected ──
test('Traversal: missing --project-dir is rejected', () => {
  const r = runFixer(planFile, ['--items', 'F1']);
  assert.notEqual(r.exitCode, 0, `Expected non-zero exit for missing --project-dir, got 0. stderr: ${r.stderr}`);
  assert.ok(
    r.stderr.includes('--project-dir') || r.stderr.includes('required') || r.stderr.includes('Usage'),
    `Expected usage/error in stderr, got: ${r.stderr}`
  );
});

// ── Test 6: Legit git repo IS accepted (control — proves fixer works when valid) ──
test('Traversal: legit git repo is accepted (control)', () => {
  const r = runFixer(dotdotPlan, ['--project-dir', legitRepo, '--items', 'F1']);
  // fixer should exit 0 for a real git repo (may apply fix or skip if nothing to do)
  assert.equal(r.exitCode, 0, `Expected exit 0 for legit repo, got ${r.exitCode}. stderr: ${r.stderr}`);
});

// ── Test 7: Writes are confined to project dir (no writes outside legitRepo) ──
test('Traversal: fixer does not write outside project dir', () => {
  // Snapshot files outside the repo before running
  const filesOutsideBefore = fs.readdirSync(TMP).sort();
  // Run fixer on the legit repo
  runFixer(dotdotPlan, ['--project-dir', legitRepo, '--items', 'F1']);
  // Check nothing new appeared in TMP (outside legitRepo)
  const filesOutsideAfter = fs.readdirSync(TMP).sort();
  assert.deepEqual(filesOutsideBefore, filesOutsideAfter, `New files appeared outside project dir: ${filesOutsideAfter.filter(f => !filesOutsideBefore.includes(f)).join(', ')}`);
});

// Cleanup
fs.rmSync(TMP, { recursive: true, force: true });

// Summary
process.stdout.write(`\n${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
