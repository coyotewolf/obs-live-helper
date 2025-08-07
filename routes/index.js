const router = require('express').Router();

router.get('/hello', (req, res) => {
  res.json({ message: 'API is working! 👋' });
});

router.use('/spotify', require('./spotify'));

module.exports = router;
