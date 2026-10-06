#!/usr/bin/env bash
# 兩套語料跑一輪：判型體檢 + 看法供給，各自寫 baseline 與摘要。
#
#   ./corpus-run.sh
#
# 為什麼要有這支：五行指令分開貼，漏掉其中一行是常態——
# 真實語料連續三輪沒跟著重跑，所以 v85 的修正完全沒反映在它的數字上，
# 而我在這邊比 diff 比了半天才發現「它根本沒動」。
#
# 為什麼不用函式：第一版包成 run() 再 shift／"$@"，在 macOS 內建的 bash 3.2
# 上炸掉（set -u 配上空的 "$@" 在 4.4 之前會當成 unbound variable，
# 而我在 bash 5.2 上重現不出來）。兩個案例就寫兩段，沒有 shift 就沒有那個坑。
# 變數一律加大括號，全形括號不要緊貼在變數後面。
#
# 真實語料一律加 --private：寫出去的 JSON 裡一個原文都沒有（見 corpus-real/README.md）。
# gallery.html 兩邊都是沒遮罩的完整版，留在本機（.gitignore 裡），用來看真實畫面。
cd "$(dirname "$0")" || exit 1
fail=0

# 用 glob 而不是 find：find 的 -o 有運算子優先權的坑（-maxdepth 是全域選項，
# 擺在 -o 後面會被警告而且行為不是你想的那樣），而且它不跟隨符號連結的資料夾。
# glob 沒配到時會留著原樣的字串，-f 會把它濾掉。
count_sheets() {
  local n=0 f
  for f in "$1"/*.xlsx "$1"/*.xls "$1"/*.csv; do
    if [ -f "$f" ]; then n=$((n + 1)); fi
  done
  echo "${n}"
}

# ── 微軟範本 ──
if [ ! -d corpus-ms/files ]; then
  echo "-- 跳過 corpus-ms/files ： 資料夾不存在"
elif [ "$(count_sheets corpus-ms/files)" = 0 ]; then
  echo "-- 跳過 corpus-ms/files ： 裡面沒有試算表"
else
  echo ""
  echo "== corpus-ms/files ： $(count_sheets corpus-ms/files) 個檔"
  node audit.mjs corpus-ms/files --out corpus-ms/baseline.json || fail=1
  node gallery.mjs corpus-ms/files --out corpus-ms/gallery-summary.json > corpus-ms/gallery.html || fail=1
fi

# ── 真實檔案（一律 --private）──
if [ ! -d corpus-real/files ]; then
  echo "-- 跳過 corpus-real/files ： 資料夾不存在"
elif [ "$(count_sheets corpus-real/files)" = 0 ]; then
  echo "-- 跳過 corpus-real/files ： 裡面沒有試算表"
else
  echo ""
  echo "== corpus-real/files ： $(count_sheets corpus-real/files) 個檔（--private）"
  node audit.mjs corpus-real/files --out corpus-real/baseline.json --private || fail=1
  node gallery.mjs corpus-real/files --out corpus-real/gallery-summary.json --private > corpus-real/gallery.html || fail=1
fi

echo ""
if [ "$fail" != 0 ]; then
  echo "有步驟失敗了——上面的訊息說了是哪一個。"
  echo "沒有寫壞的檔案：--out 是先寫 .tmp 再 rename。"
  exit 1
fi
echo "都跑完了。接著："
echo "    git add -A && git commit -m \"<版號> 之後的 baseline 與看法供給\" && git push origin main"
