#!/usr/bin/env bash
# 兩套語料跑一輪：判型體檢 + 看法供給，各自寫 baseline 與摘要。
#
#   ./corpus-run.sh
#
# 為什麼要有這支：五行指令分開貼，漏掉其中一行是常態——
# 真實語料連續三輪沒跟著重跑，所以 v85 的修正完全沒反映在它的數字上，
# 而我在這邊比 diff 比了半天才發現「它根本沒動」。
# 一個指令跑完全部，就沒有漏的空間。
#
# 真實語料一律加 --private：寫出去的 JSON 裡一個原文都沒有（見 corpus-real/README.md）。
# gallery.html 兩邊都是沒遮罩的完整版，留在本機（.gitignore 裡），用來看真實畫面。
set -uo pipefail
cd "$(dirname "$0")"

fail=0
run() {                       # run <資料夾> <baseline> <摘要> <html> [額外參數...]
  local dir=$1 base=$2 sum=$3 html=$4; shift 4
  if [ ! -d "$dir" ]; then
    echo "— 跳過 $dir（資料夾不存在）"
    return
  fi
  local n
  n=$(find "$dir" -maxdepth 1 -type f \( -name '*.xlsx' -o -name '*.xls' -o -name '*.csv' \) | wc -l | tr -d ' ')
  if [ "$n" = 0 ]; then
    echo "— 跳過 $dir（裡面沒有試算表）"
    return
  fi
  echo
  echo "══ $dir（$n 個檔）"
  node audit.mjs   "$dir" --out "$base" "$@" || fail=1
  node gallery.mjs "$dir" --out "$sum"  "$@" > "$html" || fail=1
}

run corpus-ms/files   corpus-ms/baseline.json   corpus-ms/gallery-summary.json   corpus-ms/gallery.html
run corpus-real/files corpus-real/baseline.json corpus-real/gallery-summary.json corpus-real/gallery.html --private

echo
if [ "$fail" != 0 ]; then
  echo "有步驟失敗了——上面的訊息說了是哪一個。沒有寫壞的檔案（--out 是先寫 .tmp 再 rename）。"
  exit 1
fi
echo "都跑完了。接著："
echo "    git add -A && git commit -m \"<版號> 之後的 baseline 與看法供給\" && git push origin main"
