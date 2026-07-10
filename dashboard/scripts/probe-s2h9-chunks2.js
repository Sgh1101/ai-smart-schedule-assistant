async function main() {
  const res = await fetch('https://timetable.s2h9.dev/api/nope', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await res.text();
  const fs = require('fs');
  fs.writeFileSync('s2h9-404.html', html);

  const chunks = [...new Set([...html.matchAll(/\/_next\/static\/[^"'\\]+/g)].map((m) => m[0]))];
  console.log('chunks:', chunks.join('\n'));

  for (const chunk of chunks) {
    const url = 'https://timetable.s2h9.dev' + chunk.replace(/\\$/, '');
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) continue;
    const body = await r.text();
    const fname = chunk.split('/').pop().replace(/[^a-zA-Z0-9._~-]/g, '_');
    fs.writeFileSync(`chunk-${fname}`, body);
    if (/keyword|schoolCode|\/api\/search|timetable|classNum|grade|fetch\(\s*['"]\/api/i.test(body)) {
      console.log('HIT', chunk, body.length);
      const lines = body.split(/(?=\/api\/|keyword|schoolCode|fetch\()/);
      lines.filter((l) => /api|keyword|school|timetable|grade|class/i.test(l)).slice(0, 20).forEach((l) => {
        console.log(' ', l.slice(0, 200).replace(/\s+/g, ' '));
      });
    }
  }
}

main().catch(console.error);
