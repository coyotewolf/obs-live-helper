const router = require('express').Router();

router.use('/spotify', require('./spotify'));
router.use('/editor', require('./editor'));
router.use('/style', require('./style'));
router.use('/request', require('./request'));
router.use('/discord-profile', require('./discordProfile'));
router.use('/overlay-config', require('./overlayConfig'));
router.use('/backup', require('./backup'));

router.get('/hello', (req, res) => {
  res.json({ message: 'API is working! 👋' });
});

module.exports = router;
