const { fetchUserSchedule } = require('../comciganService');

(async () => {
  const data = await fetchUserSchedule({ code: 65159, grade: 1, classNum: 1 });
  console.log('OK periods', data.weekView.length);
  data.weekView.slice(0, 3).forEach((row) => {
    console.log(
      row.period + '교시',
      row.slots.map((s) => (s.subject ? s.subject : '-')).join(' | ')
    );
  });
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
