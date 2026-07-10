async function tryReq(label, url, options = {}) {
  const res = await fetch(url, options);
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  console.log(`\n=== ${label} ===`);
  console.log('status', res.status, 'type', ct, 'len', text.length);
  console.log(text.slice(0, 400).replace(/\s+/g, ' '));
}

async function main() {
  const base = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9'
  };

  await tryReq('GET /?keyword=서울', 'https://timetable.s2h9.dev/?keyword=%EC%84%9C%EC%9A%B8', {
    headers: { ...base, Accept: 'text/html' }
  });

  await tryReq('RSC prefetch /', 'https://timetable.s2h9.dev/', {
    headers: {
      ...base,
      Accept: '*/*',
      RSC: '1',
      'Next-Router-Prefetch': '1',
      'Next-Url': '/'
    }
  });

  await tryReq('RSC search page', 'https://timetable.s2h9.dev/?keyword=%EC%84%9C%EC%9A%B8', {
    headers: {
      ...base,
      Accept: 'text/x-component',
      RSC: '1',
      'Next-Router-State-Tree': encodeURIComponent('["",{"children":["__PAGE__?{"keyword":"서울"},{}]}]')
    }
  });

  await tryReq('api/search accept rsc', 'https://timetable.s2h9.dev/api/search?keyword=%EC%84%9C%EC%9A%B8', {
    headers: {
      ...base,
      Accept: 'text/x-component',
      Referer: 'https://timetable.s2h9.dev/',
      RSC: '1'
    }
  });
}

main().catch(console.error);
