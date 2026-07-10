const paths = [
  '/api/search?keyword=%EC%84%9C%EC%9A%B8',
  '/api/comcigan?type=search&keyword=%EC%84%9C%EC%9A%B8',
  '/api/comcigan/search?keyword=%EC%84%9C%EC%9A%B8',
  '/api/timetable?code=20449&grade=1&class=1',
  '/api/timetable?code=20449&grade=1&classNum=1',
  '/api/comcigan?type=timetable&code=20449&grade=1&classNum=1',
  '/api/schedule?code=20449&grade=1&classNum=1',
  '/api/data?code=20449&grade=1&class=1'
];

async function main() {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://timetable.s2h9.dev/',
    Origin: 'https://timetable.s2h9.dev'
  };

  for (const p of paths) {
    const r = await fetch('https://timetable.s2h9.dev' + p, { headers });
    const t = await r.text();
    const preview = t.startsWith('<!DOCTYPE') ? '(html ' + t.length + ')' : t.slice(0, 120);
    console.log(r.status, p, preview);
  }
}

main().catch(console.error);
