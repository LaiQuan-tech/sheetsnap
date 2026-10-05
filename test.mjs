#!/usr/bin/env node
/**
 * 回歸測試：確認引擎對已知的表仍給出正確形狀。
 *
 *   node test.mjs        （不需要 API 金鑰；離線案例 + 四份真實表）
 *
 * 每次改規則都跑一次。今天最痛的問題是「修 A 弄壞 B」，
 * 這個檔案就是為了讓那件事被抓到而存在。
 */
import fs from 'node:fs';
const g={}; new Function('window', fs.readFileSync('detect.js','utf8'))(g);
const S=g.SheetShape;
function csv(t){const R=[];let row=[],f='',q=false;
 for(let i=0;i<t.length;i++){const c=t[i];
  if(q){ if(c==='"'){ if(t[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
  else if(c==='"')q=true; else if(c===','){row.push(f);f='';}
  else if(c==='\n'){row.push(f);R.push(row);row=[];f='';}
  else if(c!=='\r')f+=c;}
 if(f!==''||row.length){row.push(f);R.push(row);} return R;}
const cases={
 '價目表':['pricelist','品項,分類,單價,備註\n光明燈,點燈,600,一年\n太歲燈,點燈,800,一年\n平安米,結緣品,100,\n環保金紙,金紙,250,一份三支\n祈福蠟燭,結緣品,50,'],
 '通訊錄':['directory','姓名,職稱,電話,Email,組別\n林雅玲,活動組長,0912345678,ya@ex.com,活動組\n陳瑟君,總務,0923456789,se@ex.com,行政組\n王藝鐘,護駕,0934567890,yi@ex.com,護駕組'],
 '狀態清單':['board','工作項目,狀態,負責人,備註\n訂購金紙,已完成,活動組,共五箱\n場地佈置,進行中,全體人員,\n印製手冊,未開始,行政組,等文稿\n聯絡外燴,進行中,蓴姐,120份'],
 '無結構':['cards','編號,說明,數量\nA001,不鏽鋼供桌,3\nA002,紅色板凳,120\nA003,遮陽帳篷,8'],
 // 零用金支出：只有一欄金額，但日期幾乎全相異 → 是明細帳不是排程
 '支出表':['ledger','日期,內容,金額,說明,專案名稱\n6/1,車資,390,加班計程車,橋新安居\n6/2,車資,395,加班計程車,橋新安居\n6/3,車資,390,加班計程車,橋新安居\n6/4,車資,395,加班計程車,橋新安居\n6/5,車資,385,加班計程車,橋新安居\n6/8,車資,395,加班計程車,橋新安居'],
 // 對照組：有預算欄的活動排程，日期重複 → 仍是排程，不能被吸進帳表
 '有預算的排程':['schedule','日期,活動,預算\n9/11,場地佈置,5000\n9/11,音響租借,8000\n9/12,餐點,20000\n9/12,攝影,6000\n9/13,清運,3000\n9/13,謝師宴,15000'],
};
let ok=0,bad=0;
for(const [n,[want,t]] of Object.entries(cases)){
  const a=S.analyseSheet(csv(t)).tables[0];
  const pass=a.shape.shape===want;
  console.log(`${pass?'✓':'✗'} ${n.padEnd(6)} 期望=${want.padEnd(10)} 實際=${a.shape.shape}`);
  pass?ok++:bad++;
}
/* 欄名含「name」不等於人員欄。
   person 在篩選排序裡是最高優先（v61）、又排在排名之前（v68），
   所以誤判一欄品名就會擠掉真正的狀態欄或排名看法。
   163 份微軟範本的 33 個 person 欄裡有 13 個是這種誤判。 */
const REP = ['甲','乙','甲','乙','甲','乙','甲','乙','甲','乙','甲','乙','甲'];
const UNI = Array.from({ length: 13 }, (_, i) => '值' + i);
const personCases = [
  // [欄名, 值有重複時期望, 值全相異時期望]
  ['負責人',          'person', 'person'],   // 明確的人字樣：兩種情況都算
  ['專案負責人',      'person', 'person'],   // 「專案」不能覆蓋「負責」
  ['Salesperson',     'person', 'person'],
  ['ADMIN STAFF',     'person', 'person'],
  // 一人一列的名冊（Team roster、Guests、Candidates）也要算人員：
  // 曾經多一道「值要有重複」的關，163 份跑出來誤殺 9 欄，已拆掉
  ['Name',            'person', 'person'],
  ['NAME',            'person', 'person'],
  ['Contact name',    'person', 'person'],
  ['Lead name',       'person', 'person'],
  ['PRODUCT NAME',    null,     null],       // 欄名指名了非人的主體 → 一律不算
  ['PROJECT NAME',    null,     null],
  ['Course name',     null,     null],
  ['Company name',    null,     null],
  ['Merchant name',   null,     null],
  ['ASSET NAME',      null,     null],
  ['Team name',       null,     null],
  ['NAME OF ORGANIZATION', null, null],
  ['PERSONNEL EXPENSES',   null, null],
];
for (const [name, wRep, wUni] of personCases) {
  for (const [vals, want, how] of [[REP, wRep, '有重複'], [UNI, wUni, '全相異']]) {
    const got = S.detectColumn(name, vals).type;
    const pass = want === null ? got !== 'person' : got === want;
    console.log(`${pass ? '✓' : '✗'} 欄別 ${name.padEnd(22)} ${how} → ${got}${want === null ? '（不該是 person）' : ''}`);
    pass ? ok++ : bad++;
  }
}

/* 卡片標題：欄名本身就是最強的訊號。
   pickTitle 原本只看「相異度 − 欄位位置」，所以 163 份範本裡
   inventory_cf2db84f 的 25 張卡片叫「Inventory ID」而不是品名「Name」。
   這類錯不會觸發任何警示——有標題，只是挑錯了。 */
const titleCases = [
  // [欄名列, 期望的標題欄, 說明]
  [['Inventory ID', 'Name', 'Unit price'],  'Name',        '品名贏過編號'],
  [['員工編號', '姓名', '時薪'],                '姓名',          '中文的編號／姓名'],
  [['SKU', 'Item names', 'Price'],          'Item names',  '複數的 names 也要算'],
  [['Order #', 'Product', 'Amount'],        'Product',     '單號欄不該當標題'],
  // Check # 不是靠 codeLike 擋掉的（1001 這種四碼不算 codeLike），要靠 # 本身
  [['Check #', 'Payee', 'Amount'],          'Payee',       '# 也算單號'],
  // 英文的 title 一詞兩義：COURSE TITLE 是名稱，Title held by 是產權登記在誰名下。
  // 163 份跑出來這條誤中過一次，把全滿的欄換成只填一半的欄，半數卡片沒名字。
  [['Financial institution', 'Title held by', 'Balance'], 'Financial institution', 'Title held by 不是名稱'],
  [['Course ID', 'COURSE TITLE', 'Credits'], 'COURSE TITLE', 'COURSE TITLE 是名稱'],
  [['分類', '工作項目', '金額'],                 '工作項目',       '分組軸不會被標題搶走'],
];
const WORDS = ['筆記本','原子筆','膠水','剪刀','尺規','釘書機','便利貼','資料夾','文件袋','計算機','橡皮擦','立可白'];
const CATS  = ['行銷','研發','客服'];
for (const [head, want, why] of titleCases) {
  const grid = [head].concat(Array.from({ length: 12 }, (_, i) => head.map(h => {
    if (/編號|SKU|ID|#/.test(h)) return 'XX-' + (1010 + i);            // 單號：長度整齊、含數字
    if (/金額|時薪|price|amount|balance|credits/i.test(h)) return String(100 + i * 7);
    if (h === '分類') return CATS[i % 3];
    return WORDS[i];
  })));
  const a = S.analyse(grid);
  const got = a.roles.title && a.roles.title.name;
  const pass = got === want;
  console.log(`${pass ? '✓' : '✗'} 標題 ${why.padEnd(16)} 期望=${String(want).padEnd(11)} 實際=${got}`);
  pass ? ok++ : bad++;
}
// 分組軸是一整張看法，不該為了一個名字讓它變成 null
{
  const grid = [['分類', '工作項目', '金額']].concat(Array.from({ length: 15 }, (_, i) =>
    [CATS[i % 3], '工作項目' + (i + 1), String(1000 + i * 37)]));
  const a = S.analyse(grid);
  const pass = a.roles.group && a.roles.group.name === '分類';
  console.log(`${pass ? '✓' : '✗'} 標題 ${'分組軸仍然在'.padEnd(16)} group=${a.roles.group && a.roles.group.name}`);
  pass ? ok++ : bad++;
}

/* 標題排在 group、lead 之後分配，撞到就讓 roles.title 變成 null——
   卡片整張沒有名字，而表上明明還有別的名稱欄。改成往下一個候選退。
   另外：使用者手動指定標題時（pinTitle），那一欄不該被分組軸搶走。 */
{
  const NAMES = ['年度計畫','網站改版','客服訓練','展場佈置','新品試作','通路拓展','包材更新',
                 '物流調整','品牌調研','會員活動','教育訓練','系統升級','庫存盤點','文件歸檔','供應商評估'];
  const grid = [['分類', '工作項目', '金額']].concat(
    Array.from({ length: 15 }, (_, i) => [CATS[i % 3], NAMES[i], String(1000 + i * 37)]));
  const a = S.analyse(grid);
  const live = a.cols.filter(c => c.type !== 'empty');
  const byName = n => a.cols.filter(c => c.name === n)[0];

  const chk = (why, cond, got) => {
    console.log(`${cond ? '✓' : '✗'} 角色 ${why.padEnd(22)} ${got}`);
    cond ? ok++ : bad++;
  };
  chk('自動：分組與標題各一欄', a.roles.group?.name === '分類' && a.roles.title?.name === '工作項目',
      `group=${a.roles.group?.name} title=${a.roles.title?.name}`);

  // 撞到：把分組欄當成 pickTitle 的首選，標題要退到下一個候選而不是 null
  const hit = S.assignRoles(live, { ...a.shape, title: byName('分類') });
  chk('撞到分組軸就往下退', hit.group?.name === '分類' && hit.title?.name === '工作項目',
      `group=${hit.group?.name} title=${hit.title?.name}`);

  // pinTitle：使用者指定了就要生效
  const pin = S.assignRoles(live, { ...a.shape, title: byName('分類'), pinTitle: true });
  chk('手動指定的標題會生效', pin.title?.name === '分類',
      `group=${pin.group?.name} title=${pin.title?.name}`);

  // index.html 不該再自己抄一份
  chk('assignRoles 有對外', typeof S.assignRoles === 'function', typeof S.assignRoles);
}

/* 矩陣的標題固定用第一欄，但第一欄半空時整排卡片就沒名字。
   163 份裡最糟的是 chart_6860aa13 › Profit & loss chart：第一欄只填 1/11，
   11 張卡有 10 張沒名字；inventory_c16e6fb0 的第一欄填 48%，25 張有 13 張。
   條件是「另一欄明顯更滿（多 20 個百分點）」，不是「第一欄低於某門檻」——
   後者在 48% / 50% 的邊緣會亂跳。 */
{
  const mk = (head, rows) => S.analyse([head].concat(rows));
  const ITEMS = ['Desk','Chair','Monitor','Lamp','Board','Tray','Printer','Cable','Mouse','Keyboard','Shelf','Mat'];
  const chk = (why, got, want) => {
    const pass = got === want;
    console.log(`${pass ? '✓' : '✗'} 矩陣 ${why.padEnd(26)} 期望=${want} 實際=${got}`);
    pass ? ok++ : bad++;
  };

  // 第一欄半空、表上有更完整的名稱欄 → 換過去
  const half = mk(['', 'Name', '一月', '二月', '三月'],
    Array.from({ length: 12 }, (_, i) => [i < 6 ? '區' + (i % 3) : '', ITEMS[i],
      String(100 + i), String(120 + i), String(140 + i)]));
  chk('第一欄半空就換掉', half.roles.title && half.roles.title.name, 'Name');

  // 第一欄全滿 → 永遠不動（矩陣的第一欄本來就是標籤序列）
  const full = mk(['項目', '一月', '二月', '三月'],
    Array.from({ length: 8 }, (_, i) => ['項目' + (i + 1), String(100 + i), String(120 + i), String(140 + i)]));
  chk('第一欄全滿不該動', full.roles.title && full.roles.title.name, '項目');

  // 第一欄 85%（小計列空著）→ 沒有明顯更滿的替代，不動
  const gap = mk(['科目', '一月', '二月', '三月'],
    Array.from({ length: 13 }, (_, i) => [i === 6 || i === 12 ? '' : '科目' + (i + 1),
      String(100 + i), String(120 + i), String(140 + i)]));
  chk('第一欄 85% 也不該動', gap.roles.title && gap.roles.title.name, '科目');
}

/* codeLike 誤判品名欄 → 標題挑錯。
   inventory_b9cbb715 › Inventory list 的 DESCRIPTION 是 100% 填滿、
   11 列全相異的品名欄（分數 0.96），標題卻給了只有 6 種值的 LOCATION（0.43）；
   唯一能翻盤的是 codeLike 的 −0.6——前三個品名剛好長度相近又帶數字。
   兩道修法：樣本從 3 筆拉到 8 筆（3 筆判「長度整齊」根本不準），
   以及「代碼不會有空白」。 */
{
  const CODE = Array.from({ length: 11 }, (_, i) => 'AT-114-' + String(i + 1).padStart(3, '0'));
  const DESC = ['Widget A-1', 'Widget A-2', 'Widget A-3', '4GB RAM module', 'Steel bracket 12',
                'Hex bolt M8', 'Cable tie 200mm', 'Floor mat XL', 'Paint tin 5L',
                'Drill bit 6mm', 'Safety goggles'];
  // 沒有空白、但長度參差——靠 8 筆樣本才看得出來，3 筆看不出來
  const DESC2 = ['Widget-A1', 'Widget-A2', 'Widget-A3', 'RAM-4GB-module-x2',
                 'Bracket-12', 'Bolt-M8', 'CableTie-200mm-black', 'Mat-XL',
                 'Paint-5L', 'Bit-6mm', 'Goggles'];
  const chk = (why, got, want) => {
    const pass = got === want;
    console.log(`${pass ? '✓' : '✗'} 代碼 ${why.padEnd(26)} 期望=${want} 實際=${got}`);
    pass ? ok++ : bad++;
  };
  chk('純料號仍算代碼', S.isNoise(S.detectColumn('SKU', CODE)), true);
  chk('品名（有空白）不算代碼', S.isNoise(S.detectColumn('DESCRIPTION', DESC)), false);
  chk('品名（無空白、長度參差）不算', S.isNoise(S.detectColumn('DESCRIPTION', DESC2)), false);

  // 整表：品名欄要拿到標題，不能被料號或地點搶走
  const BIN = ['A1','A2','B1','B2','C1','C2'], LOC = ['倉東','倉西','倉南','倉北','外倉','暫存'];
  const grid = [['SKU', 'DESCRIPTION', 'BIN #', 'LOCATION', 'UNIT', 'QTY', 'COST']].concat(
    Array.from({ length: 11 }, (_, i) =>
      [CODE[i], DESC[i], BIN[i % 6], LOC[i % 6], '個', String(10 + i), String(100 + i * 7)]));
  const a = S.analyse(grid);
  chk('品名欄當標題', a.roles.title && a.roles.title.name, 'DESCRIPTION');
}

const urls={普渡:['schedule','1b72qwLM_0xUdisA2uKxqUa98-EJwC-UJPyXsEaLJoiI'],
  甘特圖:['schedule','1DJIy4I7vbVgk9lBcnMCGq9z2wo-J8hR-hZzKHxwHSZs'],
  帳表:['ledger','1BsOykBCciRxZDDFe1-S957ONmf5chqt9']};
for(const [n,[want,id]] of Object.entries(urls)){
  const r=await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`);
  const a=S.analyseSheet(csv(await r.text())).tables[0];
  const pass=a.shape.shape===want;
  console.log(`${pass?'✓':'✗'} ${n.padEnd(6)} 期望=${want.padEnd(10)} 實際=${a.shape.shape}`);
  pass?ok++:bad++;
}
console.log(`\n${ok} 通過 · ${bad} 失敗`);
process.exit(bad?1:0);
