/**
 * Seeds sample data under Desktop/OnDevice_관제_데이터 for dashboard QA.
 * Usage: node scripts/seed-dashboard-data.js [userKey]
 */
const fs = require('fs');
const path = require('path');
const storage = require('../storagePaths');

const userId = process.argv[2] || '신규유저';

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function seed() {
  storage.ensureUserStructure(userId);

  const notifFile = storage.notificationsPath(userId);
  if (!fs.existsSync(notifFile) || readJsonSafe(notifFile).notifications.length === 0) {
    writeJson(notifFile, {
      notifications: [
        {
          id: 'seed-1',
          userId,
          sender: '홍길동',
          message: '대시보드 QA 테스트 알림입니다.',
          receivedAt: Date.now() - 3600000,
          packageName: 'com.kakao.talk',
          serverReceivedAt: new Date().toISOString()
        },
        {
          id: 'seed-2',
          userId,
          sender: 'Instagram',
          message: '새로운 좋아요 3개',
          receivedAt: Date.now() - 7200000,
          packageName: 'com.instagram.android',
          serverReceivedAt: new Date().toISOString()
        }
      ],
      stats: {
        total: 2,
        bySender: { '홍길동': 1, Instagram: 1 },
        byPackage: { 'com.kakao.talk': 1, 'com.instagram.android': 1 }
      }
    });
    console.log('[seed] notifications');
  }

  const contactsFile = storage.contactsPath(userId);
  if (!fs.existsSync(contactsFile) || readJsonSafe(contactsFile).contacts.length === 0) {
    writeJson(contactsFile, {
      contacts: [
        { name: '김철수', phone: '010-1234-5678', email: '' },
        { name: '이영희', phone: '010-9876-5432', email: 'lee@example.com' }
      ],
      count: 2,
      syncedAt: new Date().toISOString()
    });
    console.log('[seed] contacts');
  }

  const callLogFile = storage.callLogPath(userId);
  if (!fs.existsSync(callLogFile) || readJsonSafe(callLogFile).callLogs.length === 0) {
    writeJson(callLogFile, {
      callLogs: [
        { number: '010-1234-5678', name: '김철수', type: '수신', date: Date.now() - 86400000, durationSec: 125 },
        { number: '010-5555-0000', name: '', type: '발신', date: Date.now() - 172800000, durationSec: 45 }
      ],
      count: 2,
      syncedAt: new Date().toISOString()
    });
    console.log('[seed] call logs');
  }

  const photoPath = path.join(storage.photosDir(userId), 'qa-sample.png');
  if (!fs.existsSync(photoPath)) {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(photoPath, png);
    console.log('[seed] sample photo');
  }

  console.log(`Done seeding user "${userId}" at ${storage.userRoot(userId)}`);
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return {};
  }
}

seed();
