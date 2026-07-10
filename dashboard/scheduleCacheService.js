const fs = require('fs');
const path = require('path');
const { FIXED_SCHOOLS, getSchoolByCode } = require('./fixedSchools');
const {
  fetchTimetable: weingFetchTimetable,
  listClasses: weingListClasses
} = require('./weingchickenClient');
const {
  fetchSchoolRaw,
  listClassesFromRaw,
  buildTimetableFromRaw,
  warmUpClient: comciWarmUp
} = require('./comciganClient');

const DATA_DIR = path.join(__dirname, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'schedule-cache');

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const CACHE_GRACE_MS = 2.5 * 60 * 60 * 1000;
const FETCH_DELAY_MS = 250;

let refreshInProgress = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cachePath(schoolCode) {
  return path.join(CACHE_DIR, `${Number(schoolCode)}.json`);
}

function classKey(grade, classNum) {
  return `${Number(grade)}-${Number(classNum)}`;
}

function readCacheFile(schoolCode) {
  const file = cachePath(schoolCode);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`[SCHEDULE-CACHE] failed to read ${file}:`, err.message);
    return null;
  }
}

function writeCacheFile(schoolCode, data) {
  ensureCacheDir();
  fs.writeFileSync(cachePath(schoolCode), JSON.stringify(data, null, 2), 'utf8');
}

function ageMs(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return Date.now() - at;
}

function isCacheFresh(fetchedAt) {
  return ageMs(fetchedAt) < CACHE_TTL_MS;
}

function isWithinGrace(fetchedAt) {
  return ageMs(fetchedAt) < CACHE_GRACE_MS;
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

function toSchedulePayload(result) {
  return {
    schedule: result.schedule || [],
    weekView: result.weekView || [],
    classTimes: result.classTimes || [],
    syncedAt: result.syncedAt || new Date().toISOString(),
    meta: result.meta || null
  };
}

async function fetchLiveSchedule(schoolMeta, grade, classNum) {
  const g = Number(grade);
  const c = Number(classNum);

  if (schoolMeta.provider === 'weingchicken') {
    return toSchedulePayload(await weingFetchTimetable(schoolMeta.weingId, g, c));
  }

  await comciWarmUp().catch(() => {});
  const { ctx, timetable, code } = await fetchSchoolRaw(schoolMeta.code);
  const built = buildTimetableFromRaw(timetable, ctx, code, g, c);
  const rawTimetable = comciganTimetableToRaw(built, g, c);
  const grid = convertToGrid(rawTimetable, g, c);

  return toSchedulePayload({
    schedule: grid.cells,
    weekView: grid.weekView,
    classTimes: [],
    syncedAt: new Date().toISOString(),
    meta: {
      lastUpdated: built.lastUpdated?.toISOString?.() || null,
      weekRange: built.date || null
    }
  });
}

function upsertClassCache(schoolMeta, grade, classNum, payload) {
  const code = Number(schoolMeta.code);
  const existing = readCacheFile(code) || {
    schoolCode: code,
    schoolName: schoolMeta.name,
    provider: schoolMeta.provider,
    fetchedAt: null,
    classes: {}
  };

  const key = classKey(grade, classNum);
  const syncedAt = payload.syncedAt || new Date().toISOString();

  existing.schoolName = schoolMeta.name;
  existing.provider = schoolMeta.provider;
  existing.classes[key] = {
    schedule: payload.schedule || [],
    weekView: payload.weekView || [],
    classTimes: payload.classTimes || [],
    syncedAt,
    meta: payload.meta || null
  };
  existing.fetchedAt = syncedAt;
  writeCacheFile(code, existing);
  return existing.classes[key];
}

async function discoverClasses(schoolMeta) {
  if (schoolMeta.provider === 'weingchicken') {
    return weingListClasses(schoolMeta.weingId);
  }

  await comciWarmUp().catch(() => {});
  const { timetable } = await fetchSchoolRaw(schoolMeta.code);
  const discovered = listClassesFromRaw(timetable);
  if (discovered.length) return discovered;

  const fallback = [];
  for (let grade = 1; grade <= 3; grade += 1) {
    for (let classNum = 1; classNum <= 15; classNum += 1) {
      fallback.push({ grade, classNum });
    }
  }
  return fallback;
}

async function refreshSchoolSchedule(schoolMeta) {
  const started = Date.now();
  const classes = {};
  let ok = 0;
  let failed = 0;
  const errors = [];

  console.log(`[SCHEDULE-CACHE] refresh start: ${schoolMeta.name} (${schoolMeta.code}) via ${schoolMeta.provider}`);

  let classList = [];
  try {
    classList = await discoverClasses(schoolMeta);
  } catch (err) {
    console.error(`[SCHEDULE-CACHE] class discovery failed for ${schoolMeta.name}:`, err.message);
    return {
      schoolCode: schoolMeta.code,
      schoolName: schoolMeta.name,
      ok: 0,
      failed: 1,
      classCount: 0,
      ms: Date.now() - started,
      error: err.message
    };
  }

  if (schoolMeta.provider === 'comcigan') {
    try {
      await comciWarmUp().catch(() => {});
      const { ctx, timetable, code } = await fetchSchoolRaw(schoolMeta.code);
      for (const entry of classList) {
        try {
          const built = buildTimetableFromRaw(timetable, ctx, code, entry.grade, entry.classNum);
          const rawTimetable = comciganTimetableToRaw(built, entry.grade, entry.classNum);
          const grid = convertToGrid(rawTimetable, entry.grade, entry.classNum);
          const payload = toSchedulePayload({
            schedule: grid.cells,
            weekView: grid.weekView,
            classTimes: [],
            syncedAt: new Date().toISOString(),
            meta: {
              lastUpdated: built.lastUpdated?.toISOString?.() || null,
              weekRange: built.date || null
            }
          });
          const key = classKey(entry.grade, entry.classNum);
          classes[key] = {
            schedule: payload.schedule,
            weekView: payload.weekView,
            classTimes: payload.classTimes,
            syncedAt: payload.syncedAt,
            meta: payload.meta
          };
          ok += 1;
        } catch (err) {
          failed += 1;
          errors.push(`${entry.grade}-${entry.classNum}: ${err.message}`);
        }
      }
    } catch (err) {
      failed += 1;
      errors.push(err.message);
    }
  } else {
    for (const entry of classList) {
      try {
        const payload = await fetchLiveSchedule(schoolMeta, entry.grade, entry.classNum);
        const key = classKey(entry.grade, entry.classNum);
        classes[key] = {
          schedule: payload.schedule,
          weekView: payload.weekView,
          classTimes: payload.classTimes,
          syncedAt: payload.syncedAt,
          meta: payload.meta
        };
        ok += 1;
      } catch (err) {
        failed += 1;
        errors.push(`${entry.grade}-${entry.classNum}: ${err.message}`);
      }
      await sleep(FETCH_DELAY_MS);
    }
  }

  const fetchedAt = new Date().toISOString();
  writeCacheFile(schoolMeta.code, {
    schoolCode: schoolMeta.code,
    schoolName: schoolMeta.name,
    provider: schoolMeta.provider,
    fetchedAt,
    classes
  });

  console.log(
    `[SCHEDULE-CACHE] refresh done: ${schoolMeta.name} ok=${ok} failed=${failed} classes=${Object.keys(classes).length} (${Date.now() - started}ms)`
  );

  return {
    schoolCode: schoolMeta.code,
    schoolName: schoolMeta.name,
    ok,
    failed,
    classCount: Object.keys(classes).length,
    ms: Date.now() - started,
    errors: errors.slice(0, 10)
  };
}

async function refreshAllSchoolSchedules() {
  if (refreshInProgress) {
    console.log('[SCHEDULE-CACHE] refresh already in progress, joining existing run');
    return refreshInProgress;
  }

  refreshInProgress = (async () => {
    const started = Date.now();
    ensureCacheDir();
    const results = [];

    for (const school of FIXED_SCHOOLS) {
      try {
        results.push(await refreshSchoolSchedule(school));
      } catch (err) {
        results.push({
          schoolCode: school.code,
          schoolName: school.name,
          ok: 0,
          failed: 1,
          classCount: 0,
          ms: 0,
          error: err.message
        });
      }
    }

    const summary = {
      success: true,
      fetchedAt: new Date().toISOString(),
      ms: Date.now() - started,
      schools: results
    };
    console.log(`[SCHEDULE-CACHE] all schools refreshed in ${summary.ms}ms`);
    return summary;
  })();

  try {
    return await refreshInProgress;
  } finally {
    refreshInProgress = null;
  }
}

async function getCachedSchedule(schoolCode, grade, classNum) {
  const code = Number(schoolCode);
  const g = Number(grade);
  const c = Number(classNum);
  const schoolMeta = getSchoolByCode(code);

  if (!schoolMeta) {
    throw new Error('지원하지 않는 학교입니다. 부곡·유락·동해·동래만 선택할 수 있습니다.');
  }
  if (!g || !c) {
    throw new Error('학교 코드, 학년, 반 정보가 필요합니다.');
  }

  const cache = readCacheFile(code);
  const key = classKey(g, c);
  const entry = cache?.classes?.[key];

  if (entry && isWithinGrace(entry.syncedAt || cache.fetchedAt)) {
    console.log(`[SCHEDULE-CACHE] hit ${schoolMeta.name} ${g}-${c} (age ${Math.round(ageMs(entry.syncedAt || cache.fetchedAt) / 1000)}s)`);
    return toSchedulePayload(entry);
  }

  console.log(`[SCHEDULE-CACHE] miss ${schoolMeta.name} ${g}-${c}, fetching live`);
  const live = await fetchLiveSchedule(schoolMeta, g, c);
  upsertClassCache(schoolMeta, g, c, live);
  return live;
}

function getCacheStatus() {
  ensureCacheDir();
  return FIXED_SCHOOLS.map((school) => {
    const cache = readCacheFile(school.code);
    const classKeys = cache?.classes ? Object.keys(cache.classes) : [];
    const fetchedAt = cache?.fetchedAt || null;
    return {
      schoolCode: school.code,
      schoolName: school.name,
      provider: school.provider,
      fetchedAt,
      fresh: isCacheFresh(fetchedAt),
      withinGrace: isWithinGrace(fetchedAt),
      ageMs: fetchedAt ? ageMs(fetchedAt) : null,
      classCount: classKeys.length,
      classes: classKeys.sort()
    };
  });
}

module.exports = {
  CACHE_TTL_MS,
  CACHE_GRACE_MS,
  CACHE_DIR,
  isCacheFresh,
  isWithinGrace,
  getCachedSchedule,
  refreshAllSchoolSchedules,
  refreshSchoolSchedule,
  getCacheStatus,
  fetchLiveSchedule
};
