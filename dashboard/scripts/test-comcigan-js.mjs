import comcigan from '../node_modules/comcigan.js/dist/index.js';

async function main() {
  console.log('searchSchool...');
  const schools = await comcigan.searchSchool('서울');
  console.log('found', schools.length);
  console.log(JSON.stringify(schools.slice(0, 3), null, 2));

  if (schools[0]) {
    console.log('\ngetTimetable for', schools[0].name, schools[0].code);
    const tt = await comcigan.getTimetable(schools[0].code, 1, 1);
    console.log('week', tt.date);
    console.log('mon 1st', tt.timetable[0][0]);
  }
}

main().catch((e) => console.error('FAIL', e.message));
