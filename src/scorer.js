#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const weightsPath = path.join(__dirname, '..', 'standards', 'weights.json');
const referencePath = path.join(__dirname, '..', 'standards', 'reference-thresholds.json');

const DIMENSION_BY_PREFIX = {
  F: 'findability',
  D: 'deep',
  I: 'instructions',
  W: 'workability',
  C: 'continuity',
  S: 'safety',
  H: 'harness',
};

// Extended dimensions require optional runtime conditions (AI sub-agents, local
// Claude Code session logs) and are not produced by the deterministic scanner.
// They participate in the total score only when their checks actually ran.
const EXTENDED_DIMENSIONS = new Set(['deep', 'session']);

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function normalizeProject(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return 'unknown';
}

function resolveDimension(checkId, dimensionHint) {
  if (typeof dimensionHint === 'string' && dimensionHint.trim()) {
    return dimensionHint.trim();
  }

  if (typeof checkId !== 'string' || checkId.length === 0) return null;
  if (checkId.toUpperCase().startsWith('SS')) return 'session';

  const prefix = checkId[0]?.toUpperCase();
  return DIMENSION_BY_PREFIX[prefix] || null;
}

function coerceScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric <= 1) return numeric;
  if (numeric <= 10) return numeric / 10;
  if (numeric <= 100) return numeric / 100;

  return 0;
}

function pickReferenceValue(thresholds, checkId) {
  if (!checkId) return null;

  if (Object.prototype.hasOwnProperty.call(thresholds, checkId)) {
    return flattenReferenceValue(thresholds[checkId]);
  }

  const pref = `${checkId}_`;
  const prefMatch = Object.keys(thresholds).find((key) => key.startsWith(pref));
  if (prefMatch) {
    return flattenReferenceValue(thresholds[prefMatch]);
  }

  return null;
}

function flattenReferenceValue(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'object') return value;

  if (Object.prototype.hasOwnProperty.call(value, 'reference')) return value.reference;
  if (Object.prototype.hasOwnProperty.call(value, 'reference_value')) return value.reference_value;
  if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;
  if (Object.prototype.hasOwnProperty.call(value, 'ref')) return value.ref;
  if (Object.prototype.hasOwnProperty.call(value, 'reference_lines')) return value.reference_lines;

  return value;
}

function initDimensionState(dimensionsConfig) {
  const result = {};
  for (const [name, cfg] of Object.entries(dimensionsConfig)) {
    result[name] = {
      score: 0,
      max: Number(cfg.max_score),
      weight: Number(cfg.weight),
      checks: [],
      weightedSum: 0,
      weightSum: 0,
    };
  }
  return result;
}

function finalizeDimensions(states, dimensionsConfig) {
  const dimensions = {};
  for (const name of Object.keys(dimensionsConfig)) {
    const state = states[name];
    const ran = state.checks.length > 0;
    const weighted = state.weightSum > 0 ? (state.weightedSum / state.weightSum) * state.max : 0;
    const score = ran ? (Number.isFinite(weighted) ? Math.round(weighted) : 0) : null;
    dimensions[name] = {
      status: ran ? 'run' : 'not_run',
      score,
      max: state.max,
      weight: state.weight,
      checks: state.checks,
    };
  }
  return dimensions;
}

function calculateTotalScore(dimensions, dimensionsConfig) {
  let numerator = 0;
  let denominator = 0;

  for (const [name, cfg] of Object.entries(dimensionsConfig)) {
    const dim = dimensions[name];
    // Skip dimensions whose checks didn't run — they would pollute the average
    // with a spurious 0 even though no evidence was gathered.
    if (!dim || dim.status !== 'run') continue;
    const weight = Number(cfg.weight);
    if (!Number.isFinite(weight) || weight < 0) continue;
    numerator += (dim.score / dim.max) * weight;
    denominator += weight;
  }

  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function computeScoreScope(dimensions) {
  for (const [name, dim] of Object.entries(dimensions)) {
    if (EXTENDED_DIMENSIONS.has(name) && dim.status === 'run') {
      return 'core+extended';
    }
  }
  return 'core';
}

function addCheckContribution(stateMap, record, checkWeights, dimensionsConfig, thresholds) {
  const state = stateMap[record.dimension];
  if (!state) return;

  state.checks.push({
    check_id: record.check_id,
    name: record.name,
    measured_value: record.measured_value,
    reference_value: record.reference_value,
    score: record.score,
    detail: record.detail,
    evidence_id: record.evidence_id,
  });

  const weight = Number(checkWeights[record.check_id]);
  if (!Number.isFinite(weight) || weight <= 0) return;
  if (!Number.isFinite(record.score)) return;

  state.weightedSum += record.score * weight;
  state.weightSum += weight;
}

function buildRecord(raw, thresholds, dimensionsConfig) {
  const checkId = raw.check_id || raw.id || raw.check || raw.code;
  const dimensionHint = raw.dimension || raw.dim || raw.category;

  if (typeof checkId !== 'string') return null;

  const dimension = resolveDimension(checkId, dimensionHint);
  if (!dimension || !dimensionsConfig[dimension]) return null;

  const score = coerceScore(raw.score ?? raw.check_score ?? raw.value ?? raw.measured_score ?? raw.result_score);

  return {
    project: normalizeProject(raw.project || raw.project_name || raw.projectId || raw.repo || raw.repository),
    // Carry project_path through so the downstream bucketing can key on
    // absolute path — basename alone collides when two repos share a
    // directory name (e.g. org1/app + org2/app).
    project_path: typeof raw.project_path === 'string' && raw.project_path.trim()
      ? raw.project_path.trim()
      : null,
    check_id: checkId,
    dimension,
    name: raw.name || raw.title || raw.check_name || null,
    measured_value: raw.measured_value ?? raw.measured ?? raw.value ?? null,
    reference_value: pickReferenceValue(thresholds, checkId),
    score,
    detail: raw.detail ?? raw.message ?? raw.description ?? null,
    evidence_id: (raw.evidence_id ?? raw.evidence) || raw.evidenceId || null,
  };
}

function mergeRecord(targets, record, checkWeights, dimensionsConfig, thresholds) {
  addCheckContribution(targets.global, record, checkWeights, dimensionsConfig, thresholds);

  // Bucket by project_path, not by basename. Two repos with the same
  // basename under different parent dirs (e.g. org1/app + org2/app) used
  // to collide into one `byProject[app]` entry — their findings got
  // averaged and the per-project report lost half the data. Fall back to
  // basename only for records that don't carry a path (extended
  // analyzers today; deep.jsonl / session.jsonl for dimension-scoped
  // records). We key the displayed entry by basename and record
  // project_path for downstream consumers that need to disambiguate.
  const projectPath = typeof record.project_path === 'string' && record.project_path.trim();
  const projectName = typeof record.project === 'string' && record.project.trim() && record.project !== 'unknown';
  if (!projectPath && !projectName) return;

  const pathKey = projectPath || record.project;
  if (!targets.byProject[pathKey]) {
    targets.byProject[pathKey] = {
      state: initDimensionState(dimensionsConfig),
      project: projectName ? record.project : null,
      project_path: record.project_path || null,
    };
  }
  addCheckContribution(targets.byProject[pathKey].state, record, checkWeights, dimensionsConfig, thresholds);
}

async function run() {
  const weights = readJsonFile(weightsPath);
  const thresholds = readJsonFile(referencePath);

  const dimensionsConfig = weights.dimensions || {};
  const checkWeights = weights.check_weights || {};

  const inputArg = process.argv[2];
  const input = inputArg ? fs.createReadStream(inputArg, 'utf8') : process.stdin;
  if (inputArg) {
    input.on('error', (err) => {
      process.stderr.write(`scorer: cannot read input '${inputArg}': ${err.message}\n`);
      process.exit(1);
    });
  }
  const rl = readline.createInterface({ input });

  const globalState = initDimensionState(dimensionsConfig);
  const byProject = {};

  const targets = { global: globalState, byProject };
  let validRecordCount = 0;

  function acceptRecord(record) {
    if (!record) return;
    validRecordCount += 1;
    mergeRecord(targets, record, checkWeights, dimensionsConfig, thresholds);
  }

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const preview = text.length > 80 ? `${text.slice(0, 77)}...` : text;
      process.stderr.write(`scorer: skipping malformed JSONL line: ${preview}\n`);
      return;
    }

    if (Array.isArray(parsed)) {
      for (const raw of parsed) {
        if (!raw || typeof raw !== 'object') continue;
        const record = buildRecord(raw, thresholds, dimensionsConfig);
        acceptRecord(record);
      }
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    if (Array.isArray(parsed.checks)) {
      for (const raw of parsed.checks) {
        if (!raw || typeof raw !== 'object') continue;
        const record = buildRecord(raw, thresholds, dimensionsConfig);
        acceptRecord(record);
      }
      return;
    }

    const record = buildRecord(parsed, thresholds, dimensionsConfig);
    acceptRecord(record);
  });

  await new Promise((resolve) => rl.on('close', resolve));

  if (validRecordCount === 0) {
    process.stderr.write('scorer.js: no valid scan records — refusing to compute score\n');
    process.exit(1);
  }

  const dimensions = finalizeDimensions(globalState, dimensionsConfig);

  // Output by_project keyed by project_path (unique even on basename
  // collisions). Each entry carries display-friendly `project` (basename)
  // plus the absolute `project_path` for fix-path resolution.
  const by_project = {};
  for (const [pathKey, bucket] of Object.entries(byProject)) {
    by_project[pathKey] = {
      project: bucket.project,
      project_path: bucket.project_path,
      ...finalizeDimensions(bucket.state, dimensionsConfig),
    };
  }

  const result = {
    total_score: calculateTotalScore(dimensions, dimensionsConfig),
    score_scope: computeScoreScope(dimensions),
    dimensions,
    by_project,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`Failed to run scorer: ${error.message}\n`);
  process.exit(1);
});
