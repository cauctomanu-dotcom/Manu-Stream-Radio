/* Remote Studio V3.9.16 — micro direct + retour MASTER RADIO bidirectionnel.
   Smartphone -> MASTER REMOTE (toujours alimenté quand WebRTC reçoit le micro).
   MASTER RADIO -> smartphone (retour antenne, écoute volontaire pour éviter l'écho).
   La mise à l'antenne du micro reste décidée sur le PC par REMOTE -> ANTENNE. */
const V3916_POLL_MS=450;
let pc=null,micStream=null,session=null,pollTimer=null,lastId=0,pendingRemote=[],localCandidates=[],offerSent=false,starting=false,wantsMic=false,returnStream=null,disconnectTimer=null;
const R=()=>window.MSR_REMOTE||null;
const client=()=>R()?.getClient?.()||null;
const station=()=>R()?.getStation?.()||null;
const state=()=>R()?.getState?.()||{};
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function setText(id,text){const e=$(id);if(e)e.textContent=text}
function setMicUi(mode,text,source){
  const card=document.querySelector('.mic-card'),b=$('remoteMicToggle'),lamp=$('remoteMicLamp');if(!b)return;
  card?.classList.toggle('live',mode==='live');card?.classList.toggle('connecting',mode==='connecting');setText('remoteMicState',text);
  if(source)setText('remoteMicSource',source);
  b.textContent=mode==='off'?'🎙 CONNECTER LE MICRO AU STUDIO':'■ COUPER LE MICRO';
  b.classList.toggle('danger',mode!=='off');b.classList.toggle('primary',mode==='off');if(lamp)lamp.title=text;
}
function returnEls(){return{audio:$('v3916ReturnAudio'),button:$('v3916ReturnToggle'),status:$('v3916ReturnStatus'),fill:$('v3916MasterFill'),meter:$('v3916MasterMeter'),vol:$('v3916ReturnVolume'),route:$('v3916RemoteRoute')}}
function setReturnUi(){
  const {audio,button,status}=returnEls();if(!button)return;
  if(!pc){button.textContent='🎧 CONNECTER LE RETOUR ANTENNE';button.classList.add('primary');button.classList.remove('danger');if(status)status.textContent='Retour coupé · casque recommandé.';return}
  if(!returnStream){button.textContent='… CONNEXION DU RETOUR';button.classList.remove('primary','danger');if(status)status.textContent='Connexion au MASTER RADIO du PC…';return}
  const playing=audio&&!audio.paused;
  button.textContent=playing?'■ COUPER L’ÉCOUTE':'▶ ÉCOUTER L’ANTENNE';button.classList.toggle('danger',playing);button.classList.toggle('primary',!playing);
  if(status)status.textContent=playing?'Retour MASTER RADIO en écoute.':'Retour MASTER RADIO prêt · touche ÉCOUTER.';
}
async function signal(kind,payload={}){
  const c=client(),st=station();if(!c||!st||!session)throw new Error('Remote non appairée');
  let lastErr=null;for(let i=0;i<4;i++){const{error}=await c.from('radio_webrtc_signals').insert({station_id:st.id,session_id:session,sender:'phone',kind,payload});if(!error)return true;lastErr=error;await sleep(180*(i+1))}throw lastErr||new Error('Signal WebRTC non envoyé');
}
async function pollSignals(){
  const c=client(),st=station();if(!c||!st||!session||!pc)return;
  const{data,error}=await c.from('radio_webrtc_signals').select('id,session_id,sender,kind,payload').eq('station_id',st.id).eq('session_id',session).eq('sender','pc').gt('id',lastId).order('id',{ascending:true}).limit(120);if(error)return;
  for(const s of data||[]){lastId=Math.max(lastId,Number(s.id)||0);try{
    if(s.kind==='answer'&&!pc.remoteDescription){await pc.setRemoteDescription(s.payload);for(const cnd of pendingRemote.splice(0))await pc.addIceCandidate(cnd)}
    else if(s.kind==='candidate'){if(pc.remoteDescription)await pc.addIceCandidate(s.payload);else pendingRemote.push(s.payload)}
    else if(s.kind==='ready'&&wantsMic){setMicUi('connecting','MASTER REMOTE CONNECTÉ · PARLEZ',sourceLabel())}
    else if(s.kind==='audio'&&wantsMic){setMicUi('live','● MICRO REÇU PAR LE STUDIO',sourceLabel())}
    else if(s.kind==='return-ready'){setText('v3916ReturnStatus','MASTER RADIO envoyé par le PC · attente de la piste audio…')}
    else if(s.kind==='hangup'){await stop(false)}
  }catch(e){console.warn('Remote V3.9.16 signal',e)}}
}
function sourceLabel(){const t=micStream?.getAudioTracks?.()[0];return t?.label?`Source : ${t.label}`:'Source : micro du smartphone / périphérique actif'}
function setupPeer(sendMic){
  pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}],iceCandidatePoolSize:4});
  if(sendMic&&micStream){const track=micStream.getAudioTracks()[0];const sender=pc.addTrack(track,micStream);const tr=pc.getTransceivers().find(x=>x.sender===sender);if(tr)try{tr.direction='sendrecv'}catch{}}
  else pc.addTransceiver('audio',{direction:'recvonly'});
  pc.onicecandidate=e=>{if(!e.candidate)return;const c=e.candidate.toJSON();if(offerSent)signal('candidate',c).catch(console.warn);else localCandidates.push(c)};
  pc.ontrack=e=>{if(e.track?.kind!=='audio')return;returnStream=e.streams?.[0]||new MediaStream([e.track]);const a=$('v3916ReturnAudio');if(a){a.srcObject=returnStream;a.volume=Number($('v3916ReturnVolume')?.value||.85);a.muted=false}setReturnUi()};
  pc.onconnectionstatechange=()=>{const s=pc?.connectionState||'';if(disconnectTimer){clearTimeout(disconnectTimer);disconnectTimer=null}
    if(s==='connected'){if(wantsMic)setMicUi('connecting','STUDIO CONNECTÉ · PARLEZ',sourceLabel());setReturnUi()}
    else if(s==='connecting'||s==='new'){if(wantsMic)setMicUi('connecting','CONNEXION AU STUDIO…',sourceLabel())}
    else if(s==='failed'||s==='closed'){void stop(false)}
    else if(s==='disconnected'){disconnectTimer=setTimeout(()=>{if(pc?.connectionState==='disconnected')void stop(false)},6000)}
  };
}
async function connect(sendMic=false){
  if(starting)return;if(pc){if(sendMic&&!wantsMic){await stop(true)}else return}
  const c=client(),st=station();if(!c||!st){setMicUi('off','MICRO COUPÉ','Remote non appairée');setText('v3916ReturnStatus','Remote non appairée.');return}
  starting=true;wantsMic=!!sendMic;returnStream=null;session=crypto.randomUUID();lastId=0;pendingRemote=[];localCandidates=[];offerSent=false;
  try{
    if(sendMic){setMicUi('connecting','AUTORISATION MICRO…');micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},video:false});const t=micStream.getAudioTracks()[0];if(!t)throw new Error('Aucune piste micro disponible');t.enabled=true;try{t.contentHint='speech'}catch{}setMicUi('connecting','CONNEXION AU STUDIO…',sourceLabel())}
    setupPeer(sendMic);
    const offer=await pc.createOffer({offerToReceiveAudio:true});await pc.setLocalDescription(offer);
    await signal('offer',{type:pc.localDescription.type,sdp:pc.localDescription.sdp,returnAudio:true,sendMic:!!sendMic,clientVersion:'3.9.16'});offerSent=true;
    for(const cnd of localCandidates.splice(0))await signal('candidate',cnd);
    pollTimer=setInterval(()=>pollSignals().catch(()=>{}),V3916_POLL_MS);setReturnUi();await pollSignals();
  }catch(e){console.error(e);if(sendMic)setMicUi('off','MICRO COUPÉ',e?.message||'Impossible d’ouvrir le micro.');setText('v3916ReturnStatus',e?.message||'Connexion audio impossible.');await stop(false)
  }finally{starting=false}
}
async function stop(send=true){
  const sess=session;if(send&&sess&&client()&&station()){try{await signal('hangup',{})}catch{}}
  if(pollTimer){clearInterval(pollTimer);pollTimer=null}if(disconnectTimer){clearTimeout(disconnectTimer);disconnectTimer=null}
  const a=$('v3916ReturnAudio');if(a){try{a.pause()}catch{}a.srcObject=null}
  try{pc?.close()}catch{}pc=null;try{micStream?.getTracks().forEach(t=>t.stop())}catch{}micStream=null;try{returnStream?.getTracks().forEach(t=>t.stop())}catch{}returnStream=null;
  session=null;pendingRemote=[];localCandidates=[];offerSent=false;lastId=0;wantsMic=false;
  setMicUi('off','MICRO COUPÉ','Le micro du smartphone / casque Bluetooth sera utilisé.');setReturnUi();
  if(client()&&station()&&sess)setTimeout(()=>client().from('radio_webrtc_signals').delete().eq('station_id',station().id).eq('session_id',sess).then(()=>{}).catch(()=>{}),1500)
}
function installUi(){
  let old=$('remoteMicToggle');if(old&&old.dataset.v3916!=='1'){const b=old.cloneNode(true);b.dataset.v3916='1';b.dataset.v396='1';old.replaceWith(b);old=b;b.addEventListener('click',async e=>{e.preventDefault();e.stopImmediatePropagation();if(pc&&wantsMic)await stop(true);else{const a=$('v3916ReturnAudio');if(a&&!a.paused)a.pause();await connect(true)}},true)}
  if(!pc)setMicUi('off','MICRO COUPÉ','Le micro du smartphone / casque Bluetooth sera utilisé.');
  const note=document.querySelector('.mic-note');if(note)note.innerHTML='Le micro alimente le <strong>MASTER REMOTE</strong> dès sa réception. Sur le PC, <strong>PRÉÉCOUTE</strong> et <strong>REMOTE → ANTENNE</strong> restent les seuls boutons qui décident où il est entendu.';
  if(!$('v3916ReturnCard')){const card=document.createElement('section');card.id='v3916ReturnCard';card.className='card';card.innerHTML=`<div class="section-title">Après-écoute / retour antenne</div><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px"><strong>MASTER RADIO</strong><span id="v3916MasterMeter" class="muted">—</span></div><div style="height:10px;border-radius:99px;background:#111a2b;overflow:hidden;margin-bottom:12px"><span id="v3916MasterFill" style="display:block;height:100%;width:0%;background:linear-gradient(90deg,#39d98a,#ffd166,#ff5d73);transition:width .12s linear"></span></div><button id="v3916ReturnToggle" class="primary wide">🎧 CONNECTER LE RETOUR ANTENNE</button><label class="range-row" style="margin-top:10px"><span>Volume retour <b id="v3916ReturnVolumeText">85 %</b></span><input id="v3916ReturnVolume" type="range" min="0" max="1" step=".01" value=".85"></label><audio id="v3916ReturnAudio" playsinline></audio><div id="v3916ReturnStatus" class="muted status-line">Retour coupé · casque recommandé.</div><div id="v3916RemoteRoute" class="muted" style="margin-top:7px"></div><p class="muted mic-note" style="margin-bottom:0">Le retour reproduit le <strong>MASTER RADIO réellement mixé sur le PC</strong>. La lecture n’est jamais lancée automatiquement : utilise de préférence un casque pour éviter l’écho avec le micro.</p>`;
    const micCard=document.querySelector('.mic-card');if(micCard)micCard.insertAdjacentElement('afterend',card);else $('remotePanel')?.prepend(card);
    $('v3916ReturnToggle')?.addEventListener('click',async()=>{const a=$('v3916ReturnAudio');if(!pc){await connect(false);return}if(!returnStream){setText('v3916ReturnStatus','Retour en cours de connexion…');return}if(a.paused){try{await a.play()}catch(e){setText('v3916ReturnStatus','Lecture bloquée par le téléphone : retouche ÉCOUTER.');return}}else a.pause();setReturnUi()});
    $('v3916ReturnAudio')?.addEventListener('play',setReturnUi);$('v3916ReturnAudio')?.addEventListener('pause',setReturnUi);
    $('v3916ReturnVolume')?.addEventListener('input',e=>{const v=Number(e.target.value||0);const a=$('v3916ReturnAudio');if(a)a.volume=v;setText('v3916ReturnVolumeText',`${Math.round(v*100)} %`)})
  }
  const r=R();if(r){r.startRemoteMic=()=>connect(true);r.stopRemoteMic=stop;r.connectAirReturn=()=>connect(false)}return true
}
function updateMeters(){
  const rt=state()?.runtime||{},n=Math.max(0,Number(rt.masterMeter)||0),pct=Math.min(100,Math.round(n*125));const{fill,meter,route}=returnEls();if(fill)fill.style.width=`${pct}%`;if(meter){const db=n>0?20*Math.log10(n):-Infinity;meter.textContent=Number.isFinite(db)?`${db.toFixed(1)} dBFS`:'−∞ dBFS'}if(route)route.textContent=`Micro Remote : ${rt.remoteMicConnected?'reçu par le PC':'non connecté'} · Préécoute : ${rt.remoteCue?'ON':'OFF'} · Remote → Antenne : ${rt.remoteAir?'ON':'OFF'}`
}
function install(){installUi();updateMeters()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.addEventListener('msr-remote-paired',()=>setTimeout(install,50));window.addEventListener('msr-remote-unpaired',()=>void stop(false));
setInterval(()=>{installUi();updateMeters()},500);
window.addEventListener('pagehide',()=>{try{micStream?.getTracks().forEach(t=>t.stop())}catch{}try{pc?.close()}catch{}});
