#!/usr/bin/env node
/**
 * 40-point audit: comcigan(10) + dashboard data(10) + features(10) + performance(10)
 */
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const DASHBOARD_PIN = process.env.DASHBOARD_PIN || '1101';
const AUDIT_SCHOOL = { code: 12485, name: '동해중학교', region: '부산광역시', grade: 3, classNum: 3 };

function withAdminHeaders(opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!headers['X-Dashboard-Pin']) headers['X-Dashboard-Pin'] = DASHBOARD_PIN;
  return { ...opts, headers };
}

async function get(path, opts = {}) {
  const needsAdmin = path.startsWith('/api/admin') || path.startsWith('/api/backup');
  const res = await fetch(BASE + path, needsAdmin ? withAdminHeaders(opts) : opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

function pass(name, detail = '') {
  return { name, ok: true, detail };
}

function fail(name, detail = '') {
  return { name, ok: false, detail };
}

async function runSection(title, tests) {
  const results = [];
  for (const t of tests) {
    try {
      results.push(await t());
    } catch (e) {
      results.push(fail(t.name || 'unknown', e.message));
    }
  }
  return { title, results, pass: results.filter((r) => r.ok).length, total: results.length };
}

async function main() {
  let userKey = 'audit_schedule_user';

  // 고정 학교 시간표 검사용 사용자 준비
  await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: userKey })
  });

  const comcigan = await runSection('컴시간 알리미 (10)', [
    async () => {
      const { ok, json } = await get('/api/health');
      return ok && json.status === 'ok' ? pass('1. 서버 헬스', json.storageRoot) : fail('1. 서버 헬스', JSON.stringify(json));
    },
    async () => {
      const { ok, json } = await get('/api/comcigan/search?keyword=' + encodeURIComponent('동해'));
      return ok && json.success && json.count >= 1 ? pass('2. 학교 검색', `${json.count}건`) : fail('2. 학교 검색', JSON.stringify(json));
    },
    async () => {
      const { ok, json } = await get('/api/comcigan/search?keyword=' + encodeURIComponent(''));
      return ok && json.success && json.count === 4 ? pass('3. 빈 검색어 처리', '고정 4교') : fail('3. 빈 검색어 처리', JSON.stringify(json));
    },
    async () => {
      const { ok, json } = await get('/api/comcigan/search?keyword=' + encodeURIComponent('zzzznotexist999'));
      return ok && json.success && Array.isArray(json.schools) ? pass('4. 무결과 검색', `${json.count}건`) : fail('4. 무결과 검색');
    },
    async () => {
      const start = Date.now();
      const { ok, json } = await get('/api/comcigan/search?keyword=' + encodeURIComponent('부곡'));
      const ms = Date.now() - start;
      return ok && json.success && ms < 15000 ? pass('5. 검색 응답속도', `${ms}ms`) : fail('5. 검색 응답속도', `${ms}ms`);
    },
    async () => {
      const { ok, json } = await fetch(BASE + '/api/profile/school?userKey=' + encodeURIComponent(userKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolCode: AUDIT_SCHOOL.code,
          schoolName: AUDIT_SCHOOL.name,
          schoolRegion: AUDIT_SCHOOL.region,
          grade: AUDIT_SCHOOL.grade,
          classNum: AUDIT_SCHOOL.classNum
        })
      }).then((r) => r.json().then((j) => ({ ok: r.ok, json: j })));
      return json.success ? pass('6. 학교 등록+동기화') : fail('6. 학교 등록+동기화', JSON.stringify(json));
    },
    async () => {
      const { ok, json } = await get('/api/profile/schedule-data?userKey=' + encodeURIComponent(userKey));
      const has = (json.weekView?.length || 0) > 0 || (json.schedule?.length || 0) > 0;
      return ok && json.success && has ? pass('7. 시간표 데이터', `weekView=${json.weekView?.length}`) : fail('7. 시간표 데이터', JSON.stringify({ ok, has }));
    },
    async () => {
      const { ok, json } = await fetch(BASE + '/api/comcigan/sync?userKey=' + encodeURIComponent(userKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).then((r) => r.json().then((j) => ({ ok: r.ok, json: j })));
      return json.success ? pass('8. 수동 sync API') : fail('8. 수동 sync API', JSON.stringify(json));
    },
    async () => {
      const { json } = await get('/api/admin/users/' + encodeURIComponent(userKey));
      return json.profile?.school?.code ? pass('9. 대시보드 프로필 연동', json.profile.school.name) : fail('9. 대시보드 프로필 연동');
    },
    async () => {
      const { json } = await get('/api/admin/users/' + encodeURIComponent(userKey));
      const hasGrid = (json.profile?.weekView?.length || 0) > 0;
      return hasGrid ? pass('10. 대시보드 시간표 그리드', `${json.profile.weekView.length}행`) : fail('10. 대시보드 시간표 그리드');
    }
  ]);

  const usersRes = await get('/api/admin/users');
  if (usersRes.json.users?.length) {
    userKey = usersRes.json.users[0].userKey || usersRes.json.users[0].userId;
  }

  const dashboard = await runSection('대시보드 수집자료 (10)', [
    async () => {
      const { ok, json } = usersRes;
      return ok && Array.isArray(json.users) && json.users.length > 0 ? pass('1. 사용자 목록', `${json.users.length}명`) : fail('1. 사용자 목록');
    },
    async () => {
      const { ok, json } = await get('/api/admin/users/' + encodeURIComponent(userKey));
      return ok && json.user?.stats ? pass('2. 사용자 통계', JSON.stringify(json.user.stats)) : fail('2. 사용자 통계');
    },
    async () => {
      const { ok, json } = await get('/api/admin/users/' + encodeURIComponent(userKey) + '/notifications');
      return ok && Array.isArray(json.notifications) ? pass('3. 알림 API', `${json.notifications.length}건`) : fail('3. 알림 API');
    },
    async () => {
      const { ok, json } = await get('/api/admin/users/' + encodeURIComponent(userKey) + '/contacts');
      return ok && Array.isArray(json.contacts) ? pass('4. 연락처 API', `${json.contacts.length}건`) : fail('4. 연락처 API');
    },
    async () => {
      const { ok, json } = await get('/api/admin/users/' + encodeURIComponent(userKey) + '/call-log');
      return ok && Array.isArray(json.callLogs) ? pass('5. 통화기록 API', `${json.callLogs.length}건`) : fail('5. 통화기록 API');
    },
    async () => {
      const { ok, json } = await get('/api/admin/users/' + encodeURIComponent(userKey) + '/media');
      return ok && json.mediaByDate && typeof json.mediaByDate === 'object' ? pass('6. 미디어 API', `${Object.keys(json.mediaByDate).length}일`) : fail('6. 미디어 API');
    },
    async () => {
      const { ok, json } = await get('/api/admin/storage-info');
      return ok && json.storageRoot && json.storageMode
        ? pass('7. 저장 경로', `${json.storageMode}: ${json.storageRoot}`)
        : fail('7. 저장 경로', JSON.stringify(json));
    },
    async () => {
      const { ok, json } = await fetch(BASE + '/api/admin/open-storage-folder', withAdminHeaders({ method: 'POST' })).then((r) =>
        r.json().then((j) => ({ ok: r.ok, json: j }))
      );
      return json.success && json.path ? pass('8. 폴더 열기 API', json.path) : fail('8. 폴더 열기 API', JSON.stringify(json));
    },
    async () => {
      const res = await fetch(BASE + '/api/admin/events', withAdminHeaders({ headers: { Accept: 'text/event-stream' } }));
      const ok = res.ok && (res.headers.get('content-type') || '').includes('text/event-stream');
      await res.body?.cancel?.();
      return ok ? pass('9. SSE 실시간') : fail('9. SSE 실시간', res.status);
    },
    async () => {
      const { ok, json } = await get('/api/admin/users/' + encodeURIComponent(userKey));
      const pkgs = json.packages || [];
      return ok && Array.isArray(pkgs) ? pass('10. 패키지 필터 목록', `${pkgs.length}개`) : fail('10. 패키지 필터 목록');
    }
  ]);

  const pullSync = await runSection('풀 동기화·백업 (10)', [
    async () => {
      const { ok, json } = await get('/api/admin/pull-sync/settings');
      return ok && json.settings && typeof json.settings.deleteAfterPull === 'boolean'
        ? pass('1. 풀 설정 API', `deleteAfterPull=${json.settings.deleteAfterPull}`)
        : fail('1. 풀 설정 API', JSON.stringify(json));
    },
    async () => {
      const { ok, json } = await get('/api/admin/pull-queue');
      return ok && Array.isArray(json.users) && typeof json.totalItems === 'number'
        ? pass('2. 풀 대기열 API', `${json.totalItems}개`)
        : fail('2. 풀 대기열 API', JSON.stringify(json));
    },
    async () => {
      const form = new FormData();
      form.append('filename', 'pull-audit.jpg');
      form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]), 'pull-audit.jpg');
      const res = await fetch(BASE + '/api/upload-file?userKey=' + encodeURIComponent(userKey), {
        method: 'POST',
        body: form
      });
      const json = await res.json();
      return json.success ? pass('3. 풀용 미디어 업로드', json.filename || 'ok') : fail('3. 풀용 미디어 업로드', JSON.stringify(json));
    },
    async () => {
      const { ok, json } = await get('/api/admin/pull-queue');
      const user = (json.users || []).find((u) => u.userKey === userKey);
      const hasFile = (user?.items || []).some((i) => i.filename === 'pull-audit.jpg');
      return ok && hasFile ? pass('4. 풀 대기열 반영') : fail('4. 풀 대기열 반영', JSON.stringify(user?.items?.map((i) => i.filename)));
    },
    async () => {
      const res = await fetch(
        BASE +
          '/api/admin/pull-file/' +
          encodeURIComponent(userKey) +
          '?category=' +
          encodeURIComponent('사진') +
          '&filename=' +
          encodeURIComponent('pull-audit.jpg'),
        withAdminHeaders()
      );
      const ok = res.ok && (await res.arrayBuffer()).byteLength === 4;
      return ok ? pass('5. 풀 파일 다운로드', '4 bytes') : fail('5. 풀 파일 다운로드', String(res.status));
    },
    async () => {
      const { ok, json } = await fetch(BASE + '/api/admin/users/' + encodeURIComponent(userKey) + '/confirm-pulled', withAdminHeaders({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ category: '사진', filename: 'pull-audit.jpg', size: 4 }]
        })
      })).then((r) => r.json().then((j) => ({ ok: r.ok, json: j })));
      return ok && (json.deleted || []).length === 1 ? pass('6. 다운로드 후 삭제') : fail('6. 다운로드 후 삭제', JSON.stringify(json));
    },
    async () => {
      const { ok, json } = await get('/api/admin/pull-queue');
      const user = (json.users || []).find((u) => u.userKey === userKey);
      const stillThere = (user?.items || []).some((i) => i.filename === 'pull-audit.jpg');
      return ok && !stillThere ? pass('7. 서버에서 제거 확인') : fail('7. 서버에서 제거 확인');
    },
    async () => {
      const res = await fetch(BASE + '/api/backup/' + encodeURIComponent(userKey), withAdminHeaders());
      const ok = res.ok && (res.headers.get('content-type') || '').includes('zip');
      await res.body?.cancel?.();
      return ok ? pass('8. ZIP 백업 스트림') : fail('8. ZIP 백업 스트림', res.status);
    },
    async () => {
      const { ok, json } = await fetch(BASE + '/api/admin/pull-sync/settings', withAdminHeaders({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteAfterPull: false })
      })).then((r) => r.json().then((j) => ({ ok: r.ok, json: j })));
      return ok && json.settings?.deleteAfterPull === false ? pass('9. 풀 설정 변경') : fail('9. 풀 설정 변경', JSON.stringify(json));
    },
    async () => {
      await fetch(BASE + '/api/admin/pull-sync/settings', withAdminHeaders({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteAfterPull: true })
      }));
      const { ok, json } = await get('/api/admin/pull-sync/settings');
      return ok && json.settings?.deleteAfterPull === true ? pass('10. 풀 설정 복원') : fail('10. 풀 설정 복원');
    }
  ]);

  const features = await runSection('기능 (10)', [
    async () => {
      const json = await fetch(BASE + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'audit_feature_user' })
      }).then((r) => r.json());
      if (json.success && json.userKey) userKey = json.userKey;
      return json.success && json.token ? pass('1. 이름 로그인', json.userKey) : fail('1. 이름 로그인');
    },
    async () => {
      const json = await fetch(BASE + '/api/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey })
      }).then((r) => r.json());
      return json.success ? pass('2. 하트비트') : fail('2. 하트비트');
    },
    async () => {
      const json = await fetch(BASE + '/api/notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, sender: 'audit', message: 'test', packageName: 'com.test', receivedAt: Date.now() })
      }).then((r) => r.json());
      return json.success ? pass('3. 알림 수집 POST') : fail('3. 알림 수집 POST');
    },
    async () => {
      const json = await fetch(BASE + '/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, contacts: [{ name: 'Hong', phone: '010-1234-5678' }] })
      }).then((r) => r.json());
      return json.success && json.count === 1 ? pass('4. 연락처 POST') : fail('4. 연락처 POST');
    },
    async () => {
      const json = await fetch(BASE + '/api/call-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userKey,
          callLogs: [{ number: '01011112222', name: 'Test', type: 'incoming', date: Date.now(), durationSec: 30 }]
        })
      }).then((r) => r.json());
      return json.success && json.count === 1 ? pass('5. 통화기록 POST') : fail('5. 통화기록 POST');
    },
    async () => {
      const json = await fetch(BASE + '/api/control/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, notificationCollect: true, mediaBackup: true })
      }).then((r) => r.json());
      return json.success ? pass('6. 원격 제어 set') : fail('6. 원격 제어 set');
    },
    async () => {
      const json = await fetch(BASE + '/api/control/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey })
      }).then((r) => r.json());
      return json.success ? pass('7. 원격 제어 get') : fail('7. 원격 제어 get');
    },
    async () => {
      const form = new FormData();
      form.append('filename', 'audit-test.txt');
      form.append('file', new Blob(['audit']), 'audit-test.txt');
      const res = await fetch(BASE + '/api/upload-file?userKey=' + encodeURIComponent(userKey), {
        method: 'POST',
        body: form
      });
      const json = await res.json();
      return json.success ? pass('8. 단일 파일 업로드') : fail('8. 단일 파일 업로드', JSON.stringify(json));
    },
    async () => {
      const { json } = await get('/api/admin/users/' + encodeURIComponent(userKey) + '/notifications?keyword=audit');
      return json.notifications?.some((n) => n.message === 'test') ? pass('9. 알림 필터') : fail('9. 알림 필터');
    },
    async () => {
      const { json } = await get('/api/admin/users/' + encodeURIComponent(userKey));
      return json.contacts?.length >= 1 && json.callLogs?.length >= 1 ? pass('10. POST 후 대시보드 반영') : fail('10. POST 후 대시보드 반영');
    }
  ]);

  const performance = await runSection('성능 (10)', [
    async () => {
      const start = Date.now();
      await get('/api/health');
      const ms = Date.now() - start;
      return ms < 500 ? pass('1. 헬스 <500ms', `${ms}ms`) : fail('1. 헬스 <500ms', `${ms}ms`);
    },
    async () => {
      const start = Date.now();
      await get('/api/admin/users');
      const ms = Date.now() - start;
      return ms < 2000 ? pass('2. 사용자목록 <2s', `${ms}ms`) : fail('2. 사용자목록 <2s', `${ms}ms`);
    },
    async () => {
      const start = Date.now();
      await get('/api/admin/users/' + encodeURIComponent(userKey));
      const ms = Date.now() - start;
      return ms < 3000 ? pass('3. 사용자상세 <3s', `${ms}ms`) : fail('3. 사용자상세 <3s', `${ms}ms`);
    },
    async () => {
      const start = Date.now();
      await get('/api/admin/users/' + encodeURIComponent(userKey) + '/notifications');
      const ms = Date.now() - start;
      return ms < 2000 ? pass('4. 알림목록 <2s', `${ms}ms`) : fail('4. 알림목록 <2s', `${ms}ms`);
    },
    async () => {
      const start = Date.now();
      await get('/api/comcigan/search?keyword=' + encodeURIComponent('유락'));
      const ms = Date.now() - start;
      return ms < 12000 ? pass('5. comcigan 검색 <12s', `${ms}ms`) : fail('5. comcigan 검색 <12s', `${ms}ms`);
    },
    async () => {
      const start = Date.now();
      await fetch(BASE + '/api/comcigan/sync?userKey=' + encodeURIComponent(userKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const ms = Date.now() - start;
      return ms < 15000 ? pass('6. 시간표 sync <15s', `${ms}ms`) : fail('6. 시간표 sync <15s', `${ms}ms`);
    },
    async () => {
      const start = Date.now();
      await fetch(BASE + '/api/notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, sender: 'perf', message: 'x', packageName: 'p', receivedAt: Date.now() })
      });
      const ms = Date.now() - start;
      return ms < 1000 ? pass('7. 알림 POST <1s', `${ms}ms`) : fail('7. 알림 POST <1s', `${ms}ms`);
    },
    async () => {
      const start = Date.now();
      await fetch(BASE + '/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userKey, contacts: [{ name: 'A', phone: '010' }] })
      });
      const ms = Date.now() - start;
      return ms < 1000 ? pass('8. 연락처 POST <1s', `${ms}ms`) : fail('8. 연락처 POST <1s', `${ms}ms`);
    },
    async () => {
      const start = Date.now();
      const res = await fetch(BASE + '/api/admin/events', withAdminHeaders({ headers: { Accept: 'text/event-stream' } }));
      const ms = Date.now() - start;
      await res.body?.cancel?.();
      return res.ok && ms < 2000 ? pass('9. SSE 연결 <2s', `${ms}ms`) : fail('9. SSE 연결 <2s', `${ms}ms`);
    },
    async () => {
      const start = Date.now();
      await get('/api/admin/users/' + encodeURIComponent(userKey) + '/media');
      const ms = Date.now() - start;
      return ms < 3000 ? pass('10. 미디어목록 <3s', `${ms}ms`) : fail('10. 미디어목록 <3s', `${ms}ms`);
    }
  ]);

  const sections = [comcigan, dashboard, features, pullSync, performance];
  const totalPass = sections.reduce((s, x) => s + x.pass, 0);
  const total = sections.reduce((s, x) => s + x.total, 0);

  console.log(JSON.stringify({ userKey, sections, totalPass, total, allPass: totalPass === total }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
