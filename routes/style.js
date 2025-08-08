const router = require('express').Router();
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'storage', 'style.css');

// get current style
router.get('/', (req, res) => {
  if (!fs.existsSync(FILE)) return res.send('');
  res.send(fs.readFileSync(FILE, 'utf8'));
});

// save style
router.post('/save', (req, res) => {
  fs.writeFileSync(FILE, req.body.css || '', 'utf8');
  res.json({ ok: true });
});

module.exports = router;