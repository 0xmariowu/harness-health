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

function findEntryFile(projectDir) {
  for (const name of ENTRY_FILES) {
    const fullPath = path.join(projectDir, name); // nosemgrep: path-join-resolve-traversal
    if (fs.existsSync(fullPath)) {
      return { name, path: fullPath };
    }
  }
  // Fallback: .cursor/rules/*.mdc
  const cursorRulesDir = path.join(projectDir, '.cursor', 'rules'); // nosemgrep: path-join-resolve-traversal
  try {
    if (fs.existsSync(cursorRulesDir) && fs.statSync(cursorRulesDir).isDirectory()) {
      const entries = fs.readdirSync(cursorRulesDir).filter((n) => n.endsWith('.mdc')).sort();
      if (entries.length > 0) {
        const name = `.cursor/rules/${entries[0]}`;
        return { name, path: path.join(cursorRulesDir, entries[0]) }; // nosemgrep: path-join-resolve-traversal
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

function formatResultAsJsonl(projectName, checkId, checkName, aiResult) {
  const items = [];

  if (checkId === 'D1' && aiResult.contradictions) {
    const count = aiResult.contradictions.length;
    items.push(JSON.stringify({
      project: projectName,
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
    // Mode 2: format AI result into JSONL
    const project = args[args.indexOf('--project') + 1] || 'unknown';
    const checkId = args[args.indexOf('--check') + 1] || 'D1';
    const checkName = PROMPTS[checkId]?.name || checkId;
    const input = fs.readFileSync(0, 'utf8');
    try {
      const result = JSON.parse(input);
      const lines = formatResultAsJsonl(project, checkId, checkName, result);
      lines.forEach(l => process.stdout.write(l + '\n'));
    } catch (e) {
      process.stderr.write(`Failed to parse AI result: ${e.message}\n`);
    }
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
