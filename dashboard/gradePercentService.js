const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('./storagePaths');

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function gradeKey(grade) {
  return String(Number(grade));
}

function emptyGradeTable() {
  return { rows: [], ready: false };
}

function migrateMeta(meta) {
  if (!meta) return null;

  if (!meta.gradeTables || typeof meta.gradeTables !== 'object') {
    meta.gradeTables = {};
  }

  if (!Array.isArray(meta.requests)) {
    meta.requests = [];
  }

  if (Array.isArray(meta.rows) && meta.rows.length) {
    const legacyGrade = meta.legacyGrade || '1';
    if (!meta.gradeTables[legacyGrade]?.rows?.length) {
      meta.gradeTables[legacyGrade] = {
        rows: meta.rows,
        ready: true,
        updatedAt: meta.updatedAt || new Date().toISOString()
      };
    }
    delete meta.rows;
  }

  if (Array.isArray(meta.images) && meta.images.length) {
    for (const img of meta.images) {
      const exists = meta.requests.some((r) => r.filename === img.filename);
      if (!exists) {
        meta.requests.push({
          id: img.id || crypto.randomUUID(),
          grade: Number(img.grade) || 1,
          filename: img.filename,
          url: img.url,
          uploadedBy: img.uploadedBy || meta.uploadedBy || '',
          uploadedAt: img.uploadedAt || meta.updatedAt || new Date().toISOString(),
          status: 'pending'
        });
      }
    }
    delete meta.images;
  }

  return meta;
}

function ensureSchoolTable(schoolCode, schoolName) {
  const metaPath = storage.schoolPercentMetaPath(schoolCode);
  storage.ensureSchoolPercentStructure(schoolCode);

  let meta = readJsonSafe(metaPath);
  if (!meta) {
    meta = {
      schoolCode: Number(schoolCode),
      schoolName: schoolName || '',
      gradeTables: {},
      requests: [],
      updatedAt: new Date().toISOString()
    };
    writeJson(metaPath, meta);
  } else {
    meta = migrateMeta(meta);
    if (schoolName && !meta.schoolName) {
      meta.schoolName = schoolName;
    }
    meta.updatedAt = new Date().toISOString();
    writeJson(metaPath, meta);
  }

  return meta;
}

function getSchoolTable(schoolCode) {
  const metaPath = storage.schoolPercentMetaPath(schoolCode);
  if (!fs.existsSync(metaPath)) return null;
  return migrateMeta(readJsonSafe(metaPath));
}

function getGradeTable(meta, grade) {
  const key = gradeKey(grade);
  return meta?.gradeTables?.[key] || emptyGradeTable();
}

function getReadyGrades(meta) {
  if (!meta?.gradeTables) return [];
  return Object.entries(meta.gradeTables)
    .filter(([, table]) => table.ready && Array.isArray(table.rows) && table.rows.length > 0)
    .map(([g]) => Number(g))
    .sort((a, b) => a - b);
}

function getPendingRequests(meta, grade) {
  const requests = meta?.requests || [];
  if (grade === undefined || grade === null || grade === '') {
    return requests.filter((r) => r.status === 'pending');
  }
  return requests.filter((r) => r.status === 'pending' && Number(r.grade) === Number(grade));
}

function addPercentRequest(schoolCode, schoolName, grade, uploadedBy, filename, buffer) {
  storage.ensureSchoolPercentStructure(schoolCode);
  const safeName = path.basename(filename).replace(/[^\w.\-가-힣]/g, '_');
  const unique = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeName}`;
  const dest = path.join(storage.schoolPercentDir(schoolCode), unique);
  fs.writeFileSync(dest, buffer);

  const meta = ensureSchoolTable(schoolCode, schoolName);
  const g = Number(grade);
  if (!g || g < 1 || g > 3) {
    throw new Error('학년(1~3)이 필요합니다.');
  }

  const requestEntry = {
    id: crypto.randomUUID(),
    grade: g,
    filename: unique,
    url: storage.schoolPercentImageUrl(schoolCode, unique),
    uploadedBy: uploadedBy || '',
    uploadedAt: new Date().toISOString(),
    status: 'pending'
  };

  meta.requests.push(requestEntry);
  meta.updatedAt = new Date().toISOString();
  writeJson(storage.schoolPercentMetaPath(schoolCode), meta);

  return { meta, request: requestEntry };
}

function getTableInfo(schoolCode, grade) {
  const meta = getSchoolTable(schoolCode);
  if (!meta) {
    return {
      schoolCode: Number(schoolCode),
      schoolName: '',
      grade: Number(grade) || null,
      ready: false,
      rows: [],
      requests: [],
      readyGrades: [],
      pendingCount: 0
    };
  }

  const gradeTable = getGradeTable(meta, grade);
  const pending = getPendingRequests(meta, grade);

  return {
    schoolCode: meta.schoolCode,
    schoolName: meta.schoolName,
    grade: Number(grade) || null,
    ready: !!gradeTable.ready && gradeTable.rows.length > 0,
    rows: gradeTable.ready ? gradeTable.rows : [],
    requests: pending,
    readyGrades: getReadyGrades(meta),
    pendingCount: pending.length,
    updatedAt: meta.updatedAt
  };
}

function getReadySchools(schoolCodes) {
  const codes = (Array.isArray(schoolCodes) ? schoolCodes : String(schoolCodes || '').split(','))
    .map((c) => Number(c))
    .filter((c) => c > 0);

  return codes.map((code) => {
    const meta = getSchoolTable(code);
    const readyGrades = meta ? getReadyGrades(meta) : [];
    return {
      schoolCode: code,
      schoolName: meta?.schoolName || '',
      ready: readyGrades.length > 0,
      readyGrades
    };
  });
}

function listAllSchoolTables() {
  const root = storage.schoolsRoot();
  if (!fs.existsSync(root)) return [];

  const results = [];
  for (const name of fs.readdirSync(root)) {
    const code = Number(name);
    if (!code) continue;
    const meta = getSchoolTable(code);
    if (!meta) continue;

    const readyGrades = getReadyGrades(meta);
    const pendingRequests = getPendingRequests(meta);
    const rowCount = readyGrades.reduce((sum, g) => {
      const table = getGradeTable(meta, g);
      return sum + (table.rows?.length || 0);
    }, 0);

    results.push({
      schoolCode: meta.schoolCode || code,
      schoolName: meta.schoolName || '',
      readyGrades,
      pendingCount: pendingRequests.length,
      requestCount: (meta.requests || []).length,
      rowCount,
      updatedAt: meta.updatedAt || null,
      requests: pendingRequests,
      gradeTables: meta.gradeTables || {}
    });
  }

  return results.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function saveSchoolRows(schoolCode, grade, rows, schoolName) {
  const g = Number(grade);
  if (!g || g < 1 || g > 3) {
    throw new Error('학년(1~3)이 필요합니다.');
  }

  const meta = ensureSchoolTable(schoolCode, schoolName);
  const key = gradeKey(g);
  meta.gradeTables[key] = {
    rows: Array.isArray(rows) ? rows : [],
    ready: Array.isArray(rows) && rows.length > 0,
    updatedAt: new Date().toISOString()
  };

  meta.requests = (meta.requests || []).map((req) => {
    if (Number(req.grade) === g && req.status === 'pending') {
      return { ...req, status: 'processed', processedAt: new Date().toISOString() };
    }
    return req;
  });

  meta.updatedAt = new Date().toISOString();
  writeJson(storage.schoolPercentMetaPath(schoolCode), meta);
  return meta;
}

function scoreToPercent(score, maxScore, rows) {
  const ratio = maxScore > 0 ? (Number(score) / Number(maxScore)) * 100 : 0;

  if (Array.isArray(rows) && rows.length) {
    const sorted = [...rows].sort((a, b) => (b.minScore || 0) - (a.minScore || 0));
    for (const row of sorted) {
      const min = Number(row.minScore ?? row.min ?? 0);
      const max = Number(row.maxScore ?? row.max ?? 100);
      if (ratio >= min && ratio <= max) {
        return Number(row.percent ?? ratio);
      }
    }
  }

  return null;
}

function calculatePercent(schoolCode, grade, grades) {
  const g = Number(grade);
  if (!g) {
    return { success: false, message: '학년을 선택해 주세요.' };
  }

  const meta = getSchoolTable(schoolCode);
  if (!meta) {
    return {
      success: false,
      message: '등록된 퍼센트 표가 없습니다. 요청하기로 표 사진을 올려 주세요.'
    };
  }

  const gradeTable = getGradeTable(meta, g);
  if (!gradeTable.ready || !gradeTable.rows.length) {
    return {
      success: false,
      message: `${g}학년 퍼센트 표가 아직 등록되지 않았습니다. 요청하기로 사진을 올려 주시면 관리자가 확인 후 등록합니다.`
    };
  }

  const items = Array.isArray(grades) ? grades : [];
  if (!items.length) {
    return { success: false, message: '과목 점수를 입력해 주세요.' };
  }

  const rows = gradeTable.rows;
  const results = items.map((item) => {
    const score = Number(item.score);
    const maxScore = Number(item.maxScore) || 100;
    const percent = scoreToPercent(score, maxScore, rows);
    return {
      subject: String(item.subject || '').trim() || '과목',
      score,
      maxScore,
      percent: percent ?? 0,
      ratio: maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0
    };
  });

  const averagePercent =
    Math.round((results.reduce((sum, r) => sum + r.percent, 0) / results.length) * 10) / 10;

  return {
    success: true,
    schoolCode: Number(schoolCode),
    schoolName: meta.schoolName || '',
    grade: g,
    mode: 'table',
    hasTable: true,
    ready: true,
    subjects: results,
    averagePercent,
    message: `${meta.schoolName} ${g}학년 퍼센트 표 기준으로 계산했습니다.`
  };
}

module.exports = {
  ensureSchoolTable,
  addPercentRequest,
  getSchoolTable,
  getTableInfo,
  getReadySchools,
  listAllSchoolTables,
  saveSchoolRows,
  calculatePercent,
  getReadyGrades,
  getPendingRequests
};
