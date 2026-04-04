#!/usr/bin/env bash
# F004: Score calibration — run scorer on tiered repos, analyze tier separation.
# Usage: bash tests/calibration/run-calibration.sh

set -u

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SCANNER="${ROOT_DIR}/src/scanner.sh"
SCORER="${ROOT_DIR}/src/scorer.js"
CORPUS_DIR="${AL_CORPUS_DIR:-${HOME}/corpus/sources}"
TIERS="${ROOT_DIR}/tests/calibration/tiers.json"
SCORES="${ROOT_DIR}/tests/calibration/scores.json"

echo "=== Score Calibration ==="

# Scan and score each repo
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const tiers = JSON.parse(fs.readFileSync('${TIERS}'));
const corpus = '${CORPUS_DIR}';
const scanner = '${SCANNER}';
const scorer = '${SCORER}';
const results = [];

for (const repo of tiers.tiers) {
  const repoDir = path.join(corpus, repo.repo);
  if (!fs.existsSync(repoDir)) {
    process.stderr.write('SKIP: ' + repo.repo + ' (not found)\\n');
    continue;
  }

  process.stderr.write('Scoring: ' + repo.repo + '... ');

  try {
    const scanOut = execSync('bash \"' + scanner + '\" --project-dir \"' + repoDir + '\"', {
      encoding: 'utf8', timeout: 60000
    });

    const scoreOut = execSync('node \"' + scorer + '\"', {
      input: scanOut, encoding: 'utf8', timeout: 10000
    });

    const scored = JSON.parse(scoreOut);
    const dimScores = {};
    for (const [k, v] of Object.entries(scored.dimensions || {})) {
      dimScores[k] = v.score || 0;
    }
    results.push({
      repo: repo.repo,
      tier: repo.tier,
      total_score: scored.total_score,
      dimensions: dimScores
    });

    process.stderr.write('score=' + scored.total_score.toFixed(1) + '\\n');
  } catch (e) {
    process.stderr.write('ERROR: ' + e.message.slice(0, 80) + '\\n');
  }
}

fs.writeFileSync('${SCORES}', JSON.stringify(results, null, 2) + '\\n');
process.stderr.write('\\nScores written to ${SCORES}\\n');

// Analyze
const tierA = results.filter(r => r.tier === 'A').map(r => r.total_score);
const tierB = results.filter(r => r.tier === 'B').map(r => r.total_score);
const tierC = results.filter(r => r.tier === 'C').map(r => r.total_score);

const avg = arr => arr.length ? (arr.reduce((a,b) => a+b, 0) / arr.length) : 0;
const min = arr => arr.length ? Math.min(...arr) : 0;
const max = arr => arr.length ? Math.max(...arr) : 0;

console.log('');
console.log('=== Tier Analysis ===');
console.log('Tier A (AI-friendly): avg=' + avg(tierA).toFixed(1) + ' range=[' + min(tierA).toFixed(1) + ',' + max(tierA).toFixed(1) + '] n=' + tierA.length);
console.log('Tier B (partial):     avg=' + avg(tierB).toFixed(1) + ' range=[' + min(tierB).toFixed(1) + ',' + max(tierB).toFixed(1) + '] n=' + tierB.length);
console.log('Tier C (unfriendly):  avg=' + avg(tierC).toFixed(1) + ' range=[' + min(tierC).toFixed(1) + ',' + max(tierC).toFixed(1) + '] n=' + tierC.length);
console.log('');

const monotonic = avg(tierA) > avg(tierB) && avg(tierB) > avg(tierC);
console.log('Monotonic (A > B > C): ' + (monotonic ? 'YES' : 'NO'));

const overlap = max(tierC) >= min(tierA);
const overlapPct = overlap ? ((max(tierC) - min(tierA)) / (max(tierA) - min(tierC)) * 100).toFixed(0) : 0;
console.log('A/C overlap: ' + (overlap ? 'YES (' + overlapPct + '%)' : 'NO'));
console.log('C max (' + max(tierC).toFixed(1) + ') vs A min (' + min(tierA).toFixed(1) + '): gap=' + (min(tierA) - max(tierC)).toFixed(1));
console.log('');

// Per-dimension analysis
console.log('=== Per-Dimension Separation ===');
const dims = ['findability', 'instructions', 'workability', 'continuity', 'safety'];
for (const dim of dims) {
  const dimA = results.filter(r => r.tier === 'A').map(r => r.dimensions[dim] || 0);
  const dimB = results.filter(r => r.tier === 'B').map(r => r.dimensions[dim] || 0);
  const dimC = results.filter(r => r.tier === 'C').map(r => r.dimensions[dim] || 0);
  const sep = avg(dimA) - avg(dimC);
  console.log(dim.padEnd(14) + ' A=' + avg(dimA).toFixed(1) + ' B=' + avg(dimB).toFixed(1) + ' C=' + avg(dimC).toFixed(1) + ' (A-C gap=' + sep.toFixed(1) + ')');
}
console.log('');

// Anomalies
console.log('=== Anomalies ===');
for (const r of results) {
  if (r.tier === 'A' && r.total_score < avg(tierB)) {
    console.log('LOW A: ' + r.repo + ' score=' + r.total_score.toFixed(1) + ' (below B avg ' + avg(tierB).toFixed(1) + ')');
  }
  if (r.tier === 'C' && r.total_score > avg(tierB)) {
    console.log('HIGH C: ' + r.repo + ' score=' + r.total_score.toFixed(1) + ' (above B avg ' + avg(tierB).toFixed(1) + ')');
  }
}
" 2>&1
