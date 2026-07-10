async function rscFetch(path, extraHeaders = {}) {
  const url = 'https://timetable.s2h9.dev' + path;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/x-component',
      RSC: '1',
      'Next-Router-State-Tree':
        '%5B%22%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D',
      'Next-Url': path,
      ...extraHeaders
    }
  });
  const text = await res.text();
  return { status: res.status, text, url };
}

async function main() {
  for (const path of ['/', '/?sc=58000', '/?keyword=%EC%84%9C%EC%9A%B8', '/?q=%EC%84%9C%EC%9A%B8']) {
    const { status, text, url } = await rscFetch(path);
    console.log('\nPATH', path, 'status', status, 'len', text.length);
    if (text.includes('서울') || text.includes('school') || text.includes('code')) {
      console.log('HIT keywords in response');
    }
    const lines = text.split('\n').filter((l) => /서울|search|school|code|keyword|api/i.test(l));
    lines.slice(0, 10).forEach((l) => console.log(l.slice(0, 300)));
    if (!lines.length) console.log(text.slice(0, 500));
  }

  const chunks = [
    '/_next/static/chunks/03~yq9q893hmn.js',
    '/_next/static/chunks/082i~bl_7mnyh.js',
    '/_next/static/chunks/0l3zwcvnt61hx.js'
  ];
  for (const c of chunks) {
    const js = await fetch('https://timetable.s2h9.dev' + c, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }).then((r) => r.text());
    if (js.includes('/api/search')) {
      console.log('\nFOUND /api/search in', c);
      const idx = js.indexOf('/api/search');
      console.log(js.slice(Math.max(0, idx - 120), idx + 200));
    }
    if (js.includes('keyword')) {
      const matches = [...js.matchAll(/keyword[^]{0,80}/g)].slice(0, 5);
      if (matches.some((m) => m[0].includes('api') || m[0].includes('search'))) {
        console.log('\nkeyword context in', c);
        matches.forEach((m) => console.log(m[0].slice(0, 120)));
      }
    }
  }
}

main().catch(console.error);
