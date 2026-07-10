const fs = require('fs');
const path = require('path');

async function main() {
  const res = await fetch('https://api.github.com/users/livingincoding/repos?per_page=100');
  const repos = await res.json();
  for (const r of repos) {
    const text = [r.name, r.description || '', r.homepage || ''].join(' ').toLowerCase();
    if (/timetable|comcigan|school|s2h9|remake|schedule|my-school/.test(text)) {
      console.log(`${r.name}\t${r.description || ''}\t${r.homepage || ''}\t${r.updated_at}`);
    }
  }

  const htmlRes = await fetch('https://s2h9.dev/', { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } });
  const html = await htmlRes.text();
  fs.writeFileSync(path.join(__dirname, 's2h9-home.html'), html);
  console.log('\ns2h9.dev saved', html.length);

  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  console.log('interesting hrefs:');
  hrefs.filter((h) => /github|timetable|api|comcigan|s2h9/i.test(h)).forEach((h) => console.log(' ', h));
}

main().catch(console.error);
