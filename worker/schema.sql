CREATE TABLE IF NOT EXISTS events (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    INTEGER NOT NULL,        -- 毫秒
  day   TEXT    NOT NULL,        -- YYYY-MM-DD（UTC）
  ev    TEXT    NOT NULL,        -- upload / open / view / share / made
  sheet TEXT,                    -- g:<試算表ID> / f:<檔名雜湊> / d:<內容雜湊>
  vid   TEXT,                    -- 裝置的隨機編號
  role  TEXT,                    -- maker / viewer
  src   TEXT,                    -- gsheet / file
  lang  TEXT,
  view  TEXT,                    -- 看法：time / filter:… / facts / group:… / all
  info  TEXT,                    -- 附註：錯誤代碼、形狀/大小、來源|裝置、互動種類
  cc    TEXT                     -- 來源國家（Cloudflare 判的，兩碼）
);
CREATE INDEX IF NOT EXISTS ev_sheet_vid ON events(ev, sheet, vid);
CREATE INDEX IF NOT EXISTS ev_day ON events(ev, day);

-- 分享的表格內容。頁面先在瀏覽器裡加密才送過來，金鑰在網址的 # 片段裡、
-- 不會送到伺服器，所以這張表存的是我們解不開的東西。
-- 30 天到期；過期的列在下一次寫入時順手清掉。
CREATE TABLE IF NOT EXISTS shares (
  k    TEXT PRIMARY KEY,       -- 短 key，出現在網址的 ?k=
  data TEXT NOT NULL,          -- 密文（base64url），伺服器不解讀
  iv   TEXT NOT NULL,          -- AES-GCM 的 IV（base64url，不必保密）
  ts   INTEGER NOT NULL,       -- 建立時間（毫秒）
  exp  INTEGER NOT NULL        -- 到期時間（毫秒）
);
CREATE INDEX IF NOT EXISTS shares_exp ON shares(exp);
