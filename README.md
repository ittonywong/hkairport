# hkairport — 香港國際機場航班（即時）

手機優先嘅香港國際機場離港／抵港航班網頁：實際／預計時間、狀態（已起飛、已降落、延誤、取消、登機中…）、
離港閘口、代號共享航班號碼，可以按閘口、目的地／出發地、航班號碼搜尋。六種語言（繁中、簡中、English、日本語、Te Reo Māori、한국어），A−/A/A+ 字體，自動更新。

## 運作方式（全免費）
- 資料來源：香港機場管理局航班資訊開放數據（DATA.GOV.HK），`https://www.hongkongairport.com/flightinfo-rest/rest/flights/past?...`，唔使金鑰。
- 機場 API 唔俾其他網站喺瀏覽器直接讀（CORS：`Origin not allowed`），所以由 GitHub Actions
  (`.github/workflows/update-flights.yml`) 每約 5 分鐘執行 `scripts/fetch_flights.py`，產生 `data/flights.json`，再發佈到 GitHub Pages。
- 網頁 (`index.html` + `assets/`) 每 60 秒重新讀取 `data/flights.json`。
- 後備：`cloudflare-worker/worker.js`（Cloudflare 免費 Worker），見該資料夾 README。

## 本機測試
```
python3 scripts/fetch_flights.py      # 產生 data/flights.json
python3 -m http.server 8000           # 開 http://localhost:8000
```
（直接雙擊 index.html 用 file:// 開會讀唔到 data/flights.json，要經網址開。）

## 檔案
| 路徑 | 用途 |
|---|---|
| index.html, assets/style.css, assets/app.js | 網頁 |
| assets/i18n.js | 六種語言文字 |
| assets/config.js | 資料網址、更新間距設定 |
| scripts/fetch_flights.py | 抓取機管局資料（只用 Python 標準庫） |
| .github/workflows/update-flights.yml | 定時抓取 + 發佈 GitHub Pages |
| data/flights.json | 航班資料（Actions 每次會重新產生） |
| cloudflare-worker/ | 可選後備方案 |

資料來源：香港機場管理局／DATA.GOV.HK。只供參考，請以機場及航空公司公布為準。
