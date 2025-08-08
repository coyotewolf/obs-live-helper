/** routes/font.js  —  完整版本 **/
const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

/* 儲存目錄：public/fonts */
const dir = path.join(__dirname, '..', 'public', 'fonts');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

/* multer 設定 */
const upload = multer({ dest: dir });

/* POST /api/font/upload  — 上傳字型檔 */
router.post('/upload', upload.single('font'), (req, res) => {
  const ext  = path.extname(req.file.originalname);          // .ttf  / .otf / .woff
  const base = path.basename(req.file.originalname, ext);    // 去掉副檔名
  const final = path.join(dir, base + ext);

  /* 重新命名到目標檔名 */
  fs.renameSync(req.file.path, final);

  /* 追加 @font-face 到 storage/style.css */
  const cssPath = path.join(__dirname, '..', 'storage', 'style.css');
  const rule = `@font-face{font-family:'${base}';src:url('/fonts/${base + ext}');}\n`;
  fs.appendFileSync(cssPath, rule);

  /* 回傳字族名，前端會自動填到下拉選單 */
  res.json({ family: base });
});

module.exports = router;
