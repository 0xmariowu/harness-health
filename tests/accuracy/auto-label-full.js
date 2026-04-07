#!/usr/bin/env node
'use strict';

// Deterministic labels for the FULL corpus (~4,533 repos).
// Adapted from auto-label.js but works on corpus directory format
// (no .git/, workflows in workflows/ not .github/workflows/, etc.)
//
// Usage: AL_CORPUS_DIR=/path/to/corpus/repos node auto-label-full.js
// Output: deterministic-labels.jsonl (one JSON line per repo)

const fs = require('fs');
const path = require('path');

const CORPUS = process.env.AL_CORPUS_DIR;
if (!CORPUS) { process.stderr.write('ERROR: Set AL_CORPUS_DIR\n'); process.exit(1); }

const OUT = path.join(__dirname, 'deterministic-labels.jsonl');

function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function dirExists(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function readFile(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

function parseRootTree(repoDir) {
  const treePath = path.join(repoDir, 'root-tree.txt');
  if (!fileExists(treePath)) return { files: [], dirs: [] };
  const lines = readFile(treePath).split('\n').filter(Boolean);
  const files = [];
  const dirs = [];
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const [type, name] = parts;
    if (type === 'file') files.push(name);
    else if (type === 'dir') dirs.push(name);
  }
  return { files, dirs };
}

function listWorkflows(repoDir) {
  const wfDir = path.join(repoDir, 'workflows');
  if (!dirExists(wfDir)) return [];
  try {
    return fs.readdirSync(wfDir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => path.join(wfDir, f));
  } catch { return []; }
}

function labelRepo(repoDir) {
  const labels = {};
  const tree = parseRootTree(repoDir);

  // Find entry file
  let entry = '';
  for (const c of ['CLAUDE.md', 'AGENTS.md']) {
    if (fileExists(path.join(repoDir, c))) { entry = c; break; }
  }
  // .cursorrules: check root-tree since corpus doesn't always extract it
  if (!entry && tree.files.includes('.cursorrules')) entry = '.cursorrules';

  const entryPath = entry ? path.join(repoDir, entry) : null;
  const entryContent = entryPath ? readFile(entryPath) : '';

  // F1: Entry file exists
  labels.F1 = entry ? 'pass' : 'fail';

  // F2: Project description in first 10 lines
  if (entry) {
    const first10 = entryContent.split('\n').slice(0, 10).join('\n');
    labels.F2 = (first10.match(/^#/m) || first10.match(/.{20,}/)) ? 'pass' : 'fail';
  } else { labels.F2 = 'na'; }

  // F3: Conditional loading guidance
  if (entry) {
    labels.F3 = /if.*read|session checklist|checklist/i.test(entryContent) ? 'pass' : 'fail';
  } else { labels.F3 = 'na'; }

  // F4: Word count (measured vs reference ~816)
  if (entry) {
    const words = entryContent.split(/\s+/).filter(Boolean).length;
    labels.F4 = words >= 100 ? 'pass' : 'fail';
  } else { labels.F4 = 'na'; }

  // F5: All markdown link references resolve — in corpus context we can only check partially
  if (entry) {
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let broken = 0;
    let total = 0;
    let match;
    while ((match = linkRegex.exec(entryContent))) {
      const ref = match[2].split('#')[0].trim();
      if (!ref || ref.startsWith('http') || ref.startsWith('mailto:') || ref.startsWith('#')) continue;
      total++;
      // In corpus we don't have full file tree, but root-tree has file listing
      // Only check if referenced path is in root-tree
      if (!tree.files.includes(ref) && !tree.dirs.includes(ref)) {
        // Could be nested — check if any tree entry starts with the ref
        const found = tree.files.some(f => f === ref) || tree.dirs.some(d => d === ref);
        if (!found) broken++;
      }
    }
    if (total === 0) labels.F5 = 'pass';
    else labels.F5 = broken === 0 ? 'pass' : 'fail';
  } else { labels.F5 = 'na'; }

  // F6: Predictable naming — README.md + entry + CHANGELOG.md
  const hasReadme = tree.files.includes('README.md') || fileExists(path.join(repoDir, 'README.md'));
  const hasChangelog = tree.files.includes('CHANGELOG.md');
  labels.F6 = (hasReadme && entry && hasChangelog) ? 'pass' : 'fail';

  // F7: @include directives resolve
  if (entry) {
    const includes = entryContent.split('\n').filter(l => /^@[.~\/]/.test(l));
    if (includes.length === 0) {
      labels.F7 = 'pass';
    } else {
      const broken = includes.filter(l => {
        const p = l.replace(/^@/, '').trim();
        return !tree.files.includes(p) && !tree.dirs.includes(p);
      });
      labels.F7 = broken.length === 0 ? 'pass' : 'fail';
    }
  } else { labels.F7 = 'na'; }

  // I1: Emphasis keywords count
  if (entry) {
    const kwCount = (entryContent.match(/\bIMPORTANT\b/g) || []).length +
                    (entryContent.match(/\bNEVER\b/g) || []).length +
                    (entryContent.match(/\bMUST\b/g) || []).length +
                    (entryContent.match(/\bCRITICAL\b/g) || []).length;
    labels.I1 = kwCount <= 20 ? 'pass' : 'uncertain';
  } else { labels.I1 = 'na'; }

  // I2: Keyword density — needs semantic judgment
  labels.I2 = entry ? 'uncertain' : 'na';

  // I3: Rule specificity (Don't/Because)
  if (entry) {
    const dontLines = (entryContent.match(/^-.*(?:Don't|Do not)/gim) || []).length;
    const becauseLines = (entryContent.match(/Because:/gi) || []).length;
    if (dontLines === 0) labels.I3 = 'uncertain';
    else labels.I3 = becauseLines > 0 ? 'pass' : 'fail';
  } else { labels.I3 = 'na'; }

  // I4: Action-oriented headings — needs judgment
  labels.I4 = entry ? 'uncertain' : 'na';

  // I5: No identity language
  if (entry) {
    labels.I5 = /you are a|act as a|your role is|behave as|you should always/i.test(entryContent) ? 'fail' : 'pass';
  } else { labels.I5 = 'na'; }

  // I6: Entry file length — needs reference comparison
  labels.I6 = entry ? 'uncertain' : 'na';

  // I7: Entry file < 40K chars
  if (entry) {
    labels.I7 = entryContent.length < 40000 ? 'pass' : 'fail';
  } else { labels.I7 = 'na'; }

  // W1: Build/test commands documented
  if (entry) {
    labels.W1 = /`[^`]*(npm|yarn|pnpm|pytest|make|cargo|go |pip |poetry |uv |docker|bun )/i.test(entryContent) ? 'pass' : 'fail';
  } else { labels.W1 = 'na'; }

  // W2: CI workflows exist
  const workflows = listWorkflows(repoDir);
  labels.W2 = workflows.length > 0 ? 'pass' : 'fail';

  // W3: Tests exist — check root-tree for test patterns
  // root-tree only has root-level entries, so nested test dirs won't appear
  const hasTestDir = tree.dirs.some(d => /^tests?$|^spec$|^__tests__$/.test(d));
  const hasTestFile = tree.files.some(f => /\.test\.|\.spec\./.test(f));
  if (hasTestDir || hasTestFile) labels.W3 = 'pass';
  else labels.W3 = 'uncertain'; // Can't confirm absence from root-level tree alone

  // W4: Linter configured
  const linterFiles = ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml',
    'eslint.config.js', 'eslint.config.mjs', '.prettierrc', '.prettierrc.json',
    'pyrightconfig.json', '.rubocop.yml', '.golangci.yml', 'biome.json', 'biome.jsonc'];
  let linterFound = linterFiles.some(f =>
    fileExists(path.join(repoDir, f)) || tree.files.includes(f)
  );
  if (!linterFound) {
    const pyproj = readFile(path.join(repoDir, 'pyproject.toml'));
    if (/\[tool\.ruff\]/.test(pyproj)) linterFound = true;
  }
  labels.W4 = linterFound ? 'pass' : 'fail';

  // W5: No oversized source files — check root-tree sizes
  const sourceExts = /\.(js|ts|py|go|rs|java|json|yaml|yml|md|sh)$/;
  const oversized = tree.files.filter(f => {
    if (!sourceExts.test(f)) return false;
    if (/\.lock$|package-lock/.test(f)) return false;
    // root-tree has size as third column
    return false; // Can't reliably check nested file sizes from root-tree
  });
  labels.W5 = 'uncertain'; // Cannot determine from corpus data alone

  // W6: Pre-commit hooks — check tree for .husky/pre-commit
  const hasHook = tree.dirs.includes('.husky') || tree.files.includes('.husky/pre-commit');
  labels.W6 = hasHook ? 'uncertain' : 'pass';

  // C1: Document freshness — needs git timestamps
  labels.C1 = 'uncertain';

  // C2: Handoff file
  const handoffFiles = ['HANDOFF.md', 'PROGRESS.md', 'TODO.md'];
  labels.C2 = handoffFiles.some(f => tree.files.includes(f)) ? 'pass' : 'fail';

  // C3: Changelog
  if (tree.files.includes('CHANGELOG.md') || fileExists(path.join(repoDir, 'CHANGELOG.md'))) {
    labels.C3 = 'pass';
  } else { labels.C3 = 'fail'; }

  // C4: Plans in repo
  const planDirs = ['docs/plans', '.claude/plans', 'plans', 'docs/exec-plans'];
  labels.C4 = planDirs.some(d => tree.dirs.includes(d)) ? 'pass' : 'fail';

  // C5: CLAUDE.local.md not tracked — no git in corpus, check if file exists
  labels.C5 = tree.files.includes('CLAUDE.local.md') ? 'uncertain' : 'pass';

  // S1: .env in .gitignore
  const gitignoreContent = tree.files.includes('.gitignore')
    ? (readFile(path.join(repoDir, '.gitignore')) || '') : '';
  // In corpus we can't check git tracking, but can check .gitignore
  if (tree.files.includes('.env')) {
    labels.S1 = 'fail'; // .env exists in tree — likely tracked
  } else if (/^\s*\.env\b/m.test(gitignoreContent)) {
    labels.S1 = 'pass';
  } else {
    labels.S1 = 'fail';
  }

  // S2: Actions SHA pinned
  if (workflows.length === 0) {
    labels.S2 = 'pass';
  } else {
    let totalUses = 0;
    let pinnedUses = 0;
    for (const wf of workflows) {
      const content = readFile(wf);
      const usesLines = content.split('\n').filter(l => /uses:\s*\S+/.test(l));
      totalUses += usesLines.length;
      pinnedUses += usesLines.filter(l => /@[0-9a-f]{40}/.test(l)).length;
    }
    if (totalUses === 0) labels.S2 = 'pass';
    else labels.S2 = pinnedUses > 0 ? 'pass' : 'fail';
  }

  // S3: Secret scanning configured
  const hasGitleaks = tree.files.includes('.gitleaks.toml') || fileExists(path.join(repoDir, '.gitleaks.toml'));
  let hasDetectSecrets = false;
  if (tree.files.includes('.pre-commit-config.yaml')) {
    const precommit = readFile(path.join(repoDir, '.pre-commit-config.yaml'));
    if (/gitleaks|detect-secrets/.test(precommit)) hasDetectSecrets = true;
  }
  labels.S3 = (hasGitleaks || hasDetectSecrets) ? 'pass' : 'fail';

  // S4: SECURITY.md
  labels.S4 = tree.files.includes('SECURITY.md') ? 'pass' : 'fail';

  // S5: Workflow permissions
  if (workflows.length === 0) {
    labels.S5 = 'pass';
  } else {
    let overperm = 0;
    for (const wf of workflows) {
      const content = readFile(wf);
      const beforeJobs = content.split(/^jobs:/m)[0] || '';
      if (/contents:\s*write/.test(beforeJobs)) overperm++;
    }
    labels.S5 = overperm === 0 ? 'pass' : 'fail';
  }

  // S6: No hardcoded secrets — can't use git grep, check entry file only
  if (entry) {
    labels.S6 = /sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN.*(PRIVATE|RSA|EC) KEY/.test(entryContent) ? 'fail' : 'uncertain';
  } else { labels.S6 = 'uncertain'; }

  // S7: No personal filesystem paths — check entry file
  if (entry) {
    labels.S7 = /\/Users\/[a-zA-Z]|\/home\/[a-z][a-z0-9_-]+\//.test(entryContent) ? 'fail' : 'uncertain';
  } else { labels.S7 = 'uncertain'; }

  // S8: No pull_request_target in workflows
  if (workflows.length === 0) {
    labels.S8 = 'pass';
  } else {
    let prtCount = 0;
    for (const wf of workflows) {
      const content = readFile(wf);
      if (/pull_request_target/.test(content)) prtCount++;
    }
    labels.S8 = prtCount === 0 ? 'pass' : 'fail';
  }

  return labels;
}

// Main
const reposDirs = fs.readdirSync(CORPUS)
  .filter(d => {
    // Skip non-repo items (files, _scripts, _archive, etc.)
    if (d.startsWith('_') || d.startsWith('.')) return false;
    return dirExists(path.join(CORPUS, d));
  })
  .sort();

process.stderr.write(`Found ${reposDirs.length} repos in corpus\n`);

const fd = fs.openSync(OUT, 'w');
let count = 0;
const stats = { pass: 0, fail: 0, uncertain: 0, na: 0 };

for (const repoName of reposDirs) {
  const repoDir = path.join(CORPUS, repoName);

  // Skip if no _meta.json (not a real repo dir)
  if (!fileExists(path.join(repoDir, '_meta.json'))) continue;

  const labels = labelRepo(repoDir);

  for (const v of Object.values(labels)) stats[v] = (stats[v] || 0) + 1;

  fs.writeSync(fd, JSON.stringify({ repo: repoName, labels }) + '\n');
  count++;

  if (count % 500 === 0) {
    process.stderr.write(`  ${count} repos labeled...\n`);
  }
}

fs.closeSync(fd);

const totalLabels = count * 33;
const uncertainPct = ((stats.uncertain / totalLabels) * 100).toFixed(1);
process.stderr.write(`\nDone: ${count} repos → ${OUT}\n`);
process.stderr.write(`Labels: pass=${stats.pass} fail=${stats.fail} uncertain=${stats.uncertain} (${uncertainPct}%) na=${stats.na}\n`);
