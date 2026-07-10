const { fetchUserSchedule } = require('../comciganService');
const { FIXED_SCHOOLS } = require('../fixedSchools');

const GRADE = 3;
const CLASS_NUM = 3;

function summarizeWeekView(weekView) {
  const days = ['월', '화', '수', '목', '금'];
  return days.map((day) => {
    const subjects = [];
    for (const row of weekView || []) {
      const slot = row.slots?.find((s) => s.day === day);
      if (slot?.subject) subjects.push(`${row.period}:${slot.subject}`);
    }
    return { day, count: subjects.length, preview: subjects.slice(0, 3).join(', ') || '(비어 있음)' };
  });
}

function hasRealSubjects(weekView) {
  if (!weekView?.length) return false;
  return weekView.some((row) =>
    row.slots?.some((s) => {
      const subj = String(s.subject || '').trim();
      return subj && subj !== '-';
    })
  );
}

async function testSchool(school) {
  const label = `${school.shortName || school.name} (${school.code})`;
  const started = Date.now();
  try {
    const result = await fetchUserSchedule({
      code: school.code,
      grade: GRADE,
      classNum: CLASS_NUM
    });
    const ms = Date.now() - started;
    const rows = result.weekView?.length || 0;
    const ok = rows > 0 && hasRealSubjects(result.weekView);
    const summary = summarizeWeekView(result.weekView);
    return {
      label,
      ok,
      ms,
      rows,
      provider: school.provider,
      summary,
      error: ok ? null : '시간표가 비어 있거나 과목이 없습니다.'
    };
  } catch (err) {
    return {
      label,
      ok: false,
      ms: Date.now() - started,
      rows: 0,
      provider: school.provider,
      summary: [],
      error: err.message
    };
  }
}

async function main() {
  console.log(`=== ${GRADE}학년 ${CLASS_NUM}반 시간표 테스트 ===\n`);
  const results = [];
  for (const school of FIXED_SCHOOLS) {
    const r = await testSchool(school);
    results.push(r);
    console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.label} | ${r.provider} | ${r.rows}교시 | ${r.ms}ms`);
    if (r.error) console.log(`       오류: ${r.error}`);
    for (const day of r.summary) {
      console.log(`       ${day.day}: ${day.preview}`);
    }
    console.log('');
  }

  const pass = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`결과: ${pass}/${total} 성공`);
  if (pass !== total) process.exitCode = 1;
}

main();
