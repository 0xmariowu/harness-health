#!/usr/bin/env node
'use strict';

/**
 * deep-analyzer.js — AI-powered rule quality analysis
 *
 * This script is NOT run standalone. It generates the prompts and
 * expected output format for the Claude Code skill to use when
 * spawning subagents for deep analysis.
 *
 * The skill (al.md) runs this to get:
 * 1. Which files to analyze
 * 2. The prompt for each file
 * 3. How to format results as JSONL
 *
 * Usage: node deep-analyzer.js --project-dir <path>
 * Output: JSON with analysis tasks
 */

const fs = require('fs');
const path = require('path');

const ENTRY_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  'GEMINI.md',
  '.windsurfrules',
  '.clinerules',
];

const PROMPTS = {
  D1: {
    name: 'Contradictory rules',
    prompt: `Read this file and find CONTRADICTORY rules — rules that conflict with each other.

For each contradiction found, output:
- rule_a: the first rule (quoted)
- rule_b: the conflicting rule (quoted)
- explanation: why they contradict (1 sentence)

Be STRICT. Only flag clear contradictions, not style differences.
If no contradictions found, output an empty array.

RESPOND WITH ONLY A VALID JSON OBJECT:
{"contradictions": [{"rule_a": "...", "rule_b": "...", "explanation": "..."}]}`,
  },
  D2: {
    name: 'Dead-weight rules',
    prompt: `Read this file and find DEAD-WEIGHT rules — rules that any good AI model would follow WITHOUT being told.

Examples of dead weight:
- "Use descriptive variable names" (models already do this)
- "Follow coding conventions" (models already do this)
- "Write clean code" (too vague to affect behavior)

For each dead-weight rule, output:
- rule: the rule (quoted)
- reason: why it's dead weight (1 sentence)

Apply the deletion test: if you removed this rule, would AI behavior actually change? If not, it's dead weight.

RESPOND WITH ONLY A VALID JSON OBJECT:
{"dead_weight": [{"rule": "...", "reason": "..."}]}`,
  },
  D3: {
    name: 'Vague rules without decision boundary',
    prompt: `Read this file and find VAGUE rules — rules too abstract to act on because they lack a clear decision boundary.

Examples of vague rules:
- "Follow security best practices" (what specific practices?)
- "Be careful with destructive operations" (careful how?)
- "Write good tests" (what makes a test good?)

For each vague rule, output:
- rule: the rule (quoted)
- problem: what's missing (1 sentence)
- suggestion: how to make it specific (1 sentence)

RESPOND WITH ONLY A VALID JSON OBJECT:
{"vague_rules": [{"rule": "...", "problem": "...", "suggestion": "..."}]}`,
  },
};

function isRegularFile(filePath) {
  try {
    const lstat = fs.lstatSync(filePath);
    return lstat.isFile() && !lstat.isSymbolicLink();
  } catch (_) {
    return false;
  }
}

function findEntryFile(projectDir) {
  for (const name of ENTRY_FILES) {
    const fullPath = path.join(projectDir, name); // nosemgrep: path-join-resolve-traversal
    if (isRegularFile(fullPath)) {
      return { name, path: fullPath };
    }
  }
  // Fallback: .cursor/rules/*.mdc — skip symlinked directories and non-regular files.
  const cursorRulesDir = path.join(projectDir, '.cursor', 'rules'); // nosemgrep: path-join-resolve-traversal
  try {
    if (fs.existsSync(cursorRulesDir)) {
      const lstat = fs.lstatSync(cursorRulesDir);
      if (lstat.isDirectory() && !lstat.isSymbolicLink()) {
        const entries = fs.readdirSync(cursorRulesDir).filter((n) => n.endsWith('.mdc')).sort();
        for (const e of entries) {
          const mdcPath = path.join(cursorRulesDir, e); // nosemgrep: path-join-resolve-traversal
          if (isRegularFile(mdcPath)) {
            return { name: `.cursor/rules/${e}`, path: mdcPath };
          }
        }
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

function generateTasks(projectDir) {
  const projectName = path.basename(projectDir);
  const entry = findEntryFile(projectDir);

  if (!entry) {
    return {
      project: projectName,
      entry_file: null,
      tasks: [],
      note: 'No entry file found — skip deep analysis',
    };
  }

  const content = fs.readFileSync(entry.path, 'utf8');
  const tasks = [];

  for (const [checkId, config] of Object.entries(PROMPTS)) {
    tasks.push({
      check_id: checkId,
      name: config.name,
      entry_file: entry.name,
      entry_path: entry.path,
      prompt: config.prompt + '\n\nFILE CONTENT:\n```\n' + content + '\n```',
      output_format: 'json',
    });
  }

  return {
    project: projectName,
    entry_file: entry.name,
    tasks,
  };
}

function formatResultAsJsonl(projectName, projectPath, checkId, checkName, aiResult) {
  const items = [];

  if (checkId === 'D1' && aiResult.contradictions) {
    const count = aiResult.contradictions.length;
    items.push(JSON.stringify({
      project: projectName,
      project_path: projectPath || null,
      dimension: 'deep',
      check_id: 'D1',
      name: 'Contradictory rules',
      measured_value: count,
      reference_value: 0,
      score: count === 0 ? 1 : 0,
      detail: count === 0
        ? 'No contradictions found'
        : `${count} contradictions: ${aiResult.contradictions.map(c => c.explanation).join('; ').slice(0, 200)}`,
      evidence_id: 'D1',
    }));
  }

  if (checkId === 'D2' && aiResult.dead_weight) {
    const count = aiResult.dead_weight.length;
    items.push(JSON.stringify({
      project: projectName,
      project_path: projectPath || null,
      dimension: 'deep',
      check_id: 'D2',
      name: 'Dead-weight rules',
      measured_value: count,
      reference_value: 0,
      score: count === 0 ? 1 : Math.max(0, 1 - count * 0.2),
      detail: count === 0
        ? 'No dead-weight rules found'
        : `${count} dead-weight rules: ${aiResult.dead_weight.map(d => d.rule.slice(0, 40)).join('; ').slice(0, 200)}`,
      evidence_id: 'D2',
    }));
  }

  if (checkId === 'D3' && aiResult.vague_rules) {
    const count = aiResult.vague_rules.length;
    items.push(JSON.stringify({
      project: projectName,
      project_path: projectPath || null,
      dimension: 'deep',
      check_id: 'D3',
      name: 'Vague rules',
      measured_value: count,
      reference_value: 0,
      score: count === 0 ? 1 : Math.max(0, 1 - count * 0.15),
      detail: count === 0
        ? 'No vague rules found'
        : `${count} vague rules: ${aiResult.vague_rules.map(v => v.rule.slice(0, 40)).join('; ').slice(0, 200)}`,
      evidence_id: 'D3',
    }));
  }

  return items;
}

function main() {
  const args = process.argv.slice(2);
  const projectDirIdx = args.indexOf('--project-dir');
  const projectDir = projectDirIdx >= 0 ? args[projectDirIdx + 1] : null;
  const formatResults = args.includes('--format-result');

  if (formatResults) {
    // Mode 2: format AI result into JSONL.
    // --check must be one of the supported Deep check IDs. Prior behavior
    // defaulted to 'D1' on missing --check and accepted D4 / lowercase /
    // garbage silently (expectedKey = undefined made the validation branch
    // short-circuit false), producing empty output with exit 0. Validate
    // strictly up front.
    const VALID_CHECK_IDS = new Set(['D1', 'D2', 'D3']);
    const checkIdx = args.indexOf('--check');
    const checkId = checkIdx >= 0 ? args[checkIdx + 1] : undefined;
    if (!VALID_CHECK_IDS.has(checkId)) {
      process.stderr.write(
        `deep-analyzer: --check must be one of ${[...VALID_CHECK_IDS].join(', ')} ` +
        `(got ${JSON.stringify(checkId)})\n`,
      );
      process.exit(1);
    }
    const projectIdx = args.indexOf('--project');
    const project = projectIdx >= 0 ? args[projectIdx + 1] : 'unknown';
    // project_path carries the absolute repo dir so downstream scorer +
    // plan-generator can disambiguate same-basename repos (org1/app vs
    // org2/app). Optional — legacy callers that don't pass it get null
    // in the emitted records, which matches pre-project_path behavior.
    const projectPathIdx = args.indexOf('--project-path');
    const projectPath = projectPathIdx >= 0 ? args[projectPathIdx + 1] : null;
    const checkName = PROMPTS[checkId]?.name || checkId;
    const input = fs.readFileSync(0, 'utf8');
    let result;
    try {
      result = JSON.parse(input);
    } catch (e) {
      // Fail loudly — silently dropping bad AI output would let regressions
      // slip through. See docs/post-remediation-deep-review.md Low #5.
      process.stderr.write(`deep-analyzer: failed to parse AI result: ${e.message}\n`);
      process.exit(1);
    }
    // The scorer needs at least the expected key (contradictions / dead_weight /
    // vague_rules) to produce a record. Missing key = AI drift or prompt break;
    // exit non-zero so callers notice.
    const expectedKey = { D1: 'contradictions', D2: 'dead_weight', D3: 'vague_rules' }[checkId];
    if (!Array.isArray(result && result[expectedKey])) {
      process.stderr.write(
        `deep-analyzer: ${checkId} result missing required array key '${expectedKey}' ` +
        `(got keys: ${Object.keys(result || {}).join(', ') || 'none'})\n`,
      );
      process.exit(1);
    }
    const lines = formatResultAsJsonl(project, projectPath, checkId, checkName, result);
    lines.forEach((l) => process.stdout.write(l + '\n'));
    return;
  }

  if (!projectDir) {
    process.stderr.write('Usage: deep-analyzer.js --project-dir <path>\n');
    process.stderr.write('       deep-analyzer.js --format-result --project <name> --check <D1|D2|D3> < ai-output.json\n');
    process.exit(1);
  }

  const tasks = generateTasks(projectDir);
  process.stdout.write(JSON.stringify(tasks, null, 2) + '\n');
}

main();
