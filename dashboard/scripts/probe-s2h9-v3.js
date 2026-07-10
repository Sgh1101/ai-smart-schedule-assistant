async function test(name, headers) {
  const r = await fetch('https://timetable.s2h9.dev/api/search?keyword=%EC%84%9C%EC%9A%B8', { headers });
  const text = await r.text();
  console.log(name, r.status, text.slice(0, 200));
}

async function main() {
  await test('basic', {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    Referer: 'https://timetable.s2h9.dev/',
    Origin: 'https://timetable.s2h9.dev',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    Priority: 'u=1, i'
  });

  await test('with cookie from robots', {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'application/json',
    Referer: 'https://timetable.s2h9.dev/'
  });

  const r2 = await fetch('https://s2h9.dev/', {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }
  });
  const html = await r2.text();
  console.log('s2h9.dev', r2.status, html.length);
  if (html.length > 0) {
    const links = [...html.matchAll(/href=\"([^\"]+)\"/g)].map((m) => m[1]).filter((l) => /github|timetable|api/i.test(l));
    console.log('links', links.slice(0, 20));
  }
}

main().catch(console.error);
