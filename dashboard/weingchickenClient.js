const { fetch } = require('./fetchUtil');

const BASE = 'https://school.weingchicken.com';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
};

const DAY_LABELS = ['월', '화', '수', '목', '금'];

async function fetchHtml(path) {
  const res = await fetch(`${BASE}${path}`, { headers: BROWSER_HEADERS });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`weingchicken ${res.status}: ${text.slice(0, 120)}`);
  }
  return text;
}

function parseClassMap(html, schoolId) {
  const classMap = new Map();

  // 유락여중 등: 학년별 <table> + <a href=".../classes/{id}/timetables">N반 (2026)</a>
  const gradeTableRegex =
    /<table[\s\S]*?<thead>[\s\S]*?(\d)\s*학년[\s\S]*?<\/thead>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/gi;

  let tableMatch;
  while ((tableMatch = gradeTableRegex.exec(html)) !== null) {
    const grade = Number(tableMatch[1]);
    const tbody = tableMatch[2] || '';
    const links = [
      ...tbody.matchAll(
        /classes\/(\d+)\/timetables[\s\S]*?>\s*(\d+)\s*반(?:\s*\(\d{4}\))?/gi
      )
    ];
    for (const match of links) {
      const classId = Number(match[1]);
      const classNum = Number(match[2]);
      if (grade > 0 && classNum > 0 && classId > 0) {
        classMap.set(`${grade}-${classNum}`, classId);
      }
    }
  }

  // 구형/다른 레이아웃 폴백
  if (classMap.size === 0) {
    const gradeBlocks = html.split(/>(\d)\s*학년<\/td>/i).slice(1);
    for (let i = 0; i < gradeBlocks.length; i += 2) {
      const grade = Number(gradeBlocks[i]);
      const block = gradeBlocks[i + 1] || '';
      const links = [
        ...block.matchAll(/classes\/(\d+)\/timetables[\s\S]*?>\s*(\d+)\s*반/gi)
      ];
      for (const match of links) {
        const classId = Number(match[1]);
        const classNum = Number(match[2]);
        if (grade > 0 && classNum > 0 && classId > 0) {
          classMap.set(`${grade}-${classNum}`, classId);
        }
      }
    }
  }

  if (classMap.size === 0) {
    throw new Error(`weingchicken school ${schoolId}: 학급 목록을 찾지 못했습니다.`);
  }

  return classMap;
}

function parseDayLabel(headerText) {
  const match = String(headerText || '').match(/\((.)\)/);
  return match ? match[1] : null;
}

function parseTimetableHtml(html) {
  const tables = [...html.matchAll(
    /<table[\s\S]*?<thead>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/gi
  )];

  const dayColumns = [];

  for (const table of tables) {
    const day = parseDayLabel(table[1]);
    if (!day || !DAY_LABELS.includes(day)) continue;

    const rows = [...table[2].matchAll(
      /<tr>[\s\S]*?<td[^>]*>\s*(\d+)\s*<\/td>[\s\S]*?<div>([^<]*)<\/div>/gi
    )];

    const slots = rows.map((row) => ({
      period: Number(row[1]),
      subject: String(row[2] || '').trim()
    }));

    if (slots.length) {
      dayColumns.push({ day, slots });
    }
  }

  if (!dayColumns.length) {
    throw new Error('weingchicken: 시간표 데이터가 비어 있습니다.');
  }

  const orderedDays = DAY_LABELS.map((day) => dayColumns.find((col) => col.day === day)).filter(Boolean);
  const maxPeriod = Math.max(...orderedDays.flatMap((col) => col.slots.map((s) => s.period)), 0);

  const weekView = [];
  const cells = [];
  cells.push({ label: '', subject: '', teacher: '', isHeader: true });
  DAY_LABELS.forEach((day) => cells.push({ label: day, subject: '', teacher: '', isHeader: true }));

  for (let period = 1; period <= maxPeriod; period += 1) {
    cells.push({ label: `${period}교시`, subject: '', teacher: '', isHeader: true });
    const dayRow = { period, slots: [] };

    for (const day of DAY_LABELS) {
      const column = orderedDays.find((col) => col.day === day);
      const slot = column?.slots.find((s) => s.period === period);
      const subject = slot?.subject || '';
      const label = subject || '-';

      cells.push({ label, subject, teacher: '', isHeader: false });
      dayRow.slots.push({ day, subject, teacher: '', classTime: period });
    }

    weekView.push(dayRow);
  }

  return {
    schedule: cells,
    weekView,
    classTimes: [],
    syncedAt: new Date().toISOString()
  };
}

async function listClasses(schoolId) {
  const sid = Number(schoolId);
  if (!sid) {
    throw new Error('weingchicken: 학교 ID가 필요합니다.');
  }

  const schoolHtml = await fetchHtml(`/schools/${sid}`);
  const classMap = parseClassMap(schoolHtml, sid);

  return [...classMap.entries()]
    .map(([key, classId]) => {
      const [grade, classNum] = key.split('-').map(Number);
      return { grade, classNum, classId };
    })
    .sort((a, b) => a.grade - b.grade || a.classNum - b.classNum);
}

async function fetchTimetable(schoolId, grade, classNum) {
  const g = Number(grade);
  const c = Number(classNum);
  const sid = Number(schoolId);

  if (!sid || !g || !c) {
    throw new Error('weingchicken: 학교 ID, 학년, 반이 필요합니다.');
  }

  const schoolHtml = await fetchHtml(`/schools/${sid}`);
  const classMap = parseClassMap(schoolHtml, sid);
  const classId = classMap.get(`${g}-${c}`);

  if (!classId) {
    throw new Error(`weingchicken: ${g}학년 ${c}반 정보를 찾지 못했습니다.`);
  }

  const timetableHtml = await fetchHtml(`/schools/${sid}/classes/${classId}/timetables`);
  return parseTimetableHtml(timetableHtml);
}

module.exports = {
  fetchTimetable,
  listClasses,
  parseClassMap,
  parseTimetableHtml
};
