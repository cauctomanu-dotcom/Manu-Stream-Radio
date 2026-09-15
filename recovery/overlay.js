const $ = id => document.getElementById(id);
let artV = 0;
let logoV = 0;

function apply(s = {}) {
  const pill = $('livePill');
  if (pill) {
    pill.classList.toggle('on', !!s.live);
    const label = pill.querySelector('span');
    if (label) label.textContent = s.live ? 'MANU STREAM — EN DIRECT' : 'MANU STREAM — STANDBY';
  }
  if ($('clock')) $('clock').textContent = s.clock || '--:--:--';
  if ($('showName')) $('showName').textContent = s.showName || 'Manu Stream — Radio';
  if ($('banner')) $('banner').textContent = s.banner || 'STANDBY';
  if ($('title')) $('title').textContent = s.title || 'Manu Stream Radio';
  if ($('artist')) $('artist').textContent = s.artist || '';
  if ($('next')) $('next').textContent = s.next || '—';
  if ($('caller')) $('caller').textContent = s.callerName || '';
  if ($('callerWrap')) $('callerWrap').classList.toggle('hidden', !s.callerName);
  if ($('meter')) $('meter').style.width = Math.max(0, Math.min(100, Number(s.meter || 0) * 100)) + '%';
  if ($('status')) $('status').textContent = s.live ? 'Master Radio actif' : 'Master Radio prêt';

  if (s.artworkVersion && s.artworkVersion !== artV) {
    artV = s.artworkVersion;
    if ($('artImg')) $('artImg').src = '/artwork?v=' + encodeURIComponent(artV);
    if ($('art')) $('art').classList.add('has');
  } else if (!s.artworkVersion) {
    artV = 0;
    if ($('art')) $('art').classList.remove('has');
    if ($('artImg')) $('artImg').removeAttribute('src');
  }

  if (s.logoVersion && s.logoVersion !== logoV) {
    logoV = s.logoVersion;
    if ($('logo')) $('logo').src = '/logo?v=' + encodeURIComponent(logoV);
    if (pill) pill.classList.add('has-logo');
  } else if (!s.logoVersion) {
    logoV = 0;
    if (pill) pill.classList.remove('has-logo');
    if ($('logo')) $('logo').removeAttribute('src');
  }
}

fetch('/api/state', { cache: 'no-store' })
  .then(r => r.json())
  .then(apply)
  .catch(() => {});

const es = new EventSource('/events');
es.onmessage = e => {
  try { apply(JSON.parse(e.data)); } catch (_) {}
};
