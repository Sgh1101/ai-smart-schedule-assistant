const { searchSchools, fetchUserSchedule } = require('../comciganService');

async function main() {
  console.log('=== 고정 학교 목록 ===');
  const all = await searchSchools('');
  console.log(all);

  const cases = [
    { code: 1688, name: '부곡여중', grade: 1, classNum: 1 },
    { code: 1952, name: '유락여중', grade: 1, classNum: 1 },
    { code: 12485, name: '동해중', grade: 1, classNum: 1 },
    { code: 1588, name: '동래중', grade: 1, classNum: 1 }
  ];

  for (const c of cases) {
    console.log(`\n=== ${c.name} ${c.grade}-${c.classNum} ===`);
    try {
      const result = await fetchUserSchedule(c);
      const subjects = (result.weekView || [])
        .flatMap((row) => row.slots.map((s) => s.subject))
        .filter(Boolean)
        .slice(0, 8);
      console.log('weekView rows', result.weekView?.length || 0);
      console.log('sample subjects', subjects);
    } catch (err) {
      console.error('FAIL', err.message);
      process.exitCode = 1;
    }
  }
}

main();
