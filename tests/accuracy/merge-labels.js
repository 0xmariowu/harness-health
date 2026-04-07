#!/usr/bin/env node
'use strict';

// Merge deterministic labels + LLM batch output into labels-full.jsonl.
// Cross-validates: when both sources give pass/fail, flags disagreements.
//
// Usage: node merge-labels.js
// Input:  deterministic-labels.jsonl + batch-output/batch_*.jsonl
// Output: labels-full.jsonl + conflicts.jsonl

const fs = require('fs');
const path = require('path');

const DET_PATH = path.join(__dirname, 'deterministic-labels.jsonl');
const BATCH_DIR = path.join(__dirname, 'batch-output');
const OUT_PATH = path.join(__dirname, 'labels-full.jsonl');
const CONFLICTS_PATH = path.join(__dirname, 'conflicts.jsonl');

const ALL_CHECKS = [
  'F1','F2','F3','F4','F5','F6','F7',
  'I1','I2','I3','I4','I5','I6','I7',
  'W1','W2','W3','W4','W5','W6',
  'C1','C2','C3','C4','C5',
  'S1','S2','S3','S4','S5','S6','S7','S8',
];

// Load deterministic labels
function loadDeterministic() {
  const map = {};
  for (const line of fs.readFileSync(DET_PATH, 'utf8').split('\n').filter(Boolean)) {
    const d = JSON.parse(line);
    map[d.repo] = d.labels;
  }
  return map;
}

// Load LLM batch output
function loadBatchOutput() {
  const map = {};
  if (!fs.existsSync(BATCH_DIR)) return map;

  const files = fs.readdirSync(BATCH_DIR)
    .filter(f => f.startsWith('batch_') && f.endsWith('.jsonl') && !f.includes('_errors'))
    .sort();

  let parsed = 0;
  let parseFail = 0;

  for (const fname of files) {
    const lines = fs.readFileSync(path.join(BATCH_DIR, fname), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const result = JSON.parse(line);
        const repoName = result.custom_id;
        const response = result.response;

        if (!response || response.status_code !== 200) {
          parseFail++;
          continue;
        }

        const content = response.body?.choices?.[0]?.message?.content || '';
        let labels = null;

        // Try to parse JSON array from response
        try {
          labels = JSON.parse(content);
        } catch {
          // Try to extract JSON from markdown code block
          const match = content.match(/\[[\s\S]*\]/);
          if (match) {
            try { labels = JSON.parse(match[0]); } catch {
              // Truncated response — try to salvage complete objects
              const partial = match[0];
              // Find last complete object (ends with })
              const lastBrace = partial.lastIndexOf('}');
              if (lastBrace > 0) {
                try {
                  labels = JSON.parse(partial.slice(0, lastBrace + 1) + ']');
                } catch { /* truly broken */ }
              }
            }
          }
        }

        if (Array.isArray(labels)) {
          const labelMap = {};
          for (const item of labels) {
            if (item && item.check && item.label) {
              labelMap[item.check] = item.label;
            }
          }
          map[repoName] = labelMap;
          parsed++;
        } else {
          parseFail++;
        }
      } catch {
        parseFail++;
      }
    }
  }

  process.stderr.write(`LLM labels: ${parsed} parsed, ${parseFail} failed\n`);
  return map;
}

// Main
const detLabels = loadDeterministic();
const llmLabels = loadBatchOutput();

const detRepos = Object.keys(detLabels);
process.stderr.write(`Deterministic: ${detRepos.length} repos\n`);
process.stderr.write(`LLM: ${Object.keys(llmLabels).length} repos\n`);

const outFd = fs.openSync(OUT_PATH, 'w');
const conflictFd = fs.openSync(CONFLICTS_PATH, 'w');

let totalLabels = 0;
let fromDet = 0;
let fromLlm = 0;
let conflicts = 0;
let missing = 0;
let repoCount = 0;

for (const repo of detRepos) {
  const det = detLabels[repo];
  const llm = llmLabels[repo] || {};
  const merged = {};
  const source = {};
  const repoConflicts = [];

  for (const check of ALL_CHECKS) {
    const dVal = det[check] || 'missing';
    const lVal = llm[check] || 'missing';
    totalLabels++;

    if (dVal === 'pass' || dVal === 'fail') {
      // Deterministic has a definitive answer
      if (lVal !== 'missing' && lVal !== dVal && lVal !== 'na') {
        // Conflict: det and LLM disagree
        conflicts++;
        repoConflicts.push({ check, deterministic: dVal, llm: lVal });
        // Trust deterministic for structural checks, LLM for judgment checks
        merged[check] = dVal;
        source[check] = 'deterministic-override';
      } else {
        merged[check] = dVal;
        source[check] = 'deterministic';
        fromDet++;
      }
    } else if (dVal === 'uncertain') {
      // Deterministic is uncertain — use LLM if available
      if (lVal !== 'missing') {
        merged[check] = lVal;
        source[check] = 'llm';
        fromLlm++;
      } else {
        merged[check] = 'uncertain';
        source[check] = 'none';
        missing++;
      }
    } else if (dVal === 'na') {
      merged[check] = 'na';
      source[check] = 'deterministic';
      fromDet++;
    } else {
      // Missing from deterministic
      if (lVal !== 'missing') {
        merged[check] = lVal;
        source[check] = 'llm';
        fromLlm++;
      } else {
        merged[check] = 'missing';
        source[check] = 'none';
        missing++;
      }
    }
  }

  const entry = { repo, labels: merged, source };
  if (repoConflicts.length > 0) entry.conflicts = repoConflicts.map(c => c.check);
  fs.writeSync(outFd, JSON.stringify(entry) + '\n');
  repoCount++;

  // Write conflicts
  for (const c of repoConflicts) {
    fs.writeSync(conflictFd, JSON.stringify({ repo, ...c }) + '\n');
  }
}

fs.closeSync(outFd);
fs.closeSync(conflictFd);

// Summary
const remaining = totalLabels - fromDet - fromLlm - conflicts;
process.stderr.write(`\n=== Merge Summary ===\n`);
process.stderr.write(`Repos: ${repoCount}\n`);
process.stderr.write(`Total labels: ${totalLabels}\n`);
process.stderr.write(`  From deterministic: ${fromDet} (${(fromDet/totalLabels*100).toFixed(1)}%)\n`);
process.stderr.write(`  From LLM: ${fromLlm} (${(fromLlm/totalLabels*100).toFixed(1)}%)\n`);
process.stderr.write(`  Conflicts (det wins): ${conflicts} (${(conflicts/totalLabels*100).toFixed(1)}%)\n`);
process.stderr.write(`  Still uncertain/missing: ${missing + remaining} (${((missing+remaining)/totalLabels*100).toFixed(1)}%)\n`);
process.stderr.write(`\nOutput: ${OUT_PATH}\n`);
process.stderr.write(`Conflicts: ${CONFLICTS_PATH}\n`);

if (conflicts > 0) {
  // Show conflict distribution per check
  const conflictLines = fs.readFileSync(CONFLICTS_PATH, 'utf8').split('\n').filter(Boolean);
  const perCheck = {};
  for (const line of conflictLines) {
    const c = JSON.parse(line);
    perCheck[c.check] = (perCheck[c.check] || 0) + 1;
  }
  process.stderr.write(`\nConflict distribution:\n`);
  for (const [check, count] of Object.entries(perCheck).sort((a,b) => b[1]-a[1])) {
    process.stderr.write(`  ${check}: ${count}\n`);
  }
}
