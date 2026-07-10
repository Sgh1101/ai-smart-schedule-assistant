#!/usr/bin/env node
/**
 * Render 라이브 5회 반복 전체 기능 감사
 * 카테고리별 5라운드 pass/fail 집계
 */
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || 'https://ai-smart-schedule-dashboard.onrender.com').replace(/\/$/, '');
const ROUNDS = Number(process.env.AUDIT_ROUNDS || 5);
const RENDER_URL = 'https://ai-smart-schedule-dashboard.onrender.com';
const CHUNK_SIZE = 256 * 1024;
const BACKOFF_MS = [3000, 6000, 12000, 20000, 30000];

const results = {};

function initCat(name) {
  if (!results[name]) results[name] = { pass: 0, fail: 0, errors: [] };
}

function record(name, ok, detail = '') {
  initCat(name);
  if (ok) results[name].pass++;
  else {
    results[name].fail++;
    if (detail) results[name].errors.push(detail);
  }
}

async function fetchWithRetry(url, opts = {}, maxRetries = 3) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text.slice(0, 300) };
      }
      return { ok: res.ok, status: res.status, json, text, headers: res.headers };
    } catch (e) {
      lastErr = e;
      if (i < maxRetries - 1) {
        await sleep(BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]);
      }
    }
  }
  throw lastErr || new Error('fetch failed');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tinyJpeg() {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDAREAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAUGB//EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
    'base64'
  );
}

// --- Category tests ---

async function testHealth() {
  const { ok, json } = await fetchWithRetry(`${BASE}/api/health`);
  const good = ok && json.status === 'ok' && json.storageMode;
  record('1. Health + storage mode', good, good ? '' : JSON.stringify(json));
  return { storageMode: json.storageMode, storageRoot: json.storageRoot };
}

async function testRegisterLogin() {
  const name = `audit_reg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const reg = await fetchWithRetry(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const regOk = reg.ok && reg.json.success && reg.json.userKey;
  record('2. Register + login', regOk, regOk ? '' : `register: ${JSON.stringify(reg.json)}`);
  if (!regOk) return null;

  const login = await fetchWithRetry(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const loginOk = login.ok && login.json.success && login.json.token && login.json.userKey;
  record('2. Register + login', loginOk, loginOk ? '' : `login: ${JSON.stringify(login.json)}`);
  return loginOk ? { userKey: login.json.userKey, token: login.json.token, name } : null;
}

async function testNotification(userKey) {
  const { ok, json } = await fetchWithRetry(`${BASE}/api/notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userKey,
      sender: 'audit',
      message: `notif_${Date.now()}`,
      packageName: 'com.test',
      receivedAt: Date.now()
    })
  });
  const good = ok && json.success;
  record('3. Notification ingest', good, good ? '' : JSON.stringify(json));
}

async function testMediaUpload(userKey, token) {
  const filename = `audit_chunk_${Date.now()}.jpg`;
  const data = Buffer.concat([tinyJpeg(), Buffer.alloc(300 * 1024, 0xff)]);
  const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
  const uploadId = `audit-${Date.now()}`;

  let completed = false;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = data.subarray(start, Math.min(start + CHUNK_SIZE, data.length));
    const form = new FormData();
    form.append('userKey', userKey);
    form.append('filename', filename);
    form.append('uploadId', uploadId);
    form.append('chunkIndex', String(i));
    form.append('totalChunks', String(totalChunks));
    form.append('file', new Blob([chunk], { type: 'image/jpeg' }), filename);

    const res = await fetchWithRetry(`${BASE}/api/upload-file`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form
    });
    if (!res.ok || !res.json.success) {
      record('4. Media upload (chunk+complete)', false, `chunk ${i}: ${JSON.stringify(res.json)}`);
      return;
    }
    if (res.json.complete) completed = true;
  }
  record('4. Media upload (chunk+complete)', completed, completed ? '' : 'never completed');
}

async function testPullSync(userKey) {
  const settings = await fetchWithRetry(`${BASE}/api/admin/pull-sync/settings`);
  const s1 = settings.ok && settings.json.settings;
  if (!s1) {
    record('5. Pull-sync queue APIs', false, `settings: ${JSON.stringify(settings.json)}`);
    return;
  }

  const form = new FormData();
  const fname = `pull5_${Date.now()}.jpg`;
  form.append('filename', fname);
  form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]), fname);
  const up = await fetchWithRetry(`${BASE}/api/upload-file?userKey=${encodeURIComponent(userKey)}`, {
    method: 'POST',
    body: form
  });
  if (!up.ok || !up.json.success) {
    record('5. Pull-sync queue APIs', false, `upload: ${JSON.stringify(up.json)}`);
    return;
  }

  const queue = await fetchWithRetry(`${BASE}/api/admin/pull-queue`);
  const user = (queue.json.users || []).find((u) => u.userKey === userKey);
  const inQueue = (user?.items || []).some((i) => i.filename === fname);
  if (!inQueue) {
    record('5. Pull-sync queue APIs', false, `not in queue: ${fname}`);
    return;
  }

  const pull = await fetchWithRetry(
    `${BASE}/api/admin/pull-file/${encodeURIComponent(userKey)}?category=${encodeURIComponent('사진')}&filename=${encodeURIComponent(fname)}`
  );
  const pullOk = pull.ok && pull.text && pull.text.length >= 4;

  const confirm = await fetchWithRetry(`${BASE}/api/admin/users/${encodeURIComponent(userKey)}/confirm-pulled`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ category: '사진', filename: fname, size: 4 }] })
  });
  const confirmOk = confirm.ok && (confirm.json.deleted || []).length >= 1;

  record('5. Pull-sync queue APIs', pullOk && confirmOk, pullOk && confirmOk ? '' : `pull=${pullOk} confirm=${confirmOk}`);
}

async function testAiChat(userKey) {
  // Setup schedule context
  await fetchWithRetry(`${BASE}/api/profile/school?userKey=${encodeURIComponent(userKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schoolCode: 12485,
      schoolName: '동해중학교',
      schoolRegion: '부산광역시',
      grade: 3,
      classNum: 3
    })
  });
  await fetchWithRetry(`${BASE}/api/comcigan/sync?userKey=${encodeURIComponent(userKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  const { ok, json } = await fetchWithRetry(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userKey,
      messages: [{ role: 'user', content: '안녕. 한 문장으로만 답해줘.' }],
      system: '한국어로 짧게 답하세요.'
    })
  });
  const good = ok && json.success && json.text;
  record('6. Gemini AI chat', good, good ? '' : JSON.stringify(json).slice(0, 200));
}

async function testScheduleComcigan(userKey) {
  let s1 = false;
  for (let attempt = 0; attempt < 3 && !s1; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] || 3000);
    const search = await fetchWithRetry(`${BASE}/api/comcigan/search?keyword=${encodeURIComponent('동해')}`);
    s1 = search.ok && search.json.success && search.json.count >= 1;
  }

  const sync = await fetchWithRetry(`${BASE}/api/comcigan/sync?userKey=${encodeURIComponent(userKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const s2 = sync.ok && sync.json.success;

  const sched = await fetchWithRetry(`${BASE}/api/profile/schedule-data?userKey=${encodeURIComponent(userKey)}`);
  const s3 = sched.ok && sched.json.success && ((sched.json.weekView?.length || 0) > 0 || (sched.json.schedule?.length || 0) > 0);

  record('7. Schedule/Comcigan', s1 && s2 && s3, s1 && s2 && s3 ? '' : `search=${s1} sync=${s2} data=${s3}`);
}

async function testBackupZip(userKey) {
  const res = await fetchWithRetry(`${BASE}/api/backup/${encodeURIComponent(userKey)}`);
  const ct = res.headers?.get?.('content-type') || '';
  const good = res.ok && (ct.includes('zip') || ct.includes('octet-stream'));
  record('8. Backup zip API', good, good ? '' : `status=${res.status} ct=${ct}`);
}

async function testStaticPages() {
  const index = await fetchWithRetry(`${BASE}/`);
  const iOk = index.ok && index.text && index.text.includes('<');

  const config = await fetchWithRetry(`${BASE}/config.js`);
  const cOk = config.ok && config.text && config.text.length > 10;

  record('9. Dashboard static pages', iOk && cOk, iOk && cOk ? '' : `index=${iOk} config=${cOk}`);
}

async function testVirtualPhone() {
  const name = `가상폰5회_${Date.now()}`;
  const login = await fetchWithRetry(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!login.ok || !login.json.token) {
    record('10. Virtual phone E2E', false, `login: ${JSON.stringify(login.json)}`);
    return;
  }
  const { userKey, token } = login.json;

  const steps = [];
  const hb = await fetchWithRetry(`${BASE}/api/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userKey })
  });
  steps.push(hb.ok && hb.json.success);

  const ctrl = await fetchWithRetry(`${BASE}/api/control/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userKey, notificationCollect: true, mediaBackup: true })
  });
  steps.push(ctrl.ok && ctrl.json.success);

  const notif = await fetchWithRetry(`${BASE}/api/notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userKey, sender: '카카오', message: '가상폰', packageName: 'com.kakao.talk', receivedAt: Date.now() })
  });
  steps.push(notif.ok && notif.json.success);

  const form = new FormData();
  form.append('userKey', userKey);
  form.append('filename', 'vp_photo.jpg');
  form.append('file', new Blob([tinyJpeg()], { type: 'image/jpeg' }), 'vp_photo.jpg');
  const up = await fetchWithRetry(`${BASE}/api/upload-file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  steps.push(up.ok && up.json.success);

  const admin = await fetchWithRetry(`${BASE}/api/admin/users/${encodeURIComponent(userKey)}`);
  const hasData =
    admin.ok &&
    (admin.json.notifications?.length || admin.json.notifications?.notifications?.length || 0) >= 1;
  steps.push(hasData);

  const good = steps.every(Boolean);
  record('10. Virtual phone E2E', good, good ? '' : `steps=${steps.join(',')}`);
}

function testConstantsUrl() {
  const ktPath = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'java', 'com', 'aischedule', 'assistant', 'Constants.kt');
  let good = false;
  let detail = '';
  try {
    const content = fs.readFileSync(ktPath, 'utf8');
    const match = content.match(/DEFAULT_CLOUD_SYNC_BASE_URL\s*=\s*"([^"]+)"/);
    if (match) {
      const url = match[1].replace(/\/$/, '');
      good = url === RENDER_URL;
      detail = good ? '' : `Constants=${url} vs Render=${RENDER_URL}`;
    } else {
      detail = 'DEFAULT_CLOUD_SYNC_BASE_URL not found';
    }
  } catch (e) {
    detail = e.message;
  }
  record('11. Constants.kt URL match', good, detail);
}

function testFreeTierLimits(storageInfo) {
  const mode = storageInfo?.storageMode || '';
  const root = storageInfo?.storageRoot || '';
  const ephemeral = storageInfo?.ephemeral || mode === 'ephemeral' || root.includes('/tmp');
  const good = !!mode && !!root && ephemeral;
  const detail = good
    ? `${mode}: ${root} (ephemeral/free-tier, no persistent disk)`
    : `mode=${mode} root=${root} ephemeral=${ephemeral}`;
  record('12. Free tier storage (/tmp)', good, detail);
  return { mode, root, ephemeral };
}

async function runRound(round) {
  console.log(`\n=== Round ${round}/${ROUNDS} ===`);
  let healthInfo = {};
  try {
    healthInfo = await testHealth();
  } catch (e) {
    record('1. Health + storage mode', false, e.message);
  }

  testConstantsUrl();

  if (healthInfo.storageMode) {
    testFreeTierLimits(healthInfo);
  } else {
    record('12. Free tier storage (/tmp)', false, 'health failed');
  }

  await testStaticPages();

  let session = null;
  try {
    session = await testRegisterLogin();
  } catch (e) {
    record('2. Register + login', false, e.message);
  }

  if (!session) {
    // Fallback login for remaining tests
    try {
      const login = await fetchWithRetry(`${BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'audit_fallback_user' })
      });
      if (login.ok && login.json.userKey) {
        session = { userKey: login.json.userKey, token: login.json.token };
      }
    } catch (_) {}
  }

  if (session) {
    const { userKey, token } = session;
    try {
      await testNotification(userKey);
    } catch (e) {
      record('3. Notification ingest', false, e.message);
    }
    try {
      await testMediaUpload(userKey, token);
    } catch (e) {
      record('4. Media upload (chunk+complete)', false, e.message);
    }
    try {
      await testPullSync(userKey);
    } catch (e) {
      record('5. Pull-sync queue APIs', false, e.message);
    }
    try {
      await testAiChat(userKey);
    } catch (e) {
      record('6. Gemini AI chat', false, e.message);
    }
    try {
      await testScheduleComcigan(userKey);
    } catch (e) {
      record('7. Schedule/Comcigan', false, e.message);
    }
    try {
      await testBackupZip(userKey);
    } catch (e) {
      record('8. Backup zip API', false, e.message);
    }
  } else {
    ['3. Notification ingest', '4. Media upload (chunk+complete)', '5. Pull-sync queue APIs', '6. Gemini AI chat', '7. Schedule/Comcigan', '8. Backup zip API'].forEach(
      (c) => record(c, false, 'no session')
    );
  }

  try {
    await testVirtualPhone();
  } catch (e) {
    record('10. Virtual phone E2E', false, e.message);
  }
}

async function main() {
  console.log(`Render 5-round audit: ${BASE}`);
  console.log(`Rounds: ${ROUNDS}`);

  for (let r = 1; r <= ROUNDS; r++) {
    await runRound(r);
    if (r < ROUNDS) await sleep(2000);
  }

  const summary = {
    base: BASE,
    rounds: ROUNDS,
    categories: Object.entries(results).map(([name, v]) => ({
      name,
      pass: v.pass,
      fail: v.fail,
      rate: `${v.pass}/${v.pass + v.fail}`,
      sampleErrors: [...new Set(v.errors)].slice(0, 3)
    })),
    allPass: Object.values(results).every((v) => v.fail === 0)
  };

  console.log('\n=== FINAL SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  const outPath = path.join(__dirname, 'render-5round-audit-result.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nSaved: ${outPath}`);

  process.exit(summary.allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
