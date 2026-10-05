#!/usr/bin/env node
/**
 * 語料總覽：把一個資料夾的範本全部跑過引擎，產出一頁 HTML，
 * 每張工作表一列——判定形狀、給了哪些看法、有沒有警示——
 * 並且每列都能一鍵在本機的 SheetSnap 打開看真實畫面（?f=）。
 *
 *   node gallery.mjs corpus-ms/files > corpus-ms/gallery.html
 *   node gallery.mjs corpus-ms/files --out corpus-ms/gallery-summary.json > corpus-ms/gallery.html
 *
 * 用途只有一個：回答「通用做不做得到」——不是看數字，是看畫面。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const g = {};
new Function('window', fs.readFileSync(path.join(here, 'detect.js'), 'utf8'))(g);
const S = g.SheetShape;
/* zsh 預設沒開 interactive_comments，行尾的 # 註解不是註解而是參數，
   所以「node gallery.mjs  # 看卡片供給」會拿 # 當資料夾，丟出一堆 node:fs 堆疊。 */
const argv = process.argv.slice(2);
/* --out：把摘要寫成一個跟 baseline.json 同等地位的檔。
   看法供給（幾張表拿到排名、幾張只剩搜尋）跟形狀判定一樣會回歸，
   而原本只寫 stderr——跑完捲走就沒了，比不了上一版。
   HTML 仍然走 stdout；寫檔是先 .tmp 再 rename，跑失敗不動舊檔。 */
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null;
if (outIdx >= 0 && !OUT) {
  console.error('--out 後面要接檔名，例如 --out corpus-ms/gallery-summary.json');
  process.exit(1);
}
const arg = argv.filter((a, i) =>
  a !== '--out' && !(outIdx >= 0 && i === outIdx + 1))[0];
if (arg && arg.startsWith('#')) {
  console.error(`停下來：資料夾參數是「${arg}」。`);
  console.error('zsh 不把行尾的 # 當註解。把註解刪掉再跑一次。');
  process.exit(2);
}
const dir = arg || 'corpus-ms/files';
if (!fs.existsSync(dir)) {
  console.error(`找不到資料夾 ${dir}`);
  console.error('語料沒進版控；先跑 ./corpus-ms/fetch.sh 把 163 份範本抓下來。');
  process.exit(1);
}
const base = 'http://localhost:8765/';

// 跟 index.html 的 buildViews 同一套規則（中文標籤）
/* index.html 的 buildViews() 在這裡的鏡像。兩邊重複是為了讓這支工具能
   獨立跑，代價是會漂移——v57 的三張卡上限、v63 的分組優先與去重、
   v67 的排名，這裡原本一個都沒有，於是表格顯示的是「候選清單」而不是
   使用者真正看到的三張卡。改 buildViews 時要回來同步這裡。 */
function views(a, raw) {
  const live = a.cols.filter(c => c.type !== 'empty');
  const roles = a.roles || {};
  const date = live.find(c => c.type === 'date'), time = live.find(c => c.type === 'time');
  const go = S.groupOptions(a);

  let timeView = null;
  if (date) {
    const gd = go.find(x => x.name === date.name);
    if (gd) timeView = { id: 'time', k: `照時間看（${gd.groups} 段）`, col: date.name };
  } else if (time) {
    timeView = { id: 'time', k: `照時間看（依「${String(time.name).replace(/\s+/g, ' ')}」排序）`, col: null };
  }

  const g0 = go.filter(x => x.type !== 'date')[0];
  const groupView = g0 ? { id: 'group', k: `照${g0.name}分類（${g0.groups}）`, col: g0.name } : null;

  const fopts = S.filterOptions(a).slice(0, 2);
  const mkF = f => ({ id: 'filter', k: `只看某個${f.name}（${f.options}）`, col: f.name });
  const whoFilters = fopts.filter(f => f.type === 'person').map(mkF);
  const otherFilters = fopts.filter(f => f.type !== 'person').map(mkF);
  const filterViews = whoFilters.concat(otherFilters);

  const q = S.summarise(S.quotedFacts(raw, a));
  const factsView = q.length ? { id: 'facts', k: `看重點數字（${q.length}）`, col: null } : null;

  // 排名：矩陣只在有「合計」欄時才給（月份橫排挑一個月來排沒有意義）
  const moneyCols = live.filter(c => c.type === 'money');
  const numCols = live.filter(c => c.type === 'number');
  const totalCol = moneyCols.concat(numCols)
    .find(c => /含稅|總|合計|應收|小計|total|amount|sum/i.test(c.name));
  let rankCol = a.shape.matrix
    ? (totalCol || null)
    : ((roles.lead && /^(money|number)$/.test(roles.lead.type)) ? roles.lead
       : totalCol
         || (moneyCols.length ? moneyCols[moneyCols.length - 1] : null)
         || (numCols.length === 1 ? numCols[0] : null));
  if (rankCol && roles.title && rankCol.name === roles.title.name) rankCol = null;
  // col 留 null：index.html 的去重也不拿排名去比，兩邊要一致
  const rankView = (rankCol && a.rows.length >= 5)
    ? { id: 'rank', k: `照${rankCol.name}由大到小`, col: null } : null;

  // v68：沒有時間軸時人員篩選插在排名之前（index.html 才是正本）
  let cand = timeView
    ? [timeView].concat(filterViews, factsView ? [factsView] : [],
        groupView ? [groupView] : [], rankView ? [rankView] : [])
    : (groupView ? [groupView] : []).concat(whoFilters,
        rankView ? [rankView] : [], otherFilters,
        factsView ? [factsView] : []);

  const seen = {};
  cand = cand.filter(v => { if (!v.col) return true; if (seen[v.col]) return false; seen[v.col] = 1; return true; });

  return cand.slice(0, 2).concat([{ id: 'all', k: '直接搜尋', col: null }]);   // PICK_MAX - 1 = 2
}

const rows = [];
const files = fs.readdirSync(dir).filter(f => /\.(xlsx|xls|csv)$/i.test(f)).sort();
for (const f of files) {
  const cat = f.split('_')[0];
  let wb;
  /* CSV 要指明 utf8。XLSX.readFile 會把 UTF-8 的 CSV 當成單位元組編碼讀，
     「工作項目」變成「å·¥ä½é ç®」——型別偵測看到亂碼，形狀就判成另一種。
     .xlsx 是 zip、編碼寫在裡面，照舊走二進位。audit.mjs 本來就是分開處理的。 */
  try {
    const fp = path.join(dir, f);
    wb = /\.(csv|tsv)$/i.test(f)
      ? XLSX.read(fs.readFileSync(fp, 'utf8'), { type: 'string' })
      : XLSX.readFile(fp);
  } catch (e) { rows.push({ f, cat, err: e.message }); continue; }
  let shown = 0;
  wb.SheetNames.forEach((nm, si) => {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: '', raw: false });
    const tables = S.analyseSheet(grid).tables;
    const v = S.sheetVerdict(grid, tables);
    if (v.show !== true) { rows.push({ f, cat, sheet: nm, si, skipped: v.why }); return; }
    const a = tables.reduce((x, y) => (y.rows.length > x.rows.length ? y : x));
    const roles = a.roles || {};
    const warns = S.fidelityWarnings(a);
    const hiddenTitle = !roles.title;
    rows.push({
      f, cat, sheet: nm, si, shownIdx: shown++,
      shape: a.shape.label, shapeId: a.shape.shape, rowsN: a.rows.length, colsN: a.cols.filter(c => c.type !== 'empty').length,
      header: a.headerRow + 1, tables: tables.length,
      title: roles.title ? roles.title.name : '', group: roles.group ? roles.group.name : '', lead: roles.lead ? roles.lead.name : '',
      views: views(a, grid), warns, generic: a.shape.shape === 'cards', noTitle: hiddenTitle, oneRow: a.rows.length <= 1,
    });
  });
}

// ── 統計 ──
const shownRows = rows.filter(r => r.shownIdx != null);
const n = shownRows.length;
const cnt = (fn) => shownRows.filter(fn).length;
const summary = {
  files: files.length, sheets: rows.length, shown: n, skipped: rows.filter(r => r.skipped).length,
  warned: cnt(r => r.warns.length), generic: cnt(r => r.generic), noTitle: cnt(r => r.noTitle), oneRow: cnt(r => r.oneRow),
  withTime: cnt(r => r.views.some(v => v.id === 'time')), withFilter: cnt(r => r.views.some(v => v.id === 'filter')),
  withFacts: cnt(r => r.views.some(v => v.id === 'facts')),
  withGroup: cnt(r => r.views.some(v => v.id === 'group')),
  withRank: cnt(r => r.views.some(v => v.id === 'rank')),
  onlySearch: cnt(r => r.views.length === 1),
  shapes: Object.entries(shownRows.reduce((m, r) => (m[r.shape] = (m[r.shape] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]),
  byCat: Object.entries(shownRows.reduce((m, r) => {
    const c = m[r.cat] || (m[r.cat] = { n: 0, ok: 0 }); c.n++;
    if (!r.warns.length && !r.generic && !r.noTitle && !r.oneRow) c.ok++; return m;
  }, {})).sort((a, b) => b[1].n - a[1].n),
};
const okAll = cnt(r => !r.warns.length && !r.generic && !r.noTitle && !r.oneRow);
summary.clean = okAll;

/* 每張表實際給了哪三張卡，逐列記下來。
   只有加總的話，「withTime +11、withFilter −10」這種數字沒辦法回答
   「是哪幾張表拿時間軸換掉了篩選，那筆交易划不划算」——卡片上限是三張，
   一張進來就有一張要走，而加總看不出誰換了誰。
   一列一行，排序固定（檔名、工作表、第幾張表），diff 才讀得出來。 */
summary.rows = shownRows.map(r => ({
  src: r.f, sheet: r.sheet, table: r.si, shape: r.shape,
  views: r.views.map(v => v.id + (v.col ? ':' + v.col : '')),
})).sort((a, b) => (a.src + '|' + a.sheet + '|' + a.table) < (b.src + '|' + b.sheet + '|' + b.table) ? -1 : 1);
const summaryJSON = JSON.stringify(summary, null, 1) + '\n';
if (OUT) {
  if (!n) {
    console.error(`停下來：${files.length} 個檔沒有任何一張表渲染出來。不寫摘要——先確認路徑。`);
    process.exit(3);
  }
  fs.writeFileSync(OUT + '.tmp', summaryJSON);
  fs.renameSync(OUT + '.tmp', OUT);
  console.error(`摘要寫入 ${OUT}`);
} else {
  process.stderr.write(summaryJSON);
}

// ── HTML ──
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
const flag = r => r.warns.length ? '⚠︎ 引擎警示' : r.oneRow ? '· 只有一列' : r.generic ? '· 一般表格' : r.noTitle ? '· 沒標題欄' : '✓';
const cls = r => r.warns.length ? 'bad' : (r.oneRow || r.generic || r.noTitle) ? 'meh' : 'ok';
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>語料總覽 · ${esc(dir)}</title>
<style>
body{margin:0;padding:16px;font:13px/1.5 -apple-system,"PingFang TC","Noto Sans TC",sans-serif;color:#16191d;background:#f3f4f6}
h1{font-size:18px;margin:0 0 4px} .sum{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 16px}
.sum div{background:#fff;border:1px solid #e2e5ea;border-radius:8px;padding:8px 12px;min-width:110px}.sum b{display:block;font-size:20px;color:#0c744a}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e5ea;font-size:12.5px}
th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #eef0f3;vertical-align:top} th{position:sticky;top:0;background:#fff;font-size:11px;color:#8b94a0}
tr.bad td:first-child{border-left:4px solid #b3261e} tr.meh td:first-child{border-left:4px solid #e0b23a} tr.ok td:first-child{border-left:4px solid #0c744a}
tr.skip{color:#8b94a0} .v{display:inline-block;margin:1px 4px 1px 0;padding:1px 7px;border-radius:99px;background:#e4f2ea;color:#0c744a;font-size:11px}
.w{color:#b3261e;font-size:11.5px} a{color:#0c744a} .cat{color:#8b94a0}
</style>
<h1>語料總覽 · ${esc(dir)}</h1>
<div class="sum">
<div><b>${summary.files}</b>個檔案 · ${summary.sheets} 張工作表</div>
<div><b>${n}</b>張會顯示 · ${summary.skipped} 張略過</div>
<div><b>${pct(okAll, n)}</b>乾淨（${okAll}）</div>
<div><b>${pct(summary.warned, n)}</b>引擎警示（${summary.warned}）</div>
<div><b>${pct(summary.generic, n)}</b>落到一般表格（${summary.generic}）</div>
<div><b>${pct(summary.noTitle, n)}</b>沒標題欄（${summary.noTitle}）</div>
<div><b>${pct(summary.oneRow, n)}</b>只有一列（${summary.oneRow}）</div>
<div><b>${pct(summary.withTime, n)}</b>有「照時間看」</div>
<div><b>${pct(summary.withFilter, n)}</b>有「只看某個 X」</div>
<div><b>${pct(summary.withFacts, n)}</b>有「看重點數字」</div>
<div><b>${pct(summary.withGroup, n)}</b>有「照 X 分類」</div>
<div><b>${pct(summary.withRank, n)}</b>有「照 X 由大到小」</div>
<div><b>${pct(summary.onlySearch, n)}</b>只剩「直接搜尋」</div>
</div>
<p>形狀：${summary.shapes.map(([k, v]) => esc(k) + ' ' + v).join(' · ')}<br>
各類乾淨率：${summary.byCat.map(([k, v]) => esc(k) + ' ' + v.ok + '/' + v.n).join(' · ')}</p>
<table><tr><th>檔案 › 工作表</th><th>判定</th><th>列×欄 · 標題列</th><th>標題欄 / 分組 / 前導</th><th>看法</th><th>狀態</th></tr>
${rows.map(r => r.skipped
  ? `<tr class="skip"><td><span class="cat">${esc(r.cat)}</span> ${esc(r.f)} › ${esc(r.sheet)}</td><td colspan="5">略過：${esc(r.skipped)}</td></tr>`
  : r.err ? `<tr class="bad"><td>${esc(r.f)}</td><td colspan="5">讀不進來：${esc(r.err)}</td></tr>`
  : `<tr class="${cls(r)}"><td><span class="cat">${esc(r.cat)}</span> <a href="${base}?f=${esc(dir)}/${encodeURIComponent(r.f)}&sheet=${r.shownIdx}" target="_blank">${esc(r.f)} › ${esc(r.sheet)}</a></td>
<td>${esc(r.shape)}${r.tables > 1 ? ' · ' + r.tables + ' 個表' : ''}</td><td>${r.rowsN}×${r.colsN} · 第 ${r.header} 列</td>
<td>${esc(r.title || '—')} / ${esc(r.group || '—')} / ${esc(r.lead || '—')}</td>
<td>${r.views.map(v => '<span class="v">' + esc(v.k) + '</span>').join('')}</td>
<td>${flag(r)}${r.warns.length ? '<div class="w">' + r.warns.map(esc).join('<br>') + '</div>' : ''}</td></tr>`).join('\n')}
</table>`;
process.stdout.write(html);
