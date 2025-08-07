require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5172;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', require('./routes'));

app.listen(PORT, () => {
  console.log(`OBS Live Helper listening on http://127.0.0.1:${PORT}`);
});
