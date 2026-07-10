#!/usr/bin/env node
/** 부산 동해중(12485) — 컴시간알리미 일일자료(하루하루) 검증 */
const { searchSchools, fetchTimetable, listClasses } = require('../comciganClient');
const { fetchUserScheduleLive } = require('../comciganService');
const { getSchoolByCode } = require('../fixedSchools');

const DONGHAE_CODE = 12485;

async function main() {
  const meta = getSchoolByCode(DONGHAE_CODE);
  console.log('학교:', meta.name, meta.region, 'provider=', meta.provider);
  console.log('소스:', meta.sourceUrl);

  const found = await searchSchools('동해');
  const busan = found.find((s) => s.code === DONGHAE_CODE && s.region.includes('부산'));
  if (!busan) throw new Error('부산 동해중 검색 실패');
  console.log('컴시간 검색:', busan);

  const classes = await listClasses(DONGHAE_CODE);
  console.log(`학급 수: ${classes.length} (예: ${classes[0].grade}-${classes[0].classNum})`);

  const cases = [
    [1, 1],
    [3, 3]
  ];
  for (const [grade, classNum] of cases) {
    const daily = await fetchTimetable(DONGHAE_CODE, grade, classNum);
    const range = daily.date;
    const days = ['월', '화', '수', '목', '금'];
    console.log(`\n=== ${grade}학년 ${classNum}반 일일자료 ===`);
    console.log('기간:', `${range.start.join('.')} ~ ${range.end.join('.')}`);
    console.log('수정:', daily.lastUpdated.toISOString());
    daily.timetable.forEach((slots, i) => {
      console.log(
        days[i],
        slots.map((s) => s.subject || '-').join(' | ')
      );
    });

    const svc = await fetchUserScheduleLive({ code: DONGHAE_CODE, grade, classNum });
    const count = svc.weekView.flatMap((r) => r.slots).filter((s) => s.subject).length;
    console.log(`앱 그리드: ${svc.weekView.length}교시, 과목 ${count}칸`);
  }
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
