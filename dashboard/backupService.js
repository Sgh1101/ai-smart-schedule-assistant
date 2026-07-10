const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const storage = require('./storagePaths');

/**
 * Stream a zip of uploads/[userId]/ (+ optional extra files) to the HTTP response.
 */
function streamUserBackupZip(userId, res, extraFiles = []) {
  const safeId = storage.sanitizeId(userId);
  const userDir = storage.userRoot(safeId);

  if (!fs.existsSync(userDir)) {
    const err = new Error('사용자 데이터 폴더가 없습니다.');
    err.statusCode = 404;
    throw err;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `backup_${safeId}_${stamp}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });

  return new Promise((resolve, reject) => {
    archive.on('error', (err) => reject(err));
    res.on('close', () => resolve({ filename, bytes: archive.pointer() }));
    archive.pipe(res);

    archive.directory(userDir, safeId);

    for (const extra of extraFiles) {
      if (extra?.path && fs.existsSync(extra.path)) {
        archive.file(extra.path, { name: extra.name || path.basename(extra.path) });
      }
    }

    archive.finalize();
  });
}

module.exports = {
  streamUserBackupZip
};
