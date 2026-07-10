const { searchSchools, fetchTimetable } = require('../comciganClient');
const { searchSchools: apiSearch, fetchUserSchedule } = require('../comciganService');

async function main() {
  console.log('=== comciganClient.searchSchools("서울") ===');
  const schools = await searchSchools('서울');
  console.log(`found ${schools.length} schools`);
  console.log(JSON.stringify(schools.slice(0, 3), null, 2));

  const target = schools[0];
  if (!target) {
    throw new Error('No schools found for 서울');
  }

  console.log(`\n=== comciganClient.fetchTimetable(${target.code}, 1, 1) ===`);
  const timetable = await fetchTimetable(target.code, 1, 1);
  console.log('week range', timetable.date);
  console.log('monday first period', timetable.timetable[0]?.[0] || '(empty)');

  console.log('\n=== comciganService.searchSchools("서울") ===');
  const viaService = await apiSearch('서울');
  console.log(`service found ${viaService.length} schools`);

  console.log('\n=== comciganService.fetchUserSchedule (65159, 1, 1) ===');
  const schedule = await fetchUserSchedule({ code: 65159, grade: 1, classNum: 1 });
  console.log('weekView rows', schedule.weekView.length);
  schedule.weekView.slice(0, 2).forEach((row) => {
    console.log(
      `${row.period}교시`,
      row.slots.map((slot) => slot.subject || '-').join(' | ')
    );
  });
}

main().catch((err) => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
