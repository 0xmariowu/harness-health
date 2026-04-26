#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DEFAULT_PROJECTS_ROOT = process.env.PROJECTS_ROOT ? process.env.PROJECTS_ROOT : expandPath('~/Projects');
// Session-root is resolved lazily inside run(); module-level resolution would
// lock the analyzer to the developer's own ~/.claude/projects and break tests
// that want to point at a fixture (tests pass HOME=fixture, but module-level
// expandPath captures HOME at require time).
const DEFAULT_SESSION_ROOT = '~/.claude/projects';
const DEFAULT_MAX_SESSIONS = 30;
const MIN_SUBSTRING_LEN = 20;
const CORRECTION_PATTERNS = [
  /\bno\b/i,
  /\bwrong\b/i,
  /\bnot that\b/i,
  /\bi said\b/i,
  /\bstop\b/i,
  /\bthat's not right\b/i,
  /\bthats not right\b/i,
  /\bnot correct\b/i,
  /\btry again\b/i,
  /\bnot right\b/i,
];
const INSTRUCTION_PATTERNS = [
  /\balways\b/i,
  /\bnever\b/i,
  /\bdont\b/i,
  /\bdon't\b/i,
  /\bmake sure\b/i,
  /\bremember to\b/i,
];
const TOOL_USE_PATTERN = /\b(run|npm|pnpm|yarn|node|python|pytest|make|docker|git|curl|bash|sh|cat|ls|find|grep|sed|awk|rm|cp|mv|touch|tee|mkdir|rmdir|python3|npm run)\b/i;
const SESSION_STOP_WORDS = new Set([
  'the', 'and', 'that', 'with', 'from', 'this', 'they', 'have', 'been', 'were', 'what', 'just', 'they', 'when',
  'where', 'your', 'you', 'are', 'was', 'for', 'not', 'out', 'into', 'about', 'them', 'then', 'than', 'its', 'our',
  'all', 'any', 'can', 'has', 'had', 'but', 'anyway', 'maybe', 'only', 'still', 'very', 'well', 'like',
]);

function expandPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return process.cwd();
  if (inputPath === '~') return process.env.HOME || process.cwd();
  if (inputPath.startsWith('~/')) {
    const home = process.env.HOME || '';
    return path.join(home, inputPath.slice(2)); // nosemgrep: path-join-resolve-traversal
  }
  return path.resolve(inputPath); // nosemgrep: path-join-resolve-traversal
}

function usage() {
  const lines = [
    'Usage: node src/session-analyzer.js [options]',
    '  --projects-root PATH      Root to discover CLAUDE.md/AGENTS.md (default: ~/Projects)',
    '  --session-root PATH       Root to read session logs (default: ~/.claude/projects)',
    '  --max-sessions N          Most recent .jsonl session files to scan (default: 30)',
    '  --include-global          Emit global (unscoped) findings even when no matching',
    '                            project is found. Default: skip global findings unless a',
    '                            session matches at least one project in --projects-root.',
    '  --include-unmatched       Carry sessions with no project match through into',
    '                            project-level aggregation as projectMapping=null. Default:',
    '                            drop them entirely (P0-8 strict matching, 2026-04-26).',
    '  --include-raw-snippets    Include raw user-prompt fragments in output. Default:',
    '                            redact to a short hash + length + occurrence count, so',
    '                            analysis output is safe to paste into issues / reports.',
    '                            Even with this flag, unmatched sessions stay redacted.',
  ];
  process.stderr.write(lines.join('\n') + '\n');
}

function parseArgs(argv) {
  const options = {
    projectsRoot: DEFAULT_PROJECTS_ROOT,
    sessionRoot: expandPath(DEFAULT_SESSION_ROOT),
    maxSessions: DEFAULT_MAX_SESSIONS,
    includeGlobal: false,
    includeRawSnippets: false,
    includeUnmatched: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--projects-root') {
      const next = argv[i + 1];
      if (!next) {
        usage();
        throw new Error('Missing value for --projects-root');
      }
      options.projectsRoot = expandPath(next);
      i += 1;
      continue;
    }
    if (arg === '--session-root') {
      const next = argv[i + 1];
      if (!next) {
        usage();
        throw new Error('Missing value for --session-root');
      }
      options.sessionRoot = expandPath(next);
      i += 1;
      continue;
    }
    if (arg === '--max-sessions') {
      const next = argv[i + 1];
      if (!next) {
        usage();
        throw new Error('Missing value for --max-sessions');
      }
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        usage();
        throw new Error('Invalid value for --max-sessions');
      }
      options.maxSessions = parsed;
      i += 1;
      continue;
    }
    if (arg === '--include-global') {
      options.includeGlobal = true;
      continue;
    }
    if (arg === '--include-unmatched') {
      options.includeUnmatched = true;
      continue;
    }
    if (arg === '--include-raw-snippets') {
      options.includeRawSnippets = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    usage();
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

// Redact a raw instruction/rule string for default output. The hash lets
// downstream tools deduplicate occurrences across runs without exposing the
// user's actual prompt. `--include-raw-snippets` bypasses this redaction when
// a trusted operator wants the text (e.g. debugging locally).
function redactSnippet(text) {
  const str = String(text || '');
  const hash = crypto.createHash('sha256').update(str).digest('hex').slice(0, 8);
  return `[redacted ${str.length}ch #${hash}]`;
}

// P0-8 (2026-04-26): unmatched sessions are forced through the redactor
// regardless of --include-raw-snippets. Combined with the default drop in
// the main loop (above), this keeps cross-project prompt fragments out of
// reports even when the caller passes both --include-unmatched and
// --include-raw-snippets together.
function displaySnippet(text, includeRaw, opts) {
  const fromUnmatched = !!(opts && opts.fromUnmatched);
  if (fromUnmatched) return redactSnippet(text);
  return includeRaw ? String(text || '') : redactSnippet(text);
}

function isJsonlSessionFile(fileName) {
  return path.extname(fileName).toLowerCase() === '.jsonl';
}

function sanitizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function collectSessionFiles(root, maxSessions) {
  if (!fs.existsSync(root)) {
    process.stderr.write(`WARN: session root missing: ${root}\n`);
    return [];
  }

  const discovered = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      process.stderr.write(`WARN: cannot list ${current}: ${error.message}\n`);
      continue;
    }

    for (const entry of entries) {
      const next = path.join(current, entry.name); // nosemgrep: path-join-resolve-traversal
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile() && isJsonlSessionFile(entry.name)) {
        try {
          const stat = fs.statSync(next);
          discovered.push({ file: next, mtime: stat.mtimeMs });
        } catch (error) {
          process.stderr.write(`WARN: cannot stat ${next}: ${error.message}\n`);
        }
      }
    }
  }

  discovered.sort((a, b) => b.mtime - a.mtime);
  return discovered.slice(0, Math.max(0, maxSessions)).map((item) => item.file);
}

function splitProjectRules(filePath) {
  let content;
  try {
    content = readTextFile(filePath);
  } catch (error) {
    process.stderr.write(`WARN: cannot read entry file ${filePath}: ${error.message}\n`);
    return [];
  }

  const rules = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.trim().match(/^-\s*(don't|dont|NEVER|IMPORTANT)\b:?[\s-]*(.*)$/i);
    if (!match) continue;
    const fullText = line.trim().replace(/^\s*-\s*/, '');
    const topic = (match[2] || '').trim();
    const normalizedTopic = normalizeWords(topic);
    const keywords = normalizedTopic
      ? normalizedTopic.split(/\s+/).filter((word) => !SESSION_STOP_WORDS.has(word) && word.length >= 3)
      : [];
    rules.push({
      text: fullText,
      topic,
      normalizedTopic,
      keywords,
    });
  }

  return rules;
}

function loadProjectCatalog(projectsRoot) {
  const catalog = [];
  if (!fs.existsSync(projectsRoot)) {
    process.stderr.write(`WARN: projects root missing: ${projectsRoot}\n`);
    return catalog;
  }

  // Walk up to 4 levels deep to match scanner.sh's discover_projects
  // (`find ... -maxdepth 4 -name .git`). A one-level readdir missed
  // nested layouts like $PROJECTS_ROOT/org1/app — Session silently
  // skipped them even though the scanner found them, leaving the two
  // analyzers out of sync on what projects exist.
  const MAX_DEPTH = 4;
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '__pycache__']);
  const projectDirs = [];
  function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    // A dir containing a `.git` file/dir IS the project — don't descend further.
    const hasGit = entries.some((e) => e.name === '.git');
    if (hasGit) {
      projectDirs.push(dir);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1); // nosemgrep: path-join-resolve-traversal
    }
  }

  let rootEntries;
  try {
    rootEntries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch (error) {
    process.stderr.write(`WARN: cannot read projects root ${projectsRoot}: ${error.message}\n`);
    return catalog;
  }

  // Root itself might be a project too (PROJECTS_ROOT pointed at a single repo).
  if (rootEntries.some((e) => e.name === '.git')) {
    projectDirs.push(projectsRoot);
  } else {
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(projectsRoot, entry.name), 1); // nosemgrep: path-join-resolve-traversal
    }
  }

  for (const projectDir of projectDirs) {
    const claudePath = path.join(projectDir, 'CLAUDE.md'); // nosemgrep: path-join-resolve-traversal
    const agentsPath = path.join(projectDir, 'AGENTS.md'); // nosemgrep: path-join-resolve-traversal
    // Reject symlinked entry files — they can leak arbitrary host files
    // into session analysis output.
    const isReg = (p) => {
      try {
        const s = fs.lstatSync(p);
        return s.isFile() && !s.isSymbolicLink();
      } catch (_) { return false; }
    };
    const entryFile = isReg(claudePath) ? claudePath : isReg(agentsPath) ? agentsPath : null;
    if (!entryFile) continue;

    const rules = splitProjectRules(entryFile);
    if (!rules.length) continue;

    const basename = path.basename(projectDir);
    const aliases = new Set([
      sanitizeKey(projectDir),
      sanitizeKey(basename),
      sanitizeKey(path.basename(projectDir)),
    ]);
    catalog.push({
      name: basename,
      dir: projectDir,
      entryFile,
      rules,
      aliases: Array.from(aliases),
    });
  }

  return catalog;
}

function projectFromSessionDir(filePath, sessionRoot) {
  const rel = path.relative(sessionRoot, filePath);
  const segments = rel.split(path.sep);
  return segments[0] || 'global';
}

// Claude encodes project paths in ~/.claude/projects/<encoded>/ by replacing
// / with -. Decoder reverses this so we can compare canonical filesystem
// paths instead of substring-matching encoded names.
function decodeSessionProject(sessionProject) {
  if (typeof sessionProject !== 'string' || !sessionProject) return '';
  if (sessionProject.startsWith('-')) {
    return '/' + sessionProject.slice(1).replace(/-/g, '/');
  }
  return sessionProject.replace(/-/g, '/');
}

function safeRealpath(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

// Match a Claude session's encoded project name against the project catalog.
// P0-8 (2026-04-26): replaces the previous substring scoring (which let a
// short project name like "app" be claimed by an unrelated long session
// like "other-application") with strict identity matching:
//   1. realpath-canonical equality between the decoded session path and a
//      catalog entry's directory.
//   2. exact-equality on the sanitized alias (no .includes() fallback).
// Returns null when nothing matches; the caller decides whether to drop
// the session or honor an explicit --include-unmatched opt-in.
function matchProjectFromCatalog(sessionProject, catalog) {
  const sessionKey = sanitizeKey(sessionProject);
  if (!sessionKey) return null;

  const decodedPath = decodeSessionProject(sessionProject);
  const realDecoded = decodedPath ? safeRealpath(decodedPath) : '';

  for (const project of catalog) {
    const realProject = safeRealpath(project.dir);
    if (decodedPath && (realProject === realDecoded || project.dir === decodedPath)) {
      return project;
    }
    for (const alias of project.aliases) {
      if (alias && alias === sessionKey) return project;
    }
  }

  return null;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeWords(value) {
  return normalizeText(value).replace(/[^a-z0-9 ]/g, ' ');
}

// System/noise patterns to filter from user messages
const NOISE_PATTERNS = [
  /^<[a-z-]+>/i,           // XML-like system tags (<task-notification>, <system-reminder>)
  /^<\/[a-z-]+>/i,         // Closing tags
  /^─{4,}/,                // Separator lines
  /^={4,}/,                // Separator lines
  /^-{4,}/,                // Separator lines
  /^\*{4,}/,               // Separator lines
  /^#{4,}\s*$/,            // Heading-only lines
  /^UserPromptSubmit/,     // Hook output
  /^SessionStart/,         // Hook output
  /^OK$/,                  // Hook acknowledgment
  /^Tool loaded/,          // System message
];

function isNoise(text) {
  if (!text || text.length < 5) return true;
  return NOISE_PATTERNS.some(p => p.test(text.trim()));
}

function extractMessageText(record) {
  if (!record || typeof record !== 'object') return '';
  const message = record.message;
  if (!message) return '';

  const content = message.content;
  let text = '';
  if (typeof content === 'string') {
    text = content.trim();
  } else if (Array.isArray(content)) {
    const chunks = [];
    for (const block of content) {
      if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        chunks.push(block.text);
      }
    }
    text = chunks.join('\n').trim();
  }

  // Strip system-reminder blocks from text
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

  // Filter noise
  if (isNoise(text)) return '';

  return text;
}

function detectRole(record) {
  if (!record || typeof record !== 'object') return '';
  if (typeof record.type === 'string' && record.type.trim()) return record.type.trim().toLowerCase();
  if (record.message && typeof record.message.role === 'string') return record.message.role.trim().toLowerCase();
  return '';
}

function containsPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function hasCorrection(text) {
  return containsPattern(text, CORRECTION_PATTERNS);
}

function hasInstruction(text) {
  return containsPattern(text, INSTRUCTION_PATTERNS);
}

function hasToolUse(text) {
  return TOOL_USE_PATTERN.test(text);
}

function extractWindowText(entries, centerIdx) {
  const selected = [];
  if (entries[centerIdx - 1]) selected.push(entries[centerIdx - 1].normalized);
  if (entries[centerIdx]) selected.push(entries[centerIdx].normalized);
  if (entries[centerIdx + 1]) selected.push(entries[centerIdx + 1].normalized);
  return selected.join('\n');
}

async function parseSessionFile(filePath) {
  return new Promise((resolve) => {
    const entries = [];
    let parsedLines = 0;
    let parsedErrors = 0;

    let stream;
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    } catch (error) {
      process.stderr.write(`WARN: cannot open ${filePath}: ${error.message}\n`);
      resolve(null);
      return;
    }

    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      const text = line.trim();
      if (!text) return;
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        parsedErrors += 1;
        process.stderr.write(`WARN: malformed jsonl line in ${filePath}: ${error.message}\n`);
        return;
      }
      parsedLines += 1;
      const role = detectRole(payload);
      const messageText = extractMessageText(payload);
      if (!messageText) return;
      entries.push({
        role,
        text: messageText,
        normalized: normalizeText(messageText),
      });
    });

    rl.on('close', () => {
      if (parsedLines === 0 && parsedErrors > 0) {
        process.stderr.write(`WARN: no readable messages in ${filePath}\n`);
      }
      resolve(entries);
    });

    rl.on('error', (error) => {
      process.stderr.write(`WARN: failed to read ${filePath}: ${error.message}\n`);
      resolve(null);
    });
  });
}

function extractSubstrings(text, minLength = MIN_SUBSTRING_LEN) {
  const tokens = new Set();
  const normalized = normalizeText(text);
  if (normalized.length < minLength) return tokens;

  const step = Math.max(5, Math.floor(minLength / 4));
  for (let i = 0; i + minLength <= normalized.length; i += step) {
    tokens.add(normalized.slice(i, i + minLength));
  }
  const tailStart = normalized.length - minLength;
  if (tailStart > 0) tokens.add(normalized.slice(tailStart));
  return tokens;
}

class UnionFind {
  constructor(size) {
    this.parent = new Array(size);
    this.rank = new Array(size);
    for (let i = 0; i < size; i += 1) {
      this.parent[i] = i;
      this.rank[i] = 0;
    }
  }

  find(index) {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }
    return this.parent[index];
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
      return;
    }

    if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
      return;
    }

    this.parent[rootB] = rootA;
    this.rank[rootA] += 1;
  }
}

function buildClusters(records, minSubstringLen = MIN_SUBSTRING_LEN) {
  const normalizedRecords = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || typeof record.text !== 'string') continue;
    const normalized = normalizeText(record.text);
    if (normalized.length < minSubstringLen) continue;
    normalizedRecords.push({
      ...record,
      index,
      normalized,
    });
  }

  const count = normalizedRecords.length;
  if (count < 2) return [];

  const dsu = new UnionFind(count);
  const tokenToRecords = new Map();
  const tokensByRecord = new Array(count);

  for (let i = 0; i < count; i += 1) {
    const record = normalizedRecords[i];
    const tokens = extractSubstrings(record.normalized, minSubstringLen);
    tokensByRecord[i] = tokens;
    for (const token of tokens) {
      const bucket = tokenToRecords.get(token);
      if (!bucket) {
        tokenToRecords.set(token, [i]);
      } else {
        bucket.push(i);
      }
    }
  }

  for (const bucket of tokenToRecords.values()) {
    if (bucket.length < 2) continue;
    const head = bucket[0];
    for (let i = 1; i < bucket.length; i += 1) {
      dsu.union(head, bucket[i]);
    }
  }

  const grouped = new Map();
  for (let i = 0; i < count; i += 1) {
    const root = dsu.find(i);
    const current = grouped.get(root) || [];
    current.push(i);
    grouped.set(root, current);
  }

  const clusters = [];
  for (const indices of grouped.values()) {
    if (indices.length < 2) continue;

    const sessionSet = new Set();
    const tokenStats = new Map();
    for (const idx of indices) {
      const record = normalizedRecords[idx];
      sessionSet.add(record.sessionId);
      for (const token of tokensByRecord[idx]) {
        let stat = tokenStats.get(token);
        if (!stat) {
          stat = { sessions: new Set(), occurrences: 0 };
          tokenStats.set(token, stat);
        }
        stat.occurrences += 1;
        stat.sessions.add(record.sessionId);
      }
    }

    if (sessionSet.size < 2) continue;

    let bestToken = null;
    let bestSessionCount = 0;
    let bestOccurrences = 0;
    for (const [token, stat] of tokenStats.entries()) {
      const sessionCount = stat.sessions.size;
      if (sessionCount > bestSessionCount || (sessionCount === bestSessionCount && stat.occurrences > bestOccurrences)) {
        bestToken = token;
        bestSessionCount = sessionCount;
        bestOccurrences = stat.occurrences;
      }
    }

    if (!bestToken) continue;

    clusters.push({
      instruction: bestToken,
      count: indices.length,
      sessions: sessionSet.size,
      sessionSet,
      records: indices.map((idx) => normalizedRecords[idx]),
    });
  }

  return clusters;
}

function buildS1Findings(sessions, options) {
  const records = [];
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (entry.role !== 'user') continue;
      records.push({
        sessionId: session.id,
        text: entry.text,
        project: session.project,
        project_path: session.project_path,
        unmatched: !!session.unmatched,
      });
    }
  }

  const clusters = buildClusters(records, MIN_SUBSTRING_LEN);
  clusters.sort((a, b) => b.sessions - a.sessions || b.count - a.count);

  const includeRaw = Boolean(options && options.includeRawSnippets);
  return clusters.map((cluster) => {
    const fromUnmatched = cluster.records.some((r) => r.unmatched);
    const shown = displaySnippet(cluster.instruction, includeRaw, { fromUnmatched });
    let project = null;
    let projectPath = null;

    for (const rec of cluster.records) {
      if (!rec.project_path) {
        project = null;
        projectPath = null;
        break;
      }
      if (projectPath === null) {
        projectPath = rec.project_path;
        project = rec.project || null;
        continue;
      }
      if (projectPath !== rec.project_path) {
        project = null;
        projectPath = null;
        break;
      }
    }

    return {
      project,
      project_path: projectPath,
      dimension: 'session',
      check_id: 'SS1',
      name: 'Repeated instructions',
      measured_value: {
        instruction: shown,
        count: cluster.count,
        sessions: cluster.sessions,
      },
      score: 0,
      detail: `Repeated instruction ${shown} seen in ${cluster.sessions} sessions (${cluster.count} times)`,
      evidence_id: 'SS1',
    };
  });
}

function buildS4Findings(sessions, options) {
  const records = [];
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (entry.role !== 'user') continue;
      if (!hasInstruction(entry.normalized)) continue;
      records.push({
        sessionId: session.id,
        text: entry.text,
        project: session.project,
        project_path: session.project_path,
        project_entry: session.project_entry,
        unmatched: !!session.unmatched,
      });
    }
  }

  const clusters = buildClusters(records, MIN_SUBSTRING_LEN);
  clusters.sort((a, b) => b.sessions - a.sessions || b.count - a.count);

  const includeRaw = Boolean(options && options.includeRawSnippets);
  return clusters.map((cluster) => {
    const fromUnmatched = cluster.records.some((r) => r.unmatched);
    let project = null;
    let projectPath = null;

    for (const rec of cluster.records) {
      if (!rec.project_path) {
        project = null;
        projectPath = null;
        break;
      }
      if (projectPath === null) {
        projectPath = rec.project_path;
        project = rec.project || null;
        continue;
      }
      if (projectPath !== rec.project_path) {
        project = null;
        projectPath = null;
        break;
      }
    }

    return {
      project,
      project_path: projectPath,
      dimension: 'session',
      check_id: 'SS4',
      name: 'Missing rule suggestions',
      measured_value: {
        suggested_rule: displaySnippet(cluster.instruction, includeRaw, { fromUnmatched }),
        count: cluster.count,
        sessions: cluster.sessions,
      },
      score: 0,
      detail: `Suggested CLAUDE.md rule from repeated instruction ${displaySnippet(cluster.instruction, includeRaw, { fromUnmatched })}`,
      evidence_id: 'SS4',
    };
  });
}

function ruleMatchesContext(rule, context) {
  if (!rule || !context) return false;
  const normalizedContext = normalizeText(context);
  if (!normalizedContext) return false;
  if (!rule.normalizedTopic) {
    return normalizedContext.includes(normalizeText(rule.text));
  }

  for (const keyword of rule.keywords) {
    if (normalizedContext.includes(` ${keyword} `)) {
      return true;
    }
    if (normalizedContext.startsWith(`${keyword} `) || normalizedContext.endsWith(` ${keyword}`)) return true;
    if (normalizedContext === keyword) return true;
  }
  return false;
}

function buildS2Findings(sessions, catalog, options) {
  if (!catalog.length) return [];
  const includeRaw = Boolean(options && options.includeRawSnippets);

  const hits = new Map();

  for (const session of sessions) {
    const project = session.project_entry;
    if (!project || !project.rules.length) continue;
    const entries = session.entries;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry.role !== 'user') continue;
      if (!hasCorrection(entry.normalized)) continue;
      const context = extractWindowText(entries, i);
      if (!hasToolUse(context)) continue;

      for (const rule of project.rules) {
        if (!ruleMatchesContext(rule, context)) continue;
        const key = `${project.dir}\u0000${rule.text}`;
        const hit = hits.get(key) || {
          project: project.name,
          project_path: project.dir,
          rule: rule.text,
          count: 0,
          sessions: new Set(),
        };
        hit.count += 1;
        hit.sessions.add(session.id);
        hits.set(key, hit);
      }
    }
  }

  return Array.from(hits.values())
    .filter((hit) => hit.count > 0)
    .sort((a, b) => b.sessions.size - a.sessions.size || b.count - a.count)
    .map((hit) => {
      const shownRule = displaySnippet(hit.rule, includeRaw);
      return {
        project: hit.project,
        project_path: hit.project_path,
        dimension: 'session',
        check_id: 'SS2',
        name: 'Ignored rules',
        measured_value: {
          rule: shownRule,
          violations: hit.count,
          sessions: hit.sessions.size,
        },
        score: 0,
        detail: `Potentially ignored rule in ${hit.project}: ${shownRule} (${hit.count} matching corrections in ${hit.sessions.size} sessions)`,
        evidence_id: 'SS2',
      };
    });
}

function buildS3Findings(sessions) {
  if (!sessions.length) return [];

  let totalFriction = 0;
  let totalSessions = 0;
  const projectStats = new Map();

  for (const session of sessions) {
    const project = session.project_path ? session.project : null;
    const projectPath = session.project_path || null;
    const projectKey = projectPath || `global:${session.project || 'global'}`;
    const friction = session.friction;
    totalFriction += friction;
    totalSessions += 1;
    const current = projectStats.get(projectKey) || {
      project,
      project_path: projectPath,
      friction: 0,
      sessions: 0,
    };
    current.friction += friction;
    current.sessions += 1;
    projectStats.set(projectKey, current);
  }

  if (totalSessions === 0) return [];
  const globalAverage = totalFriction / totalSessions;
  const findings = [];

  for (const stat of projectStats.values()) {
    if (!stat.sessions) continue;
    const avg = stat.friction / stat.sessions;
    if (avg > globalAverage && stat.friction > 0) {
      findings.push({
        project: stat.project,
        project_path: stat.project_path,
        dimension: 'session',
        check_id: 'SS3',
        name: 'Friction hotspots',
        measured_value: {
          project: stat.project,
          project_path: stat.project_path,
          friction_count: stat.friction,
          session_count: stat.sessions,
        },
        score: 0,
        detail: `Above-average friction in ${stat.project || 'global'}: ${avg.toFixed(2)} corrections/session (global ${globalAverage.toFixed(2)})`,
        evidence_id: 'SS3',
      });
    }
  }

  return findings.sort((a, b) => b.measured_value.friction_count - a.measured_value.friction_count);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  const sessionFiles = collectSessionFiles(options.sessionRoot, options.maxSessions);
  if (!sessionFiles.length) {
    return;
  }

  const catalog = loadProjectCatalog(options.projectsRoot);
  const sessions = [];
  let matchedAnyProject = false;

  for (const filePath of sessionFiles) {
    const entries = await parseSessionFile(filePath);
    if (!entries || !entries.length) continue;

    const sessionProject = projectFromSessionDir(filePath, options.sessionRoot);
    const projectMapping = matchProjectFromCatalog(sessionProject, catalog);
    if (projectMapping) matchedAnyProject = true;
    // P0-8 (2026-04-26): drop sessions that did not match any catalog
    // project unless the caller explicitly opted in via --include-unmatched.
    // Without this gate, short project names absorbed unrelated sessions
    // and leaked their content into the wrong project's report.
    if (!projectMapping && !options.includeUnmatched) {
      continue;
    }
    const friction = entries.reduce((count, entry) => {
      if (entry.role === 'user' && hasCorrection(entry.normalized)) return count + 1;
      return count;
    }, 0);

    sessions.push({
      id: filePath,
      projectRaw: sessionProject,
      project: projectMapping ? projectMapping.name : null,
      project_path: projectMapping ? projectMapping.dir : null,
      project_entry: projectMapping,
      entries,
      friction,
      unmatched: !projectMapping,
    });
  }

  // Privacy gate: when the catalog has no matching projects and the caller
  // did not explicitly opt in via --include-global, emit nothing. This keeps
  // test runs on clean checkouts (and ad-hoc invocations with empty
  // --projects-root) from leaking the developer's own ~/.claude/projects
  // text into shared artifacts.
  if (!matchedAnyProject && !options.includeGlobal) {
    return;
  }

  const findings = [
    ...buildS1Findings(sessions, options),
    ...buildS2Findings(sessions, catalog, options),
    ...buildS3Findings(sessions),
    ...buildS4Findings(sessions, options),
  ];

  // Emit "ran, no issue" sentinels for any SS check that produced no
  // findings. Without this, a clean repo (sessions scanned, nothing
  // flagged) produces zero session records — scorer's `state.checks.length
  // > 0` test then marks Session as `not_run` and score_scope stays
  // `core` even though the user explicitly selected Session. That made
  // "Session selected but clean" indistinguishable from "Session not
  // selected", collapsing a real product distinction.
  const SS_CHECK_NAMES = {
    SS1: 'Repeated instructions',
    SS2: 'Ignored rules',
    SS3: 'Friction hotspots',
    SS4: 'Missing rule suggestions',
  };
  const reportedCheckIds = new Set(findings.map((f) => f.check_id));
  for (const checkId of Object.keys(SS_CHECK_NAMES)) {
    if (reportedCheckIds.has(checkId)) continue;
    process.stdout.write(`${JSON.stringify({
      project: null,
      project_path: null,
      dimension: 'session',
      check_id: checkId,
      name: SS_CHECK_NAMES[checkId],
      score: 1,
      detail: 'No issues found in analyzed sessions',
      evidence_id: checkId,
    })}\n`);
  }

  for (const record of findings) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
}

run().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
});
