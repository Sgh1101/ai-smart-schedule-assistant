/**
 * 노트북에서 실행 — 서버의 새 사진·영상을 바탕화면 폴더로 받고, 받은 뒤 서버에서 삭제합니다.
 *
 * 사용법:
 *   node scripts/local-pull-agent.js --server https://your-app.onrender.com
 *   node scripts/local-pull-agent.js --server http://localhost:3000 --interval 20
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const MASTER_FOLDER = 'OnDevice_관제_데이터';

function parseArgs(argv) {
  const args = {
    server: 'http://localhost:3000',
    intervalSec: 30,
    outDir: path.join(os.homedir(), 'Desktop', MASTER_FOLDER)
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--server' && argv[i + 1]) {
      args.server = argv[++i].replace(/\/$/, '');
    } else if ((arg === '--interval' || arg === '--interval-sec') && argv[i + 1]) {
      args.intervalSec = Math.max(10, parseInt(argv[++i], 10) || 30);
    } else if (arg === '--out' && argv[i + 1]) {
      args.outDir = path.resolve(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
로컬 풀 에이전트 — 서버 미디어를 노트북으로 받고 서버에서 삭제

  node scripts/local-pull-agent.js --server https://your-app.onrender.com
  node scripts/local-pull-agent.js --server http://localhost:3000 --interval 20
  node scripts/local-pull-agent.js --server https://your-app.onrender.com --out "D:\\백업"

옵션:
  --server URL       대시보드 서버 주소 (필수에 가깝습니다)
  --interval N       몇 초마다 확인할지 (기본 30)
  --out PATH         저장 폴더 (기본: 바탕화면/${MASTER_FOLDER})
`);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function confirmPulled(server, userKey, item) {
  const response = await fetch(
    `${server}/api/admin/users/${encodeURIComponent(userKey)}/confirm-pulled`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ category: item.category, filename: item.filename, size: item.size }]
      })
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`confirm failed HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function downloadFile(server, userKey, item, localPath) {
  const url =
    `${server}/api/admin/pull-file/${encodeURIComponent(userKey)}` +
    `?category=${encodeURIComponent(item.category)}` +
    `&filename=${encodeURIComponent(item.filename)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length !== item.size) {
    throw new Error(`size mismatch local=${buffer.length} expected=${item.size}`);
  }

  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buffer);
}

async function pullOnce(server, outDir) {
  const queue = await fetchJson(`${server}/api/admin/pull-queue`);
  const settings = await fetchJson(`${server}/api/admin/pull-sync/settings`);

  if (!settings.deleteAfterPull) {
    console.log('[pull-agent] 서버 설정: 다운로드 후 삭제가 꺼져 있습니다. 받기만 합니다.');
  }

  let downloaded = 0;
  let deleted = 0;
  let skipped = 0;

  for (const user of queue.users || []) {
    for (const item of user.items || []) {
      const localPath = path.join(outDir, user.userKey, item.category, item.filename);

      if (fs.existsSync(localPath)) {
        const localSize = fs.statSync(localPath).size;
        if (localSize === item.size) {
          if (settings.deleteAfterPull) {
            const result = await confirmPulled(server, user.userKey, item);
            if ((result.deleted || []).length > 0) {
              deleted += 1;
              console.log(`[pull-agent] 서버 삭제 ✓ ${user.userKey}/${item.category}/${item.filename}`);
            }
          } else {
            skipped += 1;
          }
          continue;
        }
      }

      try {
        await downloadFile(server, user.userKey, item, localPath);
        downloaded += 1;
        console.log(`[pull-agent] 다운로드 ✓ ${user.userKey}/${item.category}/${item.filename}`);

        if (settings.deleteAfterPull) {
          const result = await confirmPulled(server, user.userKey, item);
          if ((result.deleted || []).length > 0) {
            deleted += 1;
            console.log(`[pull-agent] 서버 삭제 ✓ ${user.userKey}/${item.category}/${item.filename}`);
          }
        }
      } catch (err) {
        console.warn(
          `[pull-agent] 실패 ${user.userKey}/${item.category}/${item.filename}:`,
          err.message
        );
      }
    }
  }

  if (downloaded || deleted) {
    console.log(`[pull-agent] 완료 — 다운로드 ${downloaded}건, 서버 삭제 ${deleted}건, 건너뜀 ${skipped}건`);
  } else if ((queue.totalItems || 0) === 0) {
    console.log('[pull-agent] 서버에 받을 미디어가 없습니다.');
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (!global.fetch) {
    console.error('Node.js 18 이상이 필요합니다 (fetch 내장).');
    process.exit(1);
  }

  fs.mkdirSync(args.outDir, { recursive: true });

  console.log('[pull-agent] 시작');
  console.log(`  서버: ${args.server}`);
  console.log(`  저장: ${args.outDir}`);
  console.log(`  주기: ${args.intervalSec}초`);
  console.log('  Ctrl+C 로 종료');

  while (true) {
    try {
      await pullOnce(args.server, args.outDir);
    } catch (err) {
      console.warn('[pull-agent] 라운드 실패:', err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, args.intervalSec * 1000));
  }
}

main().catch((err) => {
  console.error('[pull-agent] 치명적 오류:', err);
  process.exit(1);
});
