#!/usr/bin/env bash
# F002.S4: Run scanner on 20 repos, compare with labels.json, output confusion matrix.
# Usage: bash tests/accuracy/run-accuracy.sh

set -u

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SCANNER="${ROOT_DIR}/src/scanner.sh"
CORPUS_DIR="${AL_CORPUS_DIR:-${HOME}/corpus/sources}"
LABELS="${ROOT_DIR}/tests/accuracy/labels.json"
REPOS="${ROOT_DIR}/tests/accuracy/repos.json"

if [ ! -f "$LABELS" ]; then
  echo "labels.json not found. Run auto-label.js first." >&2
  exit 1
fi

# Run scanner on all repos and collect results
echo "=== Scanning 20 repos ==="
scanner_results=""
repo_count="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${REPOS}')).repos.length)")"

for i in $(seq 0 $((repo_count - 1))); do
  repo_path="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${REPOS}')).repos[$i].path)")"
  repo_name="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${REPOS}')).repos[$i].name)")"
  repo_dir="${CORPUS_DIR}/${repo_path}"

  if [ ! -d "$repo_dir" ]; then
    echo "SKIP: ${repo_name}" >&2
    continue
  fi

  printf 'Scanning: %s...\n' "$repo_name" >&2
  output="$(bash "$SCANNER" --project-dir "$repo_dir" 2>/dev/null)"
  scanner_results="${scanner_results}${output}"$'\n'
done

echo ""
echo "=== Comparing with labels ==="

# Use node to compare
node -e "
const fs = require('fs');
const labels = JSON.parse(fs.readFileSync('${LABELS}'));
const scannerOutput = \`${scanner_results}\`.trim().split('\\n').filter(Boolean);

// Parse scanner results into {repo: {check_id: score}}
const scannerMap = {};
for (const line of scannerOutput) {
  try {
    const d = JSON.parse(line);
    if (!scannerMap[d.project]) scannerMap[d.project] = {};
    scannerMap[d.project][d.check_id] = d.score;
  } catch {}
}

// Compare
const checks = ['F1','F2','F3','F4','F5','F6','F7','I1','I2','I3','I4','I5','I6','I7','W1','W2','W3','W4','W5','W6','C1','C2','C3','C4','C5','S1','S2','S3','S4','S5','S6'];
const matrix = {};
for (const c of checks) matrix[c] = { tp: 0, fp: 0, fn: 0, tn: 0, skip: 0 };

let totalCorrect = 0;
let totalCompared = 0;

for (const repo of labels) {
  const repoName = repo.repo.split('/').pop().replace(/_/g, '-');
  // Try to find scanner results — scanner uses basename
  const scannerKeys = Object.keys(scannerMap);
  let scannerKey = scannerKeys.find(k => k === repoName);
  if (!scannerKey) {
    // Try original name formats
    for (const k of scannerKeys) {
      if (repo.repo.includes(k) || k.includes(repo.repo.split('/').pop())) {
        scannerKey = k;
        break;
      }
    }
  }
  if (!scannerKey) {
    // Try with underscore to hyphen
    const baseName = repo.repo.replace(/.*_/, '');
    scannerKey = scannerKeys.find(k => k.toLowerCase() === baseName.toLowerCase());
  }

  if (!scannerKey) {
    process.stderr.write('No scanner results for: ' + repo.repo + ' (tried: ' + repoName + ')\\n');
    continue;
  }

  const scannerChecks = scannerMap[scannerKey];

  for (const check of checks) {
    const label = repo.labels[check];
    const score = scannerChecks[check];

    if (label === 'uncertain' || label === 'na') {
      matrix[check].skip++;
      continue;
    }

    totalCompared++;
    const scannerPass = score !== undefined && score > 0;
    const labelPass = label === 'pass';

    if (labelPass && scannerPass) { matrix[check].tp++; totalCorrect++; }
    else if (!labelPass && !scannerPass) { matrix[check].tn++; totalCorrect++; }
    else if (!labelPass && scannerPass) { matrix[check].fp++; }
    else if (labelPass && !scannerPass) { matrix[check].fn++; }
  }
}

// Print results
console.log('');
console.log('check  | TP  FP  FN  TN  skip | accuracy');
console.log('-------|------------------------|----------');
let totalChecks = 0;
let passChecks = 0;
for (const check of checks) {
  const m = matrix[check];
  const compared = m.tp + m.fp + m.fn + m.tn;
  const acc = compared > 0 ? ((m.tp + m.tn) / compared * 100).toFixed(0) : 'n/a';
  const flag = (compared > 0 && (m.tp + m.tn) / compared < 0.8) ? ' <<<' : '';
  console.log(check.padEnd(6) + ' |' + String(m.tp).padStart(3) + String(m.fp).padStart(4) + String(m.fn).padStart(4) + String(m.tn).padStart(4) + String(m.skip).padStart(5) + '  | ' + String(acc).padStart(4) + '%' + flag);
  if (compared > 0) {
    totalChecks++;
    if ((m.tp + m.tn) / compared >= 0.8) passChecks++;
  }
}
console.log('');
console.log('Overall: ' + totalCorrect + '/' + totalCompared + ' correct (' + (totalCorrect/totalCompared*100).toFixed(1) + '%)');
console.log('Checks >= 80% accuracy: ' + passChecks + '/' + totalChecks);
console.log('');

// Report failures in detail
for (const check of checks) {
  const m = matrix[check];
  if (m.fp > 0 || m.fn > 0) {
    const items = [];
    for (const repo of labels) {
      const label = repo.labels[check];
      if (label === 'uncertain' || label === 'na') continue;
      const repoName = repo.repo.split('/').pop().replace(/_/g, '-');
      const scannerKeys = Object.keys(scannerMap);
      let scannerKey = scannerKeys.find(k => k === repoName) || scannerKeys.find(k => repo.repo.includes(k) || k.includes(repo.repo.split('/').pop())) || scannerKeys.find(k => k.toLowerCase() === repo.repo.replace(/.*_/, '').toLowerCase());
      if (!scannerKey) continue;
      const score = scannerMap[scannerKey][check];
      const scannerPass = score !== undefined && score > 0;
      const labelPass = label === 'pass';
      if (scannerPass !== labelPass) {
        items.push('  ' + repo.repo + ': label=' + label + ' scanner=' + (scannerPass ? 'pass' : 'fail') + ' (score=' + score + ')');
      }
    }
    if (items.length > 0) {
      console.log(check + ' mismatches:');
      items.forEach(i => console.log(i));
    }
  }
}
"

echo ""
echo "Done."
