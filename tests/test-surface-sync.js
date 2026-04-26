#!/usr/bin/env node
'use strict';

// Surface sync drift guard. Ensures that every user-facing surface
// (docs, README, action.yml, release-metadata.json) stays consistent
// with the registry in standards/evidence.json and standards/weights.json.
//
// Fails CI on drift so adding a new check without updating docs shows
// up before merge, not after users complain.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const POSTINSTALL_PATH = path.join(ROOT, 'postinstall.js');
const POSTINSTALL_USAGE_BANNER = 'Usage: npx agentlint-ai';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const EVIDENCE = readJson('standards/evidence.json');
const WEIGHTS = readJson('standards/weights.json');
const CHECK_IDS = Object.keys(EVIDENCE.checks);

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
    process.stdout.write(`${error.message}\n`);
  }
}

// Build a regex that matches a check id as a whole word (F1 must not match F11).
function checkIdRegex(id) {
  return new RegExp(`\\b${id}\\b`);
}

function latestChangelogVersionSection(changelog) {
  const headingRegex = /^## v([0-9.]+).*$/gm;
  const first = headingRegex.exec(changelog);
  assert.ok(first, 'CHANGELOG.md has no version heading matching /^## v([0-9.]+).*$/');

  const second = headingRegex.exec(changelog);
  return changelog.slice(first.index, second ? second.index : changelog.length);
}

function postinstallAcceptedArgs(postinstall) {
  const guardLine = postinstall
    .split('\n')
    .find((line) => (
      /if\s*\(\s*args\.length\s*>\s*0\b/.test(line)
      && /args\[0\]\s*!==\s*"/.test(line)
    ));

  if (!guardLine) {
    return null;
  }

  const args = [...guardLine.matchAll(/args\[0\]\s*!==\s*"([a-z][a-z0-9-]*)"/g)]
    .map((match) => match[1]);
  if (args.length === 0) {
    return null;
  }
  return new Set(args);
}

function spawnPostinstallArg(arg) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'al-test-'));
  try {
    return spawnSync(process.execPath, [POSTINSTALL_PATH, arg], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        npm_lifecycle_event: '',
        PATH: '',
        Path: '',
      },
      timeout: 2000,
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function assertPostinstallSpawnCompleted(result, arg) {
  assert.ok(
    !result.error,
    `postinstall subprocess failed for "${arg}": ${result.error && result.error.message}`,
  );
}

// ─── release-metadata.json reflects current evidence count ────────────────
runTest('release-metadata.json check_count matches evidence.json', () => {
  const meta = readJson('release-metadata.json');
  assert.equal(
    meta.check_count,
    CHECK_IDS.length,
    `release-metadata.json check_count=${meta.check_count}, but evidence.json has ${CHECK_IDS.length} checks. Run scripts/generate-metadata.sh.`,
  );
});

// ─── docs/content/checks.md covers every evidence ID ──────────────────────
runTest('docs/content/checks.md mentions every check id from evidence.json', () => {
  const content = read('docs/content/checks.md');
  const missing = CHECK_IDS.filter((id) => !checkIdRegex(id).test(content));
  assert.equal(
    missing.length, 0,
    `these check IDs are not documented in docs/content/checks.md: ${missing.join(', ')}`,
  );
});

// ─── docs/content/scoring.md weight table covers every weight id ──────────
runTest('docs/content/scoring.md weight table mentions every weighted check', () => {
  const content = read('docs/content/scoring.md');
  // Only enforce for checks that have a weight (every check in weights.json's
  // check_weights map). Unweighted checks — if any — don't need to be in the
  // weight table.
  const weightIds = Object.keys(WEIGHTS.check_weights || {});
  const missing = weightIds.filter((id) => !checkIdRegex(id).test(content));
  assert.equal(
    missing.length, 0,
    `these check IDs are in weights.json but missing from docs/content/scoring.md: ${missing.join(', ')}`,
  );
});

// ─── README.md and README_CN.md mention every check id ────────────────────
for (const readmeFile of ['README.md', 'README_CN.md']) {
  runTest(`${readmeFile} mentions every check id from evidence.json`, () => {
    const content = read(readmeFile);
    const missing = CHECK_IDS.filter((id) => !checkIdRegex(id).test(content));
    assert.equal(
      missing.length, 0,
      `these check IDs are not documented in ${readmeFile}: ${missing.join(', ')}`,
    );
  });
}

// ─── live docs use 51/7/58 language consistently ─────────────────────────
// NOTE: docs/content/changelog.md intentionally excluded — historical entries
// may reference older counts.
runTest('live docs do not mention stale "42 checks" count', () => {
  const liveDocs = [
    'README.md',
    'README_CN.md',
    'docs/content/intro.md',
    'docs/content/scoring.md',
    'docs/content/checks.md',
    'action.yml',
    'commands/al.md',
  ];
  const stale = [];
  for (const file of liveDocs) {
    const content = read(file);
    if (/42\s+(evidence-backed\s+)?checks/.test(content)) {
      stale.push(`${file} mentions "42 checks"`);
    }
    if (/\bFirst 4\b/.test(content)) {
      stale.push(`${file} mentions stale "First 4" default`);
    }
    if (/Deep[^a-zA-Z\n]{0,40}0\s*\/\s*10/i.test(content)) {
      stale.push(`${file} shows Deep 0/10 example (should be n/a)`);
    }
    if (/Session[^a-zA-Z\n]{0,40}0\s*\/\s*10/i.test(content)) {
      stale.push(`${file} shows Session 0/10 example (should be n/a)`);
    }
  }
  assert.equal(stale.length, 0, `stale surface text found:\n  ${stale.join('\n  ')}`);
});

// ─── CHANGELOG npx commands stay accepted by postinstall.js ───────────────
runTest('CHANGELOG command surface matches postinstall accepted args', () => {
  const section = latestChangelogVersionSection(read('CHANGELOG.md'));
  const changelogCommands = [...new Set(
    [...section.matchAll(/npx agentlint-ai ([a-z][a-z0-9-]*)\b/g)]
      .map((match) => match[1]),
  )];

  if (changelogCommands.length === 0) {
    process.stdout.write('OK: latest CHANGELOG section has no npx agentlint-ai command tokens\n');
  } else {
    const acceptedArgs = postinstallAcceptedArgs(read('postinstall.js'));
    if (acceptedArgs) {
      const missing = changelogCommands.filter((command) => !acceptedArgs.has(command));
      assert.equal(
        missing.length, 0,
        [
          'latest CHANGELOG section mentions npx agentlint-ai commands rejected by postinstall.js:',
          `  missing: ${missing.join(', ')}`,
          `  accepted: ${[...acceptedArgs].join(', ')}`,
        ].join('\n'),
      );
    } else {
      process.stdout.write('OK: static postinstall accepted-args pre-check skipped; falling back to subprocess contract\n');
    }

    for (const command of changelogCommands) {
      const result = spawnPostinstallArg(command);
      assertPostinstallSpawnCompleted(result, command);
      assert.ok(
        !result.stderr.includes(POSTINSTALL_USAGE_BANNER),
        [
          `postinstall.js rejected CHANGELOG command token "${command}" with the Usage banner`,
          `stderr:\n${result.stderr || '<empty>'}`,
        ].join('\n'),
      );
    }
  }

  const unknownCommand = 'definitely-not-a-real-command';
  const unknownResult = spawnPostinstallArg(unknownCommand);
  assertPostinstallSpawnCompleted(unknownResult, unknownCommand);
  assert.ok(
    unknownResult.stderr.includes(POSTINSTALL_USAGE_BANNER),
    [
      `postinstall.js accepted unknown command token "${unknownCommand}"`,
      `stderr:\n${unknownResult.stderr || '<empty>'}`,
    ].join('\n'),
  );
});

// ─── action.yml exposes 6 core dims, not deep/session ─────────────────────
runTest('action.yml exposes exactly the 6 core dimension outputs', () => {
  const content = read('action.yml');
  const expectCore = ['findability', 'instructions', 'workability', 'continuity', 'safety', 'harness'];
  for (const dim of expectCore) {
    assert.ok(
      new RegExp(`^\\s+${dim}:`, 'm').test(content),
      `action.yml is missing output '${dim}'`,
    );
  }
  // Must NOT expose deep/session as outputs (they can't run in CI)
  for (const dim of ['deep', 'session']) {
    assert.ok(
      !new RegExp(`^\\s+${dim}:\\s*$`, 'm').test(content),
      `action.yml exposes extended dimension '${dim}' — should not (CI can't run it)`,
    );
  }
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
