/**
 * 表格形狀偵測引擎
 *
 * 輸入：二維陣列（第一列為標題）
 * 輸出：每一欄的型別 + 整張表的形狀 + 欄位角色指派
 *
 * 設計原則：所有判斷都要能說出理由（reason），否則無法驗證準確度。
 */
(function (root) {
  'use strict';

  /* ══ 值的型別測試 ══ */

  function ymd(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;   // 擋掉 2/30
    return dt;
  }

  // 認得：2026年8月14日 / 2026-08-14 / 2026/8/14 / 民國114/8/14 / 8/14
  /* 「3/1/2026」是哪一天，看寫的人在哪裡：美國是 3 月 1 日、歐洲是 1 月 3 日，
     台灣寫「3/1」也是 3 月 1 日。單看一個值分不出來，但看一整欄就分得出來——
     只要出現過第一個數字 > 12，那個位置就只能是日；第二個數字 > 12 就只能是日。
     兩種都出現（資料本身不一致）或兩種都沒出現（整欄都在 1–12），就用月在前，
     因為那同時符合台灣與美國的寫法；歐式會判錯，但那是沒有證據時的取捨，
     有證據的時候一律照證據走。 */
  var RE_MDY = /^(\d{1,2})\s*[\-\/.]\s*(\d{1,2})(?:\s*[\-\/.]\s*(\d{2,4}))?\s*$/;

  /* 英文月份。微軟範本大量用「Jan 5, 2026」「5-Jan」「March 1」這幾種寫法，
     原本一個都讀不出來。
     只收「三字母縮寫」與「完整月名」（可帶句點），不收任意前綴——
     否則「Marketing 1」會被讀成 3 月 1 日。Sept 另外收，那是常見的例外。 */
  var MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june',
                   'july', 'august', 'september', 'october', 'november', 'december'];

  function monthFromWord(w) {
    var t = String(w).toLowerCase().replace(/\.$/, '');
    for (var i = 0; i < 12; i++) {
      if (t === MONTHS_EN[i] || t === MONTHS_EN[i].slice(0, 3)) return i + 1;
    }
    return t === 'sept' ? 9 : 0;
  }

  function fullYear(y, has) {
    if (!has) return new Date().getFullYear();
    return y < 100 ? y + (y < 70 ? 2000 : 1900) : y;
  }

  function inferDayFirst(values) {
    var aBig = false, bBig = false, dot = false;
    for (var i = 0; i < values.length; i++) {
      var m = String(values[i] == null ? '' : values[i]).trim().match(RE_MDY);
      if (!m) continue;
      if (+m[1] > 12) aBig = true;
      if (+m[2] > 12) bBig = true;
      if (aBig && bBig) return false;   // 兩種都出現 = 資料不一致，再掃也不會變
      if (m[0].indexOf('.') >= 0) dot = true;
    }
    // 數字沒給證據時才看寫法：點分隔是歐陸的日.月.年
    if (!aBig && !bBig) return dot;
    return aBig && !bBig;
  }

  function parseDay(v, dayFirst) {
    var s = String(v == null ? '' : v).trim();
    if (!s || s.length > 40) return null;
    var m;

    // 年在前：2026-03-01、2026/3/1、2026年3月1日
    if ((m = s.match(/(\d{4})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})/)))
      return ymd(+m[1], +m[2], +m[3]);

    /* 民國。原本只要開頭是 2–3 位數就算，沒有收尾——「03/01/2026」因此被讀成
       民國 3 年 1 月 20 日，吐出 1914-01-20。不是解析失敗，是解析成一個錯的
       日期，比解析不出來更糟。現在要有明確的依據才算民國：寫明「民國」、
       用「年月日」當分隔、三位數年份（民國 100 年之後），或兩位數但大於 31
       （當不了月也當不了日，只能是年）。 */
    if ((m = s.match(/^民國\s*(\d{1,3})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})\s*日?\s*$/)) ||
        (m = s.match(/^(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*$/)) ||
        ((m = s.match(/^(\d{2,3})\s*[\-\/.]\s*(\d{1,2})\s*[\-\/.]\s*(\d{1,2})\s*$/)) &&
         (m[1].length === 3 || +m[1] > 31))) {
      var y = +m[1];
      return ymd(y < 200 ? y + 1911 : y, +m[2], +m[3]);
    }

    /* 西式三段：3/1/2026、12/22/2026、1.3.26。日月順序由整欄決定（見 inferDayFirst）。
       沒有欄位脈絡時（dayFirst 沒給）才看分隔符：點分隔的「1.3.2026」是德奧瑞
       那一帶的寫法，幾乎都是日在前；斜線的是美式，月在前。
       有欄位脈絡時一律聽欄位的——整欄出現過 >12 的證據比寫法習慣可靠。 */
    if ((m = s.match(/^(\d{1,2})\s*([\-\/.])\s*(\d{1,2})\s*[\-\/.]\s*(\d{2,4})\s*$/))) {
      var y2 = +m[4];
      if (m[4].length <= 2) y2 += y2 < 70 ? 2000 : 1900;
      var df = dayFirst === undefined ? m[2] === '.' : dayFirst;
      return df ? ymd(y2, +m[3], +m[1]) : ymd(y2, +m[1], +m[3]);
    }

    /* 英文月份在前：Jan 5, 2026／January 5／Mar-1／Sep 30th。
       日的後面不能再接數字（(?!\d)）：沒有這一條，「Feb 2023」會被讀成
       2 月 20 日 2023 年——那是月份標籤不是日期，而 cashflow_f7200e29 ›
       Cash flow forecast 的欄名就是一整排「Feb 2023、Mar 2023…」，
       一旦被當成日期，找標題列的那段就認為那一列是資料、把標題列往下挪到
       第 10 列，欄名全變成「$2,500.00」這種金額。
       月份＋年份（沒有日）刻意不收：收了就會再踩到同一個坑。 */
    if ((m = s.match(/^([A-Za-z]{3,9}\.?)\s*[-\s]\s*(\d{1,2})(?!\d)(?:st|nd|rd|th)?\s*[-,]?\s*(\d{2,4})?\s*$/))) {
      var mo = monthFromWord(m[1]);
      if (mo) return ymd(fullYear(+m[3], !!m[3]), mo, +m[2]);
    }
    // 英文月份在後：5-Jan／5 January 2026／1st Mar 26
    if ((m = s.match(/^(\d{1,2})(?!\d)(?:st|nd|rd|th)?\s*[-\s]\s*([A-Za-z]{3,9}\.?)\s*[-,]?\s*(\d{2,4})?\s*$/))) {
      var mo2 = monthFromWord(m[2]);
      if (mo2) return ymd(fullYear(+m[3], !!m[3]), mo2, +m[1]);
    }

    /* 只有月日：3/1、3月1日。寫了「月」就不必猜順序。

       這裡不收「.」當分隔。沒有年份的「12.5」幾乎都是小數而不是 12 月 5 日，
       而型別偵測是先問日期再問金額，所以一整欄 12.5／3.5／7.25 的單價會被
       判成 date——inventory_53587d4d › Inventory List 的「Unit price」就是
       這樣變成日期欄的（v72 的 baseline 就已經這樣了，是這一版加了
       每欄的填充率與相異值數才看見）。
       三段式的「1.3.2026」跟年在前的「2026.3.1」照收，那些有年份、不會跟
       小數搞混。 */
    if ((m = s.match(/^(\d{1,2})\s*[\-\/月]\s*(\d{1,2})\s*日?\s*(前|後|底|初|中|左右|以前|之前|以後)?$/))) {
      var swap = dayFirst && !/月/.test(s);
      return ymd(new Date().getFullYear(), swap ? +m[2] : +m[1], swap ? +m[1] : +m[2]);
    }
    return null;
  }

  /* 月份＋年份：「Feb 2023」「September 2022」「2023年2月」。
     當成那個月的 1 號。現金流預測、月報這類表就是一列一個月，那是真的時間軸——
     cashflow_f7200e29 › Cash flow chart 的 Month 欄 12 列全是這種寫法。

     但它不能算進「這一格像不像某一天」：月份＋年份正是大家拿來當欄名的東西
     （「Feb 2023 | Mar 2023 | Apr 2023…」），找標題列的那段一旦把整列欄名
     看成資料，就會把標題列往下挪，欄名全變成資料值。
     所以分成兩個函式：parseDateish 給型別偵測用（收月份），
     dateish 給結構前處理用（只認某一天）。 */
  function parseMonth(v) {
    var s2 = String(v == null ? '' : v).trim(), m;
    if (!s2 || s2.length > 40) return null;
    if ((m = s2.match(/^([A-Za-z]{3,9}\.?)\s*[-\s]?\s*(\d{4})$/))) {
      var mo = monthFromWord(m[1]);
      if (mo) return ymd(+m[2], mo, 1);
    }
    if ((m = s2.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月$/))) return ymd(+m[1], +m[2], 1);
    return null;
  }

  function parseDateish(v, dayFirst) { return parseDay(v, dayFirst) || parseMonth(v); }

  /* 「這格看起來像不像某一天」：結構前處理（找標題列、切表、判斷是不是
     圖表資料區）用的。沒有整欄的脈絡可以推順序，所以兩種順序任一個解得出來
     就算；25/12/2026 在月在前的讀法下是無效月份。
     刻意不收月份＋年份，理由見上面 parseMonth。 */
  function dateish(v) { return !!parseDay(v) || !!parseDay(v, true); }

  // 認得：上午 10:30 / 下午 7:00 / 14:05 / 2:30 PM，以及 09:00-10:00 這種區間。
  // 節目表、議程、流程表幾乎都用區間寫時間，只認單一時刻會讓整條時間軸消失。
  var RE_ONE = /^(上午|下午|早上|晚上|AM|PM)?\s*(\d{1,2})[:：](\d{2})\s*(AM|PM)?$/i;
  var RE_RANGE = /^(.+?)\s*(?:[-–—~～]|至|to)\s*(.+)$/i;

  function oneTime(s) {
    var m = String(s).trim().match(RE_ONE);
    if (!m) return null;
    var h = +m[2], mi = +m[3];
    if (h > 23 || mi > 59) return null;
    var tag = (m[1] || '') + (m[4] || '');
    if (/下午|晚上|PM/i.test(tag) && h < 12) h += 12;
    if (/上午|早上|AM/i.test(tag) && h === 12) h = 0;
    return { h: h, m: mi, mins: h * 60 + mi, text: (h < 10 ? '0' : '') + h + ':' + m[3] };
  }

  function parseTimeish(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || s.length > 40) return null;

    var one = oneTime(s);
    if (one) return one;

    var r = s.match(RE_RANGE);
    if (r) {
      var a = oneTime(r[1]), b = oneTime(r[2]);
      // 起訖都要是時間才算區間，否則「早上-下午」這種字串會被誤判
      if (a && b) return { h: a.h, m: a.m, mins: a.mins, end: b, text: a.text + '–' + b.text };
    }
    return null;
  }

  var reNumber = /^-?\s*[\d,]+(\.\d+)?\s*$/;
  var reMoney  = /[$＄¥￥€]|NT|元|塊/i;
  var reEmail  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var reUrl    = /^https?:\/\/\S+$/i;

  function isPhoneish(v) {
    var s = String(v).trim();
    if (!/^[\d\-+()#\s]+$/.test(s)) return false;
    var digits = s.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15;
  }

  /* ══ 單欄偵測 ══ */

  var NAME_HINTS = {
    date:     /日期|時間|date|day|時程|檔期|deadline|due|到期/i,
    time:     /時間|時刻|time|hour|開始|結束/i,
    money:    /價|金額|費用|費$|價格|單價|小計|總計|預算|薪|稅|帳款|收款|付款|營收|支出|請款|報價|price|amount|cost|fee|budget|total|salary|revenue|invoice/i,
    person:   /人員|負責|姓名|名字|承辦|窗口|聯絡人|主辦|owner|assignee|name|person|people|contact|staff|member/i,
    phone:    /電話|手機|聯絡|分機|phone|tel|mobile|cell/i,
    email:    /信箱|郵件|email|mail/i,
    status:   /狀態|進度|階段|status|state|stage|phase|完成|處理/i,
    category: /類別|分類|種類|群組|組別|部門|類型|category|type|group|dept|kind|tag/i,
    note:     /備註|說明|內容|描述|摘要|note|memo|remark|desc|comment|detail/i,
    qty:      /數量|人數|件數|qty|quantity|count|數$/i
  };

  /* 會計格式的零寫成「$-」：Excel 的 Accounting 把 0 印成貨幣符號
     加一個破折號，匯出來就是「$-」。它跟「-」是同一件事——這一格沒有
     金額——只是多了個貨幣符號，上面那串字樣擋不到，整欄就被當成有值。

     expense_68cc5838 › Expense variances 是最清楚的例子：192 格差異有一半
     以上是「$-」（差異為零），rMoney 要求同時有符號跟數字，所以不到
     五成，金額欄被判成 text：排不了名、當不了前導。
     「Actual expenses」的七月到十二月同理：那六個月還沒發生、整欄都是
     「$-」，卻拿到 28% 填充率跟兩種值，剛好符合分類欄的條件，
     於是被挑去當分組軸——一個全是零的月份欄。 */
  var RE_NULLISH = /^(?:NT\$?|[$＄¥￥€£])?\s*([-–—－]|N\/A|n\/a|NA|無|nil|null)$/;

  /* person 是純關鍵字判定、沒有內容檢查，而「name」在真實範本裡太好中：
     163 份微軟範本抓出 33 個 person 欄，其中 13 個根本不是人——
     PRODUCT NAME、PROJECT NAME×2、Course name×3、Merchant name、
     Company name、ASSET NAME、Team name、NAME OF ORGANIZATION、
     PERSONNEL EXPENSES×2。（「name」本來就是每一種東西都有的欄名）
     誤判的代價不小：person 在篩選排序裡是最高優先（v61），又排在排名
     之前（v68），所以一欄品名會擠掉真正的狀態欄或排名看法。
     判法是「欄名指名了非人的主體就不算人員」，而明確的人字樣
     不受影響：「專案負責人」要留著。

     這裡曾經多一道「只憑一個 name 中的還要求值有重複」（一人一列
     的 Name 就不算人），跑完 163 份拆掉了：它把 Team roster、Guests、
     Candidates、Interviewers、Share list、Contact name、Lead name 共 9 欄真的
     人員也降成文字——名冊本來就是一人一列。而它一開始想擋的事
     其實不存在：全相異的欄本來就過不了 filterOptions 的 avg≥1.5
     跟 groupOptions 的 avg≥2，沒有篩選卡可以被它擠掉。
     代價卻是真的：person 降成 text 之後會被 codeLike 扣分，
     inventory_cf2db84f 的 25 张卡片標題從品名「Name」變成「Inventory ID」。 */
  var PERSON_SURE = /人員|負責|姓名|名字|承辦|窗口|聯絡人|主辦|owner|assignee|staff|member|salesperson|\bperson\b|\bpeople\b/i;
  var NOT_PERSON  = /產品|商品|品名|品項|專案|課程|公司|廠商|供應商|品牌|資產|團隊|組織|機構|檔案|活動|帳戶|科目|product|project|course|compan|vendor|merchant|supplier|brand|asset|team|organi[sz]|institut|\bitem|\bfile|event|account|personnel/i;

  function personish(name) {
    return PERSON_SURE.test(name) || !NOT_PERSON.test(name);
  }

  function detectColumn(name, values) {
    var all = values.map(function (v) { return String(v == null ? '' : v); });
    // 「-」代表「沒有」，不是資料。當成空白才不會把金額欄拉成一般文字。
    var filled = all.filter(function (v) {
      var t = v.trim(); return t !== '' && !RE_NULLISH.test(t);
    });
    var n = filled.length;

    var col = {
      name: name,
      filled: n,
      total: all.length,
      fillRate: all.length ? n / all.length : 0,
      // 8 筆不是為了顯示（畫面只秀前 3 筆），是 codeLike／serialLike 要用：
      // 「長度整齊」用 3 筆判根本不準，隨便三個差不多長的值就成立。
      samples: filled.slice(0, 8),
      distinct: 0,
      avgLen: 0,
      type: 'empty',
      confidence: 0,
      reason: '整欄空白'
    };
    if (!n) return col;

    var uniq = {};
    filled.forEach(function (v) { uniq[v.trim()] = 1; });
    col.distinct = Object.keys(uniq).length;
    col.avgLen = filled.reduce(function (a, v) { return a + v.length; }, 0) / n;
    col.multiline = filled.some(function (v) { return v.indexOf('\n') >= 0; });
    col.multilineRatio = filled.filter(function (v) { return v.indexOf('\n') >= 0; }).length / n;

    var ratio = function (fn) { return filled.filter(fn).length / n; };
    var hint = function (k) { return NAME_HINTS[k].test(name); };
    var pct = function (r) { return Math.round(r * 100) + '%'; };

    // 日月順序整欄推一次就好，推完存在欄上——畫面要照同一個順序把日期印回來
    col.dayFirst = inferDayFirst(filled);
    var rDate  = ratio(function (v) { return !!parseDateish(v, col.dayFirst); });
    var rTime  = ratio(function (v) { return !!parseTimeish(v); });
    var rNum   = ratio(function (v) { return reNumber.test(v); });
    var rMoney = ratio(function (v) { return reMoney.test(v) && /\d/.test(v); });
    var rMail  = ratio(function (v) { return reEmail.test(v.trim()); });
    var rUrl   = ratio(function (v) { return reUrl.test(v.trim()); });
    var rPhone = ratio(isPhoneish);
    var repeats = col.distinct < n;          // 至少有一個值出現過兩次才算得上分類

    // 依序判斷，先中先贏
    if (rDate >= 0.6) {
      col.type = 'date'; col.confidence = rDate;
      col.reason = pct(rDate) + ' 的值可解析為日期';
    } else if (rTime >= 0.6 || (hint('time') && rTime >= 0.3)) {
      col.type = 'time'; col.confidence = rTime;
      col.reason = pct(rTime) + ' 的值可解析為時間' + (hint('time') ? '，欄名也含時間字樣' : '');
    } else if (rMail >= 0.5) {
      col.type = 'email'; col.confidence = rMail;
      col.reason = pct(rMail) + ' 的值是電子郵件格式';
    } else if (rUrl >= 0.5) {
      col.type = 'url'; col.confidence = rUrl;
      col.reason = pct(rUrl) + ' 的值是網址';
    } else if (rPhone >= 0.6 && (hint('phone') || rPhone >= 0.85)) {
      col.type = 'phone'; col.confidence = rPhone;
      col.reason = pct(rPhone) + ' 的值像電話號碼' + (hint('phone') ? '，欄名也含電話字樣' : '');
    } else if ((rMoney >= 0.5) || (rNum >= 0.7 && hint('money'))) {
      col.type = 'money'; col.confidence = Math.max(rMoney, rNum);
      // 理由要跟真正成立的那一條一致。原本只看欄名有沒有金額字樣，
      // 所以一欄全是 $(635.00) 的 Amount 會寫「且 0% 是數字」，看起來像弄錯了。
      col.reason = rMoney >= 0.5 ? pct(rMoney) + ' 的值帶有金額符號'
                                 : '欄名含金額字樣，且 ' + pct(rNum) + ' 是數字';
    } else if (rNum >= 0.8) {
      col.type = 'number'; col.confidence = rNum;
      col.reason = pct(rNum) + ' 的值是數字';
    } else if (col.multilineRatio >= 0.15 || col.avgLen > 25) {
      // 只看「有沒有換行」會誤判：145 筆裡 2 筆換行的人員欄不是長文字
      col.type = 'longtext'; col.confidence = Math.min(1, col.avgLen / 40);
      col.reason = col.multilineRatio >= 0.15
        ? Math.round(col.multilineRatio * 100) + '% 的值有換行，屬長文字'
        : '平均長度 ' + Math.round(col.avgLen) + ' 字，屬長文字';
    } else if (hint('person') && personish(name)) {
      col.type = 'person'; col.confidence = 0.8;
      col.reason = '欄名含人員／負責人字樣';
    } else if (repeats && !hint('note') && col.distinct <= 8 && col.avgLen <= 10) {
      // 用「值有沒有重複出現」當門檻，而不是比例。
      // 比例門檻（distinct < n*0.5）在小表上永遠不成立：
      // 4 列的表有 3 種狀態時 3 < 2 為假，狀態欄就會被誤判成一般文字。
      col.type = hint('status') ? 'status' : 'category';
      col.confidence = 1 - col.distinct / Math.max(n, 1);
      col.reason = '只有 ' + col.distinct + ' 種不同的值、字都很短，適合當' +
                   (col.type === 'status' ? '狀態' : '分類');
    } else if (repeats && !hint('note') && col.distinct <= 20 && col.distinct <= n * 0.6 && col.avgLen <= 14) {
      col.type = 'category'; col.confidence = 1 - col.distinct / Math.max(n, 1);
      col.reason = col.distinct + ' 種重複出現的短值，可當分類';
    } else {
      col.type = 'text'; col.confidence = 0.5;
      col.reason = '一般文字（' + col.distinct + ' 種相異值）';
    }
    return col;
  }

  /* ══ 整張表的形狀 ══ */

  function pick(cols, type) {
    var hit = cols.filter(function (c) { return c.type === type; });
    hit.sort(function (a, b) { return b.confidence - a.confidence; });
    return hit[0] || null;
  }

  /* 挑金額欄要先問「這一欄真的有值嗎」。confidence 是在有值的格子裡算的，
     所以一欄 66 列只填 1 格的 money 照樣拿到 1.0，排在前面。
     budget_6667de34 › Channel marketing budget 的「欄 1」就是這樣當上前導的，
     旁邊明明有填了 68% 的「Total」，排名卻照一個只有一個值的欄排。
     有填得夠滿的就只在那些裡面挑；全都稀疏時維持原樣，不要因此沒有前導。 */
  function pickFilled(cols, type) {
    var hit = cols.filter(function (c) { return c.type === type; });
    var good = hit.filter(function (c) { return c.fillRate >= 0.3; });
    if (good.length) hit = good;
    hit.sort(function (a, b) { return b.confidence - a.confidence; });
    return hit[0] || null;
  }

  /* 代碼欄：長度整齊、都含數字、沒有空白、幾乎全相異，例如 AT-114-001。

     「沒有空白」是後來補的。inventory_b9cbb715 › Inventory list 的
     「DESCRIPTION」是 100% 填滿、11 列全相異的品名欄，分數 0.96，
     照理穩拿標題；結果標題給了只有 6 種值的「LOCATION」（0.43）。
     唯一能翻盤的就是 codeLike 的 −0.6——那一欄的前三個品名剛好長度相近
     又帶數字，就被當成料號了。
     代碼不會有空白，品名幾乎都有；這一條比「含數字」準得多。
     （能查出來是因為 baseline 這一版才開始記每欄的填充率與相異值數。） */
  function codeLike(c) {
    // 只有文字欄才可能是代碼。金額欄同樣「長度整齊、含數字、幾乎全相異」，
    // 這條規則原本只用來扣標題分數（金額本來就不會當標題，誤判無害），
    // 一旦拿來隱藏欄位就會把 857,143 跟 AT-114-001 一起藏掉。
    if (c.type !== 'text') return false;
    var s2 = c.samples;
    if (s2.length < 2) return false;
    var lens = s2.map(function (v) { return v.length; });
    var min = Math.min.apply(null, lens), max = Math.max.apply(null, lens);
    return min >= 5 && max - min <= 2 &&
           s2.every(function (v) { return /\d/.test(v) && !/\s/.test(v); }) &&
           c.distinct / Math.max(c.filled, 1) > 0.9;
  }

  // 流水號欄：1,2,3… 這種連號整數，對閱讀沒有任何幫助
  function serialLike(c) {
    if (c.type !== 'number' || c.filled < 4) return false;
    if (c.distinct !== c.filled) return false;              // 有重複就不是流水號
    var nums = c.samples.map(function (v) { return parseFloat(String(v).replace(/,/g, '')); });
    if (nums.some(isNaN)) return false;
    return nums.every(function (v) { return v === Math.round(v) && v >= 0 && v <= c.filled + 2; });
  }

  /* 欄名本身就是最強的訊號，而原本的評分完全不看欄名，
     只看「相異度 − 欄位位置」。庫存表的「Inventory ID」因此越過
     「Name」當上卡片標題，手機上看到的是 INV-1001 而不是品名。
     加分給「這一列叫什麼」的欄名，扣分給單號、編號、代碼。
     兩者都中（「Item ID」）就抵消，回到原本的評分。

     title 後面不接字才算（\btitles?\b(?!\s+\w)）：英文的 title 一詞兩義。
     「COURSE TITLE」「Working title」「TITLE」是名稱，但「Title held by」
     是產權登記在誰名下——Probate Liabilities 那張表因此把標題從全滿的
     「Financial institution」換成只填一半的「Title held by」，八張卡有
     四張沒有名字。中文的「標題」「主旨」沒有這個歧義，不加限制。 */
  var TITLE_NAME = /品名|品項|名稱|姓名|項目|標題|主旨|\bnames?\b|\bitems?\b|\btitles?\b(?!\s+\w)|\bsubject\b/i;
  var ID_NAME    = /編號|代碼|序號|單號|代號|\bid\b|\bno\.?\b|\bcode\b|\bsku\b|#/i;

  /* 日期、時間欄不該當卡片標題：卡片叫「03/15/2026」跟叫「INV-1001」是同一種
     錯——那是軸，不是名字。扣分跟 codeLike 一樣 0.6，因為是同一類問題。

     v71 之前這件事是 codeLike 誤打誤撞擋住的：解析不出來、留在 text 的日期欄
     （「03/01/2026」長度整齊、帶數字、沒空白）剛好符合代碼的特徵。
     v71 把樣本從 3 筆拉到 8 筆之後，長短不一的日期（3/1 跟 12/15）就不再算
     代碼，accounting_7b54c8ed › STATEMENT 的標題因此從「DESCRIPTION」掉成
     「DATE」。靠一條本來在管別件事的規則順便擋住，遲早會這樣散掉，
     所以改成直接寫出來。

     是扣分不是禁止：整張表只剩日期欄可用時，有日期總比卡片沒名字好——
     timesheet_8fd087b1 的每一列就是一天，扣完 0.6 它還是贏得了那些
     只有三四種值的分類欄。 */
  var DATE_NAME  = /日期|時間|時刻|年月|到期|起訖|date|time|\bday\b|\bhour|deadline|due\b/i;

  // 主標題欄：相異度高、不太長、不是日期或數字的那一欄，越靠左越優先
  // 回傳排好序的整串候選，而不是只回第一名——assignRoles 要拿後面的退
  function pickTitleRanked(cols) {
    var cand = cols.filter(function (c) {
      // 幾乎空白、或整欄同一個值的欄位當不了標題（試算表尾端常有這種殘欄）
      /* date／time 也要收進候選，但排在很後面（下面扣 0.6）。
         它們本來完全不在名單裡，因為日期是軸不是名字——可是帳表這種
         group 是 null、其他欄全是金額的表，日期就是那一列唯一的身分，
         不收的話整疊卡片一個名字都沒有。 */
      return ['text', 'longtext', 'person', 'category', 'date', 'time'].indexOf(c.type) >= 0
             && c.fillRate >= 0.5 && c.distinct > 1;
    });
    cand.forEach(function (c) {
      c._score = c.distinct / Math.max(c.filled, 1)          // 越獨特越像標題
               /* 欄名說它是名稱就加分，但要按「實際上有沒有在區分列」打折。
                  timeline_93059754 › Calendar 的「Working title」34 列只有 2 種值，
                  靠欄名的 0.5 贏過 24 種值的「Deadline」，結果 32 張卡片同名、
                  11 張沒名字。欄名寫著名稱卻沒在命名，那個加分就該打折。 */
               + (TITLE_NAME.test(c.name) ? 0.5 * (c.distinct / Math.max(c.filled, 1)) : 0)
               - (ID_NAME.test(c.name) ? 0.5 : 0)            // 欄名就說了它是編號
               // 日期是軸不是名字：型別判對的（date／time）跟判錯但欄名寫著的
               // 一起扣，而且只扣一次——兩邊疊起來會讓它連爛分類欄都輸
               - ((c.type === 'date' || c.type === 'time' || DATE_NAME.test(c.name)) ? 0.6 : 0)
               - (c.type === 'longtext' ? 0.35 : 0)          // 長文字比較像內容
               - (codeLike(c) ? 0.6 : 0)                     // 單號、編號不是給人讀的名稱
               - (1 - c.fillRate) * 0.2                      // 越滿越優先（說明見上）
               - cols.indexOf(c) * 0.04;                     // 越左邊越優先
    });
    return cand.sort(function (a, b) { return b._score - a._score; });
  }

  function pickTitle(cols) {
    return pickTitleRanked(cols)[0] || null;
  }

  /* 整張表都是數字的時候（年金試算、退休試算、計價表），沒有任何名稱欄，
     但第一欄的序號就是那一列的身分：Month 1、Age 30。
     163 份範本裡 11 張是這種，其中 Annuity 一張就有 240 列全部渲染成
     沒有名字的卡片——那是「渲染了但根本不能用」。

     只在 pickTitle 找不到文字候選時才退到這裡，所以不會搶走正常表的標題。
     限 number：money 不是序號（FINANCE CHARGE 的第一欄被判成 money，
     拿它當標題會變成「$1,200」當列名）。
     要求幾乎每列都不同，否則重複的數值欄（工時 8、8、8）會被誤認成序號。 */
  function pickIndexTitle(cols) {
    var first = cols.filter(function (c) { return c.type !== 'empty'; })[0];
    if (!first || first.type !== 'number') return null;
    if (first.fillRate < 0.9) return null;
    if (first.distinct / Math.max(first.filled, 1) < 0.9) return null;
    if (codeLike(first)) return null;                 // 單號不是序號
    return first;
  }

  function detectShape(cols, allCols) {
    allCols = allCols || cols;
    var date  = pick(cols, 'date');
    var time  = pick(cols, 'time');
    var money = pickFilled(cols, 'money');
    var phone = pick(cols, 'phone');
    var mail  = pick(cols, 'email');
    var status = pick(cols, 'status');
    var person = pick(cols, 'person');
    var cat   = pick(cols, 'category');
    var title = pickTitle(cols) || pickIndexTitle(cols);

    // 有日期不等於是排程。帳表的日期幾乎每列都不同，按日期分組會變成
    // 幾十組各一兩筆；那裡的主角是金額，不是時間軸。
    var moneys = cols.filter(function (c) { return c.type === 'money'; });
    // 只有一欄金額也可能是明細帳：零用金支出表就是日期／內容／金額／說明／專案。
    // 兩欄以上放寬到 0.45，只有一欄時要求日期幾乎全相異（0.8）才算，
    // 避免把「有預算欄的活動排程」誤判成帳表。
    var uniqDate = date ? date.distinct / Math.max(date.filled, 1) : 0;
    if (date && ((moneys.length >= 2 && uniqDate > 0.45) ||
                 (moneys.length === 1 && uniqDate > 0.8))) {
      var main = moneys.filter(function (c) { return /含稅|總|合計|應收|小計/.test(c.name); })[0] || moneys[moneys.length - 1];
      var t2 = pickTitle(cols);
      return {
        shape: 'ledger', label: '帳務／明細表',
        reason: '有日期欄「' + date.name + '」但幾乎每列都不同（' +
                date.distinct + '/' + date.filled + '），且有 ' + moneys.length +
                ' 欄金額，判定為明細帳而非排程',
        group: null, lead: main, title: t2, person: null
      };
    }
    if (date) {
      /* 日期幾乎每列都不同時，不拿它當分組軸。上面那條「帳表不是排程」的
         規則要求有金額欄，所以 DATE＋COMPONENTS COMPLETED 這種「日期＋計數」
         的表漏掉了：24 列 24 個不同的日期，分成 24 段、每段一筆，
         而日期被 group 吃掉之後連標題都沒了，整疊卡片沒有名字。
         分組軸留空，日期就會回到 pickTitle 的候選裡當列名——
         「3/18 · 完成 19 件」比「3/18」底下掛一張沒名字的卡片好讀。
         真正的排程（同一天好幾件事）uniqDate 低，不受影響。 */
      var spread = uniqDate > 0.8;
      return {
        shape: 'schedule', label: '排程／時程表',
        reason: '偵測到日期欄「' + date.name + '」（' + date.reason + '）' +
                (time ? '，並有時間欄「' + time.name + '」' : '') +
                (spread ? '；但日期幾乎每列都不同（' + date.distinct + '/' + date.filled +
                          '），不拿它分組，改當列名' : ''),
        group: spread ? null : date, lead: time, title: title, person: person
      };
    }
    if ((phone || mail) && title) return {
      shape: 'directory', label: '名冊／通訊錄',
      reason: '偵測到' + (phone ? '電話欄「' + phone.name + '」' : '') +
              (phone && mail ? '與' : '') + (mail ? '信箱欄「' + mail.name + '」' : '') +
              '，以「' + title.name + '」為主要名稱',
      group: cat, lead: null, title: title, person: person
    };
    // 只有時間、沒有日期 → 單日流程表。節目表、議程、活動流程都是這樣：
    // 日期寫在工作表名稱或標題裡，表格內只有時間。
    // 原本的排程判斷要求有日期欄，這類表就整個掉進「一般表格」，時間軸消失。
    if (time && !date) {
      return {
        shape: 'schedule', label: '排程／時程表',
        reason: '偵測到時間欄「' + time.name + '」但沒有日期欄，視為單日流程表',
        group: null, lead: time, title: pickTitle(cols), person: person
      };
    }

    // 矩陣：第一欄是標籤序列，後面兩欄以上是數值。
    // 這裡要用「宣告的欄位」而不是「有資料的欄位」——整欄空白代表這次沒發生，
    // 不代表這個欄位不存在。用有資料的欄位判斷，會讓同結構的表因資料稀疏而判成不同形狀。
    var first = allCols[0], others = allCols.slice(1);
    var nums = others.filter(function (c) { return c.type === 'number' || c.type === 'money'; });
    var numOrEmpty = others.filter(function (c) {
      return c.type === 'number' || c.type === 'money' || c.type === 'empty';
    });
    // 條件放寬的理由（用 57 個真實請假表跑出來的）：
    // 多一欄「備註」就從 4/4 掉到 3/4，同一個人不同年度因此判成不同形狀；
    // 整年沒請假時所有數值欄全空，nums 為 0 也會掉出去。
    // 結構是不是矩陣，不該被一欄註記或某一年剛好沒資料改變。
    var matrixish = numOrEmpty.length >= 2 &&
                    numOrEmpty.length / others.length >= 0.6 &&
                    (nums.length >= 1 || numOrEmpty.length === others.length);
    /* 矩陣的前提是「一欄標籤 + 一排數值」，沒有別的軸可以分組。後面要是還有
       一欄分類、而且真的分得出組，那它就不是矩陣，是一張可以照那一欄篩選的
       清單——判成矩陣會連帶失去前導（矩陣的 lead 固定是 null），
       排名也只剩「欄名含合計字樣」那一條能救。
       budget_2d4c31d3 › Monthly expenses 就是這樣掉的：
       Description｜Category（12 種）｜預算｜實際｜差異。差異欄原本整欄 $-
       被判成分類，numOrEmpty 只有 2/4 進不了矩陣；$- 當空白之後它變回金額，
       矩陣就成立了，59 列的支出清單因此失去「照 Actual cost 由大到小」。
       上面 0.6 那條門檻本來是為了放過「多一欄備註」——備註是文字、分不了組，
       所以這裡只擋分類欄，不擋文字欄。
       「分得出組」用的是跟 groupOptions 同一組數字（2～12 種、每組平均
       至少兩列、過半有值），免得兩邊各說各話。 */
    var groupable = others.filter(function (c) {
      return (c.type === 'category' || c.type === 'status') &&
             c.distinct >= 2 && c.distinct <= 12 &&
             c.filled / c.distinct >= 2 && c.fillRate >= 0.5;
    });
    if (first && others.length >= 2 && matrixish && !groupable.length &&
        ['text', 'category', 'person'].indexOf(first.type) >= 0) {
      /* 標題固定用第一欄是對的——矩陣的第一欄就是標籤序列。但第一欄不見得
         堪用，而且「半空」跟「整欄空白」是兩件事：整欄空白已經被
         type==='empty' 擋在 cols 之外，這裡擋的是半空。
         inventory_c16e6fb0 › Inventory list 的第一欄是沒有欄名、只填 48% 的
         排版欄，25 張卡有 13 張沒名字，而同一張表明明有「Name」。
         chart_6860aa13 › Profit & loss chart 更誇張：第一欄「Monthly budget」
         只填 1/11，是段落標題誤入資料區，11 張卡有 10 張沒名字。

         條件寫成「另一欄要明顯更滿」（多 20 個百分點），不寫成第一欄
         低於某個門檻：後者會在門檻邊緣亂跳——那張表剛好是 48%，差 2%
         就變成不處理，而 50% 的卡片沒名字並不會因此比較能接受。
         有這個條件，正常矩陣（第一欄全滿）永遠不會被換掉，
         而且只在真的有更完整的欄可用時才換。
         欄名是不是「欄 N」不重要——標籤是那一欄的值，不是欄名；
         同一個檔的 Balance chart 就是靠「欄 2」當列名而且一列都沒漏。 */
      var alt = pickTitle(cols);
      var label = (alt && alt !== first && alt.fillRate > first.fillRate + 0.2) ? alt : first;
      return {
        shape: 'matrix', label: '矩陣／報表', matrix: true,
        reason: '第一欄「' + first.name + '」是標籤，後面 ' + others.length + ' 欄是數值（' +
                others.map(function (c) { return c.name + (c.type === 'empty' ? '：整欄空白' : ''); }).join('、') + '）' +
                (label === first ? ''
                  : '；但第一欄只填了 ' + Math.round(first.fillRate * 100) + '%，改用比較完整的「' +
                    label.name + '」（' + Math.round(label.fillRate * 100) + '%）當列名'),
        group: null, lead: null, title: label, person: null, values: nums, allValues: others
      };
    }
    if (money && title) return {
      shape: 'pricelist', label: '品項／價目表',
      reason: '偵測到金額欄「' + money.name + '」，以「' + title.name + '」為品項名稱',
      group: cat, lead: money, title: title, person: null
    };
    if (status && title) return {
      shape: 'board', label: '狀態清單',
      reason: '偵測到狀態欄「' + status.name + '」（' + status.distinct + ' 種狀態）',
      group: status, lead: null, title: title, person: person
    };
    // 落到這裡不代表沒有軸：底下仍然把 cat 當分組欄。
    // 說明要講實際做了什麼，不能一律說「沒有可辨識的主軸」——
    // 163 份範本裡有 40 張是這種情況，畫面上卻跟使用者說沒有軸。
    return {
      shape: 'cards', label: '一般表格',
      reason: cat ? '沒有時間或人員這類主軸，改以「' + cat.name + '」分組後逐列呈現'
            : title ? '沒有可辨識的主軸，以「' + title.name + '」為標題逐列呈現'
                    : '沒有可辨識的結構，逐列呈現所有欄位',
      group: cat, lead: null, title: title, person: person
    };
  }

  var SHAPE_LABEL = {
    schedule: '排程／時程表', pricelist: '品項／價目表', directory: '名冊／通訊錄',
    board: '狀態清單', matrix: '矩陣／報表', ledger: '帳務／明細表', cards: '一般表格'
  };

  /* 手動指定版面時，角色要跟著重算。
     只改形狀的名字沒有用——渲染是看角色（哪欄分組、哪欄前導、哪欄標題）決定的，
     名字換了角色沒動，六種版面會渲染出一模一樣的畫面。 */
  function shapeAs(cols, allCols, name) {
    var date = pick(cols, 'date'), time = pick(cols, 'time');
    var money = pick(cols, 'money'), status = pick(cols, 'status');
    var cat = pick(cols, 'category'), person = pick(cols, 'person');
    var title = pickTitle(cols);
    var base = { shape: name, label: SHAPE_LABEL[name] || name, reason: '手動指定版面',
                 group: null, lead: null, title: title, person: person };

    if (name === 'schedule') { base.group = date; base.lead = time; }
    else if (name === 'pricelist') { base.group = cat; base.lead = money; }
    else if (name === 'directory') { base.group = cat; }
    else if (name === 'board') { base.group = status || cat; }
    else if (name === 'ledger') {
      var moneys = cols.filter(function (c) { return c.type === 'money'; });
      base.lead = moneys.filter(function (c) { return /含稅|總|合計|應收|小計/.test(c.name); })[0] ||
                  moneys[moneys.length - 1] || null;
    } else if (name === 'matrix') {
      base.matrix = true;
      // 跟自動判定同一條規則：有明顯更滿的欄才換掉第一欄（見上面矩陣那段）
      var m0 = (allCols || cols)[0];
      base.title = (m0 && title && title !== m0 && title.fillRate > m0.fillRate + 0.2)
                 ? title : (m0 || title || null);
    } else {
      base.group = cat;                             // cards
    }
    return base;
  }

  /* ══ 角色指派：形狀決定每欄怎麼呈現 ══ */

  function assignRoles(cols, shape) {
    var used = {};
    var take = function (c, role) {
      if (!c || used[c.name]) return null;
      used[c.name] = role; return c;
    };
    /* 標題排在 group、lead 之後拿，所以 pickTitle 挑中的那一欄很可能
       已經被當成分組軸或主要數值用掉了。原本撞到就讓 roles.title 變成
       null——整張卡片沒有名字，而表上明明還有別的名稱欄可用。
       改成往下一個候選退。分組軸不讓：分組是一整張看法，
       拿它來換一個名字不劃算。 */
    var takeTitle = function () {
      var t = take(shape.title, 'title');
      if (t) return t;
      /* 不另外排除單號欄。pickTitle 的評分已經扣了 0.6，所以單號只有在
         比它好的欄全被用掉時才會輪到——那正是「有個代號總比卡片沒名字好」
         的情況，而且主路徑本來就允許單號當標題（扣分不是禁止）。
         這裡若多一道排除，自動判定與退讓的規則就不一致了。 */
      var ranked = pickTitleRanked(cols);
      for (var i = 0; i < ranked.length; i++) {
        t = take(ranked[i], 'title');
        if (t) return t;
      }
      return null;
    };
    /* pinTitle：使用者在面板上手動指定了主標題欄，那一欄就不該被分組軸
       或主要數值搶走——指定了卻沒生效比沒有指定更難理解。
       自動判定時維持原順序（分組優先），只有手動指定才插到最前面。 */
    var roles = shape.pinTitle
      ? { title: take(shape.title, 'title') || takeTitle(),
          group: take(shape.group, 'group'),
          lead:  take(shape.lead,  'lead'),
          meta:  [], body: [], rest: [] }
      : { group: take(shape.group, 'group'),
          lead:  take(shape.lead,  'lead'),
          title: takeTitle(),
          meta:  [], body: [], rest: [] };
    // 人員、狀態、分類當次要資訊；長文字當內文；其餘列成欄位對
    cols.forEach(function (c) {
      if (used[c.name] || c.type === 'empty') return;
      if (['person', 'status', 'category', 'phone', 'email', 'url'].indexOf(c.type) >= 0) { used[c.name] = 'meta'; roles.meta.push(c); }
    });
    cols.forEach(function (c) {
      if (used[c.name] || c.type === 'empty') return;
      if (c.type === 'longtext') { used[c.name] = 'body'; roles.body.push(c); }
    });
    roles.hidden = [];
    cols.forEach(function (c) {
      if (used[c.name] || c.type === 'empty') return;
      if (serialLike(c) || codeLike(c)) { used[c.name] = 'hidden'; roles.hidden.push(c); return; }
      used[c.name] = 'rest'; roles.rest.push(c);
    });
    roles.assigned = used;
    return roles;
  }

  /* ══ 對外 ══ */

  function analyse(rows) {
    if (!rows || rows.length < 2) return null;
    var header = rows[0].map(function (h, i) {
      var s = String(h == null ? '' : h).trim();
      return s || ('欄 ' + (i + 1));
    });
    var body = rows.slice(1).filter(function (r) {
      return r.some(function (v) { return String(v == null ? '' : v).trim() !== ''; });
    });

    var cols = header.map(function (name, i) {
      return detectColumn(name, body.map(function (r) { return r[i]; }));
    });
    var live = cols.filter(function (c) { return c.type !== 'empty'; });
    var shape = detectShape(live, cols);
    return {
      header: header, rows: body, cols: cols,
      shape: shape, roles: assignRoles(live, shape)
    };
  }

  /* 有哪些欄位當分組軸說得通。
     日期和分類的標準不同：日期天生有序、可以用日期軌導覽，組數多不是問題；
     分類沒有順序，組數一多就等於沒分組。 */
  // 十幾列以下的表，一眼就看完了，切段、篩選只是多一個步驟；只有日期軸例外（跳到今天還是有用）
  var SMALL = 12;

  function groupOptions(a) {
    var out = [];
    a.cols.forEach(function (c) {
      if (['date', 'category', 'status', 'person'].indexOf(c.type) < 0) return;
      if (c.type !== 'date' && a.rows.length < SMALL) return;
      var i = a.header.indexOf(c.name);
      var vals = a.rows.map(function (r) { return String(r[i] == null ? '' : r[i]).trim(); })
                       .filter(Boolean);
      if (!vals.length) return;

      var keyed = {};
      vals.forEach(function (v) {
        var k = c.type === 'date' ? String(v).replace(/\D+/g, '-') : v;
        keyed[k] = (keyed[k] || 0) + 1;
      });
      var n = Object.keys(keyed).length;
      var avg = vals.length / n;
      var fill = vals.length / Math.max(a.rows.length, 1);

      if (n < 2) return;
      if (c.type === 'date') {
        if (avg < 1.3) return;                       // 幾乎每列一個日期就不算分組
      } else {
        if (n > 12 || avg < 2 || fill < 0.5) return; // 分類要少而滿
      }
      out.push({ name: c.name, type: c.type, groups: n, avg: Math.round(avg * 10) / 10 });
    });
    return out;
  }

  /* 值得放進篩選器的欄位。
     這跟分組軸是兩件事，門檻差很多：分組每一組都會變成畫面上的段落標題，
     多了就是災難；篩選只是下拉選單，50 個選項完全沒問題。
     普渡的「人員」有 50 個相異值——當分組軸糟透了，當篩選軸完美。 */

  var SPLIT = /[、,，;；\/\n]+/;
  var RE_DOW = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|nesday|rsday|urday)?\.?$|^(週|周|星期|禮拜|礼拜)[一二三四五六日天]$|^[月火水木金土日]曜?日?$|^(월|화|수|목|금|토|일)(요일)?$/i;
  var CJK = /[\u3400-\u9fff]/;

  // 一格多值：「副壇主、執行長」用頓號分；中文名字常用空白隔開（「王大明 李小華」）。
  // 英文的空白是詞與詞之間——"Public Speaking" 拆成 Public 和 Speaking 就變成一堆碎詞，
  // 所以只有整段都是中文時才拿空白當分隔。
  function tokenizeCell(v) {
    var out = [];
    String(v).replace(/[（(]/g, '、').replace(/[)）]/g, '、').split(SPLIT).forEach(function (p) {
      p = p.trim(); if (!p) return;
      if (/\s/.test(p) && !/[A-Za-z0-9]/.test(p)) p.split(/\s+/).forEach(function (x) { out.push(x); });
      else out.push(p);
    });
    return out
      .map(function (x) { return x.trim().replace(/^[-–]+|[-–]+$/g, ''); })
      .filter(function (x) { return x && x.length <= (CJK.test(x) ? 8 : 24) && !/[：:]/.test(x); });
  }

  function tally(list) {
    var m = {}, name = {};
    list.forEach(function (v) {
      var k = v.toLowerCase();                 // Jeff 和 jeff 是同一個人
      m[k] = (m[k] || 0) + 1;
      if (!name[k]) name[k] = v;
    });
    var keys = Object.keys(m);
    var avgLen = keys.length
      ? keys.reduce(function (a, k) { return a + name[k].length; }, 0) / keys.length
      : 0;
    return { counts: m, labels: name, n: keys.length, avgLen: avgLen };
  }

  function filterOptions(a) {
    var out = [];
    a.cols.forEach(function (c) {
      if (['category', 'status', 'person', 'text'].indexOf(c.type) < 0) return;
      var i = a.header.indexOf(c.name);
      var cells = a.rows.map(function (r) { return String(r[i] == null ? '' : r[i]).trim(); })
                        .filter(Boolean);
      if (cells.length < 4 || a.rows.length < SMALL) return;

      // 一格多值的欄位（「副壇主、執行長」）要拆開才篩得準。
      // 但「蔡宜勳建築師」不該被拆，所以只有拆了真的變多才採用。
      var flat = tally(cells);
      var toks = []; cells.forEach(function (v) { toks = toks.concat(tokenizeCell(v)); });
      var tok = tally(toks);
      var multi = toks.length > cells.length * 1.25 && tok.n >= 2;
      var use = multi ? tok : flat;
      var total = multi ? toks.length : cells.length;

      var n = use.n;
      var avg = total / n;
      var fill = cells.length / Math.max(a.rows.length, 1);

      // 上限不能設太低：普渡流程表活動擴大後有 62 位人員，60 的上限直接把
      // 「只看我的」整個關掉——而人越多這個功能越有價值。
      // 軌道可以橫向捲，150 個選項仍可用；「平均每項 ≥1.5 筆」擋住每列都不同的欄。
      if (n < 2 || n > 150) return;
      if (avg < 1.5) return;                     // 幾乎每列都不同 → 篩完只剩一筆
      if (fill < 0.4) return;                    // 大半列沒填 → 篩掉的比留下的多
      if (use.avgLen > 12) return;

      out.push({
        name: c.name, type: c.type, multi: multi,
        options: n, avg: Math.round(avg * 10) / 10, fill: Math.round(fill * 100),
        score: fill * Math.min(avg, 8)           // 填得滿、每個選項有料 → 越適合
      });
    });
    /* 型別優先，score 只在同型別內比。
       score 的 avg 對人員欄是反向訊號：人越多，平均每人筆數越少，分數越低。
       但「只看我的」正好是人越多越有價值——上面那個 150 的選項上限就是
       為此放寬的。選單只給三張卡之後，排序決定誰消失，而粗分類（地點、
       狀態）只要每項筆數夠多就頂到 min(avg,8) 的天花板，穩定壓掉人員欄：
       62 位人員時平均 1.9，對上地點的 8.0，差四倍。
       person 靠欄名關鍵字判定（含中英文），是作者自己標的，誤判成本低。 */
    var RANK = { person: 0, status: 1, category: 2, text: 3 };
    out.sort(function (x, y) {
      return (RANK[x.type] - RANK[y.type]) || (y.score - x.score);
    });
    return out;
  }

  /* 什麼時候值得問使用者：有兩個以上的軸可選，或目前沒分組但其實有軸可用。
     只有一個軸而且已經用了它 —— 沒什麼好問的。 */
  function shouldAsk(a) {
    var opts = groupOptions(a);
    var cur = a.roles.group ? a.roles.group.name : null;
    if (opts.length >= 2) return opts;
    if (opts.length === 1 && cur !== opts[0].name) return opts;
    return [];
  }

  root.SheetShape = {
    isNoise: function (c) { return serialLike(c) || codeLike(c); },
    /* 對外：index.html 原本自己抄了一份 assignRoles（註解寫「沒對外」），
       於是這裡改角色分配，真正的頁面完全不會跟著改——gallery.mjs 的
       views() 已經因為同一種抄寫漂移過一次。這次改成單一來源。 */
    assignRoles: assignRoles,
    pickTitle: pickTitle,
    shapeAs: shapeAs,
    groupOptions: groupOptions,
    filterOptions: filterOptions,
    tokenizeCell: tokenizeCell,
    shouldAsk: shouldAsk,
    analyse: analyse,
    detectColumn: detectColumn,
    parseDateish: parseDateish,
    inferDayFirst: inferDayFirst,
    parseMonth: parseMonth,
    dateish: dateish,
    parseTimeish: parseTimeish,
    RE_DOW: RE_DOW,            // 第二段（切表、週表攤平）也要用
    RE_NULLISH: RE_NULLISH     // 同上：攤平時要跟判型認定「沒有值」的標準一致
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ══════════════════════════════════════════════════════════
   結構前處理：真實試算表不是資料表，是排版成表格樣子的文件。
   在判型之前，要先找出「表格到底在哪裡」。
   ══════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var S = root.SheetShape;
  var RE_DOW = S.RE_DOW;
  var RE_NULLISH = S.RE_NULLISH;

  function blank(v) { return String(v == null ? '' : v).trim() === ''; }

  function normalize(grid) {
    var w = 0;
    grid.forEach(function (r) { if (r && r.length > w) w = r.length; });
    return grid.map(function (r) {
      var out = [];
      for (var i = 0; i < w; i++) out.push(String((r && r[i]) == null ? '' : r[i]));
      return out;
    });
  }

  // 連續為 false 的區間 → [[start,end], ...]
  function runs(flags) {
    var out = [], s = -1;
    for (var i = 0; i <= flags.length; i++) {
      if (i < flags.length && !flags[i]) { if (s < 0) s = i; }
      else if (s >= 0) { out.push([s, i - 1]); s = -1; }
    }
    return out;
  }

  var RE_TOTAL = /^(總計|合計|小計|總和|加總|total|sum|subtotal)/i;

  /* 找標題列：滿、短、不重複、不是數字，而且下面幾列有資料 */
  function dataCols(rows, from) {
    var set = {};
    rows.slice(from, from + 25).forEach(function (r) {
      r.forEach(function (v, c) { if (!blank(v)) set[c] = 1; });
    });
    return set;
  }

  // 單格是不是「數值感」的東西（數字、金額、百分比、日期、時間）
  function numericish(v) {
    var t = String(v == null ? '' : v).trim();
    if (!t) return false;
    return /^[$€£¥＄]?\s*-?[\d,]+(\.\d+)?\s*%?$/.test(t) ||
           S.dateish(t) || !!S.parseTimeish(t);
  }

  /* 標題列的格子，型別應該跟它底下那一欄不一樣。
     這比「標題不該是數字」準得多：甘特圖的月份標題「7」底下是日期欄（型別不同，合理），
     但 $3,500.00 底下是一整欄金額（型別相同，那只是被誤選的資料列）。 */
  function typeContrast(rows, i, w) {
    var score = 0, counted = 0;
    for (var c = 0; c < w; c++) {
      var head = rows[i][c];
      if (blank(head)) continue;
      var below = [], k;
      for (k = i + 1; k < rows.length && below.length < 8; k++)
        if (!blank(rows[k][c])) below.push(rows[k][c]);
      if (below.length < 2) continue;

      var belowNum = below.filter(numericish).length / below.length;
      var headNum = numericish(head);
      counted++;
      if (headNum && belowNum >= 0.7) score -= 1;        // 數值標題配數值欄 → 多半是資料列
      else if (!headNum && belowNum >= 0.7) score += 1;  // 文字標題配數值欄 → 典型的標題
    }
    return counted ? score / counted : 0;
  }

  function scoreHeader(rows, i, w) {
    var cells = rows[i].map(function (v) { return String(v).trim(); });
    var filled = cells.filter(function (v) { return v !== ''; });
    if (filled.length < 2) return -Infinity;
    if (RE_TOTAL.test(filled[0])) return -Infinity;

    var uniq = {}; filled.forEach(function (v) { uniq[v] = 1; });
    var avgLen = filled.reduce(function (a, v) { return a + v.length; }, 0) / filled.length;
    var numish = filled.filter(function (v) {
      return /^[\d.]/.test(v) || S.dateish(v) || !!S.parseTimeish(v);
    }).length / filled.length;

    var below = rows.slice(i + 1, i + 6);
    var belowFill = below.length
      ? below.reduce(function (a, r) {
          return a + r.filter(function (v) { return !blank(v); }).length;
        }, 0) / (below.length * w)
      : 0;

    // 標題列應該蓋住整張表有資料的欄位。
    // 分母必須是「整張表」而不是「這一列底下」：愈晚的候選底下剩的資料愈少，
    // 資料欄集合跟著縮小，涵蓋率就輕易衝到 1.0。
    // 窗口從 12 放寬到 30 之後，甘特圖的標題列因此從第 1 列跑到第 29 列。
    var dc = dataCols(rows, 1), dcKeys = Object.keys(dc);
    var hit = 0;
    cells.forEach(function (v, c) { if (v !== '' && dc[c]) hit++; });
    var coverage = dcKeys.length ? hit / dcKeys.length : 0;


    // 涵蓋率權重要夠高：甘特圖的標題列本來就是月份數字（7、8、9），
    // 「標題不該是數字」的扣分會蓋過一切，讓跨欄大標反而勝出。
    return coverage * 4                                    // 標題該蓋住整張表有資料的欄
         + typeContrast(rows, i, w) * 2.5                   // 型別要跟底下那一欄不一樣
         + (filled.length / w) * 2                         // 填得越滿越像標題
         + Object.keys(uniq).length / filled.length        // 欄名不該重複
         + (avgLen <= 12 ? 1 : avgLen <= 20 ? 0.3 : -0.5)  // 標題通常短
         - numish * 0.5                                     // 數字標題是有的，這條只留微弱訊號
         + belowFill                                       // 下面要有資料
         - i * 0.08;                                       // 越前面越優先
  }

  function buildTable(rows, meta) {
    var w = rows[0].length;
    var best = 0, bestScore = -Infinity;
    // 搜尋窗口 30 列：財務報表常有摘要區塊擋在真正的欄位標題前面。
    // 個人預算表的「Category | Projected cost | Actual cost」在第 14 列，
    // 窗口 12 完全搜不到。實測 12→18.2%、20→13.8%、30→13.5%，30 之後持平。
    var limit = Math.min(rows.length, 30);
    for (var i = 0; i < limit; i++) {
      var sc = scoreHeader(rows, i, w);
      if (sc > bestScore) { bestScore = sc; best = i; }
    }

    var preambleRows = rows.slice(0, best);
    var preamble = rows.slice(0, best)
      .map(function (r) {
        return r.map(function (v) { return String(v).replace(/\s+/g, ' ').trim(); })
                .filter(Boolean).join(' · ');
      })
      .filter(Boolean);

    // 只有一格有值的列不能當成合計：請假表裡「3月」沒請假就是這種樣子，那是正常資料。
    // 改成碰到「總計/合計」之後的所有列才算尾巴。
    // 小計是一種列，不是終止符。
    // 舊寫法碰到第一個「總計」就把後面全部當成表尾——
    // 但財務報表的小計散佈在整份文件裡：個人預算表第 6 列是
    // 「Total monthly income」，那是摘要裡的一筆正常資料，
    // 結果後面 75 列全被丟掉，整張表憑空消失。
    var body = [], totals = [];
    rows.slice(best + 1).forEach(function (r) {
      if (r.every(blank)) return;
      var first = String(r.filter(function (v) { return !blank(v); })[0] || '').trim();
      if (RE_TOTAL.test(first)) { totals.push(r); return; }
      // 夾在資料中間的小計：前兩欄（識別碼）空白，但後面數值欄有值。
      // 這種列不是資料，也不代表表格結束——後面通常還有更多資料。
      var idBlank = blank(r[0]) && (r.length < 2 || blank(r[1]));
      var numFilled = r.slice(2).filter(function (v) {
        return !blank(v) && /^[\d,.\-]+$/.test(String(v).trim());
      }).length;
      if (idBlank && numFilled >= 2) { totals.push(r); return; }
      body.push(r);
    });

    var header = rows[best].slice();
    var notes = [];

    var col = collapsePeriods(header, body);
    if (col) { header = col.header; body = col.rows; notes.push(col.note); }

    var fd = fillDownLabels(header, body);
    if (fd.length) notes.push('向下填補合併儲存格：' + fd.join('、'));

    // 表格的名字取前言的最後一段——那通常是緊貼標題列上方的區塊標題
    // （例如 Entertainment），而不是更上面的公司抬頭或摘要金額。
    // 純數字的段落跳過：個人預算表右半部的前言是「$3,405.00 · $3,064.00 · Entertainment」，
    // 取第一段會讓分頁叫「$3,405.00」。
    var named = preamble.filter(function (t) {
      return !/^[$€£¥＄(]?\s*-?[\d,]+(\.\d+)?\s*[%)]?$/.test(t.trim());
    });
    return {
      name: named.length ? named[named.length - 1] : '',
      title: preamble.join(' · '),
      preambleRows: preambleRows,
      headerRow: best,
      grid: [header].concat(body),
      totals: totals,
      skipped: preamble.length,
      notes: notes,
      range: meta
    };
  }

  /* 甘特圖：日期散在一排時間軸欄位上，每列只落在其中一格。
     那排欄位的「位置」和日期本身重複，收合成單一日期欄才讀得出來。 */
  function collapsePeriods(header, rows) {
    if (!rows.length) return null;
    var n = header.length, dateish = [], c;
    for (c = 0; c < n; c++) {
      var vals = rows.map(function (r) { return String(r[c] == null ? '' : r[c]).trim(); })
                     .filter(Boolean);
      if (!vals.length) continue;
      var ok = vals.filter(function (v) { return S.dateish(v); }).length / vals.length;
      if (ok >= 0.8) dateish.push(c);
    }
    if (dateish.length < 3) return null;

    var multi = rows.filter(function (r) {
      return dateish.filter(function (c2) { return !blank(r[c2]); }).length > 1;
    }).length;
    if (multi / rows.length > 0.15) return null;      // 一列有多個日期就不是甘特圖

    // 時間軸範圍內、收合後空掉的欄是軸的殘骸（那些「7」「10」的月份標頭），一併清掉。
    // 只限這個範圍——請假表那種整欄空白的「事假」是真欄位，不能砍。
    var lo = Math.min.apply(null, dateish), hi = Math.max.apply(null, dateish);
    var keep = [];
    for (c = 0; c < n; c++) {
      if (dateish.indexOf(c) >= 0) continue;
      var any = rows.some(function (r) { return !blank(r[c]); });
      if (any) { keep.push(c); continue; }
      if (c >= lo && c <= hi) continue;              // 軸內的空殼
      // 軸的月份標頭可能落在日期範圍之外（標頭在 C/G/K…，日期只出現在 D 到 Z）。
      // 空欄而且欄名是純數字 → 也是軸的殘骸；欄名是文字的空欄要留（例如請假表的「病假」）。
      if (/^\d{1,4}$/.test(String(header[c]).trim())) continue;
      if (!blank(header[c])) keep.push(c);
    }
    return {
      header: keep.map(function (c2) { return header[c2]; }).concat(['日期']),
      rows: rows.map(function (r) {
        var v = '';
        dateish.forEach(function (c2) { if (!v && !blank(r[c2])) v = String(r[c2]).trim(); });
        return keep.map(function (c2) { return r[c2]; }).concat([v]);
      }),
      note: '把散在 ' + dateish.length + ' 欄時間軸上的日期收合成單一「日期」欄'
    };
  }

  /* 合併儲存格：分類只填在每組第一列，其餘留白。往下補齊才分得了組。 */
  function fillDownLabels(header, rows) {
    var done = [];
    for (var c = 0; c < Math.min(header.length, 2); c++) {
      // 週表的星期欄不填：空格代表「這個時段沒事」，填了就是憑空排出課來。
      if (RE_DOW.test(String(header[c] == null ? '' : header[c]).trim())) continue;
      var vals = rows.map(function (r) { return String(r[c] == null ? '' : r[c]).trim(); });
      var filled = vals.filter(Boolean);
      if (!filled.length) continue;
      var uniq = {}; filled.forEach(function (v) { uniq[v] = 1; });
      var distinct = Object.keys(uniq).length;
      // 數值欄絕對不能向下填補：空白代表「沒有」，不是「同上」。
      // 請假表把「特休」填下去，等於讓沒請假的月份繼承上個月的時數——那是捏造資料。
      // 要認得 $1,000.00、(341.00)、12% 這些寫法。
      // 只比對純數字會讓金額欄逃過這道防護——那正是這條規則要擋的東西。
      var numeric = filled.filter(function (v) {
        return /^\(?\s*[$€£¥＄]?\s*-?[\d,]+(\.\d+)?\s*[%)]?\s*\)?$/.test(v);
      }).length;
      if (numeric / filled.length > 0.3) continue;

      // 稀疏、少量相異值、且不是每列都有 → 典型的合併儲存格
      if (filled.length / rows.length > 0.6 || distinct > 20 || distinct < 2) continue;
      var last = '';
      rows.forEach(function (r, i) {
        if (vals[i]) last = vals[i];
        else if (last) r[c] = last;
      });
      done.push(header[c] || ('欄 ' + (c + 1)));
    }
    return done;
  }

  /* 把一張工作表切成獨立的表格區塊 */
  function findTables(grid) {
    var g = normalize(grid);
    if (!g.length || !g[0].length) return [];
    var h = g.length, w = g[0].length;

    var colBlank = [], c, r;
    for (c = 0; c < w; c++) {
      var any = false;
      for (r = 0; r < h; r++) if (!blank(g[r][c])) { any = true; break; }
      colBlank.push(!any);
    }
    var rowBlank = g.map(function (row) { return row.every(blank); });

    var colRuns = runs(colBlank), rowRuns = runs(rowBlank), tables = [];

    // 空白欄不一定是表格分界：甘特圖的時間軸本來就很稀疏，
    // 硬切會把一張表絞成好幾塊、欄名全變成「欄 1」。
    // 只有當每一塊都找得到一列「大部分格子有字」的標題列時，才承認這是並排的獨立表格。
    if (colRuns.length > 1) {
      var ok = colRuns.every(function (cr) {
        var width = cr[1] - cr[0] + 1;
        if (width < 2) return false;
        // 窗口要跟標題列搜尋一致（30 列）。停在 12 會拒絕合法的切割：
        // 個人預算表左右並排兩個區塊，右邊的標題在第 14 列，
        // 於是兩區塊被併成一張表，渲染出「Video/DVD $1,000」這種
        // 把房貸金額配到影音項目上的錯誤——比空白頁更糟。
        for (var i = 0; i < Math.min(h, 30); i++) {
          var filled = 0;
          for (var c = cr[0]; c <= cr[1]; c++) if (!blank(g[i][c])) filled++;
          if (filled / width >= 0.6 && filled >= 2) return true;
        }
        return false;
      });
      if (!ok) colRuns = [[0, w - 1]];
    }

    colRuns.forEach(function (cr) {
      var chunks = [];
      rowRuns.forEach(function (rr) {
        var sub = [];
        for (var i = rr[0]; i <= rr[1]; i++) sub.push(g[i].slice(cr[0], cr[1] + 1));
        if (sub.some(function (row) { return row.some(function (v) { return !blank(v); }); }))
          chunks.push({ rows: sub, r0: rr[0] });
      });
      if (!chunks.length) return;

      // 空白列在報表裡多半只是間隔，不是表格邊界——把同一組欄位裡的區塊全部接回來。
      // 舊寫法只從「第一個 ≥3 列的區塊」開始收，前面的整段被丟掉；
      // 現金流量表的空白列把它切成 [0-1][3][6-7][9][11...]，
      // 真正的標題列（Feb 2023 | Mar 2023 …）在第三塊，於是連同前面一起消失。
      var main = { rows: [], r0: chunks[0].r0 };
      chunks.forEach(function (ch, k) {
        if (k) main.rows.push(new Array(ch.rows[0].length).fill(''));
        main.rows = main.rows.concat(ch.rows);
      });

      var t = buildTable(main.rows, { c0: cr[0], c1: cr[1], r0: main.r0 });

      /* 整欄空白、而且連欄名都沒有的欄，是排版用的留白，不是欄位。
         微軟範本大量這樣排版：Event planner 的 TIME / TOPIC / PRESENTER 落在
         第 3、9、29 欄，中間 27 欄全空。上面那段「每塊都找不到標題列就退回
         整個寬度」是對的（甘特圖不該被絞碎），但退回之後這些空欄留在表裡，
         變成「欄 1、欄 2…」，接著「超過 40% 欄位沒有欄名」就誤報成標題列判錯。
         163 份範本裡 37 張掛著那個旗標，每一張同時掛著「整欄空白，欄位邊界
         可能抓錯」——是同一件事。

         有欄名的空欄不能砍：請假表整年沒請假時「事假」本來就整欄空白，
         那是真欄位，砍了會讓同結構的表因為某年沒資料而判成不同形狀。 */
      var keepCols = [];
      for (var j = 0; j < t.grid[0].length; j++) {
        if (!blank(t.grid[0][j])) { keepCols.push(j); continue; }
        for (var i = 1; i < t.grid.length; i++)
          if (!blank(t.grid[i][j])) { keepCols.push(j); break; }
      }
      if (keepCols.length && keepCols.length < t.grid[0].length) {
        var dropped = t.grid[0].length - keepCols.length;
        var pickCols = function (row) {
          return keepCols.map(function (j) { return row[j]; });
        };
        t.grid = t.grid.map(pickCols);
        t.totals = (t.totals || []).map(pickCols);
        // 前言也要跟著砍，否則下面依欄名週期切表時兩邊的欄位對不起來
        t.preambleRows = (t.preambleRows || []).map(pickCols);
        t.notes = (t.notes || []).concat(['剔除 ' + dropped + ' 個排版用的空白欄']);
      }

      if (!(t.grid.length >= 2 && t.grid[0].length >= 2)) return;

      // 欄名重複 → 這其實是好幾張並排的表，切開才不會把數字配錯項目
      var k = headerPeriod(t.grid[0]);
      if (k) {
        for (var off = 0; off < t.grid[0].length; off += k) {
          var slice = t.grid.map(function (r) { return r.slice(off, off + k); });
          if (!slice.slice(1).some(function (r) { return r.some(function (v) { return !blank(v); }); })) continue;
          // 前言也是橫向並排的，要跟著切，否則兩張表會共用「114年度…115年度…」
          var pre = (t.preambleRows || []).map(function (r) {
            return r.slice(off, off + k).map(function (v) {
              return String(v).replace(/\s+/g, ' ').trim();
            }).filter(Boolean).join(' · ');
          }).filter(Boolean);
          var preNamed = pre.filter(function (x) {
            return !/^[$€£¥＄(]?\s*-?[\d,]+(\.\d+)?\s*[%)]?$/.test(x.trim());
          });
          tables.push({
            name: preNamed.length ? preNamed[preNamed.length - 1] : t.name,
            title: pre.length ? pre.join(' · ') : t.title,
            headerRow: t.headerRow,
            grid: slice, totals: t.totals.map(function (r) { return r.slice(off, off + k); }),
            skipped: t.skipped, notes: (t.notes || []).concat(['依重複的欄名切成並排的表格']),
            range: { c0: cr[0] + off, c1: cr[0] + off + k - 1, r0: main.r0 }
          });
        }
        return;
      }
      tables.push(t);
    });

    return tables;
  }

  /* 欄名重複的週期。並排的表格之間不一定有空白欄可切：
     孫偉勛的請假表是 月份|特休|事假|病假|勞保|月份|特休|事假|病假|勞保，
     E 欄是左邊的勞保、F 欄直接是右邊的月份，中間沒有縫。
     這時欄名本身的重複就是切點。 */
  function headerPeriod(header) {
    var h = header.map(function (x) {
      var t = String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
      return /^欄 \d+$/.test(t) ? '' : t;          // 自動編號視同空白
    });
    var n = h.length;
    if (!h[0]) return 0;                           // 第一欄是列標籤（月份、Category…），沒有就沒得比

    // 上限不能設 n/2：最後一塊不完整時週期會超過一半。
    // 林哲良的表是 9 欄（右半邊少一欄），週期 5 > 9/2，原本永遠試不到。
    for (var k = 2; k <= n - 2; k++) {
      // 錨點：每個週期的開頭都要等於第一欄。這條最能擋掉巧合的重複。
      var anchored = true;
      for (var c = k; c < n; c += k) if (h[c] !== h[0]) { anchored = false; break; }
      if (!anchored) continue;

      // 不要求整除也不要求完全相同：
      // 林哲良的右半邊少一欄（9 欄不能被 5 整除）；
      // 詹蕙菁三個年度並排，但每年請的假別不同（病假 vs 生理假）。
      var hit = 0, cmp = 0;
      for (var i = k; i < n; i++) { cmp++; if (h[i] === h[i % k]) hit++; }
      if (cmp < 2 || hit / cmp < 0.7) continue;   // 至少要有兩欄可比，否則沒有說服力

      var named = 0;
      for (var j = 0; j < k; j++) if (h[j]) named++;
      if (named >= 2) return k;                    // 至少兩個有名字的欄，否則是巧合
    }
    return 0;
  }

  /* 引述，不計算。
     摘要的數字必須是表上原本就寫著的——加總會跟表上的值對不起來
     （帳表實測差 1 元，是他們公式的進位），而且合計有階層，
     小計和總計混著相加會得到 4.7 倍的荒謬數字。
     兩個來源：前言裡的「標籤→數值」配對，以及合計列。 */

  // 會計負數寫成 ($341.00)：左括號和貨幣符號會連在一起，
  // 只允許一個前置字元會漏掉個人預算表的 Difference。
  var RE_IDLIKE = /(單號|編號|代號|序號|號碼|invoice\s*#|\bno\.?$|#$|\bid$)/i;
  var RE_NUMLIKE = /^\(?\s*[$€£¥＄]?\s*-?[\d,]+(\.\d+)?\s*[%)]?\s*\)?$/;

  // 儲存格座標用 Excel 的寫法（G4），使用者對得回原檔；R4C7 沒人看得懂
  function a1(r, c) {
    var col = ''; c = c + 1;
    while (c > 0) { var m = (c - 1) % 26; col = String.fromCharCode(65 + m) + col; c = Math.floor((c - 1) / 26); }
    return col + (r + 1);
  }

  function quotedFacts(grid, t) {
    var g = normalize(grid || []);
    var out = [], seen = {};
    var push = function (label, value, kind, at) {
      var k = label + '\u0000' + value;
      if (!label || !value || seen[k]) return;
      seen[k] = 1;
      out.push({ label: label, value: value, kind: kind, at: at });
    };
    var txt = function (v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); };

    // 1. 前言：文字格右邊隔著幾個空格出現數字 → 這是作者自己寫的摘要
    var top = Math.min(t.headerRow || 0, g.length);
    for (var r = 0; r < top; r++) {
      var row = g[r];
      for (var c = 0; c < row.length; c++) {
        var lab = txt(row[c]);
        // 單號、編號不是數量。引述它們只會佔掉摘要的位置。
        if (!lab || lab.length > 70 || RE_NUMLIKE.test(lab) || RE_IDLIKE.test(lab)) continue;
        for (var d = 1; d <= 4 && c + d < row.length; d++) {
          var val = txt(row[c + d]);
          if (!val) continue;                       // 中間的空格跳過
          if (RE_NUMLIKE.test(val)) push(lab, val, 'preamble', a1(r, c + d));
          break;                                    // 碰到第一個有值的就停，不再往右找
        }
      }
    }

    // 2. 合計列：標籤照抄，不把小計說成總計
    (t.totals || []).forEach(function (row, i) {
      var lab = '';
      for (var c = 0; c < row.length; c++) {
        var v = txt(row[c]);
        if (v && !RE_NUMLIKE.test(v)) { lab = v; break; }
      }
      row.forEach(function (v, c) {
        var val = txt(v);
        if (!val || !RE_NUMLIKE.test(val)) return;
        var colName = txt((t.header && t.header[c]) || (t.grid && t.grid[0] ? t.grid[0][c] : ''));
        var named = colName && !/^欄 \d+$/.test(colName);
        if (!lab && !named) return;
        if (RE_IDLIKE.test(lab) || RE_IDLIKE.test(colName)) return;                 // 沒有列標籤也沒有欄名 → 這個數字說明不了什麼
        var full = lab ? (named ? lab + ' · ' + colName : lab) : colName;
        push(full, val, 'total', '');   // 合計列的原始位置在切表時就沒留下來，不硬湊
      });
    });

    return out;
  }

  /* 把引述壓成能放進手機一屏的摘要。
     帳表抽出 24 條但只有 12 個不重複的數字——同一個值掛在不同標籤下
     （小計與總計、不同年度的區段），全列出來等於沒有摘要。 */
  var RE_TOP  = /總計|合計|總額|餘額|balance|grand\s*total/i;
  var RE_DIFF = /差異|淨|difference|net(?!\w)/i;
  var RE_SUB2 = /小計|subtotal/i;

  function summarise(facts, limit) {
    // 只有「欄位相同」才合併同一個數值。
    // 個人預算表的 Income 1 與 Total monthly income 都是 $4,300，
    // 但那是兩件不同的事剛好相等，併起來會誤導。
    var colOf = function (l) { var i = l.lastIndexOf(' · '); return i < 0 ? '' : l.slice(i + 3); };
    var byKey = {};
    facts.forEach(function (f) {
      // 沒有欄位部分（前言的事實）就以自己的標籤為鍵，彼此不合併——
      // 只有「同一欄的同一個數字」才是真的重複。
      var k = f.value.replace(/\s/g, '') + '\u0000' + (colOf(f.label) || f.label);
      (byKey[k] = byKey[k] || { value: f.value, labels: [], kind: f.kind, at: f.at }).labels.push(f.label);
    });

    var rows = Object.keys(byKey).map(function (k) {
      var e = byKey[k], seen = {}, labels = [];
      e.labels.forEach(function (l) { if (!seen[l]) { seen[l] = 1; labels.push(l); } });
      var joined = labels.join(' / ');
      var zero = /^[^\d-]*0([.,]0+)?[^\d]*$/.test(e.value);   // 0 是最沒資訊量的數字
      var rank = RE_TOP.test(joined) ? 0
               : RE_DIFF.test(joined) ? 1
               : RE_SUB2.test(joined) ? 3
               : e.kind === 'preamble' ? 2 : 4;
      return { value: e.value, labels: labels, label: joined, kind: e.kind, at: e.at,
               rank: rank + (zero ? 3 : 0), n: labels.length };
    });

    rows.sort(function (a, b) { return a.rank - b.rank || b.n - a.n; });
    return limit ? rows.slice(0, limit) : rows;
  }

  S.summarise = summarise;
  /* 這張表的呈現可不可信？
     欄名重複＝兩組並排的欄位被併成一張表，那時每一列都會把不相干的
     數字配在一起——畫面看起來完全正常，但數字是錯的。
     這種失敗最危險，寧可明講也不要靜靜顯示。 */
  function fidelityWarnings(t) {
    var w = [], h = (t.header || []).map(function (x) {
      var v = String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
      return /^欄 \d+$/.test(v) ? '' : v;
    });

    var seen = {}, dup = [];
    h.forEach(function (x) {
      if (!x) return;
      if (seen[x]) { if (dup.indexOf(x) < 0) dup.push(x); } else seen[x] = 1;
    });
    if (dup.length)
      w.push('這張表有重複的欄位名稱（' + dup.slice(0, 3).join('、') +
             '），可能是兩組並排的表格被併在一起，數字的對應會不正確。');

    var first = h.indexOf(h.filter(Boolean)[0]);
    var last = h.length - 1;
    while (last > 0 && !h[last]) last--;
    for (var i = first + 1; i < last; i++) {
      if (h[i]) continue;
      var any = (t.rows || []).some(function (r) {
        return String(r[i] == null ? '' : r[i]).trim();
      });
      if (!any) {
        w.push('欄位中間有一整欄空白，這張表可能其實是兩份表格。');
        break;
      }
    }
    return w;
  }

  S.fidelityWarnings = fidelityWarnings;
  S.quotedFacts = quotedFacts;
  S.headerPeriod = headerPeriod;
  S.findTables = findTables;

  /* 這張工作表值不值得渲染給人看？
     一個活頁簿裡有資料表，也有說明頁、下拉選單來源、圖表暫存區、公式彙總頁。
     原則是保守：藏掉一張真的資料表，比多顯示一張垃圾更糟，
     所以只有在明顯不是表格時才排除。 */
  function sheetVerdict(grid, tables) {
    var g = normalize(grid || []);
    var filled = g.filter(function (r) { return r.some(function (v) { return !blank(v); }); });
    if (!filled.length) return { show: false, why: '整張工作表空白' };

    tables = tables || [];
    if (!tables.length) return { show: false, why: '切不出任何表格區塊' };

    var main = tables.reduce(function (a, b) { return b.rows.length > a.rows.length ? b : a; });
    if (main.calendar) return { show: false, why: '月曆格子（星期橫排、格子裡是日期），手機上沒有比原本更好的呈現' };
    if (main.rows.length < 2) return { show: false, why: '只有 ' + main.rows.length + ' 列資料' };

    var live = main.cols.filter(function (c) { return c.type !== 'empty'; });
    if (!live.length) return { show: false, why: '沒有任何有值的欄位' };

    // 欄名全是數字或空的 → 圖表資料區、控制列殘骸這類東西
    var named = main.header.filter(function (h) {
      var t = String(h == null ? '' : h).trim();
      return t && !/^欄 \d+$/.test(t) &&
             !/^[$€£¥＄]?\s*-?[\d,]+(\.\d+)?\s*%?$/.test(t) && !S.dateish(t);
    }).length;
    if (!named) return { show: false, why: '沒有任何文字欄名，像圖表資料區或控制列' };

    // 有金額、數字、日期或時間就是真資料（例如 品項 | 金額 的支出清單）
    var hasValue = live.some(function (c) {
      return ['money', 'number', 'date', 'time'].indexOf(c.type) >= 0;
    });
    var avgLen = live.reduce(function (a, c) { return a + c.avgLen; }, 0) / live.length;
    var headLen = main.header.filter(function (h) { return !blank(h); })
      .reduce(function (a, h, i, arr) { return a + String(h).trim().length / arr.length; }, 0);

    // 說明頁：欄名本身就是句子。
    // 不能只看資料長不長——待辦清單的「Done | Task」欄名很短、內容很長，
    // 那是不折不扣的資料表，而且正是手機最該讀的東西。
    if (live.length <= 2 && headLen > 20)
      return { show: false, why: '欄名本身就是句子，像說明頁' };
    if (live.length <= 1 && avgLen > 25)
      return { show: false, why: '只有一欄長文字，像說明頁' };

    /* 宣告了好幾欄、卻只有一欄有值，而那一欄又沒有任何數值——這是整張沒填的
       範本，列名以外什麼都沒有，渲染出來是一疊只有標籤的卡片。
       v81 把下面那條改成看宣告的欄數之後，這六張跟著跑出來：
       student_b6316bb6 的 Applications／Comparisons（五列比較項目、三所學校欄全空）、
       timeline_c7bfc3e8 的三張內容日曆（60 列只有 MONTH 有值）、
       timeline_7ec3f486 › Social Overview。
       「藏掉真的資料表比多顯示垃圾更糟」講的是資料；這裡沒有資料。 */
    if (live.length <= 1 && !hasValue && main.cols.length > live.length)
      return { show: 'weak', why: '只有一欄有值、其餘整欄空白，像還沒填的範本' };

    // 下拉選單的來源清單：一兩欄「短文字」，沒有任何數值欄。
    /* 這裡要看「宣告了幾欄」而不是「幾欄有值」，跟矩陣那條同一個道理：
       整欄空白代表這次沒填，不代表這個欄位不存在。
       expense_d75b85c4 › Expenses 是一張還沒填的預算範本——
       Expense｜Category｜Budget｜Actual｜Difference ($)｜Difference (%)，
       金額欄全空。原本「Difference ($)」整欄 $- 還算有值，live 是 3 欄所以躲過；
       $- 當空白之後 live 剩 2 欄，整張表就被當成下拉選單的來源清單藏起來了。
       真正的下拉來源清單本來就只宣告一兩欄。 */
    if (main.cols.length <= 2 && live.length <= 2 && !hasValue &&
        main.rows.length >= 3 && avgLen <= 12)
      return { show: 'weak', why: '只有一兩欄短文字且無數值，像下拉選單的來源清單' };

    return { show: true, why: '' };
  }

  S.sheetVerdict = sheetVerdict;

  /* 包一層：先切表，再對每一塊做原本的判型 */
  /* 週表：時間直著排、星期橫著排（課表、班表、每週菜單）。
     手機上一次只看一天才讀得了，所以把它攤平成「星期 | 時間 | 內容」的長表——
     之後「只看某個星期」就是切天、「照時間看」就是排時間，不用另外做一種畫面。
     月曆（格子裡是 1 到 31 的日期數字）不是這種東西，攤平沒有意義，留給 sheetVerdict 拒絕。 */
  function weekGrid(header) {
    var idx = [];
    header.forEach(function (h, i) { if (RE_DOW.test(String(h == null ? '' : h).trim())) idx.push(i); });
    return idx.length >= 3 ? idx : null;
  }
  function isCalendarGrid(t, idx) {
    var cells = [];
    t.grid.slice(1).forEach(function (r) { idx.forEach(function (i) { var v = String(r[i] == null ? '' : r[i]).trim(); if (v) cells.push(v); }); });
    if (cells.length < 6) return false;
    var days = cells.filter(function (v) { return /^\d{1,2}$/.test(v) && +v >= 1 && +v <= 31; }).length;
    return days / cells.length >= 0.6;
  }
  function unpivotWeek(t, idx) {
    var header = t.grid[0], body = t.grid.slice(1);
    var rest = [];
    header.forEach(function (h, i) { if (idx.indexOf(i) < 0) rest.push(i); });
    // 時間軸：星期欄以外，第一個有值的欄（TIME、Period、時段……）
    var axis = -1;
    rest.forEach(function (i) { if (axis < 0 && body.some(function (r) { return !blank(r[i]); })) axis = i; });
    var zh = idx.some(function (i) { return /[\u3400-\u9fff]/.test(String(header[i])); });
    var dayName = zh ? '星期' : 'Day', itemName = zh ? '內容' : 'Item';
    var axisName = axis >= 0 ? String(header[axis]).trim() || (zh ? '時間' : 'Time') : '';
    var out = [];
    idx.forEach(function (ci) {
      var day = String(header[ci]).trim();
      body.forEach(function (r) {
        var v = String(r[ci] == null ? '' : r[ci]).trim();
        if (!v) return;
        var row = [day];
        if (axis >= 0) row.push(String(r[axis] == null ? '' : r[axis]).trim());
        row.push(v);
        out.push(row);
      });
    });
    if (out.length < 4) return null;
    var h = [dayName]; if (axis >= 0) h.push(axisName); h.push(itemName);
    return {
      name: t.name, title: t.title, preambleRows: t.preambleRows, headerRow: t.headerRow,
      grid: [h].concat(out), totals: [], skipped: t.skipped, range: t.range,
      notes: (t.notes || []).concat(['把 ' + idx.length + ' 個星期欄位攤平成「' + dayName + '」欄，一次看一天']),
      unpivoted: 'week'
    };
  }

  /* 月份橫排：項目直著排、期間橫著排（預算表、現金流、月報）。
     語料裡 18 張是這個樣子，而且全部都沒有時間軸——12 個月就擺在欄名上，
     看法系統卻完全看不到，只能從剩下的欄硬挑，挑出來的是
     「只看某個 Jan」（拿一月的金額當篩選）、「依 Total 分組」這種沒意義的軸。

     攤平成「項目 | 月份 | 金額」之後就是一張普通的三欄表：
     依月份分段、每張卡是一個項目、金額當前導，三個軸都回來了。
     跟週表不同的是這裡不用手動指派角色——攤平後的形狀本來就判得對。

     期間外層、列內層：輸出順序就是一月全部、二月全部……
     分組是照出現順序建的，所以月份段落自然會照時序排。 */
  /* 拆成三塊，攤平完要用它們決定那一欄該叫什麼。
     本來只有一個 RE_PERIOD，欄名則是用「開頭是不是字母」當作「是不是月份」，
     所以 chart_94c0fff6 › Sales data 的 QTR 1…QTR 4 攤完會叫「Month」。 */
  var P_MONTH   = '^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s*(\\d{2,4})?$' +
                  '|^\\d{1,2}\\s*月$|^\\d{4}\\s*[-/.年]\\s*\\d{1,2}\\s*月?$';
  // 季別本來只認得「Q1」。同一種東西寫成「QTR 1」「Quarter 1」「1st Quarter」
  // 的也要認得——Sales data 整張 15×6 的產品季報就是卡在這裡留在寬表。
  var P_QUARTER = '^(第)?[一二三四1-4]\\s*季(度)?$|^q(tr|uarter)?\\s*[1-4](\\s*\\d{2,4})?$' +
                  '|^[1-4](st|nd|rd|th)\\s*(qtr|quarter)$';
  var P_DAYCOL  = '^\\d{1,2}\\s*[-/.]\\s*\\d{1,2}(\\s*[-/.]\\s*\\d{2,4})?$';
  var RE_MONTHCOL = new RegExp(P_MONTH, 'i');
  var RE_QTRCOL   = new RegExp(P_QUARTER, 'i');
  var RE_PERIOD   = new RegExp(P_MONTH + '|' + P_QUARTER + '|' + P_DAYCOL, 'i');
  var RE_SUMCOL = /合計|總計|小計|累計|平均|total|sum|average|avg|ytd|variance|差異/i;

  /* 時段也算期間。schedule_54d4fddf 那七張排班表是
     「Employee ｜ 7:00 AM ｜ 8:00 AM ｜ … ｜ 3:00 PM」——員工直排、時段橫排，
     跟月份橫排是同一種結構，只是橫軸的單位從月變成小時。
     攤平前它們只拿到「照 Total 排名」一張卡，連分組都沒有。
     用 parseTimeish 而不是自己寫正則：純數字（甘特圖的 21｜22｜23）不會被
     當成時間，所以甘特圖不會被誤攤成一千多列的「x」。 */
  function periodGrid(header) {
    var idx = [], times = 0;
    header.forEach(function (h, i) {
      var t = String(h == null ? '' : h).replace(/\s+/g, ' ').trim();
      if (!t || RE_SUMCOL.test(t)) return;        // 合計欄不是期間
      if (RE_PERIOD.test(t)) { idx.push(i); return; }
      if (S.parseTimeish(t)) { idx.push(i); times++; }
    });
    if (idx.length < 3) return null;
    return { idx: idx, allTime: times === idx.length };
  }

  function unpivotPeriods(t, idx, allTime) {
    var header = t.grid[0], body = t.grid.slice(1);
    if (body.length < 2) return null;
    /* 剩下的欄只留「文字的」。
       合計欄要丟掉是明顯的：它是那幾個期間欄的橫向加總，攤平之後每一列都會
       掛著同一個年度總額，看起來像那一列自己的值。
       但光靠欄名擋不乾淨——budget_1cbd5c5c 的那一欄叫「YEAR」、
       budget_6667de34 的叫「Rate」，都不會中合計的字樣，照樣跟著每一列跑。
       改成看內容：在一張期間表裡，不是期間值的數字幾乎都是橫向的彙總
       （年度總額、佔比、費率），留著只會變成每列重複的雜訊。
       文字欄留著，那是列名跟分類。 */
    var rest = [];
    header.forEach(function (h, i) {
      if (idx.indexOf(i) >= 0) return;
      if (RE_SUMCOL.test(String(h == null ? '' : h).trim())) return;
      var vals = body.map(function (r) { return String(r[i] == null ? '' : r[i]).trim(); }).filter(Boolean);
      if (vals.length && vals.filter(function (v) { return RE_NUMLIKE.test(v); }).length / vals.length > 0.6) return;
      rest.push(i);
    });

    /* 要有一欄能當列名，不然攤出來是一疊沒有名字的卡片。
       條件跟 pickTitle 的候選一樣：過半有值、至少兩種不同的值。 */
    var hasLabel = rest.some(function (i) {
      var vals = body.map(function (r) { return String(r[i] == null ? '' : r[i]).trim(); }).filter(Boolean);
      if (vals.length / body.length < 0.5) return false;
      var u = {}; vals.forEach(function (v) { u[v] = 1; });
      return Object.keys(u).length >= 2 &&
             vals.filter(function (v) { return !RE_NUMLIKE.test(v); }).length / vals.length > 0.5;
    });
    if (!hasLabel) return null;

    var out = [], money = 0, filled = 0, vals = [], seen = {};
    idx.forEach(function (ci) {
      var label = String(header[ci]).replace(/\s+/g, ' ').trim();
      body.forEach(function (r) {
        var v = String(r[ci] == null ? '' : r[ci]).trim();
        /* 空白跟「$-」都是「這個期間沒有值」，攤平時都不要變成一張卡。
           不跳的話 expense_68cc5838 › Expense variances 會攤出 192 張卡、
           其中三分之二寫著「某項目·某月·$-」；跳了就是 54 筆真的有差異的
           項目，月份軸也只留下真的發生過的月份——「Actual expenses」的七月到
           十二月還沒到，不必在分組軸上排六個空月份。 */
        if (!v || RE_NULLISH.test(v)) return;
        filled++; seen[label] = 1; vals.push(v);
        if (/[$€£¥＄]/.test(v)) money++;
        out.push(rest.map(function (i) { return r[i]; }).concat([label, v]));
      });
    });
    if (out.length < 4 || out.length > 3000) return null;

    /* 格子裡要嘛是數值，要嘛是「時間直排」的排程格。

       數值的情況是預算表、現金流：項目 × 期間 = 一個金額。
       格子裡放文字時絕大多數攤了更糟——budget_6667de34 › Channel marketing
       budget 攤出 693 列、值欄判成 text，形狀沒有前導可用、整張掉到
       「一般表格」；budget_b6c07597 › PERSONAL BUDGET 一樣。

       但有一種例外：timeline_cc8dfa38 › SCHEDULE 是「時間直排、日期橫排」的
       節目表，格子裡是活動名稱。那跟週表是同一種東西（只是橫軸是日期而不是
       星期），攤平完全正確——16 列 × 5 個日期欄攤成 36 筆活動、依日期分段，
       而原本一列會並排五個活動，手機上根本讀不了。
       分辨的方法：剩下的欄裡有一欄是時間，那就是排程格而不是亂攤。 */
    var timeAxis = rest.some(function (i) {
      var vals = body.map(function (r) { return String(r[i] == null ? '' : r[i]).trim(); }).filter(Boolean);
      return vals.length >= 2 &&
             vals.filter(function (v) { return !!S.parseTimeish(v); }).length / vals.length > 0.6;
    });
    /* 時段橫排的排班表也是排程格：格子裡是班別／工作內容，不是數值，
       而時間軸在欄名上而不是在剩下的欄裡。兩種排程格都要放過。

       「是不是數值」直接問 detectColumn，不要自己再寫一套門檻。
       第一版用 RE_NUMLIKE 算比例、門檻 0.7，而 detectColumn 用另一個正則、
       門檻 0.8——budget_6667de34 › Channel marketing budget 剛好卡在中間：
       我這邊算過了、它那邊判成 text，於是攤出 693 列、值欄沒有型別可用。
       真正要問的就是「攤出來的值欄會不會變成 money 或 number」，
       那就直接問那個函式。 */
    var vType = S.detectColumn('v', vals).type;
    if (!/^(money|number)$/.test(vType) && !timeAxis && !allTime) return null;

    /* 只有一個期間真的有值時，攤平等於什麼都沒做，還多一個只有一種值的分組欄。
       budget_60c5b272 › Budget by month 的 12 個月欄只有一欄填了，
       攤完 17 列還是 17 列，卻多了一個「Month 只有一種值」的警示。 */
    if (Object.keys(seen).length < 2) return null;

    var zh = /[㐀-鿿]/.test(header.join(''));
    var every = function (re) {
      return idx.every(function (i) { return re.test(String(header[i]).replace(/\s+/g, ' ').trim()); });
    };
    var allMonth = !allTime && every(RE_MONTHCOL);
    var allQtr   = !allTime && !allMonth && every(RE_QTRCOL);
    var unit = allTime ? '時段' : allMonth ? '月' : allQtr ? '季' : '期間';
    var pName = allTime ? (zh ? '時段' : 'Time')
              : allMonth ? (zh ? '月份' : 'Month')
              : allQtr ? (zh ? '季別' : 'Quarter')
              : (zh ? '期間' : 'Period');
    var vName = money / Math.max(filled, 1) > 0.3 ? (zh ? '金額' : 'Amount') : (zh ? '數值' : 'Value');
    return {
      name: t.name, title: t.title, preambleRows: t.preambleRows, headerRow: t.headerRow,
      grid: [rest.map(function (i) { return header[i]; }).concat([pName, vName])].concat(out),
      totals: [], skipped: t.skipped, range: t.range,
      notes: (t.notes || []).concat(['把 ' + idx.length + ' 個期間欄位攤平成「' + pName +
        '」欄，一次看一個' + unit]),
      unpivoted: 'period'
    };
  }

  S.analyseSheet = function (grid) {
    var tables = findTables(grid).map(function (t) {
      var idx = weekGrid(t.grid[0] || []);
      if (idx) {
        if (isCalendarGrid(t, idx)) { t.calendar = true; return t; }
        return unpivotWeek(t, idx) || t;
      }
      var pg = periodGrid(t.grid[0] || []);
      if (pg) return unpivotPeriods(t, pg.idx, pg.allTime) || t;
      return t;
    });
    if (!tables.length) return { tables: [] };
    return {
      tables: tables.map(function (t) {
        var a = S.analyse(t.grid);
        if (a) {
          a.title = t.title;
          a.name = t.name;
          a.headerRow = t.headerRow;
          a.totals = t.totals;
          a.notes = t.notes || [];      // 做過哪些結構轉換，要讓使用者看得到
          a.range = t.range;
          a.calendar = !!t.calendar;    // 月曆格子：交給 sheetVerdict 拒絕
          a.unpivoted = t.unpivoted || '';
          if (t.unpivoted === 'period') {
            /* 攤平出來的欄序是固定的：[列標籤…] | 期間 | 值。
               角色也釘死，不交給一般規則：一般規則是用「相異值少的當分組」挑的，
               所以 8 個項目 × 12 個月會分成 8 段、每張卡叫「JAN」；
               76 個項目 × 12 個月又會反過來。同一種表因為列數不同給出兩種版面，
               而攤平本來就是為了讓期間變成可以瀏覽的軸——釘住才是一致的。 */
            /* 用位置找，不要用欄名找。欄序是固定的，但第一欄不見得有欄名——
               budget_b0a247ff › Summary 的列標籤欄在原檔裡沒有標題，
               a.cols 給它合成的名字是「欄 1」，而 t.grid[0][0] 是空字串，
               byP[''] 當然找不到，整段釘角色就被跳過：月份變成列名、
               只有兩種值的標籤欄變成分組軸，剛好反過來。 */
            var hp = t.grid[0];
            var periodC = a.cols[a.cols.length - 2], valueC = a.cols[a.cols.length - 1];
            /* 期間前面可能不只一欄，而第一欄不見得是最適合當列名的那一欄。
               cashflow_281b542f › Monthly cash flow 攤完是
               Type（4 種）｜Description（36 種）｜Month｜Amount，
               拿 Type 當列名的話 258 張卡只有四種名字。
               所以在「期間前面那幾欄」裡用 pickTitle 挑，挑不出來才退回第一欄。 */
            var restC = a.cols.slice(0, -2);
            var labelC = S.pickTitle(restC.filter(function (c) { return c.type !== 'empty' })) || restC[0];
            if (periodC && valueC && labelC && hp.length >= 3 && a.cols.length === hp.length) {
              a.shape.group = periodC;
              /* 排程格（時間直排、日期橫排）的角色跟值矩陣剛好相反：
                 格子裡是活動名稱，那才是列名；左邊那欄是時間，當前導。
                 跟週表攤平的處理一致。 */
              if (labelC.type === 'time' && !/^(money|number)$/.test(valueC.type)) {
                a.shape.title = valueC; a.shape.lead = labelC;
              } else {
                a.shape.title = labelC; a.shape.lead = valueC;
              }
              /* 理由也要照釘住的角色重寫。原本留著 detectShape 的說法，
                 chart_8be76302 › summary 因此寫著「改以 Expenses 分組」，
                 而實際上是照 Month 分段——解釋跟畫面對不起來。 */
              a.shape.reason = '把期間攤平成「' + periodC.name + '」欄之後，以「' +
                a.shape.title.name + '」為列名、照「' + periodC.name + '」分段、「' +
                a.shape.lead.name + '」當前導';
              a.roles = S.assignRoles(a.cols.filter(function (c) { return c.type !== 'empty' }), a.shape);
            }
          }
          if (t.unpivoted === 'week') {
            // 攤平出來的三欄角色是固定的：星期＝標籤（拿來切天）、時間＝前導、內容＝標題。
            // 交給一般規則會把短短的「THU」挑成標題，內容反而被塞進內文區。
            var byName = {}; a.cols.forEach(function (c) { byName[c.name] = c; });
            var h = t.grid[0], dayC = byName[h[0]], itemC = byName[h[h.length - 1]], timeC = h.length === 3 ? byName[h[1]] : null;
            if (dayC && itemC) {
              // 頁面是拿 shape.title / lead / group 重算角色的，所以改在 shape 上
              a.shape.title = itemC;
              a.shape.lead = (timeC && timeC.type === 'time') ? timeC : null;
              a.shape.group = null;
              dayC.type = 'category';   // 星期一定是分類，不管值多寡
              a.roles = { group: null, lead: a.shape.lead, title: itemC, meta: [dayC], body: [], rest: [], hidden: [], assigned: {} };
              a.roles.assigned[dayC.name] = 'meta'; a.roles.assigned[itemC.name] = 'title';
              if (a.shape.lead) a.roles.assigned[timeC.name] = 'lead';
              if (timeC && !a.shape.lead) { a.roles.rest.push(timeC); a.roles.assigned[timeC.name] = 'rest'; }
            }
          }
        }
        return a;
      }).filter(Boolean)
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
