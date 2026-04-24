#!/usr/bin/env node
'use strict';

// Compare scanner results against labels-full.jsonl ground truth.
// Outputs per-check confusion matrix, precision, recall, F1.
// Exit code 1 if regression detected (>5% drop in any metric).
//
// Usage: node compare-results.js <scanner-output.jsonl> [--baseline baseline.json]
//
// Scanner output: JSONL from scanner.sh (one line per check per repo)
// Labels: tests/accuracy/labels-full.jsonl
//
// Check universe: derived from standards/evidence.json at runtime, filtered
// to scope === "core". Extended dimensions (deep, session) are produced by
// deep-analyzer.js / session-analyzer.js — not scanner.sh — so they do not
// belong in this deterministic accuracy pipeline. Any check with no labels
// in labels-full.jsonl is reported under "Missing ground truth" so the
// label-rebuild gap stays visible.

const fs = require('fs');
const path = require('path');

const LABELS_PATH = path.join(__dirname, 'labels-full.jsonl');
const EVIDENCE_PATH = path.join(__dirname, '..', '..', 'standards', 'evidence.json');

const EVIDENCE = JSON.parse(fs.readFileSync(EVIDENCE_PATH, 'utf8'));
const ALL_CHECKS = Object.keys(EVIDENCE.checks)
  .filter((id) => EVIDENCE.checks[id].scope === 'core')
  .sort();

// Parse args
const args = process.argv.slice(2);
let scannerPath = null;
let baselinePath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--baseline' && args[i+1]) {
    baselinePath = args[++i];
  } else if (!scannerPath) {
    scannerPath = args[i];
  }
}

if (!scannerPath) {
  console.error('Usage: node compare-results.js <scanner-output.jsonl> [--baseline baseline.json]');
  process.exit(1);
}

// Load labels
function loadLabels() {
  const map = {};
  for (const line of fs.readFileSync(LABELS_PATH, 'utf8').split('\n').filter(Boolean)) {
    const d = JSON.parse(line);
    map[d.repo] = d.labels;
  }
  return map;
}

// Load scanner results
function loadScannerResults() {
  const map = {};
  for (const line of fs.readFileSync(scannerPath, 'utf8').split('\n').filter(Boolean)) {
    try {
      const d = JSON.parse(line);
      if (!d.project || !d.check_id) continue;
      if (!map[d.project]) map[d.project] = {};
      map[d.project][d.check_id] = d.score;
    } catch { /* skip invalid lines */ }
  }
  return map;
}

function wilsonInterval(successes, total, z = 1.96) {
  if (total === 0) return { lower: null, upper: null };
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt(p * (1 - p) / total + (z * z) / (4 * total * total))) / denom;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

// Main
const labels = loadLabels();
const scanner = loadScannerResults();

const labelRepos = new Set(Object.keys(labels));
const scannerRepos = new Set(Object.keys(scanner));
const commonRepos = [...labelRepos].filter(r => {
  // Scanner uses project basename, labels use full name with __
  // Try to match: label "oven-sh__bun" → scanner "bun"
  return scannerRepos.has(r) || scannerRepos.has(r.replace(/.*__/, ''));
});

function findScannerKey(labelRepo) {
  if (scannerRepos.has(labelRepo)) return labelRepo;
  const short = labelRepo.replace(/.*__/, '');
  if (scannerRepos.has(short)) return short;
  return null;
}

// Build confusion matrix per check
const matrix = {};
for (const check of ALL_CHECKS) {
  matrix[check] = { tp: 0, fp: 0, fn: 0, tn: 0, skip: 0, total: 0 };
}

let matchedRepos = 0;

for (const labelRepo of Object.keys(labels)) {
  const scanKey = findScannerKey(labelRepo);
  if (!scanKey) continue;

  matchedRepos++;
  const repoLabels = labels[labelRepo];
  const repoScanner = scanner[scanKey];

  for (const check of ALL_CHECKS) {
    const label = repoLabels[check];
    const score = repoScanner?.[check];

    // Skip uncertain, na, missing labels
    if (!label || label === 'uncertain' || label === 'na' || label === 'missing') {
      matrix[check].skip++;
      continue;
    }

    matrix[check].total++;
    const labelPass = label === 'pass';
    const scannerPass = score !== undefined && score > 0;

    if (labelPass && scannerPass) matrix[check].tp++;
    else if (!labelPass && scannerPass) matrix[check].fp++;
    else if (labelPass && !scannerPass) matrix[check].fn++;
    else matrix[check].tn++;
  }
}

// Calculate metrics
const results = {};
for (const check of ALL_CHECKS) {
  const m = matrix[check];
  const precision = (m.tp + m.fp) > 0 ? m.tp / (m.tp + m.fp) : null;
  const recall = (m.tp + m.fn) > 0 ? m.tp / (m.tp + m.fn) : null;
  const f1 = (precision !== null && recall !== null && (precision + recall) > 0)
    ? 2 * precision * recall / (precision + recall) : null;
  const accuracy = m.total > 0 ? (m.tp + m.tn) / m.total : null;
  const accuracyCI = wilsonInterval(m.tp + m.tn, m.total);

  results[check] = {
    ...m,
    precision,
    recall,
    f1,
    accuracy,
    accuracy_ci_low: accuracyCI.lower,
    accuracy_ci_high: accuracyCI.upper,
  };
}

// Print table
console.log('');
console.log(`Matched repos: ${matchedRepos} / ${Object.keys(labels).length} labeled`);
console.log('');
console.log(`${'Check'.padEnd(7)} ${'TP'.padStart(5)} ${'FP'.padStart(5)} ${'FN'.padStart(5)} ${'TN'.padStart(5)} ${'Skip'.padStart(5)} ${'Prec'.padStart(7)} ${'Recall'.padStart(7)} ${'F1'.padStart(7)} ${'Acc'.padStart(7)}`);
console.log('-'.repeat(72));

let totalTP = 0, totalFP = 0, totalFN = 0, totalTN = 0;

for (const check of ALL_CHECKS) {
  const r = results[check];
  totalTP += r.tp; totalFP += r.fp; totalFN += r.fn; totalTN += r.tn;

  const prec = r.precision !== null ? `${(r.precision * 100).toFixed(1)}%` : '  n/a';
  const rec = r.recall !== null ? `${(r.recall * 100).toFixed(1)}%` : '  n/a';
  const f1 = r.f1 !== null ? `${(r.f1 * 100).toFixed(1)}%` : '  n/a';
  const acc = r.accuracy !== null ? `${(r.accuracy * 100).toFixed(1)}%` : '  n/a';

  // Flag low metrics
  const flag = (r.precision !== null && r.precision < 0.8) || (r.recall !== null && r.recall < 0.8) ? ' <<<' : '';

  console.log(`${check.padEnd(7)} ${String(r.tp).padStart(5)} ${String(r.fp).padStart(5)} ${String(r.fn).padStart(5)} ${String(r.tn).padStart(5)} ${String(r.skip).padStart(5)} ${prec.padStart(7)} ${rec.padStart(7)} ${f1.padStart(7)} ${acc.padStart(7)}${flag}`);
}

// Overall
const overallPrec = (totalTP + totalFP) > 0 ? totalTP / (totalTP + totalFP) : 0;
const overallRec = (totalTP + totalFN) > 0 ? totalTP / (totalTP + totalFN) : 0;
const overallF1 = (overallPrec + overallRec) > 0 ? 2 * overallPrec * overallRec / (overallPrec + overallRec) : 0;
const overallAcc = (totalTP + totalFP + totalFN + totalTN) > 0 ? (totalTP + totalTN) / (totalTP + totalFP + totalFN + totalTN) : 0;

console.log('-'.repeat(72));
console.log(`${'TOTAL'.padEnd(7)} ${String(totalTP).padStart(5)} ${String(totalFP).padStart(5)} ${String(totalFN).padStart(5)} ${String(totalTN).padStart(5)} ${''.padStart(5)} ${(overallPrec*100).toFixed(1).padStart(6)}% ${(overallRec*100).toFixed(1).padStart(6)}% ${(overallF1*100).toFixed(1).padStart(6)}% ${(overallAcc*100).toFixed(1).padStart(6)}%`);

const missingGroundTruth = ALL_CHECKS.filter((check) => results[check].total === 0);
console.log('\nMissing ground truth:');
if (missingGroundTruth.length === 0) {
  console.log('  None.');
} else {
  console.log(
    `  ${missingGroundTruth.length} check(s) have 0 labeled repos in labels-full.jsonl ` +
    '- accuracy unmeasurable until labels are rebuilt:'
  );
  console.log(`  ${missingGroundTruth.join(', ')}`);
}

const lowNWarnings = ALL_CHECKS
  .filter((check) => results[check].total > 0)
  .map(check => ({ check, result: results[check] }))
  .filter(({ result }) =>
    result.accuracy_ci_low !== null &&
    result.accuracy_ci_high !== null &&
    (result.accuracy_ci_high - result.accuracy_ci_low) > 0.10
  );

console.log('\nLow-N warning:');
if (lowNWarnings.length === 0) {
  console.log('  None.');
} else {
  for (const { check, result } of lowNWarnings) {
    console.log(
      `  Check ${check}: ${(result.accuracy * 100).toFixed(1)}% ` +
      `(95% CI: ${(result.accuracy_ci_low * 100).toFixed(1)}% to ${(result.accuracy_ci_high * 100).toFixed(1)}%, n=${result.total}) ` +
      '- wide CI, headline number unreliable'
    );
  }
}

// Save results as JSON for baseline comparison
const outputJson = {
  timestamp: new Date().toISOString(),
  matched_repos: matchedRepos,
  total_labeled: Object.keys(labels).length,
  checks: results,
  overall: { precision: overallPrec, recall: overallRec, f1: overallF1, accuracy: overallAcc },
};

const jsonPath = scannerPath.replace('.jsonl', '-accuracy.json');
fs.writeFileSync(jsonPath, JSON.stringify(outputJson, null, 2) + '\n');
console.log(`\nResults saved to: ${jsonPath}`);

// Regression check against baseline
let exitCode = 0;
if (baselinePath && fs.existsSync(baselinePath)) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  console.log('\n=== REGRESSION CHECK ===');

  const regressions = [];
  for (const check of ALL_CHECKS) {
    const curr = results[check];
    const base = baseline.checks?.[check];
    if (!base) continue;

    if (curr.precision !== null && base.precision !== null) {
      const drop = base.precision - curr.precision;
      if (drop > 0.05) regressions.push({ check, metric: 'precision', from: base.precision, to: curr.precision, drop });
    }
    if (curr.recall !== null && base.recall !== null) {
      const drop = base.recall - curr.recall;
      if (drop > 0.05) regressions.push({ check, metric: 'recall', from: base.recall, to: curr.recall, drop });
    }
  }

  if (regressions.length > 0) {
    console.log('REGRESSIONS DETECTED:');
    for (const r of regressions) {
      console.log(`  ${r.check} ${r.metric}: ${(r.from*100).toFixed(1)}% → ${(r.to*100).toFixed(1)}% (dropped ${(r.drop*100).toFixed(1)}%)`);
    }
    exitCode = 1;
  } else {
    console.log('No regressions detected.');
  }
}

process.exit(exitCode);
