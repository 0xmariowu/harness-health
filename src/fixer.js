#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const EVIDENCE_FILE = path.join(__dirname, '..', 'standards', 'evidence.json');
const CLAUDE_TEMPLATE = path.join(__dirname, '..', 'standards', 'fix-templates', 'claude-md-starter.md');

const DEFAULT_ITEM_IDS = new Map([
  ['F1', 'assisted'],
  ['I5', 'auto'],
  ['F5', 'assisted'],
  ['C2', 'assisted'],
  ['W9', 'assisted'],
  ['W10', 'assisted'],
  ['W11', 'auto'],
  ['H8', 'assisted'],
]);

function usage() {
  process.stderr.write('Usage: node src/fixer.js <plan-json-file-or-stdin> --project-dir <path> (--items <id1,id2,...> | --checks <check1,check2,...>)\n');
  process.exit(0);
}

function parseArgs(argv) {
  const args = {
    planPath: null,
    projectDir: null,
    selectedItemsRaw: null,
    selectedChecksRaw: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      usage();
    }

    if (arg === '--project-dir') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--project-dir requires a path');
      }
      args.projectDir = next;
      i += 1;
      continue;
    }

    if (arg.startsWith('--project-dir=')) {
      args.projectDir = arg.slice('--project-dir='.length);
      continue;
    }

    if (arg === '--items') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--items requires a comma-separated list');
      }
      args.selectedItemsRaw = next;
      i += 1;
      continue;
    }

    if (arg.startsWith('--items=')) {
      args.selectedItemsRaw = arg.slice('--items='.length);
      continue;
    }

    if (arg === '--checks') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--checks requires a comma-separated list of check IDs');
      }
      args.selectedChecksRaw = next;
      i += 1;
      continue;
    }

    if (arg.startsWith('--checks=')) {
      args.selectedChecksRaw = arg.slice('--checks='.length);
      continue;
    }

    if (!arg.startsWith('--') && args.planPath === null) {
      args.planPath = arg;
      continue;
    }

    throw new Error(`Unknown or duplicate argument: ${arg}`);
  }

  if (!args.projectDir) {
    throw new Error('--project-dir is required');
  }

  // Accept --items OR --checks (not both required)
  if (!args.selectedItemsRaw && !args.selectedChecksRaw) {
    throw new Error('--items or --checks is required');
  }

  if (args.selectedItemsRaw) {
    args.selectedItems = args.selectedItemsRaw.split(',').map((value) => value.trim()).filter(Boolean);
    if (args.selectedItems.length === 0) {
      throw new Error('--items must contain at least one id');
    }
  }

  if (args.selectedChecksRaw) {
    args.selectedChecks = args.selectedChecksRaw.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (args.selectedChecks.length === 0) {
      throw new Error('--checks must contain at least one check ID');
    }
  }

  args.projectDir = path.resolve(args.projectDir); // nosemgrep: path-join-resolve-traversal

  if (!fs.existsSync(path.join(args.projectDir, '.git'))) { // nosemgrep: path-join-resolve-traversal
    throw new Error(`Not a git repository: ${args.projectDir}`);
  }

  return args;
}

function readPlanInput(planPath) {
  const raw = planPath
    ? fs.readFileSync(planPath, 'utf8')
    : fs.readFileSync(0, 'utf8');

  return parsePlanJson(raw);
}

function parsePlanJson(raw) {
  const text = (raw || '').trim();
  if (!text) return [];

  const parseStrict = () => {
    const parsed = JSON.parse(text);
    return normalizePlanItems(parsed);
  };

  try {
    return parseStrict();
  } catch (_err) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const parsedLines = [];
    for (const line of lines) {
      try {
        parsedLines.push(JSON.parse(line));
      } catch (_lineErr) {
        continue;
      }
    }

    return parsedLines;
  }
}

function normalizePlanItems(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) {
    return parsed.filter(Boolean).filter((item) => typeof item === 'object');
  }

  if (Array.isArray(parsed.items)) {
    return parsed.items.filter(Boolean).filter((item) => typeof item === 'object');
  }

  if (Array.isArray(parsed.plan)) {
    return parsed.plan.filter(Boolean).filter((item) => typeof item === 'object');
  }

  if (Array.isArray(parsed.checks)) {
    return parsed.checks.filter(Boolean).filter((item) => typeof item === 'object');
  }

  if (Array.isArray(parsed.fixes)) {
    return parsed.fixes.filter(Boolean).filter((item) => typeof item === 'object');
  }

  return [];
}

function toStringId(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function normalizeCheckId(value) {
  return toStringId(value) || null;
}

function inferFixType(checkId) {
  if (!checkId) return 'guided';
  return DEFAULT_ITEM_IDS.get(checkId.toUpperCase()) || 'guided';
}

function isRegularFile(filePath) {
  try {
    const lstat = fs.lstatSync(filePath);
    return lstat.isFile() && !lstat.isSymbolicLink();
  } catch (_) {
    return false;
  }
}

function resolveEntryFile(projectDir) {
  const entryCandidates = [
    'CLAUDE.md',
    'AGENTS.md',
    '.cursorrules',
    path.join('.github', 'copilot-instructions.md'),
    'GEMINI.md',
    '.windsurfrules',
    '.clinerules',
  ];
  for (const name of entryCandidates) {
    const abs = path.join(projectDir, name); // nosemgrep: path-join-resolve-traversal
    if (isRegularFile(abs)) {
      return abs;
    }
  }
  // Fallback: .cursor/rules/*.mdc (first match)
  const cursorRulesDir = path.join(projectDir, '.cursor', 'rules'); // nosemgrep: path-join-resolve-traversal
  try {
    if (fs.existsSync(cursorRulesDir) && fs.lstatSync(cursorRulesDir).isDirectory() && !fs.lstatSync(cursorRulesDir).isSymbolicLink()) {
      const entries = fs.readdirSync(cursorRulesDir).filter((n) => n.endsWith('.mdc')).sort();
      for (const e of entries) {
        const mdcPath = path.join(cursorRulesDir, e); // nosemgrep: path-join-resolve-traversal
        if (isRegularFile(mdcPath)) return mdcPath;
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

function readEvidence() {
  const raw = fs.readFileSync(EVIDENCE_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.checks || {};
}

function createBackupRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'al-backup-'));
}

function backupFile(originalPath, projectDir, backupRoot, backedSet) {
  const abs = path.resolve(originalPath); // nosemgrep: path-join-resolve-traversal
  if (backedSet.has(abs)) {
    return;
  }

  // Refuse to back up files outside the project dir (symlink protection).
  const projectAbs = path.resolve(projectDir); // nosemgrep: path-join-resolve-traversal
  if (!abs.startsWith(projectAbs + path.sep) && abs !== projectAbs) {
    throw new Error(`Refusing to back up file outside project directory: ${abs}`);
  }
  // Refuse symlinks — writing to them escapes the project.
  try {
    if (fs.lstatSync(abs).isSymbolicLink()) {
      throw new Error(`Refusing to back up symlink: ${abs}`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const rel = path.relative(projectDir, abs);
  if (rel.startsWith('..')) {
    throw new Error(`Refusing backup path traversal: ${rel}`);
  }
  const destination = path.join(backupRoot, rel); // nosemgrep: path-join-resolve-traversal
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(abs, destination);
  backedSet.add(abs);
}

function normalizeReference(raw) {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^[`'"\[(<]+/, '')
    .replace(/[`'"\]),.;:!?]+$/, '')
    .replace(/\s+/g, '')
    .split('#')[0];
}

function shouldIgnoreReferenceCandidate(candidate) {
  if (!candidate) return true;
  if (candidate.length < 2) return true;
  const lower = candidate.toLowerCase();

  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
    return true;
  }

  if (candidate.includes('{') || candidate.includes('}') || lower.startsWith('#')) {
    return true;
  }

  if (lower.startsWith('feature/') || lower.startsWith('fix/') || lower.startsWith('chore/')) {
    return true;
  }

  if (lower.includes('`') || candidate.includes('(') || candidate.includes(')')) {
    return true;
  }

  if (lower.startsWith('-') || lower.startsWith('--')) {
    return true;
  }

  if (lower === '.' || lower === '..') {
    return true;
  }

  return false;
}

function looksLikeReference(candidate) {
  if (shouldIgnoreReferenceCandidate(candidate)) return false;

  return (
    candidate.startsWith('./') ||
    candidate.startsWith('../') ||
    candidate.includes('/') ||
    /^\.[A-Za-z0-9_-]+/.test(candidate) ||
    /\.[A-Za-z0-9]+$/.test(candidate)
  );
}

function extractReferences(line) {
  const results = [];
  const linkRegex = /\[[^\]]*\]\(([^)\s]+)\)/g;

  // Only extract from markdown links [text](path)
  // Skip inline code and bare paths — too many false positives
  let match;
  while ((match = linkRegex.exec(line)) !== null) {
    const ref = normalizeReference(match[1]);
    if (looksLikeReference(ref)) {
      results.push(ref);
    }
  }

  if (results.length === 0) return [];
  return Array.from(new Set(results));
}

function referenceExists(projectDir, candidate) {
  const normalized = normalizeReference(candidate);
  if (!looksLikeReference(normalized)) return true;

  const raw = normalized;
  if (path.isAbsolute(raw)) {
    return fs.existsSync(raw);
  }

  const normalizedPath = raw.replace(/\\/g, '/');
  return (
    fs.existsSync(path.join(projectDir, normalizedPath)) || // nosemgrep: path-join-resolve-traversal
    fs.existsSync(path.join(process.cwd(), normalizedPath)) // nosemgrep: path-join-resolve-traversal
  );
}

function removeLinesWithBrokenReferences(filePath, projectDir) {
  const original = fs.readFileSync(filePath, 'utf8');
  const lines = original.split(/\r?\n/);
  const filtered = [];
  let removed = 0;
  let inFencedBlock = false;

  for (const line of lines) {
    // Track fenced code blocks (``` or ~~~)
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inFencedBlock = !inFencedBlock;
      filtered.push(line);
      continue;
    }

    // Skip lines inside fenced code blocks
    if (inFencedBlock) {
      filtered.push(line);
      continue;
    }

    // Skip indented code blocks (4+ spaces or tab)
    if (/^(\s{4,}|\t)/.test(line)) {
      filtered.push(line);
      continue;
    }

    const refs = extractReferences(line);
    const hasBroken = refs.some((ref) => {
      if (!looksLikeReference(ref)) return false;
      return !referenceExists(projectDir, ref);
    });

    if (hasBroken) {
      removed += 1;
      continue;
    }

    filtered.push(line);
  }

  if (removed === 0) {
    return {
      changed: false,
      removed,
      content: original,
    };
  }

  const trailing = original.endsWith('\n') ? '\n' : '';
  return {
    changed: true,
    removed,
    content: filtered.join('\n') + trailing,
  };
}

function removeIdentityLanguage(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const lines = original.split(/\r?\n/);
  const blocked = [
    /You are a/i,
    /You're a/i,
    /As an AI/i,
    /As a developer/i,
  ];

  const filtered = [];
  let removed = 0;

  for (const line of lines) {
    if (blocked.some((pattern) => pattern.test(line))) {
      removed += 1;
      continue;
    }
    filtered.push(line);
  }

  if (removed === 0) {
    return {
      changed: false,
      removed,
      content: original,
    };
  }

  const trailing = original.endsWith('\n') ? '\n' : '';
  return {
    changed: true,
    removed,
    content: filtered.join('\n') + trailing,
  };
}

function renderGuidedDetail(item, evidenceMap) {
  const checkId = normalizeCheckId(item.check_id || item.check || item.code || item.id);
  const normalizedCheckId = checkId ? checkId.toUpperCase() : null;
  const evidence = normalizedCheckId ? evidenceMap[normalizedCheckId] || null : null;
  const evidenceText = evidence && evidence.evidence_text ? evidence.evidence_text : 'No evidence text available.';
  const recommendation = item.recommendation || item.fix_recommendation || item.advice || 'No recommendation text provided.';
  return `Evidence: ${evidenceText} Recommendation: ${recommendation}`;
}

function getItem(item) {
  const checkId = normalizeCheckId(item.check_id || item.check || item.code) || null;
  const normalizedCheckId = checkId ? checkId.toUpperCase() : null;
  const id = toStringId(item.id ?? item.item_id ?? item.plan_id ?? item.index);
  const fixType = toStringId(item.fix_type || item.fixType || item.action_type) || inferFixType(normalizedCheckId);

  return {
    id: id ? Number.isNaN(Number(id)) ? id : Number(id) : null,
    check_id: normalizedCheckId,
    fixType: fixType ? fixType.toLowerCase() : 'guided',
    item,
  };
}

function executeAssistedF1(projectDir, projectName) {
  const target = path.join(projectDir, 'CLAUDE.md'); // nosemgrep: path-join-resolve-traversal

  // Use lstatSync to detect both existing files and symlinks (even dangling ones).
  // existsSync() returns false for dangling symlinks, which would allow writeFileSync
  // to follow the symlink and write outside the project directory.
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      return {
        status: 'failed',
        detail: 'Skipped: CLAUDE.md is a symlink — refusing to write.',
      };
    }
    // File exists (regular file or directory)
    return {
      status: 'failed',
      detail: 'Skipped: CLAUDE.md already exists.',
    };
  } catch (_) {
    // ENOENT — path does not exist, safe to create
  }

  const template = fs.readFileSync(CLAUDE_TEMPLATE, 'utf8').replace(/\{Project Name\}/g, projectName);
  // flag 'wx' = O_EXCL|O_CREAT: fails atomically if file exists, and on POSIX
  // refuses to follow symlinks at open-time (defense-in-depth with lstat check above).
  try {
    fs.writeFileSync(target, template, { flag: 'wx' });
  } catch (err) {
    return {
      status: 'failed',
      detail: `Failed to create CLAUDE.md: ${err.message}`,
    };
  }
  return {
    status: 'fixed',
    detail: 'Created CLAUDE.md from claude-md-starter template.',
  };
}

function executeAssistedC2(projectDir, projectName) {
  const target = path.join(projectDir, 'HANDOFF.md'); // nosemgrep: path-join-resolve-traversal

  // Use lstatSync to detect both existing files and symlinks (even dangling ones).
  // existsSync() returns false for dangling symlinks, which would allow writeFileSync
  // to follow the symlink and write outside the project directory.
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      return {
        status: 'failed',
        detail: 'Skipped: HANDOFF.md is a symlink — refusing to write.',
      };
    }
    // File exists (regular file or directory)
    return {
      status: 'failed',
      detail: 'Skipped: HANDOFF.md already exists.',
    };
  } catch (_) {
    // ENOENT — path does not exist, safe to create
  }

  const date = new Date().toISOString().slice(0, 10);
  const content = [`# Hand-off: ${projectName}`, `Date: ${date}`, '', 'Status: in-progress', ''].join('\n');

  // flag 'wx' = O_EXCL|O_CREAT: fails atomically if file exists, and on POSIX
  // refuses to follow symlinks at open-time (defense-in-depth with lstat check above).
  try {
    fs.writeFileSync(target, content, { flag: 'wx' });
  } catch (err) {
    return {
      status: 'failed',
      detail: `Failed to create HANDOFF.md: ${err.message}`,
    };
  }
  return {
    status: 'fixed',
    detail: `Created HANDOFF.md with date ${date}.`,
  };
}

function executeAutoW11(projectDir) {
  const templatePath = path.join(__dirname, '..', 'templates', 'ci', 'test-required.yml');
  const targetDir = path.join(projectDir, '.github', 'workflows'); // nosemgrep: path-join-resolve-traversal
  const targetPath = path.join(targetDir, 'test-required.yml'); // nosemgrep: path-join-resolve-traversal

  if (!fs.existsSync(templatePath)) {
    return { status: 'failed', detail: 'Template not found: templates/ci/test-required.yml' };
  }

  // Guard against intermediate directory symlink escape before mkdirSync follows it.
  // Use realpathSync for projectDir too to handle OS-level symlinks (e.g. /tmp → /private/tmp on macOS).
  const resolvedProject = fs.realpathSync(projectDir); // nosemgrep: path-join-resolve-traversal
  const resolvedTargetDir = fs.existsSync(targetDir) // nosemgrep: path-join-resolve-traversal
    ? fs.realpathSync(targetDir)
    : path.resolve(resolvedProject, '.github', 'workflows');
  if (!resolvedTargetDir.startsWith(resolvedProject + path.sep)) {
    return { status: 'failed', detail: 'Refusing to write outside project directory (symlink detected).' };
  }

  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      return { status: 'failed', detail: 'Skipped: .github/workflows/test-required.yml is a symlink — refusing to write.' };
    }
    return { status: 'failed', detail: 'Skipped: .github/workflows/test-required.yml already exists.' };
  } catch (_) { /* ENOENT — safe to create */ }

  fs.mkdirSync(targetDir, { recursive: true });
  const template = fs.readFileSync(templatePath, 'utf8');
  try {
    fs.writeFileSync(targetPath, template, { flag: 'wx' });
  } catch (err) {
    return { status: 'failed', detail: `Failed to create test-required.yml: ${err.message}` };
  }
  return { status: 'fixed', detail: 'Created .github/workflows/test-required.yml from template.' };
}

function executeAssistedH8(projectDir) {
  const templatePath = path.join(__dirname, '..', 'templates', 'hooks', '_shared.sh');
  const hooksDir = path.join(projectDir, 'hooks'); // nosemgrep: path-join-resolve-traversal
  const targetPath = path.join(hooksDir, '_shared.sh'); // nosemgrep: path-join-resolve-traversal

  if (!fs.existsSync(templatePath)) {
    return { status: 'failed', detail: 'Template not found: templates/hooks/_shared.sh' };
  }

  if (!fs.existsSync(hooksDir)) {
    return { status: 'guided', detail: 'No hooks/ directory found. Create hooks/ directory first, then run: cp templates/hooks/_shared.sh hooks/_shared.sh && source hooks/_shared.sh in your hook files.' };
  }

  // Guard against hooksDir being a symlink pointing outside project.
  // Use realpathSync for projectDir too to handle OS-level symlinks (e.g. /tmp → /private/tmp on macOS).
  const resolvedProject = fs.realpathSync(projectDir); // nosemgrep: path-join-resolve-traversal
  const resolvedHooksDir = fs.realpathSync(hooksDir); // nosemgrep: path-join-resolve-traversal
  if (!resolvedHooksDir.startsWith(resolvedProject + path.sep)) {
    return { status: 'failed', detail: 'Refusing to write outside project directory (symlink detected in hooks/).' };
  }

  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      return { status: 'failed', detail: 'Skipped: hooks/_shared.sh is a symlink — refusing to write.' };
    }
    return { status: 'failed', detail: 'Skipped: hooks/_shared.sh already exists.' };
  } catch (_) { /* ENOENT — safe to create */ }

  const template = fs.readFileSync(templatePath, 'utf8');
  try {
    fs.writeFileSync(targetPath, template, { flag: 'wx' });
  } catch (err) {
    return { status: 'failed', detail: `Failed to create hooks/_shared.sh: ${err.message}` };
  }
  return { status: 'fixed', detail: 'Created hooks/_shared.sh with fail_with_help() function. Add: source "$(dirname "$0")/_shared.sh" to your hook files.' };
}

function executeAutoFix(checkId, projectDir, filePath, backupRoot, backedSet) {
  if (checkId === 'W11') {
    return executeAutoW11(projectDir);
  }

  if (!filePath) {
    return {
      status: 'failed',
      detail: 'No entry file found to apply fix.',
    };
  }
  // Refuse to write to symlinks — this prevents arbitrary file overwrite
  // via an attacker-placed symlinked entry file.
  if (!isRegularFile(filePath)) {
    return {
      status: 'failed',
      detail: `Refusing to modify non-regular file or symlink: ${path.basename(filePath)}.`,
    };
  }

  if (checkId === 'F5') {
    const result = removeLinesWithBrokenReferences(filePath, projectDir);
    if (!result.changed) {
      return {
        status: 'fixed',
        detail: 'No broken references found.',
      };
    }
    backupFile(filePath, projectDir, backupRoot, backedSet);
    fs.writeFileSync(filePath, result.content);
    return {
      status: 'fixed',
      detail: `Removed ${result.removed} broken references from ${path.basename(filePath)}.`,
    };
  }

  if (checkId === 'I5') {
    const result = removeIdentityLanguage(filePath);
    if (!result.changed) {
      return {
        status: 'fixed',
        detail: 'No identity language lines found.',
      };
    }
    backupFile(filePath, projectDir, backupRoot, backedSet);
    fs.writeFileSync(filePath, result.content);
    return {
      status: 'fixed',
      detail: `Removed ${result.removed} identity language lines from ${path.basename(filePath)}.`,
    };
  }

  return {
    status: 'failed',
    detail: `Unknown auto fix for ${checkId}.`,
  };
}

function buildExecutedRecord(item, status, detail) {
  return {
    id: item.id,
    check_id: item.check_id,
    status,
    detail,
  };
}

function run() {
  const evidenceMap = readEvidence();

  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  const projectDir = args.projectDir;
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    process.stderr.write('Project directory does not exist or is not a directory.\n');
    process.exit(1);
  }

  const plan = readPlanInput(args.planPath);
  if (!Array.isArray(plan) || plan.length === 0) {
    process.stderr.write('No plan items found.\n');
    process.exit(1);
  }

  const backupDir = createBackupRoot();
  const backedSet = new Set();
  const executed = [];
  const itemsById = new Map();

  for (const rawItem of plan) {
    const parsed = getItem(rawItem);
    const key = parsed.id !== null ? String(parsed.id) : null;
    if (key && !itemsById.has(key)) {
      itemsById.set(key, parsed);
    }
  }

  // Resolve --checks (check IDs) to selectedItems (numeric ids)
  if (args.selectedChecks && args.selectedChecks.length > 0) {
    const resolvedIds = [];
    for (const checkId of args.selectedChecks) {
      let found = false;
      for (const [key, parsed] of itemsById.entries()) {
        if (parsed.check_id === checkId) {
          resolvedIds.push(key);
          found = true;
          break;
        }
      }
      if (!found) {
        executed.push({ id: checkId, check_id: checkId, status: 'failed', detail: `No plan item found for check ID: ${checkId}. Run 'agentlint check' first to generate a plan.` });
      }
    }
    if (!args.selectedItems) args.selectedItems = [];
    args.selectedItems = args.selectedItems.concat(resolvedIds);
  }

  for (const selectedId of args.selectedItems) {
    const selected = itemsById.get(selectedId);
    if (!selected) {
      executed.push({
        id: Number.isNaN(Number(selectedId)) ? selectedId : Number(selectedId),
        check_id: 'unknown',
        status: 'failed',
        detail: `No plan item found for selected id: ${selectedId}.`,
      });
      continue;
    }

    const projectName = path.basename(projectDir);
    const entryFile = resolveEntryFile(projectDir);

    if (selected.fixType === 'auto') {
      const result = executeAutoFix(selected.check_id, projectDir, entryFile, backupDir, backedSet);
      executed.push(buildExecutedRecord(selected, result.status, result.detail));
      continue;
    }

    if (selected.fixType === 'assisted') {
      if (selected.check_id === 'F1') {
        const result = executeAssistedF1(projectDir, projectName);
        executed.push(buildExecutedRecord(selected, result.status, result.detail));
        continue;
      }

      if (selected.check_id === 'C2') {
        const result = executeAssistedC2(projectDir, projectName);
        executed.push(buildExecutedRecord(selected, result.status, result.detail));
        continue;
      }

      if (selected.check_id === 'H8') {
        const result = executeAssistedH8(projectDir);
        executed.push(buildExecutedRecord(selected, result.status, result.detail));
        continue;
      }

      if (selected.check_id === 'F5' || selected.check_id === 'I5') {
        const result = executeAutoFix(selected.check_id, projectDir, entryFile, backupDir, backedSet);
        executed.push(buildExecutedRecord(selected, result.status, result.detail));
        continue;
      }

      executed.push(buildExecutedRecord(selected, 'failed', `No assisted strategy for ${selected.check_id}.`));
      continue;
    }

    const detail = renderGuidedDetail(selected.item, evidenceMap);
    executed.push(buildExecutedRecord(selected, 'guided', detail));
  }

  process.stdout.write(JSON.stringify({ executed, backup_dir: backupDir }, null, 2) + '\n');
}

run();
