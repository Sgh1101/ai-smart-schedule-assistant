#!/usr/bin/env node
/**
 * 전체 기능 + AI 검사 (ngrok/서버주소 UI 제외)
 */
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TEST_USER = 'full_audit_user';

async function get(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, json };
}

function pass(name, detail = '') {
  return { name, ok: true, detail };
}
function fail(name, detail = '') {
  return { name, ok: false, detail };
}

async function runTests(tests) {
  const results = [];
  for (const t of tests) {
    try {
      results.push(await t());
    } catch (e) {
      results.push(fail(t.name || 'unknown', e.message));
    }
  }
  return results;
}

async function ensureUserWithSchedule() {
  await post('/api/login', { name: TEST_USER });
  await post(`/api/profile/school?userKey=${encodeURIComponent(TEST_USER)}`, {
    schoolCode: 12485,
    schoolName: '동해중학교',
    schoolRegion: '부산광역시',
    grade: 3,
    classNum: 3
  });
  await post(`/api/comcigan/sync?userKey=${encodeURIComponent(TEST_USER)}`);
}

async function main() {
  const sections = [];

  // --- AI ---
  await ensureUserWithSchedule();
  const ai = await runTests([
    async function aiKeyConfigured() {
      const keyFile = path.join(__dirname, '..', 'gemini-api-key.txt');
      const hasEnv = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
      const hasFile =
        fs.existsSync(keyFile) &&
        fs
          .readFileSync(keyFile, 'utf8')
          .split(/\r?\n/)
          .some((l) => l.trim() && !l.startsWith('#') && !l.includes('REPLACE'));
      return hasEnv || hasFile ? pass('AI 1. API 키 설정', hasEnv ? 'env' : 'file') : fail('AI 1. API 키 설정', '없음');
    },
    async function aiChatEndpoint() {
      const { ok, json } = await post('/api/ai/chat', {
        userKey: TEST_USER,
        messages: [{ role: 'user', content: '안녕. 한 문장으로만 답해줘.' }],
        system: '한국어로 짧게 답하세요.'
      });
      if (!ok || !json.success || !json.text) {
        return fail('AI 2. Gemini 채팅', json.message || JSON.stringify(json).slice(0, 200));
      }
      return pass('AI 2. Gemini 채팅', `${json.model || 'model'} · ${json.text.slice(0, 40)}…`);
    },
    async function aiScheduleContext() {
      const { ok, json } = await post('/api/ai/chat', {
        userKey: TEST_USER,
        messages: [{ role: 'user', content: '내가 다니는 학교 이름만 말해줘.' }]
      });
      const text = String(json.text || '');
      const hasSchool = text.includes('동해');
      return ok && json.success && hasSchool
        ? pass('AI 3. 시간표 컨텍스트', text.slice(0, 60))
        : fail('AI 3. 시간표 컨텍스트', text.slice(0, 120) || json.message);
    },
    async function profileChatSync() {
      const { ok, json } = await post('/api/profile/chat', {
        userKey: TEST_USER,
        role: 'user',
        text: 'full-audit-sync-test',
        timestamp: Date.now()
      });
      return ok && json.success ? pass('AI 4. 대화 기록 저장') : fail('AI 4. 대화 기록 저장', JSON.stringify(json));
    },
    async function dashboardChatHistory() {
      const { ok, json } = await get('/api/admin/users/' + encodeURIComponent(TEST_USER));
      const history = json.profile?.chatHistory || [];
      const has = history.some((h) => String(h.text || '').includes('full-audit') || String(h.text || '').includes('안녕'));
      return ok && has ? pass('AI 5. 대시보드 채팅 반영', `${history.length}건`) : fail('AI 5. 대시보드 채팅 반영', `${history.length}건`);
    }
  ]);
  sections.push({ title: 'AI (5)', results: ai, pass: ai.filter((r) => r.ok).length, total: ai.length });

  // --- 성적 퍼센트 ---
  const grade = await runTests([
    async function gradeList() {
      const { ok, json } = await get('/api/admin/grade-percent');
      return ok && Array.isArray(json.schools) ? pass('성적 1. 관리자 목록', `${json.count || json.schools.length}교`) : fail('성적 1. 관리자 목록');
    },
    async function gradeReady() {
      const { ok, json } = await get('/api/grade-percent/ready-schools');
      return ok && json.success !== false ? pass('성적 2. 준비 학교 API') : fail('성적 2. 준비 학교 API', JSON.stringify(json));
    },
    async function gradeTables() {
      const { ok, json } = await get('/api/grade-percent/tables?schoolCode=12485');
      return ok ? pass('성적 3. 표 조회 API') : fail('성적 3. 표 조회 API', String(json.message));
    },
    async function gradeCalculate() {
      const { ok, json } = await post('/api/grade-percent/calculate', {
        schoolCode: 12485,
        grade: 3,
        grades: [95, 88, 92, 90, 85]
      });
      return ok && json.success ? pass('성적 4. 퍼센트 계산', JSON.stringify(json.result || json).slice(0, 80)) : fail('성적 4. 퍼센트 계산', json.message || JSON.stringify(json));
    }
  ]);
  sections.push({ title: '성적 퍼센트 (4)', results: grade, pass: grade.filter((r) => r.ok).length, total: grade.length });

  // --- 스트리밍·백업·제어 ---
  const extra = await runTests([
    async function streamMedia() {
      const { json: users } = await get('/api/admin/users');
      const user = (users.users || []).find((u) => (u.stats?.mediaCount || 0) > 0);
      if (!user) return pass('기타 1. 미디어 스트림', '미디어 없음 — 스킵');
      const { json: detail } = await get('/api/admin/users/' + encodeURIComponent(user.userKey || user.userId) + '/media');
      const dates = Object.values(detail.mediaByDate || {}).flat();
      const item = dates[0];
      if (!item?.filename) return fail('기타 1. 미디어 스트림', '파일 없음');
      const res = await fetch(BASE + '/api/stream/' + encodeURIComponent(user.userKey || user.userId) + '/' + encodeURIComponent(item.filename));
      return res.ok ? pass('기타 1. 미디어 스트림', item.filename) : fail('기타 1. 미디어 스트림', String(res.status));
    },
    async function registerApi() {
      const name = 'register_audit_' + Date.now();
      const { ok, json } = await post('/api/register', { name });
      return ok && json.success ? pass('기타 2. 회원가입 API', json.userKey) : fail('기타 2. 회원가입 API', JSON.stringify(json));
    },
    async function scheduleDataApi() {
      const { ok, json } = await get('/api/profile/schedule-data?userKey=' + encodeURIComponent(TEST_USER));
      const has = (json.weekView?.length || 0) > 0;
      return ok && json.success && has ? pass('기타 3. 앱 시간표 API', `${json.weekView.length}행`) : fail('기타 3. 앱 시간표 API');
    },
    async function adminScheduleSync() {
      const { ok, json } = await post('/api/admin/users/' + encodeURIComponent(TEST_USER) + '/schedule-sync');
      return ok && json.success ? pass('기타 4. 관리자 시간표 새로고침') : fail('기타 4. 관리자 시간표 새로고침', json.message);
    },
    async function pullAgentScript() {
      const script = path.join(__dirname, 'local-pull-agent.js');
      return fs.existsSync(script) ? pass('기타 5. 풀 에이전트 스크립트') : fail('기타 5. 풀 에이전트 스크립트');
    }
  ]);
  sections.push({ title: '기타 기능 (5)', results: extra, pass: extra.filter((r) => r.ok).length, total: extra.length });

  const totalPass = sections.reduce((s, x) => s + x.pass, 0);
  const total = sections.reduce((s, x) => s + x.total, 0);

  console.log(JSON.stringify({ base: BASE, testUser: TEST_USER, sections, totalPass, total, allPass: totalPass === total }, null, 2));
  process.exit(totalPass === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
