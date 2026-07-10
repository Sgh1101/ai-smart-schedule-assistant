const fs = require('fs');
const path = require('path');
const storage = require('./storagePaths');

const DATA_DIR = path.join(__dirname, 'data');
const LEGACY_UPLOADS = path.join(__dirname, 'uploads');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function isEmptyCollection(data, key) {
  if (!data) return true;
  const items = data[key];
  return !Array.isArray(items) || items.length === 0;
}

function migrateJsonFile(legacyPath, targetPath, key) {
  if (!fs.existsSync(legacyPath)) return false;
  const legacy = readJsonSafe(legacyPath);
  if (!legacy || isEmptyCollection(legacy, key)) return false;

  const target = readJsonSafe(targetPath);
  if (target && !isEmptyCollection(target, key)) return false;

  writeJson(targetPath, legacy);
  console.log(`[MIGRATE] ${path.basename(legacyPath)} -> ${targetPath}`);
  return true;
}

function extractUserIdFromLegacyFilename(filename, prefix) {
  if (!filename.startsWith(prefix) || !filename.endsWith('.json')) return null;
  return filename.slice(prefix.length, -5);
}

function migrateLegacyUserData(userId) {
  const safeId = storage.sanitizeId(userId);
  storage.ensureUserStructure(safeId);
  let migrated = false;

  const pairs = [
    [`notifications_${safeId}.json`, storage.notificationsPath(safeId), 'notifications'],
    [`contacts_${safeId}.json`, storage.contactsPath(safeId), 'contacts'],
    [`calllog_${safeId}.json`, storage.callLogPath(safeId), 'callLogs']
  ];

  for (const [legacyName, targetPath, key] of pairs) {
    const legacyPath = path.join(DATA_DIR, legacyName);
    if (migrateJsonFile(legacyPath, targetPath, key)) {
      migrated = true;
    }
  }

  return migrated;
}

function migrateLegacyUploads(userId) {
  const safeId = storage.sanitizeId(userId);
  const legacyUserDir = path.join(LEGACY_UPLOADS, safeId);
  if (!fs.existsSync(legacyUserDir)) return false;

  storage.ensureUserStructure(safeId);
  let migrated = false;

  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      const destDir = storage.mediaDirForFilename(safeId, name);
      const dest = path.join(destDir, name);
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(full, dest);
        console.log(`[MIGRATE] upload ${name} -> ${dest}`);
        migrated = true;
      }
    }
  };

  walk(legacyUserDir);
  return migrated;
}

function migrateAllLegacyData() {
  if (!fs.existsSync(DATA_DIR)) return;

  const seen = new Set();

  for (const name of fs.readdirSync(DATA_DIR)) {
    let userId = extractUserIdFromLegacyFilename(name, 'notifications_');
    if (!userId) userId = extractUserIdFromLegacyFilename(name, 'contacts_');
    if (!userId) userId = extractUserIdFromLegacyFilename(name, 'calllog_');
    if (userId) seen.add(userId);
  }

  if (fs.existsSync(LEGACY_UPLOADS)) {
    for (const name of fs.readdirSync(LEGACY_UPLOADS)) {
      seen.add(name);
    }
  }

  let any = false;
  for (const userId of seen) {
    if (migrateLegacyUserData(userId)) any = true;
    if (migrateLegacyUploads(userId)) any = true;
  }

  if (any) {
    console.log('[MIGRATE] Legacy dashboard/data and uploads migrated to storage root.');
  }

  migrateDesktopFolderIfNeeded();
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (!fs.existsSync(to)) {
      fs.copyFileSync(from, to);
    }
  }
}

/** One-time: move Desktop/OnDevice_관제_데이터 → dashboard/uploads when switching to cloud layout */
function migrateDesktopFolderIfNeeded() {
  if (process.env.SKIP_DESKTOP_MIGRATION === 'true') return;
  if (process.env.USE_DESKTOP_STORAGE === 'true') return;

  const desktopRoot = path.join(require('os').homedir(), 'Desktop', storage.MASTER_FOLDER);
  const targetRoot = storage.getStorageRoot();
  if (!fs.existsSync(desktopRoot)) return;
  if (path.resolve(desktopRoot) === path.resolve(targetRoot)) return;

  let migrated = false;
  for (const name of fs.readdirSync(desktopRoot)) {
    const src = path.join(desktopRoot, name);
    const dest = path.join(targetRoot, name);
    if (!fs.existsSync(dest)) {
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        copyDirRecursive(src, dest);
      } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
      }
      migrated = true;
    }
  }
  if (migrated) {
    console.log(`[MIGRATE] Desktop folder copied to ${targetRoot}`);
  }
}

module.exports = { migrateAllLegacyData, migrateDesktopFolderIfNeeded };
