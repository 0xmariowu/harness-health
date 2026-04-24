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
  F4: 'Add INDEX file for navigation',
  F5: 'Remove broken references',
  F6: 'Add missing standard files (README.md, CHANGELOG.md)',
  F8: 'Change paths: to globs: in .claude/rules/*.md frontmatter — Claude Code uses globs: syntax',
  F9: 'Replace template placeholders with actual project values',
  I1: 'Review IMPORTANT/NEVER usage. Anthropic reduced from N to M.',
  I3: "Rewrite vague rules using Don't/Instead/Because formula",
  I5: 'Remove identity language lines',
  I6: 'Review entry file length',
  I8: 'Reduce total injected content by consolidating rules or splitting into conditional @include files',
  W1: 'Add build/test commands to entry file',
  W2: 'Add CI workflows',
  W3: 'Add test files',
  W4: 'Add linter/formatter configuration',
  W9: 'Add version comparison to release workflow (compare tag to pyproject.toml/package.json)',
  W10: 'Add pytest marker tiers to pyproject.toml: unit, smoke, live (at minimum)',
  W11: 'Generate .github/workflows/test-required.yml to gate feat/fix commits on paired test commits',
  C1: 'Review entry file for outdated rules',
  C2: 'Generate HANDOFF.md',
  C3: 'Create CHANGELOG.md',
  C4: 'Create plans directory',
  C6: 'Add verify conditions to HANDOFF.md: scores, thresholds, or READY/PASS markers',
  S1: 'Add .env to .gitignore',
  S2: 'Pin GitHub Actions to SHA commits',
  S3: 'Add gitleaks pre-commit hook or CI workflow',
  S4: 'Create SECURITY.md with vulnerability reporting instructions',
  S5: 'Move workflow permissions from workflow level to job level',
  S6: 'Remove hardcoded secrets and use environment variables',
  H1: 'Fix invalid hook event names. Valid events: PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, Notification, PreCompact, UserPromptSubmit, SubagentStop, SubagentStart, PostToolUseFailure, PermissionRequest',
  H2: 'Add matcher field to PreToolUse hooks to avoid firing on every tool call',
  H3: 'Add circuit breaker guard to Stop hook scripts (e.g., STOP_HOOK_ACTIVE variable checked at entry)',
  H4: 'Replace dangerous auto-approve rules with scoped permissions (e.g., Bash(git status:*) instead of Bash(*))',
  H5: 'Extend .env deny rules to cover variants: Read(./.env.*) or Read(./.env*)',
  H6: 'Review hook scripts making network calls — ensure external requests are intentional, not data exfiltration',
  H8: 'Add hooks/_shared.sh with fail_with_help() for structured hook errors (what/rule/fix/see)',
};

// ─── Fix Capability Registry ────────────────────────────────────────────────
// Derived from `standards/evidence.json` — the single source of truth for
// every check's metadata (dimension, scope, fix_type). Any check whose
// evidence entry declares a non-null `fix_type` MUST have a matching handler
// in `src/fixer.js`; drift is caught by `tests/test-registry-consistency.js`.
//
// Checks with `fix_type: null` default to 'guided' at plan time — we never
// promise an 'assisted' fix the fixer cannot deliver.
function buildFixRegistry() {
  const evidence = readJson(EVIDENCE_PATH);
  const registry = {};
  for (const [checkId, entry] of Object.entries(evidence.checks || {})) {
    if (entry && entry.fix_type) {
      registry[checkId] = entry.fix_type;
    }
  }
  return registry;
}

const FIX_REGISTRY = buildFixRegistry();

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

  const registered = FIX_REGISTRY[checkId];
  if (registered) return registered;

  // Unregistered checks are 'guided' — never promise an 'assisted' fix the
  // fixer hasn't implemented. Low scores don't create capability out of thin
  // air. See the FIX_REGISTRY comment above.
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
  const project_path = typeof rawRecord.project_path === 'string' && rawRecord.project_path.trim()
    ? rawRecord.project_path.trim()
    : null;
  const dimension = rawRecord.dimension || rawRecord.dim || rawRecord.category || evidenceRecord.dimension || null;
  const name = rawRecord.name || evidenceRecord.name || rawRecord.title || rawRecord.check_name || checkId;

  return {
    project,
    project_path,
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

function buildItemsFromDimensionState(dimensionState, projectHint, evidence, templates, seen, collector, projectPathHint) {
  for (const checks of Object.values(dimensionState)) {
    if (!checks || !Array.isArray(checks.checks)) continue;
    for (const record of checks.checks) {
      // Dimension checks are aggregated within a by_project entry, so they
      // don't carry their own project/project_path. Inject both hints so
      // dedupe and routing work on the full path when available.
      const normalized = normalizeRecord(
        {
          ...record,
          project: record.project || projectHint,
          project_path: record.project_path || projectPathHint || null,
        },
        projectHint,
        evidence,
      );
      if (!normalized || !normalized.fix_type) continue;
      // Dedupe by project_path (absolute) when available — basename alone
      // collides when two repos with the same dir name live under different
      // parents. Fall back to basename for records without a path (legacy
      // scorer output, extended analyzers today).
      const dedupeProject = normalized.project_path || normalized.project;
      const dedupeKey = `${dedupeProject}|${normalized.check_id}`;
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
    for (const [projectKey, projectEntry] of Object.entries(parsed.by_project)) {
      if (!isObject(projectEntry)) continue;
      // by_project keys are now absolute paths when scanner emitted them.
      // Pull display name from projectEntry.project (basename) when present;
      // fall back to the key for legacy scorer output.
      const displayProject = (projectEntry.project && String(projectEntry.project).trim()) || projectKey;
      const projectPath = (projectEntry.project_path && String(projectEntry.project_path).trim()) || null;
      // Scorer outputs dimensions directly under project (not nested under .dimensions)
      const dims = isObject(projectEntry.dimensions) ? projectEntry.dimensions : projectEntry;
      buildItemsFromDimensionState(dims, displayProject, evidence, templates, seen, items, projectPath);
    }
  }

  if (!hasProjectScoped && isObject(parsed.dimensions)) {
    buildItemsFromDimensionState(parsed.dimensions, 'unknown', evidence, templates, seen, items);
  }

  if (Array.isArray(parsed.checks)) {
    for (const record of parsed.checks) {
      const normalized = normalizeRecord(record, 'unknown', evidence);
      if (!normalized || !normalized.fix_type) continue;
      // Dedupe by project_path (absolute) when available — basename alone
      // collides when two repos with the same dir name live under different
      // parents. Fall back to basename for records without a path (legacy
      // scorer output, extended analyzers today).
      const dedupeProject = normalized.project_path || normalized.project;
      const dedupeKey = `${dedupeProject}|${normalized.check_id}`;
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
      // project_path propagated so /al Step 5c and fixer can route fixes
      // to the right absolute dir without reverse-mapping from basename.
      project_path: item.project_path || null,
      check_id: item.check_id,
      dimension: item.dimension,
      name: item.name,
      severity: item.severity,
      fix_type: item.fix_type,
      description: item.description,
      evidence: item.evidence,
      fix_action: item.fix_action,
      fix_command: `agentlint fix ${item.check_id}`,
      measured_value: item.measured_value,
      reference_value: item.reference_value,
      score: item.score,
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

  // Checks where summing measured_value makes sense (counts of things)
  const SUMMABLE_CHECKS = new Set(['F5', 'W2', 'W3']);

  function mergeItems(itemList) {
    const byCheck = {};
    for (const item of itemList) {
      if (!byCheck[item.check_id]) {
        byCheck[item.check_id] = {
          ...item,
          projects: [item.project],
          // project_paths parallels projects so /al Step 5c (and any other
          // consumer) can filter grouped items by absolute path, not just
          // by basename. Without this, colliding basenames like org1/app
          // + org2/app collapse in the grouped view and the user picks
          // the wrong repo.
          project_paths: [item.project_path || null],
          per_project: [{
            project: item.project,
            project_path: item.project_path || null,
            measured_value: item.measured_value,
            description: item.description,
          }],
          item_ids: [item.id],
          project_count: 1,
        };
      } else {
        const merged = byCheck[item.check_id];
        merged.projects.push(item.project);
        merged.project_paths.push(item.project_path || null);
        merged.item_ids.push(item.id);
        merged.per_project.push({
          project: item.project,
          project_path: item.project_path || null,
          measured_value: item.measured_value,
          description: item.description,
        });
        merged.project_count++;
        // Display label prefers path-tail (e.g. "org1/app") when the same
        // basename appears more than once in the merge; otherwise use the
        // basename alone. Avoids the "app, app" ambiguity.
        const basenameCounts = merged.projects.reduce((acc, p) => {
          acc[p] = (acc[p] || 0) + 1; return acc;
        }, {});
        const labels = merged.projects.map((p, i) => {
          if (basenameCounts[p] <= 1) return p;
          const pp = merged.project_paths[i];
          if (!pp) return p;
          const parts = pp.replace(/\/+$/, '').split('/').filter(Boolean);
          return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : p;
        });
        merged.project = labels.join(', ');

        // Build description based on check type
        if (SUMMABLE_CHECKS.has(item.check_id)) {
          const total = merged.per_project
            .map(p => typeof p.measured_value === 'number' ? p.measured_value : 0)
            .reduce((a, b) => a + b, 0);
          merged.measured_value = total;
          merged.description = `${merged.project_count} projects: ${merged.name} (${total} total)`;
        } else {
          // Non-summable: describe what's MISSING (this is a fix plan, items failed)
          merged.description = `${merged.project_count} projects need: ${merged.fix_action || merged.name}`;
          // Don't overwrite measured_value — keep per_project for detail
        }
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
