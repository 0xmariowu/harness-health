#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fixerPath = path.join(__dirname, '..', 'src', 'fixer.js');

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

function makeTempProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-fixer-test-'));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(dir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  // Fixer requires a git repo
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

function runFixer(planItems, projectDir, selectedIds) {
  const planJson = JSON.stringify({ items: planItems });
  const result = spawnSync(process.execPath, [
    fixerPath,
    '--project-dir', projectDir,
    '--items', selectedIds.join(','),
  ], {
    encoding: 'utf8',
    input: planJson,
  });

  // Fixer exits 1 when any executed item has status: 'failed' (so CI
  // doesn't mistake a "no plan item found" / "file already exists" report
  // for success). Parse first, then fail only if the output itself is
  // unparseable — tests that deliberately exercise failed-status paths
  // need the parsed output.
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (_e) {
    throw new Error(`fixer exited ${result.status}, unparseable stdout: ${result.stderr}`);
  }
  const anyFailed = Array.isArray(parsed.executed)
    && parsed.executed.some((e) => e && e.status === 'failed');
  if (result.status !== 0 && !anyFailed) {
    throw new Error(`fixer exited ${result.status}: ${result.stderr}`);
  }
  return parsed;
}

// --- Auto-fix F5: remove broken references ---

runTest('F5 auto-fix removes lines with broken markdown link references', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': [
      '# My Project',
      '',
      'See [guide](./docs/guide.md) for details.',
      'Check [config](./real-file.txt) for config.',
      'Also see [missing](./nonexistent/path.md) for more.',
      '',
      '## Rules',
      '- Do not break things',
    ].join('\n'),
    'real-file.txt': 'exists',
  });

  try {
    const plan = [
      { id: 1, check_id: 'F5', fix_type: 'auto', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed.length, 1);
    assert.equal(output.executed[0].status, 'fixed');

    const content = fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf8');
    assert.ok(!content.includes('nonexistent'), 'broken markdown link should be removed');
    assert.ok(!content.includes('guide.md'), 'broken markdown link should be removed');
    assert.ok(content.includes('real-file.txt'), 'valid markdown link should remain');
    assert.ok(content.includes('Do not break things'), 'non-reference lines should remain');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('F5 auto-fix with no broken refs reports fixed with no changes', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': [
      '# My Project',
      '',
      '## Rules',
      '- Follow the code style',
    ].join('\n'),
  });

  try {
    const plan = [
      { id: 1, check_id: 'F5', fix_type: 'auto', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'fixed');
    assert.match(output.executed[0].detail, /No broken references/i);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

// --- Auto-fix I5: remove identity language ---

runTest('I5 auto-fix removes identity language lines', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': [
      '# My Project',
      '',
      'You are a helpful assistant.',
      "You're a senior developer.",
      'As an AI, follow these rules.',
      '',
      '## Rules',
      '- Write clean code',
    ].join('\n'),
  });

  try {
    const plan = [
      { id: 1, check_id: 'I5', fix_type: 'auto', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'fixed');

    const content = fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf8');
    assert.ok(!content.includes('You are a'), 'identity language should be removed');
    assert.ok(!content.includes("You're a"), 'identity language should be removed');
    assert.ok(!content.includes('As an AI'), 'identity language should be removed');
    assert.ok(content.includes('Write clean code'), 'non-identity lines should remain');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

// --- Assisted fix F1: generate CLAUDE.md ---

runTest('F1 assisted fix creates CLAUDE.md from template', () => {
  const projectDir = makeTempProject({
    'src/index.js': 'console.log("hello")',
  });

  try {
    const plan = [
      { id: 1, check_id: 'F1', fix_type: 'assisted', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'fixed');
    assert.ok(fs.existsSync(path.join(projectDir, 'CLAUDE.md')), 'CLAUDE.md should be created');

    const content = fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf8');
    assert.ok(content.length > 0, 'CLAUDE.md should have content');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('F1 assisted fix skips if CLAUDE.md already exists', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': '# Existing',
  });

  try {
    const plan = [
      { id: 1, check_id: 'F1', fix_type: 'assisted', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'failed');
    assert.match(output.executed[0].detail, /already exists/i);

    const content = fs.readFileSync(path.join(projectDir, 'CLAUDE.md'), 'utf8');
    assert.equal(content, '# Existing', 'existing file should not be modified');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

// --- Assisted fix C2: generate HANDOFF.md ---

runTest('C2 assisted fix creates HANDOFF.md', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': '# Project',
  });

  try {
    const plan = [
      { id: 1, check_id: 'C2', fix_type: 'assisted', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'fixed');
    assert.ok(fs.existsSync(path.join(projectDir, 'HANDOFF.md')), 'HANDOFF.md should be created');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('C2 assisted fix skips if HANDOFF.md already exists', () => {
  const projectDir = makeTempProject({
    'HANDOFF.md': '# Existing handoff',
  });

  try {
    const plan = [
      { id: 1, check_id: 'C2', fix_type: 'assisted', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'failed');
    assert.match(output.executed[0].detail, /already exists/i);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

// --- Guided fix ---

runTest('guided fix returns evidence and recommendation text', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': '# Project',
  });

  try {
    const plan = [
      { id: 1, check_id: 'W3', fix_type: 'guided', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'guided');
    assert.ok(output.executed[0].detail.length > 0, 'guided detail should have content');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

// --- Backup mechanism ---

runTest('auto-fix creates backup before modifying files', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': [
      '# Project',
      'You are a helpful coding assistant.',
      '## Rules',
    ].join('\n'),
  });

  try {
    const plan = [
      { id: 1, check_id: 'I5', fix_type: 'auto', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'fixed');
    assert.ok(output.backup_dir, 'backup_dir should be set');
    assert.ok(fs.existsSync(output.backup_dir), 'backup directory should exist');

    const backupFile = path.join(output.backup_dir, 'CLAUDE.md');
    assert.ok(fs.existsSync(backupFile), 'backup of CLAUDE.md should exist');

    const backupContent = fs.readFileSync(backupFile, 'utf8');
    assert.ok(backupContent.includes('You are a'), 'backup should contain original content');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

// --- Invalid item ID ---

runTest('selecting non-existent item ID reports failure', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': '# Project',
  });

  try {
    const plan = [
      { id: 1, check_id: 'F5', fix_type: 'auto', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [99]);

    assert.equal(output.executed[0].status, 'failed');
    assert.match(output.executed[0].detail, /No plan item found/i);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

// ─── S4: Edge-case tests ───────────────────────────────────────────────────

function runFixerRaw(planJson, projectDir, selectedIds, expectZeroExit = true) {
  const result = spawnSync(process.execPath, [
    fixerPath,
    '--project-dir', projectDir,
    '--items', selectedIds.join(','),
  ], {
    encoding: 'utf8',
    input: planJson,
  });
  if (expectZeroExit) {
    if (result.status !== 0) {
      throw new Error(`fixer exited ${result.status}: ${result.stderr}`);
    }
  }
  return result;
}

runTest('empty items array causes non-zero exit (no plan items)', () => {
  const projectDir = makeTempProject({ 'CLAUDE.md': '# Project' });
  try {
    const result = runFixerRaw(JSON.stringify({ items: [] }), projectDir, [1], false);
    assert.notEqual(result.status, 0, 'empty items array should cause non-zero exit');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('malformed JSON input causes non-zero exit', () => {
  const projectDir = makeTempProject({ 'CLAUDE.md': '# Project' });
  try {
    const result = runFixerRaw('{broken json}', projectDir, [1], false);
    // Malformed JSON that produces no valid items → non-zero exit
    assert.notEqual(result.status, 0, 'malformed JSON should cause non-zero exit');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('missing --project-dir causes non-zero exit', () => {
  const result = spawnSync(process.execPath, [fixerPath, '--items', '1'], {
    encoding: 'utf8',
    input: JSON.stringify({ items: [{ id: 1, check_id: 'F1', fix_type: 'assisted', project: 'test' }] }),
  });
  assert.notEqual(result.status, 0, 'missing --project-dir should cause non-zero exit');
});

runTest('non-git directory causes non-zero exit', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-fixer-nogit-'));
  try {
    // No .git directory
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# Project');
    const result = spawnSync(process.execPath, [
      fixerPath,
      '--project-dir', tempDir,
      '--items', '1',
    ], {
      encoding: 'utf8',
      input: JSON.stringify({ items: [{ id: 1, check_id: 'F1', fix_type: 'assisted', project: 'test' }] }),
    });
    assert.notEqual(result.status, 0, 'non-git directory should cause non-zero exit');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

runTest('unknown check_id with assisted fix_type reports failed with no-strategy message', () => {
  const projectDir = makeTempProject({ 'CLAUDE.md': '# Project' });
  try {
    const plan = [{ id: 1, check_id: 'Z9', fix_type: 'assisted', project: 'test', score: 0 }];
    const output = runFixer(plan, projectDir, [1]);
    assert.equal(output.executed[0].status, 'failed');
    assert.match(output.executed[0].detail, /No assisted strategy/i);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('auto fix with unknown check_id reports failed with unknown-auto-fix message', () => {
  const projectDir = makeTempProject({ 'CLAUDE.md': '# Project' });
  try {
    const plan = [{ id: 1, check_id: 'Z9', fix_type: 'auto', project: 'test', score: 0 }];
    const output = runFixer(plan, projectDir, [1]);
    assert.equal(output.executed[0].status, 'failed');
    assert.match(output.executed[0].detail, /Unknown auto fix/i);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('path traversal in project-dir is resolved to absolute path (no escape)', () => {
  const projectDir = makeTempProject({ 'CLAUDE.md': '# Project' });
  try {
    // Use a path with .. components — fixer should resolve it, not escape the dir
    const traversalPath = path.join(projectDir, '..', path.basename(projectDir));
    const plan = [{ id: 1, check_id: 'F1', fix_type: 'assisted', project: 'test', score: 0 }];
    // Should work normally — path.resolve handles the traversal
    const result = spawnSync(process.execPath, [
      fixerPath,
      '--project-dir', traversalPath,
      '--items', '1',
    ], {
      encoding: 'utf8',
      input: JSON.stringify({ items: plan }),
    });
    // Should succeed (resolves to same dir) or fail (not a git repo) — must not crash
    assert.ok(result.status !== null, 'fixer should exit cleanly even with traversal-style path');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('guided fix for check with no CLAUDE.md still returns guided status', () => {
  const projectDir = makeTempProject({});
  try {
    const plan = [{ id: 1, check_id: 'I3', fix_type: 'guided', project: 'test', score: 0 }];
    const output = runFixer(plan, projectDir, [1]);
    assert.equal(output.executed[0].status, 'guided');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('multiple items can be fixed in a single run', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': '# Project\nYou are a helpful assistant.\nAs an AI, follow rules.\n',
  });
  try {
    const plan = [
      { id: 1, check_id: 'I5', fix_type: 'auto', project: 'test', score: 0 },
      { id: 2, check_id: 'F5', fix_type: 'auto', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1, 2]);
    assert.equal(output.executed.length, 2);
    assert.equal(output.executed[0].status, 'fixed');
    assert.equal(output.executed[1].status, 'fixed');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('backup_dir is always present in output even with no files modified', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': '# Project\n## Rules\n- Follow conventions\n',
  });
  try {
    // F5 with no broken refs → fixed, but no file modified
    const plan = [{ id: 1, check_id: 'F5', fix_type: 'auto', project: 'test', score: 0 }];
    const output = runFixer(plan, projectDir, [1]);
    assert.ok('backup_dir' in output, 'backup_dir key should always be present in output');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

// --- New check fixes ---

runTest('W11 auto fix creates .github/workflows/test-required.yml', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': '# Project',
  });

  try {
    const plan = [
      { id: 1, check_id: 'W11', fix_type: 'auto', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'fixed');
    const workflowPath = path.join(projectDir, '.github', 'workflows', 'test-required.yml');
    assert.ok(fs.existsSync(workflowPath), 'test-required.yml should be created');

    const content = fs.readFileSync(workflowPath, 'utf8');
    assert.match(content, /exit 1/, 'created workflow should be blocking');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('W11 auto fix skips if test-required.yml already exists', () => {
  const existingContent = 'name: existing\n';
  const projectDir = makeTempProject({
    [path.join('.github', 'workflows', 'test-required.yml')]: existingContent,
  });

  try {
    const plan = [
      { id: 1, check_id: 'W11', fix_type: 'auto', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'failed');
    assert.match(output.executed[0].detail, /already exists/i);

    const workflowPath = path.join(projectDir, '.github', 'workflows', 'test-required.yml');
    const content = fs.readFileSync(workflowPath, 'utf8');
    assert.equal(content, existingContent, 'existing workflow should not be modified');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('H8 assisted fix creates hooks/_shared.sh when hooks directory exists', () => {
  const projectDir = makeTempProject({
    [path.join('hooks', 'pre-commit')]: '#!/usr/bin/env bash\necho "blocked"\n',
  });

  try {
    const plan = [
      { id: 1, check_id: 'H8', fix_type: 'assisted', project: 'test', score: 0 },
    ];
    const output = runFixer(plan, projectDir, [1]);

    assert.equal(output.executed[0].status, 'fixed');
    const sharedPath = path.join(projectDir, 'hooks', '_shared.sh');
    assert.ok(fs.existsSync(sharedPath), 'hooks/_shared.sh should be created');

    const content = fs.readFileSync(sharedPath, 'utf8');
    assert.match(content, /fail_with_help/, 'shared hook helper should define fail_with_help');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTest('--checks W11 resolves the matching plan item', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': '# Project',
  });

  try {
    const plan = [
      { id: 7, check_id: 'W11', fix_type: 'auto', project: 'test', score: 0 },
    ];
    const result = spawnSync(process.execPath, [
      fixerPath,
      '--project-dir', projectDir,
      '--checks', 'W11',
    ], {
      encoding: 'utf8',
      input: JSON.stringify({ items: plan }),
    });

    assert.equal(result.status, 0, result.stderr || 'fixer should exit successfully');
    const output = JSON.parse(result.stdout);
    assert.equal(output.executed.length, 1);
    assert.equal(output.executed[0].id, 7);
    assert.equal(output.executed[0].check_id, 'W11');
    assert.equal(output.executed[0].status, 'fixed');
    assert.ok(fs.existsSync(path.join(projectDir, '.github', 'workflows', 'test-required.yml')), 'W11 fix should run');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
