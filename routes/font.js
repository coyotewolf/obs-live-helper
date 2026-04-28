/** routes/font.js */
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { fontsPath, storagePath } = require('../services/runtimePaths');

const dir = fontsPath();
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const upload = multer({ dest: dir });

router.get('/list', (_, res) => {
  const list = fs.readdirSync(dir)
    .filter(f => /\.(ttf|otf|woff2?)$/i.test(f))
    .map(f => path.basename(f, path.extname(f)));
  res.json(list);
});

router.post('/upload', upload.single('font'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing font' });

  const ext = path.extname(req.file.originalname);
  const base = path.basename(req.file.originalname, ext).replace(/[\\/:*?"<>|]/g, '_');
  const final = path.join(dir, base + ext);
  fs.renameSync(req.file.path, final);

  const cssRule = `@font-face{font-family:'${base}';src:url('/fonts/${base + ext}');}\n`;
  fs.appendFileSync(storagePath('style.css'), cssRule);

  try {
    const bc = new BroadcastChannel('obs-style-sync');
    bc.postMessage({ type: 'font-updated' });
    bc.close();
  } catch {}

  res.json({ family: base });
});

module.exports = router;
