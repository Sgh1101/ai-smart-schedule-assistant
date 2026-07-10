async function main() {
  const chunk = await fetch('https://timetable.s2h9.dev/_next/static/chunks/03~yq9q893hmn.js', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }).then((r) => r.text());

  console.log('chunk len', chunk.length);
  for (const needle of ['/api/search', 'Forbidden', 'keyword', 'timetable', 'schoolCode', 'x-api', 'Authorization', 'Bearer']) {
    const idx = chunk.indexOf(needle);
    if (idx >= 0) {
      console.log(`\n--- ${needle} @ ${idx} ---`);
      console.log(chunk.slice(Math.max(0, idx - 100), idx + 180).replace(/\s+/g, ' '));
    }
  }

  const allApi = [...new Set([...chunk.matchAll(/\/api\/[a-zA-Z0-9_\-/?=&.]+/g)].map((m) => m[0]))];
  console.log('\nall /api paths:', allApi.join('\n'));
}

main().catch(console.error);
