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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-fixer-test-'));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(dir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
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

  if (result.status !== 0) {
    throw new Error(`fixer exited ${result.status}: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

// --- Auto-fix F5: remove broken references ---

runTest('F5 auto-fix removes lines with broken references', () => {
  const projectDir = makeTempProject({
    'CLAUDE.md': [
      '# My Project',
      '',
      'See [guide](./docs/guide.md) for details.',
      'Check `./real-file.txt` for config.',
      'Also see `./nonexistent/path.md` for more.',
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
    assert.ok(!content.includes('nonexistent'), 'broken reference line should be removed');
    assert.ok(!content.includes('guide.md'), 'broken reference line should be removed');
    assert.ok(content.includes('real-file.txt'), 'valid reference should remain');
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

process.stdout.write(`${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
