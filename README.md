# lyrics-lrclib-retry-no-spotify-patch

覆蓋檔案：

- services/lyricsFetcher.js

效果：

- lyrics loop 預設每 5 秒檢查一次。
- Spotify playback cache 預設使用 10 秒 TTL。
- 偵測到切歌時才呼叫 Spotify 取得目前播放狀態並查 LRCLib。
- 同一首歌找不到歌詞後，會重新嘗試 LRCLib，最多 3 次。
- 同一首歌的 LRCLib retry 使用已快取的 track context，不會重新呼叫 Spotify API。
- 第 1、2 次失敗維持 [obsstatus:searching]；第 3 次失敗才寫 [obsstatus:not_found]。

可調整環境變數：

- LYRICS_LOOP_INTERVAL_MS=5000
- SPOTIFY_PLAYBACK_CACHE_MS=10000
- LYRICS_SAME_TRACK_RETRY_MS=8000
- LYRICS_MAX_SAME_TRACK_RETRIES=3
