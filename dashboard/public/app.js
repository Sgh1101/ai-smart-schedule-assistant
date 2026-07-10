(function () {
  const API_BASE = window.API_BASE || '';

  const state = {
    users: [],
    selectedUserKey: null,
    activeTab: 'schedule',
    notifications: [],
    packages: [],
    mediaByDate: {},
    contacts: [],
    callLogs: [],
    contactFilter: '',
    callLogFilter: '',
    filters: { package: '', keyword: '' },
    refreshTimer: null,
    eventSource: null,
    isCloud: false,
    gradePercentSchools: [],
    selectedGradeSchool: null,
    selectedGradeLevel: 1
  };

  const els = {
    healthDot: document.getElementById('healthDot'),
    healthText: document.getElementById('healthText'),
    userList: document.getElementById('userList'),
    mainTitle: document.getElementById('mainTitle'),
    mainSub: document.getElementById('mainSub'),
    emptyMain: document.getElementById('emptyMain'),
    mainContent: document.getElementById('mainContent'),
    btnDeleteAll: document.getElementById('btnDeleteAll'),
    btnBackupUser: document.getElementById('btnBackupUser'),
    btnOpenStorageFolder: document.getElementById('btnOpenStorageFolder'),
    pullSyncCard: document.getElementById('pullSyncCard'),
    pullSyncMeta: document.getElementById('pullSyncMeta'),
    toggleDeleteAfterPull: document.getElementById('toggleDeleteAfterPull'),
    btnPullAgentHelp: document.getElementById('btnPullAgentHelp'),
    btnRefreshSchedule: document.getElementById('btnRefreshSchedule'),
    toggleNotification: document.getElementById('toggleNotification'),
    toggleMedia: document.getElementById('toggleMedia'),
    tabButtons: document.querySelectorAll('.tab-btn'),
    panelSchedule: document.getElementById('panelSchedule'),
    panelNotifications: document.getElementById('panelNotifications'),
    panelMedia: document.getElementById('panelMedia'),
    panelContacts: document.getElementById('panelContacts'),
    panelCallLog: document.getElementById('panelCallLog'),
    panelGradePercent: document.getElementById('panelGradePercent'),
    gradePercentSchools: document.getElementById('gradePercentSchools'),
    gradePercentDetail: document.getElementById('gradePercentDetail'),
    gradePercentDetailTitle: document.getElementById('gradePercentDetailTitle'),
    gradePercentImages: document.getElementById('gradePercentImages'),
    gradePercentRowsEditor: document.getElementById('gradePercentRowsEditor'),
    gradePercentGradeSelect: document.getElementById('gradePercentGradeSelect'),
    gradePercentReadyBadge: document.getElementById('gradePercentReadyBadge'),
    btnSaveGradePercentRows: document.getElementById('btnSaveGradePercentRows'),
    schoolInfoBody: document.getElementById('schoolInfoBody'),
    schoolSyncMeta: document.getElementById('schoolSyncMeta'),
    schoolWeekRange: document.getElementById('schoolWeekRange'),
    todayBadge: document.getElementById('todayBadge'),
    scheduleTodayHint: document.getElementById('scheduleTodayHint'),
    scheduleGrid: document.getElementById('scheduleGrid'),
    chatLog: document.getElementById('chatLog'),
    notificationTable: document.getElementById('notificationTable'),
    mediaByDate: document.getElementById('mediaByDate'),
    contactsTable: document.getElementById('contactsTable'),
    filterContact: document.getElementById('filterContact'),
    callLogTable: document.getElementById('callLogTable'),
    filterCallLog: document.getElementById('filterCallLog'),
    statNotifications: document.getElementById('statNotifications'),
    statMedia: document.getElementById('statMedia'),
    statContacts: document.getElementById('statContacts'),
    statCallLogs: document.getElementById('statCallLogs'),
    statChats: document.getElementById('statChats'),
    statOnline: document.getElementById('statOnline'),
    filterPackage: document.getElementById('filterPackage'),
    filterKeyword: document.getElementById('filterKeyword'),
    packageList: document.getElementById('packageList'),
    btnApplyFilter: document.getElementById('btnApplyFilter'),
    btnClearFilter: document.getElementById('btnClearFilter')
  };

  async function api(path, options = {}) {
    const response = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }
    return response.json();
  }

  function formatDate(ts) {
    const date = new Date(typeof ts === 'number' ? ts : Date.parse(ts));
    return date.toLocaleString('ko-KR');
  }

  function formatDateLabel(dateKey) {
    if (!dateKey || dateKey === 'unknown') return '날짜 미상';
    const [y, m, d] = dateKey.split('-');
    return `${y}년 ${parseInt(m, 10)}월 ${parseInt(d, 10)}일`;
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i += 1;
    }
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function mediaUrl(path) {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    return API_BASE + path;
  }

  async function checkHealth() {
    try {
      const data = await api('/api/health');
      state.isCloud = !!data.cloud;
      els.healthDot.style.background = data.status === 'ok' ? 'var(--success)' : 'var(--warning)';
      const storageHint = data.storageRoot
        ? ` · ${data.storageMode || 'storage'}`
        : '';
      els.healthText.textContent = data.status === 'ok'
        ? (data.cloud ? `클라우드 서버 정상${storageHint}` : `서버 정상${storageHint}`)
        : '상태 확인 필요';
      await refreshPullSyncStatus();
    } catch (e) {
      els.healthDot.style.background = 'var(--danger)';
      els.healthText.textContent = '연결 실패';
    }
  }

  async function refreshPullSyncStatus() {
    if (!els.pullSyncCard) return;

    if (!state.isCloud) {
      els.pullSyncCard.style.display = 'none';
      return;
    }

    els.pullSyncCard.style.display = 'block';

    try {
      const data = await api('/api/admin/pull-queue');
      const count = data.totalItems || 0;
      const bytes = data.totalBytes || 0;
      els.pullSyncMeta.textContent =
        count > 0
          ? `서버 대기: ${count}개 · ${formatSize(bytes)}`
          : '서버 대기: 없음 (에이전트가 돌면 자동으로 받습니다)';

      if (els.toggleDeleteAfterPull && data.settings) {
        els.toggleDeleteAfterPull.checked = !!data.settings.deleteAfterPull;
      }
    } catch (e) {
      els.pullSyncMeta.textContent = '서버 대기: 확인 실패';
    }
  }

  async function updatePullSyncSettings() {
    if (!els.toggleDeleteAfterPull) return;
    await api('/api/admin/pull-sync/settings', {
      method: 'POST',
      body: JSON.stringify({ deleteAfterPull: els.toggleDeleteAfterPull.checked })
    });
    await refreshPullSyncStatus();
  }

  function showPullAgentHelp() {
    const origin = window.location.origin.replace(/\/$/, '');
    const cmd = `cd dashboard\nnpm run pull-agent -- --server ${origin}`;
    alert(
      '노트북에서 아래 명령을 실행하세요.\n' +
      '30초마다 서버의 새 사진·영상을 바탕화면 폴더로 받고, 받은 뒤 서버에서 삭제합니다.\n\n' +
      '저장 위치: 바탕화면\\OnDevice_관제_데이터\\[사용자이름]\\사진|동영상\n\n' +
      cmd +
      '\n\n※ 알림·연락처·시간표는 서버에 남습니다 (용량 작음).'
    );
  }

  async function loadUsers() {
    const data = await api('/api/admin/users');
    state.users = data.users || [];
    renderUserList();
  }

  function renderUserList() {
    els.userList.innerHTML = '';

    if (!state.users.length) {
      els.userList.innerHTML = '<div class="empty-state">가입된 사용자가 없습니다.</div>';
      return;
    }

    state.users.forEach((user) => {
      const item = document.createElement('div');
      item.className = 'user-item' + (state.selectedUserKey === (user.userKey || user.userId) ? ' active' : '');
      const onlineClass = user.online ? 'online' : 'offline';
      const onlineLabel = user.online ? '온라인' : '오프라인';
      const displayName = user.name || user.userKey || user.userId;
      const schoolLabel = user.school?.name
        ? ` · ${escapeHtml(user.school.name)} ${user.school.grade || user.grade || ''}학년 ${user.school.classNum || user.classNum || ''}반`
        : '';

      item.innerHTML = `
        <button type="button" class="user-select-area">
          <div class="user-row">
            <span class="presence-dot ${onlineClass}" title="${onlineLabel}"></span>
            <div class="uid">${escapeHtml(displayName)}</div>
          </div>
          <div class="meta">${onlineLabel} · 알림 ${user.stats.notificationCount} · 미디어 ${user.stats.mediaCount} · 연락처 ${user.stats.contactCount || 0} · 통화 ${user.stats.callLogCount || 0}${schoolLabel}</div>
        </button>
        <button type="button" class="user-delete-btn" title="사용자 삭제" aria-label="사용자 삭제">삭제</button>
      `;
      item.querySelector('.user-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteUser(user.userKey || user.userId, displayName).catch(showError);
      });
      item.querySelector('.user-select-area').addEventListener('click', () => {
        selectUser(user.userKey || user.userId);
      });
      els.userList.appendChild(item);
    });
  }

  async function selectUser(userKey) {
    state.selectedUserKey = userKey;
    renderUserList();
    els.emptyMain.style.display = 'none';
    els.mainContent.style.display = 'block';
    await refreshSelectedUser();
  }

  async function refreshSelectedUser() {
    if (!state.selectedUserKey) return;

    const data = await api(`/api/admin/users/${encodeURIComponent(state.selectedUserKey)}`);
    const user = data.user;

    els.mainTitle.textContent = user.name || user.userKey || user.userId;
    els.mainSub.textContent = user.school?.name
      ? `${user.school.name} · ${user.school.grade}학년 ${user.school.classNum}반 · 가입 ${formatDate(user.createdAt)}`
      : `가입 ${formatDate(user.createdAt)}`;

    const controls = user.controls || {};
    els.toggleNotification.checked = !!(controls.notificationCollect ?? controls.kakaoCollect);
    els.toggleMedia.checked = !!controls.mediaBackup;

    els.statNotifications.textContent = user.stats.notificationCount;
    els.statMedia.textContent = user.stats.mediaCount;
    els.statContacts.textContent = user.stats.contactCount || 0;
    els.statCallLogs.textContent = user.stats.callLogCount || 0;
    els.statChats.textContent = user.stats.chatCount;
    els.statOnline.textContent = user.online ? '온라인' : '오프라인';
    els.statOnline.style.color = user.online ? 'var(--success)' : 'var(--danger)';

    state.packages = data.packages || [];
    state.mediaByDate = data.mediaByDate || {};
    state.contacts = data.contacts || [];
    state.callLogs = data.callLogs || [];
    updatePackageDatalist(state.packages);

    renderSchedulePanel(data.profile);
    await loadNotifications();
    renderMediaPanel(state.mediaByDate);
    renderContactsPanel(state.contacts);
    renderCallLogPanel(state.callLogs);
  }

  function updatePackageDatalist(packages) {
    els.packageList.innerHTML = '';
    packages.forEach((pkg) => {
      const opt = document.createElement('option');
      opt.value = pkg;
      els.packageList.appendChild(opt);
    });
  }

  async function loadNotifications() {
    if (!state.selectedUserKey) return;

    const params = new URLSearchParams();
    if (state.filters.package) params.set('package', state.filters.package);
    if (state.filters.keyword) params.set('keyword', state.filters.keyword);

    const query = params.toString();
    const path = `/api/admin/users/${encodeURIComponent(state.selectedUserKey)}/notifications` +
      (query ? `?${query}` : '');

    const data = await api(path);
    state.notifications = data.notifications || [];
    if (data.packages) {
      state.packages = data.packages;
      updatePackageDatalist(state.packages);
    }
    renderNotificationsPanel(state.notifications);
  }

  async function openStorageFolder() {
    const data = await api('/api/admin/open-storage-folder', { method: 'POST' });
    if (data.cloud) {
      alert(data.message || '클라우드 환경입니다. 상단 「전체 백업」 버튼으로 ZIP을 받으세요.');
    }
    if (data.path) {
      els.mainSub.textContent = `저장 경로: ${data.path}`;
    }
  }

  async function downloadUserBackup() {
    if (!state.selectedUserKey) {
      alert('먼저 사용자를 선택하세요.');
      return;
    }
    const userKey = state.selectedUserKey;
    const url = API_BASE + `/api/backup/${encodeURIComponent(userKey)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const dispo = response.headers.get('Content-Disposition') || '';
    const match = dispo.match(/filename="?([^";]+)"?/i);
    const filename = match ? decodeURIComponent(match[1]) : `backup_${userKey}.zip`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    alert(`백업 ZIP 다운로드가 시작되었습니다.\n노트북에서 압축을 풀어 확인하세요.`);
  }

  async function refreshUserSchedule() {
    if (!state.selectedUserKey) return;
    if (els.btnRefreshSchedule) {
      els.btnRefreshSchedule.disabled = true;
      els.btnRefreshSchedule.textContent = '동기화 중…';
    }
    try {
      await api(`/api/admin/users/${encodeURIComponent(state.selectedUserKey)}/schedule-sync`, {
        method: 'POST'
      });
      await refreshSelectedUser();
    } finally {
      if (els.btnRefreshSchedule) {
        els.btnRefreshSchedule.disabled = false;
        els.btnRefreshSchedule.textContent = '시간표 지금 동기화';
      }
    }
  }

  function getTodayKoreanWeekday() {
    const day = new Date().toLocaleString('en-US', { weekday: 'short', timeZone: 'Asia/Seoul' });
    const map = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' };
    return map[day] || '';
  }

  function formatWeekRange(meta) {
    const range = meta?.weekRange;
    if (!range?.start || !range?.end) return null;
    const fmt = (parts) => parts.filter(Boolean).join('.');
    return `${fmt(range.start)} ~ ${fmt(range.end)}`;
  }

  function connectRealtimeEvents() {
    if (state.eventSource) {
      state.eventSource.close();
    }

    const source = new EventSource(API_BASE + '/api/admin/events');
    state.eventSource = source;

    source.addEventListener('data-change', (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleRealtimeChange(payload);
      } catch (e) {
        console.warn('SSE parse failed', e);
      }
    });

    source.onerror = () => {
      console.warn('SSE disconnected — will retry via polling');
    };
  }

  async function handleRealtimeChange(payload) {
    if (payload.type === 'user-deleted') {
      if (state.selectedUserKey === payload.userId) {
        state.selectedUserKey = null;
        els.emptyMain.style.display = 'block';
        els.mainContent.style.display = 'none';
      }
      await loadUsers();
      return;
    }

    if (payload.type === 'presence') {
      await loadUsers();
      if (state.selectedUserKey && payload.userId === state.selectedUserKey) {
        await refreshSelectedUserStats();
      }
      return;
    }

    if (payload.type === 'pull-sync') {
      await refreshPullSyncStatus();
      if (state.selectedUserKey && payload.userId === state.selectedUserKey) {
        await refreshSelectedUser();
      }
      return;
    }

    await loadUsers();

    if (payload.type === 'gradePercent') {
      if (state.activeTab === 'gradePercent') {
        await loadGradePercentPanel();
      }
      return;
    }

    if (!state.selectedUserKey) return;
    if (payload.userId && payload.userId !== state.selectedUserKey) return;

    await refreshSelectedUserStats();

    if (payload.type === 'notifications') {
      await loadNotifications();
    } else if (payload.type === 'media') {
      await refreshMediaOnly();
    } else if (payload.type === 'contacts') {
      await refreshContactsOnly();
    } else if (payload.type === 'calllog') {
      await refreshCallLogOnly();
    } else if (payload.type === 'gradePercent') {
      await loadGradePercentPanel();
    } else {
      await refreshSelectedUser();
    }
  }

  async function loadGradePercentPanel() {
    const data = await api('/api/admin/grade-percent');
    state.gradePercentSchools = data.schools || [];
    renderGradePercentSchools();
  }

  function renderGradePercentSchools() {
    if (!els.gradePercentSchools) return;
    els.gradePercentSchools.innerHTML = '';

    if (!state.gradePercentSchools.length) {
      els.gradePercentSchools.innerHTML =
        '<div class="empty-state">등록된 학교가 없습니다. 앱에서 학교·학년을 선택하고 「요청하기」로 퍼센트 표 사진을 올려 주세요.</div>';
      if (els.gradePercentDetail) els.gradePercentDetail.style.display = 'none';
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'media-grid';

    state.gradePercentSchools.forEach((school) => {
      const card = document.createElement('div');
      card.className = 'media-card';
      const pending = school.requests || [];
      const thumb = pending[0];
      const readyLabel = (school.readyGrades || []).length
        ? `${school.readyGrades.join(', ')}학년 등록`
        : '미등록';
      const thumbHtml = thumb
        ? `<img src="${mediaUrl(thumb.url)}" alt="${escapeHtml(school.schoolName)}" loading="lazy" style="width:100%;height:140px;object-fit:cover;border-radius:8px;" />`
        : '<div class="empty-state" style="height:140px;display:flex;align-items:center;justify-content:center;">요청 없음</div>';

      card.innerHTML = `
        ${thumbHtml}
        <div class="media-info">
          <div class="name">${escapeHtml(school.schoolName || '학교')}</div>
          <div class="meta">코드 ${school.schoolCode} · ${readyLabel} · 대기 ${school.pendingCount || 0}건</div>
          <button class="btn primary" data-school="${school.schoolCode}">학년별 관리</button>
        </div>
      `;

      card.querySelector('button').addEventListener('click', () => showGradePercentDetail(school));
      grid.appendChild(card);
    });

    els.gradePercentSchools.appendChild(grid);
  }

  function getGradeTableFromSchool(school, grade) {
    const key = String(grade);
    const tables = school.gradeTables || {};
    return tables[key] || { rows: [], ready: false };
  }

  function showGradePercentDetail(school, gradeLevel) {
    state.selectedGradeSchool = school;
    const grade = gradeLevel || state.selectedGradeLevel || 1;
    state.selectedGradeLevel = grade;

    if (!els.gradePercentDetail) return;

    els.gradePercentDetail.style.display = 'block';
    els.gradePercentDetailTitle.textContent = `${school.schoolName} (${school.schoolCode})`;

    if (els.gradePercentGradeSelect) {
      els.gradePercentGradeSelect.value = String(grade);
    }

    const gradeTable = getGradeTableFromSchool(school, grade);
    const readyGrades = school.readyGrades || [];
    const isReady = gradeTable.ready && (gradeTable.rows || []).length > 0;

    if (els.gradePercentReadyBadge) {
      els.gradePercentReadyBadge.textContent = isReady
        ? `${grade}학년 등록 완료 (사용 가능)`
        : `${grade}학년 미등록 — 아래 요청 사진을 보고 rows를 입력하세요`;
      els.gradePercentReadyBadge.style.color = isReady ? 'var(--success)' : 'var(--danger)';
    }

    els.gradePercentRowsEditor.value = JSON.stringify(gradeTable.rows || [], null, 2);

    els.gradePercentImages.innerHTML = '';
    const requests = (school.requests || []).filter((r) => Number(r.grade) === Number(grade));
    if (!requests.length) {
      els.gradePercentImages.innerHTML =
        '<div class="empty-state">이 학년에 대한 대기 중 요청 사진이 없습니다.</div>';
    } else {
      const grid = document.createElement('div');
      grid.className = 'media-grid';
      requests.forEach((req) => {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.innerHTML = `
          <a href="${mediaUrl(req.url)}" target="_blank" rel="noopener">
            <img src="${mediaUrl(req.url)}" alt="${escapeHtml(req.filename)}" loading="lazy" style="width:100%;max-height:320px;object-fit:contain;border-radius:8px;" />
          </a>
          <div class="meta">${grade}학년 · ${formatDate(req.uploadedAt)} · ${escapeHtml(req.uploadedBy || '-')} · ${escapeHtml(req.status || 'pending')}</div>
        `;
        grid.appendChild(card);
      });
      els.gradePercentImages.appendChild(grid);
    }

    if (els.gradePercentDetailTitle && readyGrades.length) {
      els.gradePercentDetailTitle.textContent += ` — 등록 학년: ${readyGrades.join(', ')}`;
    }
  }

  async function saveGradePercentRows() {
    const school = state.selectedGradeSchool;
    if (!school) {
      alert('학교를 먼저 선택하세요.');
      return;
    }

    const grade = Number(els.gradePercentGradeSelect?.value || state.selectedGradeLevel || 1);
    if (!grade || grade < 1 || grade > 3) {
      alert('학년은 1~3만 선택 가능합니다.');
      return;
    }

    let rows;
    try {
      rows = JSON.parse(els.gradePercentRowsEditor.value || '[]');
    } catch (e) {
      alert('JSON 형식이 올바르지 않습니다.');
      return;
    }

    await api('/api/admin/grade-percent/rows', {
      method: 'POST',
      body: JSON.stringify({
        schoolCode: school.schoolCode,
        schoolName: school.schoolName,
        grade,
        rows
      })
    });

    alert(`${grade}학년 퍼센트 표가 저장되었습니다. 앱에서 바로 사용할 수 있습니다.`);
    await loadGradePercentPanel();
    const updated = state.gradePercentSchools.find((s) => s.schoolCode === school.schoolCode);
    if (updated) showGradePercentDetail(updated, grade);
  }

  async function refreshSelectedUserStats() {
    if (!state.selectedUserKey) return;
    const data = await api(`/api/admin/users/${encodeURIComponent(state.selectedUserKey)}`);
    const user = data.user;
    els.statNotifications.textContent = user.stats.notificationCount;
    els.statMedia.textContent = user.stats.mediaCount;
    els.statContacts.textContent = user.stats.contactCount || 0;
    els.statCallLogs.textContent = user.stats.callLogCount || 0;
    els.statChats.textContent = user.stats.chatCount;
    els.statOnline.textContent = user.online ? '온라인' : '오프라인';
    els.statOnline.style.color = user.online ? 'var(--success)' : 'var(--danger)';
  }

  async function refreshMediaOnly() {
    if (!state.selectedUserKey) return;
    const data = await api(`/api/admin/users/${encodeURIComponent(state.selectedUserKey)}/media`);
    state.mediaByDate = data.mediaByDate || {};
    renderMediaPanel(state.mediaByDate);
  }

  async function refreshContactsOnly() {
    if (!state.selectedUserKey) return;
    const data = await api(`/api/admin/users/${encodeURIComponent(state.selectedUserKey)}/contacts`);
    state.contacts = data.contacts || [];
    renderContactsPanel(state.contacts);
  }

  async function refreshCallLogOnly() {
    if (!state.selectedUserKey) return;
    const data = await api(`/api/admin/users/${encodeURIComponent(state.selectedUserKey)}/call-log`);
    state.callLogs = data.callLogs || [];
    renderCallLogPanel(state.callLogs);
  }

  async function deleteUser(userKey, labelOverride) {
    const selected = state.users.find((u) => (u.userKey || u.userId) === userKey);
    const label = labelOverride || selected?.name || userKey;

    const confirmed = confirm(
      `"${label}" 사용자를 목록에서 완전히 삭제합니다.\n\n알림·사진·연락처·통화기록·시간표 등 모든 데이터가 삭제되며 되돌릴 수 없습니다.\n\n계속할까요?`
    );
    if (!confirmed) return;

    await api(`/api/admin/users/${encodeURIComponent(userKey)}`, { method: 'DELETE' });

    if (state.selectedUserKey === userKey) {
      state.selectedUserKey = null;
      els.emptyMain.style.display = 'block';
      els.mainContent.style.display = 'none';
    }

    await loadUsers();
    alert(`"${label}" 사용자가 삭제되었습니다.`);
  }

  async function deleteAllUserData() {
    if (!state.selectedUserKey) return;
    await deleteUser(state.selectedUserKey);
  }

  function renderSchedulePanel(profile) {
    const schedule = profile?.schedule || [];
    const weekView = profile?.weekView || [];
    const school = profile?.school;
    const chatHistory = profile?.chatHistory || [];
    const today = getTodayKoreanWeekday();
    const weekLabel = formatWeekRange(profile?.scheduleMeta);

    if (els.todayBadge) {
      els.todayBadge.textContent = today ? `오늘: ${today}요일` : '오늘: -';
    }
    if (els.scheduleTodayHint) {
      els.scheduleTodayHint.textContent = today ? `(오늘 ${today}요일 열 강조)` : '';
    }

    if (school?.name) {
      els.schoolInfoBody.textContent =
        `${school.name} (${school.region || '지역 미상'}) · ${school.grade}학년 ${school.classNum}반`;
    } else {
      els.schoolInfoBody.textContent = '연동된 학교가 없습니다. 앱 설정에서 학교를 등록하세요.';
    }

    els.schoolSyncMeta.textContent = profile?.scheduleSyncedAt
      ? `마지막 업데이트: ${formatDate(profile.scheduleSyncedAt)}`
      : '마지막 업데이트: -';

    if (els.schoolWeekRange) {
      els.schoolWeekRange.textContent = weekLabel
        ? `이번 주 일일 시간표: ${weekLabel}`
        : '이번 주: 컴시간알리미 일일자료 (동기화 후 표시)';
    }

    els.scheduleGrid.innerHTML = '';

    if (weekView.length) {
      addScheduleCell('', true, false);
      ['월', '화', '수', '목', '금'].forEach((day) => addScheduleCell(day, true, day === today));
      weekView.forEach((row) => {
        addScheduleCell(`${row.period}교시`, true, false);
        row.slots.forEach((slot, dayIndex) => {
          const dayNames = ['월', '화', '수', '목', '금'];
          const isTodayCol = dayNames[dayIndex] === today;
          const label = slot.subject
            ? slot.teacher
              ? `${slot.subject}\n(${slot.teacher})`
              : slot.subject
            : '-';
          addScheduleCell(label, false, isTodayCol);
        });
      });
    } else if (schedule.length) {
      schedule.forEach((cell) => {
        const text = cell.isHeader
          ? (cell.label || '-')
          : (cell.subject && cell.teacher
            ? `${cell.subject}\n(${cell.teacher})`
            : (cell.label || cell.subject || '-'));
        addScheduleCell(text, !!cell.isHeader);
      });
    } else {
      addScheduleCell('시간표 데이터 없음 — 학교 연동 후 시간표를 불러오세요.', false);
    }

    els.chatLog.innerHTML = '';
    if (!chatHistory.length) {
      els.chatLog.innerHTML = '<div class="empty-state">동기화된 AI 대화 기록이 없습니다.</div>';
      return;
    }

    chatHistory.slice().reverse().forEach((item) => {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble ' + (item.role === 'user' ? 'user' : 'assistant');
      bubble.innerHTML = `
        <div>${escapeHtml(item.text)}</div>
        <div class="chat-meta">${formatDate(item.timestamp)} · ${item.role === 'user' ? '사용자' : 'AI'}</div>
      `;
      els.chatLog.appendChild(bubble);
    });
  }

  function addScheduleCell(text, isHeader, isTodayCol) {
    const cell = document.createElement('div');
    let className = 'schedule-cell' + (isHeader ? ' header' : '');
    if (isTodayCol) className += ' today-col';
    cell.className = className;
    cell.style.whiteSpace = 'pre-line';
    cell.textContent = text;
    els.scheduleGrid.appendChild(cell);
  }

  function renderNotificationsPanel(notifications) {
    const tbody = els.notificationTable.querySelector('tbody');
    tbody.innerHTML = '';

    if (!notifications?.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">수집된 알림이 없습니다.</td></tr>';
      return;
    }

    notifications.forEach((item) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${escapeHtml(item.packageName || '-')}</code></td>
        <td>${escapeHtml(item.sender || '-')}</td>
        <td>${escapeHtml(item.message || '')}</td>
        <td>${formatDate(item.receivedAt)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderMediaPanel(mediaByDate) {
    els.mediaByDate.innerHTML = '';

    const dates = Object.keys(mediaByDate || {}).sort((a, b) => b.localeCompare(a));

    if (!dates.length) {
      els.mediaByDate.innerHTML = '<div class="empty-state">저장된 사진·영상이 없습니다. (인터넷 연결 시 업로드)</div>';
      return;
    }

    dates.forEach((dateKey) => {
      const section = document.createElement('section');
      section.className = 'media-date-section';

      const heading = document.createElement('h3');
      heading.className = 'media-date-title';
      heading.textContent = `${formatDateLabel(dateKey)} (${mediaByDate[dateKey].length}개)`;
      section.appendChild(heading);

      const grid = document.createElement('div');
      grid.className = 'media-grid';

      mediaByDate[dateKey].forEach((item) => {
        grid.appendChild(createMediaCard(item));
      });

      section.appendChild(grid);
      els.mediaByDate.appendChild(section);
    });
  }

  function createMediaCard(item) {
    const card = document.createElement('div');
    card.className = 'media-card';

    const preview = document.createElement('div');
    preview.className = 'media-preview';
    const streamUrl = mediaUrl(item.url);
    const downloadUrl = mediaUrl(item.downloadUrl || item.url);

    if (item.type === 'image') {
      const img = document.createElement('img');
      img.src = streamUrl;
      img.alt = item.filename;
      img.loading = 'lazy';
      preview.appendChild(img);
    } else if (item.type === 'video') {
      const video = document.createElement('video');
      video.src = streamUrl;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      preview.appendChild(video);
    } else {
      preview.innerHTML = '<div class="file-icon">📄</div>';
    }

    card.innerHTML = `
      <div class="media-info">
        <div class="name">${escapeHtml(item.filename)}</div>
        <div class="meta">${formatSize(item.size)} · ${formatDate(item.modifiedAt)}</div>
        <div class="media-actions">
          <a class="btn primary" href="${downloadUrl}" download="${escapeHtml(item.filename)}">다운로드</a>
          <a class="btn" href="${streamUrl}" target="_blank" rel="noopener">스트리밍</a>
        </div>
      </div>
    `;

    card.prepend(preview);
    return card;
  }

  function renderContactsPanel(contacts) {
    const tbody = els.contactsTable.querySelector('tbody');
    tbody.innerHTML = '';

    const keyword = (state.contactFilter || '').toLowerCase();
    let filtered = contacts || [];
    if (keyword) {
      filtered = filtered.filter((c) =>
        (c.name || '').toLowerCase().includes(keyword) ||
        (c.phone || '').toLowerCase().includes(keyword)
      );
    }

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="empty-state">동기화된 연락처가 없습니다. (인터넷 + 연락처 권한 필요)</td></tr>';
      return;
    }

    filtered.forEach((item) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(item.name || '-')}</td>
        <td><code>${escapeHtml(item.phone || '')}</code></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function formatDuration(sec) {
    const s = Number(sec) || 0;
    if (s < 60) return `${s}초`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r > 0 ? `${m}분 ${r}초` : `${m}분`;
  }

  function renderCallLogPanel(callLogs) {
    const tbody = els.callLogTable.querySelector('tbody');
    tbody.innerHTML = '';

    const keyword = (state.callLogFilter || '').toLowerCase();
    let filtered = callLogs || [];
    if (keyword) {
      filtered = filtered.filter((c) =>
        (c.name || '').toLowerCase().includes(keyword) ||
        (c.number || '').toLowerCase().includes(keyword) ||
        (c.type || '').toLowerCase().includes(keyword)
      );
    }

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">동기화된 통화기록이 없습니다. (인터넷 + 통화기록 권한 필요)</td></tr>';
      return;
    }

    filtered.forEach((item) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(item.type || '-')}</td>
        <td>${escapeHtml(item.name || '-')}</td>
        <td><code>${escapeHtml(item.number || '')}</code></td>
        <td>${formatDuration(item.durationSec)}</td>
        <td>${formatDate(item.date)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function updateControl(field, value) {
    if (!state.selectedUserKey) return;

    const body = { userKey: state.selectedUserKey };
    body[field] = value;

    await api('/api/control/set', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    await loadUsers();
    await refreshSelectedUser();
  }

  function switchTab(tab) {
    state.activeTab = tab;
    els.tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    els.panelSchedule.classList.toggle('active', tab === 'schedule');
    els.panelNotifications.classList.toggle('active', tab === 'notifications');
    els.panelMedia.classList.toggle('active', tab === 'media');
    els.panelContacts.classList.toggle('active', tab === 'contacts');
    els.panelCallLog.classList.toggle('active', tab === 'calllog');
    els.panelGradePercent.classList.toggle('active', tab === 'gradePercent');

    if (!state.selectedUserKey && tab !== 'gradePercent') return;

    if (tab === 'notifications') {
      loadNotifications().catch(showError);
    } else if (tab === 'media') {
      refreshMediaOnly().catch(showError);
    } else if (tab === 'contacts') {
      refreshContactsOnly().catch(showError);
    } else if (tab === 'calllog') {
      refreshCallLogOnly().catch(showError);
    } else if (tab === 'gradePercent') {
      loadGradePercentPanel().catch(showError);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bindEvents() {
    els.btnDeleteAll.addEventListener('click', () => {
      deleteAllUserData().catch(showError);
    });

    if (els.btnBackupUser) {
      els.btnBackupUser.addEventListener('click', () => {
        downloadUserBackup().catch(showError);
      });
    }

    if (els.btnRefreshSchedule) {
      els.btnRefreshSchedule.addEventListener('click', () => {
        refreshUserSchedule().catch(showError);
      });
    }

    if (els.btnOpenStorageFolder) {
      els.btnOpenStorageFolder.addEventListener('click', () => {
        openStorageFolder().catch(showError);
      });
    }

    if (els.toggleDeleteAfterPull) {
      els.toggleDeleteAfterPull.addEventListener('change', () => {
        updatePullSyncSettings().catch(showError);
      });
    }

    if (els.btnPullAgentHelp) {
      els.btnPullAgentHelp.addEventListener('click', showPullAgentHelp);
    }

    els.toggleNotification.addEventListener('change', () => {
      updateControl('notificationCollect', els.toggleNotification.checked).catch(showError);
    });

    els.toggleMedia.addEventListener('change', () => {
      updateControl('mediaBackup', els.toggleMedia.checked).catch(showError);
    });

    els.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    els.btnApplyFilter.addEventListener('click', () => {
      state.filters.package = els.filterPackage.value.trim();
      state.filters.keyword = els.filterKeyword.value.trim();
      loadNotifications().catch(showError);
    });

    els.btnClearFilter.addEventListener('click', () => {
      els.filterPackage.value = '';
      els.filterKeyword.value = '';
      state.filters = { package: '', keyword: '' };
      loadNotifications().catch(showError);
    });

    let filterDebounce;
    const onFilterInput = () => {
      clearTimeout(filterDebounce);
      filterDebounce = setTimeout(() => {
        state.filters.package = els.filterPackage.value.trim();
        state.filters.keyword = els.filterKeyword.value.trim();
        loadNotifications().catch(() => {});
      }, 300);
    };

    els.filterPackage.addEventListener('input', onFilterInput);
    els.filterKeyword.addEventListener('input', onFilterInput);

    if (els.filterContact) {
      els.filterContact.addEventListener('input', () => {
        state.contactFilter = els.filterContact.value.trim();
        renderContactsPanel(state.contacts);
      });
    }

    if (els.filterCallLog) {
      els.filterCallLog.addEventListener('input', () => {
        state.callLogFilter = els.filterCallLog.value.trim();
        renderCallLogPanel(state.callLogs);
      });
    }

    if (els.btnSaveGradePercentRows) {
      els.btnSaveGradePercentRows.addEventListener('click', () => {
        saveGradePercentRows().catch(showError);
      });
    }

    if (els.gradePercentGradeSelect) {
      els.gradePercentGradeSelect.addEventListener('change', () => {
        if (!state.selectedGradeSchool) return;
        showGradePercentDetail(state.selectedGradeSchool, Number(els.gradePercentGradeSelect.value));
      });
    }
  }

  function showError(err) {
    console.error(err);
    alert('요청 실패: ' + err.message);
  }

  async function init() {
    bindEvents();
    switchTab('schedule');

    try {
      await checkHealth();
      await loadUsers();
      connectRealtimeEvents();
    } catch (e) {
      showError(e);
    }

    state.refreshTimer = setInterval(async () => {
      try {
        await checkHealth();
        await loadUsers();
        if (state.isCloud) {
          await refreshPullSyncStatus();
        }
        if (state.selectedUserKey) {
          await refreshSelectedUserStats();
        }
      } catch (e) {
        console.warn('Auto refresh failed', e);
      }
    }, 15000);
  }

  init();
})();
