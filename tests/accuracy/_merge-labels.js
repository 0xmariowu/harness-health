#!/usr/bin/env node
'use strict';

// Merge selected deterministic labels into labels-full.jsonl.
// Adds only the requested new checks and marks them as source "deterministic".
//
// Usage: node _merge-labels.js
// Inputs:
//   deterministic-labels.jsonl
//   labels-full.jsonl
// Output:
//   labels-full.jsonl (updated in place)

const fs = require('fs');
const path = require('path');

const LABELS_PATH = path.join(__dirname, 'labels-full.jsonl');
const DET_PATH = path.join(__dirname, 'deterministic-labels.jsonl');
const OUT_PATH = path.join(__dirname, 'labels-full.jsonl');

const NEW_CHECKS = [
  'C6',
  'F8', 'F9',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8',
  'I8',
  'S9',
  'W7', 'W8', 'W9', 'W10', 'W11'
];

function loadJsonl(filePath) {
  const map = {};
  const content = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  for (const line of content) {
    const entry = JSON.parse(line);
    map[entry.repo] = entry;
  }
  return map;
}

const baseMap = loadJsonl(LABELS_PATH);
const detMap = loadJsonl(DET_PATH);
let touched = 0;
let updated = 0;

const out = [];

for (const [repo, baseEntry] of Object.entries(baseMap)) {
  touched++;
  const det = detMap[repo];
  if (!det) {
    out.push(JSON.stringify(baseEntry));
    continue;
  }
  const mergedLabels = { ...(baseEntry.labels || {}) };
  const mergedSource = { ...(baseEntry.source || {}) };
  let repoUpdated = 0;

  for (const check of NEW_CHECKS) {
    if (det.labels && Object.prototype.hasOwnProperty.call(det.labels, check)) {
      mergedLabels[check] = det.labels[check];
      mergedSource[check] = 'deterministic';
      repoUpdated++;
    }
  }

  if (repoUpdated > 0) updated++;
  out.push(JSON.stringify({
    ...baseEntry,
    labels: mergedLabels,
    source: mergedSource
  }));
}

fs.writeFileSync(OUT_PATH, out.join('\n') + '\n');

process.stderr.write(`Repos processed: ${touched}\n`);
process.stderr.write(`Repos updated: ${updated}\n`);
