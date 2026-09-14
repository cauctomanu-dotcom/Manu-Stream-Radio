(()=>{
'use strict';
const $=(id)=>document.getElementById(id);
const fmt=n=>String(n).padStart(2,'0');
const fmtClock=s=>`${fmt(Math.floor(s/60))}:${fmt(Math.floor(s%60))}`;
const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
let db=null,ctx=null,micStream=null,micSource=null,micGain=null,micAnalyser=null,recordBus=null,recordDest=null;
let recorder=null,chunks=[],recording=false,recordStarted=0,timerHandle=null,meterHandle=null;
let tracks=[],pads=[],activeJingles=new Set(),lastPreviewUrl='';

function status(msg,type=''){const el=$('status');el.textContent=msg;el.className=`status ${type}`.trim();}
function toast(msg,type=''){const el=$('toast');el.textContent=msg;el.className=`toast show ${type}`.trim();clearTimeout(toast._t);toast._t=setTimeout(()=>el.className='toast',3500);}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open('manu-stream-radio-portable',1);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('tracks'))d.createObjectStore('tracks',{keyPath:'id'});};req.onsuccess=()=>{db=req.result;resolve(db);};req.onerror=()=>reject(req.error);});}
function tx(mode='readonly'){return db.transaction('tracks',mode).objectStore('tracks');}
const dbAll=()=>new Promise((res,rej)=>{const q=tx().getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error);});
const dbGet=id=>new Promise((res,rej)=>{const q=tx().get(id);q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error);});
const dbPut=v=>new Promise((res,rej)=>{const q=tx('readwrite').put(v);q.onsuccess=()=>res();q.onerror=()=>rej(q.error);});

async function loadLibrary(){
  tracks=(await dbAll()).sort((a,b)=>(b.added||0)-(a.added||0));
  try{pads=JSON.parse(localStorage.getItem('msr-pads')||'[]');if(!Array.isArray(pads))pads=[];}catch{pads=[];}
  fillSelect('introSelect');fillSelect('transitionSelect');fillSelect('outroSelect');renderPads();
}
function fillSelect(id){
  const el=$(id),saved=localStorage.getItem(`msr-bulletin-${id}`)||'';
  el.innerHTML='<option value="">— Aucun —</option>'+tracks.map(t=>`<option value="${t.id}">${escapeHtml(t.title||t.name||'Sans titre')} — ${escapeHtml(t.artist||'Manu Stream')}</option>`).join('');
  if(tracks.some(t=>t.id===saved))el.value=saved;
  el.onchange=()=>localStorage.setItem(`msr-bulletin-${id}`,el.value);
}
function wirePosition(id,defaultValue){
  const el=$(id),saved=localStorage.getItem(`msr-bulletin-${id}`);el.value=saved||defaultValue;
  el.onchange=()=>localStorage.setItem(`msr-bulletin-${id}`,el.value);
}
function renderPads(){
  const mapped=pads.map((p,i)=>({i,track:tracks.find(t=>t.id===p?.trackId)})).filter(x=>x.track);
  $('padGrid').innerHTML=mapped.length?mapped.map(x=>`<button class="pad" data-pad-track="${x.track.id}"><span>PAD ${fmt(x.i+1)}</span><b>${escapeHtml(x.track.title||x.track.name)}</b></button>`).join(''):'<div class="empty">Aucun pad configuré dans la soundboard principale.</div>';
}

async function listDevices(request=false){
  try{
    if(request){const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());}
    const devs=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'),current=$('micSelect').value;
    $('micSelect').innerHTML='<option value="">Micro par défaut</option>'+devs.map((d,i)=>`<option value="${d.deviceId}">${escapeHtml(d.label||`Micro ${i+1}`)}</option>`).join('');
    if(devs.some(d=>d.deviceId===current))$('micSelect').value=current;
    status(`${devs.length||1} entrée(s) micro disponible(s).`,'ok');
  }catch(e){status(`Impossible de lire les micros : ${e.message}`,'error');}
}
function ensureAudio(){
  if(ctx){if(ctx.state==='suspended')ctx.resume();return;}
  ctx=new(window.AudioContext||window.webkitAudioContext)();recordBus=ctx.createGain();recordBus.gain.value=1;recordDest=ctx.createMediaStreamDestination();recordBus.connect(recordDest);
}
async function connectMic(){
  ensureAudio();if(micStream)micStream.getTracks().forEach(t=>t.stop());
  const deviceId=$('micSelect').value,audio={noiseSuppression:$('noiseSuppression').checked,echoCancellation:$('echoCancellation').checked,autoGainControl:$('autoGain').checked};if(deviceId)audio.deviceId={exact:deviceId};
  micStream=await navigator.mediaDevices.getUserMedia({audio});micSource=ctx.createMediaStreamSource(micStream);micGain=ctx.createGain();micGain.gain.value=Number($('micLevel').value)||1;micAnalyser=ctx.createAnalyser();micAnalyser.fftSize=256;micAnalyser.smoothingTimeConstant=.7;
  micSource.connect(micGain);micGain.connect(micAnalyser);micAnalyser.connect(recordBus);status(`Micro prêt : ${micStream.getAudioTracks()[0]?.label||'entrée par défaut'}.`,'ok');startMeter();
}
function micLevel(){if(!micAnalyser)return 0;const a=new Uint8Array(micAnalyser.fftSize);micAnalyser.getByteTimeDomainData(a);let p=0;for(const v of a)p=Math.max(p,Math.abs(v-128)/128);return Math.min(1,p*2);}
function startMeter(){cancelAnimationFrame(meterHandle);const tick=()=>{const v=micLevel();$('micMeter').style.width=`${Math.round(v*100)}%`;applyDucking(v);meterHandle=requestAnimationFrame(tick);};tick();}
function applyDucking(voice){if(!ctx)return;const enabled=$('ducking').checked,base=Number($('jingleLevel').value)||.9,duck=Number($('duckLevel').value)||.35,target=enabled&&voice>.06?base*duck:base;activeJingles.forEach(g=>{try{g.gain.setTargetAtTime(target,ctx.currentTime,voice>.06?.06:.25);}catch{}});}

async function decodeBlob(blob){ensureAudio();return ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));}
async function fireTrack(trackId,label='Jingle',intoTake=false){
  if(!trackId)return toast(`Aucun ${label.toLowerCase()} sélectionné.`,'warn');ensureAudio();const t=await dbGet(trackId);if(!t?.blob)return toast('Fichier audio introuvable.','error');
  const buf=await decodeBlob(t.blob),src=ctx.createBufferSource(),monitorGain=ctx.createGain(),base=Number($('jingleLevel').value)||.9;src.buffer=buf;monitorGain.gain.value=$('monitorJingles').checked?Math.min(base,.8):0;src.connect(monitorGain);monitorGain.connect(ctx.destination);
  let recGain=null;if(intoTake&&recording){recGain=ctx.createGain();recGain.gain.value=base;src.connect(recGain);recGain.connect(recordBus);activeJingles.add(recGain);}
  src.onended=()=>{if(recGain)activeJingles.delete(recGain);try{src.disconnect();monitorGain.disconnect();recGain?.disconnect();}catch{}};src.start();toast(`${label} : ${t.title||t.name||'audio'} ${intoTake&&recording?'ajouté au REC':'en préécoute'}.`,'ok');
}
function slotInfo(prefix,label){return{label,trackId:$(`${prefix}Select`).value,position:$(`${prefix}Position`).value};}
function montageSlots(){return[slotInfo('intro','Intro'),slotInfo('transition','Transition'),slotInfo('outro','Sortie')];}
async function composeFinal(voiceBlob){
  const voice=await decodeBlob(voiceBlob),slots=montageSlots(),before=[],after=[],jingleGain=Math.max(0,Number($('jingleLevel').value)||.9);
  for(const slot of slots){if(!slot.trackId||slot.position==='manual')continue;const t=await dbGet(slot.trackId);if(!t?.blob)continue;const entry={buffer:await decodeBlob(t.blob),gain:jingleGain,label:slot.label};(slot.position==='before'?before:after).push(entry);}
  const sequence=[...before,{buffer:voice,gain:1,label:'Voix'},...after],gap=.08,sampleRate=ctx.sampleRate,total=Math.max(.1,sequence.reduce((n,x)=>n+x.buffer.duration,0)+gap*Math.max(0,sequence.length-1));
  const offline=new OfflineAudioContext(2,Math.ceil(total*sampleRate),sampleRate);let at=0;
  for(const item of sequence){const src=offline.createBufferSource(),g=offline.createGain();src.buffer=item.buffer;g.gain.value=item.gain;src.connect(g);g.connect(offline.destination);src.start(at);at+=item.buffer.duration+gap;}
  const rendered=await offline.startRendering();return{blob:audioBufferToWav(rendered),duration:rendered.duration,before:before.map(x=>x.label),after:after.map(x=>x.label)};
}
function audioBufferToWav(buffer){
  const channels=Math.min(2,buffer.numberOfChannels),rate=buffer.sampleRate,frames=buffer.length,bytesPerSample=2,blockAlign=channels*bytesPerSample,dataSize=frames*blockAlign,ab=new ArrayBuffer(44+dataSize),v=new DataView(ab);let p=0;
  const str=s=>{for(let i=0;i<s.length;i++)v.setUint8(p++,s.charCodeAt(i));};str('RIFF');v.setUint32(p,36+dataSize,true);p+=4;str('WAVE');str('fmt ');v.setUint32(p,16,true);p+=4;v.setUint16(p,1,true);p+=2;v.setUint16(p,channels,true);p+=2;v.setUint32(p,rate,true);p+=4;v.setUint32(p,rate*blockAlign,true);p+=4;v.setUint16(p,blockAlign,true);p+=2;v.setUint16(p,16,true);p+=2;str('data');v.setUint32(p,dataSize,true);p+=4;
  const data=[];for(let c=0;c<channels;c++)data.push(buffer.getChannelData(c));for(let i=0;i<frames;i++)for(let c=0;c<channels;c++){let s=Math.max(-1,Math.min(1,data[c][i]||0));v.setInt16(p,s<0?s*0x8000:s*0x7fff,true);p+=2;}return new Blob([ab],{type:'audio/wav'});
}
function modeLabel(){return $('bulletinType').value==='weather'?'Météo':'Infos';}
function safeDate(){const d=new Date();return`${d.getFullYear()}-${fmt(d.getMonth()+1)}-${fmt(d.getDate())}_${fmt(d.getHours())}-${fmt(d.getMinutes())}`;}
async function startRecording(){
  if(recording)return;try{if(!micStream)await connectMic();ensureAudio();const mime=['audio/webm;codecs=opus','audio/webm'].find(x=>window.MediaRecorder&&MediaRecorder.isTypeSupported(x))||'';recorder=new MediaRecorder(recordDest.stream,mime?{mimeType:mime}:undefined);chunks=[];recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};recorder.onstop=finishRecording;recorder.start(250);recording=true;recordStarted=Date.now();$('recordBtn').disabled=true;$('stopBtn').disabled=false;$('recordLamp').classList.add('on');$('recordState').textContent=`ENREGISTREMENT ${modeLabel().toUpperCase()}`;timerHandle=setInterval(updateTimer,200);updateTimer();status('Enregistre ta voix. Les jingles réglés « Avant » ou « Après » seront placés automatiquement au montage.','recording');}catch(e){status(`Démarrage impossible : ${e.message}`,'error');}
}
function stopRecording(){if(recorder&&recorder.state==='recording'){status('Montage du bulletin en cours…','recording');recorder.stop();}}
function updateTimer(){if(recording)$('timer').textContent=fmtClock((Date.now()-recordStarted)/1000);}
async function finishRecording(){
  recording=false;clearInterval(timerHandle);$('recordBtn').disabled=false;$('stopBtn').disabled=true;$('recordLamp').classList.remove('on');$('recordState').textContent='MONTAGE';
  try{
    const raw=new Blob(chunks,{type:recorder?.mimeType||'audio/webm'});if(!raw.size)throw new Error('Aucune donnée audio enregistrée.');
    const result=await composeFinal(raw),label=modeLabel(),stamp=safeDate(),fileName=`Manu-Stream-Radio-${label}-${stamp}.wav`;
    if(lastPreviewUrl)URL.revokeObjectURL(lastPreviewUrl);lastPreviewUrl=URL.createObjectURL(result.blob);$('preview').src=lastPreviewUrl;$('previewBox').hidden=false;$('downloadLink').href=lastPreviewUrl;$('downloadLink').download=fileName;$('downloadLink').textContent=`Télécharger ${fileName}`;
    if($('autoLibrary').checked){const d=new Date();await dbPut({id:uid(),name:fileName,title:`${label} du jour — ${d.toLocaleDateString('fr-FR')} ${fmt(d.getHours())}:${fmt(d.getMinutes())}`,artist:'Manu Stream',duration:result.duration,size:result.blob.size,added:Date.now(),blob:result.blob,artwork:null,kind:label.toLowerCase()});await loadLibrary();toast(`${label} monté et ajouté à la bibliothèque.`,'ok');}
    const before=result.before.length?`Avant : ${result.before.join(', ')}`:'Aucun jingle avant',after=result.after.length?`Après : ${result.after.join(', ')}`:'aucun jingle après';status(`${label} terminé — ${before} · ${after}.`,'ok');
  }catch(e){status(`Montage impossible : ${e.message}`,'error');}
  finally{$('recordState').textContent='PRÊT';}
}
function launchSlot(prefix,label){const pos=$(`${prefix}Position`).value,manual=pos==='manual';fireTrack($(`${prefix}Select`).value,label,manual).catch(e=>toast(e.message,'error'));}
function stopAll(){if(micStream)micStream.getTracks().forEach(t=>t.stop());micStream=null;cancelAnimationFrame(meterHandle);if(lastPreviewUrl)URL.revokeObjectURL(lastPreviewUrl);}

$('refreshMic').onclick=()=>listDevices(true);$('connectMic').onclick=()=>connectMic().catch(e=>status(e.message,'error'));
$('micLevel').oninput=()=>{if(micGain&&ctx)micGain.gain.setTargetAtTime(Number($('micLevel').value)||1,ctx.currentTime,.02);$('micLevelValue').textContent=`${Math.round(Number($('micLevel').value)*100)}%`;};
$('jingleLevel').oninput=()=>{$('jingleLevelValue').textContent=`${Math.round(Number($('jingleLevel').value)*100)}%`;};$('duckLevel').oninput=()=>{$('duckLevelValue').textContent=`${Math.round(Number($('duckLevel').value)*100)}%`;};
$('introBtn').onclick=()=>launchSlot('intro','Intro');$('transitionBtn').onclick=()=>launchSlot('transition','Transition');$('outroBtn').onclick=()=>launchSlot('outro','Sortie');
$('padGrid').addEventListener('click',e=>{const b=e.target.closest('[data-pad-track]');if(b)fireTrack(b.dataset.padTrack,'Pad',recording).catch(err=>toast(err.message,'error'));});
$('recordBtn').onclick=startRecording;$('stopBtn').onclick=stopRecording;window.addEventListener('beforeunload',stopAll);

(async()=>{try{await openDb();await loadLibrary();wirePosition('introPosition','before');wirePosition('transitionPosition','after');wirePosition('outroPosition','after');await listDevices(false);status('Module prêt. Les jingles peuvent maintenant être placés avant, pendant ou après ta voix.','ok');}catch(e){status(`Initialisation impossible : ${e.message}`,'error');}})();
})();
