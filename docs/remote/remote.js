import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const SUPABASE_URL = 'https://xpmrnwipnoekiycghwli.supabase.co';
const SUPABASE_KEY = 'sb_publishable_CK-3LTMSP2aIdbFSFSQk1A_f5DRBlj4';
const KEY_STORAGE = 'msr-remote-pairing-v1';
const $ = (id) => document.getElementById(id);

let client = null;
let station = null;
let state = null;
let pollTimer = null;
let lastAckNonce = null;
let pendingNonce = null;
let lastSeenAt = 0;

function setConnection(ok, text) {
  const p = $('connectionPill');
  p.textContent = text;
  p.classList.toggle('online', !!ok);
  p.classList.toggle('offline', !ok);
}
function escapeText(v) { return v == null ? '' : String(v); }
function pairingClient(key) {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-radio-key': key } }
  });
}
function formatRemaining(v) {
  if (!v) return '—';
  return String(v);
}
function bedKeyFromSelect(v) {
  const map = {
    'talk-neutral': 'neutral',
    'matinale-douce': 'morning',
    'news-pulse': 'news',
    'pop-radio': 'pop',
    'night-drive': 'night',
    neutral:'neutral', morning:'morning', news:'news', pop:'pop', night:'night'
  };
  return map[v] || 'neutral';
}
function selectValueFromBed(v) {
  const map = { neutral:'talk-neutral', morning:'matinale-douce', news:'news-pulse', pop:'pop-radio', night:'night-drive' };
  return map[v] || 'talk-neutral';
}

async function verifyPairing(key) {
  const c = pairingClient(key);
  const { data, error } = await c.from('radio_stations').select('id,name,slug').limit(1).maybeSingle();
  if (error || !data) throw new Error('Clé non reconnue. Vérifie la clé copiée depuis le PC.');
  client = c;
  station = data;
  localStorage.setItem(KEY_STORAGE, key);
  $('pairPanel').classList.add('hidden');
  $('remotePanel').classList.remove('hidden');
  setConnection(true, 'CONNECTÉ');
  await pollState();
  startPolling();
}

async function pair() {
  const key = $('pairKey').value.trim();
  if (!key) return;
  $('pairStatus').textContent = 'Connexion…';
  try {
    await verifyPairing(key);
    $('pairStatus').textContent = '';
  } catch (e) {
    $('pairStatus').textContent = e.message || String(e);
    setConnection(false, 'NON APPAIRÉ');
  }
}

function unpair() {
  localStorage.removeItem(KEY_STORAGE);
  client = null; station = null; state = null;
  clearInterval(pollTimer); pollTimer = null;
  $('remotePanel').classList.add('hidden');
  $('pairPanel').classList.remove('hidden');
  $('pairKey').value = '';
  setConnection(false, 'NON APPAIRÉ');
}

async function pollState() {
  if (!client || !station) return;
  try {
    const { data, error } = await client.from('radio_station_state').select('*').eq('station_id', station.id).maybeSingle();
    if (error) throw error;
    state = data || { station_id: station.id, runtime: {} };
    lastSeenAt = Date.now();
    render();
  } catch (e) {
    if (Date.now() - lastSeenAt > 9000) setConnection(false, 'PC / CLOUD INJOIGNABLE');
  }
}
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollState, 1800);
}

function render() {
  const r = state?.runtime || {};
  const fresh = r.updatedAt && (Date.now() - Number(r.updatedAt) < 12000);
  setConnection(fresh !== false, fresh === false ? 'PC HORS LIGNE' : 'CONNECTÉ');
  const live = !!r.live;
  $('airState').textContent = live ? '● ON AIR' : '○ STANDBY';
  $('airState').className = `air-state ${live ? 'on' : 'off'}`;
  $('nowTitle').textContent = escapeText(r.title || 'Aucun élément');
  $('nowArtist').textContent = escapeText(r.artist || '—');
  $('modeValue').textContent = r.manual ? 'MAIN MANUELLE' : r.auto24 ? 'AUTO 7J/24H' : live ? 'DIRECT' : 'STANDBY';
  $('remainingValue').textContent = formatRemaining(r.remaining);
  $('webValue').textContent = r.webRadio ? 'ON' : 'OFF';
  $('streamValue').textContent = r.streamlabs ? 'ON' : 'OFF';
  $('nextValue').textContent = escapeText(r.next || '—');
  $('listenerMessage').value = escapeText(r.listenerMessage || '');
  const bed = r.talkBed || {};
  $('bedPreset').value = selectValueFromBed(bed.preset);
  $('bedToggle').textContent = bed.active ? '■ COUPER' : '▶ LANCER';
  $('bedState').textContent = bed.active ? `${bed.label || 'Fond d’antenne'} · ${Math.round((Number(bed.volume) || .1) * 100)} %` : 'Fond d’antenne arrêté';

  const ack = r.remote_ack;
  if (pendingNonce && ack?.nonce === pendingNonce && ack.nonce !== lastAckNonce) {
    lastAckNonce = ack.nonce;
    pendingNonce = null;
    $('commandStatus').textContent = ack.ok ? '✓ Commande exécutée sur le PC.' : `Erreur : ${ack.message || 'commande refusée'}`;
  }
}

async function sendCommand(action, payload = {}) {
  if (!client || !station) throw new Error('Télécommande non appairée.');
  const nonce = crypto.randomUUID();
  pendingNonce = nonce;
  $('commandStatus').textContent = 'Envoi au studio…';
  const runtime = { ...(state?.runtime || {}), remote_request: { nonce, action, payload, at: Date.now() } };
  const { error } = await client.from('radio_station_state').update({ runtime, updated_at: new Date().toISOString() }).eq('station_id', station.id);
  if (error) {
    pendingNonce = null;
    $('commandStatus').textContent = `Erreur : ${error.message}`;
    throw error;
  }
  await pollState();
}

$('pairBtn').addEventListener('click', pair);
$('pairKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') pair(); });
$('unpairBtn').addEventListener('click', unpair);

document.querySelectorAll('[data-command]').forEach((b) => b.addEventListener('click', () => sendCommand(b.dataset.command).catch(() => {})));

$('bedToggle').addEventListener('click', () => {
  const active = !!state?.runtime?.talkBed?.active;
  const preset = bedKeyFromSelect($('bedPreset').value);
  sendCommand(active ? 'stop_talk_bed' : 'start_talk_bed', { preset }).catch(() => {});
});
$('bedPreset').addEventListener('change', () => {
  const preset = bedKeyFromSelect($('bedPreset').value);
  sendCommand('set_talk_bed', { preset }).catch(() => {});
});
$('publishMessage').addEventListener('click', () => sendCommand('publish_message', { message: $('listenerMessage').value.slice(0,240) }).catch(() => {}));
$('clearMessage').addEventListener('click', () => sendCommand('clear_message').catch(() => {}));
$('stopEverything').addEventListener('click', () => {
  if (confirm('STOP TOTAL : arrêter immédiatement la diffusion du studio ?')) sendCommand('stop_everything').catch(() => {});
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

const saved = localStorage.getItem(KEY_STORAGE);
if (saved) {
  $('pairStatus').textContent = 'Reconnexion…';
  verifyPairing(saved).catch((e) => {
    $('pairStatus').textContent = e.message || String(e);
    localStorage.removeItem(KEY_STORAGE);
    setConnection(false, 'NON APPAIRÉ');
  });
}
