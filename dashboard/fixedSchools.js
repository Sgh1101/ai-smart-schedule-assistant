/**
 * 앱에서 사용하는 고정 학교 목록 (4교)
 */
const FIXED_SCHOOLS = [
  {
    code: 1688,
    name: '부곡여자중학교',
    shortName: '부곡',
    region: '부산광역시',
    provider: 'weingchicken',
    weingId: 1688,
    sourceUrl: 'https://school.weingchicken.com/schools/1688',
    aliases: ['부곡여중', '부곡', '부곡여자중', '1688']
  },
  {
    code: 1952,
    name: '유락여자중학교',
    shortName: '유락',
    region: '부산광역시',
    provider: 'weingchicken',
    weingId: 1952,
    sourceUrl: 'https://school.weingchicken.com/schools/1952',
    aliases: ['유락여중', '유락', '유락여자중', '1952']
  },
  {
    code: 12485,
    name: '동해중학교',
    shortName: '동해',
    region: '부산광역시',
    provider: 'comcigan',
    comciganCode: 12485,
    sourceUrl: 'http://www.xn--s39aj90b0nb2xw6xh.kr/',
    aliases: ['동해중', '동해', '12485', '부산 동해중']
  },
  {
    code: 1588,
    name: '동래중학교',
    shortName: '동래',
    region: '부산광역시',
    provider: 'weingchicken',
    weingId: 1588,
    sourceUrl: 'https://school.weingchicken.com/schools/1588',
    aliases: ['동래중', '동래', '1588']
  }
];

function normalizeSchool(school) {
  return {
    code: school.code,
    name: school.name,
    region: school.region
  };
}

function getSchoolByCode(code) {
  const numeric = Number(code);
  return FIXED_SCHOOLS.find((s) => s.code === numeric) || null;
}

function searchFixedSchools(keyword) {
  const trimmed = String(keyword || '').trim();
  if (!trimmed) {
    return FIXED_SCHOOLS.map(normalizeSchool);
  }

  const lower = trimmed.toLowerCase();
  return FIXED_SCHOOLS.filter((school) => {
    const haystack = [school.name, school.region, String(school.code), ...(school.aliases || [])]
      .join(' ')
      .toLowerCase();
    return haystack.includes(lower) || lower.split(/\s+/).every((part) => haystack.includes(part));
  }).map(normalizeSchool);
}

module.exports = {
  FIXED_SCHOOLS,
  getSchoolByCode,
  searchFixedSchools,
  normalizeSchool
};
