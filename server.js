require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/lyrics', express.static(path.join(__dirname, 'lyrics')));

app.use('/api', require('./routes'));

const { startLyricSync } = require('./services/lyricsFetcher');
startLyricSync();
app.listen(PORT, () => {
  console.log(`OBS Live Helper listening on http://127.0.0.1:${PORT}`);
});
