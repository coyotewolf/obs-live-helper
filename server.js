/**
 * server.js  (完整覆寫版)
 * -------------------------------------------
 * - 2 MB body limit（JSON / text）
 * - /style.css 只宣告一次
 * - /api 只掛一次（由 routes/index.js 統一出口）
 * - 其餘 font 上傳、lyrics、static path 保留
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app = express();

/* ---------- 基本設定 ---------- */
app.use(cors());
app.use(express.json({  limit: '2mb' }));
app.use(express.text({  limit: '2mb', type: 'text/plain' })); // dashboard 儲存 CSS 用

/* ---------- 靜態檔 ---------- */
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lyrics', express.static(path.join(__dirname, 'lyrics')));
app.use('/fonts',  express.static(path.join(__dirname, 'public', 'fonts')));
app.use(express.static(path.join(__dirname, 'storage'))); // 讓 /storage/style.css 也能直連

/* ---------- /style.css（OBS 會抓） ---------- */
const stylePath = path.join(__dirname, 'storage', 'style.css');

app.get('/style.css', (_, res) => {
  res.sendFile(stylePath);
});

/* Dashboard 儲存自訂 CSS */
app.post('/api/style/save', (req, res) => {
  // 兼容舊版 dashboard：可能傳 JSON {css: "..."}，也可能直接傳純文字
  const css = typeof req.body === 'string' ? req.body : req.body.css;
  if (!css) return res.status(400).send('missing css');

  fs.writeFile(stylePath, css, err => {
    if (err) {
      console.error('❌ style.css 寫入失敗：', err);
      return res.status(500).send('write fail');
    }
    console.log(`✅ style.css 已更新 (${Buffer.byteLength(css)} bytes)`);
    res.end('ok');
  });
});

/* ---------- 其他 API ---------- */
app.use('/api/editor', require('./routes/editor'));
app.use('/api',        require('./routes')); 
app.use('/api/font', require('./routes/font')); // 字型上傳

/* ---------- Lyrics 同步服務 ---------- */
const { startLyricSync } = require('./services/lyricsFetcher');
startLyricSync();

/* ---------- 伺服器啟動 ---------- */
const PORT = process.env.PORT || 5172;
app.listen(PORT, () => console.log('Server running on', PORT));
