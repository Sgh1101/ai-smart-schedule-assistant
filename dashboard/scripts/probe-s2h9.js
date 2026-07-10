async function main() {
  const sitemap = await fetch('https://timetable.s2h9.dev/sitemap.xml');
  console.log('=== sitemap ===');
  console.log(await sitemap.text());

  const htmlRes = await fetch('https://timetable.s2h9.dev/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html'
    }
  });
  const html = await htmlRes.text();
  console.log('HTML status', htmlRes.status, 'len', html.length);

  const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) => m[0]);
  console.log('chunks found', chunks.length);

  for (const chunk of chunks.slice(0, 8)) {
    const url = 'https://timetable.s2h9.dev' + chunk;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const js = await r.text();
    const apis = [...js.matchAll(/\/api\/[a-zA-Z0-9_\-/?=&]+/g)].map((m) => m[0]);
    if (apis.length) {
      console.log('\n---', chunk, '---');
      console.log([...new Set(apis)].join('\n'));
    }
  }

  const searchRes = await fetch('https://timetable.s2h9.dev/api/search?keyword=%EC%84%9C%EC%9A%B8', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json',
      Referer: 'https://timetable.s2h9.dev/',
      Origin: 'https://timetable.s2h9.dev'
    }
  });
  console.log('\n=== search ===');
  console.log(searchRes.status, await searchRes.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
