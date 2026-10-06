#!/usr/bin/env node
/**
 * 批次體檢：把一堆試算表跑過引擎，自動指出哪些判壞了。
 *
 *   node audit.mjs <檔案或資料夾或網址> [更多...]
 *   node audit.mjs ./corpus            # 整個資料夾的 csv / xlsx
 *
 * 要產 baseline 用 --out，不要用 shell 重導：
 *   node audit.mjs corpus-ms/files --out corpus-ms/baseline.json
 * （> 會在 node 跑之前先把檔清空，跑失敗就連舊的一起沒）
 *
 * 跑真實檔案時加 --private：
 *   node audit.mjs ~/我的檔案 --out corpus-real/baseline.json --private
 * 寫出去的 JSON 裡一個原文都沒有：檔名與工作表名換成雜湊，前言丟掉，
 * 欄名丟掉，角色只留「有沒有」，理由與結構轉換與警示裡的名字清空。
 * 終端機上照原樣印，那是在你自己的機器上。
 *
 * 第一版保留欄名，理由是「引擎的規則大半看欄名」。那個理由錯在一個前提上：
 * colTypes 記的是「引擎判定的標題列」，而標題列會判錯——
 * 一份 Google 表單匯出的真正標題列在第 0 列、引擎判在第 4 列，
 * 於是那一行變成「劉若芊:text / 0915373201:number / x@gmail.com:email」。
 * 規則改成：任何離開這台機器的東西，都不原樣複製任何一格。
 *
 * 不需要 API 金鑰。重點不是「跑得完」，是把可疑的結果標出來——
 * 今天最痛的問題是「修 A 弄壞 B」，有一組固定的表每次跑過就有解。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const g = {};
new Function('window', fs.readFileSync(path.join(here, 'detect.js'), 'utf8'))(g);
const { SheetShape } = g;

let XLSX = null;
try { XLSX = (await import('xlsx')).default; } catch { /* 沒裝就只跑 csv */ }

/* ── 讀 ── */
function parseCSV(t) {
  const R = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); R.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); R.push(row); }
  return R;
}

async function load(src) {
  if (/^https?:/.test(src)) {
    const m = src.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) throw new Error('不是 Google 試算表網址');
    const gid = (src.match(/[#&?]gid=(\d+)/) || [])[1];
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv` +
                          (gid ? `&gid=${gid}` : ''));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return [{ name: src.slice(0, 60), grid: parseCSV(await r.text()) }];
  }
  const ext = path.extname(src).toLowerCase();
  if (ext === '.csv' || ext === '.tsv')
    return [{ name: path.basename(src), grid: parseCSV(fs.readFileSync(src, 'utf8')) }];
  if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') {
    if (!XLSX) throw new Error('要讀 Excel 請先 npm install xlsx');
    const wb = XLSX.read(fs.readFileSync(src), { type: 'buffer' });
    // 一個活頁簿的每張工作表都各自體檢
    return wb.SheetNames.map(n => ({
      name: `${path.basename(src)} › ${n}`,
      grid: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false })
    }));
  }
  throw new Error(`不支援的副檔名 ${ext}`);
}

function expand(args) {
  const out = [];
  for (const a of args) {
    if (/^https?:/.test(a)) { out.push(a); continue; }
    if (fs.existsSync(a) && fs.statSync(a).isDirectory()) {
      fs.readdirSync(a).filter(f => /\.(csv|tsv|xlsx|xls|xlsm)$/i.test(f)).sort()
        .forEach(f => out.push(path.join(a, f)));
    } else out.push(a);
  }
  return out;
}

/* ── 體檢：哪些結果值得懷疑 ── */
function checkup(a, srcRows) {
  const flags = [];
  const rows = a.rows.length;
  const live = a.cols.filter(c => c.type !== 'empty');

  const auto = a.header.filter(h => /^欄 \d+$/.test(String(h).trim())).length;
  if (auto > a.header.length * 0.4)
    flags.push(`標題列可能判錯：${auto}/${a.header.length} 欄沒有欄名`);

  if (!a.roles.title) flags.push('找不到主標題欄，卡片會沒有名字');
  else {
    /* 要跟 index.html 的規則一致：標題空白、而且扣掉隱藏欄（項次、單號）之後
       沒有任何內容，才會被整列略過。只看標題欄空不空會報一堆不存在的事——
       真實檔案裡有一張報「12/13 列會被略過」，其實那 12 列其他欄都有資料。 */
    const i = a.header.indexOf(a.roles.title.name);
    const hidden = new Set((a.roles.hidden || []).map(c => c.name));
    const sub = a.cols.filter((c, j) =>
      c.type !== 'empty' && !hidden.has(c.name) && j !== i).map((c) => a.header.indexOf(c.name));
    const blank = a.rows.filter(r =>
      !String(r[i] ?? '').trim() && !sub.some(j => String(r[j] ?? '').trim())).length;
    if (blank > rows * 0.3)
      flags.push(`${blank}/${rows} 列沒有標題也沒有內容，會被整列略過`);
  }

  const textish = live.filter(c => c.type === 'text').length;
  if (live.length >= 3 && textish === live.length)
    flags.push('所有欄位都只判成一般文字，型別偵測沒抓到東西');

  if (a.shape.shape === 'cards' && live.length >= 4)
    flags.push('落到一般表格：沒有辨識出任何主軸');

  if (a.roles.group) {
    const gi = a.header.indexOf(a.roles.group.name);
    const keys = new Set(a.rows.map(r => String(r[gi] ?? '').trim()).filter(Boolean));
    if (keys.size === 1) flags.push(`分組欄「${a.roles.group.name}」只有一種值，等於沒分組`);
    if (keys.size > rows * 0.8 && rows > 8)
      flags.push(`分組欄「${a.roles.group.name}」幾乎每列都不同，會碎成一堆單筆段落`);
  }

  if (rows === 0) flags.push('沒有任何資料列');
  if (rows === 1) flags.push('只有一列資料，判斷幾乎沒有依據');

  // 從 40 列的工作表只抽出 2 列，多半是結構判壞了而不是資料真的只有兩列
  if (srcRows && rows > 0 && rows < srcRows * 0.2 && srcRows >= 10)
    flags.push(`原始工作表有 ${srcRows} 列，只抽出 ${rows} 列，結構可能判壞`);

  /* 大半欄位有名字卻整欄沒資料 → 這是還沒填的空白範本，渲染出來會是一頁空卡片。
     這條原本寫「欄位邊界可能抓錯」，v64 之後那個說法一定是錯的：
     沒有欄名的空白欄已經在 findTables 裡被剔除，留下來的都是作者宣告過的欄位。
     163 份語料實測剩三張，全是空白表單（Emergency Contacts、Timesheet、chart_calcs）。
     矩陣報表例外：請假表整年沒請假時「事假／病假」本來就整欄空白，
     那是正常資料，而且引擎刻意保留這些欄以維持形狀穩定。 */
  const empties = a.cols.length - live.length;
  if (a.shape.shape !== 'matrix' && a.cols.length >= 4 && empties > a.cols.length * 0.5)
    flags.push(`${empties}/${a.cols.length} 欄有欄名但整欄沒資料，像還沒填的空白範本`);

  // 判成排程但日期幾乎每列都不同、又有金額欄 → 多半是明細帳不是行程
  if (a.shape.shape === 'schedule' && a.roles.group && a.roles.group.type === 'date') {
    const uniq = a.roles.group.distinct / Math.max(a.roles.group.filled, 1);
    const hasMoney = live.some(c => c.type === 'money');
    if (uniq > 0.8 && hasMoney)
      flags.push('判成排程，但日期幾乎每列都不同且有金額欄，可能其實是明細帳');
  }

  return flags;
}

/* ── 跑 ── */
/* --json：把每張表的判定印成 JSON 給 stdout，人看的進度走 stderr。
   為什麼要這個：這套語料存在的理由是抓「修 A 弄壞 B」，
   但只印到畫面上就沒有「上次的結果」可以比對，回歸得靠人眼記住上一輪的數字。
   刻意不放時間戳——baseline 要進版控，每跑一次就換一行的東西會讓 diff 全是雜訊；
   跑的時間由 commit 本身記錄。改了 detect.js 或 audit.mjs 指紋就會變，
   那是「結果應該不一樣」的訊號，不是雜訊。 */
const rawArgs = process.argv.slice(2);

/* zsh 預設沒開 interactive_comments，行尾的 # 註解不是註解，是參數。
   販上來的「node audit.mjs --json > baseline.json  # 說明文字」會變成
   拿 # 跟後面每一個詞当檔名，跑出一份 0 筆的 baseline——而 shell 的
   重導在 node 啟動前已經把舊的結果清掉了。寧可絕不可濾。 */
const hashArg = rawArgs.findIndex(a => a.startsWith('#'));
if (hashArg >= 0) {
  console.error(`停下來：第 ${hashArg + 1} 個參數是「${rawArgs[hashArg]}」。`);
  console.error('zsh 不把行尾的 # 當註解，整句話都變成了檔名。把註解刪掉再跑一次。');
  process.exit(2);
}

/* --out：寫完才換上去（先寫 .tmp 再 rename）。
   用 shell 重導寫 baseline 有個隱形的危險：> 在 node 跑之前就把檔清空了，
   所以任何一次跑失敗都會連上一份好的 baseline 一起沒。 */
const outIdx = rawArgs.indexOf('--out');
const OUT = outIdx >= 0 ? rawArgs[outIdx + 1] : null;
if (outIdx >= 0 && !OUT) {
  console.error('--out 後面要接檔名，例如 --out corpus-ms/baseline.json');
  process.exit(1);
}
const JSONOUT = rawArgs.includes('--json') || !!OUT;
const PRIVATE = rawArgs.includes('--private');
/* 雜湊要穩定：同一個檔在不同次跑要得到同一個代號，diff 才對得起來。
   前 8 位夠分辨 163 份、也夠分辨幾百份。 */
const hid = s => 'f' + crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
const args = expand(rawArgs.filter((a, i) =>
  a !== '--json' && a !== '--private' && a !== '--out' && !(outIdx >= 0 && i === outIdx + 1)));
if (!args.length) {
  console.error('用法：node audit.mjs <檔案 / 資料夾 / 試算表網址> [更多...] [--json] [--out <檔名>] [--private]');
  process.exit(1);
}

const P = s => process.stdout.write(s + '\n');
const say = JSONOUT ? s => process.stderr.write(s + '\n') : P;
const ident = s => s;
const C = JSONOUT
  ? { d: ident, b: ident, g: ident, y: ident, r: ident }
  : { d: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`,
      g: s => `\x1b[32m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m` };

const sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);
const roleName = r => (r && r.name) || null;

let clean = 0, flagged = 0, broken = 0, skipped = 0;
const shapes = {}, allFlags = {}, records = [];

for (const src of args) {
  const base = path.basename(src);
  let sheets;
  try { sheets = await load(src); }
  catch (e) {
    broken++;
    records.push({ src: base, sheet: null, status: 'unreadable', why: e.message });
    say(`\n${C.r('✗')} ${src}\n  ${C.r(e.message)}`);
    continue;
  }

  for (const [shIdx, sh] of sheets.entries()) {
    let tables;
    try { tables = SheetShape.analyseSheet(sh.grid).tables; }
    catch (e) {
      broken++;
      records.push({ src: base, sheet: sh.name, sheetIndex: shIdx, status: 'engine-threw', why: e.message });
      say(`\n${C.r('✗')} ${sh.name}\n  ${C.r('引擎爆掉：' + e.message)}`);
      continue;
    }

    // 說明頁、下拉選單來源、圖表暫存區不是「壞掉」，是本來就不該渲染
    const v = SheetShape.sheetVerdict(sh.grid, tables);
    if (v.show !== true) {
      skipped++;
      records.push({ src: base, sheet: sh.name, sheetIndex: shIdx, status: 'not-shown', show: v.show, why: v.why,
                     srcRows: sh.grid.length });
      say(`${C.d('–')} ${C.d(sh.name)} ${C.d(v.why)}`);
      continue;
    }

    /* srcRows 要算「有資料的列」而不是工作表的總列數。
       Google Sheets 匯出的 xlsx 一律補到 1000 列，所以真實檔案裡
       「原始工作表有 1000 列，只抽出 42 列」會在 10 幾張表上誤報——
       那 958 列是空的，不是被結構判壞吃掉的。 */
    const srcFilled = sh.grid.filter(r =>
      (r || []).some(v => String(v == null ? '' : v).trim() !== '')).length;
    tables.forEach((a, i) => {
      const flags = checkup(a, srcFilled);
      const tag = tables.length > 1 ? ` [表${i + 1}/${tables.length}]` : '';
      shapes[a.shape.label] = (shapes[a.shape.label] || 0) + 1;
      flags.forEach(f => { allFlags[f.split('：')[0]] = (allFlags[f.split('：')[0]] || 0) + 1; });
      if (flags.length) flagged++; else clean++;

      records.push({
        src: base, sheet: sh.name, sheetIndex: shIdx, status: flags.length ? 'flagged' : 'clean',
        table: i + 1, of: tables.length,
        shape: a.shape.shape, label: a.shape.label,
        reason: a.shape.reason || null,        // 引擎為什麼這樣判——真正要人複核的東西
        srcRows: sh.grid.length, rows: a.rows.length,
        cols: a.cols.length, live: a.cols.filter(c => c.type !== 'empty').length,
        headerRow: a.headerRow, title: a.title || null,
        notes: a.notes || [],                  // 做過哪些結構轉換
        roles: { title: roleName(a.roles.title), group: roleName(a.roles.group),
                 lead: roleName(a.roles.lead), person: roleName(a.roles.person) },
        /* 被藏起來的欄（單號、流水號）。codeLike 同時決定「扣標題分數」與
           「這一欄要不要藏」，但 baseline 只看得到標題——改 codeLike 時，
           標題的變化看得見，藏不藏的變化完全看不見。既然這一版就在改它，
           就得記下來，否則下一輪的 diff 會漏掉一半的影響。 */
        hidden: (a.roles.hidden || []).map(c => c.name),
        /* 型別後面補上「填充率%／相異值數」。
           這一欄原本只有 name:type，結果每次想回答「為什麼這一欄沒當上標題」
           都卡住——pickTitle 看的是 fillRate 與 distinct，baseline 兩個都沒記，
           在沒有原始檔的機器上就只能猜。filterOptions 的 avg 門檻也一樣。
           多這兩個數字，baseline 才真的能獨立回答判定問題。 */
        colTypes: a.header.map((h, j) => {
          const c = a.cols[j];
          return `${h}:${c.type}:${Math.round(c.fillRate * 100)}%:${c.distinct}`;
        }),
        flags
      });

      if (flags.length) {
        say(`\n${C.y('!')} ${C.b(sh.name + tag)}`);
        say(C.d(`  ${a.shape.label} · ${a.rows.length} 列 · 標題列第 ${a.headerRow + 1} 列` +
                `${a.title ? ' · ' + a.title.slice(0, 40) : ''}`));
        flags.forEach(f => say(C.y(`  · ${f}`)));
      } else {
        say(`${C.g('✓')} ${sh.name + tag} ${C.d(a.shape.label + ' · ' + a.rows.length + ' 列')}`);
      }
    });
  }
}

// 鍵要排序：計數沒變但「第一次遇到的順序」變了，不該讓 baseline 的 diff 整段重排
const sortKeys = o => Object.fromEntries(Object.entries(o).sort((a, b) => a[0] < b[0] ? -1 : 1));
const summary = { inputs: args.length, sheets: clean + flagged + skipped + broken,
                  clean, flagged, skipped, broken,
                  shapes: sortKeys(shapes), flags: sortKeys(allFlags) };

say('\n' + '='.repeat(66));
say(C.b(`${clean} 乾淨 · ${flagged} 可疑 · ${skipped} 非資料頁（略過） · ${broken} 讀不進來`));
say(C.d('形狀分佈：' + Object.entries(shapes).map(([k, v]) => `${k} ${v}`).join('、')));
if (Object.keys(allFlags).length) {
  say(C.d('最常見的問題：'));
  Object.entries(allFlags).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .forEach(([k, v]) => say(C.d(`  ${v}×  ${k}`)));
}

if (JSONOUT) {
  const fp = { engine: sha(fs.readFileSync(path.join(here, 'detect.js'))),
               audit: sha(fs.readFileSync(fileURLToPath(import.meta.url))) };
  /* --private：在寫出去的那一刻遮，不在每個 records.push 那邊遮。
     理由是會漏——記錄有四個產生點（讀不進來、引擎爆掉、不渲染、正常），
     而以後加欄位時不會有人記得去補第五個地方。這裡是唯一的出口。 */
  /* 把每一句訊息換成固定的代號。

     前兩版都是「把壞東西刮掉」——第一版只清「」，第二版加上（）跟：後面。
     兩版都漏，而且是同一類錯誤：欄名本身含括號時，
     「…之後（如果有的話），我會感興趣。」裡的內層括號先被吃掉，
     外層那串欄名清單整個逃出去。刮除法證不出安全。

     白名單相反：對不上任何一條就回 other，引擎的散文一個字都不輸出。
     就算欄名剛好含有某條的字樣，結果也只是「代號標錯」，不是洩漏。 */
  const KIND = [
    // 判型的理由
    [/判定為明細帳而非排程/, 'ledger-sparse-date'],
    [/不拿它分組，改當列名/, 'schedule-date-spread'],
    [/偵測到日期欄/, 'schedule-date'],
    [/但沒有日期欄，視為單日流程表/, 'schedule-time-only'],
    [/為主要名稱/, 'directory-contact'],
    [/改用比較完整的/, 'matrix-alt-label'],
    [/是標籤，後面/, 'matrix-first-col'],
    [/為品項名稱/, 'pricelist-money'],
    [/種狀態/, 'board-status'],
    [/分組後逐列呈現/, 'cards-group'],
    [/為標題逐列呈現/, 'cards-title'],
    [/逐列呈現所有欄位/, 'cards-bare'],
    [/把期間攤平成.*當前導/, 'unpivot-period-pinned'],
    // 結構轉換
    [/個期間欄位攤平成/, 'unpivot-period'],
    [/個星期欄位攤平成/, 'unpivot-week'],
    [/向下填補合併儲存格/, 'filldown'],
    [/個排版用的空白欄/, 'drop-empty-cols'],
    [/依重複的欄名切成並排的表格/, 'split-dup-headers'],
    [/收合成單一/, 'collapse-periods'],
    // 警示
    [/標題列可能判錯/, 'bad-header-row'],
    [/找不到主標題欄/, 'no-title-col'],
    [/列沒有標題也沒有內容，會被整列略過/, 'rows-without-title'],
    [/型別偵測沒抓到東西/, 'all-text'],
    [/落到一般表格/, 'generic'],
    [/只有一種值，等於沒分組/, 'group-single-value'],
    [/會碎成一堆單筆段落/, 'group-too-many'],
    [/沒有任何資料列/, 'no-rows'],
    [/只有一列資料，判斷幾乎沒有依據/, 'one-row'],
    [/結構可能判壞/, 'few-rows-extracted'],
    [/欄有欄名但整欄沒資料/, 'empty-declared-cols'],
    // 不渲染的理由
    [/整張工作表空白/, 'sheet-blank'],
    [/切不出任何表格區塊/, 'no-table'],
    [/月曆格子/, 'calendar-grid'],
    [/列資料$/, 'too-few-rows'],
    [/沒有任何有值的欄位/, 'no-live-cols'],
    [/沒有任何文字欄名/, 'no-text-headers'],
    [/欄名本身就是句子/, 'headers-are-sentences'],
    [/每一欄都是長文字/, 'all-longtext'],
    [/只有一欄長文字/, 'single-longtext'],
    [/只有一欄有值/, 'only-one-live-col'],
    [/只有一兩欄短文字/, 'dropdown-source'],
  ];
  /* 只有這幾個代號可以帶數字：它們的訊息裡唯一的變數就是計數。
     其餘一律不帶——「分組欄「0915373201」只有一種值」這種訊息裡的數字
     有可能是欄名本身（判錯標題列時就是一格電話），抓出來就是洩漏。 */
  const NUM_OK = new Set(['bad-header-row', 'rows-without-title', 'few-rows-extracted',
    'empty-declared-cols', 'unpivot-period', 'unpivot-week', 'drop-empty-cols',
    'collapse-periods', 'too-few-rows']);
  const kindOf = t => {
    if (typeof t !== 'string') return t;
    const hit = KIND.find(([re]) => re.test(t));
    if (!hit) return 'other';
    const nums = NUM_OK.has(hit[1]) ? (t.match(/\d+/g) || []).join('/') : '';
    return nums ? hit[1] + ' ' + nums : hit[1];
  };

  const mask = r => {
    if (!PRIVATE) return r;
    const o = { ...r };
    // 工作表名換成「檔案代號 › #序號」：原名可能帶人名、客戶、專案，
    // 但同一個活頁簿裡的表要看得出是同一個檔（它們通常共用結構）。
    o.src = hid(r.src);
    o.sheet = r.sheet == null ? null : o.src + ' › #' + (r.sheetIndex ?? 0);
    delete o.sheetIndex;
    delete o.title;        // 表格上方的前言，整段都是原始內容
    delete o.label;        // 這是我們自己的中文形狀名，shape 已經夠了
    if (o.why) o.why = r.status === 'clean' || r.status === 'flagged' ? kindOf(o.why)
                     : (r.status === 'unreadable' ? 'unreadable' : 'engine-threw');
    if (o.reason) o.reason = kindOf(o.reason);
    if (o.notes) o.notes = o.notes.map(kindOf);
    if (o.flags) o.flags = o.flags.map(kindOf);
    // 欄名整個丟掉，只留「型別:填充率:相異值數」
    if (o.colTypes) o.colTypes = o.colTypes.map(t => t.split(':').slice(-3).join(':'));
    if (o.hidden) o.hidden = o.hidden.length;        // 藏了幾欄，不是哪幾欄
    // 角色有沒有，不是叫什麼
    if (o.roles) o.roles = Object.fromEntries(Object.entries(o.roles).map(([k, v]) => [k, !!v]));
    return o;
  };

  /* 硬斷言：私密模式寫出去的每一個字串，都必須是代號或純數字。
     這一條把「有沒有散文逃出去」從期望變成測得到的事。
     前兩版的洩漏都會在這裡被擋下來。 */
  const SAFE = /^[a-z][a-z0-9-]*( \d+(\/\d+)*)?$/;
  const auditSafe = (obj, path = '') => {
    const bad = [];
    const walk = (v, p) => {
      if (typeof v === 'string') {
        // fingerprint 是引擎與這支程式的 sha，開頭可能是數字，整個子樹豁免
        if (p === '.fingerprint' || p.indexOf('.fingerprint.') === 0) return;
        if (p.endsWith('.src') || p.endsWith('.sheet')) return;
        if (/\.colTypes\[/.test(p)) { if (!/^(empty|text|longtext|number|money|date|time|person|phone|email|url|status|category):\d+%:\d+$/.test(v)) bad.push(p + ' = ' + v); return; }
        if (/\.shape$/.test(p) || /\.status$/.test(p)) return;
        if (!SAFE.test(v)) bad.push(p + ' = ' + v);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, p + '[' + i + ']'));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, p + '.' + k));
    };
    walk(obj, path);
    return bad;
  };

  const masked = records.map(mask);
  /* summary.shapes 的鍵是我們自己的中文形狀名（「品項／價目表」），不是資料；
     summary.flags 的鍵是訊息，要換成代號。 */
  const sum = PRIVATE
    ? { ...summary,
        flags: Object.entries(summary.flags).reduce((m, [k, v]) => {
          const key = kindOf(k); m[key] = (m[key] || 0) + v; return m; }, {}),
        shapes: summary.shapes }
    : summary;
  const payload = { fingerprint: fp, private: PRIVATE || undefined, summary: sum, records: masked };

  if (PRIVATE) {
    const bad = auditSafe({ fingerprint: fp, records: masked, flags: Object.keys(sum.flags) });
    if (bad.length) {
      console.error(`停下來：私密模式有 ${bad.length} 個字串不是代號或數字——那就是散文漏出去了。`);
      bad.slice(0, 5).forEach(b => console.error('    ' + b));
      console.error('不寫 baseline。把上面幾行回報給我。');
      process.exit(4);
    }
    console.error('✓ 私密模式：寫出去的每一個字串都是代號或數字');
  }
  const body = JSON.stringify(payload, null, 1);

  /* 一張都沒讀進來的 baseline 沒有任何價值，卻足以覆蔓上一份好的。
     路徑打錯、資料夾沒抱下來、參數被 # 吃掉，都會落到這裡。 */
  if (clean + flagged === 0) {
    console.error(`停下來：${args.length} 個輸入沒有任何一張表跑出結果（${broken} 讀不進來）。`);
    console.error('不寫 baseline——先確認路徑。');
    process.exit(3);
  }

  if (OUT) {
    const tmp = OUT + '.tmp';
    fs.writeFileSync(tmp, body + '\n');
    fs.renameSync(tmp, OUT);
    say(C.d(`baseline 寫入 ${OUT}`));
  } else {
    P(body);
  }
}
