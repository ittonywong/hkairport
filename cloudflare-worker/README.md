# Cloudflare Worker 後備方案（可選）

主方案係 GitHub Actions 每 5 分鐘抓資料。如果 GitHub 嘅排程太慢或者被機場網站擋住，可以改用呢個 Worker（Cloudflare 免費計劃，每日 10 萬次請求，唔使信用卡，唔使任何金鑰）。

1. 登入 Cloudflare → Workers & Pages → Create → Create Worker（Hello World）。
2. 撳 Edit code，將 `worker.js` 全部內容貼入去，撳 Deploy。
3. 打開 `https://<worker 名>.<帳戶>.workers.dev/flights.json`，見到一大段 JSON 即成功。
4. 將 `assets/config.js` 入面嘅 `dataUrl` 改做上面條網址，再上載返去 GitHub。

Worker 每 60 秒最多向機管局攞一次資料（有快取），回傳格式同 `data/flights.json` 完全一樣。
