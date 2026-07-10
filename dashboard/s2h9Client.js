const { fetch } = require('./fetchUtil');

const S2H9_BASE = 'https://timetable.s2h9.dev';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: `${S2H9_BASE}/`,
  Origin: S2H9_BASE,
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin'
};

function normalizeSchoolEntry(entry) {
  const code = Number(entry?.code ?? entry?.schoolCode ?? entry?.sc ?? 0);
  const name = String(entry?.name ?? entry?.schoolName ?? '').trim();
  const region = String(entry?.region ?? entry?.area ?? entry?.location ?? '').trim();
  if (!code || !name) return null;
  return { code, name, region };
}

function parseSearchPayload(payload) {
  if (!payload) return [];
  const list = Array.isArray(payload)
    ? payload
    : payload.schools || payload.data || payload.results || payload.items || [];
  if (!Array.isArray(list)) return [];
  return list.map(normalizeSchoolEntry).filter(Boolean);
}

async function s2h9Fetch(path) {
  const res = await fetch(`${S2H9_BASE}${path}`, { headers: BROWSER_HEADERS });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`s2h9 ${res.status}: ${text.slice(0, 120)}`);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('s2h9 returned non-JSON response');
  }
}

async function searchSchools(keyword) {
  const trimmed = String(keyword || '').trim();
  if (!trimmed) return [];
  const json = await s2h9Fetch(`/api/search?keyword=${encodeURIComponent(trimmed)}`);
  return parseSearchPayload(json);
}

async function fetchTimetable(schoolCode, grade, classNum) {
  const params = new URLSearchParams({
    code: String(schoolCode),
    grade: String(grade),
    classNum: String(classNum)
  });
  const paths = [
    `/api/timetable?${params}`,
    `/api/search?${params}`,
    `/api/timetable?code=${schoolCode}&grade=${grade}&class=${classNum}`
  ];

  let lastError = null;
  for (const path of paths) {
    try {
      return await s2h9Fetch(path);
    } catch (err) {
      lastError = err;
      if (err.status !== 404) break;
    }
  }
  throw lastError || new Error('s2h9 timetable fetch failed');
}

module.exports = {
  S2H9_BASE,
  searchSchools,
  fetchTimetable,
  parseSearchPayload,
  normalizeSchoolEntry
};
