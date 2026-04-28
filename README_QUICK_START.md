# OBS Live Helper｜Windows 一鍵使用說明

這個包是給一般使用者下載後直接使用的版本。Spotify token、安全碼、點歌紀錄都只會存在你的電腦本機，不會被打包出去。

## 最簡單使用方式

1. 解壓縮整個資料夾。
2. 點兩下 `RUN-WINDOWS.bat`。
3. 第一次啟動時，如果電腦沒有 Node.js，程式會自動下載 portable Node.js 到 `tools/`。
4. 程式會自動安裝 npm 套件、建立本機安全碼、嘗試下載 `cloudflared.exe`。
5. 第一次使用 Spotify 時，依照視窗提示打開 `.env`，填入自己的 Spotify `CLIENT_ID`。
6. Dashboard 會自動打開：

```txt
http://127.0.0.1:5172/html/dashboard.html
```

## Spotify Developer 設定

每個使用者應該使用自己的 Spotify Developer App。這樣比較安全，也避免共用別人的開發者權限。

Spotify Redirect URI 必須加入：

```txt
http://127.0.0.1:5172/api/spotify/callback
```

`.env` 至少需要：

```env
CLIENT_ID=你的 Spotify Client ID
REDIRECT_URI=http://127.0.0.1:5172/api/spotify/callback
```

不需要填 Client Secret。本工具使用 PKCE 授權流程。

## 外網 QR Code 點歌

Dashboard 裡可以按「啟動 Tunnel」。成功後會產生 `trycloudflare.com` 外網網址，觀眾掃 QR Code 就能進入點歌頁。

如果自動下載 cloudflared 失敗，可以手動下載 `cloudflared.exe`，放到：

```txt
tools/cloudflared.exe
```

或在 `.env` 指定：

```env
CLOUDFLARED_PATH=C:\Users\你的名字\Downloads\cloudflared.exe
```

## 資安注意

不要把以下檔案傳給別人或上傳 GitHub：

```txt
.env
storage/spotify.json
storage/security.json
storage/request-settings.json
storage/song-requests.json
storage/public-url.json
```

這個發行包已經清掉這些私人檔案。使用者第一次啟動時會在自己的電腦重新產生。

## 常見問題

### Q：沒有安裝 Node.js 可以用嗎？

可以。`RUN-WINDOWS.bat` 會自動下載 portable Node.js 到 `tools/`。如果下載失敗，才需要手動安裝 Node.js LTS。

### Q：Tunnel 顯示 cloudflared 找不到？

把 `cloudflared.exe` 放到：

```txt
tools/cloudflared.exe
```

然後重新啟動 `RUN-WINDOWS.bat`。

### Q：Spotify 登入失敗？

請檢查 Spotify Developer Dashboard 的 Redirect URI 是否完全一致：

```txt
http://127.0.0.1:5172/api/spotify/callback
```

也請確認 `.env` 裡的 `CLIENT_ID` 是你自己的 Spotify App Client ID。

### Q：播放 / 暫停 / 跳歌不能用？

Spotify 播放控制通常需要 Spotify Premium，並且必須先有正在播放的 Spotify 裝置。請先在電腦或手機打開 Spotify 播一首歌，再操作。

---

## 打包成真正的 Windows 安裝檔（.exe）

開發者要發行給一般使用者時，不要直接傳整包原始碼。請在 Windows 上執行：

```bat
BUILD-EXE-WINDOWS.bat
```

完成後會在 `dist/` 產生：

```txt
OBS Live Helper Setup 0.1.0.exe
```

把這個 `.exe` 給使用者即可。使用者安裝後會在 Start Menu / Programs 裡看到 `OBS Live Helper`，點開就是軟體視窗，不需要看到 terminal。
