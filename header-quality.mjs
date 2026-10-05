#!/usr/bin/env node
/**
 * 欄名品質量測：標題列判對了嗎？
 *
 *   node header-quality.mjs [資料夾]     預設 corpus-ms/files
 *
 * 只評每張工作表裡最大的那個表——使用者實際會讀的是它，
 * 其餘小碎片多半是範本鷹架（捲軸控制列、圖表暫存區）。
 * 把碎片一起算會讓數字失真：曾經因此把一次真實的改善誤讀成退步。
 *
 * 這是單一數字的指標，改標題列偵測時用它做 A/B。
 */
import fs from 'node:fs'; import path from 'node:path'; import XLSX from 'xlsx';
const g={}; new Function('window', fs.readFileSync('detect.js','utf8'))(g);
const S=g.SheetShape;
const dir=process.argv[2]||'corpus-ms/files';

// 欄名可疑的判定：自動編號、看起來像資料值、或空白
function badHeader(h){
  const n=h.length, bad=h.filter(x=>{
    const s=String(x).trim();
    return !s || /^欄 \d+$/.test(s) || /^[$€£¥]?[\d,.]+%?$/.test(s) || !!S.parseDateish(s);
  }).length;
  return bad/n;
}
let tables=0, bad=0, shown=0, shownBad=0;
const worst=[];
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.xlsx'))){
  const wb=XLSX.read(fs.readFileSync(path.join(dir,f)),{type:'buffer'});
  for(const n of wb.SheetNames){
    const grid=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:'',raw:false});
    // 只評每張工作表裡最大的那個表——使用者實際會讀的是它，
    // 其餘小碎片多半是範本的鷹架（捲軸控制列、圖表暫存區）
    const ts=S.analyseSheet(grid).tables.filter(a=>a.rows.length>=3);
    if(!ts.length) continue;
    const a=ts.reduce((x,y)=>y.rows.length>x.rows.length?y:x);
    tables++;
    // 這張工作表會不會真的渲染給人看？不會的話，欄名判成什麼都不影響使用者。
    // 最糟的六個裡有三個（budget_94d2de40 › Budget summary、
    // chart_8eab671c › Project Planner、timeline_25d7e007 › Project timeline）
    // 都是 sheetVerdict 擋掉的圖表資料區，混在一起算會讓數字看起來比實際差。
    const show=S.sheetVerdict(grid, S.analyseSheet(grid).tables).show===true;
    if(show) shown++;
    const r=badHeader(a.header);
    if(r>0.4){
      bad++; if(show) shownBad++;
      worst.push({f,n,r:+r.toFixed(2),show,hdr:a.header.slice(0,7).map(x=>String(x).slice(0,12))});
    }
  }
}
console.log(`基準線：${tables} 個表（≥3 列），其中 ${bad} 個欄名可疑 = ${(bad/tables*100).toFixed(1)}%`);
console.log(`其中會渲染的：${shown} 個表，${shownBad} 個欄名可疑 = ${(shownBad/shown*100).toFixed(1)}%  ← 改標題列偵測時看這個`);
console.log('\n最糟的 8 個（「藏」= sheetVerdict 本來就不渲染，欄名判成什麼都不影響使用者）：');
worst.sort((a,b)=>b.r-a.r).slice(0,8).forEach(w=>
  console.log(`  ${w.r} ${w.show?'　　':'（藏）'} ${w.f} › ${w.n}\n      ${JSON.stringify(w.hdr)}`));
