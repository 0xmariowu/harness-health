#!/usr/bin/env node
// P0-8 regression test: a session named after a long, unrelated project must
// NOT be absorbed into a short-named project's findings via substring
// matching, and `--include-raw-snippets` must NOT leak unmatched-session
// prompt fragments into the wrong project's report.
//
// Fixture shape:
//   projects-root/app/CLAUDE.md         -- catalog entry "app"
//   sessions-root/-tmp-other-application-app/sess.jsonl
//                                       -- session whose encoded path
//                                          decodes to /tmp/other-application/app
// Pre-fix: substring `sessionKey.includes("app")` claimed this for "app".
// Post-fix: the decoded path /tmp/other-application/app does not match the
// catalog entry under projects-root/app, so the session is dropped by
// default and never contributes findings.
'use strict';

const assert = require('node:assert');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ANALYZER = path.join(ROOT, 'src', 'session-analyzer.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'al-cross-project-test-'));
process.on('exit', () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
});

const projectsRoot = path.join(tmp, 'projects');
const sessionsRoot = path.join(tmp, 'sessions');
const realApp = path.join(projectsRoot, 'app');
fs.mkdirSync(realApp, { recursive: true });
fs.writeFileSync(
  path.join(realApp, 'CLAUDE.md'),
  '# App\n\nDon\'t commit secrets without review.\n',
);

// Encoded session-project name that, pre-fix, would substring-match "app".
const encodedUnrelated = '-tmp-other-application-app';
const sessionDir = path.join(sessionsRoot, encodedUnrelated);
fs.mkdirSync(sessionDir, { recursive: true });
const sessionFile = path.join(sessionDir, 'sess.jsonl');
const lines = [
  // user prompt with a distinctive sentinel that, if leaked, would prove
  // the unmatched session was absorbed into the report.
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'CROSS_PROJECT_LEAK_SENTINEL_XYZ please commit my secret token' },
  }),
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'CROSS_PROJECT_LEAK_SENTINEL_XYZ please commit my secret token' },
  }),
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'CROSS_PROJECT_LEAK_SENTINEL_XYZ please commit my secret token' },
  }),
];
fs.writeFileSync(sessionFile, lines.join('\n') + '\n');

function runAnalyzer(extraArgs) {
  const args = [
    ANALYZER,
    '--projects-root', projectsRoot,
    '--session-root', sessionsRoot,
    '--include-global',
    ...extraArgs,
  ];
  const res = cp.spawnSync('node', args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`session-analyzer exited ${res.status}\nstderr: ${res.stderr}`);
  }
  const records = res.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    })
    .filter(Boolean);
  return { records, stdout: res.stdout, stderr: res.stderr };
}

function findApp(records) {
  return records.filter((r) => r.project === 'app');
}

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log('  PASS:', label);
  } catch (e) {
    failures += 1;
    console.error('  FAIL:', label);
    console.error('    ', e.message);
  }
}

console.log('case 1: default — unmatched session is dropped, "app" gets no findings from it');
{
  const { records, stdout } = runAnalyzer([]);
  check('sentinel text never appears in default output', () => {
    assert.strictEqual(stdout.includes('CROSS_PROJECT_LEAK_SENTINEL_XYZ'), false,
      'leak sentinel should be absent without --include-unmatched + --include-raw-snippets');
  });
  check('no SS1/SS4 records claim project "app" from the unmatched session', () => {
    const appRecs = findApp(records);
    // app may legitimately produce sentinel "ran, no issue" SS records, but
    // those are sentinels with score 100 and a known sentinel detail string.
    const realFindings = appRecs.filter((r) => r.score !== 100);
    assert.deepStrictEqual(realFindings, [],
      `unmatched session leaked into "app": ${JSON.stringify(realFindings)}`);
  });
}

console.log('case 2: --include-raw-snippets alone — unmatched still dropped');
{
  const { stdout } = runAnalyzer(['--include-raw-snippets']);
  check('sentinel still absent when only raw flag is set', () => {
    assert.strictEqual(stdout.includes('CROSS_PROJECT_LEAK_SENTINEL_XYZ'), false,
      'unmatched session must remain dropped — --include-raw-snippets alone does not opt into unmatched');
  });
}

console.log('case 3: --include-unmatched + --include-raw-snippets — sentinel STILL never leaks');
{
  const { stdout } = runAnalyzer(['--include-unmatched', '--include-raw-snippets']);
  check('raw sentinel never appears even with both flags combined', () => {
    assert.strictEqual(stdout.includes('CROSS_PROJECT_LEAK_SENTINEL_XYZ'), false,
      'unmatched session prompt must stay redacted regardless of --include-raw-snippets');
  });
}

if (failures === 0) {
  console.log('OK: cross-project session matching is strict (no substring leak)');
  process.exit(0);
}
console.error(`FAIL: ${failures} cross-project assertion(s) failed`);
process.exit(1);
