// t.sheetsnap.link
//   POST /e            頁面送事件進來（sendBeacon，text/plain，不用 preflight）
//   GET  /stats?key=…  統計頁（HTML；加 &json=1 給 JSON）
const ALLOW = 'https://sheetsnap.link';
const EVS = new Set(['land', 'upload', 'open', 'view', 'share', 'made', 'error', 'warn', 'diag', 'interact']);

const cors = (extra = {}) => ({
  'Access-Control-Allow-Origin': ALLOW,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  ...extra,
});

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    if (url.pathname === '/e' && req.method === 'POST') {
      let p;
      try { p = JSON.parse((await req.text()).slice(0, 2000)); } catch { return new Response(null, { status: 400, headers: cors() }); }
      if (!p || !EVS.has(p.ev)) return new Response(null, { status: 400, headers: cors() });
      const s = (v) => String(v ?? '').slice(0, 120);
      const ts = Date.now(), day = new Date(ts).toISOString().slice(0, 10);
      await env.DB.prepare(
        'INSERT INTO events (ts, day, ev, sheet, vid, role, src, lang, view, info) VALUES (?,?,?,?,?,?,?,?,?,?)'
      ).bind(ts, day, s(p.ev), s(p.sheet), s(p.vid), s(p.role), s(p.src), s(p.lang), s(p.view), s(p.info)).run();
      return new Response(null, { status: 204, headers: cors() });
    }

    if (url.pathname === '/stats') {
      if (!env.STATS_KEY || url.searchParams.get('key') !== env.STATS_KEY)
        return new Response('forbidden', { status: 403 });
      const d = await stats(env.DB);
      if (url.searchParams.get('json')) return Response.json(d);
      return new Response(page(d), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }

    return new Response('sheetsnap-stats', { status: 200 });
  },
};

async function stats(DB) {
  const one = async (sql) => (await DB.prepare(sql).first()) || {};
  const all = async (sql) => (await DB.prepare(sql).all()).results || [];

  // 1. 多少人做表
  const makers = await one(`SELECT COUNT(DISTINCT vid) AS people, COUNT(*) AS uploads,
      SUM(src='gsheet') AS gsheet, SUM(src='file') AS file FROM events WHERE ev='upload'`);
  // 2/3. 每份表：多少人看、看了幾次、多少人回來第二次
  const sheets = await all(`WITH pv AS (
      SELECT sheet, vid, COUNT(*) AS n, MIN(day) AS first, MAX(day) AS last
      FROM events WHERE ev='open' AND role='viewer' GROUP BY sheet, vid)
    SELECT sheet, COUNT(*) AS viewers, SUM(n) AS opens, SUM(n>=2) AS back,
      ROUND(AVG(n),1) AS avg_opens, MAX(n) AS max_opens, MIN(first) AS first, MAX(last) AS last
    FROM pv GROUP BY sheet ORDER BY opens DESC LIMIT 200`);
  const viewers = await one(`SELECT COUNT(DISTINCT vid) AS people, COUNT(*) AS opens
      FROM events WHERE ev='open' AND role='viewer'`);
  const ret = await one(`WITH pv AS (SELECT sheet, vid, COUNT(*) AS n FROM events
      WHERE ev='open' AND role='viewer' GROUP BY sheet, vid)
    SELECT COUNT(*) AS pairs, SUM(n>=2) AS back FROM pv`);
  const shares = await one(`SELECT COUNT(*) AS n, COUNT(DISTINCT sheet) AS sheets FROM events WHERE ev='share'`);
  const made = await one(`SELECT COUNT(*) AS n, COUNT(DISTINCT vid) AS people FROM events WHERE ev='made'`);
  const views = await all(`SELECT view, COUNT(*) AS n FROM events WHERE ev='view' GROUP BY view ORDER BY n DESC`);
  const days = await all(`SELECT day, SUM(ev='upload') AS uploads, SUM(ev='open' AND role='viewer') AS opens,
      COUNT(DISTINCT CASE WHEN ev='open' AND role='viewer' THEN vid END) AS viewers
      FROM events GROUP BY day ORDER BY day DESC LIMIT 30`);
  // 做表這一端的漏斗：來了 → 載入了一份表 → 選了看法 → 複製了網址
  const funnel = await one(`SELECT
      COUNT(DISTINCT CASE WHEN ev='land' THEN vid END) AS land,
      COUNT(DISTINCT CASE WHEN ev='upload' THEN vid END) AS upload,
      COUNT(DISTINCT CASE WHEN ev='view' THEN vid END) AS view,
      COUNT(DISTINCT CASE WHEN ev='share' THEN vid END) AS share FROM events`);
  // 貼了網址卻讀不到：最安靜的流失
  const errors = await all(`SELECT info AS code, COUNT(*) AS n, COUNT(DISTINCT vid) AS people FROM events WHERE ev='error' GROUP BY info ORDER BY n DESC`);
  const errRate = await one(`SELECT SUM(ev='error') AS err, SUM(ev='upload') AS ok FROM events WHERE ev IN ('error','upload')`);
  // 引擎健康：自己標了「可能沒讀對」的比例、使用者按了「顯示不對」的次數、換看法的頻率
  const engine = await one(`SELECT
      (SELECT COUNT(DISTINCT sheet) FROM events WHERE ev='warn') AS warned,
      (SELECT COUNT(DISTINCT sheet) FROM events WHERE ev='upload') AS sheets,
      (SELECT COUNT(*) FROM events WHERE ev='diag') AS diag,
      (SELECT COUNT(*) FROM (SELECT sheet, vid, COUNT(*) c FROM events WHERE ev='view' GROUP BY sheet, vid HAVING c>=2)) AS switched,
      (SELECT COUNT(*) FROM (SELECT sheet, vid FROM events WHERE ev='view' GROUP BY sheet, vid)) AS chose`);
  const shapes = await all(`SELECT substr(info,1,instr(info,'/')-1) AS shape, COUNT(*) AS n FROM events WHERE ev='upload' AND info LIKE '%/%' GROUP BY shape ORDER BY n DESC`);
  const sizes = await all(`SELECT CASE WHEN instr(substr(info,instr(info,'/')+1),'/')>0
        THEN substr(substr(info,instr(info,'/')+1),1,instr(substr(info,instr(info,'/')+1),'/')-1)
        ELSE substr(info,instr(info,'/')+1) END AS size, COUNT(*) AS n
      FROM events WHERE ev='upload' AND info LIKE '%/%' GROUP BY size ORDER BY n DESC`);
  // 分享有沒有真的送到：複製過網址的表，有幾份被別人打開
  const shareHit = await one(`SELECT COUNT(*) AS shared,
      SUM(EXISTS(SELECT 1 FROM events o WHERE o.ev='open' AND o.role='viewer' AND o.sheet=s.sheet AND o.vid<>s.vid)) AS opened
      FROM (SELECT sheet, vid FROM events WHERE ev='share' GROUP BY sheet) s`);
  // 觀看者變成做表的人：同一台裝置先以觀看者身分打開過，之後自己載入了表
  const loop = await one(`SELECT COUNT(*) AS viewers,
      SUM(EXISTS(SELECT 1 FROM events u WHERE u.ev='upload' AND u.vid=v.vid AND u.ts>v.first)) AS became
      FROM (SELECT vid, MIN(ts) AS first FROM events WHERE ev='open' AND role='viewer' GROUP BY vid) v`);
  // 觀看者有沒有真的用：搜尋、點籤、點日期
  const inter = await one(`SELECT
      (SELECT COUNT(*) FROM (SELECT sheet, vid FROM events WHERE ev='open' AND role='viewer' GROUP BY sheet, vid)) AS pairs,
      (SELECT COUNT(*) FROM (SELECT sheet, vid FROM events WHERE ev='interact' GROUP BY sheet, vid)) AS used`);
  const interKinds = await all(`SELECT info AS kind, COUNT(*) AS n FROM events WHERE ev='interact' GROUP BY info ORDER BY n DESC`);
  // 連結活多久：第一次被打開之後第 7 天還有人開的表
  const life = await one(`SELECT COUNT(*) AS sheets, SUM(span>=7) AS week
      FROM (SELECT sheet, (MAX(ts)-MIN(ts))/86400000.0 AS span FROM events WHERE ev='open' AND role='viewer' GROUP BY sheet)`);
  const refs = await all(`SELECT substr(info,1,instr(info,'|')-1) AS ref, COUNT(DISTINCT vid) AS people FROM events WHERE ev='land' GROUP BY ref ORDER BY people DESC LIMIT 12`);
  const devices = await one(`SELECT SUM(info LIKE '%|m') AS mobile, SUM(info LIKE '%|d') AS desktop FROM events WHERE ev='land'`);
  return { makers, viewers, returning: ret, shares, made, views, sheets, days, funnel, errors, errRate, engine, shapes, sizes,
           shareHit, loop, inter, interKinds, life, refs, devices, generated: new Date().toISOString() };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–');
const label = (sheet) => {
  if (!sheet) return '（未知）';
  if (sheet.startsWith('g:')) return 'Google 試算表 ' + sheet.slice(2, 10) + '…';
  if (sheet.startsWith('d:')) return '上傳（網址內）' + sheet.slice(2, 8);
  return '上傳檔案 ' + sheet.slice(2, 8);
};

function page(d) {
  const m = d.makers, v = d.viewers, r = d.returning, f = d.funnel;
  const row = (cells) => '<tr>' + cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>SheetSnap 使用量</title>
<style>
body{margin:0;padding:18px 14px 60px;font:14px/1.6 -apple-system,"PingFang TC","Noto Sans TC",sans-serif;color:#16191d;background:#f3f4f6}
h1{font-size:20px;margin:0 0 4px} .sub{color:#8b94a0;font-size:12px;margin:0 0 18px}
.k{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:0 0 22px}
.k div{background:#fff;border:1px solid #e2e5ea;border-radius:10px;padding:12px 14px}
.k b{display:block;font-size:26px;font-weight:700;color:#0c744a;line-height:1.2}
.k span{font-size:12px;color:#4b5563} .k i{display:block;font-style:normal;font-size:11px;color:#8b94a0;margin-top:2px}
h2{font-size:15px;margin:22px 0 8px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e5ea;border-radius:10px;overflow:hidden;font-size:13px}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #e2e5ea;white-space:nowrap} th{font-size:11px;color:#8b94a0;letter-spacing:.06em}
tr:last-child td{border-bottom:0} td.n{text-align:right;font-variant-numeric:tabular-nums}
.wrap{overflow-x:auto} .hi{color:#0c744a;font-weight:700}
</style>
<h1>SheetSnap 使用量</h1><p class="sub">${esc(d.generated.slice(0, 16).replace('T', ' '))} UTC · 不含任何試算表內容</p>
<div class="k">
  <div><b>${m.people || 0}</b><span>做表的人</span><i>${m.uploads || 0} 次載入 · Google ${m.gsheet || 0} / 檔案 ${m.file || 0}</i></div>
  <div><b>${v.people || 0}</b><span>看表的人</span><i>${v.opens || 0} 次打開</i></div>
  <div><b>${pct(r.back || 0, r.pairs || 0)}</b><span>回來看第二次</span><i>${r.back || 0} / ${r.pairs || 0} 人×表</i></div>
  <div><b>${d.shares.n || 0}</b><span>按了複製網址</span><i>${d.shares.sheets || 0} 份表</i></div>
  <div><b>${d.made.people || 0}</b><span>觀看者點了「做一份自己的」</span><i>${d.made.n || 0} 次</i></div>
</div>
<h2>做表這一端的漏斗</h2><div class="wrap"><table><tr><th>來到首頁</th><th>載入了表</th><th>選了看法</th><th>複製了網址</th></tr>
${row([f.land || 0, (f.upload || 0) + '（' + pct(f.upload, f.land) + '）', (f.view || 0) + '（' + pct(f.view, f.upload) + '）', (f.share || 0) + '（' + pct(f.share, f.view) + '）'])}
</table></div>
<div class="k">
  <div><b>${pct(d.shareHit.opened || 0, d.shareHit.shared || 0)}</b><span>複製了網址的表，真的有別人打開</span><i>${d.shareHit.opened || 0} / ${d.shareHit.shared || 0} 份</i></div>
  <div><b>${pct(d.loop.became || 0, d.loop.viewers || 0)}</b><span>觀看者後來自己做了表</span><i>${d.loop.became || 0} / ${d.loop.viewers || 0} 人</i></div>
  <div><b>${pct(d.inter.used || 0, d.inter.pairs || 0)}</b><span>觀看者有搜尋／點籤</span><i>${d.interKinds.map((x) => esc(x.kind) + ' ' + x.n).join(' · ') || '–'}</i></div>
  <div><b>${pct(d.life.week || 0, d.life.sheets || 0)}</b><span>連結一週後還有人開</span><i>${d.life.week || 0} / ${d.life.sheets || 0} 份</i></div>
  <div><b>${pct(d.errRate.err || 0, (d.errRate.err || 0) + (d.errRate.ok || 0))}</b><span>載入失敗率</span><i>${d.errors.map((x) => esc(x.code || '?') + ' ' + x.n).join(' · ') || '沒有失敗'}</i></div>
  <div><b>${pct(d.engine.warned || 0, d.engine.sheets || 0)}</b><span>引擎標「可能沒讀對」的表</span><i>按了「顯示不對」${d.engine.diag || 0} 次 · 換過看法 ${pct(d.engine.switched || 0, d.engine.chose || 0)}</i></div>
</div>
<h2>來的是什麼表</h2><div class="wrap"><table><tr><th>形狀</th><th>份</th><th></th><th>大小</th><th>份</th></tr>
${Array.from({ length: Math.max(d.shapes.length, d.sizes.length, 1) }, (_, i) => row([esc((d.shapes[i] || {}).shape || ''), (d.shapes[i] || {}).n ?? '', '', esc((d.sizes[i] || {}).size || ''), (d.sizes[i] || {}).n ?? ''])).join('')}
</table></div>
<h2>做表的人從哪來</h2><div class="wrap"><table><tr><th>來源</th><th>人</th></tr>
${d.refs.map((x) => row([esc(x.ref || 'direct'), x.people])).join('') || row(['還沒有資料'])}
${row(['<i>手機 ' + (d.devices.mobile || 0) + ' · 電腦 ' + (d.devices.desktop || 0) + '</i>', ''])}
</table></div>
<h2>每份表</h2><div class="wrap"><table><tr><th>表</th><th>看的人</th><th>打開次數</th><th>回訪的人</th><th>平均每人</th><th>最多</th><th>期間</th></tr>
${d.sheets.map((s) => row([esc(label(s.sheet)), '<span class="n hi">' + s.viewers + '</span>', s.opens, s.back + '（' + pct(s.back, s.viewers) + '）', s.avg_opens, s.max_opens, esc(s.first.slice(5)) + ' – ' + esc(s.last.slice(5))])).join('') || row(['還沒有資料'])}
</table></div>
<h2>做表的人選了哪種看法</h2><div class="wrap"><table><tr><th>看法</th><th>次數</th></tr>
${d.views.map((x) => row([esc(x.view || '（無）'), x.n])).join('') || row(['還沒有資料'])}
</table></div>
<h2>每天</h2><div class="wrap"><table><tr><th>日期</th><th>載入表</th><th>觀看者打開</th><th>不同觀看者</th></tr>
${d.days.map((x) => row([esc(x.day), x.uploads, x.opens, x.viewers])).join('') || row(['還沒有資料'])}
</table></div>`;
}
