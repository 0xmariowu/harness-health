#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const evidencePath = path.join(__dirname, '..', 'standards', 'evidence.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeArtifactUri(filePath) {
  const normalized = String(filePath || '.')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
  return encodeURI(normalized || '.');
}

function isPathLikeString(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || /^[a-z]+:\/\//i.test(trimmed)) return false;
  return (
    trimmed === '.' ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('~/') ||
    trimmed.startsWith('/') ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    /^\.?[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+$/.test(trimmed)
  );
}

function findMeasuredPath(value, preferredKeys = []) {
  if (typeof value === 'string') {
    return isPathLikeString(value) ? value.trim() : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMeasuredPath(item, preferredKeys);
      if (found) return found;
    }
    return null;
  }

  if (!isObject(value)) return null;

  for (const key of preferredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const found = findMeasuredPath(value[key], preferredKeys);
    if (found) return found;
  }

  for (const [key, item] of Object.entries(value)) {
    if (preferredKeys.includes(key)) continue;
    if (!/(?:^|_)(entry|target|broken|index|settings|workflow|script|config|artifact|file|path|reference)s?$/i.test(key)) {
      continue;
    }
    const found = findMeasuredPath(item, preferredKeys);
    if (found) return found;
  }

  for (const item of Object.values(value)) {
    const found = findMeasuredPath(item, preferredKeys);
    if (found) return found;
  }

  return null;
}

function findMeasuredPathByExtension(value, extensions) {
  const pathMatch = findMeasuredPath(value);
  if (pathMatch && extensions.some((ext) => pathMatch.toLowerCase().endsWith(ext))) {
    return pathMatch;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMeasuredPathByExtension(item, extensions);
      if (found) return found;
    }
    return null;
  }

  if (!isObject(value)) return null;

  for (const item of Object.values(value)) {
    const found = findMeasuredPathByExtension(item, extensions);
    if (found) return found;
  }

  return null;
}

function findProjectEntryFile(scores, project) {
  if (!project || !isObject(scores) || !isObject(scores.by_project)) return null;
  const projectScores = scores.by_project[project];
  if (!isObject(projectScores)) return null;
  if (typeof projectScores.entry_file === 'string' && projectScores.entry_file.trim()) {
    return projectScores.entry_file.trim();
  }

  for (const dim of Object.values(projectScores)) {
    if (!isObject(dim) || !Array.isArray(dim.checks)) continue;
    for (const check of dim.checks) {
      if (!check || check.check_id !== 'F1') continue;
      const entryFile = check.measured_value && check.measured_value.entry_file;
      if (typeof entryFile === 'string' && entryFile.trim()) {
        return entryFile.trim();
      }
    }
  }

  return null;
}

// Keep this fallback chain in sync with src/reporter.js resolveFilePath().
function resolveFilePath(check, scores, project) {
  if (check && isObject(check.measured_value) && typeof check.measured_value.entry_file === 'string' && check.measured_value.entry_file.trim()) {
    return normalizeArtifactUri(check.measured_value.entry_file);
  }

  const measuredPath = findMeasuredPath(check ? check.measured_value : null, [
    'broken_reference',
    'target_file',
    'file',
    'path',
    'index_files',
    'script_path',
    'settings_path',
  ]);
  if (measuredPath) {
    return normalizeArtifactUri(measuredPath);
  }

  if (check && typeof check.check_id === 'string' && /^[FIC]/i.test(check.check_id)) {
    return normalizeArtifactUri(findProjectEntryFile(scores, project) || 'CLAUDE.md');
  }

  if (check && typeof check.check_id === 'string' && /^H/i.test(check.check_id)) {
    const configPath = findMeasuredPathByExtension(check.measured_value, ['.json', '.yaml', '.yml']);
    return normalizeArtifactUri(configPath || '.claude/settings.json');
  }

  return normalizeArtifactUri('.');
}

function flattenChecks(scores) {
  const items = [];

  for (const [project, projectDims] of Object.entries(scores.by_project || {})) {
    for (const [dimension, dim] of Object.entries(projectDims || {})) {
      if (!isObject(dim) || !Array.isArray(dim.checks)) continue;
      for (const check of dim.checks) {
        items.push({ project, dimension, check });
      }
    }
  }

  if (!items.length && isObject(scores.dimensions)) {
    for (const [dimension, dim] of Object.entries(scores.dimensions)) {
      if (!isObject(dim) || !Array.isArray(dim.checks)) continue;
      for (const check of dim.checks) {
        items.push({ project: 'unknown', dimension, check });
      }
    }
  }

  return items;
}

function getEvidenceChecks() {
  try {
    const evidence = readJson(evidencePath);
    return isObject(evidence) && isObject(evidence.checks) ? evidence.checks : {};
  } catch (_error) {
    return {};
  }
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function escapeCommandData(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function escapeCommandProperty(value) {
  return escapeCommandData(value)
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

function getFixHint(planByCheck, checkId) {
  const item = planByCheck.get(checkId);
  if (!item) return 'see Plan';
  const fixText = normalizeText(item.fix_action || item.description || item.name || 'see Plan');
  return truncate(fixText || 'see Plan', 80);
}

function buildPlanIndex(plan) {
  const byCheck = new Map();
  const items = Array.isArray(plan && plan.items) ? plan.items : [];
  for (const item of items) {
    if (!item || typeof item.check_id !== 'string') continue;
    if (!byCheck.has(item.check_id)) {
      byCheck.set(item.check_id, item);
    }
  }
  return byCheck;
}

function main() {
  const scoresPath = process.argv[2];
  const planPath = process.argv[3];

  if (!scoresPath || !planPath) {
    throw new Error('Usage: emit-workflow-commands.js <scores.json> <plan.json>');
  }

  const scores = readJson(scoresPath);
  const plan = readJson(planPath);
  const evidenceChecks = getEvidenceChecks();
  const planByCheck = buildPlanIndex(plan);

  for (const { project, check } of flattenChecks(scores)) {
    const score = Number(check && check.score);
    if (!Number.isFinite(score) || score >= 0.8) continue;

    const level = score < 0.5 ? 'error' : 'warning';
    const evidence = evidenceChecks[check.check_id] || {};
    const shortName = normalizeText(evidence.name || check.name || check.check_id);
    const title = `${check.check_id} - ${shortName}`;
    const detail = normalizeText(check.detail || evidence.name || check.check_id);
    const fixHint = getFixHint(planByCheck, check.check_id);
    const filePath = resolveFilePath(check, scores, project);
    const message = `${detail} (fix: ${fixHint})`;

    process.stdout.write(
      `::${level} file=${escapeCommandProperty(filePath)},title=${escapeCommandProperty(title)}::${escapeCommandData(message)}\n`,
    );
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
