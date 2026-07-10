const { parseClassMap, fetchTimetable } = require('../weingchickenClient');

const SAMPLES = [
  {
    schoolId: 1952,
    name: '유락여중',
    html: `
<table><thead><tr><td>1학년</td></tr></thead><tbody>
<a href="https://school.weingchicken.com/schools/1952/classes/327099/timetables">1반 (2026)</a>
<a href="https://school.weingchicken.com/schools/1952/classes/327119/timetables">3반 (2026)</a>
</tbody></table>
<table><thead><tr><td>3학년</td></tr></thead><tbody>
<a href="https://school.weingchicken.com/schools/1952/classes/327119/timetables">3반 (2026)</a>
</tbody></table>`,
    checks: [
      ['1-1', 327099],
      ['3-3', 327119]
    ],
    live: { grade: 3, classNum: 3, minSubjects: 20 }
  },
  {
    schoolId: 1688,
    name: '부곡여중',
    html: `
<table><thead><tr><td class="bg-success text-white">1학년</td></tr></thead><tbody>
<a href="https://school.weingchicken.com/schools/1688/classes/462870/timetables" class="text-body">1반 (2026)</a>
<a href="https://school.weingchicken.com/schools/1688/classes/462871/timetables" class="text-body">2반 (2026)</a>
</tbody></table>
<table><thead><tr><td class="bg-success text-white">3학년</td></tr></thead><tbody>
<a href="https://school.weingchicken.com/schools/1688/classes/462888/timetables" class="text-body">3반 (2026)</a>
<a href="https://school.weingchicken.com/schools/1688/classes/462893/timetables" class="text-body">8반 (2026)</a>
</tbody></table>`,
    checks: [
      ['1-1', 462870],
      ['1-2', 462871],
      ['3-3', 462888],
      ['3-8', 462893]
    ],
    live: { grade: 2, classNum: 5, minSubjects: 20 }
  },
  {
    schoolId: 1588,
    name: '동래중',
    html: `
<table><thead><tr><td class="bg-success text-white">1학년</td></tr></thead><tbody>
<a href="https://school.weingchicken.com/schools/1588/classes/323672/timetables" class="text-body">1반 (2026)</a>
<a href="https://school.weingchicken.com/schools/1588/classes/323680/timetables" class="text-body">9반 (2026)</a>
</tbody></table>
<table><thead><tr><td class="bg-success text-white">3학년</td></tr></thead><tbody>
<a href="https://school.weingchicken.com/schools/1588/classes/323690/timetables" class="text-body">3반 (2026)</a>
<a href="https://school.weingchicken.com/schools/1588/classes/323694/timetables" class="text-body">7반 (2026)</a>
</tbody></table>`,
    checks: [
      ['1-1', 323672],
      ['1-9', 323680],
      ['3-3', 323690],
      ['3-7', 323694]
    ],
    live: { grade: 3, classNum: 3, minSubjects: 20 }
  }
];

async function main() {
  for (const sample of SAMPLES) {
    const map = parseClassMap(sample.html, sample.schoolId);
    for (const [key, id] of sample.checks) {
      if (map.get(key) !== id) {
        throw new Error(`${sample.name} ${key}: expected ${id}, got ${map.get(key)}`);
      }
    }
    console.log(`${sample.name} HTML snippet OK`);

    const live = await fetchTimetable(
      sample.schoolId,
      sample.live.grade,
      sample.live.classNum
    );
    const filled = live.schedule.filter((c) => !c.isHeader && c.subject).length;
    if (filled < sample.live.minSubjects) {
      throw new Error(`${sample.name} live ${sample.live.grade}-${sample.live.classNum}: ${filled} subjects`);
    }
    console.log(
      `${sample.name} live ${sample.live.grade}-${sample.live.classNum} OK (${filled} subjects)`
    );
  }
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
