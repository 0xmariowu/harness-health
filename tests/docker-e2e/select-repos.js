#!/usr/bin/env node
'use strict';

// Selects 15 repos from corpus for Docker E2E testing.
// Tier A (5): high stars, CLAUDE.md, workflows, linter config
// Tier B (5): medium stars, partial infrastructure
// Tier C (5): low stars or no CLAUDE.md, minimal infrastructure

const fs = require('fs');
const path = require('path');

if (!process.env.AL_CORPUS_DIR) { process.stderr.write('ERROR: Set AL_CORPUS_DIR to your corpus directory\n'); process.exit(1); }
const CORPUS = process.env.AL_CORPUS_DIR;

if (!fs.existsSync(CORPUS)) {
  process.stderr.write('Corpus not found at: ' + CORPUS + '\n');
  process.stderr.write('Set AL_CORPUS_DIR to point to your corpus/repos directory.\n');
  process.exit(1);
}

const repos = [];
for (const name of fs.readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, name);
  if (!fs.statSync(dir).isDirectory()) continue;

  const metaPath = path.join(dir, '_meta.json');
  if (!fs.existsSync(metaPath)) continue;

  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const files = fs.readdirSync(dir);

  repos.push({
    name,
    stars: meta.stars || 0,
    lang: meta.lang || 'unknown',
    description: (meta.description || '').slice(0, 80),
    has_claude: files.includes('CLAUDE.md'),
    has_agents: files.includes('AGENTS.md'),
    has_workflows: files.includes('workflows'),
    has_package_json: files.includes('package.json'),
    has_pyproject: files.includes('pyproject.toml'),
    has_cargo: files.includes('Cargo.toml'),
    has_go_mod: files.includes('go.mod'),
    has_root_tree: files.includes('root-tree.txt'),
    has_rules: files.includes('rules'),
    has_settings: files.includes('settings.json'),
    corpus_files: files,
  });
}

repos.sort((a, b) => b.stars - a.stars);

// Select Tier A: top stars with full infrastructure
const tierA = repos
  .filter(r => r.stars > 10000 && r.has_claude && r.has_workflows && r.has_root_tree)
  .slice(0, 8);

// Select Tier B: medium stars, has entry file
const tierB = repos
  .filter(r => r.stars >= 500 && r.stars <= 10000 && (r.has_claude || r.has_agents) && r.has_root_tree)
  .filter(r => !tierA.find(a => a.name === r.name))
  .slice(0, 8);

// Select Tier C: low stars or no entry file
const tierC = repos
  .filter(r => (!r.has_claude && !r.has_agents) || r.stars < 100)
  .filter(r => r.has_root_tree)
  .filter(r => !tierA.find(a => a.name === r.name) && !tierB.find(b => b.name === r.name))
  .slice(0, 8);

// Pick 5 from each with language diversity
function pickDiverse(pool, n) {
  const picked = [];
  const langs = new Set();

  // First pass: one per language
  for (const r of pool) {
    if (picked.length >= n) break;
    if (!langs.has(r.lang)) {
      picked.push(r);
      langs.add(r.lang);
    }
  }
  // Fill remaining
  for (const r of pool) {
    if (picked.length >= n) break;
    if (!picked.find(p => p.name === r.name)) {
      picked.push(r);
    }
  }
  return picked;
}

const selectedA = pickDiverse(tierA, 5);
const selectedB = pickDiverse(tierB, 5);
const selectedC = pickDiverse(tierC, 5);

const selected = [
  ...selectedA.map(r => ({ ...r, tier: 'A' })),
  ...selectedB.map(r => ({ ...r, tier: 'B' })),
  ...selectedC.map(r => ({ ...r, tier: 'C' })),
];

// Output
const output = {
  description: 'Selected repos for Docker E2E testing (from claude-repo corpus)',
  generated: new Date().toISOString().split('T')[0],
  repos: selected.map(r => ({
    name: r.name,
    tier: r.tier,
    stars: r.stars,
    lang: r.lang,
    has_claude: r.has_claude,
    has_agents: r.has_agents,
    has_workflows: r.has_workflows,
    corpus_files: r.corpus_files.filter(f => !f.endsWith('.history.json') && f !== '_other' && f !== '_meta.json'),
  })),
};

const outPath = path.join(__dirname, 'selected-repos.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');

process.stderr.write('Selected ' + selected.length + ' repos:\n');
for (const r of selected) {
  process.stderr.write(`  [${r.tier}] ${r.name.padEnd(45)} ${String(r.stars).padStart(6)} stars  ${r.lang}\n`);
}
process.stderr.write('\nWritten to: ' + outPath + '\n');
