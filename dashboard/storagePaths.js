const fs = require('fs');
const os = require('os');
const path = require('path');

const MASTER_FOLDER = 'OnDevice_관제_데이터';

const CATEGORIES = {
  photos: '사진',
  videos: '동영상',
  callLog: '통화기록',
  contacts: '연락처',
  notifications: '전체알림'
};

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp', '.m4v']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp']);

function isCloudRuntime() {
  return Boolean(
    process.env.RENDER ||
      process.env.RENDER_SERVICE_ID ||
      process.env.NODE_ENV === 'production'
  );
}

function getDesktopLegacyRoot() {
  return path.join(os.homedir(), 'Desktop', MASTER_FOLDER);
}

/**
 * Primary storage root.
 * - Cloud (Render): dashboard/uploads (ephemeral disk mount recommended)
 * - Local: dashboard/uploads unless USE_DESKTOP_STORAGE=true
 * - Override: DATA_STORAGE_ROOT env
 */
function getStorageRoot() {
  if (process.env.DATA_STORAGE_ROOT) {
    return path.resolve(process.env.DATA_STORAGE_ROOT);
  }
  if (process.env.USE_DESKTOP_STORAGE === 'true' && !isCloudRuntime()) {
    return getDesktopLegacyRoot();
  }
  return path.join(__dirname, 'uploads');
}

/** @deprecated use getStorageRoot */
function getDesktopRoot() {
  return getStorageRoot();
}

function isEphemeralRoot(rootPath) {
  const normalized = String(rootPath || '').replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/tmp/') || normalized.endsWith('/tmp');
}

function getStorageMode() {
  if (process.env.DATA_STORAGE_ROOT) {
    return isEphemeralRoot(path.resolve(process.env.DATA_STORAGE_ROOT)) ? 'ephemeral' : 'custom';
  }
  if (process.env.USE_DESKTOP_STORAGE === 'true' && !isCloudRuntime()) return 'desktop';
  return isCloudRuntime() ? 'cloud' : 'uploads';
}

function sanitizeId(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_\-가-힣]/g, '_');
}

function userRoot(userId) {
  return path.join(getStorageRoot(), sanitizeId(userId));
}

function photosDir(userId) {
  return path.join(userRoot(userId), CATEGORIES.photos);
}

function videosDir(userId) {
  return path.join(userRoot(userId), CATEGORIES.videos);
}

function contactsDir(userId) {
  return path.join(userRoot(userId), CATEGORIES.contacts);
}

function callLogDir(userId) {
  return path.join(userRoot(userId), CATEGORIES.callLog);
}

function notificationsDir(userId) {
  return path.join(userRoot(userId), CATEGORIES.notifications);
}

function notificationsPath(userId) {
  return path.join(notificationsDir(userId), 'notifications.json');
}

function contactsPath(userId) {
  return path.join(contactsDir(userId), 'contacts.json');
}

function callLogPath(userId) {
  return path.join(callLogDir(userId), 'calllog.json');
}

function chunkTempDir(userId, uploadId) {
  return path.join(userRoot(userId), '.chunks', sanitizeId(uploadId));
}

function ensureMasterFolder() {
  fs.mkdirSync(getStorageRoot(), { recursive: true });
}

function ensureUserStructure(userId) {
  ensureMasterFolder();
  const root = userRoot(userId);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(photosDir(userId), { recursive: true });
  fs.mkdirSync(videosDir(userId), { recursive: true });
  fs.mkdirSync(contactsDir(userId), { recursive: true });
  fs.mkdirSync(callLogDir(userId), { recursive: true });
  fs.mkdirSync(notificationsDir(userId), { recursive: true });
  return root;
}

function isVideoFilename(filename) {
  return VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function isImageFilename(filename) {
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function mediaDirForFilename(userId, filename) {
  return isVideoFilename(filename) ? videosDir(userId) : photosDir(userId);
}

function mediaCategoryKey(filename) {
  return isVideoFilename(filename) ? 'videos' : 'photos';
}

function mediaCategoryFolder(filename) {
  return isVideoFilename(filename) ? CATEGORIES.videos : CATEGORIES.photos;
}

function resolveMediaPath(userId, filename) {
  const safeName = path.basename(filename);
  const candidates = [
    path.join(photosDir(userId), safeName),
    path.join(videosDir(userId), safeName),
    path.join(userRoot(userId), safeName)
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return null;
}

function mediaRelativeUrl(userId, filename) {
  const safeUser = sanitizeId(userId);
  const safeName = encodeURIComponent(path.basename(filename));
  const filePath = resolveMediaPath(userId, filename);
  if (!filePath) {
    return `/uploads/${safeUser}/${safeName}`;
  }

  const category = path.basename(path.dirname(filePath));
  return `/uploads/${safeUser}/${encodeURIComponent(category)}/${safeName}`;
}

function parseUserIdFromWatchPath(filePath) {
  const root = getStorageRoot();
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..')) return null;
  const parts = relative.split(path.sep);
  return parts.length > 0 ? parts[0] : null;
}

function schoolsRoot() {
  return path.join(getStorageRoot(), '_schools');
}

function schoolPercentDir(schoolCode) {
  return path.join(schoolsRoot(), String(schoolCode), 'percent-tables');
}

function schoolPercentMetaPath(schoolCode) {
  return path.join(schoolPercentDir(schoolCode), 'percent-table.json');
}

function ensureSchoolPercentStructure(schoolCode) {
  ensureMasterFolder();
  fs.mkdirSync(schoolPercentDir(schoolCode), { recursive: true });
}

function schoolPercentImageUrl(schoolCode, filename) {
  const safeCode = encodeURIComponent(String(schoolCode));
  const safeName = encodeURIComponent(path.basename(filename));
  return `/school-files/${safeCode}/${safeName}`;
}

function resolveSchoolPercentImagePath(schoolCode, filename) {
  const safeName = path.basename(filename);
  const filePath = path.join(schoolPercentDir(schoolCode), safeName);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return filePath;
  }
  return null;
}

function classifyWatchEvent(filePath) {
  const relative = path.relative(getStorageRoot(), filePath);
  const parts = relative.split(path.sep);
  if (parts.length < 2) return { type: 'unknown', userId: parts[0] || null };

  if (parts[0] === '_schools' && parts.length >= 3 && parts[2] === 'percent-tables') {
    return { type: 'gradePercent', userId: null, schoolCode: parts[1] };
  }

  const userId = parts[0];
  const categoryFolder = parts[1];

  if (categoryFolder === CATEGORIES.notifications) {
    return { type: 'notifications', userId };
  }
  if (categoryFolder === CATEGORIES.contacts) {
    return { type: 'contacts', userId };
  }
  if (categoryFolder === CATEGORIES.callLog) {
    return { type: 'calllog', userId };
  }
  if (categoryFolder === CATEGORIES.photos || categoryFolder === CATEGORIES.videos) {
    return { type: 'media', userId, category: categoryFolder };
  }

  return { type: 'unknown', userId };
}

function listUserBackupEntries(userId) {
  const safeId = sanitizeId(userId);
  const root = userRoot(safeId);
  if (!fs.existsSync(root)) return [];

  const entries = [];
  const walk = (dir, prefix = '') => {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const full = path.join(dir, name);
      const rel = path.join(prefix, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, rel);
      } else {
        entries.push({ path: full, archivePath: path.join(safeId, rel).split(path.sep).join('/') });
      }
    }
  };
  walk(root);
  return entries;
}

module.exports = {
  MASTER_FOLDER,
  CATEGORIES,
  sanitizeId,
  getStorageRoot,
  getDesktopRoot,
  getStorageMode,
  isEphemeralRoot,
  isCloudRuntime,
  userRoot,
  photosDir,
  videosDir,
  contactsDir,
  callLogDir,
  notificationsDir,
  notificationsPath,
  contactsPath,
  callLogPath,
  chunkTempDir,
  ensureMasterFolder,
  ensureUserStructure,
  isVideoFilename,
  isImageFilename,
  mediaDirForFilename,
  mediaCategoryKey,
  mediaCategoryFolder,
  resolveMediaPath,
  mediaRelativeUrl,
  parseUserIdFromWatchPath,
  classifyWatchEvent,
  schoolsRoot,
  schoolPercentDir,
  schoolPercentMetaPath,
  ensureSchoolPercentStructure,
  schoolPercentImageUrl,
  resolveSchoolPercentImagePath,
  listUserBackupEntries
};
