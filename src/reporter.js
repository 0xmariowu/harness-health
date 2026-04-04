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

  // Radar chart SVG (4 dimensions)
  const radarSize = 200;
  const radarCenter = radarSize / 2;
  const radarRadius = 80;
  const angles = dimNames.map((_, i) => (Math.PI * 2 * i) / dimNames.length - Math.PI / 2);

  function radarPoint(angle, value, max) {
    const r = (value / max) * radarRadius;
    return [radarCenter + r * Math.cos(angle), radarCenter + r * Math.sin(angle)];
  }

  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  const gridSvg = gridLevels.map(level => {
    const pts = angles.map(a => radarPoint(a, level * 10, 10).join(',')).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="#ddd" stroke-width="0.5"/>`;
  }).join('');

  const axisSvg = angles.map((a, i) => {
    const [ex, ey] = radarPoint(a, 10, 10);
    const [lx, ly] = radarPoint(a, 12, 10);
    const label = dimNames[i].charAt(0).toUpperCase() + dimNames[i].slice(1);
    const anchor = Math.abs(lx - radarCenter) < 5 ? 'middle' : lx > radarCenter ? 'start' : 'end';
    return `<line x1="${radarCenter}" y1="${radarCenter}" x2="${ex}" y2="${ey}" stroke="#ccc" stroke-width="0.5"/>
      <text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" fill="#666" font-size="11">${label}</text>`;
  }).join('');

  const afterPts = dimNames.map((name, i) => radarPoint(angles[i], dims[name].score, dims[name].max).join(',')).join(' ');
  let beforePolygon = '';
  if (hasBefore) {
    const beforeDims = beforeScores.dimensions || {};
    const beforePts = dimNames.map((name, i) => {
      const bd = beforeDims[name] || { score: 0, max: 10 };
      return radarPoint(angles[i], bd.score, bd.max).join(',');
    }).join(' ');
    beforePolygon = `<polygon points="${beforePts}" fill="rgba(255,100,100,0.15)" stroke="#f66" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  }

  const radarSvg = `<svg viewBox="0 0 ${radarSize} ${radarSize}" width="280" height="280">
    ${gridSvg}${axisSvg}${beforePolygon}
    <polygon points="${afterPts}" fill="rgba(0,180,140,0.15)" stroke="#00d4aa" stroke-width="2"/>
    ${dimNames.map((name, i) => {
      const [cx, cy] = radarPoint(angles[i], dims[name].score, dims[name].max);
      return `<circle cx="${cx}" cy="${cy}" r="3" fill="#00d4aa"/>`;
    }).join('')}
  </svg>`;

  // Score delta display
  const deltaHtml = hasBefore
    ? `<div style="display:flex;align-items:center;gap:24px;margin:16px 0">
        <div style="text-align:center"><div style="font-size:32px;color:#666">${beforeTotal}</div><div style="color:#666;font-size:12px">Before</div></div>
        <div style="font-size:24px;color:#666">&rarr;</div>
        <div style="text-align:center"><div style="font-size:48px;font-weight:bold;color:#00d4aa">${totalScore}</div><div style="color:#666;font-size:12px">After</div></div>
        <div style="font-size:20px;color:${delta > 0 ? '#00d4aa' : delta < 0 ? '#f66' : '#888'}">
          ${delta > 0 ? '+' : ''}${delta}
        </div>
      </div>`
    : `<div style="font-size:48px;font-weight:bold;color:#00d4aa;margin:16px 0">${totalScore}<span style="font-size:24px;color:#666">/100</span></div>`;

  // Dimension bars with before/after
  const dimBars = dimNames.map(name => {
    const dim = dims[name];
    const pct = Math.round((dim.score / dim.max) * 100);
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    let beforeBar = '';
    if (hasBefore) {
      const bd = (beforeScores.dimensions || {})[name] || { score: 0, max: 10 };
      const bpct = Math.round((bd.score / bd.max) * 100);
      const diff = dim.score - bd.score;
      beforeBar = `<div style="display:flex;align-items:center;gap:8px;margin-top:2px">
        <div style="width:200px;height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden">
          <div style="width:${bpct}%;height:100%;background:#f66;border-radius:3px"></div>
        </div>
        <span style="color:#666;font-size:11px">${bd.score}/${bd.max} before</span>
        ${diff !== 0 ? `<span style="color:${diff > 0 ? '#00d4aa' : '#f66'};font-size:11px">${diff > 0 ? '+' : ''}${diff}</span>` : ''}
      </div>`;
    }
    return `<div style="margin:12px 0">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="color:#333">${label}</span>
        <span style="color:#00d4aa;font-weight:bold">${dim.score}/${dim.max}</span>
      </div>
      <div style="width:200px;height:10px;background:#e0e0e0;border-radius:5px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:#00d4aa;border-radius:5px;transition:width 0.3s"></div>
      </div>
      ${beforeBar}
    </div>`;
  }).join('');

  // Project table
  let projectTable = '';
  if (scores.by_project && Object.keys(scores.by_project).length > 0) {
    const projectRows = Object.entries(scores.by_project).map(([project, projectDims]) => {
      const dimScores = dimNames.map(name => {
        const d = projectDims[name] || { score: 0, max: 10 };
        const pct = Math.round((d.score / d.max) * 100);
        const color = pct >= 80 ? '#00d4aa' : pct >= 50 ? '#f0ad4e' : '#f66';
        return `<td style="padding:8px;text-align:center"><span style="color:${color}">${d.score}</span>/${d.max}</td>`;
      }).join('');
      let projectTotal = 0, wSum = 0;
      for (const d of Object.values(projectDims)) {
        projectTotal += d.score * d.weight;
        wSum += d.weight;
      }
      const ps = wSum > 0 ? Math.round((projectTotal / wSum) * 10) : 0;
      return `<tr><td style="padding:8px;color:#333">${project}</td>${dimScores}<td style="padding:8px;text-align:center;font-weight:bold;color:#00d4aa">${ps}</td></tr>`;
    }).join('');

    projectTable = `<h2 style="color:#333;margin-top:32px;font-size:16px">By Project</h2>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <thead><tr style="border-bottom:1px solid #ddd">
        <th style="padding:8px;text-align:left;color:#666">Project</th>
        ${dimNames.map(n => `<th style="padding:8px;text-align:center;color:#666">${n.charAt(0).toUpperCase() + n.slice(1)}</th>`).join('')}
        <th style="padding:8px;text-align:center;color:#666">Total</th>
      </tr></thead>
      <tbody>${projectRows}</tbody>
    </table>`;
  }

  // Check details table
  let checkDetails = '';
  if (scores.by_project) {
    const allChecks = [];
    for (const [project, projectDims] of Object.entries(scores.by_project)) {
      for (const [dimName, dim] of Object.entries(projectDims)) {
        for (const check of dim.checks || []) {
          allChecks.push({ project, dimension: dimName, ...check });
        }
      }
    }
    const failedChecks = allChecks.filter(c => c.score < 0.8);
    if (failedChecks.length > 0) {
      const checkRows = failedChecks
        .sort((a, b) => a.score - b.score)
        .slice(0, 30)
        .map(c => {
          const icon = c.score < 0.5 ? '\u274c' : '\u26a0\ufe0f';
          const scoreColor = c.score < 0.5 ? '#f66' : '#f0ad4e';
          return `<tr>
            <td style="padding:6px 8px">${icon}</td>
            <td style="padding:6px 8px;color:#333">${c.project}</td>
            <td style="padding:6px 8px;color:#666">${c.check_id}</td>
            <td style="padding:6px 8px;color:#333">${c.name || ''}</td>
            <td style="padding:6px 8px;text-align:center"><span style="color:${scoreColor}">${Math.round(c.score * 100)}%</span></td>
            <td style="padding:6px 8px;color:#666;font-size:12px">${(c.detail || '').slice(0, 80)}</td>
          </tr>`;
        }).join('');
      checkDetails = `<h2 style="color:#333;margin-top:32px;font-size:16px">Issues (${failedChecks.length})</h2>
      <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
        <thead><tr style="border-bottom:1px solid #ddd">
          <th style="padding:6px 8px"></th>
          <th style="padding:6px 8px;text-align:left;color:#666">Project</th>
          <th style="padding:6px 8px;text-align:left;color:#666">Check</th>
          <th style="padding:6px 8px;text-align:left;color:#666">Name</th>
          <th style="padding:6px 8px;text-align:center;color:#666">Score</th>
          <th style="padding:6px 8px;text-align:left;color:#666">Detail</th>
        </tr></thead>
        <tbody>${checkRows}</tbody>
      </table>`;
    }
  }

  const legendHtml = hasBefore
    ? `<div style="display:flex;gap:16px;margin-top:12px;font-size:11px;color:#666">
        <span><span style="color:#00d4aa">\u25cf</span> After</span>
        <span><span style="color:#f66">\u25cf</span> Before</span>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentLint Report — ${date}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fafafa; color: #222; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 600; color: #111; }
  h2 { color: #333; }
  tr:hover { background: #f0f0f0; }
</style>
</head>
<body>
  <h1>AgentLint Report</h1>
  <div style="color:#666;margin-top:4px">${date}</div>

  <div style="display:flex;gap:48px;align-items:center;margin-top:24px;flex-wrap:wrap">
    <div>
      ${deltaHtml}
      ${dimBars}
    </div>
    <div>
      ${radarSvg}
      ${legendHtml}
    </div>
  </div>

  ${projectTable}
  ${checkDetails}

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;color:#666;font-size:11px">
    Generated by <a href="https://github.com/0xmariowu/agent-lint" style="color:#00d4aa;text-decoration:none">AgentLint</a>
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
      const mdPath = path.join(dir, `hh-${date}.md`);
      fs.writeFileSync(mdPath, md);
      process.stderr.write(`Report: ${mdPath}\n`);
    }

    if (format === 'jsonl' || format === 'all') {
      const jsonl = generateJsonl(scores, date);
      const jsonlPath = path.join(dir, `hh-${date}.jsonl`);
      fs.writeFileSync(jsonlPath, jsonl);
      process.stderr.write(`Data: ${jsonlPath}\n`);
    }

    if (format === 'html' || format === 'all') {
      const html = generateHtmlReport(scores, beforeScores, plan, date);
      const htmlPath = path.join(dir, `hh-${date}.html`);
      fs.writeFileSync(htmlPath, html);
      process.stderr.write(`HTML: ${htmlPath}\n`);
    }
  }
}

main();
