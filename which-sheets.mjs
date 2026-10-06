#!/usr/bin/env node
/**
 * 把 --private 摘要裡的雜湊代號換回真實檔名與工作表名。
 *
 *   node which-sheets.mjs              只列出「只剩直接搜尋」的那幾張
 *   node which-sheets.mjs group        列出有「照 X 分類」的
 *   node which-sheets.mjs all          列出全部
 *
 * 只在你自己的機器上跑：它要讀 corpus-real/files 才還原得了對應，
 * 而那個資料夾在 .gitignore 裡。輸出不要貼給我——那就是原檔名。
 *
 * 為什麼需要這支：--private 的摘要裡只有 f3a21b9c › #2 這種代號，
 * 那是刻意的（見 corpus-real/README.md）。但代號是 sha1(檔名) 的前 8 碼，
 * 在有原檔的機器上重算一次就對得回去。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(here, 'corpus-real/files');
const SUM = path.join(here, 'corpus-real/gallery-summary.json');
const want = (process.argv[2] || 'only').toLowerCase();

if (!fs.existsSync(SUM)) { console.error('找不到 ' + SUM + '——先跑 ./corpus-run.sh'); process.exit(1); }
if (!fs.existsSync(DIR)) { console.error('找不到 ' + DIR + '——原檔要在才還原得了'); process.exit(1); }

const hid = s => 'f' + crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const byHash = new Map();
for (const f of fs.readdirSync(DIR).filter(f => /\.(xlsx|xls|csv)$/i.test(f))) {
  let names = [];
  try {
    const wb = /\.csv$/i.test(f)
      ? XLSX.read(fs.readFileSync(path.join(DIR, f), 'utf8'), { type: 'string' })
      : XLSX.read(fs.readFileSync(path.join(DIR, f)), { type: 'buffer' });
    names = wb.SheetNames;
  } catch { /* 讀不進來就只給檔名 */ }
  byHash.set(hid(f), { file: f, names });
}

const sum = JSON.parse(fs.readFileSync(SUM, 'utf8'));
const pick = r =>
  want === 'all'  ? true :
  want === 'only' ? r.views.length === 1 :
                    r.views.some(v => v === want);

const hits = (sum.rows || []).filter(pick);
console.log(`${hits.length} 張（共 ${sum.rows.length} 張有渲染）\n`);
for (const r of hits) {
  const m = byHash.get(r.src);
  const sheetName = m && m.names[r.table] !== undefined ? m.names[r.table] : '第 ' + (r.table + 1) + ' 張工作表';
  console.log(`  ${m ? m.file : r.src} › ${sheetName}`);
  console.log(`      ${r.shape} · 看法：${r.views.join(' | ')}`);
}
if (!hits.length) console.log('  （沒有符合的）');
