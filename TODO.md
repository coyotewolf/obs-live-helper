# TODO

## v0.1.2 — Immediate Fixes

- [x] Fix 加入佇列審核 bug. 問題複現-未開放點歌直接加入佇列權限時，點歌並點擊加入佇列進入審核清單後，若主播同意加入佇列，會造成整個原先的播放清單消失，Up Next顯示歌曲全部變成帶播歌曲。
- [x] Edit 這首歌剛剛有人點過，請10分鐘後再點 功能，改為20秒。
- [ ] Fix 觀眾點擊加入佇列和要求插播後，補播端顯示一樣的問題，請改成在按鈕顏色上做分別，顯眼的那個就是觀眾點擊的功能。
- [ ] Fix LRCLib lyrics-not1-found timeout handling bug.要能跑24/7，應加上cache + 熔斷 + 減少 fuzzy search 次數+添加預查佇列中的歌的功能(利用現有的跟spotify叫佇列資料時，抓取歌曲同時查詢)+dashboard清除歌詞快取功能。 
- [ ] Add dashboard tab behavior.
- [ ] Add 啟動時重複(已有同樣的軟體啟動or使用同樣port) port warnings.
- [ ] Add 備份 button behavior.
- [ ] Fix manual / automatic card length 目前無法實際改變長度 bug.
- [ ] Add song pause display behavior.
- [ ] Discuss 觀眾要求插播後的queue function.
- [ ] Add icons.
- [ ] Add tunnel auto-open option.
- [ ] Change clock background behavior from `black` to `white`.
- [ ] Add 軟體更新直接安裝 option.
- [ ] Prepare and release v0.1.2.

## v0.1.x — Feature Additions

- [ ] Add YouTube song diplay/lyrics function.

## Later Versions

- [ ] Review and re-group remaining feature requests after v0.1.2 is stable.
