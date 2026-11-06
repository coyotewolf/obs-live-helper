# Electron 憑證撤銷安全修補 — 2026-11-06

草稿 PR #3 原 head `43e28e5ade417a7bf387f3e35ad7a4df4c96c826`；在隔離 clone 內保留先前所有依賴、權限與 CI 修補，沒有修改使用者目前的原 checkout、應用程式安裝或 AppData profile。

## 版本與相容性選擇

Electron 31.7.7 → 固定 42.11.16。[官方 CVE-2026-115570 公告](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9)列 <42.11.16 受影響，沒有應用端替代修補。42.11.16 是公告列出的最低修補穩定版本，未直接跳到 43／44。

保留 electron-builder 24.13.3、使用者先前新增的 @electron/get 5.0.0，以及 Multer／follow-redirects／glob／minimatch 修補。Electron 42 npm 套件要求 host Node >=22.12.0；本機 Node 24 與既有 Windows CI 的 Node 22 線符合。內嵌執行環境已實測 Electron 42.11.16 / Node 24.19.0 / Chromium 148.0.7778.280。

已對照 [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)：應用只使用 app、BrowserWindow、loadURL、setWindowOpenHandler、will-navigate、shell.openExternal 與 dialog，未使用已移除的 File.path、WebSQL／openDatabase、BrowserView、remote、舊 printer/systemPreferences API，也沒有需遷移 ABI 的應用原生 addon。產品程式碼沒有為跨版升級改寫。

Electron 32 起會處理 userData 下舊的 Chromium databases 目錄；此應用的持久資料位於 storage／fonts 等檔案路徑。正式安裝升級前仍應備份原 userData 並人工驗證實際帳號／裝置整合；本次沒有對原 profile 執行新版 Electron。

## 真實桌面測試

新增 tests/electron-smoke.cjs，以實際 electron-main.js 啟動應用與 server；測試包裝只強制隱藏視窗、指定 test-results 內的合成 profile、綁定 loopback、阻擋外部網路與其他本機服務，以及攔截測試用外部瀏覽器開啟。沒有將測試開關放進產品流程。

通過項目：實際啟動、dashboard renderer、contextIsolation / nodeIntegration 設定、隔離 runtime data、本機 configuration/font API、window.open 與外部導航保護、app quit 後 server port 關閉。測試沒有存取使用者 profile、Spotify／Discord／OBS 或公開 tunnel。

既有四項 credential/admin 安全測試與 upload/redirect 依賴回歸測試也通過。官方 checksum 驗證的 Electron binary 只安裝於隔離工作區；未執行全域安裝。

## CI 與限制

既有 Windows CI 納入真實 Electron offline smoke，再做 NSIS build；繼續使用 npm ci --no-audit --no-fund、contents: read 與 --publish never，只上傳 Actions 產物，不發佈 release、tag 或部署。CI 最終結果以 PR head 對應的 run 為準。

未驗證真實 OAuth、直播裝置、公開 tunnel、多螢幕或使用者已安裝 profile 的原地升級，也沒有實際 MITM／受損憑證測試；憑證撤銷修補依據是官方版本與公告。完整 npm audit 的獨立授權未收到，未執行。沒有 AGENTS.md 或 .agents/skills 指示。

建議 commit：`fix(security): update Electron with isolated desktop regression coverage`。
