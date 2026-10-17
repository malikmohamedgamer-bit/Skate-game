// Map reachability check. Runs the analysis in src/world/reach.js on every map
// and prints a report. Exit code 1 if anything is unreachable.
// Usage: node scripts/check-reachability.js [mapId ...] [--json out.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadGameData } from '../src/core/data.js';
import { analyzeMap } from '../src/world/reach.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && (jsonIdx < 0 || i !== jsonIdx + 1));

const data = await loadGameData(async (p) => JSON.parse(readFileSync(SRC + p, 'utf8')));
const ids = only.length ? only : data.mapOrder;
const results = [];
let failed = 0;
const t0 = Date.now();
for (const id of ids) {
  const t = Date.now();
  const r = analyzeMap(data, id);
  results.push(r);
  const count = (list) => `${list.filter((x) => x.ok).length}/${list.length}`;
  console.log(`\n== ${r.name} (${id}) ${r.ok ? 'PASS' : 'FAIL'}  [${((Date.now() - t) / 1000).toFixed(1)} s]`);
  console.log(
    `   rideable area  : ${r.cells.percent}% reached (${r.cells.reached}/${r.cells.open} cells of 0.5 m; ${r.cells.needsOllie} reached by ollieing up; ${r.cells.obstacleTops} obstacle-top cells excluded)`,
  );
  console.log(`   spawns         : ${count(r.spawns)}  ${r.spawns.map((s) => s.id + (s.ok ? '' : ' (FAIL)')).join(', ')}`);
  console.log(`   ramps launched : ${count(r.ramps)}  ${r.ramps.map((s) => s.id + (s.ok ? '' : ' (FAIL)')).join(', ')}`);
  console.log(`   rails grinded  : ${count(r.rails)}  ${r.rails.map((s) => s.id + (s.ok ? '' : ' (FAIL)')).join(', ')}`);
  console.log(`   pickups        : ${count(r.pickups)}  ${r.pickups.filter((p) => p.method !== 'ride').map((p) => `${p.id}:${p.method}${p.ok ? '' : ' (FAIL)'}`).join(', ')}`);
  console.log(`   checkpoints    : ${count(r.checkpoints)}`);
  for (const i of r.issues) console.log(`   ! ${i}`);
  if (!r.ok) failed++;
}
console.log(`\n${ids.length - failed}/${ids.length} maps pass reachability (${((Date.now() - t0) / 1000).toFixed(1)} s).`);
if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log(`JSON report written to ${jsonOut}`);
}
process.exit(failed ? 1 : 0);
