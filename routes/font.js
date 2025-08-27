/** routes/font.js  — 完整覆寫 */
const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const dir = path.join(__dirname, '..', 'public', 'fonts');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const upload = multer({ dest: dir });

/* ========== 取得已存在的字體清單 ========== */
router.get('/list', (_, res) => {
  const list = fs.readdirSync(dir)
                 .filter(f => /\.(ttf|otf|woff2?)$/i.test(f))
                 .map(f => path.basename(f, path.extname(f))); // 去副檔名
  res.json(list);
});

/* ========== 上傳 ========== */
router.post('/upload', upload.single('font'), (req, res) => {
  const ext   = path.extname(req.file.originalname);
  const base  = path.basename(req.file.originalname, ext);
  const final = path.join(dir, base + ext);
  fs.renameSync(req.file.path, final);

  const cssRule = `@font-face{font-family:'${base}';src:url('/fonts/${base + ext}');}\n`;
  fs.appendFileSync(path.join(__dirname, '..', 'storage', 'style.css'), cssRule);

  /* 即時讓 message.html 重新載入 style.css */
  const bc = new BroadcastChannel('obs-style-sync');
  bc.postMessage({ type: 'font-updated' });
  bc.close();

  res.json({ family: base });
});

module.exports = router;
