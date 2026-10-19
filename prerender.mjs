#!/usr/bin/env node
/* 把 i18n.js 的文案烘進 index.html，並補上 19 個語言的 hreflang 與 sitemap。
 *
 *   node prerender.mjs            烘預設語言（下面的 BAKE）
 *   node prerender.mjs --check    只檢查有沒有過期，不改檔（給 test.mjs 用）
 *
 * 為什麼要有這支：介面文字全部是 applyStatic() 在執行時塞進去的，所以不跑
 * JavaScript 的爬蟲看到的 <body> 只有 281 個字元，而且全是按鈕跟診斷表的欄名
 * ——五個大標、七題 FAQ、每一段文案都是空的。robots.txt 特地開放了 GPTBot、
 * ClaudeBot、PerplexityBot，而那些爬蟲多半不跑 JS，等於請客人進門再給他看空桌子。
 *
 * 為什麼用生成而不是手寫：手寫過一次就會過期。v96 把 tagline 換掉之後，
 * index.html 裡那句預設文字還是 v95 的——HTML 說一套、畫面說一套。
 * i18n.js 是唯一的真相，這支只負責同步，test.mjs 會檢查有沒有同步。
 *
 * applyStatic() 載入時會把這些文字再覆寫一次，所以烘進去不影響任何行為，
 * 只是讓「還沒跑 JS 的那一刻」也有東西可讀。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
process.chdir(here);
const CHECK = process.argv.includes('--check');

/* 烘哪一個語言：這決定「不跑 JS 的爬蟲」讀到的是哪一種語言，
   也就是搜尋結果裡顯示的語言。改這一行就換，其餘都會跟著走。 */
const BAKE = 'zh';

// ── 讀字典（i18n.js 是瀏覽器檔，用假的 window 餵它）──
function dict() {
  const src = fs.readFileSync('i18n.js', 'utf8').replace(/\)\(window\);?\s*$/, ')(G);');
  const G = { location: { search: '' }, navigator: { languages: [], language: 'en' },
    document: { querySelectorAll: () => [], getElementById: () => null, documentElement: {} } };
  return new Function('G', 'var window=G,location=G.location,navigator=G.navigator,' +
    'document=G.document,localStorage=undefined;' + src + 'return G.I18N;')(G);
}
const I18N = dict();
const T = I18N.T[BAKE];
const LANGS = I18N.LANGS;
if (!T) throw new Error('字典裡沒有 ' + BAKE);

// t() 的規則要跟 i18n.js 一致：{n} 代入，n===1 時優先用 key+'1'
const tr = (key, n) => {
  const d = I18N.T[BAKE];
  let v = (n === 1 && d[key + '1'] != null) ? d[key + '1']
        : (d[key] != null ? d[key] : (I18N.T.en[key] != null ? I18N.T.en[key] : key));
  if (n != null) v = v.split('{n}').join(String(n));
  return v;
};

// ── 烘文字 ──
let html = fs.readFileSync('index.html', 'utf8');
let filled = 0, missing = [];

/* 只處理「開標籤…閉標籤」成對、而且中間沒有巢狀同名標籤的元素。
   data-i18n 的值會被 innerHTML 覆寫，所以原本裡面有什麼都不重要。 */
html = html.replace(
  /<(h1|h2|h3|p|span|button|summary|label|div|td|b)([^>]*\sdata-i18n="([^"]+)"[^>]*)>[\s\S]*?<\/\1>/g,
  (whole, tag, attrs, key) => {
    if (/<\s*\1[\s>]/.test(whole.slice(1))) return whole;        // 有巢狀，不碰
    const nm = attrs.match(/\sdata-n="(\d+)"/);
    const val = T[key];
    if (val == null) { missing.push(key); return whole; }
    filled++;
    return '<' + tag + attrs + '>' + tr(key, nm ? Number(nm[1]) : null) + '</' + tag + '>';
  });

// placeholder
html = html.replace(/(<input[^>]*\sdata-i18n-ph="([^"]+)"[^>]*>)/g, (whole, _el, key) => {
  if (T[key] == null) { missing.push(key); return whole; }
  filled++;
  const esc = T[key].replace(/"/g, '&quot;');
  return whole.includes('placeholder="')
    ? whole.replace(/placeholder="[^"]*"/, 'placeholder="' + esc + '"')
    : whole.replace(/<input/, '<input placeholder="' + esc + '"');
});

// ── <head>：語言、標題、描述，照烘進去的語言走 ──
const L = LANGS.filter(l => l.code === BAKE)[0];
html = html.replace(/<html lang="[^"]*"( dir="[^"]*")?>/, '<html lang="' + L.tag + '">');
html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + T.title + '</title>');

// ── hreflang：19 個語言＋x-default。?lang= 是它們唯一的網址 ──
const alts = LANGS.map(l =>
  '<link rel="alternate" hreflang="' + l.tag + '" href="https://sheetsnap.link/' +
  (l.code === BAKE ? '' : '?lang=' + l.code) + '">').join('\n');
const block = '<!-- hreflang：prerender.mjs 生成，不要手改 -->\n' + alts +
  '\n<link rel="alternate" hreflang="x-default" href="https://sheetsnap.link/">';
html = html.replace(/\n?<!-- hreflang：[\s\S]*?hreflang="x-default"[^>]*>/, '');
html = html.replace(/(<link rel="canonical"[^>]*>)/, '$1\n' + block);

// ── sitemap：每個語言一筆，彼此互指 ──
const sm = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!-- prerender.mjs 生成，不要手改 -->\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
  '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
  LANGS.map(l => {
    const href = 'https://sheetsnap.link/' + (l.code === BAKE ? '' : '?lang=' + l.code);
    return '  <url>\n    <loc>' + href + '</loc>\n' +
      LANGS.map(x => '    <xhtml:link rel="alternate" hreflang="' + x.tag + '" href="https://sheetsnap.link/' +
        (x.code === BAKE ? '' : '?lang=' + x.code) + '"/>').join('\n') + '\n' +
      '    <changefreq>weekly</changefreq>\n    <priority>' + (l.code === BAKE ? '1.0' : '0.8') + '</priority>\n  </url>';
  }).join('\n') + '\n</urlset>\n';

// ── 寫出或檢查 ──
const old = fs.readFileSync('index.html', 'utf8');
const oldSm = fs.existsSync('sitemap.xml') ? fs.readFileSync('sitemap.xml', 'utf8') : '';
if (missing.length) {
  console.error('停下來：字典裡找不到這些 key —— ' + [...new Set(missing)].join(', '));
  process.exit(2);
}
if (CHECK) {
  const stale = (html !== old ? ['index.html'] : []).concat(sm !== oldSm ? ['sitemap.xml'] : []);
  if (stale.length) {
    console.error('過期：' + stale.join('、') + ' 跟 i18n.js 對不上。跑 node prerender.mjs 重新生成。');
    process.exit(1);
  }
  console.error('✓ 烘進 HTML 的文案與 i18n.js 一致（' + filled + ' 處）');
  process.exit(0);
}
fs.writeFileSync('index.html', html);
fs.writeFileSync('sitemap.xml', sm);
console.error('烘進 ' + filled + ' 處文字（' + BAKE + '）、' + LANGS.length + ' 個 hreflang、sitemap ' + LANGS.length + ' 筆');
