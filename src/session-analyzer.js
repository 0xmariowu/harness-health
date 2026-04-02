#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DEFAULT_PROJECTS_ROOT = expandPath('~/Projects');
const CLAUDE_PROJECTS_ROOT = expandPath('~/.claude/projects');
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
    return path.join(home, inputPath.slice(2));
  }
  return path.resolve(inputPath);
}

function usage() {
  const lines = [
    'Usage: node src/session-analyzer.js [--projects-root PATH] [--max-sessions N]',
    '  --projects-root PATH   Root path to search for CLAUDE.md / AGENTS.md files (default: ~/Projects)',
    '  --max-sessions N       Most recent .jsonl session files to scan (default: 30)',
  ];
  process.stderr.write(lines.join('\n') + '\n');
}

function parseArgs(argv) {
  const options = {
    projectsRoot: DEFAULT_PROJECTS_ROOT,
    maxSessions: DEFAULT_MAX_SESSIONS,
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
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    usage();
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
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
      const next = path.join(current, entry.name);
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

  let entries;
  try {
    entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch (error) {
    process.stderr.write(`WARN: cannot read projects root ${projectsRoot}: ${error.message}\n`);
    return catalog;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(projectsRoot, entry.name);
    const claudePath = path.join(projectDir, 'CLAUDE.md');
    const agentsPath = path.join(projectDir, 'AGENTS.md');
    const entryFile = fs.existsSync(claudePath) ? claudePath : fs.existsSync(agentsPath) ? agentsPath : null;
    if (!entryFile) continue;

    const rules = splitProjectRules(entryFile);
    if (!rules.length) continue;

    const basename = entry.name;
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

function projectFromSessionDir(filePath) {
  const rel = path.relative(CLAUDE_PROJECTS_ROOT, filePath);
  const segments = rel.split(path.sep);
  return segments[0] || 'global';
}

function matchProjectFromCatalog(sessionProject, catalog) {
  const sessionKey = sanitizeKey(sessionProject);
  if (!sessionKey) return null;

  let best = null;
  let bestScore = 0;

  for (const project of catalog) {
    for (const alias of project.aliases) {
      if (!alias) continue;
      let score = 0;
      if (alias === sessionKey) score = alias.length + 3;
      else if (alias.includes(sessionKey) || sessionKey.includes(alias)) score = Math.min(alias.length, sessionKey.length);
      if (score > bestScore) {
        bestScore = score;
        best = project;
      }
    }
  }

  return best;
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

function extractMessageText(record) {
  if (!record || typeof record !== 'object') return '';
  const message = record.message;
  if (!message) return '';

  const content = message.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const chunks = [];
    for (const block of content) {
      if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        chunks.push(block.text);
      }
    }
    return chunks.join('\n').trim();
  }

  return '';
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

function getSessionProjectCount(entries, projectsRootCatalog, filePath) {
  const sessionProject = projectFromSessionDir(filePath);
  const mapped = matchProjectFromCatalog(sessionProject, projectsRootCatalog);
  return mapped ? mapped.name : sessionProject;
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

function buildS1Findings(sessions) {
  const records = [];
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (entry.role !== 'user') continue;
      records.push({
        sessionId: session.id,
        text: entry.text,
      });
    }
  }

  const clusters = buildClusters(records, MIN_SUBSTRING_LEN);
  clusters.sort((a, b) => b.sessions - a.sessions || b.count - a.count);

  return clusters.map((cluster) => ({
    project: 'global',
    dimension: 'session',
    check_id: 'S1',
    name: 'Repeated instructions',
    measured_value: {
      instruction: cluster.instruction,
      count: cluster.count,
      sessions: cluster.sessions,
    },
    score: 0,
    detail: `You said '${cluster.instruction}' in ${cluster.sessions} sessions`,
    evidence_id: 'S1',
  }));
}

function buildS4Findings(sessions) {
  const records = [];
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (entry.role !== 'user') continue;
      if (!hasInstruction(entry.normalized)) continue;
      records.push({
        sessionId: session.id,
        text: entry.text,
      });
    }
  }

  const clusters = buildClusters(records, MIN_SUBSTRING_LEN);
  clusters.sort((a, b) => b.sessions - a.sessions || b.count - a.count);

  return clusters.map((cluster) => ({
    project: 'global',
    dimension: 'session',
    check_id: 'S4',
    name: 'Missing rule suggestions',
    measured_value: {
      suggested_rule: cluster.instruction,
      count: cluster.count,
      sessions: cluster.sessions,
    },
    score: 0,
    detail: `Suggested CLAUDE.md rule from repeated instruction: '${cluster.instruction}'`,
    evidence_id: 'S4',
  }));
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

function buildS2Findings(sessions, catalog) {
  if (!catalog.length) return [];

  const hits = new Map();

  for (const session of sessions) {
    const project = catalog.find((entry) => entry.name === session.project) || matchProjectFromCatalog(session.projectRaw, catalog);
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
        const key = `${project.name}::${rule.text}`;
        const hit = hits.get(key) || {
          project: project.name,
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
    .map((hit) => ({
      project: hit.project,
      dimension: 'session',
      check_id: 'S2',
      name: 'Ignored rules',
      measured_value: {
        rule: hit.rule,
        violations: hit.count,
        sessions: hit.sessions.size,
      },
      score: 0,
      detail: `Potentially ignored rule in ${hit.project}: '${hit.rule}' (${hit.count} matching corrections in ${hit.sessions.size} sessions)`,
      evidence_id: 'S2',
    }));
}

function buildS3Findings(sessions) {
  if (!sessions.length) return [];

  let totalFriction = 0;
  let totalSessions = 0;
  const projectStats = new Map();

  for (const session of sessions) {
    const project = session.project || 'global';
    const friction = session.friction;
    totalFriction += friction;
    totalSessions += 1;
    const current = projectStats.get(project) || { project, friction: 0, sessions: 0 };
    current.friction += friction;
    current.sessions += 1;
    projectStats.set(project, current);
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
        dimension: 'session',
        check_id: 'S3',
        name: 'Friction hotspots',
        measured_value: {
          project: stat.project,
          friction_count: stat.friction,
          session_count: stat.sessions,
        },
        score: 0,
        detail: `Above-average friction in ${stat.project}: ${avg.toFixed(2)} corrections/session (global ${globalAverage.toFixed(2)})`,
        evidence_id: 'S3',
      });
    }
  }

  return findings.sort((a, b) => b.measured_value.friction_count - a.measured_value.friction_count);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  const sessionFiles = collectSessionFiles(CLAUDE_PROJECTS_ROOT, options.maxSessions);
  if (!sessionFiles.length) {
    return;
  }

  const catalog = loadProjectCatalog(options.projectsRoot);
  const sessions = [];

  for (const filePath of sessionFiles) {
    const entries = await parseSessionFile(filePath);
    if (!entries || !entries.length) continue;

    const sessionProject = projectFromSessionDir(filePath);
    const projectMapping = matchProjectFromCatalog(sessionProject, catalog);
    const friction = entries.reduce((count, entry) => {
      if (entry.role === 'user' && hasCorrection(entry.normalized)) return count + 1;
      return count;
    }, 0);

    sessions.push({
      id: filePath,
      projectRaw: sessionProject,
      project: projectMapping ? projectMapping.name : sessionProject,
      entries,
      friction,
    });
  }

  const findings = [
    ...buildS1Findings(sessions),
    ...buildS2Findings(sessions, catalog),
    ...buildS3Findings(sessions),
    ...buildS4Findings(sessions),
  ];

  for (const record of findings) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
}

run().catch((error) => {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
});
