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

function findRuleFiles(repoDir) {
  const dirs = [
    path.join(repoDir, '.claude', 'rules'),
    path.join(repoDir, 'rules'),
  ];
  const files = [];
  for (const ruleDir of dirs) {
    if (!dirExists(ruleDir)) continue;
    try {
      for (const file of fs.readdirSync(ruleDir)) {
        if (file.endsWith('.md')) files.push(path.join(ruleDir, file));
      }
    } catch { /* ignore */ }
  }
  return files;
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
  // Aligned with scanner's has_project_description(): skips H1 headings, list items,
  // code fences. Passes on blockquote (>) or any plain text line.
  if (entry) {
    const lines = entryContent.split('\n').slice(0, 10);
    let found = false;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('## ')) break; // sub-heading = stop
      if (t.startsWith('# ') || t.startsWith('#\t')) continue; // H1 = skip
      if (/^[-*] |^```|^[1-9]\. /.test(t)) continue; // list/fence = skip
      if (t.startsWith('>') || t.length > 0) { found = true; break; } // blockquote or plain text = pass
    }
    labels.F2 = found ? 'pass' : 'fail';
  } else { labels.F2 = 'na'; }

  // F3: Conditional loading guidance
  if (entry) {
    labels.F3 = /if.*read|session checklist|checklist/i.test(entryContent) ? 'pass' : 'fail';
  } else { labels.F3 = 'na'; }

  // F4: Root directory navigability — aligned with scanner logic
  // Scanner checks: root-level non-hidden files ≤ 10 OR has INDEX file
  const rootFiles = tree.files.filter(f => !f.startsWith('.') && !f.includes('/'));
  const hasIndex = rootFiles.some(f => /^index(\.|$)/i.test(f));
  labels.F4 = (rootFiles.length <= 10 || hasIndex) ? 'pass' : 'fail';

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

  // W1: Build/test commands documented — aligned with scanner's extract_command_matches()
  // Scanner checks for these exact command strings (case-insensitive):
  if (entry) {
    const lower = entryContent.toLowerCase();
    const cmds = ['npm test','pnpm test','yarn test','bun test','pytest','uv run pytest',
      'make test','make build','cargo test','cargo build','go test','go build',
      'npm run build','pnpm build','yarn build','bun run build','tox','just test'];
    labels.W1 = cmds.some(c => lower.includes(c)) ? 'pass' : 'fail';
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

  // C6: HANDOFF.md contains verify conditions (not just status)
  // Conservative parser: require at least two recognizable verify-condition signals.
  const handoffPath = path.join(repoDir, 'HANDOFF.md');
  if (fileExists(handoffPath)) {
    const handoffContent = readFile(handoffPath);
    const verifyCount = (handoffContent.match(/(READY|PASS|verified|assert|verify:|[0-9]+\/[0-9]+\s*(✅|🟢)|[0-9]+\.[0-9]+\/[0-9]+)/gi) || []).length;
    labels.C6 = verifyCount >= 2 ? 'pass' : 'fail';
  } else {
    labels.C6 = 'fail';
  }

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

  // S3: Secret scanning configured — aligned with scanner
  // Scanner checks: .gitleaks.toml exists, OR gitleaks in .pre-commit-config.yaml, OR gitleaks in workflows
  const hasGitleaks = tree.files.includes('.gitleaks.toml') || fileExists(path.join(repoDir, '.gitleaks.toml'));
  let hasDetectSecrets = false;
  if (tree.files.includes('.pre-commit-config.yaml')) {
    const precommit = readFile(path.join(repoDir, '.pre-commit-config.yaml'));
    if (/gitleaks|detect-secrets/.test(precommit)) hasDetectSecrets = true;
  }
  // Also check workflows for gitleaks (scanner does this too)
  let gitleaksInWorkflow = false;
  for (const wf of workflows) {
    if (/gitleaks/.test(readFile(wf))) { gitleaksInWorkflow = true; break; }
  }
  labels.S3 = (hasGitleaks || hasDetectSecrets || gitleaksInWorkflow) ? 'pass' : 'fail';

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

  // S6: No hardcoded secrets — scanner greps ALL source files,
  // but corpus only has entry file. Always uncertain (scope mismatch).
  labels.S6 = 'uncertain';

  // S7: No personal filesystem paths — scanner greps ALL source files,
  // but corpus only has entry file. Always uncertain (scope mismatch).
  labels.S7 = 'uncertain';

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

  // S9: No personal email in git history
  // Cannot be determined from corpus snapshot (no .git directory).
  labels.S9 = 'na';

  // F8: Rule files use globs: frontmatter (not paths:)
  // Reads rules/*.md from corpus repo, parses YAML frontmatter.
  // pass  = no .claude/rules/ dir, OR no scoped files, OR all scoped files use globs:
  // fail  = any scoped file uses paths: (deprecated) instead of globs:
  // score = fraction of scoped files that use globs:
  const ruleFiles = findRuleFiles(repoDir);
  if (ruleFiles.length === 0) {
    labels.F8 = 'pass'; // N/A: no rules directory
  } else {
    let f8TotalScoped = 0;
    let f8UsesGlobs = 0;
    try {
      for (const rf of ruleFiles) {
        const rfContent = readFile(rf);
        const rfLines = rfContent.split('\n');
        let inFm = false;
        let hasScope = false;
        let hasGlobs = false;
        for (const line of rfLines) {
          if (line.trim() === '---') {
            if (inFm) break;
            inFm = true;
            continue;
          }
          if (!inFm) continue;
          if (line.startsWith('paths:')) hasScope = true;
          else if (line.startsWith('globs:')) { hasScope = true; hasGlobs = true; }
        }
        if (hasScope) {
          f8TotalScoped++;
          if (hasGlobs) f8UsesGlobs++;
        }
      }
    } catch { /* ignore read errors */ }
    labels.F8 = (f8TotalScoped > 0 && f8UsesGlobs === f8TotalScoped) ? 'pass' : 'fail';
    if (f8TotalScoped === 0) labels.F8 = 'pass';
  }

  // F9: No unfilled template placeholders in entry file
  // Checks for [your X], <your X>, TODO:, FIXME:, Not configured patterns
  // Aligned with scanner's F9 grep patterns.
  if (entry) {
    const bracketRe = /\[(你的|your |project |框架|版本|app |name)[^\]]*\](?!\()/i;
    const angleRe = /<(your|project|app|framework)[^>]*>/i;
    const markerRe = /^[ \t]*(Not configured|TODO:|FIXME:|XXX:)/im;
    const hasPlaceholder = bracketRe.test(entryContent) || angleRe.test(entryContent) || markerRe.test(entryContent);
    labels.F9 = hasPlaceholder ? 'fail' : 'pass';
  } else {
    labels.F9 = 'na'; // No entry file
  }

  // I8: Total injected content within budget
  // Counts non-empty lines in entry file + AGENTS.md (if different) + rules/*.md
  // Reference range: 60-200 non-empty lines (from standards/reference-thresholds.json)
  // pass  = within reference range
  // fail  = score 0 (extremely low or extremely high)
  // Note: we only mark pass/fail for clear cases; intermediate scores use 'uncertain'
  {
    let i8Total = 0;
    if (entry) {
      const nonEmpty = entryContent.split('\n').filter(l => l.trim().length > 0).length;
      i8Total += nonEmpty;
    }
      // Also count AGENTS.md if different from entry
      if (entry !== 'AGENTS.md' && fileExists(path.join(repoDir, 'AGENTS.md'))) {
        const agentsContent = readFile(path.join(repoDir, 'AGENTS.md'));
        const nonEmpty = agentsContent.split('\n').filter(l => l.trim().length > 0).length;
        i8Total += nonEmpty;
      }
    // Count rules/*.md or .claude/rules/*.md
    const i8RuleFiles = findRuleFiles(repoDir);
    for (const rf of i8RuleFiles) {
      const rfContent = readFile(rf);
      if (!rfContent) continue;
      const nonEmpty = rfContent.split('\n').filter(l => l.trim().length > 0).length;
      i8Total += nonEmpty;
    }
    // Score against reference range [60, 200]
    // Score function mirrors scanner's score_range: 1 at center, tapers at edges, 0 outside
    if (i8Total === 0) {
      labels.I8 = 'fail'; // No content at all
    } else if (i8Total >= 60 && i8Total <= 200) {
      labels.I8 = 'pass'; // Within reference range
    } else {
      labels.I8 = 'fail';
    }
  }

  // W7: Local fast test command documented
  if (entry) {
    const hasHeading = /^##\s*(local\s+test|test\s+(command|run)|before\s+push)/im.test(entryContent);
    const hasCommand = /(pytest|npm\s+test|pnpm\s+test|bun\s+test|xcodebuild\s+test|cargo\s+test|go\s+test|jest|vitest|rspec|\bbash\s+tests?\/|npm\s+run\s+test|pnpm\s+run\s+test|bun\s+run\s+test)/i.test(entryContent);
    labels.W7 = (hasHeading && hasCommand) ? 'pass' : 'fail';
  } else { labels.W7 = 'na'; }

  // W8: npm test script exists (JS/Node projects)
  const packageJsonPath = path.join(repoDir, 'package.json');
  if (!fileExists(packageJsonPath)) {
    labels.W8 = 'na';
  } else {
    try {
      const pkg = JSON.parse(readFile(packageJsonPath) || '{}');
      const scripts = pkg && pkg.scripts ? pkg.scripts : {};
      labels.W8 = (scripts && typeof scripts.test === 'string') ? 'pass' : 'fail';
    } catch {
      labels.W8 = 'fail';
    }
  }

  // W9: Release workflow validates version consistency
  if (workflows.length === 0) {
    labels.W9 = 'pass';
  } else {
    const releaseWorkflow = workflows
      .slice()
      .sort()
      .find(wf => /(release|publish)/i.test(path.basename(wf)));
    if (!releaseWorkflow) {
      labels.W9 = 'pass';
    } else {
      const wfContent = readFile(releaseWorkflow);
      const hasTagExtract = /(ref_name|GITHUB_REF|github\.ref|TAG=|tag_name)/.test(wfContent);
      const hasVersionCompare = /(pyproject\.toml|package\.json|version\.py|Cargo\.toml|build\.gradle)/.test(wfContent);
      labels.W9 = hasTagExtract && hasVersionCompare ? 'pass' : 'fail';
    }
  }

  // W10: Test cost tiers defined (pytest markers)
  const pyprojectPath = path.join(repoDir, 'pyproject.toml');
  const pytestIniPath = path.join(repoDir, 'pytest.ini');
  const setupCfgPath = path.join(repoDir, 'setup.cfg');
  if (!fileExists(pyprojectPath) && !fileExists(pytestIniPath) && !fileExists(setupCfgPath)) {
    labels.W10 = 'na';
  } else {
    let markerSource = '';
    if (fileExists(pyprojectPath)) markerSource = readFile(pyprojectPath);
    else if (fileExists(pytestIniPath)) markerSource = readFile(pytestIniPath);
    else markerSource = readFile(setupCfgPath);

    let markerCount = (markerSource.match(/^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*:/gm) || []).length;
    if (fileExists(pyprojectPath) && /^\s*markers\s*=\s*\[/m.test(markerSource)) {
      let inMarkers = false;
      let quotedCount = 0;
      for (const line of markerSource.split('\n')) {
        if (!inMarkers) {
          if (/^\s*markers\s*=\s*\[/.test(line)) {
            inMarkers = true;
            if (/\]/.test(line)) {
              quotedCount += (line.match(/["']\w+[^"']*["']\s*:/g) || []).length;
              break;
            }
            continue;
          }
        } else {
          if (/^\s*\]/.test(line)) break;
          if (/^\s*["']/.test(line)) quotedCount += 1;
        }
      }
      markerCount = Math.max(markerCount, quotedCount);
    }
    labels.W10 = markerCount >= 3 ? 'pass' : 'fail';
  }

  // W11: feat/fix commits paired with test commits (test-required gate)
  const testRequiredYml = path.join(repoDir, 'workflows', 'test-required.yml');
  const testRequiredYaml = path.join(repoDir, 'workflows', 'test-required.yaml');
  const testRequiredPath = fileExists(testRequiredYml) ? testRequiredYml : (fileExists(testRequiredYaml) ? testRequiredYaml : '');
  if (!testRequiredPath) {
    labels.W11 = 'fail';
  } else {
    labels.W11 = /exit[ \t]+1/.test(readFile(testRequiredPath)) ? 'pass' : 'fail';
  }

  // H1-H6: Harness checks (require .claude/settings.json)
  // The corpus does NOT extract settings.json (confirmed: 0 of 4,533 repos have it).
  // We label based on _meta.json presence indicator:
  //   settings == false → scanner safe-defaults to pass → label 'pass' (tests no-settings path)
  //   settings == true  → actual settings.json content unavailable in corpus snapshot
  let metaSettings = false;
  try {
    const meta = JSON.parse(readFile(path.join(repoDir, '_meta.json')));
    metaSettings = !!(meta && meta.files && meta.files.settings);
  } catch { /* default false */ }

  if (metaSettings) {
    // Settings.json exists but not available — cannot label content-dependent checks
    labels.H1 = 'na';
    labels.H2 = 'na';
    labels.H3 = 'na';
    labels.H4 = 'na';
    labels.H5 = 'na';
    labels.H6 = 'na';
  } else {
    // No settings.json: scanner returns score=1 for all H checks ("No settings.json")
    // These should all pass
    labels.H1 = 'pass';
    labels.H2 = 'pass';
    labels.H3 = 'pass';
    labels.H4 = 'pass';
    labels.H5 = 'pass';
    labels.H6 = 'pass';
  }

  // H7: Gate workflows are blocking (not warn-only)
  if (workflows.length === 0) {
    labels.H7 = 'pass';
  } else {
    const gateWorkflows = workflows.filter(w => /(required|gate|test-required|size|check)/i.test(path.basename(w)));
    if (gateWorkflows.length === 0) {
      labels.H7 = 'pass';
    } else {
      const warnOnly = gateWorkflows.filter(w => !/exit[ \t]+1/.test(readFile(w))).length;
      labels.H7 = warnOnly === 0 ? 'pass' : 'fail';
    }
  }

  // H8: Hook errors use structured format (what/rule/fix)
  const hookCandidates = tree.files.filter(p => (p.startsWith('.husky/') || p.startsWith('hooks/')) && !/\.(md|json|lock)$/.test(p));
  if (hookCandidates.length === 0) {
    labels.H8 = 'pass';
  } else {
    let h8Structured = false;
    for (const rel of hookCandidates) {
      const hookContent = readFile(path.join(repoDir, rel));
      if (/Rule:/.test(hookContent) && /Fix:/.test(hookContent)) {
        h8Structured = true;
        break;
      }
    }
    labels.H8 = h8Structured ? 'pass' : 'fail';
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

const totalLabels = count * 60; // 60 checks total (adds C6, H7-H8, S9, W7-W11, plus existing)
const uncertainPct = ((stats.uncertain / totalLabels) * 100).toFixed(1);
process.stderr.write(`\nDone: ${count} repos → ${OUT}\n`);
process.stderr.write(`Labels: pass=${stats.pass} fail=${stats.fail} uncertain=${stats.uncertain} (${uncertainPct}%) na=${stats.na}\n`);
