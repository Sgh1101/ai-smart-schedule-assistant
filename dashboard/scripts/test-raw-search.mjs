import fetch from '../node_modules/comcigan.js/node_modules/node-fetch/src/index.js';
import iconv from '../node_modules/comcigan.js/node_modules/iconv-lite/lib/index.js';

async function main() {
  const stuPage = iconv.decode(
    Buffer.from(await fetch('http://comci.net:4082/st').then((res) => res.arrayBuffer())),
    'euc-kr'
  );
  const schoolCodeEndpoint = stuPage.match(/function school_ra\(sc\){\$\.ajax\(\{ url:'\.\/[0-9]+\?[0-9]+l\'/g);
  const schoolCodeURI = schoolCodeEndpoint[0].match(/[0-9]+/g);
  const endpoint = `http://comci.net:4082/${schoolCodeURI[0]}`;
  const encoded = iconv
    .encode('서울', 'euc-kr')
    .toString('hex')
    .toUpperCase()
    .match(/[0-9A-Z]{2}/g)
    .map((x) => '%' + x)
    .join('');
  const schoolListRaw = await fetch(endpoint + `?${schoolCodeURI[1]}l${encoded}`).then((res) => res.text());
  const schools = JSON.parse(schoolListRaw.replace(/\0/g, '')).학교검색;
  console.log('sample raw', schools.slice(0, 3));
}

main().catch(console.error);
