async function tryFetch(label, url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  console.log(`${label}: ${res.status} ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
  return { res, text, cookies: res.headers.getSetCookie?.() || [] };
}

async function main() {
  const baseHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  const home = await tryFetch('GET /', 'https://timetable.s2h9.dev/', {
    headers: { ...baseHeaders, Accept: 'text/html' },
    redirect: 'follow'
  });

  const cookie = home.cookies.map((c) => c.split(';')[0]).join('; ');
  console.log('cookies:', cookie || '(none)');

  const searchHeaders = {
    ...baseHeaders,
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://timetable.s2h9.dev/',
    Origin: 'https://timetable.s2h9.dev',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    ...(cookie ? { Cookie: cookie } : {})
  };

  await tryFetch('GET /api/search', 'https://timetable.s2h9.dev/api/search?keyword=%EC%84%9C%EC%9A%B8', {
    headers: searchHeaders
  });

  await tryFetch('POST /api/search', 'https://timetable.s2h9.dev/api/search', {
    method: 'POST',
    headers: { ...searchHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: '서울' })
  });

  const timetablePaths = [
    '/api/timetable?code=58000&grade=1&class=1',
    '/api/timetable/58000?grade=1&class=1',
    '/api/schedule?code=58000&grade=1&class=1',
    '/api/school/58000/timetable?grade=1&class=1'
  ];

  for (const p of timetablePaths) {
    await tryFetch(`GET ${p}`, 'https://timetable.s2h9.dev' + p, { headers: searchHeaders });
  }
}

main().catch(console.error);
