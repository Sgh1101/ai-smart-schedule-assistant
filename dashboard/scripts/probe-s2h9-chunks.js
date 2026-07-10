async function main() {
  const res = await fetch('https://timetable.s2h9.dev/api/nope-does-not-exist', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await res.text();
  console.log('404 page len', html.length);

  const chunks = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\s)]+/g)].map((m) => m[0]))];
  console.log('assets', chunks.length);

  const apiHits = new Set();
  for (const chunk of chunks) {
    const url = chunk.startsWith('http') ? chunk : 'https://timetable.s2h9.dev' + chunk;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (!r.ok) {
      console.log('skip', chunk, r.status);
      continue;
    }
    const body = await r.text();
    const apis = [...body.matchAll(/\/api\/[a-zA-Z0-9_\-/?=&.]+/g)].map((m) => m[0]);
    apis.forEach((a) => apiHits.add(a));
    if (/search|timetable|school|keyword|Forbidden|grade|classNum/i.test(body)) {
      console.log('\n=== interesting chunk', chunk, 'size', body.length, '===');
      const snippets = [...body.matchAll(/.{0,40}(search|timetable|keyword|Forbidden|api\/).{0,80}/gi)].slice(0, 8);
      snippets.forEach((s) => console.log(s[0].replace(/\s+/g, ' ').slice(0, 160)));
    }
  }

  console.log('\n=== unique API strings ===');
  [...apiHits].sort().forEach((a) => console.log(a));
}

main().catch(console.error);
