const {
  fetchTimetable: comciFetchTimetable,
  warmUpClient: comciWarmUp
} = require('./comciganClient');
const { fetchTimetable: weingFetchTimetable } = require('./weingchickenClient');
const { getSchoolByCode, searchFixedSchools } = require('./fixedSchools');
const { getCachedSchedule } = require('./scheduleCacheService');

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 20_000;
const searchCache = new Map();
let warmUpPromise = null;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]);
}

function getCachedSearch(keyword) {
  const entry = searchCache.get(keyword);
  if (!entry) return null;
  if (Date.now() - entry.at > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(keyword);
    return null;
  }
  return entry.schools;
}

function setCachedSearch(keyword, schools) {
  searchCache.set(keyword, { schools, at: Date.now() });
}

async function searchSchools(keyword) {
  const trimmed = String(keyword || '').trim();
  const cacheKey = trimmed || '__all__';

  const cached = getCachedSearch(cacheKey);
  if (cached) {
    console.log(`[SCHOOL] keyword="${trimmed || '(전체)'}" cache hit (${cached.length} schools)`);
    return cached;
  }

  const schools = searchFixedSchools(trimmed);
  console.log(`[SCHOOL] keyword="${trimmed || '(전체)'}" found ${schools.length} schools`);
  setCachedSearch(cacheKey, schools);
  return schools;
}

function convertToGrid(rawTimetable, grade, classNum) {
  const days = ['월', '화', '수', '목', '금'];
  const weekData = rawTimetable?.[grade]?.[classNum];

  if (!weekData) {
    return { cells: [], periods: [], weekView: [] };
  }

  let maxPeriods = 0;
  weekData.forEach((daySlots) => {
    if (Array.isArray(daySlots)) {
      maxPeriods = Math.max(maxPeriods, daySlots.length);
    }
  });

  const cells = [];
  const weekView = [];

  cells.push({ label: '', subject: '', teacher: '', isHeader: true });
  days.forEach((day) => cells.push({ label: day, subject: '', teacher: '', isHeader: true }));

  for (let periodIndex = 0; periodIndex < maxPeriods; periodIndex += 1) {
    cells.push({
      label: `${periodIndex + 1}교시`,
      subject: '',
      teacher: '',
      isHeader: true
    });

    const dayRow = { period: periodIndex + 1, slots: [] };

    for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
      const slot = weekData[dayIndex]?.[periodIndex];
      const subject = slot?.subject || '';
      const teacher = slot?.teacher || '';
      const label = subject ? (teacher ? `${subject}\n(${teacher})` : subject) : '-';

      cells.push({ label, subject, teacher, isHeader: false });
      dayRow.slots.push({
        day: days[dayIndex],
        subject,
        teacher,
        classTime: slot?.classTime || periodIndex + 1
      });
    }

    weekView.push(dayRow);
  }

  return { cells, periods: Array.from({ length: maxPeriods }, (_, i) => `${i + 1}교시`), weekView };
}

function comciganTimetableToRaw(timetable, grade, classNum) {
  const days = ['월', '화', '수', '목', '금'];
  const weekData = (timetable?.timetable || []).map((daySlots, dayIndex) =>
    (daySlots || []).map((slot, periodIndex) => ({
      grade: Number(grade),
      class: Number(classNum),
      weekday: dayIndex,
      weekdayString: days[dayIndex] || '',
      classTime: periodIndex + 1,
      subject: slot?.subject || '',
      teacher: slot?.teacher || ''
    }))
  );

  return {
    [grade]: {
      [classNum]: weekData
    }
  };
}

async function fetchUserScheduleLive(schoolConfig) {
  const { code, grade, classNum } = schoolConfig;

  if (!code || !grade || !classNum) {
    throw new Error('학교 코드, 학년, 반 정보가 필요합니다.');
  }

  const g = Number(grade);
  const c = Number(classNum);
  const schoolCode = Number(code);
  const schoolMeta = getSchoolByCode(schoolCode);

  if (!schoolMeta) {
    throw new Error('지원하지 않는 학교입니다. 부곡·유락·동해·동래만 선택할 수 있습니다.');
  }

  console.log(`[SCHEDULE] live ${schoolMeta.name} ${g}학년 ${c}반 via ${schoolMeta.provider}`);

  if (schoolMeta.provider === 'weingchicken') {
    return weingFetchTimetable(schoolMeta.weingId, g, c);
  }

  await warmUpClient();

  const timetable = await withTimeout(
    comciFetchTimetable(schoolCode, g, c),
    SEARCH_TIMEOUT_MS,
    'Comcigan timetable'
  );

  const rawTimetable = comciganTimetableToRaw(timetable, g, c);
  const grid = convertToGrid(rawTimetable, g, c);

  return {
    schedule: grid.cells,
    weekView: grid.weekView,
    classTimes: [],
    syncedAt: new Date().toISOString(),
    meta: {
      lastUpdated: timetable.lastUpdated?.toISOString?.() || null,
      weekRange: timetable.date || null
    }
  };
}

async function fetchUserSchedule(schoolConfig) {
  const { code, grade, classNum } = schoolConfig;

  if (!code || !grade || !classNum) {
    throw new Error('학교 코드, 학년, 반 정보가 필요합니다.');
  }

  const schoolMeta = getSchoolByCode(Number(code));
  if (!schoolMeta) {
    throw new Error('지원하지 않는 학교입니다. 부곡·유락·동해·동래만 선택할 수 있습니다.');
  }

  console.log(`[SCHEDULE] ${schoolMeta.name} ${grade}학년 ${classNum}반 (cache-first)`);
  return getCachedSchedule(code, grade, classNum);
}

async function warmUpClient() {
  if (!warmUpPromise) {
    warmUpPromise = (async () => {
      try {
        await withTimeout(comciWarmUp(), SEARCH_TIMEOUT_MS, 'Comcigan warm-up');
        console.log('[COMCIGAN] client warmed up');
      } catch (err) {
        console.warn('[COMCIGAN] warm-up failed:', err.message);
        warmUpPromise = null;
      }
    })();
  }
  return warmUpPromise;
}

module.exports = {
  searchSchools,
  fetchUserSchedule,
  fetchUserScheduleLive,
  convertToGrid,
  warmUpClient
};
