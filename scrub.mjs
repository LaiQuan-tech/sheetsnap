#!/usr/bin/env node
/**
 * 把真實檔案洗成可以進 repo 的測試案例。
 *
 *   node scrub.mjs corpus-real/files --out corpus-real/scrubbed
 *   node scrub.mjs 某個檔.xlsx --out /tmp/看看
 *
 * 目的不是「匿名化到可以公開」，是「保住引擎看得見的每一件事、換掉所有內容」，
 * 洗完的檔案進 repo 之後就能在任何一台機器上重跑——不用再把原檔搬來搬去。
 *
 * 保住什麼（這些就是引擎讀的東西）：
 *   · 哪些格子有值、哪些是空的（填充率、標題列評分、切表全看這個）
 *   · 標題列的位置與原文（NAME_HINTS、合計欄、人員欄、期間欄都是看欄名的）
 *   · 前言列的位置（標題列評分要看它上面有幾列、蓋住哪幾欄）
 *   · 每一欄的型別、相異值數、重複結構、平均長度、有沒有換行
 *   · 日期與時間的原文（民國年、點分隔、日月順序——那正是要測的東西）
 *   · 會計格式的零（$-）與破折號（-）的原文
 *
 * 換掉什麼：
 *   · 所有資料格的文字：同一個原值對到同一個假值（所以分組與相異值數不變），
 *     長度一樣、中文對中文、英數對英數、換行位置保留
 *   · 金額與數字：符號、千分位、小數位、括號全部保留，只換數字
 *   · 信箱換成 example.com、網址換成 example.com、電話只換數字
 *
 * 不洗的：標題列與前言列照原樣留著。那是引擎最吃重的輸入，洗掉就等於沒測。
 * 跑完會把留著的字串全部印出來讓你複核——公司名、客戶名通常就在前言裡。
 *
 * 洗完自動驗：對原檔與洗完的檔各跑一次引擎，比對形狀、列數、標題列、
 * 每一欄的「欄名:型別:填充率:相異值數」、角色、結構轉換。
 * 有任何一項不同就印出來並以非零結束——洗壞了的案例比沒有案例更糟。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const g = {};
new Function('window', fs.readFileSync(path.join(here, 'detect.js'), 'utf8'))(g);
const S = g.SheetShape;

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUTDIR = outIdx >= 0 ? argv[outIdx + 1] : 'corpus-real/scrubbed';
if (outIdx >= 0 && !OUTDIR) { console.error('--out 後面要接資料夾'); process.exit(1); }
const NOVERIFY = argv.includes('--no-verify');
const inputs = argv.filter((a, i) =>
  !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1));
if (!inputs.length) {
  console.error('用法：node scrub.mjs <檔案或資料夾> [--out <資料夾>] [--no-verify]');
  process.exit(1);
}

/* ── 讀：三個讀檔的地方（index.html／audit／gallery）都是這組選項，
      所以引擎看到的永遠是「格式化之後的字串」。洗完照樣寫成文字格，
      下一次讀進來就是一模一樣的東西。 ── */
const READ = { header: 1, defval: '', raw: false };
function readGrids(fp) {
  const wb = /\.csv$/i.test(fp)
    ? XLSX.read(fs.readFileSync(fp, 'utf8'), { type: 'string' })
    : XLSX.read(fs.readFileSync(fp), { type: 'buffer' });
  return wb.SheetNames.map(n => ({ name: n, grid: XLSX.utils.sheet_to_json(wb.Sheets[n], READ) }));
}

const blank = v => String(v == null ? '' : v).trim() === '';
const cjk = s => /[　-〿㐀-䶿一-鿿＀-￯]/.test(s);
// 「沒有值」的寫法要原樣留著：$- 跟 - 是結構，不是內容
const NULLISH = /^(?:NT\$?|[$＄¥￥€£])?\s*([-–—－]|N\/A|n\/a|NA|無|nil|null)$/;

let seed = 1;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/* 短字串要有自己的字庫，不然長度 1、2 的原值全部洗成同一個字，
   相異值數就塌掉了（原檔 8 種品名變成 1 種）。 */
const POOL_ZH = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黃宇宙洪荒日月盈昃';
const POOL_EN = 'abcdefghijklmnopqrstuvwxyz';
function filler(orig, idx) {
  const zh = cjk(orig), pool = zh ? POOL_ZH : POOL_EN, n = orig.length;
  let out;
  if (n <= 2) {
    out = pool[idx % pool.length];
    if (n === 2) out += pool[Math.floor(idx / pool.length) % pool.length];
  } else {
    const head = (zh ? '值' : 'v') + (idx + 1);
    out = head.length >= n ? head.slice(0, n) : head + (zh ? '〇' : 'x').repeat(n - head.length);
  }
  // 換行會決定 multiline／longtext，位置要留著
  for (let i = 0; i < n && i < out.length; i++)
    if (orig[i] === '\n') out = out.slice(0, i) + '\n' + out.slice(i + 1);
  return out;
}
/* 0 換成 0、非 0 換成另一個非 0。這樣三件事同時成立：
   開頭不會冒出 0（NT$0275 這種看起來就是壞的，而且 numOf 讀出來的量級也變了）、
   電話的開頭 0 留得住、整數的「整」留得住（NT$5000 洗完還是 x000，
   而金額欄常常就是整數，相異值數與格式都靠它）。 */
const digitSwap = s => s.replace(/\d/g, d =>
  d === '0' ? '0' : String(1 + Math.floor(rnd() * 9)));

function gen(v, type, idx) {
  if (type === 'money' || type === 'number' || type === 'phone') return digitSwap(v);
  if (type === 'email') return 'v' + (idx + 1) + '@example.com';
  if (type === 'url') return 'https://example.com/' + (idx + 1);
  return filler(v, idx);
}

/* 洗一張工作表。標題列與它上面的前言列原樣留著——
   引擎最吃重的輸入就是它們，洗掉等於沒測。

   對應表是「一張工作表一本」，不是「一欄一本」。
   一欄一本會把跨欄重複的值拆開：工時表每一格都是 8，一欄一本之後
   3/1 那欄的 8 變成 4、3/5 那欄的 8 還是 8，某一列的相異值數就上升了。
   scoreHeader 裡有一項正是「這一列有幾種不同的值」，
   那張表的標題列本來只贏資料列 0.14 分，這樣一推就輸了——
   標題列跑到第 6 列，期間攤平跟著整個不成立。 */
function scrubGrid(grid) {
  const tables = (() => { try { return S.analyseSheet(grid).tables; } catch { return []; } })();
  const headerEnd = tables.reduce((m, t) => Math.max(m, t.headerRow || 0), 0);
  const w = grid.reduce((m, r) => Math.max(m, (r || []).length), 0);
  const out = grid.map(r => (r || []).slice());
  const kept = [];
  for (let i = 0; i <= headerEnd && i < out.length; i++)
    (out[i] || []).forEach(v => { if (!blank(v)) kept.push(String(v)); });

  // 型別一欄判一次：同一個字串在金額欄跟文字欄要用不同的換法
  const colType = [];
  for (let c = 0; c < w; c++) {
    const vals = [];
    for (let i = headerEnd + 1; i < out.length; i++) vals.push((out[i] || [])[c]);
    colType[c] = S.detectColumn('', vals).type;
  }

  const map = new Map(), used = new Set();
  const take = (v, type) => {
    const t = v.trim();
    if (!t || NULLISH.test(t)) return v;                 // 空白與「沒有值」是結構
    if (type === 'date' || type === 'time') return v;     // 格式本身就是要測的東西
    /* 一兩位的純數字原樣留著：那是數量、工時、分數、件數。
       既不敏感，又只有九個一位數可用——硬換會撞成一團，相異值數就塌了
       （報價單的數量 1…8 洗完只剩 5 種）。 */
    if (/^\d{1,2}$/.test(t)) return v;
    if (map.has(v)) return map.get(v);
    let o = gen(v, type, map.size);
    for (let k = 1; used.has(o) && k <= 24; k++) o = gen(v, type, map.size + k * 101);
    if (used.has(o)) o = v;                              // 真的生不出不同的就留原值
    map.set(v, o); used.add(o);
    return o;
  };

  for (let i = headerEnd + 1; i < out.length; i++) {
    if (!out[i]) out[i] = [];
    for (let c = 0; c < w; c++) {
      const raw = (out[i] || [])[c];
      if (raw == null || String(raw) === '') continue;
      out[i][c] = take(String(raw), colType[c]);
    }
  }
  return { grid: out, kept };
}

/* ── 驗：引擎眼裡是不是同一回事 ── */
const sig = grid => {
  let a;
  try { a = S.analyseSheet(grid); } catch (e) { return 'engine-threw:' + e.message; }
  const v = S.sheetVerdict(grid, a.tables);
  return JSON.stringify({
    show: v.show, why: v.why,
    tables: a.tables.map(t => ({
      shape: t.shape.shape, rows: t.rows.length, cols: t.cols.length,
      live: t.cols.filter(c => c.type !== 'empty').length,
      headerRow: t.headerRow, unpivoted: t.unpivoted || '',
      notes: t.notes || [],
      roles: { t: t.roles.title && t.roles.title.name, g: t.roles.group && t.roles.group.name,
               l: t.roles.lead && t.roles.lead.name, p: t.roles.person && t.roles.person.name },
      cols: t.header.map((h, j) => `${h}:${t.cols[j].type}:${Math.round(t.cols[j].fillRate * 100)}%:${t.cols[j].distinct}`),
    })),
  });
};

const files = [];
for (const inp of inputs) {
  if (fs.existsSync(inp) && fs.statSync(inp).isDirectory())
    fs.readdirSync(inp).filter(f => /\.(xlsx|xls|csv)$/i.test(f)).sort()
      .forEach(f => files.push(path.join(inp, f)));
  else files.push(inp);
}
fs.mkdirSync(OUTDIR, { recursive: true });

let bad = 0, done = 0;
const allKept = [];
for (const fp of files) {
  seed = parseInt(crypto.createHash('sha1').update(path.basename(fp)).digest('hex').slice(0, 8), 16) || 1;
  let grids;
  try { grids = readGrids(fp); }
  catch (e) { console.error(`✗ ${fp}：讀不進來 ${e.message}`); bad++; continue; }

  const wb = XLSX.utils.book_new();
  const checks = [];
  grids.forEach((sh, i) => {
    const { grid, kept } = scrubGrid(sh.grid);
    allKept.push({ f: path.basename(fp), sheet: sh.name, kept });
    checks.push({ i, before: sig(sh.grid), after: sig(grid) });
    // 工作表名可能帶人名、客戶、專案，換成序號
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), 'S' + (i + 1));
  });

  const name = 'real_' + crypto.createHash('sha1').update(path.basename(fp)).digest('hex').slice(0, 8) + '.xlsx';
  XLSX.writeFile(wb, path.join(OUTDIR, name));
  done++;

  if (!NOVERIFY) {
    const diff = checks.filter(c => c.before !== c.after);
    if (diff.length) {
      bad++;
      console.error(`✗ ${path.basename(fp)} → ${name}：${diff.length}/${checks.length} 張工作表洗完判定就變了`);
      for (const d of diff.slice(0, 2)) {
        console.error(`    原檔 #${d.i}: ${d.before.slice(0, 300)}`);
        console.error(`    洗完 #${d.i}: ${d.after.slice(0, 300)}`);
      }
    } else {
      console.error(`✓ ${path.basename(fp)} → ${name}（${checks.length} 張工作表判定一致）`);
    }
  }
}

console.error(`\n洗完 ${done} 個檔，寫到 ${OUTDIR}/`);
console.error('原樣留著的字串（標題列與前言——公司名、客戶名通常在這裡，推之前請掃一遍）：');
for (const k of allKept) {
  if (!k.kept.length) continue;
  const line = k.kept.map(s => s.replace(/\s+/g, ' ')).join(' · ');
  console.error(`  ${k.f} › ${k.sheet}\n      ${line.length > 400 ? line.slice(0, 400) + '…' : line}`);
}
if (bad) { console.error(`\n${bad} 個檔洗完判定不一致——別推這幾個，先回報給我。`); process.exit(1); }
