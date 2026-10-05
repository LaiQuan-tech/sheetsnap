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
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const g = {};
new Function('window', fs.readFileSync(path.join(here, 'detect.js'), 'utf8'))(g);
const S = g.SheetShape;

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
let OUTDIR = outIdx >= 0 ? argv[outIdx + 1] : 'corpus-real/scrubbed';
if (outIdx >= 0 && !OUTDIR) { console.error('--out 後面要接資料夾'); process.exit(1); }
const NOVERIFY = argv.includes('--no-verify');
const SELFTEST = argv.includes('--selftest');
let inputs = argv.filter((a, i) =>
  !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1));
if (!inputs.length && !SELFTEST) {
  console.error('用法：node scrub.mjs <檔案或資料夾> [--out <資料夾>] [--no-verify]');
  console.error('      node scrub.mjs --selftest   拿內建的仿真檔驗一遍這支程式自己');
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
/* idx 用字庫當底數編碼，所以不同的 idx 永遠得到不同的字串——沒有截斷。
   第一版是「值N 截斷到原值長度」，三個字的原值因此只生得出 99 種
   （值10、值11…值99 之後全部撞在 "值10"），撞完就落到
   take() 的最後一手「生不出來就留原值」，於是第 100 個之後的人名原樣留下。
   寧可長度偏掉也不可以留原值：長度只影響 avgLen 與 longtext 的判定，
   那是可以接受的誤差；留原值不是誤差，是洩漏。 */
function filler(orig, idx) {
  const zh = cjk(orig), pool = zh ? POOL_ZH : POOL_EN, n = Math.max(orig.length, 1);
  let out = '', x = idx;
  do { out = pool[x % pool.length] + out; x = Math.floor(x / pool.length); } while (x > 0);
  if (out.length < n) out += (zh ? '〇' : 'x').repeat(n - out.length);
  // 換行會決定 multiline／longtext，位置要留著
  for (let i = 0; i < orig.length && i < out.length; i++)
    if (orig[i] === '\n') out = out.slice(0, i) + '\n' + out.slice(i + 1);
  return out;
}
/* 0 換成 0、非 0 換成另一個非 0。這樣三件事同時成立：
   開頭不會冒出 0（NT$0275 這種看起來就是壞的，而且 numOf 讀出來的量級也變了）、
   電話的開頭 0 留得住、整數的「整」留得住（NT$5000 洗完還是 x000，
   而金額欄常常就是整數，相異值數與格式都靠它）。 */
/* 數字照 idx 以 9 為底編碼（0 留 0），同樣是單射的——
   原本用隨機數，兩個不同的原值有機會生出同一個假值，
   撞上就落到「留原值」那一手。 */
const digitSwap = (s, idx) => {
  let x = idx;
  return s.replace(/\d/g, d => {
    if (d === '0') return '0';
    const r = x % 9; x = Math.floor(x / 9);
    return String(1 + r);
  });
};

/* 全是零的金額（NT$0、$0.00）跟 $- 一樣不帶資訊，原樣留著。
   而數值欄裡夾著的文字要當文字洗——detectColumn 的 rNum 門檻是 0.8，
   所以一個 number 欄裡混著兩成文字是正常的：
   「分鐘」「待定」「暫時不用」「アカウント管理」都是這樣來的，
   digitSwap 對它們完全換不動，於是一路撞到拋錯。 */
const allZero = v => /\d/.test(v) && !/[1-9]/.test(v);

/* 「整格只有數字骨架」才用換數字的方式洗。
   數值欄裡夾著文字時，只換數字會把文字留下來——
   「建坪10土地66」洗成「建坪70土地22」、「NT$400000以上」的「以上」原封不動。
   電話是例外：它的形狀（ext.、#、分隔）要留著 isPhoneish 才判得出來，
   而形狀不帶身分，數字才帶。 */
const pureNumeric = v => !v.replace(/NT/gi, '').replace(/[\s\d,.\-+()%$＄¥￥€£]/g, '');

function gen(v, type, idx) {
  // 電話欄裡也會夾文字（「已留電話」「待補」），沒有數字可換就當文字洗
  if (type === 'phone') return /[1-9]/.test(v) ? digitSwap(v, idx) : filler(v, idx);
  if (type === 'money' || type === 'number')
    return (/[1-9]/.test(v) && pureNumeric(v)) ? digitSwap(v, idx) : filler(v, idx);
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
    if (allZero(t)) return v;                            // 全是零的金額不帶資訊
    if (map.has(v)) return map.get(v);
    let o = gen(v, type, map.size);
    /* 生不出不同的就停住，絕對不可以退回原值。
       原本寫 o = v，那一行讓 1000 列的檔案從第 100 個不同的短字串開始
       整串原樣留下。洗不出來就該拒絕寫檔，不是悄悄留著。 */
    /* 重試的條件有兩個：撞過，或者「剛好生出跟原值一樣的東西」。
       後者原本漏掉了。生成器是確定性的，所以把洗過的檔案再洗一遍時，
       email 的樣板 v9@example.com 在 idx 8 會原封不動生成同一個字串、
       字庫的第 12 個字就是「寅」、idx 編碼的數字也可能生出同樣的位數——
       那不是真的生不出來，換個 idx 就有了。 */
    for (let k = 1; (used.has(o) || o === v) && k <= 64; k++) o = gen(v, type, map.size + k * 7919);
    if (used.has(o) || o === v) {
      throw new Error('生不出跟原值不同又沒撞過的替代值：' + JSON.stringify(v.slice(0, 20)) +
        '（型別 ' + type + '，已用 ' + used.size + ' 個）');
    }
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
  return { grid: out, kept, colType, headerEnd };
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

/* --selftest：拿內建的仿真檔跑一遍，驗的是這支程式自己。
   引擎的回歸測試在 test.mjs，這裡測的是另一件事——
   「洗完在引擎眼裡一樣」而且「原始內容真的沒留下來」。
   五個檔各對一種真實世界的寫法：台灣報價單（民國單號、NT$）、
   工時表（日期橫排、會計式零）、客戶名冊（電話信箱長備註）、
   月份橫排預算（括號負數、下半年全是 $-）、歐美 day-first 的 tracker。 */
function fixtures(dir) {
  const W = (n, sheets) => {
    const wb = XLSX.utils.book_new();
    for (const [k, grid] of Object.entries(sheets))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), k);
    XLSX.writeFile(wb, path.join(dir, n));
  };
  const items = ['辦公桌 L型', '人體工學椅', '檔案櫃三層', '白板 120x90', '投影機支架', '碎紙機', '飲水機濾心', 'LED 檯燈'];
  W('quote.xlsx', { 報價: [['永豐實業股份有限公司', '', '', ''], ['報價單　單號 Q-11203-001', '', '', ''], ['品項', '數量', '單價', '小計']]
    .concat(items.map((it, i) => [it, String(i + 1), 'NT$' + (1200 + i * 430), 'NT$' + ((i + 1) * (1200 + i * 430))])) });

  const who = ['陳怡君', '林志明', '王淑芬', '張家豪', '李佩玲'];
  W('timesheet.xlsx', { 工時: [['專案工時彙總　112 年 3 月', '', '', '', '', '', ''], ['負責人', '3/1', '3/4', '3/5', '3/6', '3/7', '合計']]
    .concat(who.map((w, i) => [w, '8', i % 2 ? '8' : '$-', '8', i % 3 ? '4' : '$-', '8', String(28 + i)])) });

  W('customers.xlsx', { 名冊: [['客戶名單', '', '', ''], ['客戶名稱', '聯絡電話', '電子郵件', '備註']]
    .concat(Array.from({ length: 12 }, (_, i) => ['客戶 ' + String.fromCharCode(65 + i) + ' 有限公司',
      '02-2345-' + (1000 + i), 'contact' + i + '@customer' + i + '.com.tw',
      i % 3 ? '' : '這位客戶的付款條件是月結六十天，出貨前需要先確認採購單號'])) });

  const M = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  const acct = ['人事費', '租金', '水電', '差旅', '行銷', '雜支'];
  W('budget.xlsx', { 預算: [['年度預算執行表'].concat(M.map(() => '')), ['科目'].concat(M, ['年度合計'])]
    .concat(acct.map((a, i) => [a].concat(M.map((_, m) =>
      m < 6 ? (i % 4 === 0 ? '$(' + (1000 + i * 37 + m) + ')' : 'NT$' + (5000 + i * 310 + m * 17)) : '$-'),
      ['NT$' + (60000 + i * 2100)]))) });

  /* 出事的那張形狀：很多列、短人名。1000 列的真實檔案從第 100 個不同的
     三字人名開始，第一版的 filler 就撞光了，然後退回原值。 */
  const surname = '陳林黃張李王吳劉蔡楊許鄭謝郭洪曾廖賴徐周';
  const given = '怡志淑家佩宗美雅建文玉秀明慧俊';
  W('roster.xlsx', { 名冊: [['活動人員名冊'].concat(['', '', '']), ['姓名', '職稱', '手機', '組別']]
    .concat(Array.from({ length: 300 }, (_, i) => [
      surname[i % 20] + given[(i * 7) % 15] + given[(i * 13) % 15],
      ['攝影師', '造型師', '司儀', '燈光', '音控'][i % 5],
      '+886' + (900000000 + i * 137),
      'A組BCD'[i % 4]])) });

  W('tracker.xlsx', {
    Tasks: [['Project tracker', '', '', ''], ['Task', 'Owner', 'Due', 'Cost']]
      .concat(Array.from({ length: 10 }, (_, i) => ['Task ' + (i + 1),
        ['Alice Chen', 'Bob Wu', 'Cara Lin'][i % 3], (10 + i) + '/03/2024', '£' + (250 + i * 35) + '.00'])),
    Notes: [['About this sheet'], ['Fill in the task name, owner and due date. Costs are in pounds.']],
  });
  return 6;
}

if (SELFTEST) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrub-selftest-'));
  const src = path.join(tmp, 'in');
  fs.mkdirSync(src, { recursive: true });
  fixtures(src);
  inputs = [src];
  OUTDIR = path.join(tmp, 'out');
}

/* ── 驗：原始內容真的沒留下來 ──
   「判定一致」只證明結構保住了，不證明內容換掉了——一支什麼都不做的
   scrub 也會通過那一項。這個檢查原本只在 --selftest 跑，正式跑 --out
   時完全沒做，所以 filler 撞號退回原值時沒有任何東西擋得住：
   20 個真實檔案推上公開 repo，407 格人名電話原樣留著。
   測試要跑在會出事的那條路上，不是只跑在我想得到的那條。 */
const KEEPABLE = (v, type) =>
  !v.trim() || NULLISH.test(v.trim()) || /^\d{1,2}$/.test(v.trim()) ||
  allZero(v.trim()) || type === 'date' || type === 'time';

function leaks(before, after, colType, headerEnd) {
  const out = [];
  for (let i = headerEnd + 1; i < before.length; i++)
    for (let c = 0; c < (before[i] || []).length; c++) {
      const a = String((before[i] || [])[c] ?? ''), b = String((after[i] || [])[c] ?? '');
      if (KEEPABLE(a, colType[c])) continue;
      if (a === b) out.push({ i, c, v: a });
    }
  return out;
}

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

  const name = 'real_' + crypto.createHash('sha1').update(path.basename(fp)).digest('hex').slice(0, 8) + '.xlsx';
  const checks = [];
  const sheets = [];
  let failed = null;
  for (const [i, sh] of grids.entries()) {
    let r;
    try { r = scrubGrid(sh.grid); }
    catch (e) { failed = `#${i}：${e.message}`; break; }
    checks.push({ i, before: sig(sh.grid), after: sig(r.grid) });
    const lk = leaks(sh.grid, r.grid, r.colType, r.headerEnd);
    if (lk.length) {
      failed = `#${i}：${lk.length} 個資料格原樣留著，例如 ` +
        lk.slice(0, 3).map(x => `[${x.i},${x.c}] ${JSON.stringify(x.v.slice(0, 20))}`).join('、');
      break;
    }
    sheets.push({ i, grid: r.grid, kept: r.kept, sheet: sh.name });
  }

  /* 洩漏就整個檔不寫。寫一半的檔更糟——你會以為它洗過。 */
  if (failed) {
    bad++;
    console.error(`✗ ${path.basename(fp)}：沒有寫出來。${failed}`);
    continue;
  }

  const wb = XLSX.utils.book_new();
  for (const s2 of sheets) {
    allKept.push({ f: path.basename(fp), sheet: s2.sheet, kept: s2.kept });
    // 工作表名可能帶人名、客戶、專案，換成序號
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2.grid), 'S' + (s2.i + 1));
  }
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

/* 自我測試：洩漏檢查現在是每一次跑都做（在寫檔之前），所以這裡不用再驗一遍，
   要驗的是「那個檢查真的會擋」。
   仿真檔裡刻意放一張 300 列、短人名的工作表——那正是出事的形狀：
   filler 撞號之後第一版會退回原值，現在會拋錯、整個檔不寫。 */
if (SELFTEST) {
  if (bad) { console.error('自我測試失敗：仿真檔應該全部洗得過。'); process.exit(1); }
  console.error('\n自我測試：' + done + ' 個仿真檔都通過了結構比對與洩漏檢查');
}
