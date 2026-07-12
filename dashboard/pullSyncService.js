const fs = require('fs');
const path = require('path');
const storage = require('./storagePaths');
const durablePaths = require('./durablePaths');

function getDataDir() {
  return durablePaths.getDataDir();
}

function usersFile() {
  return path.join(getDataDir(), 'users.json');
}

function pullSettingsFile() {
  return path.join(getDataDir(), 'pull-sync-settings.json');
}

const MEDIA_CATEGORIES = new Set([
  storage.CATEGORIES.photos,
  storage.CATEGORIES.videos
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function ensurePullSettings() {
  const file = pullSettingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    writeJson(file, getDefaultSettings());
  }
}

function getDefaultSettings() {
  return {
    deleteAfterPull: true,
    pullIntervalSec: 30
  };
}

function getSettings() {
  ensurePullSettings();
  return { ...getDefaultSettings(), ...readJson(pullSettingsFile()) };
}

function updateSettings(patch) {
  ensurePullSettings();
  const current = getSettings();
  const next = {
    ...current,
    deleteAfterPull:
      patch.deleteAfterPull !== undefined ? !!patch.deleteAfterPull : current.deleteAfterPull,
    pullIntervalSec:
      patch.pullIntervalSec !== undefined
        ? Math.max(10, Math.min(600, parseInt(patch.pullIntervalSec, 10) || current.pullIntervalSec))
        : current.pullIntervalSec
  };
  writeJson(pullSettingsFile(), next);
  return next;
}

function listMediaItemsForUser(userId) {
  const safeId = storage.sanitizeId(userId);
  storage.ensureUserStructure(safeId);
  const items = [];

  const dirs = [
    { category: storage.CATEGORIES.photos, dir: storage.photosDir(safeId) },
    { category: storage.CATEGORIES.videos, dir: storage.videosDir(safeId) }
  ];

  for (const { category, dir } of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const fullPath = path.join(dir, name);
      if (!fs.statSync(fullPath).isFile()) continue;
      const stat = fs.statSync(fullPath);
      items.push({
        category,
        filename: name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      });
    }
  }

  return items.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

function listAllPullQueues() {
  const file = usersFile();
  if (!fs.existsSync(file)) {
    return { users: [], totalItems: 0, totalBytes: 0 };
  }

  const db = readJson(file);
  const users = (db.users || []).map((user) => {
    const userKey = user.userKey || user.userId;
    const items = listMediaItemsForUser(userKey);
    const bytes = items.reduce((sum, item) => sum + item.size, 0);
    return {
      userKey,
      name: user.name || userKey,
      itemCount: items.length,
      totalBytes: bytes,
      items
    };
  });

  const totalItems = users.reduce((sum, user) => sum + user.itemCount, 0);
  const totalBytes = users.reduce((sum, user) => sum + user.totalBytes, 0);

  return { users, totalItems, totalBytes };
}

function resolvePullFile(userId, category, filename) {
  const safeId = storage.sanitizeId(userId);
  const safeName = path.basename(String(filename || ''));
  const safeCategory = String(category || '');

  if (!safeName || !MEDIA_CATEGORIES.has(safeCategory)) {
    return null;
  }

  const filePath = path.join(storage.userRoot(safeId), safeCategory, safeName);
  const root = storage.userRoot(safeId);
  const resolved = path.resolve(filePath);

  if (!resolved.startsWith(path.resolve(root))) {
    return null;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return null;
  }

  const stat = fs.statSync(resolved);
  return {
    path: resolved,
    filename: safeName,
    category: safeCategory,
    size: stat.size
  };
}

function confirmPulledItems(userId, items) {
  const safeId = storage.sanitizeId(userId);
  const deleted = [];
  const failed = [];

  for (const raw of items || []) {
    const category = String(raw?.category || '');
    const filename = path.basename(String(raw?.filename || ''));
    const expectedSize = Number(raw?.size);

    if (!filename || !MEDIA_CATEGORIES.has(category) || !Number.isFinite(expectedSize)) {
      failed.push({ category, filename, reason: 'invalid_item' });
      continue;
    }

    const fileInfo = resolvePullFile(safeId, category, filename);
    if (!fileInfo) {
      failed.push({ category, filename, reason: 'not_found' });
      continue;
    }
    if (fileInfo.size !== expectedSize) {
      failed.push({
        category,
        filename,
        reason: 'size_mismatch',
        expected: expectedSize,
        actual: fileInfo.size
      });
      continue;
    }

    fs.unlinkSync(fileInfo.path);
    deleted.push({ category, filename, size: fileInfo.size, path: fileInfo.path });
  }

  return { deleted, failed };
}

module.exports = {
  getSettings,
  updateSettings,
  listMediaItemsForUser,
  listAllPullQueues,
  resolvePullFile,
  confirmPulledItems
};
