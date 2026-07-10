const https = require('https');
const { fetchTimetable: s2h9Fetch } = require('../s2h9Client');
const { fetchTimetable: comciFetch } = require('../comciganClient');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

async function main() {
  console.log('=== comcigan 12485 ===');
  try {
    const t = await comciFetch(12485, 1, 1);
    console.log('ok', t.date, t.timetable?.[0]?.[0]);
  } catch (e) {
    console.log('fail', e.message);
  }

  console.log('\n=== s2h9 12485 ===');
  try {
    const t = await s2h9Fetch(12485, 1, 1);
    console.log('ok keys', Object.keys(t));
    console.log(JSON.stringify(t).slice(0, 400));
  } catch (e) {
    console.log('fail', e.message);
  }

  for (const id of [1952, 1688]) {
    console.log(`\n=== weingchicken school ${id} ===`);
    const page = await get(`https://school.weingchicken.com/schools/${id}`);
    console.log('page status', page.status, 'len', page.body.length);
    const hits = ['timetable', 'neis', '/api/', 'schedule', 'classTimetable', 'schoolCode'];
    for (const h of hits) {
      const i = page.body.indexOf(h);
      if (i >= 0) {
        console.log(
          h,
          page.body
            .slice(Math.max(0, i - 60), i + 180)
            .replace(/\s+/g, ' ')
            .slice(0, 220)
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
