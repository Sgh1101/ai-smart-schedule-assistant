#!/usr/bin/env node
/**
 * 모든 감사 스크립트 5회 반복 실행 + 결과 집계
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'https://ai-smart-schedule-dashboard.onrender.com';
const ROUNDS = Number(process.env.AUDIT_ROUNDS || 5);
const SCRIPTS = [
  { name: 'render-5round-audit', file: 'render-5round-audit.js', rounds: 1, parse: 'render5' },
  { name: 'audit-dashboard', file: 'audit-dashboard.js', rounds: ROUNDS, parse: 'audit40' },
  { name: 'full-feature-audit', file: 'full-feature-audit.js', rounds: ROUNDS, parse: 'full' },
  { name: 'simulate-virtual-phone', file: 'simulate-virtual-phone.js', rounds: ROUNDS, parse: 'phone' }
];

function runScript(scriptFile) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, scriptFile);
    const child = spawn('node', [scriptPath], {
      env: { ...process.env, BASE_URL: BASE, SKIP_NGROK: '1' },
      cwd: path.join(__dirname, '..')
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function parseJson(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

async function main() {
  const report = { base: BASE, rounds: ROUNDS, scripts: [] };

  for (const script of SCRIPTS) {
    const scriptResults = { name: script.name, rounds: [], pass: 0, fail: 0 };
    const totalRounds = script.name === 'render-5round-audit' ? 1 : ROUNDS;

    for (let r = 1; r <= totalRounds; r++) {
      console.log(`\n>>> ${script.name} round ${r}/${totalRounds}`);
      const { code, stdout, stderr } = await runScript(script.file);
      const json = parseJson(stdout);

      if (script.parse === 'render5' && json?.categories) {
        scriptResults.rounds.push({ round: r, pass: json.categories.filter((c) => c.fail === 0).length, total: json.categories.length, allPass: json.allPass, detail: json });
        if (json.allPass) scriptResults.pass++;
        else scriptResults.fail++;
      } else if (json) {
        const pass = json.totalPass ?? json.pass ?? 0;
        const total = json.total ?? 0;
        scriptResults.rounds.push({ round: r, pass, total, allPass: json.allPass ?? code === 0, exitCode: code });
        if (json.allPass || code === 0) scriptResults.pass++;
        else scriptResults.fail++;
      } else {
        scriptResults.rounds.push({ round: r, error: stderr.slice(0, 200) || 'parse failed', exitCode: code });
        scriptResults.fail++;
      }
      if (r < totalRounds) await new Promise((r) => setTimeout(r, 3000));
    }
    report.scripts.push(scriptResults);
  }

  console.log('\n=== MASTER REPORT ===');
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(__dirname, 'master-audit-report.json'), JSON.stringify(report, null, 2));
}

main().catch(console.error);
