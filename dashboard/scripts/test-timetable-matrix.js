const { fetchUserSchedule } = require('../comciganService');
const { FIXED_SCHOOLS } = require('../fixedSchools');

const CASES = [
  { grade: 1, classNum: 1, label: '1학년 1반' },
  { grade: 2, classNum: 5, label: '2학년 5반' },
  { grade: 3, classNum: 3, label: '3학년 3반' }
];

function hasRealSubjects(weekView) {
  if (!weekView?.length) return false;
  return weekView.some((row) =>
    row.slots?.some((s) => {
      const subj = String(s.subject || '').trim();
      return subj && subj !== '-';
    })
  );
}

function dayPreview(weekView) {
  const days = ['월', '화', '수', '목', '금'];
  return days
    .map((day) => {
      const first = (weekView || [])
        .map((row) => row.slots?.find((s) => s.day === day)?.subject?.trim())
        .find((s) => s);
      return `${day}:${first || '-'}`;
    })
    .join(' | ');
}

async function testOne(school, grade, classNum) {
  const started = Date.now();
  try {
    const result = await fetchUserSchedule({ code: school.code, grade, classNum });
    const ok = (result.weekView?.length || 0) > 0 && hasRealSubjects(result.weekView);
    return {
      ok,
      ms: Date.now() - started,
      rows: result.weekView?.length || 0,
      preview: dayPreview(result.weekView),
      error: ok ? null : '비어 있음'
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      rows: 0,
      preview: '',
      error: err.message
    };
  }
}

async function main() {
  console.log('=== 학교별 학년·반 시간표 테스트 ===\n');
  let pass = 0;
  let total = 0;
  const failures = [];

  for (const school of FIXED_SCHOOLS) {
    const short = school.shortName || school.name;
    console.log(`[${short}] code=${school.code} provider=${school.provider}`);
    for (const c of CASES) {
      total += 1;
      const r = await testOne(school, c.grade, c.classNum);
      if (r.ok) pass += 1;
      else failures.push({ school: short, case: c.label, error: r.error });

      const status = r.ok ? 'PASS' : 'FAIL';
      console.log(`  ${status} ${c.label} | ${r.rows}교시 | ${r.ms}ms`);
      if (r.ok) console.log(`        ${r.preview}`);
      else console.log(`        오류: ${r.error}`);
    }
    console.log('');
  }

  console.log(`총 결과: ${pass}/${total} 성공`);
  if (failures.length) {
    console.log('\n실패 목록:');
    for (const f of failures) {
      console.log(`- ${f.school} ${f.case}: ${f.error}`);
    }
    process.exitCode = 1;
  }
}

main();
