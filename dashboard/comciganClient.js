const iconv = require('iconv-lite');
const { fetch: httpFetch } = require('./fetchUtil');

const COMCIGAN_PUBLIC_URL = 'http://www.xn--s39aj90b0nb2xw6xh.kr/';

const COMCI_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: COMCIGAN_PUBLIC_URL,
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'X-Requested-With': 'XMLHttpRequest'
};

const COMCI_BASES = ['http://comci.net:4082', 'http://comci.kr:4082'];
const ST_PAGE_TTL_MS = 5 * 60 * 1000;

let cachedStContext = null;
let cachedStContextAt = 0;

function sanitizeJson(raw) {
  let text = typeof raw === 'string' ? raw : String(raw ?? '');
  text = text.replace(/\0/g, '').trim();

  if (!text) {
    throw new Error('Empty comcigan response');
  }

  const jsonpMatch = text.match(/^[a-zA-Z_$][\w$]*\s*\(([\s\S]*)\)\s*;?\s*$/);
  if (jsonpMatch) {
    text = jsonpMatch[1].trim();
  } else if (text.startsWith('(') && text.endsWith(')')) {
    text = text.slice(1, -1).trim();
  }

  return JSON.parse(text);
}

function encodeKeywordEucKr(keyword) {
  const hex = iconv.encode(String(keyword || ''), 'euc-kr').toString('hex').toUpperCase();
  const pairs = hex.match(/[0-9A-Z]{2}/g);
  if (!pairs?.length) {
    return '';
  }
  return pairs.map((pair) => `%${pair}`).join('');
}

function parseStPage(stuPage) {
  const schoolCodeEndpoint = stuPage.match(/function school_ra\(sc\){\$\.ajax\(\{ url:'\.\/[0-9]+\?[0-9]+l\'/g);
  if (!schoolCodeEndpoint) {
    throw new Error('컴시간 검색 엔드포인트를 찾을 수 없습니다.');
  }

  const schoolCodeURI = schoolCodeEndpoint[0].match(/[0-9]+/g);
  if (!schoolCodeURI || schoolCodeURI.length !== 2) {
    throw new Error('컴시간 검색 URI 파싱에 실패했습니다.');
  }

  const scData = stuPage.match(/sc_data\('[0-9]+_',sc,[0-1],'[0-9]'\)/g);
  if (!scData) {
    throw new Error('컴시간 시간표 엔드포인트를 찾을 수 없습니다.');
  }

  const scDataCode = scData[0].match(/[0-9]+_/g);
  if (!scDataCode) {
    throw new Error('컴시간 sc_data 코드 파싱에 실패했습니다.');
  }

  const updatedTimeNameCode = stuPage.match(/\$\('#수정일'\)\.text\('수정일: '\+H시간표\.자료[0-9]+\);/g);
  const updatedTimeName = updatedTimeNameCode?.[0]?.match(/[0-9]+/g);
  if (!updatedTimeName) {
    throw new Error('컴시간 수정일 코드 파싱에 실패했습니다.');
  }

  const lastDataNameCode = stuPage.match(/원자료=Q자료\(자료\.자료[0-9]+\[학년\]\[반\]\[요일\]\[교시\]\);/g);
  const lastDataName = lastDataNameCode?.[0]?.match(/[0-9]+/g);
  if (!lastDataName) {
    throw new Error('컴시간 원자료 코드 파싱에 실패했습니다.');
  }

  const currDataNameCode = stuPage.match(/일일자료=Q자료\(자료\.자료[0-9]+\[학년\]\[반\]\[요일\]\[교시\]\);/g);
  const currDataName = currDataNameCode?.[0]?.match(/[0-9]+/g);
  if (!currDataName) {
    throw new Error('컴시간 일일자료 코드 파싱에 실패했습니다.');
  }

  const subjArrNameCode = stuPage.match(/자료\.자료[0-9]+\[sb\]/g);
  const subjArrName = subjArrNameCode?.[0]?.match(/[0-9]+/g);
  if (!subjArrName) {
    throw new Error('컴시간 과목 코드 파싱에 실패했습니다.');
  }

  const tcrArrNameCode = stuPage.match(/자료\.자료[0-9]+\[th\]/g);
  const tcrArrName = tcrArrNameCode?.[0]?.match(/[0-9]+/g);
  if (!tcrArrName) {
    throw new Error('컴시간 교사 코드 파싱에 실패했습니다.');
  }

  return {
    endpointPath: `/${schoolCodeURI[0]}`,
    queryPrefix: `${schoolCodeURI[1]}l`,
    scDataPrefix: scDataCode[0],
    updatedTimeName: updatedTimeName[0],
    lastDataName: lastDataName[0],
    currDataName: currDataName[0],
    subjArrName: subjArrName[0],
    tcrArrName: tcrArrName[0]
  };
}

async function comciFetch(pathOrUrl, options = {}) {
  const headers = { ...COMCI_HEADERS, ...(options.headers || {}) };
  const fetchOptions = { ...options, headers };
  let lastError = null;

  const urls = pathOrUrl.startsWith('http')
    ? [pathOrUrl]
    : COMCI_BASES.map((base) => `${base}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`);

  for (const url of urls) {
    try {
      const res = await httpFetch(url, fetchOptions);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return { res, url, base: url.replace(/\/[^/]*$/, '').replace(/\?.*$/, '') };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('comcigan request failed');
}

async function fetchStContext(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedStContext && now - cachedStContextAt < ST_PAGE_TTL_MS) {
    return cachedStContext;
  }

  const { res, base } = await comciFetch('/st');
  const buffer = Buffer.from(await res.arrayBuffer());
  const stuPage = iconv.decode(buffer, 'euc-kr');
  const parsed = parseStPage(stuPage);

  cachedStContext = {
    stuPage,
    base,
    ...parsed
  };
  cachedStContextAt = now;
  return cachedStContext;
}

async function searchSchools(keyword) {
  const trimmed = String(keyword || '').trim();
  if (!trimmed) {
    return [];
  }

  const ctx = await fetchStContext();
  const encoded = encodeKeywordEucKr(trimmed);
  const searchUrl = `${ctx.base}${ctx.endpointPath}?${ctx.queryPrefix}${encoded}`;
  const { res } = await comciFetch(searchUrl);
  const rawText = await res.text();
  const payload = sanitizeJson(rawText);
  const rows = payload?.학교검색;

  if (!Array.isArray(rows)) {
    throw new Error('학교 검색 응답 형식이 올바르지 않습니다.');
  }

  return rows
    .filter((row) => row[3] !== 0)
    .map((row) => ({
      code: Number(row[3]),
      name: String(row[2] || '').trim(),
      region: String(row[1] || '').trim()
    }))
    .filter((school) => school.code > 0 && school.name);
}

function buildTimetableFromRaw(timetable, ctx, schoolCode, grade, classNum) {
  const g = Number(grade);
  const c = Number(classNum);

  if (!timetable || Object.keys(timetable).length === 0) {
    throw new Error('시간표 데이터가 비어 있습니다.');
  }
  if (g > timetable.학급수.length - 1) {
    throw new Error(`학년 ${g}은(는) 이 학교에 존재하지 않습니다.`);
  }
  if (c > timetable.학급수[g] - timetable.가상학급수[g]) {
    throw new Error(`${g}학년 ${c}반은 존재하지 않습니다.`);
  }

  const separator = timetable.분리;
  const timeData = timetable[`자료${ctx.currDataName}`][g][c];
  const lastTimeData = timetable[`자료${ctx.lastDataName}`][g][c];

  const timeDataArr = [];
  for (let i = 0; i < timeData[0]; i += 1) {
    timeDataArr.push(timeData[i + 1].slice(1));
  }

  const lastTimeDataArr = [];
  for (let i = 0; i < lastTimeData[0]; i += 1) {
    lastTimeDataArr.push(lastTimeData[i + 1].slice(1));
  }

  const date = timetable.일자자료[0][1].split(' ~ ').map((part) => part.split('-').map((n) => parseInt(n, 10)));
  date[0][0] += 2000;
  date[0][1] -= 1;
  date[1][0] += 2000;
  date[1][1] -= 1;
  date[1][2] -= 1;

  const realDate = [
    new Date(date[0][0], date[0][1], date[0][2]),
    new Date(date[1][0], date[1][1], date[1][2])
  ];

  const result = {
    lastUpdated: new Date(String(timetable[`자료${ctx.updatedTimeName}`]).replace(' ', 'T') + '.000+0900'),
    date: {
      start: [realDate[0].getFullYear(), realDate[0].getMonth() + 1, realDate[0].getDate()],
      end: [realDate[1].getFullYear(), realDate[1].getMonth() + 1, realDate[1].getDate()]
    },
    timetable: []
  };

  for (let dayIndex = 0; dayIndex < timeDataArr.length; dayIndex += 1) {
    const daySlots = [];
    for (let periodIndex = 0; periodIndex < timeDataArr[dayIndex].length; periodIndex += 1) {
      const cellCode = timeDataArr[dayIndex][periodIndex];
      if (cellCode === 0) continue;

      daySlots.push({
        subject: timetable[`자료${ctx.subjArrName}`][Math.floor(cellCode / separator)],
        teacher: timetable[`자료${ctx.tcrArrName}`][cellCode % separator],
        prevData:
          cellCode !== lastTimeDataArr[dayIndex][periodIndex] && lastTimeDataArr[dayIndex][periodIndex] !== 0
            ? {
                subject:
                  timetable[`자료${ctx.subjArrName}`][
                    Math.floor(lastTimeDataArr[dayIndex][periodIndex] / separator)
                  ],
                teacher:
                  timetable[`자료${ctx.tcrArrName}`][lastTimeDataArr[dayIndex][periodIndex] % separator]
              }
            : undefined
      });
    }

    if (timeDataArr[dayIndex].length < lastTimeDataArr[dayIndex].length) {
      for (
        let periodIndex = timeDataArr[dayIndex].length;
        periodIndex < lastTimeDataArr[dayIndex].length;
        periodIndex += 1
      ) {
        if (lastTimeDataArr[dayIndex][periodIndex] === 0) continue;
        daySlots.push({
          subject: '',
          teacher: '',
          prevData: {
            subject:
              timetable[`자료${ctx.subjArrName}`][
                Math.floor(lastTimeDataArr[dayIndex][periodIndex] / separator)
              ],
            teacher:
              timetable[`자료${ctx.tcrArrName}`][lastTimeDataArr[dayIndex][periodIndex] % separator]
          }
        });
      }
    }

    result.timetable.push(daySlots);
  }

  return result;
}

async function fetchSchoolRaw(schoolCode) {
  const code = Number(schoolCode);
  if (!code) {
    throw new Error('학교 코드가 필요합니다.');
  }

  const ctx = await fetchStContext();
  const query = Buffer.from(`${ctx.scDataPrefix}${code}_0_1`).toString('base64');
  const timetableUrl = `${ctx.base}${ctx.endpointPath}?${query}`;
  const { res } = await comciFetch(timetableUrl);
  const rawText = await res.text();
  const timetable = sanitizeJson(rawText);
  return { ctx, timetable, code };
}

function listClassesFromRaw(timetable) {
  const classCounts = timetable?.학급수;
  if (!Array.isArray(classCounts) || classCounts.length < 2) {
    return [];
  }

  const virtualCounts = Array.isArray(timetable.가상학급수) ? timetable.가상학급수 : [];
  const classes = [];

  for (let grade = 1; grade < classCounts.length; grade += 1) {
    const total = Number(classCounts[grade]) || 0;
    const virtual = Number(virtualCounts[grade]) || 0;
    const realCount = Math.max(0, total - virtual);
    for (let classNum = 1; classNum <= realCount; classNum += 1) {
      classes.push({ grade, classNum });
    }
  }

  return classes;
}

async function listClasses(schoolCode) {
  const { timetable } = await fetchSchoolRaw(schoolCode);
  return listClassesFromRaw(timetable);
}

async function fetchTimetable(schoolCode, grade, classNum) {
  const code = Number(schoolCode);
  const g = Number(grade);
  const c = Number(classNum);

  if (!code || !g || !c) {
    throw new Error('학교 코드, 학년, 반 정보가 필요합니다.');
  }

  const { ctx, timetable } = await fetchSchoolRaw(code);
  const built = buildTimetableFromRaw(timetable, ctx, code, g, c);
  console.log(
    `[COMCIGAN] 일일자료 school=${code} ${g}-${c} ` +
      `week=${built.date?.start?.join('-')}~${built.date?.end?.join('-')} ` +
      `source=${COMCIGAN_PUBLIC_URL}`
  );
  return built;
}

async function warmUpClient() {
  await fetchStContext(true);
}

module.exports = {
  COMCIGAN_PUBLIC_URL,
  COMCI_HEADERS,
  COMCI_BASES,
  sanitizeJson,
  encodeKeywordEucKr,
  searchSchools,
  fetchTimetable,
  fetchSchoolRaw,
  listClasses,
  listClassesFromRaw,
  buildTimetableFromRaw,
  fetchStContext,
  warmUpClient
};
