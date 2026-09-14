(()=>{
'use strict';
const $=(id)=>document.getElementById(id);
const fmt=n=>String(n).padStart(2,'0');
const fmtClock=s=>`${fmt(Math.floor(s/60))}:${fmt(Math.floor(s%60))}`;
const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
let db=null,ctx=null,micStream=null,micSource=null,micGain=null,micAnalyser=null,recordBus=null,recordDest=null;
let recorder=null,chunks=[],recording=false,recordStarted=0,timerHandle=null,meterHandle=null;
let tracks=[],pads=[],activeJingles=new Set();

function status(msg,type=''){
  const el=$('status'); el.textContent=msg; el.className=`status ${type}`.trim();
}
function toast(msg,type=''){
  const el=$('toast'); el.textContent=msg; el.className=`toast show ${type}`.trim();
  clearTimeout(toast._t); toast._t=setTimeout(()=>el.className='toast',3500);
}
function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('manu-stream-radio-portable',1);
    req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('tracks'))d.createObjectStore('tracks',{keyPath:'id'});};
    req.onsuccess=()=>{db=req.result;resolve(db);}; req.onerror=()=>reject(req.error);
  });
}
function tx(mode='readonly'){return db.transaction('tracks',mode).objectStore('tracks');}
const dbAll=()=>new Promise((res,rej)=>{const q=tx().getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error);});
const dbGet=id=>new Promise((res,rej)=>{const q=tx().get(id);q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error);});
const dbPut=v=>new Promise((res,rej)=>{const q=tx('readwrite').put(v);q.onsuccess=()=>res();q.onerror=()=>rej(q.error);});

async function loadLibrary(){
  tracks=(await dbAll()).sort((a,b)=>(b.added||0)-(a.added||0));
  try{pads=JSON.parse(localStorage.getItem('msr-pads')||'[]');if(!Array.isArray(pads))pads=[];}catch{pads=[];}
  fillSelect('introSelect'); fillSelect('transitionSelect'); fillSelect('outroSelect'); renderPads();
}
function fillSelect(id){
  const el=$(id),saved=localStorage.getItem(`msr-bulletin-${id}`)||'';
  el.innerHTML='<option value="">— Aucun —</option>'+tracks.map(t=>`<option value="${t.id}">${escapeHtml(t.title||t.name||'Sans titre')} — ${escapeHtml(t.artist||'Manu Stream')}</option>`).join('');
  if(tracks.some(t=>t.id===saved))el.value=saved;
  el.onchange=()=>localStorage.setItem(`msr-bulletin-${id}`,el.value);
}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function renderPads(){
  const root=$('padGrid');
  const mapped=pads.map((p,i)=>({i,track:tracks.find(t=>t.id===p?.trackId)})).filter(x=>x.track);
  root.innerHTML=mapped.length?mapped.map(x=>`<button class="pad" data-pad-track="${x.track.id}"><span>PAD ${fmt(x.i+1)}</span><b>${escapeHtml(x.track.title||x.track.name)}</b></button>`).join(''):'<div class="empty">Aucun pad configuré dans la soundboard principale.</div>';
}

async function listDevices(request=false){
  try{
    if(request){const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());}
    const devs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
    const current=$('micSelect').value;
    $('micSelect').innerHTML='<option value="">Micro par défaut</option>'+devs.map((d,i)=>`<option value="${d.deviceId}">${escapeHtml(d.label||`Micro ${i+1}`)}</option>`).join('');
    if(devs.some(d=>d.deviceId===current))$('micSelect').value=current;
    status(`${devs.length||1} entrée(s) micro disponible(s).`,'ok');
  }catch(e){status(`Impossible de lire les micros : ${e.message}`,'error');}
}
function ensureAudio(){
  if(ctx){if(ctx.state==='suspended')ctx.resume();return;}
  ctx=new (window.AudioContext||window.webkitAudioContext)();
  recordBus=ctx.createGain(); recordBus.gain.value=1;
  recordDest=ctx.createMediaStreamDestination(); recordBus.connect(recordDest);
}
async function connectMic(){
  ensureAudio();
  if(micStream)micStream.getTracks().forEach(t=>t.stop());
  const deviceId=$('micSelect').value;
  const audio={noiseSuppression:$('noiseSuppression').checked,echoCancellation:$('echoCancellation').checked,autoGainControl:$('autoGain').checked};
  if(deviceId)audio.deviceId={exact:deviceId};
  micStream=await navigator.mediaDevices.getUserMedia({audio});
  micSource=ctx.createMediaStreamSource(micStream); micGain=ctx.createGain(); micGain.gain.value=Number($('micLevel').value)||1;
  micAnalyser=ctx.createAnalyser(); micAnalyser.fftSize=256; micAnalyser.smoothingTimeConstant=.7;
  micSource.connect(micGain); micGain.connect(micAnalyser); micAnalyser.connect(recordBus);
  status(`Micro prêt : ${micStream.getAudioTracks()[0]?.label||'entrée par défaut'}.`,'ok');
  startMeter();
}
function micLevel(){
  if(!micAnalyser)return 0; const a=new Uint8Array(micAnalyser.fftSize); micAnalyser.getByteTimeDomainData(a); let p=0;
  for(const v of a)p=Math.max(p,Math.abs(v-128)/128); return Math.min(1,p*2);
}
function startMeter(){
  cancelAnimationFrame(meterHandle);
  const tick=()=>{const v=micLevel();$('micMeter').style.width=`${Math.round(v*100)}%`; applyDucking(v);meterHandle=requestAnimationFrame(tick);};tick();
}
function applyDucking(voice){
  if(!ctx)return;const enabled=$('ducking').checked,base=Number($('jingleLevel').value)||.9,duck=Number($('duckLevel').value)||.35;
  const target=enabled&&voice>.06?base*duck:base;
  activeJingles.forEach(g=>{try{g.gain.setTargetAtTime(target,ctx.currentTime,voice>.06?.06:.25);}catch{}});
}
async function fireTrack(trackId,label='Jingle'){
  if(!trackId)return toast(`Aucun ${label.toLowerCase()} sélectionné.`,'warn');
  ensureAudio(); const t=await dbGet(trackId); if(!t?.blob)return toast('Fichier audio introuvable.','error');
  const arr=await t.blob.arrayBuffer(); const buf=await ctx.decodeAudioData(arr.slice(0)); const src=ctx.createBufferSource(); src.buffer=buf;
  const recGain=ctx.createGain(),monitorGain=ctx.createGain(); const base=Number($('jingleLevel').value)||.9;
  recGain.gain.value=base; monitorGain.gain.value=$('monitorJingles').checked?Math.min(base,.75):0;
  src.connect(recGain); recGain.connect(recordBus); src.connect(monitorGain); monitorGain.connect(ctx.destination);
  activeJingles.add(recGain); src.onended=()=>{activeJingles.delete(recGain);try{src.disconnect();recGain.disconnect();monitorGain.disconnect();}catch{}}; src.start();
  toast(`${label} : ${t.title||t.name||'audio'} lancé.`,'ok');
}
function modeLabel(){return $('bulletinType').value==='weather'?'Météo':'Infos';}
function safeDate(){const d=new Date();return `${d.getFullYear()}-${fmt(d.getMonth()+1)}-${fmt(d.getDate())}_${fmt(d.getHours())}-${fmt(d.getMinutes())}`;}
async function startRecording(){
  if(recording)return; try{
    if(!micStream)await connectMic(); ensureAudio();
    const mime=['audio/webm;codecs=opus','audio/webm'].find(x=>window.MediaRecorder&&MediaRecorder.isTypeSupported(x))||'';
    recorder=new MediaRecorder(recordDest.stream,mime?{mimeType:mime}:undefined); chunks=[];
    recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);}; recorder.onstop=finishRecording;
    recorder.start(250); recording=true; recordStarted=Date.now(); $('recordBtn').disabled=true; $('stopBtn').disabled=false; $('recordLamp').classList.add('on');
    $('recordState').textContent=`ENREGISTREMENT ${modeLabel().toUpperCase()}`; timerHandle=setInterval(updateTimer,200); updateTimer(); status('Enregistrement en cours : les jingles lancés maintenant seront intégrés au fichier final.','recording');
  }catch(e){status(`Démarrage impossible : ${e.message}`,'error');}
}
function stopRecording(){if(recorder&&recorder.state==='recording')recorder.stop();}
function updateTimer(){if(!recording)return;$('timer').textContent=fmtClock((Date.now()-recordStarted)/1000);}
async function finishRecording(){
  recording=false; clearInterval(timerHandle); $('recordBtn').disabled=false; $('stopBtn').disabled=true; $('recordLamp').classList.remove('on'); $('recordState').textContent='PRÊT';
  const type=recorder?.mimeType||'audio/webm',blob=new Blob(chunks,{type}); if(!blob.size){status('Aucune donnée audio enregistrée.','error');return;}
  const label=modeLabel(),stamp=safeDate(),fileName=`Manu-Stream-Radio-${label}-${stamp}.webm`,url=URL.createObjectURL(blob);
  $('preview').src=url; $('previewBox').hidden=false; $('downloadLink').href=url; $('downloadLink').download=fileName; $('downloadLink').textContent=`Télécharger ${fileName}`;
  if($('autoLibrary').checked){
    const duration=Math.max(1,(Date.now()-recordStarted)/1000),d=new Date();
    await dbPut({id:uid(),name:fileName,title:`${label} du jour — ${d.toLocaleDateString('fr-FR')} ${fmt(d.getHours())}:${fmt(d.getMinutes())}`,artist:'Manu Stream',duration,size:blob.size,added:Date.now(),blob,artwork:null,kind:label.toLowerCase()});
    await loadLibrary(); toast(`${label} ajouté à la bibliothèque.`, 'ok');
  }
  status(`${label} terminé : voix et jingles sont réunis dans un seul fichier.`,'ok');
}
function stopAll(){if(micStream)micStream.getTracks().forEach(t=>t.stop());micStream=null;cancelAnimationFrame(meterHandle);}

$('refreshMic').onclick=()=>listDevices(true); $('connectMic').onclick=()=>connectMic().catch(e=>status(e.message,'error'));
$('micLevel').oninput=()=>{if(micGain&&ctx)micGain.gain.setTargetAtTime(Number($('micLevel').value)||1,ctx.currentTime,.02);$('micLevelValue').textContent=`${Math.round(Number($('micLevel').value)*100)}%`;};
$('jingleLevel').oninput=()=>{$('jingleLevelValue').textContent=`${Math.round(Number($('jingleLevel').value)*100)}%`;};
$('duckLevel').oninput=()=>{$('duckLevelValue').textContent=`${Math.round(Number($('duckLevel').value)*100)}%`;};
$('introBtn').onclick=()=>fireTrack($('introSelect').value,'Intro').catch(e=>toast(e.message,'error'));
$('transitionBtn').onclick=()=>fireTrack($('transitionSelect').value,'Transition').catch(e=>toast(e.message,'error'));
$('outroBtn').onclick=()=>fireTrack($('outroSelect').value,'Outro').catch(e=>toast(e.message,'error'));
$('padGrid').addEventListener('click',e=>{const b=e.target.closest('[data-pad-track]');if(b)fireTrack(b.dataset.padTrack,'Pad').catch(err=>toast(err.message,'error'));});
$('recordBtn').onclick=startRecording; $('stopBtn').onclick=stopRecording;
window.addEventListener('beforeunload',stopAll);

(async()=>{
  try{await openDb();await loadLibrary();await listDevices(false);status('Module prêt. Choisis Infos ou Météo, vérifie ton micro et lance REC.','ok');}
  catch(e){status(`Initialisation impossible : ${e.message}`,'error');}
})();
})();
