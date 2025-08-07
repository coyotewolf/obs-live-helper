const router = require('express').Router();

router.get('/hello', (req, res) => {
  res.json({ message: 'API is working! 👋' });
});

module.exports = router;
