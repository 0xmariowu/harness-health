#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const EVIDENCE_PATH = path.join(__dirname, '..', 'standards', 'evidence.json');
const TEMPLATES_PATH = path.join(__dirname, '..', 'standards', 'fix-templates');

const FIX_TYPE_ORDER = { auto: 0, assisted: 1, guided: 2 };
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const CHECK_FIX_ACTIONS = {
  F1: 'Generate CLAUDE.md from template',
  F5: 'Remove broken references',
  I1: 'Review IMPORTANT/NEVER usage. Anthropic reduced from N to M.',
  I3: "Rewrite vague rules using Don't/Instead/Because formula",
  I5: 'Remove identity language lines',
  W3: 'Add test files',
  C1: 'Review entry file for outdated rules',
  C2: 'Generate HANDOFF.md',
};

const ASSISTED_FIXES = new Set(['F1', 'C2']);
const AUTO_FIXES = new Set(['F5', 'I5']);
const GUIDED_FIXES = new Set(['I3', 'W3', 'C1']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function readInput() {
  const inputSource = process.argv[2];
  const raw = inputSource
    ? fs.readFileSync(inputSource, 'utf8')
    : fs.readFileSync(0, 'utf8');

  if (!raw.trim()) {
    throw new Error('No scorer JSON input found');
  }

  return JSON.parse(raw);
}

function listTemplateFiles() {
  try {
    return fs.readdirSync(TEMPLATES_PATH).filter((name) => name.endsWith('.md'));
  } catch (_error) {
    return [];
  }
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Number.NaN;
  if (numeric < 0) return 0;
  if (numeric <= 1) return numeric;
  if (numeric <= 10) return numeric / 10;
  if (numeric <= 100) return numeric / 100;
  return numeric;
}

function getEvidenceRecord(evidence, checkId) {
  if (!isObject(evidence) || !isObject(evidence.checks)) return null;
  return evidence.checks[checkId] || null;
}

function toNumber(value) {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function objectFromValue(value) {
  if (isObject(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isObject(parsed) ? parsed : null;
    } catch (_error) {
      return null;
    }
  }
  return null;
}

function getReferenceValue(refValue, key) {
  const source = objectFromValue(refValue) || {};
  if (!isObject(source)) return Number.NaN;
  const fromKey = source[key];
  if (Number.isFinite(toNumber(fromKey))) return toNumber(fromKey);
  if (isObject(fromKey)) {
    const reference = toNumber(fromKey.reference);
    if (Number.isFinite(reference)) return reference;
  }
  return Number.NaN;
}

function inferSeverity(score) {
  if (score < 0.5) return 'high';
  if (score < 0.7) return 'medium';
  return 'low';
}

function inferFixType(checkId, score) {
  if (score >= 0.8 || !Number.isFinite(score)) {
    return null;
  }

  if (GUIDED_FIXES.has(checkId)) return 'guided';
  if (AUTO_FIXES.has(checkId)) return 'auto';
  if (ASSISTED_FIXES.has(checkId)) return 'assisted';
  if (score < 0.5) return 'assisted';
  return 'guided';
}

function formatKeywords(measured) {
  const value = objectFromValue(measured);
  if (!value) return null;
  const values = [];
  if (Number.isFinite(value.IMPORTANT)) values.push(`IMPORTANT=${value.IMPORTANT}`);
  if (Number.isFinite(value.NEVER)) values.push(`NEVER=${value.NEVER}`);
  if (Number.isFinite(value.MUST)) values.push(`MUST=${value.MUST}`);
  if (Number.isFinite(value.CRITICAL)) values.push(`CRITICAL=${value.CRITICAL}`);
  return values.length ? values.join(', ') : null;
}

function inferFixAction(checkId, record, templates) {
  if (Object.prototype.hasOwnProperty.call(CHECK_FIX_ACTIONS, checkId)) {
    if (checkId === 'I1') {
      const measured = objectFromValue(record.measured_value);
      const importantCount = toNumber(measured?.IMPORTANT);
      const referenceImportant = getReferenceValue(record.reference_value, 'IMPORTANT');
      const from = Number.isFinite(importantCount) ? String(Math.round(importantCount)) : 'N';
      const to = Number.isFinite(referenceImportant) ? String(Math.round(referenceImportant)) : 'M';
      return `Review IMPORTANT/NEVER usage. Anthropic reduced from ${from} to ${to}.`;
    }

    if (checkId === 'F1') {
      const hasTemplate = templates.includes('claude-md-starter.md');
      if (!hasTemplate) {
        return 'Generate CLAUDE.md from template';
      }
    }

    return CHECK_FIX_ACTIONS[checkId];
  }

  const name = record.name || 'the check';
  return `Review and improve ${name}`;
}

function inferDescription(record) {
  const measured = record.measured_value;
  const detail = typeof record.detail === 'string' && record.detail.trim() ? record.detail.trim() : '';
  const checkedValue = toNumber(measured);

  if (record.check_id === 'F5' && Number.isFinite(checkedValue)) {
    return `${Math.round(checkedValue)} broken references in CLAUDE.md`;
  }
  if (record.check_id === 'W3' && Number.isFinite(checkedValue)) {
    return `${Math.round(checkedValue)} test files`;
  }
  if (record.check_id === 'I5' && Number.isFinite(checkedValue)) {
    return `${Math.round(checkedValue)} identity language lines`;
  }
  if (record.check_id === 'C1' && Number.isFinite(checkedValue)) {
    return `Entry file lag is ${Math.round(checkedValue)} days`;
  }
  if (record.check_id === 'I1') {
    const keywordSummary = formatKeywords(measured);
    if (keywordSummary) {
      return `Keyword counts (${keywordSummary})`;
    }
  }
  if (record.check_id === 'I3' && Number.isFinite(checkedValue)) {
    return `Only ${Math.round(checkedValue * 100)}% of rules use the Don't/Instead/Because pattern`;
  }
  if (Number.isFinite(checkedValue) && detail) {
    return detail;
  }
  if (detail) {
    return detail;
  }
  if (checkedValue !== 0 && Number.isFinite(checkedValue)) {
    return String(checkedValue);
  }
  if (isObject(measured)) {
    return JSON.stringify(measured);
  }
  return 'No details available';
}

function normalizeRecord(rawRecord, projectHint, evidence) {
  if (!isObject(rawRecord)) return null;

  const checkId = String(
    rawRecord.check_id || rawRecord.check || rawRecord.id || rawRecord.code || '',
  ).toUpperCase();
  if (!checkId) return null;

  const score = normalizeScore(rawRecord.score);
  if (!Number.isFinite(score) || score >= 0.8) return null;

  const evidenceRecord = getEvidenceRecord(evidence, checkId) || {};
  const project = typeof rawRecord.project === 'string' && rawRecord.project.trim()
    ? rawRecord.project.trim()
    : projectHint || 'unknown';
  const dimension = rawRecord.dimension || rawRecord.dim || rawRecord.category || evidenceRecord.dimension || null;
  const name = rawRecord.name || evidenceRecord.name || rawRecord.title || rawRecord.check_name || checkId;

  return {
    project,
    check_id: checkId,
    dimension,
    name,
    severity: inferSeverity(score),
    fix_type: inferFixType(checkId, score),
    description: inferDescription({ ...rawRecord, check_id: checkId, detail: rawRecord.detail }),
    evidence: evidenceRecord.evidence_text || '',
    measured_value: rawRecord.measured_value ?? rawRecord.measured ?? null,
    reference_value: rawRecord.reference_value ?? rawRecord.reference ?? null,
    score,
    rawDimension: dimension,
  };
}

function buildItemsFromDimensionState(dimensionState, projectHint, evidence, templates, seen, collector) {
  for (const checks of Object.values(dimensionState)) {
    if (!checks || !Array.isArray(checks.checks)) continue;
    for (const record of checks.checks) {
      const normalized = normalizeRecord(
        {
          ...record,
          project: record.project || projectHint,
        },
        projectHint,
        evidence,
      );
      if (!normalized || !normalized.fix_type) continue;
      const dedupeKey = `${normalized.project}|${normalized.check_id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      normalized.fix_action = inferFixAction(normalized.check_id, normalized, templates);
      normalized.id = collector.length + 1; // placeholder id before final ordering
      collector.push(normalized);
    }
  }
}

function extractChecks(parsed, evidence, templates) {
  const items = [];
  const seen = new Set();
  const hasProjectScoped = isObject(parsed.by_project) && Object.keys(parsed.by_project).length > 0;

  if (hasProjectScoped) {
    for (const [projectName, projectEntry] of Object.entries(parsed.by_project)) {
      if (!isObject(projectEntry)) continue;
      // Scorer outputs dimensions directly under project (not nested under .dimensions)
      const dims = isObject(projectEntry.dimensions) ? projectEntry.dimensions : projectEntry;
      buildItemsFromDimensionState(dims, projectName, evidence, templates, seen, items);
    }
  }

  if (!hasProjectScoped && isObject(parsed.dimensions)) {
    buildItemsFromDimensionState(parsed.dimensions, 'unknown', evidence, templates, seen, items);
  }

  if (Array.isArray(parsed.checks)) {
    for (const record of parsed.checks) {
      const normalized = normalizeRecord(record, 'unknown', evidence);
      if (!normalized || !normalized.fix_type) continue;
      const dedupeKey = `${normalized.project}|${normalized.check_id}`;
      if (seen.has(dedupeKey)) continue;
      normalized.fix_action = inferFixAction(normalized.check_id, normalized, templates);
      normalized.id = items.length + 1; // placeholder id before final ordering
      seen.add(dedupeKey);
      items.push(normalized);
    }
  }

  return items;
}

function sortItems(items) {
  const sorted = items.slice().sort((left, right) => {
    const severitySort = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (severitySort !== 0) return severitySort;
    const fixTypeSort = FIX_TYPE_ORDER[left.fix_type] - FIX_TYPE_ORDER[right.fix_type];
    if (fixTypeSort !== 0) return fixTypeSort;
    if (left.project < right.project) return -1;
    if (left.project > right.project) return 1;
    if (left.check_id < right.check_id) return -1;
    if (left.check_id > right.check_id) return 1;
    return 0;
  });

  return sorted.map((item, index) => {
    return {
      id: index + 1,
      project: item.project,
      check_id: item.check_id,
      dimension: item.dimension,
      name: item.name,
      severity: item.severity,
      fix_type: item.fix_type,
      description: item.description,
      evidence: item.evidence,
      fix_action: item.fix_action,
      measured_value: item.measured_value,
      reference_value: item.reference_value,
    };
  });
}

function main() {
  const evidence = readJson(EVIDENCE_PATH);
  const templates = listTemplateFiles();
  const parsed = readInput();

  const extracted = extractChecks(parsed, evidence, templates);
  const items = sortItems(extracted);

  // Group by severity + merge similar items
  const grouped = { high: [], medium: [], low: [] };
  for (const item of items) {
    grouped[item.severity].push(item);
  }

  // Merge: group items with same check_id across projects
  function mergeItems(itemList) {
    const byCheck = {};
    for (const item of itemList) {
      if (!byCheck[item.check_id]) {
        byCheck[item.check_id] = {
          ...item,
          projects: [item.project],
          item_ids: [item.id],
          measured_values: [{ project: item.project, value: item.measured_value }],
          project_count: 1,
        };
      } else {
        const merged = byCheck[item.check_id];
        merged.projects.push(item.project);
        merged.item_ids.push(item.id);
        merged.measured_values.push({ project: item.project, value: item.measured_value });
        merged.project_count++;
        // Aggregate measured_value: sum for numbers, count for booleans
        const numericValues = merged.measured_values
          .map(v => typeof v.value === 'number' ? v.value : 0);
        const totalMeasured = numericValues.reduce((a, b) => a + b, 0);
        merged.measured_value = totalMeasured;
        merged.description =
          `${merged.project_count} projects: ${merged.name} (${totalMeasured} total)`;
        merged.project = merged.projects.join(', ');
      }
    }
    return Object.values(byCheck);
  }

  const output = {
    total_items: items.length,
    grouped: {
      high: { count: grouped.high.length, items: mergeItems(grouped.high), default_selected: true },
      medium: { count: grouped.medium.length, items: mergeItems(grouped.medium), default_selected: false },
      low: { count: grouped.low.length, items: mergeItems(grouped.low), default_selected: false },
    },
    items, // full flat list for fixer.js
  };

  process.stdout.write(JSON.stringify(output, null, 2));
  process.stdout.write('\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
