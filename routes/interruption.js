const router = require('express').Router();
const fs = require('fs');
const { storagePath } = require('../services/runtimePaths');
const { requireAdmin } = require('../services/securityStore');

const REQUESTS_FILE = storagePath('song-requests.json');

function readRequests(){
  if (!fs.existsSync(REQUESTS_FILE)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveRequests(list){
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(Array.isArray(list) ? list : [], null, 2));
}

function getApprovedInterruptions(list = readRequests()){
  return list
    .filter(item => item?.mode === 'play-now' && item?.status === 'interruption_approved')
    .slice(-100)
    .reverse();
}

router.get('/approved', requireAdmin, (req, res) => {
  res.json({ ok: true, requests: getApprovedInterruptions() });
});

router.post('/clear-approved', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(id => String(id || '').trim()).filter(Boolean)
    : [];

  if (!ids.length) {
    return res.status(400).json({ ok: false, error: 'missing_ids', message: '請先選擇要清除的已同意插播歌曲。' });
  }

  const idSet = new Set(ids);
  const list = readRequests();
  let cleared = 0;
  const now = new Date().toISOString();

  for (const item of list) {
    if (idSet.has(item.id) && item.mode === 'play-now' && item.status === 'interruption_approved') {
      item.status = 'interruption_played';
      item.clearedFromDashboard = true;
      item.clearedAt = now;
      item.updatedAt = now;
      cleared += 1;
    }
  }

  saveRequests(list);
  res.json({ ok: true, cleared, requests: getApprovedInterruptions(list), message: cleared ? `已清除 ${cleared} 首已插播歌曲。` : '沒有可清除的已同意插播歌曲。' });
});

module.exports = router;
