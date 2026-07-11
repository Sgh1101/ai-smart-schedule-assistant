const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const cron = require('node-cron');
const chokidar = require('chokidar');
const { exec, spawn } = require('child_process');
const { searchSchools, fetchUserSchedule, fetchUserScheduleLive, warmUpClient } = require('./comciganService');
const scheduleCache = require('./scheduleCacheService');
const storage = require('./storagePaths');
const { migrateAllLegacyData } = require('./legacyMigration');
const gradePercent = require('./gradePercentService');
const aiChat = require('./aiChatService');
const { streamUserBackupZip } = require('./backupService');
const pullSync = require('./pullSyncService');
const dashboardAuth = require('./dashboardAuth');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CONTROLS_FILE = path.join(DATA_DIR, 'controls.json');
const PRESENCE_FILE = path.join(DATA_DIR, 'presence.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const ONLINE_THRESHOLD_MS = 60_000;
const CHUNK_SIZE_HINT = 2 * 1024 * 1024;
const sseClients = new Set();

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Bypass-Tunnel-Reminder',
    'ngrok-skip-browser-warning',
    'X-Requested-With',
    'Accept'
  ],
  exposedHeaders: ['Bypass-Tunnel-Reminder']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.post('/api/dashboard/login', (req, res) => {
  const pin = String(req.body?.pin || '').trim();
  if (pin !== dashboardAuth.PIN) {
    return res.status(401).json({ success: false, message: '비밀번호가 올바르지 않습니다.' });
  }
  dashboardAuth.setAuthCookie(res, dashboardAuth.issueToken());
  return res.json({ success: true, message: '로그인되었습니다.' });
});

app.post('/api/dashboard/logout', (_req, res) => {
  dashboardAuth.clearAuthCookie(res);
  return res.json({ success: true });
});

app.get('/api/dashboard/session', (req, res) => {
  return res.json({ success: true, authenticated: dashboardAuth.isAuthenticated(req) });
});

app.use(dashboardAuth.requireDashboard);
app.use(express.static(PUBLIC_DIR));

ensureDirectories();
migrateAllLegacyData();
ensureJsonFile(USERS_FILE, { users: [] });
ensureJsonFile(CONTROLS_FILE, { users: {} });
ensureJsonFile(PRESENCE_FILE, {});
pullSync.getSettings();

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function ensureDirectories() {
  [DATA_DIR, PUBLIC_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  storage.ensureMasterFolder();
}

function ensureJsonFile(filePath, defaultData) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

const sanitizeId = storage.sanitizeId;

function buildUserKey(name) {
  return sanitizeId(String(name || '').trim() || 'unknown');
}

function ensureUserRegistered(name) {
  const trimmed = String(name || '').trim();
  const userKey = buildUserKey(trimmed);
  const db = readJson(USERS_FILE);
  let user = db.users.find((u) => (u.userKey || u.userId) === userKey);
  if (user) {
    return { user, isNew: false };
  }

  user = {
    userKey,
    name: trimmed,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeJson(USERS_FILE, db);

  ensureUserNotifications(userKey);
  ensureUserProfile(userKey);
  ensureUserContacts(userKey);
  ensureUserCallLog(userKey);
  setUserControls(userKey, getDefaultControls());
  storage.ensureUserStructure(userKey);

  return { user, isNew: true };
}

/**
 * ASCII-only session token. Never embed raw Hangul userKey — OkHttp rejects
 * non-ASCII in Authorization (e.g. Unexpected char 0xc870).
 * Format: <hex>.u.<base64url(userKey)>
 * Legacy (pre-fix): <hex>.<rawUserKey> still parsed server-side only.
 */
function generateToken(userKey) {
  const secret = crypto.randomBytes(32).toString('hex');
  const keyB64 = Buffer.from(String(userKey || 'unknown'), 'utf8').toString('base64url');
  return `${secret}.u.${keyB64}`;
}

function extractUserKeyFromToken(token) {
  if (!token) return null;
  const clean = String(token).replace(/^Bearer\s+/i, '').trim();
  const parts = clean.split('.');
  if (parts.length >= 3 && parts[1] === 'u') {
    try {
      const decoded = Buffer.from(parts.slice(2).join('.'), 'base64url').toString('utf8');
      return decoded || null;
    } catch (_err) {
      return null;
    }
  }
  // Legacy tokens may contain Hangul after the first dot (server can still parse)
  return parts.length > 1 ? parts.slice(1).join('.') : null;
}

function isAsciiAuthorizationValue(value) {
  return !value || /^[\x20-\x7E]*$/.test(String(value));
}

function buildScheduleBriefingContext(userId) {
  try {
    const profile = readJson(ensureUserProfile(userId));
    const school = profile.school;
    const weekView = Array.isArray(profile.weekView) ? profile.weekView : [];
    const lines = [];

    if (school?.name || school?.code) {
      lines.push(
        `학교: ${school.name || school.code || ''} ${school.grade || '?'}학년 ${school.classNum || '?'}반`
      );
    }
    if (profile.scheduleSyncedAt) {
      lines.push(`시간표 동기화 시각: ${profile.scheduleSyncedAt}`);
    }

    if (weekView.length) {
      lines.push('주간 시간표:');
      for (const row of weekView) {
        const period = row.period || '?';
        const slots = (row.slots || [])
          .map((slot) => {
            const day = slot.day || '';
            const subject = slot.subject || '-';
            const teacher = slot.teacher ? `(${slot.teacher})` : '';
            return `${day}${subject}${teacher}`;
          })
          .join(' | ');
        lines.push(`- ${period}교시: ${slots}`);
      }
    } else if (Array.isArray(profile.schedule) && profile.schedule.length) {
      lines.push('시간표 셀 요약:');
      profile.schedule
        .filter((cell) => cell && !cell.isHeader && cell.subject)
        .slice(0, 40)
        .forEach((cell) => {
          lines.push(`- ${cell.label || cell.subject}${cell.teacher ? ` (${cell.teacher})` : ''}`);
        });
    } else {
      lines.push('저장된 시간표 데이터가 없습니다. 앱에서 학교를 설정·동기화해야 합니다.');
    }

    return lines.join('\n');
  } catch (_err) {
    return '시간표 데이터를 불러오지 못했습니다.';
  }
}

function resolveUserKey(req) {
  const authKey = extractUserKeyFromToken(req.headers.authorization);
  const bodyKey = req.body?.userKey || req.body?.userId;
  const queryKey = req.query?.userKey || req.query?.userId;
  const paramKey = req.params?.userId || req.params?.userKey;
  return paramKey || bodyKey || authKey || queryKey || 'unknown';
}

const notificationsPath = storage.notificationsPath;
const contactsPath = storage.contactsPath;
const callLogPath = storage.callLogPath;

function profilePath(userId) {
  return path.join(DATA_DIR, `profile_${sanitizeId(userId)}.json`);
}

function chunkTempDir(userId, uploadId) {
  return storage.chunkTempDir(userId, uploadId);
}

function ensureUserNotifications(userId) {
  storage.ensureUserStructure(userId);
  const file = notificationsPath(userId);
  ensureJsonFile(file, {
    notifications: [],
    stats: { total: 0, bySender: {}, byPackage: {} }
  });
  return file;
}

function ensureUserProfile(userId) {
  const file = profilePath(userId);
  ensureJsonFile(file, {
    school: null,
    schedule: [],
    weekView: [],
    classTimes: [],
    scheduleSyncedAt: null,
    chatHistory: [],
    updatedAt: new Date().toISOString()
  });
  return file;
}

function ensureUserContacts(userId) {
  storage.ensureUserStructure(userId);
  const file = contactsPath(userId);
  ensureJsonFile(file, { contacts: [], syncedAt: null, count: 0 });
  return file;
}

function ensureUserCallLog(userId) {
  storage.ensureUserStructure(userId);
  const file = callLogPath(userId);
  ensureJsonFile(file, { callLogs: [], syncedAt: null, count: 0 });
  return file;
}

async function syncUserSchedule(userId) {
  const file = ensureUserProfile(userId);
  const profile = readJson(file);

  if (!profile.school?.code || !profile.school?.grade || !profile.school?.classNum) {
    return { success: false, message: '학교 정보가 설정되지 않았습니다.' };
  }

  try {
    const fetched = await fetchUserSchedule(profile.school);
    profile.schedule = fetched.schedule;
    profile.weekView = fetched.weekView;
    profile.classTimes = fetched.classTimes;
    profile.scheduleSyncedAt = fetched.syncedAt;
    profile.scheduleMeta = fetched.meta || profile.scheduleMeta || null;
    profile.updatedAt = new Date().toISOString();
    writeJson(file, profile);
    broadcastSse('data-change', { type: 'schedule', userId, at: Date.now() });
    console.log(`[COMCIGAN-SYNC][${userId}] ${profile.school.name} ${profile.school.grade}학년 ${profile.school.classNum}반`);
    return { success: true, profile };
  } catch (err) {
    console.error(`[COMCIGAN-SYNC][${userId}]`, err.message);
    return { success: false, message: err.message };
  }
}

async function syncAllUserSchedules() {
  const db = readJson(USERS_FILE);
  for (const user of db.users) {
    const key = user.userKey || user.userId;
    if (key) await syncUserSchedule(key);
  }
}

function getDefaultControls() {
  return { notificationCollect: true, mediaBackup: true };
}

function normalizeControls(raw) {
  if (!raw) return getDefaultControls();
  return {
    notificationCollect: raw.notificationCollect ?? raw.kakaoCollect ?? true,
    mediaBackup: raw.mediaBackup ?? true
  };
}

function getUserControls(userId) {
  const db = readJson(CONTROLS_FILE);
  if (!db.users[userId]) {
    db.users[userId] = getDefaultControls();
    writeJson(CONTROLS_FILE, db);
  }
  return normalizeControls(db.users[userId]);
}

function setUserControls(userId, patch) {
  const db = readJson(CONTROLS_FILE);
  const current = normalizeControls(db.users[userId]);
  const notificationPatch = patch.notificationCollect ?? patch.kakaoCollect;

  db.users[userId] = {
    notificationCollect:
      notificationPatch !== undefined ? !!notificationPatch : current.notificationCollect,
    mediaBackup:
      patch.mediaBackup !== undefined ? !!patch.mediaBackup : current.mediaBackup
  };
  writeJson(CONTROLS_FILE, db);
  return db.users[userId];
}

function recordHeartbeat(userId) {
  const db = readJson(PRESENCE_FILE);
  db[userId] = { lastSeen: Date.now() };
  writeJson(PRESENCE_FILE, db);
  broadcastSse('data-change', { type: 'presence', userId, online: true, at: Date.now() });
}

function isUserOnline(userId) {
  const db = readJson(PRESENCE_FILE);
  const lastSeen = db[userId]?.lastSeen;
  if (!lastSeen) return false;
  return Date.now() - lastSeen < ONLINE_THRESHOLD_MS;
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.3gp': 'video/3gpp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic'
  };
  return map[ext] || 'application/octet-stream';
}

function resolveMediaPath(userId, filename) {
  return storage.resolveMediaPath(userId, filename);
}

function listMediaFiles(userId) {
  storage.ensureUserStructure(userId);
  const dirs = [
    { dir: storage.photosDir(userId), defaultType: 'image' },
    { dir: storage.videosDir(userId), defaultType: 'video' }
  ];
  const items = [];

  for (const { dir, defaultType } of dirs) {
    if (!fs.existsSync(dir)) continue;

    fs.readdirSync(dir)
      .filter((name) => !name.startsWith('.'))
      .forEach((name) => {
        const fullPath = path.join(dir, name);
        if (!fs.statSync(fullPath).isFile()) return;
        const stat = fs.statSync(fullPath);
        const ext = path.extname(name).toLowerCase();
        const isVideo = storage.isVideoFilename(name) || defaultType === 'video';
        const isImage = storage.isImageFilename(name) || defaultType === 'image';
        const safeUser = sanitizeId(userId);
        const encoded = encodeURIComponent(name);
        const category = path.basename(dir);
        items.push({
          filename: name,
          url: `/api/stream/${safeUser}/${encoded}`,
          downloadUrl: `/uploads/${safeUser}/${encodeURIComponent(category)}/${encoded}`,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          dateKey: stat.mtime.toISOString().slice(0, 10),
          type: isVideo ? 'video' : isImage ? 'image' : 'file',
          category
        });
      });
  }

  return items.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

function getUserSummary(userKey, userRecord) {
  ensureUserNotifications(userKey);
  ensureUserProfile(userKey);
  ensureUserContacts(userKey);
  ensureUserCallLog(userKey);
  const notifDb = readJson(notificationsPath(userKey));
  const profile = readJson(profilePath(userKey));
  const contactsDb = readJson(contactsPath(userKey));
  const callLogDb = readJson(callLogPath(userKey));
  const controls = getUserControls(userKey);
  const media = listMediaFiles(userKey);

  return {
    userKey,
    userId: userKey,
    name: userRecord?.name || '',
    schoolCode: userRecord?.schoolCode || profile.school?.code || null,
    grade: userRecord?.grade || profile.school?.grade || null,
    classNum: userRecord?.classNum || profile.school?.classNum || null,
    createdAt: userRecord?.createdAt || null,
    online: isUserOnline(userKey),
    lastSeen: readJson(PRESENCE_FILE)[userKey]?.lastSeen || null,
    school: profile.school || null,
    scheduleSyncedAt: profile.scheduleSyncedAt || null,
    controls,
    stats: {
      notificationCount: notifDb.notifications.length,
      mediaCount: media.length,
      chatCount: profile.chatHistory.length,
      contactCount: contactsDb.contacts?.length || 0,
      callLogCount: callLogDb.callLogs?.length || 0
    }
  };
}

function assembleChunks(userId, uploadId, filename, totalChunks) {
  const tempDir = chunkTempDir(userId, uploadId);
  const safeName = path.basename(filename).replace(/[^\w.\-가-힣]/g, '_');
  const outputDir = storage.mediaDirForFilename(userId, safeName);
  const outputPath = path.join(outputDir, safeName);

  fs.mkdirSync(outputDir, { recursive: true });

  const fd = fs.openSync(outputPath, 'w');

  for (let i = 0; i < totalChunks; i += 1) {
    const chunkPath = path.join(tempDir, `chunk_${i}`);
    if (!fs.existsSync(chunkPath)) {
      fs.closeSync(fd);
      throw new Error(`Missing chunk ${i}`);
    }
    const data = fs.readFileSync(chunkPath);
    fs.writeSync(fd, data);
  }

  fs.closeSync(fd);
  fs.rmSync(tempDir, { recursive: true, force: true });

  return { filename: safeName, path: outputPath };
}

function streamFileResponse(req, res, filePath, filename) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const contentType = getMimeType(filename);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      return res.end();
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

function deleteUserData(userId) {
  storage.ensureUserStructure(userId);
  const notifFile = notificationsPath(userId);
  const profFile = profilePath(userId);

  writeJson(notifFile, { notifications: [], stats: { total: 0, bySender: {}, byPackage: {} } });
  writeJson(contactsPath(userId), { contacts: [], syncedAt: null, count: 0 });
  writeJson(callLogPath(userId), { callLogs: [], syncedAt: null, count: 0 });
  writeJson(profFile, {
    school: null,
    schedule: [],
    weekView: [],
    classTimes: [],
    scheduleSyncedAt: null,
    chatHistory: [],
    updatedAt: new Date().toISOString()
  });

  const presence = readJson(PRESENCE_FILE);
  delete presence[userId];
  writeJson(PRESENCE_FILE, presence);

  [storage.photosDir(userId), storage.videosDir(userId)].forEach((dir) => {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((name) => {
        const filePath = path.join(dir, name);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      });
    }
  });

  const chunkRoot = path.join(storage.userRoot(userId), '.chunks');
  if (fs.existsSync(chunkRoot)) {
    fs.rmSync(chunkRoot, { recursive: true, force: true });
  }
}

function deleteUserCompletely(userId) {
  const userRoot = storage.userRoot(userId);
  if (fs.existsSync(userRoot)) {
    fs.rmSync(userRoot, { recursive: true, force: true });
  }

  const profFile = profilePath(userId);
  if (fs.existsSync(profFile)) {
    fs.unlinkSync(profFile);
  }

  const presence = readJson(PRESENCE_FILE);
  delete presence[userId];
  writeJson(PRESENCE_FILE, presence);

  const controlsDb = readJson(CONTROLS_FILE);
  delete controlsDb.users[userId];
  writeJson(CONTROLS_FILE, controlsDb);

  const usersDb = readJson(USERS_FILE);
  usersDb.users = usersDb.users.filter((u) => (u.userKey || u.userId) !== userId);
  writeJson(USERS_FILE, usersDb);

  broadcastSse('data-change', { type: 'user-deleted', userId, at: Date.now() });
}

function broadcastSse(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(payload);
    } catch (_err) {
      sseClients.delete(client);
    }
  });
}

function notifyDataChange(filePath, action = 'change') {
  const info = storage.classifyWatchEvent(filePath);
  if (!info.userId) return;
  broadcastSse('data-change', {
    action,
    userId: info.userId,
    type: info.type,
    category: info.category || null,
    path: filePath,
    at: Date.now()
  });
}

function startStorageWatcher() {
  storage.ensureMasterFolder();
  const watchRoot = storage.getStorageRoot();
  const watcher = chokidar.watch(watchRoot, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    ignored: (watchPath) => watchPath.includes(`${path.sep}.chunks${path.sep}`)
  });

  watcher.on('add', (filePath) => notifyDataChange(filePath, 'add'));
  watcher.on('change', (filePath) => notifyDataChange(filePath, 'change'));
  watcher.on('unlink', (filePath) => notifyDataChange(filePath, 'unlink'));

  console.log(`[WATCHER] Storage root: ${watchRoot} (mode=${storage.getStorageMode()})`);
  return watcher;
}

app.get('/api/stream/:userId/:filename', (req, res) => {
  const userId = sanitizeId(req.params.userId);
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const filePath = resolveMediaPath(userId, filename);

  if (!filePath) {
    return res.status(404).json({ success: false, message: '파일을 찾을 수 없습니다.' });
  }

  streamFileResponse(req, res, filePath, filename);
});

app.use('/uploads', (req, res, next) => {
  const requestPath = (req.url || req.path || '').split('?')[0];
  const match = requestPath.match(/^\/([^/]+)\/(.+)$/);
  if (!match) return next();

  const userId = sanitizeId(decodeURIComponent(match[1]));
  const subPath = decodeURIComponent(match[2]);
  const userRootDir = storage.userRoot(userId);
  const filePath = path.resolve(userRootDir, subPath);

  if (!filePath.startsWith(path.resolve(userRootDir))) {
    return res.status(403).end();
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).end();
  }

  const filename = path.basename(subPath);
  streamFileResponse(req, res, filePath, filename);
});

app.use('/school-files', (req, res, next) => {
  const requestPath = (req.url || req.path || '').split('?')[0];
  const match = requestPath.match(/^\/([^/]+)\/(.+)$/);
  if (!match) return next();

  const schoolCode = match[1];
  const filename = path.basename(decodeURIComponent(match[2]));
  const filePath = storage.resolveSchoolPercentImagePath(schoolCode, filename);

  if (!filePath) {
    return res.status(404).end();
  }

  streamFileResponse(req, res, filePath, filename);
});

app.post('/api/register', async (req, res) => {
  const { name } = req.body || {};

  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: '이름이 필요합니다.' });
  }

  const userKey = buildUserKey(name);
  const db = readJson(USERS_FILE);
  if (db.users.some((u) => (u.userKey || u.userId) === userKey)) {
    return res.status(409).json({ success: false, message: '이미 등록된 사용자입니다.' });
  }

  const user = {
    userKey,
    name: name.trim(),
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  writeJson(USERS_FILE, db);

  ensureUserNotifications(userKey);
  ensureUserProfile(userKey);
  ensureUserContacts(userKey);
  ensureUserCallLog(userKey);
  setUserControls(userKey, getDefaultControls());
  storage.ensureUserStructure(userKey);

  return res.json({
    success: true,
    userKey,
    userId: userKey,
    name: user.name,
    message: '회원가입이 완료되었습니다.'
  });
});

app.post('/api/login', (req, res) => {
  const { name } = req.body || {};

  if (!name?.trim()) {
    return res.status(400).json({ success: false, message: '이름이 필요합니다.' });
  }

  const { user, isNew } = ensureUserRegistered(name);
  const userKey = user.userKey || user.userId;
  const token = generateToken(userKey);
  recordHeartbeat(userKey);

  return res.json({
    success: true,
    token,
    userKey,
    userId: userKey,
    name: user.name,
    isNew,
    message: isNew ? '가입 및 로그인 완료' : '로그인 성공'
  });
});

app.post('/api/heartbeat', (req, res) => {
  const userId = resolveUserKey(req);
  recordHeartbeat(userId);
  const controls = getUserControls(userId);

  return res.json({
    success: true,
    userId,
    online: true,
    notificationCollect: controls.notificationCollect,
    mediaBackup: controls.mediaBackup,
    kakaoCollect: controls.notificationCollect
  });
});

app.post('/api/notification', (req, res) => {
  const userId = resolveUserKey(req);
  const controls = getUserControls(userId);

  if (!controls.notificationCollect) {
    return res.json({ success: false, message: '전체 알림 수집이 원격으로 비활성화되어 있습니다.' });
  }

  const { sender, message, receivedAt, packageName } = req.body || {};

  const payload = {
    id: crypto.randomUUID(),
    userId,
    sender: sender || '',
    message: message || '',
    receivedAt: receivedAt || Date.now(),
    packageName: packageName || 'unknown',
    serverReceivedAt: new Date().toISOString()
  };

  const file = ensureUserNotifications(userId);
  const db = readJson(file);
  if (!db.stats.byPackage) db.stats.byPackage = {};
  db.notifications.push(payload);
  db.stats.total += 1;

  const senderKey = payload.sender || 'unknown';
  db.stats.bySender[senderKey] = (db.stats.bySender[senderKey] || 0) + 1;

  const pkgKey = payload.packageName || 'unknown';
  db.stats.byPackage[pkgKey] = (db.stats.byPackage[pkgKey] || 0) + 1;

  writeJson(file, db);
  recordHeartbeat(userId);
  notifyDataChange(file, 'change');

  console.log(`[NOTIFICATION][${userId}][${payload.packageName}]`, payload.sender, '-', payload.message);

  return res.json({ success: true, message: '알림이 저장되었습니다.' });
});

app.post('/api/contacts', (req, res) => {
  const userId = resolveUserKey(req);
  const { contacts } = req.body || {};

  if (!Array.isArray(contacts)) {
    return res.status(400).json({ success: false, message: 'contacts 배열이 필요합니다.' });
  }

  const file = ensureUserContacts(userId);
  const normalized = contacts.map((c) => ({
    name: String(c.name || '').trim(),
    phone: String(c.phone || '').trim(),
    email: String(c.email || '').trim()
  })).filter((c) => c.phone);

  writeJson(file, {
    contacts: normalized,
    count: normalized.length,
    syncedAt: new Date().toISOString()
  });
  recordHeartbeat(userId);
  notifyDataChange(file, 'change');

  console.log(`[CONTACTS][${userId}] synced ${normalized.length} entries`);
  return res.json({ success: true, count: normalized.length, message: '연락처가 저장되었습니다.' });
});

app.post('/api/call-log', (req, res) => {
  const userId = resolveUserKey(req);
  const { callLogs } = req.body || {};

  if (!Array.isArray(callLogs)) {
    return res.status(400).json({ success: false, message: 'callLogs 배열이 필요합니다.' });
  }

  const file = ensureUserCallLog(userId);
  const normalized = callLogs.map((entry) => ({
    number: String(entry.number || '').trim(),
    name: String(entry.name || '').trim(),
    type: String(entry.type || '').trim(),
    date: Number(entry.date) || 0,
    durationSec: Number(entry.durationSec ?? entry.duration) || 0
  })).filter((entry) => entry.number);

  writeJson(file, {
    callLogs: normalized,
    count: normalized.length,
    syncedAt: new Date().toISOString()
  });
  recordHeartbeat(userId);
  notifyDataChange(file, 'change');

  console.log(`[CALL-LOG][${userId}] synced ${normalized.length} entries`);
  return res.json({ success: true, count: normalized.length, message: '통화기록이 저장되었습니다.' });
});

app.post('/api/upload-file', fileUpload.single('file'), (req, res) => {
  const userId = resolveUserKey(req);
  const controls = getUserControls(userId);

  if (!controls.mediaBackup) {
    return res.json({ success: false, message: '미디어 백업이 원격으로 비활성화되어 있습니다.' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: '업로드할 파일(청크)이 없습니다.' });
  }

  const uploadId = req.body.uploadId;
  const chunkIndexRaw = req.body.chunkIndex;
  const totalChunksRaw = req.body.totalChunks;
  const filename = req.body.filename;

  const hasChunkMeta =
    uploadId &&
    chunkIndexRaw !== undefined &&
    totalChunksRaw !== undefined &&
    filename;

  const safeUser = sanitizeId(userId);

  if (!hasChunkMeta) {
    const safeName = path.basename(filename || req.file.originalname || 'file')
      .replace(/[^\w.\-가-힣]/g, '_');
    const outputDir = storage.mediaDirForFilename(userId, safeName);
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, safeName);
    fs.writeFileSync(outputPath, req.file.buffer);
    recordHeartbeat(userId);
    notifyDataChange(outputPath, 'add');

    console.log(`[UPLOAD][${userId}]`, safeName, '->', outputPath);

    const category = storage.mediaCategoryFolder(safeName);
    return res.json({
      success: true,
      complete: true,
      filename: safeName,
      path: `/uploads/${safeUser}/${encodeURIComponent(category)}/${encodeURIComponent(safeName)}`,
      streamUrl: `/api/stream/${safeUser}/${encodeURIComponent(safeName)}`,
      message: '파일이 저장되었습니다.'
    });
  }

  const chunkIndex = parseInt(chunkIndexRaw, 10);
  const totalChunks = parseInt(totalChunksRaw, 10);

  if (Number.isNaN(chunkIndex) || Number.isNaN(totalChunks) || totalChunks < 1) {
    return res.status(400).json({ success: false, message: '청크 메타데이터가 올바르지 않습니다.' });
  }

  const tempDir = chunkTempDir(userId, uploadId);
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(path.join(tempDir, `chunk_${chunkIndex}`), req.file.buffer);

  const isLast = chunkIndex === totalChunks - 1;

  if (!isLast) {
    recordHeartbeat(userId);
    return res.json({
      success: true,
      uploadId,
      chunkIndex,
      totalChunks,
      complete: false,
      message: `청크 ${chunkIndex + 1}/${totalChunks} 수신`
    });
  }

  try {
    const assembled = assembleChunks(userId, uploadId, filename, totalChunks);
    recordHeartbeat(userId);
    notifyDataChange(assembled.path, 'add');

    console.log(`[CHUNK-UPLOAD][${userId}]`, filename, '->', assembled.path);

    const category = storage.mediaCategoryFolder(assembled.filename);
    return res.json({
      success: true,
      uploadId,
      complete: true,
      filename: assembled.filename,
      path: `/uploads/${safeUser}/${encodeURIComponent(category)}/${encodeURIComponent(assembled.filename)}`,
      streamUrl: `/api/stream/${safeUser}/${encodeURIComponent(assembled.filename)}`,
      message: '청크 업로드가 완료되어 파일이 저장되었습니다.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: '청크 조립 실패: ' + err.message });
  }
});

app.delete('/api/admin/users/:userId', (req, res) => {
  const userKey = req.params.userId;
  const db = readJson(USERS_FILE);
  const exists = db.users.some((u) => (u.userKey || u.userId) === userKey);

  if (!exists) {
    return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
  }

  deleteUserCompletely(userKey);

  console.log(`[DELETE-USER][${userKey}] 사용자 및 모든 데이터 삭제 완료`);

  return res.json({
    success: true,
    userKey,
    userId: userKey,
    message: '사용자가 목록에서 삭제되었고 모든 데이터가 제거되었습니다.'
  });
});

app.delete('/api/delete-data', (req, res) => {
  const userKey = req.body?.userKey || req.body?.userId || req.query?.userKey || req.query?.userId;

  if (!userKey) {
    return res.status(400).json({ success: false, message: 'userKey가 필요합니다.' });
  }

  const db = readJson(USERS_FILE);
  const exists = db.users.some((u) => (u.userKey || u.userId) === userKey);
  if (!exists) {
    return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
  }

  deleteUserData(userKey);

  console.log(`[DELETE-DATA][${userKey}] 모든 로그 및 미디어 삭제 완료`);

  return res.json({
    success: true,
    userKey,
    userId: userKey,
    message: '사용자 기록 및 미디어 파일이 모두 삭제되었습니다.'
  });
});

app.get('/api/comcigan/search', async (req, res) => {
  const keyword = (req.query.keyword || '').trim();

  try {
    console.log(`[SCHOOL-SEARCH] keyword="${keyword || '(전체)'}"`);
    const schools = await searchSchools(keyword);
    console.log(`[SCHOOL-SEARCH] found ${schools.length} schools`);
    return res.json({ success: true, schools, count: schools.length });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[SCHOOL-SEARCH] error:', message);
    return res.status(500).json({ success: false, message, schools: [], count: 0 });
  }
});

app.post('/api/profile/school', async (req, res) => {
  const userId = resolveUserKey(req);
  const { schoolCode, schoolName, schoolRegion, grade, classNum } = req.body || {};

  if (!schoolCode || !schoolName || !grade || !classNum) {
    return res.status(400).json({ success: false, message: '학교 및 학년/반 정보가 필요합니다.' });
  }

  const file = ensureUserProfile(userId);
  const profile = readJson(file);
  profile.school = {
    code: Number(schoolCode),
    name: schoolName,
    region: schoolRegion || '',
    grade: Number(grade),
    classNum: Number(classNum)
  };
  writeJson(file, profile);

  res.json({
    success: true,
    school: profile.school,
    schedule: profile.schedule || [],
    message: '학교 설정이 저장되었습니다. 시간표를 불러오는 중…'
  });

  syncUserSchedule(userId)
    .then((result) => {
      if (result.success) {
        console.log(`[COMCIGAN-SYNC-BG][${userId}] ${profile.school.name} ${profile.school.grade}학년 ${profile.school.classNum}반`);
      } else {
        console.warn(`[COMCIGAN-SYNC-BG][${userId}]`, result.message);
      }
    })
    .catch((err) => {
      console.error(`[COMCIGAN-SYNC-BG][${userId}]`, err.message);
    });
});

app.post('/api/comcigan/sync', async (req, res) => {
  const userId = resolveUserKey(req);
  const result = await syncUserSchedule(userId);
  if (!result.success) {
    return res.status(400).json(result);
  }
  return res.json({ success: true, profile: result.profile, message: '시간표 정보를 가져왔습니다.' });
});

app.get('/api/profile/schedule-data', (req, res) => {
  const userId = resolveUserKey(req);
  ensureUserProfile(userId);
  const profile = readJson(profilePath(userId));
  return res.json({
    success: true,
    school: profile.school,
    schedule: profile.schedule || [],
    weekView: profile.weekView || [],
    classTimes: profile.classTimes || [],
    scheduleSyncedAt: profile.scheduleSyncedAt
  });
});

app.post('/api/profile/schedule', (req, res) => {
  const userId = resolveUserKey(req);
  const { schedule } = req.body || {};
  const file = ensureUserProfile(userId);
  const profile = readJson(file);
  profile.schedule = Array.isArray(schedule) ? schedule : [];
  profile.updatedAt = new Date().toISOString();
  writeJson(file, profile);
  recordHeartbeat(userId);
  return res.json({ success: true, message: '시간표 정보를 가져왔습니다.' });
});

app.post('/api/profile/chat', (req, res) => {
  const userId = resolveUserKey(req);
  const { role, text, timestamp } = req.body || {};

  if (!text) {
    return res.status(400).json({ success: false, message: '대화 내용이 필요합니다.' });
  }

  const file = ensureUserProfile(userId);
  const profile = readJson(file);
  profile.chatHistory.push({
    id: crypto.randomUUID(),
    role: role || 'user',
    text,
    timestamp: timestamp || Date.now()
  });
  if (profile.chatHistory.length > 200) {
    profile.chatHistory = profile.chatHistory.slice(-200);
  }
  profile.updatedAt = new Date().toISOString();
  writeJson(file, profile);
  recordHeartbeat(userId);

  return res.json({ success: true, message: '대화가 저장되었습니다.' });
});

app.post('/api/ai/chat', async (req, res) => {
  const userId = resolveUserKey(req);
  const { messages, system } = req.body || {};

  // App→server Authorization must stay ASCII; ignore non-ASCII Bearer (legacy Hangul tokens)
  const rawAuth = req.headers.authorization;
  if (rawAuth && !isAsciiAuthorizationValue(rawAuth)) {
    console.warn(`[AI-CHAT] Non-ASCII Authorization ignored for user resolution; using body/query key=${userId}`);
  }

  try {
    const scheduleContext = buildScheduleBriefingContext(userId);
    const enrichedSystem = [
      String(system || '당신은 친절하고 유용한 AI 어시스턴트입니다. 한국어로 답하세요.').trim(),
      '',
      '[사용자 시간표 컨텍스트 — 아침 브리핑·일정 질문에 활용]',
      scheduleContext,
      '',
      '시간표·수업·일정 관련 질문에는 위 데이터를 우선 사용하세요. 데이터가 없으면 없다고 말하고 추측하지 마세요.'
    ].join('\n');

    const result = await aiChat.sendGeminiChat({ messages, system: enrichedSystem });
    recordHeartbeat(userId);

    const file = ensureUserProfile(userId);
    const profile = readJson(file);
    const lastUser = Array.isArray(messages)
      ? [...messages].reverse().find((m) => m?.role === 'user')
      : null;
    if (lastUser?.content) {
      profile.chatHistory.push({
        id: crypto.randomUUID(),
        role: 'user',
        text: String(lastUser.content),
        timestamp: Date.now()
      });
    }
    profile.chatHistory.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      text: result.text,
      timestamp: Date.now()
    });
    if (profile.chatHistory.length > 200) {
      profile.chatHistory = profile.chatHistory.slice(-200);
    }
    profile.updatedAt = new Date().toISOString();
    writeJson(file, profile);

    return res.json({
      success: true,
      text: result.text,
      model: result.model,
      message: 'AI 응답을 생성했습니다.'
    });
  } catch (err) {
    console.error(`[AI-CHAT][${userId}]`, err.message);
    return res.status(500).json({
      success: false,
      message: err.message || 'AI 응답 생성에 실패했습니다.'
    });
  }
});

app.post('/api/control/get', (req, res) => {
  const userId = resolveUserKey(req);
  const controls = getUserControls(userId);

  return res.json({
    success: true,
    userId,
    notificationCollect: controls.notificationCollect,
    mediaBackup: controls.mediaBackup,
    kakaoCollect: controls.notificationCollect
  });
});

app.post('/api/control/set', (req, res) => {
  const userKey = req.body?.userKey || req.body?.userId;
  const { notificationCollect, mediaBackup, kakaoCollect } = req.body || {};

  if (!userKey) {
    return res.status(400).json({ success: false, message: 'userKey가 필요합니다.' });
  }

  const controls = setUserControls(userKey, {
    notificationCollect: notificationCollect ?? kakaoCollect,
    mediaBackup
  });

  return res.json({
    success: true,
    userKey,
    userId: userKey,
    notificationCollect: controls.notificationCollect,
    mediaBackup: controls.mediaBackup,
    kakaoCollect: controls.notificationCollect,
    message: '제어 설정이 업데이트되었습니다.'
  });
});

app.get('/api/health', (_req, res) => {
  const storageRoot = storage.getStorageRoot();
  const storageMode = storage.getStorageMode();
  const cloud = storage.isCloudRuntime();
  const ephemeral = storage.isEphemeralRoot(storageRoot);
  res.json({
    success: true,
    status: 'ok',
    chunkSizeHint: CHUNK_SIZE_HINT,
    storageRoot,
    storageMode,
    cloud,
    ephemeral,
    freeTier: cloud && ephemeral ? {
      persistentDisk: false,
      storagePath: '/tmp/uploads',
      dataLostOnRedeploy: true,
      dataLostOnSpinDown: true,
      pullAgentRequiresLocalPc: true
    } : undefined
  });
});

app.get('/api/admin/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`event: connected\ndata: ${JSON.stringify({ storageRoot: storage.getStorageRoot(), storageMode: storage.getStorageMode() })}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

app.post('/api/admin/open-storage-folder', (_req, res) => {
  const folder = storage.getStorageRoot();
  storage.ensureMasterFolder();

  if (!fs.existsSync(folder)) {
    return res.status(404).json({ success: false, message: '저장 폴더가 아직 생성되지 않았습니다.' });
  }

  if (storage.isCloudRuntime()) {
    return res.json({
      success: true,
      path: folder,
      cloud: true,
      message:
        '클라우드 서버입니다. 노트북에서 start-pull-render.bat 을 실행하면 사진·영상을 받고 서버에서 삭제합니다.'
    });
  }

  if (process.platform === 'win32') {
    try {
      spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return res.json({ success: true, path: folder, message: '바탕화면 저장 폴더를 열었습니다.' });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  const opener = process.platform === 'darwin' ? `open "${folder}"` : `xdg-open "${folder}"`;
  exec(opener, (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    return res.json({ success: true, path: folder, message: '저장 폴더를 열었습니다.' });
  });
});

app.get('/api/admin/storage-info', (_req, res) => {
  res.json({
    success: true,
    storageRoot: storage.getStorageRoot(),
    storageMode: storage.getStorageMode(),
    cloud: storage.isCloudRuntime(),
    masterFolder: storage.MASTER_FOLDER
  });
});

app.get('/api/admin/pull-queue', (_req, res) => {
  const queue = pullSync.listAllPullQueues();
  res.json({
    success: true,
    ...queue,
    settings: pullSync.getSettings()
  });
});

app.get('/api/admin/pull-sync/settings', (_req, res) => {
  res.json({ success: true, settings: pullSync.getSettings() });
});

app.post('/api/admin/pull-sync/settings', (req, res) => {
  const settings = pullSync.updateSettings(req.body || {});
  res.json({ success: true, settings });
});

app.get('/api/admin/pull-file/:userId', (req, res) => {
  const userKey = sanitizeId(req.params.userId);
  const category = String(req.query.category || '');
  const filename = String(req.query.filename || '');
  const fileInfo = pullSync.resolvePullFile(userKey, category, filename);

  if (!fileInfo) {
    return res.status(404).json({ success: false, message: '파일을 찾을 수 없습니다.' });
  }

  res.setHeader('Content-Type', getMimeType(fileInfo.filename));
  res.setHeader('Content-Length', String(fileInfo.size));
  res.setHeader('X-File-Size', String(fileInfo.size));
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileInfo.filename)}"`);

  const stream = fs.createReadStream(fileInfo.path);
  stream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    }
  });
  stream.pipe(res);
});

app.post('/api/admin/users/:userId/confirm-pulled', (req, res) => {
  const userKey = sanitizeId(req.params.userId);
  const settings = pullSync.getSettings();

  if (!settings.deleteAfterPull) {
    return res.json({
      success: true,
      deleted: [],
      failed: [],
      skipped: true,
      message: '다운로드 후 서버 삭제가 꺼져 있습니다.'
    });
  }

  const result = pullSync.confirmPulledItems(userKey, req.body?.items || []);

  for (const item of result.deleted) {
    notifyDataChange(item.path, 'delete');
  }

  if (result.deleted.length) {
    broadcastSse('data-change', {
      type: 'pull-sync',
      userId: userKey,
      deletedCount: result.deleted.length,
      at: Date.now()
    });
  }

  res.json({ success: true, ...result });
});

app.get('/api/backup/:userId', async (req, res) => {
  const userKey = sanitizeId(req.params.userId);
  const db = readJson(USERS_FILE);
  const exists = db.users.some((u) => (u.userKey || u.userId) === userKey);
  if (!exists) {
    return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
  }

  storage.ensureUserStructure(userKey);
  const prof = profilePath(userKey);
  const extras = [];
  if (fs.existsSync(prof)) {
    extras.push({ path: prof, name: 'data/profile.json' });
  }

  try {
    await streamUserBackupZip(userKey, res, extras);
    console.log(`[BACKUP] zip streamed for ${userKey}`);
  } catch (err) {
    const code = err.statusCode || 500;
    if (!res.headersSent) {
      return res.status(code).json({ success: false, message: err.message });
    }
    console.error(`[BACKUP] failed for ${userKey}:`, err.message);
  }
});

app.post('/api/admin/users/:userId/schedule-sync', async (req, res) => {
  const userKey = req.params.userId;
  const file = ensureUserProfile(userKey);
  const profile = readJson(file);

  if (!profile.school?.code || !profile.school?.grade || !profile.school?.classNum) {
    return res.status(400).json({ success: false, message: '학교 정보가 설정되지 않았습니다.' });
  }

  try {
    await warmUpClient().catch(() => {});
    const fetched = await fetchUserScheduleLive(profile.school);
    profile.schedule = fetched.schedule;
    profile.weekView = fetched.weekView;
    profile.classTimes = fetched.classTimes;
    profile.scheduleSyncedAt = fetched.syncedAt;
    profile.scheduleMeta = fetched.meta || null;
    profile.updatedAt = new Date().toISOString();
    writeJson(file, profile);
    broadcastSse('data-change', { type: 'schedule', userId: userKey, at: Date.now() });
    return res.json({
      success: true,
      profile,
      message: '시간표를 동기화했습니다.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/users', (_req, res) => {
  const db = readJson(USERS_FILE);
  const users = db.users.map((user) => getUserSummary(user.userKey || user.userId, user));
  res.json({ success: true, users });
});

app.get('/api/admin/users/:userId', (req, res) => {
  const userKey = req.params.userId;
  const db = readJson(USERS_FILE);
  const user = db.users.find((u) => (u.userKey || u.userId) === userKey);

  if (!user) {
    return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
  }

  ensureUserNotifications(userKey);
  ensureUserProfile(userKey);
  ensureUserContacts(userKey);
  ensureUserCallLog(userKey);

  const notifDb = readJson(notificationsPath(userKey));
  const contactsDb = readJson(contactsPath(userKey));
  const callLogDb = readJson(callLogPath(userKey));
  const media = listMediaFiles(userKey);
  const mediaByDate = media.reduce((acc, item) => {
    const key = item.dateKey || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  res.json({
    success: true,
    user: getUserSummary(userKey, user),
    profile: readJson(profilePath(userKey)),
    school: readJson(profilePath(userKey)).school,
    notifications: notifDb,
    media,
    mediaByDate,
    contacts: contactsDb.contacts || [],
    contactCount: contactsDb.count || 0,
    callLogs: callLogDb.callLogs || [],
    callLogCount: callLogDb.count || 0,
    packages: Object.keys(notifDb.stats.byPackage || {}).sort()
  });
});

app.get('/api/admin/users/:userId/call-log', (req, res) => {
  const userKey = req.params.userId;
  ensureUserCallLog(userKey);
  const db = readJson(callLogPath(userKey));
  res.json({ success: true, callLogs: db.callLogs || [], count: db.count || 0, syncedAt: db.syncedAt });
});

app.get('/api/admin/users/:userId/contacts', (req, res) => {
  const userKey = req.params.userId;
  ensureUserContacts(userKey);
  const db = readJson(contactsPath(userKey));
  res.json({ success: true, contacts: db.contacts || [], count: db.count || 0, syncedAt: db.syncedAt });
});

app.get('/api/admin/users/:userId/notifications', (req, res) => {
  const userKey = req.params.userId;
  const packageFilter = (req.query.package || '').toLowerCase();
  const keyword = (req.query.keyword || '').toLowerCase();

  ensureUserNotifications(userKey);
  const db = readJson(notificationsPath(userKey));

  let filtered = [...db.notifications];

  if (packageFilter) {
    filtered = filtered.filter((n) =>
      (n.packageName || '').toLowerCase().includes(packageFilter)
    );
  }

  if (keyword) {
    filtered = filtered.filter((n) =>
      (n.message || '').toLowerCase().includes(keyword) ||
      (n.sender || '').toLowerCase().includes(keyword) ||
      (n.packageName || '').toLowerCase().includes(keyword)
    );
  }

  filtered.sort((a, b) => b.receivedAt - a.receivedAt);

  res.json({
    success: true,
    notifications: filtered,
    stats: db.stats,
    packages: Object.keys(db.stats.byPackage || {}).sort()
  });
});

app.get('/api/admin/users/:userId/media', (req, res) => {
  const userKey = req.params.userId;
  const media = listMediaFiles(userKey);
  const mediaByDate = media.reduce((acc, item) => {
    const key = item.dateKey || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  res.json({ success: true, media, mediaByDate });
});

app.get('/api/admin/users/:userId/profile', (req, res) => {
  const userKey = req.params.userId;
  ensureUserProfile(userKey);
  res.json({ success: true, profile: readJson(profilePath(userKey)) });
});

app.post('/api/grade-percent/upload', fileUpload.single('file'), (req, res) => {
  const userId = resolveUserKey(req);
  const schoolCode = Number(req.body?.schoolCode);
  const schoolName = String(req.body?.schoolName || '').trim();
  const grade = Number(req.body?.grade);

  if (!schoolCode || !schoolName) {
    return res.status(400).json({ success: false, message: 'schoolCode와 schoolName이 필요합니다.' });
  }

  if (!grade || grade < 1 || grade > 3) {
    return res.status(400).json({ success: false, message: '학년(1~3)을 선택해 주세요.' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: '업로드할 이미지가 없습니다.' });
  }

  try {
    const { meta, request } = gradePercent.addPercentRequest(
      schoolCode,
      schoolName,
      grade,
      userId,
      req.file.originalname || req.body.filename || 'percent-request.jpg',
      req.file.buffer
    );

    notifyDataChange(storage.schoolPercentMetaPath(schoolCode), 'change');
    broadcastSse('data-change', { type: 'gradePercent', schoolCode: String(schoolCode), at: Date.now() });

    console.log(`[GRADE-REQUEST][${userId}] ${schoolName} ${grade}학년 request uploaded`);

    return res.json({
      success: true,
      schoolCode,
      schoolName: meta.schoolName,
      grade,
      request,
      pendingCount: gradePercent.getPendingRequests(meta, grade).length,
      message: `${grade}학년 퍼센트 표 요청이 접수되었습니다. 관리자 확인 후 등록됩니다.`
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/grade-percent/tables', (req, res) => {
  const schoolCode = Number(req.query.schoolCode);
  const grade = req.query.grade !== undefined ? Number(req.query.grade) : null;

  if (!schoolCode) {
    return res.status(400).json({ success: false, message: 'schoolCode가 필요합니다.' });
  }

  const info = gradePercent.getTableInfo(schoolCode, grade);
  return res.json({
    success: true,
    ...info,
    hasTable: info.ready,
    message: info.ready
      ? `${info.grade}학년 퍼센트 표를 사용할 수 있습니다.`
      : `${grade || ''}학년 표가 아직 등록되지 않았습니다. 요청하기로 사진을 올려 주세요.`
  });
});

app.get('/api/grade-percent/ready-schools', (req, res) => {
  const codes = req.query.codes || req.query.schoolCodes || '';
  const schools = gradePercent.getReadySchools(
    String(codes)
      .split(',')
      .map((c) => Number(c.trim()))
      .filter((c) => c > 0)
  );
  return res.json({ success: true, schools });
});

app.post('/api/grade-percent/calculate', (req, res) => {
  const schoolCode = Number(req.body?.schoolCode);
  const grade = Number(req.body?.grade);
  const grades = req.body?.grades;

  if (!schoolCode) {
    return res.status(400).json({ success: false, message: 'schoolCode가 필요합니다.' });
  }

  const result = gradePercent.calculatePercent(schoolCode, grade, grades);
  if (!result.success) {
    return res.status(400).json(result);
  }

  return res.json(result);
});

app.get('/api/admin/grade-percent', (_req, res) => {
  const schools = gradePercent.listAllSchoolTables();
  res.json({ success: true, schools, count: schools.length });
});

app.post('/api/admin/grade-percent/rows', (req, res) => {
  const schoolCode = Number(req.body?.schoolCode);
  const schoolName = String(req.body?.schoolName || '').trim();
  const grade = Number(req.body?.grade);
  const rows = req.body?.rows;

  if (!schoolCode) {
    return res.status(400).json({ success: false, message: 'schoolCode가 필요합니다.' });
  }

  if (!grade || grade < 1 || grade > 3) {
    return res.status(400).json({ success: false, message: '학년(1~3)이 필요합니다.' });
  }

  try {
    const meta = gradePercent.saveSchoolRows(schoolCode, grade, rows, schoolName);
    notifyDataChange(storage.schoolPercentMetaPath(schoolCode), 'change');
    broadcastSse('data-change', { type: 'gradePercent', schoolCode: String(schoolCode), at: Date.now() });

    const gradeTable = meta.gradeTables[String(grade)] || { rows: [], ready: false };

    return res.json({
      success: true,
      schoolCode: meta.schoolCode,
      schoolName: meta.schoolName,
      grade,
      rows: gradeTable.rows,
      ready: gradeTable.ready,
      readyGrades: gradePercent.getReadyGrades(meta),
      message: `${grade}학년 퍼센트 표가 등록되었습니다. 앱에서 바로 사용할 수 있습니다.`
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/schedule-cache/status', (_req, res) => {
  try {
    return res.json({
      success: true,
      ttlHours: 2,
      graceHours: 2.5,
      schools: scheduleCache.getCacheStatus()
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/schedule-cache/refresh', async (_req, res) => {
  try {
    const summary = await scheduleCache.refreshAllSchoolSchedules();
    syncAllUserSchedules().catch((err) => console.error('[SCHEDULE-CACHE] user sync after refresh failed', err));
    return res.json(summary);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard server running at http://0.0.0.0:${PORT}`);
  console.log(`Storage root: ${storage.getStorageRoot()} (mode=${storage.getStorageMode()})`);
  startStorageWatcher();
  warmUpClient();

  const runScheduleSync = (label) => {
    console.log(`[CRON] ${label}`);
    return warmUpClient()
      .catch((err) => console.warn('[CRON] comcigan warm-up warn:', err.message))
      .then(() => scheduleCache.refreshAllSchoolSchedules())
      .then(() => syncAllUserSchedules())
      .catch((err) => console.error(`[CRON] ${label} failed`, err));
  };

  setTimeout(() => {
    runScheduleSync('startup schedule refresh');
  }, 3000);

  cron.schedule('0 */2 * * *', () => {
    runScheduleSync('2-hour school schedule cache refresh (KST)');
  }, { timezone: 'Asia/Seoul' });

  cron.schedule('0 6 * * *', () => {
    runScheduleSync('daily morning timetable sync 06:00 (KST)');
  }, { timezone: 'Asia/Seoul' });
});
