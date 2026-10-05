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

/* 日期欄不該當卡片標題——那是軸，不是名字。
   v71 之前這件事是 codeLike 誤打誤撞擋住的（解析不出來、留在 text 的日期
   剛好長度整齊又帶數字）；v71 把樣本拉到 8 筆之後長短不一的日期就不算代碼，
   accounting_7b54c8ed › STATEMENT 的標題因此從 DESCRIPTION 掉成 DATE。
   改成直接寫出來，不再靠別的規則順便擋。 */
{
  const chk = (why, got, want) => {
    const pass = got === want;
    console.log(`${pass ? '✓' : '✗'} 日期 ${why.padEnd(26)} 期望=${want} 實際=${got}`);
    pass ? ok++ : bad++;
  };
  const T = g => { const a = S.analyse(g); return a.roles.title && a.roles.title.name; };

  /* 日期跟名稱欄誰當標題，看那一欄有沒有真的在區分列。
     v72 我把「日期一律輸給名稱欄」當成規則，用 accounting_7b54c8ed › STATEMENT
     驗證就收工了，沒看那一欄的相異值：它 8 列只有 4 種說明，當標題會有一半的
     卡片同名，而 8 個日期全相異。手機上「3/18/2026 · Payment · $107」比三張
     都叫「Payment」好讀。所以扣 0.6 的意思不是「日期永遠輸」，是
     「日期輸給真的在區分列的名稱欄，贏過一直重複的那種」。 */
  const DS = ['3/1/2026','3/5/2026','3/12/2026','3/18/2026','11/2/2026','11/15/2026','12/3/2026','12/22/2026'];
  const CR = ['', '退款 A', '', '退款 B', '', '退款 C', '', ''];
  const statement = DE => T([['DATE','DESCRIPTION','CHARGES','CREDITS','ACCOUNT BALANCE']].concat(
    DS.map((d, i) => [d, DE[i], i % 2 ? '$' + (100 + i) : '', CR[i], i < 6 ? '$' + (1000 - i * 30) : ''])));
  chk('日期輸給會區分列的說明欄', statement(
    ['房租','水電','網路','保險','稅金','維修','清潔','停車']), 'DESCRIPTION');
  chk('日期贏過一直重複的說明欄', statement(
    ['Payment','Payment','Service fee','Payment','Service fee','Interest','Payment','Interest']), 'DATE');

  // 球賽表：兩欄都全相異，日期靠在左邊也不該贏
  chk('日期輸給隊名', T([['Date','Home team','Away team','Time','Location'],
    ['3/1/2026','紅隊','藍隊','14:00','北場'],
    ['3/8/2026','綠隊','黃隊','16:00','北場']]), 'Home team');

  /* 是扣分不是禁止：整張表只剩日期可用時要留住。
     date／time 型別原本完全不在 pickTitle 的候選名單裡（日期是軸不是名字），
     但帳表這種 group 是 null、其他欄全是金額的表，日期就是那一列唯一的身分，
     不收的話整疊卡片一個名字都沒有。 */
  chk('沒有別的名稱欄就留住', T([['Date','Regular hours','Overtime hours','Total']].concat(
    Array.from({ length: 14 }, (_, i) =>
      ['3/' + (i + 1) + '/2026', '8', String(i % 3), String(8 + i % 3)]))), 'Date');
}

/* 日期格式：歐美跟台灣寫法不同，而且同一串數字會是不同的日子。
   「3/1/2026」美國是 3 月 1 日、歐洲是 1 月 3 日；台灣寫「3/1」是 3 月 1 日。
   單看一個值分不出來，看一整欄就分得出來（第一個數字出現過 >12 就只能是日）。
   163 份微軟範本裡 97 個欄名像日期的欄，只有 6 個判成 date——美式 M/D/YYYY
   原本整個解析不出來，而「03/01/2026」更糟：被讀成民國 3 年，吐出 1914-01-20。 */
{
  const f = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
  const chk = (why, got, want) => {
    const pass = got === want;
    console.log(`${pass ? '✓' : '✗'} 日期 ${why.padEnd(24)} 期望=${String(want).padEnd(11)} 實際=${got}`);
    pass ? ok++ : bad++;
  };
  // 原本吐出 1914-01-20——解析成錯的日期比解析不出來更糟
  chk('03/01/2026 不是民國 3 年', f(S.parseDateish('03/01/2026')), '2026-03-01');
  chk('美式 M/D/YYYY',        f(S.parseDateish('3/1/2026')),    '2026-03-01');
  chk('美式兩位數年份',           f(S.parseDateish('12/31/26')),    '2026-12-31');
  chk('民國三位數年份',           f(S.parseDateish('115/3/1')),     '2026-03-01');
  chk('民國兩位數（>31 只能是年）',   f(S.parseDateish('99/3/1')),      '2010-03-01');
  chk('台灣 Y/M/D',           f(S.parseDateish('2026/3/1')),    '2026-03-01');
  chk('月在前讀不出歐式',          f(S.parseDateish('25/12/2026')),  null);
  chk('日在前讀得出歐式',          f(S.parseDateish('25/12/2026', true)), '2026-12-25');
  chk('日在前時 3/1/2026 是 1 月 3 日', f(S.parseDateish('3/1/2026', true)), '2026-01-03');

  // 整欄推順序
  const order = v => S.inferDayFirst(v) ? '日在前' : '月在前';
  chk('整欄：美式', order(['3/1/2026', '12/22/2026']), '月在前');
  chk('整欄：歐式', order(['25/12/2026', '1/1/2026']), '日在前');
  chk('整欄：沒證據就月在前', order(['3/1/2026', '5/6/2026']), '月在前');

  // 整表：美式日期欄要被判成 date（原本整欄落到 text）
  const US = ['1/5/2026','2/12/2026','3/18/2026','5/2/2026','7/22/2026','9/30/2026',
              '10/14/2026','12/1/2026','12/22/2026','11/3/2026','8/8/2026','6/15/2026'];
  const EU = ['5/1/2026','12/2/2026','18/3/2026','2/5/2026','22/7/2026','30/9/2026',
              '14/10/2026','1/12/2026','22/12/2026','3/11/2026','8/8/2026','15/6/2026'];
  const typeOfFirst = ds => {
    const a = S.analyse([['DATE', 'ITEM', 'AMOUNT']].concat(
      ds.map((d, i) => [d, '項目' + (i + 1), String(100 + i * 13)])));
    return a.cols[0].type;
  };
  chk('整表：美式欄判成 date', typeOfFirst(US), 'date');
  chk('整表：歐式欄判成 date', typeOfFirst(EU), 'date');
}

/* v73 把 73 個欄判成了 date，連帶冒出兩種新的壞狀況。

   一、日期幾乎每列都不同時，不該拿它當分組軸。「帳表不是排程」那條規則
   要求有金額欄，所以「日期＋計數」的表漏掉了：chart_09eef93c ›
   MANUFACTURING OUTPUT 24 列 24 個不同日期，分成 24 段每段一筆，
   而日期被 group 吃掉之後連標題都沒了，整疊卡片沒有名字。

   二、欄名說它是名稱、實際上卻沒在區分列時，那個 +0.5 要打折。
   timeline_93059754 › Calendar 的「Working title」34 列只有 2 種值，
   靠欄名贏過 24 種值的「Deadline」，結果 32 張卡片同名、11 張沒名字。 */
{
  const chk = (why, got, want) => {
    const pass = got === want;
    console.log(`${pass ? '✓' : '✗'} 軸向 ${why.padEnd(24)} 期望=${String(want).padEnd(10)} 實際=${got}`);
    pass ? ok++ : bad++;
  };
  const R = g => { const a = S.analyse(g); return a.roles; };

  // 日期全不同＋計數欄：不分組，日期改當列名
  const spread = R([['DATE', 'COMPONENTS COMPLETED']].concat(
    Array.from({ length: 24 }, (_, i) => [(i % 12 + 1) + '/' + (i + 1) + '/2026', String(100 + i * 7)])));
  chk('日期全不同就不分組', spread.group ? spread.group.name : null, null);
  chk('日期改當列名',      spread.title && spread.title.name, 'DATE');

  // 真排程：同一天好幾件事，照舊依日期分組
  const sched = R([['日期', '活動', '預算']].concat(
    Array.from({ length: 16 }, (_, i) => ['2026/3/' + (i % 4 + 1), '活動' + (i + 1), String(1000 + i * 50)])));
  chk('真排程仍依日期分組', sched.group && sched.group.name, '日期');
  chk('真排程的列名是活動',  sched.title && sched.title.name, '活動');

  // 欄名寫著 title 但只有 2 種值，不該贏過 24 種值的日期欄
  const cal = R([['Deadline', 'Theme', 'Working title', 'Channel']].concat(
    Array.from({ length: 34 }, (_, i) =>
      [(i % 12 + 1) + '/' + (i % 28 + 1) + '/2026', i % 2 ? 'A' : 'B', i % 2 ? '稿一' : '稿二', i % 2 ? 'IG' : 'FB'])));
  chk('名稱欄沒在命名就打折', cal.title && cal.title.name, 'Deadline');
}

/* 英文月份與小數。

   「12.5」沒有年份時幾乎都是小數而不是 12 月 5 日，而型別偵測是先問日期
   再問金額，所以一整欄 12.5／3.5／7.25 的單價會被判成 date——
   inventory_53587d4d › Inventory List 的「Unit price」就是這樣變成日期欄的
   （v72 的 baseline 就已經這樣，是加了每欄的相異值數才看見）。
   三段式的「1.3.2026」跟年在前的「2026.3.1」照收，那些有年份、不會混。

   英文月份只收三字母縮寫與完整月名，不收任意前綴，否則「Marketing 1」
   會被讀成 3 月 1 日。 */
{
  const f = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
  const chk = (why, got, want) => {
    const pass = got === want;
    console.log(`${pass ? '✓' : '✗'} 月名 ${why.padEnd(22)} 期望=${String(want).padEnd(11)} 實際=${got}`);
    pass ? ok++ : bad++;
  };
  chk('Jan 5, 2026',    f(S.parseDateish('Jan 5, 2026')),     '2026-01-05');
  chk('January 5, 2026', f(S.parseDateish('January 5, 2026')), '2026-01-05');
  chk('Sept 3, 2026',   f(S.parseDateish('Sept 3, 2026')),    '2026-09-03');
  chk('Sep 30th',       f(S.parseDateish('Sep 30th')),        `${new Date().getFullYear()}-09-30`);
  chk('5-Jan-26',       f(S.parseDateish('5-Jan-26')),        '2026-01-05');
  chk('5 January 2026', f(S.parseDateish('5 January 2026')),  '2026-01-05');
  chk('1st Mar 26',     f(S.parseDateish('1st Mar 26')),      '2026-03-01');
  // 不是月份的字不能中
  chk('Marketing 1 不是日期', f(S.parseDateish('Marketing 1')), null);
  chk('Monday 5 不是日期',   f(S.parseDateish('Monday 5')),    null);
  chk('Item 3 不是日期',     f(S.parseDateish('Item 3')),      null);
  /* 「Feb 2023」不能被讀成 2 月 20 日。沒有「日的後面不能再接數字」這一條，
     日那一組會貪心地吃掉「20」當日、「23」當年——它是整個月，不是 20 號。 */
  chk('Feb 2023 不是 20 號', f(S.parseDateish('Feb 2023')),    '2023-02-01');
  chk('Jan 2026 不是 20 號', f(S.parseDateish('Jan 2026')),    '2026-01-01');
  chk('Feb 5 還是日期',      f(S.parseDateish('Feb 5')),       `${new Date().getFullYear()}-02-05`);

  /* 月份＋年份是真的時間軸（現金流預測一列一個月），但不能算進
     「這一格像不像某一天」——那正是大家拿來當欄名的東西。
     所以型別偵測收它（parseDateish），結構前處理不收（dateish）。 */
  chk('月份＋年份當成 1 號',  f(S.parseDateish('Feb 2023')),      '2023-02-01');
  chk('September 2022',    f(S.parseDateish('September 2022')), '2022-09-01');
  chk('2023年2月',          f(S.parseDateish('2023年2月')),       '2023-02-01');
  chk('Feb 20 仍是 20 號',   f(S.parseDateish('Feb 20')),        `${new Date().getFullYear()}-02-20`);
  chk('Feb 2023 不像某一天',  S.dateish('Feb 2023'),              false);
  chk('Feb 5, 2026 像某一天', S.dateish('Feb 5, 2026'),           true);
  chk('整欄：月份欄判成 date', S.detectColumn('Month',
    ['Jan 2023','Feb 2023','Mar 2023','Apr 2023','May 2023','Jun 2023']).type, 'date');
  // 小數不是日期
  chk('12.5 是小數',   f(S.parseDateish('12.5')), null);
  chk('3.5 是小數',    f(S.parseDateish('3.5')),  null);
  // 點分隔是德奧瑞那一帶的日.月.年；沒有欄位脈絡時照這個讀
  chk('1.3.2026 點分隔是日在前', f(S.parseDateish('1.3.2026')), '2026-03-01');
  chk('1-3-2026 其他分隔是月在前', f(S.parseDateish('1-3-2026')), '2026-01-03');
  chk('明確指定時聽指定的',       f(S.parseDateish('1.3.2026', false)), '2026-01-03');
  chk('整欄：點分隔沒證據→日在前', S.inferDayFirst(['1.3.2026','5.6.2026']) ? '日在前' : '月在前', '日在前');
  chk('整欄：點分隔有月證據→月在前', S.inferDayFirst(['1.25.2026','5.6.2026']) ? '日在前' : '月在前', '月在前');

  const T = (name, vals) => S.detectColumn(name, vals).type;
  chk('整欄：英文月份判成 date', T('Date',
    ['Jan 5, 2026','Feb 12, 2026','Mar 18, 2026','Apr 2, 2026','May 22, 2026','Jun 30, 2026']), 'date');
  chk('整欄：單價判成 money', T('Unit price', ['12.5','3.5','7.25','1.5']), 'money');
  chk('整欄：任務名稱不是 date', T('Task',
    ['Marketing 1','Marketing 2','Item 3','Row 12','Phase 4','Step 5']), 'text');
}

/* 月份橫排：項目直著排、期間橫著排（預算表、現金流、月報）。
   163 份裡 18 張是這樣，而且一張都沒有時間軸——12 個月就擺在欄名上，
   看法系統卻看不到，只能從剩下的欄硬挑，挑出「只看某個 Jan」（拿一月的
   金額當篩選）、「依 Total 分組」這種沒意義的軸。
   攤平成「項目 | 月份 | 金額」之後就是一張普通的三欄表。 */
{
  const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const budget = n => {
    const g = [['EXPENSE'].concat(MON).concat(['TOTAL'])];
    for (let i = 0; i < n; i++)
      g.push(['項目' + (i + 1)].concat(MON.map((_, m) => '$' + (500 + i * 120 + m * 7)))
        .concat(['$' + (6000 + i * 1440)]));
    return S.analyseSheet(g).tables[0];
  };
  const chk = (why, got, want) => {
    const pass = got === want;
    console.log(`${pass ? '✓' : '✗'} 攤平 ${why.padEnd(24)} 期望=${String(want).padEnd(10)} 實際=${got}`);
    pass ? ok++ : bad++;
  };
  const a = budget(8);
  chk('認出期間欄並攤平',   a.unpivoted, 'period');
  chk('列數 = 項目 × 月份', a.rows.length, 96);
  chk('合計欄丟掉',        a.cols.some(c => /TOTAL/i.test(c.name)), false);
  chk('分組是期間',        a.roles.group && a.roles.group.name, 'Month');
  chk('列名是項目',        a.roles.title && a.roles.title.name, 'EXPENSE');
  chk('前導是金額',        a.roles.lead && a.roles.lead.name, 'Amount');
  // 角色要釘住：一般規則會因為項目數多寡而翻轉分組與標題
  const big = budget(40);
  chk('40 個項目也一樣',   big.roles.group && big.roles.group.name, 'Month');
  chk('40 個項目列名不變', big.roles.title && big.roles.title.name, 'EXPENSE');

  // 不該攤平的
  const U = g => { const t = S.analyseSheet(g).tables[0]; return t ? (t.unpivoted || '') : '(無表)'; };
  chk('一般價目表不攤平', U([['品名','分類','單價'],['筆','文具','30'],['紙','文具','50'],
    ['墨','耗材','200'],['夾','文具','45'],['尺','文具','25']]), '');
  chk('只有兩個月欄不攤平', U([['項目','Jan','Feb'],['A','1','2'],['B','3','4'],['C','5','6']]), '');
  chk('沒有列標籤不攤平',  U([['Jan','Feb','Mar','Apr'],['1','2','3','4'],['5','6','7','8'],['9','10','11','12']]), '');
  chk('星期橫排仍走週表',  U([['時間','週一','週二','週三','週四'],['09:00','數學','國文','英文','數學'],
    ['10:00','理化','歷史','地理','體育'],['11:00','美術','音樂','數學','國文']]), 'week');

  /* 163 份跑出來的三個反例，都是「攤了反而更糟」：

     budget_6667de34 › Channel marketing budget 的 12 個月欄裡放的是文字，
     攤出 693 列、值欄判成 text，形狀沒有前導可用、整張掉到「一般表格」。
     攤平的前提是「項目 × 期間 = 一個值」，值不是值就沒有前提。

     budget_60c5b272 › Budget by month 的 12 個月欄只有一欄填了，
     攤完 17 列還是 17 列，卻多一個「Month 只有一種值」的警示。

     budget_1cbd5c5c 的「YEAR」、budget_6667de34 的「Rate」都是橫向彙總，
     但欄名不含合計字樣，光看欄名擋不掉，要看內容是不是數字。 */
  const txt = ['電視','報紙','網路','廣播','戶外','社群','郵寄','展覽'];
  chk('期間欄放文字不攤平', U([['Channel'].concat(MON)].concat(
    Array.from({ length: 8 }, (_, i) => ['通路' + (i + 1)].concat(MON.map((_, m) => txt[(i + m) % 8]))))), '');
  chk('只有一個期間有值不攤平', U([['Item'].concat(MON)].concat(
    Array.from({ length: 8 }, (_, i) => ['項目' + (i + 1), '$' + (100 + i)].concat(MON.slice(1).map(() => ''))))), '');

  // YEAR 是橫向彙總，欄名不含「合計」，要靠內容是數字才擋得掉
  const withYear = S.analyseSheet([['EXPENSE'].concat(MON).concat(['YEAR'])].concat(
    Array.from({ length: 8 }, (_, i) => ['項目' + (i + 1)]
      .concat(MON.map((_, m) => '$' + (500 + i * 120 + m * 7)))
      .concat(['$' + (6000 + i * 1440)])))).tables[0];
  chk('YEAR 彙總欄丟掉', withYear.cols.some(c => /YEAR/i.test(c.name)), false);
  chk('YEAR 的表仍照攤', withYear.unpivoted, 'period');

  /* 「格子裡要是數值」有一個例外：timeline_cc8dfa38 › SCHEDULE 是
     時間直排、日期橫排的節目表，格子裡是活動名稱。那跟週表是同一種東西
     （只是橫軸是日期而不是星期），攤平完全正確——原本一列並排五個活動，
     手機上根本讀不了。分辨的方法是剩下的欄裡有一欄是時間。
     角色也跟值矩陣相反：活動名稱當列名、時間當前導。 */
  const D = ['10/22/23','10/23/23','10/24/23','10/25/23','10/26/23'];
  const ev = ['開幕','專題演講','工作坊','午餐','圓桌','展示','閉幕','交流'];
  const grid = S.analyseSheet([['Date'].concat(D)].concat(
    Array.from({ length: 8 }, (_, i) =>
      [String(9 + i).padStart(2, '0') + ':00'].concat(D.map((_, d) => ev[(i + d) % 8]))))).tables[0];
  chk('排程格照攤',       grid.unpivoted, 'period');
  chk('排程格分組是日期',  grid.roles.group && grid.roles.group.name, 'Period');
  chk('排程格列名是活動',  grid.roles.title && grid.roles.title.name, 'Value');
  chk('排程格前導是時間',  grid.roles.lead && grid.roles.lead.name, 'Date');

  /* 時段橫排也是同一種結構，只是橫軸的單位從月變成小時。
     schedule_54d4fddf 那七張排班表是「Employee ｜ 7:00 AM ｜ … ｜ 3:00 PM」，
     攤平前只拿到「照 Total 排名」一張卡，連分組都沒有。
     用 parseTimeish 判欄名而不是自己寫正則：純數字不會被當成時間，
     所以甘特圖（欄名是 1…30 的日號）不會被誤攤成一千多列的「x」。 */
  const HR = ['7:00 AM','8:00 AM','9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM'];
  const role = ['櫃檯','後場','外場','備料','收銀'];
  const shift = S.analyseSheet([['Employee'].concat(HR).concat(['Sick?','Total'])].concat(
    Array.from({ length: 5 }, (_, i) => ['員工' + (i + 1)]
      .concat(HR.map((_, h) => (h >= 1 && h <= 7) ? role[(i + h) % 5] : ''))
      .concat(['', '8'])))).tables[0];
  chk('時段橫排照攤',     shift.unpivoted, 'period');
  chk('時段欄叫「Time」',  shift.cols.some(c => c.name === 'Time'), true);
  chk('時段橫排分組是時段', shift.roles.group && shift.roles.group.name, 'Time');
  chk('時段橫排列名是員工', shift.roles.title && shift.roles.title.name, 'Employee');

  // 甘特圖的欄名是純數字，不是時間也不是期間
  chk('甘特圖不攤平', U([['工作項目'].concat(Array.from({ length: 30 }, (_, d) => String(d + 1)))].concat(
    Array.from({ length: 20 }, (_, i) => ['工作' + (i + 1)]
      .concat(Array.from({ length: 30 }, (_, d) => (d >= i && d < i + 4) ? 'x' : ''))))), '');

  /* v79 的「值要是數值」是自己算 RE_NUMLIKE 的比例、門檻 0.7，
     而 detectColumn 用另一個正則、門檻 0.8——budget_6667de34 ›
     Channel marketing budget 剛好卡在兩者中間：我這邊算過了、
     它那邊判成 text，於是攤出 693 列、值欄沒有型別可用。
     要問的就是「攤出來的值欄會不會是金額或數字」，那就直接問那個函式。 */
  chk('值欄七成數字三成文字不攤平', U([['項目'].concat(MON)].concat(
    Array.from({ length: 10 }, (_, i) => ['項目' + (i + 1)].concat(
      MON.map((_, m) => (i * 12 + m) % 10 < 7 ? String(100 + i * 7 + m) : '待確認'))))), '');
  chk('值欄全是數字照攤', U([['項目'].concat(MON)].concat(
    Array.from({ length: 10 }, (_, i) => ['項目' + (i + 1)].concat(
      MON.map((_, m) => String(100 + i * 7 + m)))))), 'period');

  /* 會計格式的零是「$-」。v79 把它當成有值，於是
     expense_68cc5838 › Actual expenses 的七月到十二月（整欄 $-）拿到
     28% 填充率跟兩種值、剛好符合分類欄的條件，被挑去當分組軸；
     而 Expense variances 的 192 格差異有一半以上是 $-，金額欄被判成
     text、排不了名。兩張都因此不再攤平。
     現在 $- 跟空白同一件事：不算填充、也不攤成卡片。 */
  const half = S.analyseSheet([['EXPENSE'].concat(MON).concat(['TOTAL'])].concat(
    Array.from({ length: 10 }, (_, i) => ['項目' + (i + 1)]
      .concat(MON.map((_, m) => m < 6 ? '$' + (500 + i * 120 + m * 7) + '.00' : '$-'))
      .concat(['$' + (3000 + i * 720) + '.00'])))).tables[0];
  chk('半年沒發生的表照攤',   half.unpivoted, 'period');
  chk('$- 不攤成卡片',       half.rows.length, 60);
  chk('月份軸只留有值的月份', half.cols.filter(c => c.name === 'Month')[0].distinct, 6);
  chk('金額欄是金額',        half.roles.lead && half.roles.lead.type, 'money');

  /* 季別本來只認得「Q1」，chart_94c0fff6 › Sales data 的欄名是「QTR 1」，
     同一種東西只是寫法不同，整張 15×6 的產品季報因此留在寬表。
     攤平後那一欄該叫什麼也要分清楚：原本是用「開頭是不是字母」判斷是不是
     月份，所以 QTR 1…QTR 4 攤完會叫「Month」。 */
  {
    const q = S.analyseSheet([['PRODUCT NAME','QTR 1','QTR 2','QTR 3','QTR 4','TOTAL']].concat(
      Array.from({ length: 15 }, (_, i) => ['產品 ' + (i + 1),
        '$' + (1000 + i * 37) + '.00', i < 5 ? '$' + (500 + i * 11) + '.00' : '',
        i < 1 ? '$300.00' : '', i < 1 ? '$200.00' : '', '$' + (2000 + i * 48) + '.00']))).tables[0];
    chk('QTR 1 也是季別',   q.unpivoted, 'period');
    chk('季別欄叫 Quarter', q.cols.some(c => c.name === 'Quarter'), true);
    chk('季報列名是產品',    q.roles.title && q.roles.title.name, 'PRODUCT NAME');
    const ym = S.analyseSheet([['項目','2023年1月','2023年2月','2023年3月','2023年4月']].concat(
      Array.from({ length: 10 }, (_, i) => ['項目' + (i + 1)]
        .concat([0,1,2,3].map(m => '$' + (100 + i * 7 + m)))))).tables[0];
    chk('年月欄叫月份', ym.cols.some(c => c.name === '月份'), true);
    const dt = S.analyseSheet([['Date','10/22/23','10/23/23','10/24/23','10/25/23']].concat(
      Array.from({ length: 8 }, (_, i) => [String(9 + i).padStart(2, '0') + ':00']
        .concat([0,1,2,3].map(d => '活動 ' + ((i + d) % 8)))))).tables[0];
    chk('日期欄仍叫 Period', dt.cols.some(c => c.name === 'Period'), true);
  }

  // 差異表：$- 之外是會計式負數，整欄仍然是金額
  const vari = S.analyseSheet([['EXPENSE'].concat(MON).concat(['TOTAL'])].concat(
    Array.from({ length: 10 }, (_, i) => ['項目' + (i + 1)]
      .concat(MON.map((_, m) => m % 3 === 0 ? '$(' + (100 + i * 7 + m) + '.00)' : '$-'))
      .concat(['$(' + (1900 + i * 13) + '.00)'])))).tables[0];
  chk('差異表照攤',     vari.unpivoted, 'period');
  chk('差異欄是金額',   vari.roles.lead && vari.roles.lead.type, 'money');
  chk('只留真的有差異', vari.rows.length, 40);
}

{
  const chk = (why, got, want) => {
    const pass = got === want;
    console.log(`${pass ? '✓' : '✗'} 形狀 ${why.padEnd(26)} 期望=${String(want).padEnd(12)} 實際=${got}`);
    pass ? ok++ : bad++;
  };
  const MON = ['Jan','Feb','March','April','May','June','July','Aug','Sept','Oct','Nov','Dec'];

  /* 攤平後釘角色是用位置找的，不能用欄名找：第一欄不見得有欄名。
     budget_b0a247ff › Summary 的列標籤欄在原檔裡沒有標題，
     a.cols 給它合成的「欄 1」跟 t.grid[0][0] 的空字串對不起來，
     整段釘角色被跳過，月份變列名、只有兩種值的標籤欄變分組軸。 */
  {
    const head = [''].concat(MON, ['Year']);
    const rows = [];
    const labels = ['Income','Expenses','Balance','Savings','Notes','Summary'];
    for (let i = 0; i < 6; i++) {
      const r = [labels[i]];
      for (let m = 0; m < 12; m++) r.push(i < 2 ? '$' + (2000 + i * 500 + m * 17) + '.00' : '');
      r.push(i < 5 ? '$' + (24000 + i * 900) + '.00' : '');
      rows.push(r);
    }
    const a = S.analyseSheet([head].concat(rows)).tables[0];
    chk('沒有欄名的標籤欄照攤',  a.unpivoted, 'period');
    chk('沒有欄名也當得了列名', a.roles.title && a.roles.title.name, '欄 1');
    chk('分組軸還是期間',      a.roles.group && a.roles.group.name, 'Month');
    chk('理由照釘住的角色寫',   /以「欄 1」為列名/.test(a.shape.reason), true);
  }

  /* 期間前面可能不只一欄，而第一欄不見得最適合當列名。
     cashflow_281b542f › Monthly cash flow 攤完是
     Type（4 種）｜Description（36 種）｜Month｜Amount——拿 Type 當列名，
     258 張卡只有四種名字。同一個範本的 accounting_b55730e7 在 v80
     還因為釘角色那段時成時不成，兩張一樣的表給出兩種版面。 */
  {
    const ty = ['Income','Fixed','Variable','Other'];
    const g = [['Type','Description'].concat(MON)];
    for (let i = 0; i < 36; i++) {
      const r = [ty[i % 4], '項目 ' + (i + 1)];
      for (let m = 0; m < 12; m++) r.push(m < 6 ? '$' + (100 + i * 7 + m) + '.00' : '');
      g.push(r);
    }
    const cf = S.analyseSheet(g).tables[0];
    chk('兩欄列標籤挑相異多的', cf.roles.title && cf.roles.title.name, 'Description');
    chk('分組軸仍是期間',     cf.roles.group && cf.roles.group.name, 'Month');
  }

  /* 矩陣的前提是沒有別的軸可以分組。後面還有一欄分得出組的分類時，
     那是一張可以照它篩選的清單，判成矩陣會連前導一起失去。
     budget_2d4c31d3 › Monthly expenses：Description｜Category（12 種）｜
     預算｜實際｜差異——差異欄從分類變回金額之後矩陣就成立了，
     59 列的支出清單因此沒了「照金額由大到小」。 */
  {
    const cat = ['住','食','行','育','樂','醫','保','稅','寵','車','水電','其他'];
    const rows = [];
    for (let i = 0; i < 59; i++) rows.push(['支出項目 ' + (i + 1), cat[i % 12],
      i % 3 ? '$' + (100 + i * 7) + '.00' : '', i % 3 ? '$' + (90 + i * 8) + '.00' : '',
      i % 5 ? '$' + (10 - i % 7) + '.00' : '']);
    const a = S.analyseSheet([['Description','Category','Projected cost','Actual cost','Difference']]
      .concat(rows)).tables[0];
    chk('有分類軸就不是矩陣', a.shape.shape, 'pricelist');
    chk('分類當分組軸',     a.roles.group && a.roles.group.name, 'Category');
    chk('金額當前導',       a.roles.lead && a.roles.lead.type, 'money');
    // 備註那種文字欄不該擋矩陣（0.6 那條門檻本來就是為了放過它）
    // 欄名不要用 Q1/Q2/Q3——那會先被季別攤平接走，就測不到矩陣這條
    const m = S.analyseSheet([['Item','Note','Score A','Score B','Score C']].concat(
      Array.from({ length: 10 }, (_, i) => ['品項' + (i + 1), '註記 ' + i,
        '$' + (100 + i), '$' + (200 + i), '$' + (300 + i)]))).tables[0];
    chk('多一欄備註仍是矩陣', m.shape.shape, 'matrix');
  }

  /* 金額欄要挑真的有值的。confidence 是在有值的格子裡算的，所以一欄 66 列
     只填 1 格的 money 照樣拿 1.0——budget_6667de34 › Channel marketing budget
     的「欄 1」就是這樣當上前導的，旁邊明明有填了 68% 的「Total」。 */
  {
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const rows = [];
    for (let i = 0; i < 66; i++) {
      const r = [i === 0 ? '$1,000.00' : '', '行銷通路 ' + (i + 1), i % 4 === 0 ? ('費率 ' + (i % 7)) : ''];
      for (let m = 0; m < 12; m++) r.push(i % 9 === 0 ? '' : '方案 ' + ((i * 12 + m) % 54));
      r.push(i % 3 === 0 ? '' : '$' + (1000 + i * 37) + '.00');
      rows.push(r);
    }
    const a = S.analyseSheet([[''].concat(['Channel','Rate'], M, ['Total'])].concat(rows)).tables[0];
    chk('稀疏的金額欄不當前導', a.roles.lead && a.roles.lead.name, 'Total');
  }

  /* 下拉選單那條要看「宣告了幾欄」。expense_d75b85c4 › Expenses 是一張還沒填的
     預算範本，宣告六欄、金額欄全空；$- 當空白之後 live 剩兩欄，
     整張表就被當成選單來源藏起來了。 */
  {
    const rows = [];
    for (let i = 0; i < 21; i++) rows.push(['支出 ' + (i + 1), i % 2 ? '固定' : '變動', '', '', '', '']);
    const grid = [['Expense','Category','Budget','Actual','Difference ($)','Difference (%)']].concat(rows);
    const v = S.sheetVerdict(grid, S.analyseSheet(grid).tables);
    chk('還沒填的範本要顯示', v.show, true);
    /* 但只有一欄有值、其餘整欄空白的就沒東西可讀了——
       student_b6316bb6 › Applications 是五列比較項目加三所學校的空欄，
       timeline_c7bfc3e8 那三張內容日曆是 60 列只有 MONTH 有值。 */
    const empty1 = [['Key information','Bellows College','Jasper University','Glenwood University']]
      .concat(['學費','地點','科系','宿舍','獎學金'].map(k => [k, '', '', '']));
    chk('只有一欄有值要藏起來', S.sheetVerdict(empty1, S.analyseSheet(empty1).tables).show, 'weak');
    // 真的下拉來源清單本來就只宣告一兩欄（單欄的連表格區塊都切不出來）
    const src = [['縣市','區'], ['台北','中正'], ['台中','西屯'], ['台南','東區'],
                 ['高雄','左營'], ['新竹','東區']];
    chk('真的選單來源仍擋掉', S.sheetVerdict(src, S.analyseSheet(src).tables).show, 'weak');
  }
}

{
  const chk = (why, got, want) => {
    const pass = got === want;
    console.log(`${pass ? '✓' : '✗'} 判型 ${why.padEnd(24)} 期望=${String(want).padEnd(10)} 實際=${got}`);
    pass ? ok++ : bad++;
  };
  const ty = vs => S.detectColumn('數值', vs).type;
  chk('$- 當空白',      ty(['$-', '$-', '$-']), 'empty');
  chk('$ - 當空白',     ty(['$ -', '$ -', '$ -']), 'empty');
  chk('NT$- 當空白',    ty(['NT$-', 'NT$-', 'NT$-']), 'empty');
  chk('- 還是空白',     ty(['-', '—', '-']), 'empty');
  chk('$ 不是空白',     ty(['$', '$', '$']) === 'empty', false);
  chk('會計式負數是金額', ty(['$(635.00)', '$(120.00)', '$1,905.00']), 'money');
  chk('一半 $- 仍是金額', ty(['$-', '$-', '$1,905.00', '$(635.00)']), 'money');
  // 理由要跟真正成立的那一條一致：原本一律寫「欄名含金額字樣，且 0% 是數字」
  chk('金額理由講符號',   /金額符號/.test(S.detectColumn('Amount', ['$(1.00)', '$(2.00)', '$3.00']).reason), true);
  chk('金額理由講數字',   /是數字/.test(S.detectColumn('Amount', ['1', '2', '3']).reason), true);
}

const urls={普渡:['schedule','1b72qwLM_0xUdisA2uKxqUa98-EJwC-UJPyXsEaLJoiI'],
  甘特圖:['schedule','1DJIy4I7vbVgk9lBcnMCGq9z2wo-J8hR-hZzKHxwHSZs'],
  帳表:['ledger','1BsOykBCciRxZDDFe1-S957ONmf5chqt9']};
let skipped=0;
for(const [n,[want,id]] of Object.entries(urls)){
  let a=null, why='';
  try{
    const r=await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv`);
    if(!r.ok) throw new Error('HTTP '+r.status);
    a=S.analyseSheet(csv(await r.text())).tables[0];
    if(!a||!a.shape) throw new Error('沒有解析出表');
  }catch(e){ why=e.message; }
  if(!a){ console.log(`- ${n.padEnd(6)} 跳過（連不到來源：${why}）`); skipped++; continue; }
  const pass=a.shape.shape===want;
  console.log(`${pass?'✓':'✗'} ${n.padEnd(6)} 期望=${want.padEnd(10)} 實際=${a.shape.shape}`);
  pass?ok++:bad++;
}
if(skipped) console.log(`\n（${skipped} 筆線上案例跳過，要連得到 docs.google.com 才跑得到）`);
console.log(`\n${ok} 通過 · ${bad} 失敗`);
process.exit(bad?1:0);
