#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const evidencePath = path.join(__dirname, '..', 'standards', 'evidence.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function bar(score, max, width = 20) {
  const filled = Math.round((score / max) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function generateTerminalSummary(scores) {
  const lines = [];
  lines.push('');
  lines.push(`\x1b[1m\u{1F3E5} AgentLint \u2014 Score: ${scores.total_score}/100\x1b[0m`);
  lines.push('');

  const dims = scores.dimensions || {};
  for (const [name, dim] of Object.entries(dims)) {
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    const padded = label.padEnd(16);
    lines.push(`  ${padded} ${bar(dim.score, dim.max)}  ${dim.score}/${dim.max}`);
  }

  if (scores.by_project && Object.keys(scores.by_project).length > 1) {
    lines.push('');
    lines.push('  By Project:');
    const projects = Object.entries(scores.by_project)
      .map(([name, dims]) => {
        let total = 0, weightSum = 0;
        for (const dim of Object.values(dims)) {
          total += dim.score * dim.weight;
          weightSum += dim.weight;
        }
        const score = weightSum > 0 ? Math.round(total / weightSum) : 0;
        return { name, score };
      })
      .sort((a, b) => b.score - a.score);

    for (const p of projects) {
      const padded = p.name.padEnd(20);
      lines.push(`    ${padded} ${p.score.toString().padStart(3)}  ${bar(p.score, 10, 22)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function generateMarkdownReport(scores, plan, date) {
  const lines = [];
  lines.push(`# AgentLint Report \u2014 ${date}`);
  lines.push('');
  lines.push(`## Score: ${scores.total_score}/100`);
  lines.push('');

  const dims = scores.dimensions || {};
  lines.push('| Dimension | Score | Max |');
  lines.push('|-----------|-------|-----|');
  for (const [name, dim] of Object.entries(dims)) {
    lines.push(`| ${name} | ${dim.score} | ${dim.max} |`);
  }
  lines.push('');

  if (scores.by_project) {
    lines.push('## By Project');
    lines.push('');
    for (const [project, projectDims] of Object.entries(scores.by_project)) {
      lines.push(`### ${project}`);
      for (const [dimName, dim] of Object.entries(projectDims)) {
        lines.push(`**${dimName}**: ${dim.score}/${dim.max}`);
        for (const check of dim.checks || []) {
          const icon = check.score >= 0.8 ? '\u2713' : check.score >= 0.5 ? '\u26A0' : '\u2717';
          lines.push(`- ${icon} ${check.check_id}: ${check.name} \u2014 ${check.detail || ''}`);
        }
        lines.push('');
      }
    }
  }

  if (plan && plan.items && plan.items.length > 0) {
    lines.push('## Fix Plan');
    lines.push('');
    for (const item of plan.items) {
      lines.push(`- [ ] [${item.fix_type}] ${item.project}: ${item.description}`);
      if (item.evidence) {
        lines.push(`  > ${item.evidence.slice(0, 120)}...`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateJsonl(scores, date) {
  const lines = [];
  for (const [project, projectDims] of Object.entries(scores.by_project || {})) {
    for (const [dimName, dim] of Object.entries(projectDims)) {
      for (const check of dim.checks || []) {
        lines.push(JSON.stringify({
          date,
          project,
          dimension: dimName,
          check_id: check.check_id,
          name: check.name,
          score: check.score,
          measured_value: check.measured_value,
          detail: check.detail,
        }));
      }
    }
  }
  return lines.join('\n') + '\n';
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateHtmlReport(scores, beforeScores, plan, date) {
  const dims = scores.dimensions || {};
  const dimNames = Object.keys(dims);
  const totalScore = scores.total_score || 0;
  const hasBefore = beforeScores && typeof beforeScores.total_score === 'number';
  const beforeTotal = hasBefore ? beforeScores.total_score : 0;
  const delta = hasBefore ? totalScore - beforeTotal : 0;

  // Read version from package.json
  let alVersion = '';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    alVersion = pkg.version || '';
  } catch (_) { /* ignore */ }

  // Collect checks grouped by dimension
  const checksByDim = {};
  const projectCount = Object.keys(scores.by_project || {}).length;
  for (const [project, pd] of Object.entries(scores.by_project || {})) {
    for (const [dimName, dim] of Object.entries(pd)) {
      if (!checksByDim[dimName]) checksByDim[dimName] = [];
      for (const check of dim.checks || []) {
        checksByDim[dimName].push({ project, ...check });
      }
    }
  }

  // Compare with before to detect fixed/improved
  if (hasBefore && beforeScores.by_project) {
    const beforeMap = {};
    for (const [project, pd] of Object.entries(beforeScores.by_project)) {
      for (const [dimName, dim] of Object.entries(pd)) {
        for (const check of dim.checks || []) {
          beforeMap[`${project}:${check.check_id}`] = check.score;
        }
      }
    }
    for (const checks of Object.values(checksByDim)) {
      for (const c of checks) {
        const prev = beforeMap[`${c.project}:${c.check_id}`];
        if (prev !== undefined) {
          if (prev < 0.8 && c.score >= 0.8) c.fixed = true;
          else if (c.score > prev && c.score < 0.8) c.improved = true;
        }
      }
    }
  }

  // Stats
  const allChecks = Object.values(checksByDim).flat();
  const fixedCount = allChecks.filter(c => c.fixed).length;
  const improvedCount = allChecks.filter(c => c.improved).length;
  const failCount = allChecks.filter(c => c.score < 0.5).length;
  const warnCount = allChecks.filter(c => c.score >= 0.5 && c.score < 0.8).length;
  const passCount = allChecks.filter(c => c.score >= 0.8).length;
  const remainingCount = failCount + warnCount;

  // Color helpers
  function scoreColor(s) { return s >= 80 ? '#1D9E75' : s >= 60 ? '#534AB7' : '#E24B4A'; }
  function dimColor(s, max) { const p = (s / max) * 100; return p >= 80 ? '#1D9E75' : p >= 60 ? '#534AB7' : '#E24B4A'; }
  function checkDot(s) { return s >= 0.8 ? '#1D9E75' : s >= 0.5 ? '#EF9F27' : '#E24B4A'; }

  // ── Segmented arc gauge ──
  const gW = 220, gH = 148, gCx = 110, gCy = 120, gR = 88;
  const startAng = Math.PI * 1.22, endAng = Math.PI * -0.22;
  const totalArc = startAng - endAng;
  const segs = 52;
  const filled = Math.round((totalScore / 100) * segs);
  const prevFilled = hasBefore ? Math.round((beforeTotal / 100) * segs) : 0;
  const gaugeColor = scoreColor(totalScore);

  let gaugeLines = '';
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const ang = startAng - t * totalArc;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const inner = gR - 5, outer = gR + 5;
    const x1 = (gCx + cos * inner).toFixed(1);
    const y1 = (gCy - sin * inner).toFixed(1);
    const x2 = (gCx + cos * outer).toFixed(1);
    const y2 = (gCy - sin * outer).toFixed(1);
    let stroke, op;
    if (i < filled) { stroke = gaugeColor; op = 1; }
    else if (hasBefore && i < prevFilled) { stroke = '#d1d5db'; op = 0.4; }
    else { stroke = '#e5e7eb'; op = 0.3; }
    gaugeLines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="4.5" stroke-linecap="round" opacity="${op}"/>`;
  }

  const gaugeSvg = `<svg width="${gW}" height="${gH}" viewBox="0 0 ${gW} ${gH}">${gaugeLines}</svg>`;

  // ── Under-gauge stats ──
  let statsLine = '';
  if (hasBefore) {
    const sign = delta > 0 ? '+' : '';
    const dColor = delta >= 0 ? '#0F6E56' : '#991b1b';
    statsLine = `<div class="hero-stats">
      <span style="color:#9ca3af">from ${beforeTotal}</span>
      <span class="stats-sep">\u00b7</span>
      <span style="font-weight:500;color:${dColor}">${sign}${delta} points</span>
    </div>`;
  }

  // ── Hero pills ──
  let heroPills = '';
  if (hasBefore) {
    heroPills = `<div class="hero-pills">
      ${fixedCount > 0 ? `<div class="pill"><div class="pill-dot" style="background:#1D9E75"></div><span class="pill-num">${fixedCount}</span><span class="pill-label">fixed</span></div>` : ''}
      ${improvedCount > 0 ? `<div class="pill"><div class="pill-dot" style="background:#EF9F27"></div><span class="pill-num">${improvedCount}</span><span class="pill-label">improved</span></div>` : ''}
      <div class="pill"><div class="pill-dot" style="background:#E24B4A"></div><span class="pill-num">${remainingCount}</span><span class="pill-label">remaining</span></div>
    </div>`;
  } else {
    heroPills = `<div class="hero-pills">
      <div class="pill"><div class="pill-dot" style="background:#1D9E75"></div><span class="pill-num">${passCount}</span><span class="pill-label">pass</span></div>
      ${warnCount > 0 ? `<div class="pill"><div class="pill-dot" style="background:#EF9F27"></div><span class="pill-num">${warnCount}</span><span class="pill-label">needs work</span></div>` : ''}
      ${failCount > 0 ? `<div class="pill"><div class="pill-dot" style="background:#E24B4A"></div><span class="pill-num">${failCount}</span><span class="pill-label">failing</span></div>` : ''}
    </div>`;
  }

  // ── Dimension rows ──
  let dimRows = '';
  for (const name of dimNames) {
    const dim = dims[name];
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    const pct = Math.round((dim.score / dim.max) * 100);
    const color = dimColor(dim.score, dim.max);
    const checks = checksByDim[name] || [];
    const dFails = checks.filter(c => c.score < 0.5).length;
    const dWarns = checks.filter(c => c.score >= 0.5 && c.score < 0.8).length;

    // Before ghost bar + delta
    let prevBarHtml = '';
    let deltaHtml = '<span class="delta-spacer"></span>';
    if (hasBefore) {
      const bd = (beforeScores.dimensions || {})[name] || { score: 0, max: dim.max };
      const prevPct = Math.round((bd.score / bd.max) * 100);
      prevBarHtml = `<div class="dim-bar-ghost" style="width:${prevPct}%"></div>`;
      const diff = dim.score - bd.score;
      if (diff > 0) deltaHtml = `<span class="delta-pill delta-up">+${diff}</span>`;
      else if (diff < 0) deltaHtml = `<span class="delta-pill delta-down">${diff}</span>`;
    }

    // Issue count pills
    let issuePills = '';
    if (dFails > 0) issuePills += `<span class="issue-pill issue-fail">${dFails}</span>`;
    if (dWarns > 0) issuePills += `<span class="issue-pill issue-warn">${dWarns}</span>`;
    if (dFails === 0 && dWarns === 0) {
      issuePills = `<svg width="14" height="14" viewBox="0 0 14 14"><path d="M3.5 7.5L5.5 9.5L10.5 4.5" fill="none" stroke="#1D9E75" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }

    // Check items within this dimension
    let checkItems = '';
    for (const c of checks) {
      const dot = checkDot(c.score);
      let badges = '';
      if (c.fixed) badges += '<span class="chk-badge chk-fixed">fixed</span>';
      if (c.improved) badges += '<span class="chk-badge chk-improved">improved</span>';
      const proj = projectCount > 1 ? `<span class="chk-project">${esc(c.project)}</span>` : '';
      checkItems += `<details class="chk">
          <summary class="chk-row">
            <div class="chk-dot" style="background:${dot}"></div>
            <span class="chk-id">${esc(c.check_id)}</span>
            <span class="chk-name">${esc(c.name)}</span>
            ${proj}${badges}
          </summary>
          <div class="chk-detail">${esc(c.detail)}</div>
        </details>`;
    }

    dimRows += `<details class="dim">
      <summary class="dim-row">
        <span class="dim-label">${label}</span>
        <div class="dim-bar">${prevBarHtml}<div class="dim-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="dim-score" style="color:${color}">${dim.score}</span>
        <span class="dim-max">/${dim.max}</span>
        ${deltaHtml}
        <div class="dim-issues">${issuePills}</div>
      </summary>
      <div class="dim-checks">${checkItems}</div>
    </details>`;
  }

  // ── Remaining fixes / issues section ──
  let fixesSection = '';
  const planItems = plan && plan.items ? plan.items.filter(item => item.fix_type) : [];
  const failingChecks = allChecks.filter(c => c.score < 0.8).sort((a, b) => a.score - b.score);

  if (planItems.length > 0) {
    const fixRows = planItems.map((fix, i) => {
      const isGuided = fix.fix_type === 'guided';
      return `<div class="fix-item">
        <div class="fix-num">${i + 1}</div>
        <div class="fix-body">
          <div class="fix-desc">${esc(fix.description)}</div>
          <div class="fix-reason">${esc(fix.evidence ? fix.evidence.slice(0, 150) : '')}</div>
        </div>
        <div class="fix-meta">
          <span class="fix-type ${isGuided ? 'fix-guided' : 'fix-assisted'}">${fix.fix_type}</span>
          <span class="fix-check">${esc(fix.check_id || '')}</span>
        </div>
      </div>`;
    }).join('');
    fixesSection = `<div class="card">
      <div class="card-head"><span class="card-title">Remaining fixes</span><span class="card-count">${planItems.length} items</span></div>
      ${fixRows}
    </div>`;
  } else if (failingChecks.length > 0) {
    const fixRows = failingChecks.map((c, i) => {
      return `<div class="fix-item">
        <div class="fix-num">${i + 1}</div>
        <div class="fix-body">
          <div class="fix-desc">${esc(c.name || c.check_id)}</div>
          <div class="fix-reason">${esc(c.detail)}</div>
        </div>
        <div class="fix-meta">
          <span class="fix-check">${esc(c.check_id)}</span>
        </div>
      </div>`;
    }).join('');
    fixesSection = `<div class="card">
      <div class="card-head"><span class="card-title">Issues</span><span class="card-count">${failingChecks.length} items</span></div>
      ${fixRows}
    </div>`;
  }

  // Project label for header
  const projectNames = Object.keys(scores.by_project || {});
  const projectLabel = projectNames.length === 1
    ? `${esc(projectNames[0])}/ \u00b7 `
    : projectNames.length > 1
      ? `${projectNames.length} projects \u00b7 `
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentLint Report \u2014 ${date}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--font:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--mono:'SF Mono',Menlo,Consolas,monospace}
body{background:#f9fafb;color:#374151;font-family:var(--font);line-height:1.5;max-width:720px;margin:0 auto;padding:8px 0}

.hero{background:#f3f4f6;border-radius:16px;padding:28px 28px 26px;margin-bottom:14px}
.hero-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.hero-brand{font-size:18px;font-weight:500;color:#111827}
.hero-ver{font-size:11px;font-family:var(--mono);color:#9ca3af;background:#e5e7eb;padding:2px 8px;border-radius:8px;margin-left:10px}
.hero-meta{font-size:12px;color:#9ca3af}
.hero-gauge{position:relative;width:220px;height:148px;margin:0 auto}
.hero-gauge-num{position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:60px;font-weight:500;color:#111827;line-height:1;letter-spacing:-3px}
.hero-stats{text-align:center;margin-top:2px;font-size:13px}
.stats-sep{color:#9ca3af;margin:0 6px}
.hero-pills{display:flex;justify-content:center;gap:10px;margin-top:20px}
.pill{display:flex;align-items:center;gap:6px;padding:7px 16px;border-radius:10px;background:#fff;border:0.5px solid #e5e7eb}
.pill-dot{width:8px;height:8px;border-radius:50%}
.pill-num{font-size:14px;font-weight:500;color:#111827}
.pill-label{font-size:13px;color:#4b5563}

.card{border:0.5px solid #e5e7eb;border-radius:14px;overflow:hidden;background:#fff;margin-bottom:14px}
.card-head{padding:16px 20px 4px;display:flex;align-items:baseline;gap:8px}
.card-title{font-size:16px;font-weight:500;color:#111827}
.card-count{font-size:12px;color:#9ca3af}

.dim{border-top:0.5px solid #e5e7eb}
.dim>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:13px 20px}
.dim>summary::-webkit-details-marker{display:none}
.dim-label{font-size:14px;font-weight:500;color:#111827;width:100px;flex-shrink:0}
.dim-bar{flex:1;position:relative;height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden}
.dim-bar-ghost{position:absolute;height:100%;border-radius:3px;background:#d1d5db;opacity:.3}
.dim-bar-fill{position:relative;height:100%;border-radius:3px}
.dim-score{font-size:20px;font-weight:500;line-height:1;min-width:28px;text-align:right;flex-shrink:0}
.dim-max{font-size:12px;color:#9ca3af;flex-shrink:0}
.delta-pill{font-size:11px;font-weight:500;padding:2px 7px;border-radius:8px;min-width:28px;text-align:center;flex-shrink:0}
.delta-up{background:rgba(29,158,117,.1);color:#0F6E56}
.delta-down{background:rgba(226,75,74,.1);color:#991b1b}
.delta-spacer{min-width:28px;flex-shrink:0}
.dim-issues{width:44px;display:flex;gap:4px;flex-shrink:0;justify-content:flex-end;align-items:center}
.issue-pill{font-size:11px;padding:2px 7px;border-radius:10px;font-weight:500}
.issue-fail{background:rgba(226,75,74,.1);color:#A32D2D}
.issue-warn{background:rgba(239,159,39,.1);color:#854F0B}

.dim-checks{background:#f9fafb;border-top:0.5px solid #e5e7eb}
.chk{border-bottom:0.5px solid #e5e7eb}
.chk:last-child{border-bottom:none}
.chk>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 20px;-webkit-user-select:none;user-select:none}
.chk>summary::-webkit-details-marker{display:none}
.chk>summary::after{content:'\\203A';margin-left:auto;color:#9ca3af;font-size:14px;transition:transform .15s}
.chk[open]>summary::after{transform:rotate(90deg)}
.chk-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.chk-id{font-size:11px;font-family:var(--mono);color:#9ca3af;width:24px;flex-shrink:0}
.chk-name{flex:1;font-size:13px;color:#111827}
.chk-project{font-size:11px;color:#9ca3af;font-family:var(--mono)}
.chk-badge{font-size:10px;font-weight:500;padding:2px 7px;border-radius:6px}
.chk-fixed{background:rgba(29,158,117,.1);color:#0F6E56}
.chk-improved{background:rgba(239,159,39,.1);color:#854F0B}
.chk-detail{padding:0 20px 12px 51px;font-size:12.5px;color:#4b5563;line-height:1.7}

.fix-item{display:flex;align-items:flex-start;gap:14px;padding:14px 20px;border-top:0.5px solid #e5e7eb}
.fix-num{width:24px;height:24px;border-radius:50%;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#4b5563;flex-shrink:0}
.fix-body{flex:1;min-width:0}
.fix-desc{font-size:14px;font-weight:500;color:#111827;margin-bottom:3px}
.fix-reason{font-size:12px;color:#4b5563;line-height:1.5}
.fix-meta{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-top:2px}
.fix-type{font-size:10px;font-weight:500;padding:3px 9px;border-radius:8px;text-transform:uppercase;letter-spacing:.4px}
.fix-guided{background:rgba(24,95,165,.08);color:#185FA5}
.fix-assisted{background:rgba(186,117,23,.08);color:#854F0B}
.fix-check{font-size:11px;font-family:var(--mono);color:#9ca3af}

.evidence{background:#f3f4f6;border-radius:14px;padding:16px 20px;font-size:12px;color:#9ca3af;line-height:1.7}
.evidence code{font-family:var(--mono);font-size:11px}
.footer{padding:20px;color:#9ca3af;font-size:11px;text-align:center}
.footer a{color:#00b48c;text-decoration:none;font-weight:500}
</style>
</head>
<body>
  <div class="hero">
    <div class="hero-head">
      <div style="display:flex;align-items:center">
        <span class="hero-brand">AgentLint</span>
        ${alVersion ? `<span class="hero-ver">v${alVersion}</span>` : ''}
      </div>
      <span class="hero-meta">${projectLabel}${date}</span>
    </div>
    <div class="hero-gauge">
      ${gaugeSvg}
      <div class="hero-gauge-num">${totalScore}</div>
    </div>
    ${statsLine}
    ${heroPills}
  </div>

  <div class="card">
    <div class="card-head"><span class="card-title">Dimensions</span></div>
    ${dimRows}
  </div>

  ${fixesSection}

  <div class="evidence">
    All checks backed by data, not opinions. Details in <code>standards/evidence.json</code>.
  </div>

  <div class="footer">
    Generated by <a href="https://github.com/0xmariowu/agent-lint">AgentLint</a>
  </div>
</body>
</html>`;
}

function main() {
  const args = process.argv.slice(2);
  const scoresFile = args.find(a => !a.startsWith('--'));
  const planFile = args.find((a, i) => args[i - 1] === '--plan');
  const outputDir = args.find((a, i) => args[i - 1] === '--output-dir') || null;
  const format = args.find((a, i) => args[i - 1] === '--format') || 'terminal';

  const beforeFile = args.find((a, i) => args[i - 1] === '--before');

  if (!scoresFile) {
    process.stderr.write('Usage: reporter.js <scores.json> [--before before-scores.json] [--plan plan.json] [--output-dir dir] [--format terminal|md|jsonl|html|all]\n');
    process.exit(1);
  }

  const scores = readJson(scoresFile);
  const beforeScores = beforeFile ? readJson(beforeFile) : null;
  const plan = planFile ? readJson(planFile) : null;
  const date = new Date().toISOString().split('T')[0];

  if (format === 'terminal' || format === 'all') {
    process.stdout.write(generateTerminalSummary(scores));
  }

  if (outputDir || format === 'all' || format === 'md' || format === 'jsonl' || format === 'html') {
    const dir = outputDir || '.';
    fs.mkdirSync(dir, { recursive: true });

    if (format === 'md' || format === 'all') {
      const md = generateMarkdownReport(scores, plan, date);
      const mdPath = path.join(dir, `al-${date}.md`);
      fs.writeFileSync(mdPath, md);
      process.stderr.write(`Report: ${mdPath}\n`);
    }

    if (format === 'jsonl' || format === 'all') {
      const jsonl = generateJsonl(scores, date);
      const jsonlPath = path.join(dir, `al-${date}.jsonl`);
      fs.writeFileSync(jsonlPath, jsonl);
      process.stderr.write(`Data: ${jsonlPath}\n`);
    }

    if (format === 'html' || format === 'all') {
      const html = generateHtmlReport(scores, beforeScores, plan, date);
      const htmlPath = path.join(dir, `al-${date}.html`);
      fs.writeFileSync(htmlPath, html);
      process.stderr.write(`HTML: ${htmlPath}\n`);
    }
  }
}

main();
