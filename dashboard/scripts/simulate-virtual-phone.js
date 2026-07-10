#!/usr/bin/env node
/**
 * 가상 폰 E2E: 로그인 → 제어 ON → 알림/연락처/통화/사진·동영상 업로드 → 학교·시간표 → 바탕화면 저장 확인
 * Android 앱과 동일하게 Bearer + userKey, 청크 업로드 사용
 */
const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SKIP_NGROK = process.env.SKIP_NGROK !== '0';
const NGROK = process.env.NGROK_URL || 'https://residency-retreat-sterile.ngrok-free.dev/';
const PHONE_NAME = process.env.PHONE_NAME || '가상폰테스트';
const CHUNK_SIZE = 256 * 1024;

const headers = (token, extra = {}) => ({
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...(BASE.includes('ngrok') || NGROK.includes('ngrok') ? { 'ngrok-skip-browser-warning': 'true' } : {}),
  ...extra
});

function pass(step, detail = '') {
  return { step, ok: true, detail };
}
function fail(step, detail = '') {
  return { step, ok: false, detail };
}

async function request(url, opts = {}) {
  const isNgrok = url.includes('ngrok');
  const h = { ...(opts.headers || {}) };
  if (isNgrok) h['ngrok-skip-browser-warning'] = 'true';
  const res = await fetch(url, { ...opts, headers: h });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** 최소 유효 JPEG (1x1) */
function tinyJpegBuffer() {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDAREAAhEBAxEB/8QAFwABAQEBAAAAAAAAAAAAAAAAAAUGB//EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
    'base64'
  );
}

function fakeMp4Buffer() {
  const buf = Buffer.alloc(4096, 0);
  buf.write('ftypisom', 4);
  return buf;
}

async function uploadChunked(baseUrl, token, userKey, filename, data, mime) {
  const totalChunks = Math.max(1, Math.ceil(data.length / CHUNK_SIZE));
  const uploadId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = data.subarray(start, Math.min(start + CHUNK_SIZE, data.length));
    const form = new FormData();
    form.append('userKey', userKey);
    form.append('filename', filename);
    form.append('uploadId', uploadId);
    form.append('chunkIndex', String(i));
    form.append('totalChunks', String(totalChunks));
    form.append('file', new Blob([chunk], { type: mime }), filename);

    const { ok, json, status } = await request(`${baseUrl}api/upload-file`, {
      method: 'POST',
      headers: headers(token),
      body: form
    });
    if (!ok || !json.success) {
      return { ok: false, detail: `chunk ${i + 1}/${totalChunks} HTTP ${status} ${JSON.stringify(json)}` };
    }
    if (json.complete) {
      return { ok: true, detail: json.path || json.filename };
    }
  }
  return { ok: false, detail: 'never completed' };
}

async function uploadSingle(baseUrl, token, userKey, filename, data, mime) {
  const form = new FormData();
  form.append('userKey', userKey);
  form.append('filename', filename);
  form.append('file', new Blob([data], { type: mime }), filename);
  const { ok, json, status } = await request(`${baseUrl}api/upload-file`, {
    method: 'POST',
    headers: headers(token),
    body: form
  });
  return ok && json.success
    ? { ok: true, detail: json.path || json.filename }
    : { ok: false, detail: `HTTP ${status} ${JSON.stringify(json)}` };
}

async function runOnBase(baseUrl, label) {
  const results = [];
  let token = '';
  let userKey = '';

  // 1. Health
  {
    const { ok, json } = await request(`${baseUrl}api/health`);
    results.push(
      ok && json.status === 'ok'
        ? pass(`${label} 헬스체크`, json.storageRoot)
        : fail(`${label} 헬스체크`, JSON.stringify(json))
    );
  }

  // 2. Login (가상 폰)
  {
    const { ok, json } = await request(`${baseUrl}api/login`, {
      method: 'POST',
      headers: headers(null, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: PHONE_NAME })
    });
    if (ok && json.success && json.token) {
      token = json.token;
      userKey = json.userKey || json.userId;
      const ascii = [...token].every((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0x7e);
      results.push(pass(`${label} 로그인`, `${userKey} ascii=${ascii}`));
    } else {
      results.push(fail(`${label} 로그인`, JSON.stringify(json)));
      return { label, results, userKey };
    }
  }

  // 3. Heartbeat
  {
    const { ok, json } = await request(`${baseUrl}api/heartbeat`, {
      method: 'POST',
      headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ userKey })
    });
    results.push(ok && json.success ? pass(`${label} 하트비트`) : fail(`${label} 하트비트`, JSON.stringify(json)));
  }

  // 4. Remote control — 미디어·알림 ON (앱과 동일)
  {
    const { ok, json } = await request(`${baseUrl}api/control/set`, {
      method: 'POST',
      headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ userKey, notificationCollect: true, mediaBackup: true })
    });
    results.push(ok && json.success ? pass(`${label} 원격제어 ON`) : fail(`${label} 원격제어 ON`, JSON.stringify(json)));
  }

  // 5. Notifications
  {
    const { ok, json } = await request(`${baseUrl}api/notification`, {
      method: 'POST',
      headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        userKey,
        sender: '카카오톡',
        message: '가상폰 테스트 알림',
        packageName: 'com.kakao.talk',
        receivedAt: Date.now()
      })
    });
    results.push(ok && json.success ? pass(`${label} 알림 업로드`) : fail(`${label} 알림 업로드`, JSON.stringify(json)));
  }

  // 6. Contacts
  {
    const { ok, json } = await request(`${baseUrl}api/contacts`, {
      method: 'POST',
      headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        userKey,
        contacts: [
          { name: '김테스트', phone: '010-1111-2222' },
          { name: '이가상', phone: '010-3333-4444' },
          { name: '박폰', phone: '010-5555-6666' }
        ]
      })
    });
    results.push(
      ok && json.success && json.count === 3
        ? pass(`${label} 연락처 3건`)
        : fail(`${label} 연락처`, JSON.stringify(json))
    );
  }

  // 7. Call log
  {
    const { ok, json } = await request(`${baseUrl}api/call-log`, {
      method: 'POST',
      headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        userKey,
        callLogs: [
          { number: '01011112222', name: '김테스트', type: 'incoming', date: Date.now() - 60000, durationSec: 45 },
          { number: '01033334444', name: '이가상', type: 'outgoing', date: Date.now() - 120000, durationSec: 12 }
        ]
      })
    });
    results.push(
      ok && json.success && json.count === 2
        ? pass(`${label} 통화기록 2건`)
        : fail(`${label} 통화기록`, JSON.stringify(json))
    );
  }

  // 8. Photos (청크 — 앱과 동일)
  const photos = [
    { name: 'virtual_photo_1.jpg', data: tinyJpegBuffer() },
    { name: 'virtual_photo_2.jpg', data: Buffer.concat([tinyJpegBuffer(), tinyJpegBuffer()]) },
    { name: 'virtual_photo_3.jpg', data: Buffer.alloc(300 * 1024, 0xff) } // >256KB → multi-chunk
  ];
  for (const photo of photos) {
    const up =
      photo.data.length > CHUNK_SIZE
        ? await uploadChunked(baseUrl, token, userKey, photo.name, photo.data, 'image/jpeg')
        : await uploadSingle(baseUrl, token, userKey, photo.name, photo.data, 'image/jpeg');
    results.push(up.ok ? pass(`${label} 사진 ${photo.name}`) : fail(`${label} 사진 ${photo.name}`, up.detail));
  }

  // 9. Video
  {
    const up = await uploadChunked(baseUrl, token, userKey, 'virtual_clip.mp4', fakeMp4Buffer(), 'video/mp4');
    results.push(up.ok ? pass(`${label} 동영상 virtual_clip.mp4`) : fail(`${label} 동영상`, up.detail));
  }

  // 10. School save (동해중 3-3)
  {
    const { ok, json } = await request(`${baseUrl}api/profile/school`, {
      method: 'POST',
      headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        userKey,
        schoolCode: 12485,
        schoolName: '동해중학교',
        schoolRegion: '부산광역시',
        grade: 3,
        classNum: 3
      })
    });
    results.push(ok && json.success ? pass(`${label} 학교 저장`) : fail(`${label} 학교 저장`, JSON.stringify(json)));
  }

  // 11. Wait schedule sync
  await new Promise((r) => setTimeout(r, 8000));
  {
    const { ok, json } = await request(
      `${baseUrl}api/profile/schedule-data?userKey=${encodeURIComponent(userKey)}`,
      { headers: headers(token) }
    );
    const cells = json.schedule?.length || json.weekView?.length || 0;
    results.push(
      ok && json.success && cells > 0
        ? pass(`${label} 시간표`, `${cells}칸`)
        : fail(`${label} 시간표`, JSON.stringify({ ok, cells, school: json.school }))
    );
  }

  // 12. Admin dashboard verify
  {
    const { ok, json } = await request(`${baseUrl}api/admin/users/${encodeURIComponent(userKey)}`);
    const stats = json.user?.stats || {};
    const notifList = Array.isArray(json.notifications)
      ? json.notifications
      : json.notifications?.notifications || [];
    const mediaDays = Object.keys(json.mediaByDate || {}).length;
    results.push(
      ok &&
        notifList.length >= 1 &&
        (json.contacts?.length || 0) >= 3 &&
        (json.callLogs?.length || 0) >= 2 &&
        mediaDays >= 1
        ? pass(`${label} 대시보드 반영`, `알림=${notifList.length} 연락처=${json.contacts?.length} 통화=${json.callLogs?.length} 미디어일=${mediaDays}`)
        : fail(`${label} 대시보드 반영`, JSON.stringify({
            notifications: notifList.length,
            contacts: json.contacts?.length,
            callLogs: json.callLogs?.length,
            mediaDays
          }))
    );
  }

  return { label, results, userKey, token };
}

async function verifyStorageFiles(baseUrl, userKey) {
  const checks = [];
  const { ok, json } = await request(`${baseUrl}api/admin/storage-info`);
  if (!ok || !json.storageRoot) {
    return [fail('저장 경로 API', JSON.stringify(json))];
  }
  checks.push(pass('저장 경로', `${json.storageMode}: ${json.storageRoot}`));

  const desktop = path.join(json.storageRoot, userKey);
  if (!fs.existsSync(desktop)) {
    return [...checks, fail('사용자 저장 폴더', `없음: ${desktop}`)];
  }
  checks.push(pass('사용자 저장 폴더', desktop));

  const CATEGORIES = {
    photos: '사진',
    videos: '동영상',
    contacts: '연락처',
    callLog: '통화기록',
    notifications: '전체알림'
  };

  const subdirs = Object.values(CATEGORIES).map((d) => path.join(desktop, d));
  for (const dir of subdirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir, { recursive: true }).filter((f) => {
        const full = path.join(dir, f);
        return fs.statSync(full).isFile();
      });
      checks.push(files.length > 0 ? pass(`폴더 ${path.basename(dir)}`, `${files.length}개 파일`) : fail(`폴더 ${path.basename(dir)}`, '비어 있음'));
    } else {
      checks.push(fail(`폴더 ${path.basename(dir)}`, '없음'));
    }
  }

  const photoDir = path.join(desktop, CATEGORIES.photos);
  if (fs.existsSync(photoDir)) {
    const jpgs = fs.readdirSync(photoDir).filter((f) => f.includes('virtual_photo'));
    checks.push(
      jpgs.length >= 3
        ? pass('사진 파일명', jpgs.join(', '))
        : fail('사진 파일명', `virtual_photo* ${jpgs.length}개`)
    );
  }

  return checks;
}

async function main() {
  const localBase = BASE.endsWith('/') ? BASE : `${BASE}/`;
  const ngrokBase = NGROK.endsWith('/') ? NGROK : `${NGROK}/`;

  console.log('=== 가상 폰 E2E 테스트 ===');
  console.log(`사용자: ${PHONE_NAME}`);
  if (SKIP_NGROK) {
    console.log('NGROK 테스트: 건너뜀 (SKIP_NGROK≠0)');
  }

  const localRun = await runOnBase(localBase, 'LOCAL');
  const storageChecks = await verifyStorageFiles(localBase, localRun.userKey);

  let ngrokRun = { label: 'NGROK', results: [], userKey: localRun.userKey };
  if (!SKIP_NGROK) {
    try {
      ngrokRun = await runOnBase(ngrokBase, 'NGROK');
    } catch (e) {
      ngrokRun = { label: 'NGROK', results: [fail('NGROK 전체', e.message)], userKey: localRun.userKey };
    }
  }

  const all = [...localRun.results, ...storageChecks, ...ngrokRun.results];
  const passCount = all.filter((r) => r.ok).length;

  console.log('\n--- LOCAL ---');
  localRun.results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.step}${r.detail ? ': ' + r.detail : ''}`));

  console.log('\n--- 서버 저장소 ---');
  storageChecks.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.step}${r.detail ? ': ' + r.detail : ''}`));

  if (!SKIP_NGROK) {
    console.log('\n--- NGROK (폰 경로) ---');
    ngrokRun.results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.step}${r.detail ? ': ' + r.detail : ''}`));
  }

  const summary = {
    phoneName: PHONE_NAME,
    userKey: localRun.userKey,
    pass: passCount,
    total: all.length,
    allPass: passCount === all.length
  };
  console.log('\n=== 요약 ===');
  console.log(JSON.stringify(summary, null, 2));

  process.exit(summary.allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
