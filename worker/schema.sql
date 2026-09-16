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
  view  TEXT                     -- 看法：time / filter:… / facts / group:… / all
);
CREATE INDEX IF NOT EXISTS ev_sheet_vid ON events(ev, sheet, vid);
CREATE INDEX IF NOT EXISTS ev_day ON events(ev, day);
