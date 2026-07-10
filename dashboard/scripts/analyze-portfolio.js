async function main() {
  const res = await fetch('https://api.github.com/users/livingincoding/repos?per_page=100&sort=updated');
  const repos = await res.json();
  repos.slice(0, 20).forEach((r) => console.log(r.updated_at, r.name, r.description || ''));

  const page = await fetch('https://s2h9.dev/_next/static/chunks/app/page-b412d074baf3f881.js').then((r) => r.text());
  console.log('\npage chunk len', page.length);
  const timetable = [...page.matchAll(/timetable[^"'\\]{0,100}/gi)].map((m) => m[0]);
  timetable.forEach((t) => console.log('timetable ref:', t.slice(0, 120)));

  const urls = [...page.matchAll(/https?:\/\/[^"'\\]+/g)].map((m) => m[0]);
  [...new Set(urls)].filter((u) => /timetable|s2h9|github|comcigan/i.test(u)).forEach((u) => console.log('url:', u));
}

main().catch(console.error);
