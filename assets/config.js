// 網站設定 Site settings
// dataUrl: 預設讀取 GitHub Actions 每 5 分鐘更新嘅 data/flights.json（同一個 GitHub Pages 網站）。
// 如果改用 Cloudflare Worker（見 cloudflare-worker/README.md），將 dataUrl 改做 Worker 網址，例如
//   dataUrl: "https://hkairport-proxy.<你的帳戶>.workers.dev/flights.json"
window.HKA_CONFIG = {
  dataUrl: "data/flights.json",
  refreshSec: 60,        // 頁面自動重新讀取資料嘅間距（秒）
  staleMin: 25,          // 資料超過幾多分鐘冇更新就顯示警告
  earlierMin: 60         // 預設隱藏幾多分鐘之前已完成嘅航班
};
