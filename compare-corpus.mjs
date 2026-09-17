#!/usr/bin/env node
/**
 * AI 輔助會不會更好？——拿語料裡「規則層做不好」的那些工作表去問模型，量出來。
 *
 *   export ANTHROPIC_API_KEY=...
 *   node compare-corpus.mjs [最多幾張，預設 40] [資料夾，預設 corpus-ms/files]
 *
 * 只挑三種表：引擎自己標「可能沒讀對」的、落到一般表格的、找不到標題欄的。
 * 乾淨的表不用問——那是規則層已經會的東西，問了只是花錢。
 * 送給模型的是欄位摘要、原始前 8 列、幾列樣本（跟 semantic.js 一樣，不是整張表）。
 * 結果寫到 corpus-ms/ai-compare.html（不進 repo），每列都能在本機打開真實畫面對照。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import Anthropic from '@anthropic-ai/sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const g = {};
for (const f of ['detect.js', 'semantic.js']) new Function('window', fs.readFileSync(path.join(here, f), 'utf8'))(g);
const { SheetShape: S, SheetSemantic: SEM } = g;
const MODEL = 'claude-opus-5';
const LIMIT = +(process.argv[2] || 40);
const DIR = process.argv[3] || 'corpus-ms/files';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('請先設定 ANTHROPIC_API_KEY'); process.exit(1); }
if (!/^[\x20-\x7E]+$/.test(KEY) || !/^sk-ant-\S{20,}$/.test(KEY)) { console.error('ANTHROPIC_API_KEY 看起來不是真的金鑰'); process.exit(1); }

// ── 挑出問題表 ──
const cases = [];
for (const f of fs.readdirSync(DIR).filter(x => /\.xlsx$/i.test(x)).sort()) {
  const wb = XLSX.readFile(path.join(DIR, f));
  let shown = 0;
  wb.SheetNames.forEach(nm => {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: '', raw: false });
    const tables = S.analyseSheet(grid).tables;
    if (S.sheetVerdict(grid, tables).show !== true) return;
    const si = shown++;
    const a = tables.reduce((x, y) => (y.rows.length > x.rows.length ? y : x));
    const warns = S.fidelityWarnings(a);
    const why = warns.length ? 'warned' : a.shape.shape === 'cards' ? 'generic' : !a.roles.title ? 'notitle' : '';
    if (!why) return;
    cases.push({ f, nm, si, grid, a, why, warns });
  });
}
// 三類平均取樣，順序固定，跑兩次結果可比
const byWhy = { warned: [], generic: [], notitle: [] };
cases.forEach(c => byWhy[c.why].push(c));
const picked = [];
for (let i = 0; picked.length < Math.min(LIMIT, cases.length); i++)
  for (const k of ['warned', 'generic', 'notitle']) if (byWhy[k][i] && picked.length < LIMIT) picked.push(byWhy[k][i]);
console.error(`問題表共 ${cases.length}（警示 ${byWhy.warned.length}、一般表格 ${byWhy.generic.length}、沒標題欄 ${byWhy.notitle.length}），這次問 ${picked.length} 張`);

// ── 問模型 ──
const client = new Anthropic();
async function ask(a, grid) {
  const res = await client.messages.create({
    model: MODEL, max_tokens: 16000, thinking: { type: 'adaptive' },
    system: SEM.SYSTEM,
    messages: [{ role: 'user', content: SEM.buildInput(a, grid) }],
    output_config: { format: { type: 'json_schema', schema: SEM.SCHEMA } },
  });
  if (res.stop_reason === 'refusal') throw new Error('模型拒答');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { v: JSON.parse(text), usage: res.usage };
}

const results = [];
let inTok = 0, outTok = 0, done = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: 3 }, async () => {        // 三條並行
  while (picked.length) {
    const c = picked.shift();
    const st = Date.now();
    try {
      const { v, usage } = await ask(c.a, c.grid);
      inTok += usage.input_tokens; outTok += usage.output_tokens;
      const header = c.a.header.map(h => String(h).trim());
      results.push({
        f: c.f, nm: c.nm, si: c.si, why: c.why, warns: c.warns, ms: Date.now() - st,
        rules: { shape: c.a.shape.label, title: c.a.roles.title?.name || '', group: c.a.roles.group?.name || '' },
        model: {
          shape: SEM.SHAPE_ZH?.[v.shape] || v.shape, title: v.title_column || '', group: v.group_column || '',
          title_exists: !!v.title_column && header.includes(v.title_column),
          structure_ok: v.structure_ok, problem: v.structure_problem, hide: v.hide_columns || [],
          reason: v.shape_reason, disagreements: v.disagreements || [], confidence: v.confidence,
        },
      });
    } catch (e) { results.push({ f: c.f, nm: c.nm, si: c.si, why: c.why, err: e.message }); }
    done++; process.stderr.write(`\r${done} 張完成`);
  }
}));
process.stderr.write('\n');

// ── 統計 ──
const ok = results.filter(r => !r.err);
const stat = (why) => {
  const rs = ok.filter(r => r.why === why);
  return {
    n: rs.length,
    titleFound: rs.filter(r => r.model.title_exists).length,
    shapeChanged: rs.filter(r => r.model.shape !== r.rules.shape).length,
    flagged: rs.filter(r => !r.model.structure_ok).length,
    high: rs.filter(r => r.model.confidence === 'high').length,
  };
};
const summary = { asked: results.length, failed: results.length - ok.length, warned: stat('warned'), generic: stat('generic'), notitle: stat('notitle'),
  inTok, outTok, secs: Math.round((Date.now() - t0) / 1000), avgMs: Math.round(ok.reduce((a, r) => a + r.ms, 0) / Math.max(ok.length, 1)) };
console.error(JSON.stringify(summary, null, 1));

// ── HTML ──
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const base = 'http://localhost:8765/';
const cell = (r, m) => `<td>${esc(r.shape)}<br><small>標題 ${esc(r.title || '—')} · 分組 ${esc(r.group || '—')}</small></td>`;
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI 輔助 vs 規則層</title>
<style>body{margin:0;padding:16px;font:13px/1.5 -apple-system,"PingFang TC","Noto Sans TC",sans-serif;color:#16191d;background:#f3f4f6}
h1{font-size:18px;margin:0 0 8px}.sum{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 16px}.sum div{background:#fff;border:1px solid #e2e5ea;border-radius:8px;padding:8px 12px}.sum b{display:block;font-size:18px;color:#0c744a}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e5ea;font-size:12.5px}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #eef0f3;vertical-align:top}th{font-size:11px;color:#8b94a0}
small{color:#4b5563}.why{font-size:11px;color:#8b94a0}.p{color:#b3261e}.d{color:#4b5563;font-size:11.5px}a{color:#0c744a}.c-high{color:#0c744a}.c-low{color:#b3261e}</style>
<h1>AI 輔助 vs 規則層 · ${ok.length} 張問題表</h1>
<div class="sum">
<div><b>${summary.notitle.titleFound}/${summary.notitle.n}</b>沒標題欄的表，模型指出了一個真的存在的標題欄</div>
<div><b>${summary.generic.shapeChanged}/${summary.generic.n}</b>一般表格，模型給了更具體的版面</div>
<div><b>${summary.warned.flagged}/${summary.warned.n}</b>引擎警示的表，模型也說結構有問題</div>
<div><b>${ok.filter(r => r.model.confidence === 'high').length}/${ok.length}</b>模型自認 high</div>
<div><b>${summary.avgMs} ms</b>平均一張 · 共 ${summary.secs} 秒</div>
<div><b>${inTok + outTok}</b>tokens（進 ${inTok} / 出 ${outTok}）</div>
</div>
<table><tr><th>表</th><th>為什麼問</th><th>規則層</th><th>模型</th><th>模型的話</th></tr>
${results.map(r => r.err ? `<tr><td>${esc(r.f)} › ${esc(r.nm)}</td><td colspan="4" class="p">失敗：${esc(r.err)}</td></tr>` :
`<tr><td><a href="${base}?f=${esc(DIR)}/${encodeURIComponent(r.f)}&sheet=${r.si}" target="_blank">${esc(r.f)} › ${esc(r.nm)}</a><div class="why">${esc(r.why)}${r.warns.length ? '：' + esc(r.warns.join(' ')) : ''}</div></td>
<td class="why">${esc(r.why)}</td>${cell(r.rules)}${cell(r.model)}
<td><div>${esc(r.model.reason)}</div>${r.model.structure_ok ? '' : '<div class="p">結構：' + esc(r.model.problem) + '</div>'}${r.model.disagreements.map(d => '<div class="d">· ' + esc(d) + '</div>').join('')}${r.model.hide.length ? '<div class="d">收起：' + esc(r.model.hide.join('、')) + '</div>' : ''}<div class="c-${esc(r.model.confidence)}">信心 ${esc(r.model.confidence)}</div></td></tr>`).join('\n')}
</table>`;
fs.writeFileSync(path.join(here, 'corpus-ms', 'ai-compare.html'), html);
fs.writeFileSync(path.join(here, 'corpus-ms', 'ai-compare.json'), JSON.stringify({ summary, results }, null, 1));
console.error('寫到 corpus-ms/ai-compare.html（在本機 http://localhost:8765/corpus-ms/ai-compare.html 打開）');
