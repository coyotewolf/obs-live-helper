// routes/editor.js
const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router   = express.Router();
const TXT_PATH = path.join(__dirname, '..', 'storage', 'editor.txt');

/* === GET 目前內容（Dashboard / message.html 都用這條） === */
router.get('/', (req, res) => {
  fs.readFile(TXT_PATH, 'utf8', (err, data) => {
    if (err && err.code !== 'ENOENT')           // 其它讀檔錯
      return res.status(500).send('read fail');
    res.type('text/plain').send(data || '');    // 沒檔案就回空字串
  });
});

/* === 儲存（Dashboard > 儲存文字） === */
router.post('/save', express.json(), (req, res) => {
  const text = req.body.text;
  if (typeof text !== 'string')
    return res.status(400).send('missing text');

  fs.writeFile(TXT_PATH, text, err => {
    if (err) return res.status(500).send('write fail');
    res.end('ok');
  });
});

/* === 清空 === */
router.post('/clear', (_, res) => {
  fs.unlink(TXT_PATH, () => res.end('ok'));     // 沒檔也無所謂
});

module.exports = router;
