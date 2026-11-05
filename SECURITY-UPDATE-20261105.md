# OBS 本機安全修補 — 2026-11-05

> 此文件保存推送前的本機修補與測試紀錄；「尚未提交／推送」是當時狀態。後續已獲准提交至修復分支並更新／建立草稿 PR；實際結果以 PR 與 commit 狀態為準，仍不合併、不部署、不執行 npm audit。

基底 HEAD `0d59fcfb503f5c58d7a8a4d2f72b400333ab4de1`，另完整保留原 checkout 未提交的 package.json / package-lock.json。原變更新增的 @electron/get 5.0.0、Electron 31.7.7 及其他依賴調整均保留；原 checkout 完全未修改。

## 依賴變更

- 在使用者既有 lockfile 上：Multer 2.1.1 → 2.5.0；follow-redirects 1.16.0 → 1.16.2。
- config-file-ts 的 glob 10.5.0 → 14.0.2、minimatch 9.0.9 → 11.0.3；nodemon 的 minimatch 10.2.5 → 11.0.3。
- 僅覆寫受影響的現代版本範圍，保留 glob 7.2.3、minimatch 3.1.5／5.1.9 的舊 API。
- lodash 已是 4.18.1，未重做。未進行 Electron 重大升級或封裝發佈。

已核對 [Multer 最新 DoS 修補 2.5.0](https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m)、[follow-redirects 修補 1.16.2](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-mrwp-f3q8-3g9p)、[minimatch CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249)、[glob CVE-2026-118773](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)。

## 驗證與範圍

npm lockfile 解析與 npm ci 通過，生命週期腳本和 audit 均停用。沒有執行 setup、Electron postinstall、cloudflared 下載、Spotify／Discord／OBS／tunnel 服務。

`verify-obs.cjs` 在 loopback 與工作區專用資料目錄中測試，全部通過：實際 routes/font 的上傳／列表／缺檔／錯誤 multipart、中斷上傳後無遺留暫存檔、非同步 fileFilter、同 realm 與跨 realm 的自訂敏感標頭移除、Axios Authorization 移除、config-file-ts 對新版 glob 的匹配、nodemon 的新版 minimatch、原 glob7 callback API 保留。測試只使用合成標頭與字型 fixture；未啟動完整 server.js，也未變更真實資料。

沒有 AGENTS.md 或 .agents/skills 指示。只有依賴維護，無應用程式碼／機制變更。原檔 SHA256 比對另存於 evidence/obs-original-preserved.json。

交付包含兩種 patch：obs-live-helper.patch 是 HEAD 加既有工作與安全修補；obs-live-helper-security-only.patch 僅是相對於已保存既有工作快照的安全差異。套用前須核對當前原檔 hash，避免重複套用原有變更。未提交、推送、建立 PR、部署。npm audit 依指示不執行，完整漏洞清單尚未重新掃描；Electron 桌面封裝／原生 UI 未驗證。

建議 commit：`fix(security): patch upload and redirect dependencies`。

## GitHub CI 包裝驗證

第一次 Windows CI 完成安裝程式產生後，electron-builder 因 CI 自動發佈判斷而要求 GH_TOKEN，沒有 token 因而失敗；沒有發佈版本。修正工作流為 npm ci --no-audit --no-fund、先跑兩組安全測試、使用 --publish never 只建置，並將 GITHUB_TOKEN 權限限制為 contents: read。CI 只上傳 Actions 測試產物，不建立 release／tag 或部署。
