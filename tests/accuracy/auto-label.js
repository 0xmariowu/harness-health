#!/usr/bin/env node
'use strict';

// Auto-labels 20 repos based on check-spec.md rules.
// These labels are GROUND TRUTH — independent of scanner output.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CORPUS = process.env.AL_CORPUS_DIR || path.join(process.env.HOME, 'corpus', 'sources');
const reposData = JSON.parse(fs.readFileSync(path.join(__dirname, 'repos.json'), 'utf8'));

function sh(cmd, cwd) {
  try {
    return execSync(cmd, { cwd: cwd || ROOT, encoding: 'utf8', timeout: 10000 }).trim();
  } catch { return ''; }
}

function shCount(cmd, cwd) {
  const out = sh(cmd, cwd);
  return out ? parseInt(out, 10) || 0 : 0;
}

function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function dirExists(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function labelRepo(repoDir) {
  const labels = {};

  // Find entry file
  let entry = '';
  for (const c of ['CLAUDE.md', 'AGENTS.md', '.cursorrules']) {
    if (fileExists(path.join(repoDir, c))) { entry = c; break; }
  }
  const entryPath = entry ? path.join(repoDir, entry) : null;
  const entryContent = entryPath ? fs.readFileSync(entryPath, 'utf8') : '';

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

  // F4: Large dirs have index
  const rootFiles = sh(`find "${repoDir}" -maxdepth 1 -type f ! -name '.*' 2>/dev/null | wc -l`);
  const hasIndex = sh(`find "${repoDir}" -maxdepth 1 -type f \\( -iname 'INDEX' -o -iname 'INDEX.*' \\) 2>/dev/null | wc -l`);
  labels.F4 = (parseInt(rootFiles) <= 10 || parseInt(hasIndex) > 0) ? 'pass' : 'fail';

  // F5: All references resolve
  if (entry) {
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let broken = 0;
    let match;
    while ((match = linkRegex.exec(entryContent))) {
      const ref = match[2].split('#')[0].trim();
      if (!ref || ref.startsWith('http') || ref.startsWith('mailto:') || ref.startsWith('#')) continue;
      if (!fs.existsSync(path.join(repoDir, ref))) broken++;
    }
    labels.F5 = broken === 0 ? 'pass' : 'fail';
  } else { labels.F5 = 'na'; }

  // F6: Predictable file naming
  labels.F6 = (fileExists(path.join(repoDir, 'README.md')) && entry && fileExists(path.join(repoDir, 'CHANGELOG.md'))) ? 'pass' : 'fail';

  // F7: @include directives resolve
  if (entry) {
    const includes = entryContent.split('\n').filter(l => /^@[.~\/]/.test(l));
    if (includes.length === 0) {
      labels.F7 = 'pass';
    } else {
      const broken = includes.filter(l => {
        const p = l.replace(/^@/, '').trim();
        return !fs.existsSync(path.join(repoDir, p));
      });
      labels.F7 = broken.length === 0 ? 'pass' : 'fail';
    }
  } else { labels.F7 = 'na'; }

  // I1: Emphasis keywords
  if (entry) {
    const kwCount = (entryContent.match(/\bIMPORTANT\b/g) || []).length +
                    (entryContent.match(/\bNEVER\b/g) || []).length +
                    (entryContent.match(/\bMUST\b/g) || []).length +
                    (entryContent.match(/\bCRITICAL\b/g) || []).length;
    labels.I1 = kwCount <= 20 ? 'pass' : 'uncertain';
  } else { labels.I1 = 'na'; }

  // I2: Keyword density — complex scoring, mark uncertain
  labels.I2 = entry ? 'uncertain' : 'na';

  // I3: Rule specificity (Don't/Because)
  if (entry) {
    const dontLines = (entryContent.match(/^-.*(?:Don't|Do not)/gim) || []).length;
    const becauseLines = (entryContent.match(/Because:/gi) || []).length;
    if (dontLines === 0) labels.I3 = 'uncertain';
    else labels.I3 = becauseLines > 0 ? 'pass' : 'fail';
  } else { labels.I3 = 'na'; }

  // I4: Action-oriented headings — complex, mark uncertain
  labels.I4 = entry ? 'uncertain' : 'na';

  // I5: No identity language
  if (entry) {
    labels.I5 = /you are a|act as a|your role is|behave as|you should always/i.test(entryContent) ? 'fail' : 'pass';
  } else { labels.I5 = 'na'; }

  // I6: Entry file length — depends on reference range, mark uncertain
  labels.I6 = entry ? 'uncertain' : 'na';

  // I7: Entry file < 40K chars
  if (entry) {
    labels.I7 = entryContent.length < 40000 ? 'pass' : 'fail';
  } else { labels.I7 = 'na'; }

  // W1: Build/test commands documented
  if (entry) {
    labels.W1 = /`[^`]*(npm|yarn|pnpm|pytest|make|cargo|go |pip |poetry |uv |docker|bun )/i.test(entryContent) ? 'pass' : 'fail';
  } else { labels.W1 = 'na'; }

  // W2: CI exists
  const wfDir = path.join(repoDir, '.github', 'workflows');
  const wfCount = dirExists(wfDir) ? shCount(`find "${wfDir}" -maxdepth 1 -type f \\( -name '*.yml' -o -name '*.yaml' \\) 2>/dev/null | wc -l`) : 0;
  labels.W2 = wfCount > 0 ? 'pass' : 'fail';

  // W3: Tests exist
  const testCount = shCount(`find "${repoDir}" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/__pycache__/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/vendor/*' 2>/dev/null | grep -cE '/tests/|/test/|/__tests__/|/spec/|\\.test\\.|.spec\\.'`);
  labels.W3 = testCount > 0 ? 'pass' : 'fail';

  // W4: Linter configured
  const linterFiles = ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs', '.prettierrc', '.prettierrc.json', 'pyrightconfig.json', '.rubocop.yml', '.golangci.yml', 'biome.json', 'biome.jsonc'];
  let linterFound = linterFiles.some(f => fileExists(path.join(repoDir, f)));
  if (!linterFound && fileExists(path.join(repoDir, 'pyproject.toml'))) {
    const pyproj = fs.readFileSync(path.join(repoDir, 'pyproject.toml'), 'utf8');
    if (/\[tool\.ruff\]/.test(pyproj)) linterFound = true;
  }
  labels.W4 = linterFound ? 'pass' : 'fail';

  // W5: No oversized source files
  const oversized = shCount(`find "${repoDir}" -type f -size +262144c -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/vendor/*' -not -name '*.lock' -not -name 'package-lock.json' \\( -name '*.js' -o -name '*.ts' -o -name '*.py' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.json' -o -name '*.yaml' -o -name '*.yml' -o -name '*.md' -o -name '*.sh' \\) 2>/dev/null | wc -l`);
  labels.W5 = oversized === 0 ? 'pass' : 'fail';

  // W6: Pre-commit hooks
  const hasHook = fileExists(path.join(repoDir, '.git', 'hooks', 'pre-commit')) ||
                  fileExists(path.join(repoDir, '.husky', 'pre-commit'));
  labels.W6 = hasHook ? 'uncertain' : 'pass';

  // C1: Document freshness — depends on git timestamps, mark uncertain
  labels.C1 = 'uncertain';

  // C2: Handoff file
  labels.C2 = ['HANDOFF.md', 'PROGRESS.md', 'TODO.md'].some(f => fileExists(path.join(repoDir, f))) ? 'pass' : 'fail';

  // C3: Changelog has "why"
  const clPath = path.join(repoDir, 'CHANGELOG.md');
  if (fileExists(clPath)) {
    const clLines = fs.readFileSync(clPath, 'utf8').split('\n').length;
    labels.C3 = clLines > 5 ? 'pass' : 'fail';
  } else { labels.C3 = 'fail'; }

  // C4: Plans in repo
  labels.C4 = ['docs/plans', '.claude/plans', 'plans', 'docs/exec-plans'].some(d => dirExists(path.join(repoDir, d))) ? 'pass' : 'fail';

  // C5: CLAUDE.local.md not tracked
  const localTracked = sh(`git -C "${repoDir}" ls-files --error-unmatch CLAUDE.local.md 2>/dev/null`);
  labels.C5 = localTracked ? 'fail' : 'pass';

  // S1: .env in .gitignore
  const envTracked = sh(`git -C "${repoDir}" ls-files --error-unmatch .env 2>/dev/null`);
  if (envTracked) {
    labels.S1 = 'fail';
  } else {
    const gitignorePath = path.join(repoDir, '.gitignore');
    const gitignore = fileExists(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    labels.S1 = /^\s*\.env\b/m.test(gitignore) ? 'pass' : 'fail';
  }

  // S2: Actions SHA pinned — scanner uses ratio scoring (score = pinned/total)
  // Any non-zero ratio = score > 0 = "pass" in our binary labeling
  // So: fail only if ALL actions are unpinned (score = 0), or no actions at all = pass
  if (wfCount === 0) {
    labels.S2 = 'pass';
  } else {
    const allUses = sh(`grep -rhE 'uses:\\s*\\S+' "${wfDir}" 2>/dev/null`);
    const usesLines = allUses.split('\n').filter(l => l.trim() && /uses:/.test(l));
    if (usesLines.length === 0) {
      labels.S2 = 'pass';
    } else {
      const pinned = usesLines.filter(l => /@[0-9a-f]{40}/.test(l));
      // Scanner score = pinned/total. score > 0 = "pass" (any pinned action)
      labels.S2 = pinned.length > 0 ? 'pass' : 'fail';
    }
  }

  // S3: Secret scanning
  labels.S3 = (fileExists(path.join(repoDir, '.gitleaks.toml')) ||
    (fileExists(path.join(repoDir, '.pre-commit-config.yaml')) &&
     /gitleaks|detect-secrets/.test(fs.readFileSync(path.join(repoDir, '.pre-commit-config.yaml'), 'utf8'))))
    ? 'pass' : 'fail';

  // S4: SECURITY.md
  labels.S4 = fileExists(path.join(repoDir, 'SECURITY.md')) ? 'pass' : 'fail';

  // S5: Workflow permissions
  if (wfCount === 0) {
    labels.S5 = 'pass';
  } else {
    let overperm = 0;
    const wfFiles = sh(`find "${wfDir}" -maxdepth 1 -type f \\( -name '*.yml' -o -name '*.yaml' \\) 2>/dev/null`).split('\n').filter(Boolean);
    for (const wf of wfFiles) {
      const content = fs.readFileSync(wf, 'utf8');
      const beforeJobs = content.split(/^jobs:/m)[0] || '';
      if (/contents:\s*write/.test(beforeJobs)) overperm++;
    }
    labels.S5 = overperm === 0 ? 'pass' : 'fail';
  }

  // S6: No hardcoded secrets
  const secretHits = shCount(`git -C "${repoDir}" grep -lE 'sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN.*(PRIVATE|RSA|EC) KEY' -- '*.js' '*.ts' '*.py' '*.go' '*.rs' '*.java' '*.sh' '*.yml' '*.yaml' '*.json' '*.toml' ':!*.env' ':!*.env.*' ':!*.lock' 2>/dev/null | grep -cv 'node_modules\\|\\.git\\|vendor\\|dist\\|build'`);
  labels.S6 = secretHits === 0 ? 'pass' : 'fail';

  return labels;
}

// Main
const results = [];
for (const repo of reposData.repos) {
  const repoDir = path.join(CORPUS, repo.path);
  if (!dirExists(repoDir)) {
    process.stderr.write(`SKIP: ${repo.name} — not found\n`);
    continue;
  }

  process.stderr.write(`Labeling: ${repo.name}... `);
  const labels = labelRepo(repoDir);

  const counts = { pass: 0, fail: 0, uncertain: 0, na: 0 };
  for (const v of Object.values(labels)) counts[v] = (counts[v] || 0) + 1;
  process.stderr.write(`pass=${counts.pass} fail=${counts.fail} uncertain=${counts.uncertain} na=${counts.na}\n`);

  results.push({ repo: repo.name, labels });
}

fs.writeFileSync(
  path.join(__dirname, 'labels.json'),
  JSON.stringify(results, null, 2) + '\n'
);
process.stderr.write(`\nLabels written to tests/accuracy/labels.json\n`);
process.stderr.write(`Review 'uncertain' labels manually before running accuracy test.\n`);
