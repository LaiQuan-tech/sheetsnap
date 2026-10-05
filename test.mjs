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
