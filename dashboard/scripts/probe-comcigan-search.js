#!/usr/bin/env node
const BASE = (process.env.BASE_URL || 'https://ai-smart-schedule-dashboard.onrender.com').replace(/\/$/, '');

async function probe(keyword, rounds = 10) {
  console.log(`\n--- keyword="${keyword}" ---`);
  for (let i = 1; i <= rounds; i++) {
    const t = Date.now();
    try {
      const url = `${BASE}/api/comcigan/search?keyword=${encodeURIComponent(keyword)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
      console.log(
        `${i}: HTTP ${res.status} ok=${res.ok} success=${json.success} count=${json.count} ${Date.now() - t}ms`,
        json.message || ''
      );
    } catch (e) {
      console.log(`${i}: ERROR ${e.message} ${Date.now() - t}ms`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function main() {
  console.log('BASE:', BASE);
  await probe('동해', 10);
  await probe('', 5);
  await probe('zzzznotexist999', 3);
}

main().catch(console.error);
