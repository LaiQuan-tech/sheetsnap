#!/usr/bin/env node
/* 跑完 corpus-run.sh 之後，把「上一版 vs 這一版」印成一張表。
 *
 *   node corpus-delta.mjs
 *
 * 舊的數字從 git 拿（HEAD 裡那份已提交的摘要），新的從工作目錄拿。
 * 所以要在 commit 之前跑——commit 之後兩邊就一樣了。
 *
 * 只印彙總計數，不印任何一張表的名字或欄位，
 * 所以真實語料那半邊貼出來也是安全的（跟 --private 同一個標準）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/* 跟 corpus-run.sh 一樣先站到這支程式所在的資料夾：
   git show 的 HEAD:路徑 一律從 repo 根算，fs 卻是從 cwd 算，
   兩邊不一致的話從子目錄跑就會一邊讀到、一邊讀不到。 */
const here = path.dirname(fileURLToPath(import.meta.url));
process.chdir(here);

const FIELDS = [
  ['sheets', '工作表'], ['shown', '有渲染'], ['skipped', '略過'],
  ['clean', '乾淨'], ['warned', '引擎警示'], ['generic', '落到一般表格'],
  ['noTitle', '沒標題欄'], ['oneRow', '只有一列'],
  ['withTime', '照時間看'], ['withFilter', '只看某個 X'], ['withGroup', '照 X 分類'],
  ['withRank', '照 X 由大到小'], ['withFacts', '看重點數字'], ['onlySearch', '只剩直接搜尋'],
];

const old = p => {
  try { return JSON.parse(execFileSync('git', ['show', `HEAD:${p}`], { encoding: 'utf8' })); }
  catch { return null; }
};
const now = p => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

let any = false;
for (const [dir, label] of [['corpus-ms', '微軟範本'], ['corpus-real', '真實檔案']]) {
  const p = `${dir}/gallery-summary.json`;
  const a = old(p), b = now(p);
  if (!b) { console.log(`\n== ${label}：${p} 不在，跳過`); continue; }
  any = true;
  console.log(`\n== ${label}（${dir}）`);
  if (!a) { console.log('   HEAD 裡沒有這份摘要，只印現值'); }
  if (a && b.fingerprint && a.fingerprint &&
      JSON.stringify(a.fingerprint) === JSON.stringify(b.fingerprint))
    console.log('   ⚠︎ fingerprint 沒變——引擎與 gallery.mjs 都跟上次同一版，這份摘要可能沒重跑');
  const n = b.shown || 1;
  for (const [k, name] of FIELDS) {
    const y = a ? a[k] : null, z = b[k];
    if (z == null) continue;
    const d = y == null ? '' : (z - y > 0 ? `  +${z - y}` : z - y < 0 ? `  ${z - y}` : '   ·');
    const pct = ['sheets', 'shown', 'skipped'].includes(k) ? '' : `  (${Math.round(100 * z / n)}%)`;
    console.log(`   ${name.padEnd(14)} ${String(y == null ? '–' : y).padStart(4)} → ${String(z).padStart(4)}${d.padEnd(6)}${pct}`);
  }
}
if (!any) console.log('兩份摘要都不在——先跑 ./corpus-run.sh');
