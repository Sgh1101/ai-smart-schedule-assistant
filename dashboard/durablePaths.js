const fs = require('fs');
const path = require('path');

/**
 * Durable app data (users, profiles, controls) and media roots.
 * On Render with a disk: /var/data/app-data + /var/data/uploads
 * Locally: dashboard/data + dashboard/uploads (or DATA_* env overrides)
 */
function getDataDir() {
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }
  return path.join(__dirname, 'data');
}

function getLegacyDataDir() {
  return path.join(__dirname, 'data');
}

function copyFileIfMissing(src, dest) {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return 0;
  let count = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === '.' || name === '..') continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      count += copyDirRecursive(from, to);
    } else if (!fs.existsSync(to)) {
      fs.copyFileSync(from, to);
      count += 1;
    }
  }
  return count;
}

/**
 * One-time migrate from repo-local dashboard/data and /tmp uploads into persistent roots.
 */
function migrateToDurableRoots(storageRoot) {
  const dataDir = getDataDir();
  const legacy = getLegacyDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  let migrated = 0;
  if (path.resolve(dataDir) !== path.resolve(legacy) && fs.existsSync(legacy)) {
    for (const name of fs.readdirSync(legacy)) {
      const from = path.join(legacy, name);
      const to = path.join(dataDir, name);
      const stat = fs.statSync(from);
      if (stat.isDirectory()) {
        migrated += copyDirRecursive(from, to);
      } else if (copyFileIfMissing(from, to)) {
        migrated += 1;
      }
    }
  }

  const tmpUploads = path.resolve('/tmp/uploads');
  if (
    storageRoot &&
    path.resolve(storageRoot) !== tmpUploads &&
    fs.existsSync(tmpUploads)
  ) {
    migrated += copyDirRecursive(tmpUploads, storageRoot);
  }

  return { dataDir, migrated };
}

const AUDIT_USER_PATTERNS = [
  /^audit_/i,
  /_audit_/i,
  /^full_audit/i,
  /^register_audit/i,
  /^tunnel_test$/i,
  /^test_/i,
  /^test$/i,
  /^가상폰테스트$/,
  /^unknown$/
];

function isAuditUserKey(userKey) {
  const key = String(userKey || '');
  return AUDIT_USER_PATTERNS.some((re) => re.test(key));
}

module.exports = {
  getDataDir,
  getLegacyDataDir,
  migrateToDurableRoots,
  isAuditUserKey,
  AUDIT_USER_PATTERNS
};
