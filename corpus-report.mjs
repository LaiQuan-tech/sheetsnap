#!/usr/bin/env node
/**
 * 語料總結：把 audit.mjs --json 的 baseline 讀成「通用做不做得到」的答案。
 *
 *   node audit.mjs corpus-ms/files --json > corpus-ms/baseline.json
 *   node corpus-report.mjs corpus-ms/baseline.json
 *
 * 為什麼不直接看 audit 的總數：163 份裡有 86 份是財務或圖表類，
 * 其中 chart 那 24 份本來就是圖表資料區，引擎「拒絕渲染」才是正確答案。
 * 混在一起算，乾淨率會被這批拉低或拉高，都看不出真相。
 * 所以這支照分類切——檔名前綴就是微軟的範本分類。
 */
import fs from 'node:fs';

const file = process.argv[2] || 'corpus-ms/baseline.json';
if (!fs.existsSync(file)) {
  console.error(`讀不到 ${file}\n先跑：node audit.mjs corpus-ms/files --json > corpus-ms/baseline.json`);
  process.exit(1);
}
const B = JSON.parse(fs.readFileSync(file, 'utf8'));
const R = B.records || [];
if (!R.length) { console.error('baseline 裡沒有任何記錄'); process.exit(1); }

const C = { b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`,
            g: s => `\x1b[32m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m` };
const cat = r => (String(r.src).split('_')[0] || '').replace(/\.(xlsx|xls|csv|tsv)$/i, '') || '（其他）';
const pct = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '—';
const tally = (rows, fn) => rows.reduce((m, r) => { const k = fn(r); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const bar = (v, max, w = 18) => '█'.repeat(Math.max(0, Math.round(v / max * w))) + C.d('·'.repeat(w - Math.max(0, Math.round(v / max * w))));

const shown = R.filter(r => r.status === 'clean' || r.status === 'flagged');
const files = new Set(R.map(r => r.src)).size;

console.log(C.b(`\n═══ ${files} 個檔 · ${R.length} 張工作表 ═══`));
console.log(C.d(`引擎指紋 ${B.fingerprint ? B.fingerprint.engine : '?'} · audit ${B.fingerprint ? B.fingerprint.audit : '?'}`));
const st = tally(R, r => r.status);
console.log(`  ${C.g(st.clean || 0)} 乾淨 · ${C.y(st.flagged || 0)} 可疑 · ` +
            `${st['not-shown'] || 0} 不渲染 · ${C.r((st.unreadable || 0) + (st['engine-threw'] || 0))} 讀不進來`);

/* ── 依分類：哪些範本類型撐得住 ── */
console.log(C.b('\n─── 依範本分類 ───'));
console.log(C.d('  分類          表  乾淨  可疑 不渲染 壞  乾淨率(在渲染的裡面)  最常見的形狀'));
const cats = [...new Set(R.map(cat))].sort((a, b) =>
  R.filter(r => cat(r) === b).length - R.filter(r => cat(r) === a).length);
for (const c of cats) {
  const rs = R.filter(r => cat(r) === c);
  const s = tally(rs, r => r.status);
  const sh = rs.filter(r => r.status === 'clean' || r.status === 'flagged');
  const shapes = top(tally(sh, r => r.label), 2).map(([k, v]) => `${k} ${v}`).join('、') || C.d('—');
  console.log(`  ${c.padEnd(12)} ${String(rs.length).padStart(3)} ${String(s.clean||0).padStart(5)} ` +
    `${String(s.flagged||0).padStart(5)} ${String(s['not-shown']||0).padStart(5)} ` +
    `${String((s.unreadable||0)+(s['engine-threw']||0)).padStart(3)}  ` +
    `${pct(s.clean||0, sh.length).padStart(8)}              ${shapes}`);
}

/* ── 形狀分佈：落到「一般表格」的比例就是「沒找到主軸」的比例 ── */
console.log(C.b('\n─── 形狀分佈（會渲染的 ' + shown.length + ' 張）───'));
const shapes = tally(shown, r => r.label);
const smax = Math.max(...Object.values(shapes), 1);
for (const [k, v] of top(shapes, 10))
  console.log(`  ${k.padEnd(12)} ${String(v).padStart(4)} ${pct(v, shown.length).padStart(5)}  ${bar(v, smax)}`);
const generic = shown.filter(r => r.shape === 'cards').length;
console.log(C.d(`\n  落到「一般表格」= 沒辨識出任何主軸：${generic}/${shown.length}（${pct(generic, shown.length)}）`));
console.log(C.d('  這個數字就是「通用做不做得到」最直接的指標。'));

/* ── 不渲染的原因：拒絕得對不對 ── */
const ns = R.filter(r => r.status === 'not-shown');
if (ns.length) {
  console.log(C.b(`\n─── 不渲染的 ${ns.length} 張，原因 ───`));
  for (const [k, v] of top(tally(ns, r => r.why), 8)) console.log(`  ${String(v).padStart(4)}×  ${k}`);
}

/* ── 旗標：哪一種判壞最常見 ── */
const flags = {};
shown.forEach(r => (r.flags || []).forEach(f => { const k = f.split('：')[0]; flags[k] = (flags[k] || 0) + 1; }));
if (Object.keys(flags).length) {
  console.log(C.b('\n─── 體檢旗標排行 ───'));
  for (const [k, v] of top(flags, 10)) console.log(`  ${String(v).padStart(4)}×  ${k}`);
}

/* ── 型別偵測有沒有抓到東西：通用化的真正瓶頸 ── */
console.log(C.b('\n─── 型別與角色（會渲染的表）───'));
const allText = shown.filter(r => (r.colTypes || []).filter(t => !/:empty$/.test(t)).every(t => /:text$/.test(t)));
const noTitle = shown.filter(r => r.roles && !r.roles.title);
const noGroup = shown.filter(r => r.roles && !r.roles.group);
console.log(`  所有欄都只判成一般文字：${allText.length}（${pct(allText.length, shown.length)}）` +
            C.d('  ← 型別偵測完全沒抓到，多半是欄名語感不吃'));
console.log(`  找不到主標題欄：      ${noTitle.length}（${pct(noTitle.length, shown.length)}）` +
            C.d('  ← 卡片會沒有名字'));
console.log(`  沒有分組軸：          ${noGroup.length}（${pct(noGroup.length, shown.length)}）`);
const types = {};
shown.forEach(r => (r.colTypes || []).forEach(t => { const ty = t.slice(t.lastIndexOf(':') + 1); types[ty] = (types[ty] || 0) + 1; }));
console.log(C.d('  欄位型別總計：' + top(types, 12).map(([k, v]) => `${k} ${v}`).join('、')));

/* ── 結構轉換：前處理做了多少事 ── */
const noted = shown.filter(r => (r.notes || []).length);
if (noted.length) {
  console.log(C.b(`\n─── 做過結構轉換的 ${noted.length} 張 ───`));
  const nt = {}; noted.forEach(r => r.notes.forEach(n => { const k = String(n).slice(0, 40); nt[k] = (nt[k] || 0) + 1; }));
  for (const [k, v] of top(nt, 8)) console.log(`  ${String(v).padStart(4)}×  ${k}`);
}

/* ── 最該看畫面的幾張：旗標最多的 ── */
const worst = shown.filter(r => (r.flags || []).length).sort((a, b) => b.flags.length - a.flags.length).slice(0, 12);
if (worst.length) {
  console.log(C.b('\n─── 旗標最多的 12 張（拿 gallery.mjs 去看畫面）───'));
  worst.forEach(r => console.log(`  ${C.y(String(r.flags.length))} ${r.sheet.slice(0, 52).padEnd(52)} ${C.d(r.label)}`));
}
console.log('');
