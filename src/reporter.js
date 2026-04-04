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

function generateHtmlReport(scores, beforeScores, plan, date) {
  const dims = scores.dimensions || {};
  const dimNames = Object.keys(dims);
  const totalScore = scores.total_score || 0;
  const hasBefore = beforeScores && typeof beforeScores.total_score === 'number';
  const beforeTotal = hasBefore ? beforeScores.total_score : 0;
  const delta = hasBefore ? totalScore - beforeTotal : 0;

  function scoreColor(pct) {
    if (pct >= 90) return 'var(--pass)';
    if (pct >= 50) return 'var(--avg)';
    return 'var(--fail)';
  }

  function badgeClass(score) {
    if (score >= 0.9) return 'badge--pass';
    if (score >= 0.5) return 'badge--avg';
    return 'badge--fail';
  }

  // Animated SVG gauge
  const circumference = 2 * Math.PI * 54;
  const gaugeOffset = circumference * (1 - totalScore / 100);
  const gaugeColor = scoreColor(totalScore);

  const gaugeSvg = `<svg class="gauge" viewBox="0 0 120 120" width="140" height="140">
    <circle cx="60" cy="60" r="54" fill="none" stroke="var(--g200)" stroke-width="10"/>
    <circle cx="60" cy="60" r="54" fill="none" stroke="${gaugeColor}" stroke-width="10"
      stroke-dasharray="${circumference}" stroke-dashoffset="${gaugeOffset}"
      stroke-linecap="round" transform="rotate(-90 60 60)"
      style="animation:gauge-fill 1s ease-out both;animation-delay:.2s"/>
    <text x="60" y="55" text-anchor="middle" dominant-baseline="middle"
      font-size="32" font-weight="700" fill="var(--g900)">${totalScore}</text>
    <text x="60" y="75" text-anchor="middle" font-size="12" fill="var(--g500)">/100</text>
  </svg>`;

  // Before/after delta
  let deltaHtml = '';
  if (hasBefore) {
    const sign = delta > 0 ? '+' : '';
    const dColor = delta > 0 ? 'var(--pass)' : delta < 0 ? 'var(--fail)' : 'var(--g500)';
    deltaHtml = `<div class="delta"><span class="delta-from">${beforeTotal}</span><span class="delta-arrow">\u2192</span><span class="delta-to">${totalScore}</span><span class="delta-diff" style="color:${dColor}">${sign}${delta}</span></div>`;
  }

  // Dimension metric cards
  const metricCards = dimNames.map(name => {
    const dim = dims[name];
    const pct = Math.round((dim.score / dim.max) * 100);
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    const color = scoreColor(pct);
    let beforeLine = '';
    if (hasBefore) {
      const bd = (beforeScores.dimensions || {})[name] || { score: 0, max: 10 };
      const diff = dim.score - bd.score;
      if (diff !== 0) {
        beforeLine = `<div class="metric-delta" style="color:${diff > 0 ? 'var(--pass)' : 'var(--fail)'}">${diff > 0 ? '+' : ''}${diff} from ${bd.score}</div>`;
      }
    }
    return `<div class="metric-card">
      <div class="metric-value" style="color:${color}">${dim.score}</div>
      <div class="metric-max">/ ${dim.max}</div>
      <div class="metric-label">${label}</div>
      <div class="metric-bar"><div class="metric-fill" style="width:${pct}%;background:${color}"></div></div>
      ${beforeLine}
    </div>`;
  }).join('');

  // Radar chart
  const radarSize = 220;
  const radarCenter = radarSize / 2;
  const radarRadius = 80;
  const angles = dimNames.map((_, i) => (Math.PI * 2 * i) / dimNames.length - Math.PI / 2);
  function rp(angle, value, max) {
    const r = (value / max) * radarRadius;
    return [radarCenter + r * Math.cos(angle), radarCenter + r * Math.sin(angle)];
  }
  const gridSvg = [0.25, 0.5, 0.75, 1.0].map(level => {
    const pts = angles.map(a => rp(a, level * 10, 10).join(',')).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="var(--g200)" stroke-width="0.5"/>`;
  }).join('');
  const axisSvg = angles.map((a, i) => {
    const [ex, ey] = rp(a, 10, 10);
    const [lx, ly] = rp(a, 12.5, 10);
    const label = dimNames[i].charAt(0).toUpperCase() + dimNames[i].slice(1);
    const anchor = Math.abs(lx - radarCenter) < 5 ? 'middle' : lx > radarCenter ? 'start' : 'end';
    return `<line x1="${radarCenter}" y1="${radarCenter}" x2="${ex}" y2="${ey}" stroke="var(--g200)" stroke-width="0.5"/>
      <text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" fill="var(--g500)" font-size="11" font-weight="500">${label}</text>`;
  }).join('');
  const afterPts = dimNames.map((n, i) => rp(angles[i], dims[n].score, dims[n].max).join(',')).join(' ');
  let beforePoly = '';
  if (hasBefore) {
    const bd = beforeScores.dimensions || {};
    const bPts = dimNames.map((n, i) => rp(angles[i], (bd[n] || { score: 0 }).score, 10).join(',')).join(' ');
    beforePoly = `<polygon points="${bPts}" fill="rgba(220,38,38,0.08)" stroke="var(--fail)" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  }
  const radarSvg = `<svg viewBox="0 0 ${radarSize} ${radarSize}" width="260" height="260" class="radar">
    ${gridSvg}${axisSvg}${beforePoly}
    <polygon points="${afterPts}" fill="rgba(10,138,82,0.1)" stroke="var(--pass)" stroke-width="2"/>
    ${dimNames.map((n, i) => { const [cx, cy] = rp(angles[i], dims[n].score, dims[n].max); return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="var(--pass)"/>`; }).join('')}
  </svg>`;

  // Project table
  let projectSection = '';
  if (scores.by_project && Object.keys(scores.by_project).length > 1) {
    const rows = Object.entries(scores.by_project).map(([project, pd]) => {
      let t = 0, w = 0;
      for (const d of Object.values(pd)) { t += d.score * d.weight; w += d.weight; }
      const ps = w > 0 ? Math.round((t / w) * 10) : 0;
      const dimCells = dimNames.map(n => {
        const d = pd[n] || { score: 0, max: 10 };
        const p = Math.round((d.score / d.max) * 100);
        return `<td class="tc"><span class="${badgeClass(p / 100)}-text">${d.score}</span><span class="dim-max">/${d.max}</span></td>`;
      }).join('');
      return `<tr><td class="project-name">${project}</td>${dimCells}<td class="tc"><strong style="color:${scoreColor(ps * 10)}">${ps}</strong></td></tr>`;
    }).join('');
    projectSection = `<section class="section"><h2 class="section-title">Projects</h2>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th class="tl">Project</th>${dimNames.map(n => `<th class="tc">${n.charAt(0).toUpperCase() + n.slice(1)}</th>`).join('')}<th class="tc">Score</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></section>`;
  }

  // Issues grouped by dimension
  let issuesSection = '';
  if (scores.by_project) {
    const allChecks = [];
    for (const [project, pd] of Object.entries(scores.by_project)) {
      for (const [dimName, dim] of Object.entries(pd)) {
        for (const check of dim.checks || []) {
          allChecks.push({ project, dimension: dimName, ...check });
        }
      }
    }
    const failed = allChecks.filter(c => c.score < 0.8).sort((a, b) => a.score - b.score);
    if (failed.length > 0) {
      const byDim = {};
      for (const c of failed) {
        if (!byDim[c.dimension]) byDim[c.dimension] = [];
        byDim[c.dimension].push(c);
      }
      const dimSections = Object.entries(byDim).map(([dim, checks]) => {
        const label = dim.charAt(0).toUpperCase() + dim.slice(1);
        const items = checks.map(c => {
          const pct = Math.round(c.score * 100);
          const bc = badgeClass(c.score);
          return `<details class="issue-card">
            <summary class="issue-summary">
              <span class="badge ${bc}">${pct}%</span>
              <span class="issue-id">${c.check_id}</span>
              <span class="issue-name">${c.name || ''}</span>
              <span class="issue-project">${c.project}</span>
            </summary>
            <div class="issue-body">${c.detail || 'No detail available'}</div>
          </details>`;
        }).join('');
        return `<div class="dim-group">
          <h3 class="dim-header">${label} <span class="dim-count">${checks.length}</span></h3>
          ${items}
        </div>`;
      }).join('');
      issuesSection = `<section class="section"><h2 class="section-title">Issues <span class="issue-total">${failed.length}</span></h2>${dimSections}</section>`;
    }
  }

  // Legend
  const legend = `<div class="legend">
    <span><span class="dot dot--pass"></span> 90-100 Pass</span>
    <span><span class="dot dot--avg"></span> 50-89 Needs work</span>
    <span><span class="dot dot--fail"></span> 0-49 Fail</span>
    ${hasBefore ? '<span class="legend-sep">|</span><span><span class="dot dot--before"></span> Before</span>' : ''}
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentLint Report \u2014 ${date}</title>
<style>
:root{--pass:#0a8a52;--avg:#d97706;--fail:#dc2626;--brand:#00b48c;--g50:#fafafa;--g100:#f5f5f5;--g200:#e5e7eb;--g300:#d1d5db;--g400:#9ca3af;--g500:#6b7280;--g600:#4b5563;--g700:#374151;--g900:#111827;--radius:8px;--shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.06);--font:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--mono:'SF Mono',Menlo,Consolas,monospace;--max-w:960px}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--g50);color:var(--g700);font-family:var(--font);line-height:1.5;max-width:var(--max-w);margin:0 auto}
.topbar{background:var(--g900);color:white;padding:0 24px;height:40px;display:flex;align-items:center;justify-content:space-between;font-size:13px;position:sticky;top:0;z-index:20}
.topbar-brand{font-weight:700;color:var(--brand);letter-spacing:.02em}
.topbar-date{color:var(--g400);font-family:var(--mono);font-size:12px}
.hero{display:flex;gap:40px;align-items:center;padding:32px 24px;flex-wrap:wrap}
.hero-left{display:flex;flex-direction:column;align-items:center;gap:8px}
.gauge{filter:drop-shadow(0 2px 4px rgba(0,0,0,.06))}
@keyframes gauge-fill{from{stroke-dashoffset:${circumference}}}
.delta{display:flex;align-items:center;gap:12px;font-size:14px;color:var(--g500);margin-top:4px}
.delta-from{font-size:20px;color:var(--g400);text-decoration:line-through}
.delta-arrow{font-size:16px}
.delta-to{font-size:28px;font-weight:700;color:var(--g900)}
.delta-diff{font-size:16px;font-weight:600}
.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;flex:1}
.metric-card{background:white;border:1px solid var(--g200);border-radius:var(--radius);padding:16px 12px;box-shadow:var(--shadow);text-align:center}
.metric-value{font-size:32px;font-weight:700;line-height:1}
.metric-max{font-size:13px;color:var(--g400);margin-top:2px}
.metric-label{font-size:11px;color:var(--g500);margin-top:6px;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.metric-bar{height:4px;background:var(--g200);border-radius:2px;margin-top:10px;overflow:hidden}
.metric-fill{height:100%;border-radius:2px;animation:bar-grow .8s ease both;animation-delay:.3s}
@keyframes bar-grow{from{width:0 !important}}
.metric-delta{font-size:11px;margin-top:4px;font-weight:500}
.radar{display:block;margin:0 auto}
.legend{display:flex;gap:16px;font-size:11px;color:var(--g500);padding:8px 24px;flex-wrap:wrap}
.legend-sep{color:var(--g300)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}
.dot--pass{background:var(--pass)}.dot--avg{background:var(--avg)}.dot--fail{background:var(--fail)}
.dot--before{background:var(--fail);opacity:.4}
.section{padding:0 24px 24px}
.section-title{font-size:16px;font-weight:600;color:var(--g900);margin:24px 0 12px;display:flex;align-items:center;gap:8px}
.issue-total{background:var(--fail);color:white;font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600}
.table-wrap{overflow-x:auto}
.data-table{width:100%;border-collapse:collapse;font-size:13px}
.data-table th{background:var(--g100);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--g500);font-weight:500;padding:10px 12px;border-bottom:1px solid var(--g200)}
.data-table td{padding:10px 12px;border-bottom:1px solid var(--g100)}
.data-table tbody tr:hover{background:#eff6ff}
.tc{text-align:center}.tl{text-align:left}
.project-name{font-weight:500;color:var(--g700)}
.dim-max{color:var(--g400);font-size:11px}
.badge--pass-text{color:var(--pass);font-weight:600}
.badge--avg-text{color:var(--avg);font-weight:600}
.badge--fail-text{color:var(--fail);font-weight:600}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;letter-spacing:.03em;min-width:42px;text-align:center}
.badge--pass{background:#d1fae5;color:#065f46}.badge--avg{background:#fef3c7;color:#92400e}.badge--fail{background:#fee2e2;color:#991b1b}
.dim-group{margin-bottom:16px}
.dim-header{font-size:13px;font-weight:600;color:var(--g600);text-transform:uppercase;letter-spacing:.05em;padding:8px 0;display:flex;align-items:center;gap:8px}
.dim-count{background:var(--g200);color:var(--g600);font-size:10px;padding:1px 6px;border-radius:99px}
.issue-card{border:1px solid var(--g200);border-radius:var(--radius);margin-bottom:6px;background:white;overflow:hidden}
.issue-card[open]{box-shadow:var(--shadow)}
.issue-summary{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;font-size:13px;list-style:none}
.issue-summary::-webkit-details-marker{display:none}
.issue-summary::after{content:'\\25BE';margin-left:auto;color:var(--g400);font-size:12px;transition:transform .2s}
.issue-card[open] .issue-summary::after{transform:rotate(180deg)}
.issue-card[open] .issue-summary{border-bottom:1px solid var(--g100)}
.issue-id{font-family:var(--mono);font-size:12px;color:var(--g400);min-width:28px}
.issue-name{color:var(--g700);font-weight:500;flex:1}
.issue-project{font-size:11px;color:var(--g400);font-family:var(--mono)}
.issue-body{padding:12px 14px;font-size:13px;color:var(--g600);line-height:1.6;background:var(--g50)}
.footer{padding:24px;border-top:1px solid var(--g200);color:var(--g400);font-size:11px;text-align:center}
.footer a{color:var(--brand);text-decoration:none;font-weight:500}
</style>
</head>
<body>
  <div class="topbar">
    <span class="topbar-brand">AgentLint</span>
    <span class="topbar-date">${date}</span>
  </div>

  <div class="hero">
    <div class="hero-left">
      ${gaugeSvg}
      ${deltaHtml}
    </div>
    <div class="metric-grid">
      ${metricCards}
    </div>
  </div>

  <div style="display:flex;justify-content:center;padding:0 24px 16px">
    ${radarSvg}
  </div>
  ${legend}

  ${projectSection}
  ${issuesSection}

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
