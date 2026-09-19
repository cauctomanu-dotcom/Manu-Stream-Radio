/* Manu Stream Remote Studio — choix explicite des micros Remote + Chroniques.
   - Le micro choisi pour le direct Remote est forcé à chaque ouverture audio.
   - Les Chroniques ont leur propre choix de micro.
   - N'altère pas le Studio PC. */
const REMOTE_KEY='msr-remote-mic-device-v1';
const REC_KEY='msr-recorder-mic-device-v1';
const $=id=>document.getElementById(id);
let originalGum=null,lastRemoteLabel='',lastRecorderLabel='';

function selectedId(kind='remote'){
  return String(localStorage.getItem(kind==='recorder'?REC_KEY:REMOTE_KEY)||'').trim();
}
function saveId(kind,id){
  const key=kind==='recorder'?REC_KEY:REMOTE_KEY;
  if(id)localStorage.setItem(key,id);else localStorage.removeItem(key);
}
async function inputs(){
  if(!navigator.mediaDevices?.enumerateDevices)return[];
  try{return (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput')}catch(e){console.warn('Liste micros',e);return[]}
}
function selectedLabel(kind='remote'){
  const sel=$(kind==='recorder'?'recMicDevice':'remoteMicDevice');
  if(sel?.selectedOptions?.[0]?.textContent)return sel.selectedOptions[0].textContent;
  return kind==='recorder'?lastRecorderLabel:lastRemoteLabel;
}
function audioConstraint(base,id){
  const cfg=base===true?{}:{...(base||{})};
  if(id)cfg.deviceId={exact:id};
  return cfg;
}
async function acquire(kind='remote',base={echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}){
  if(!originalGum)throw new Error('Micro non disponible dans ce navigateur.');
  const id=selectedId(kind);
  let stream;
  try{stream=await originalGum({audio:audioConstraint(base,id),video:false})}
  catch(e){
    if(!id)throw e;
    console.warn('Micro choisi indisponible, essai automatique',e);
    stream=await originalGum({audio:audioConstraint(base,''),video:false});
    const info=$(kind==='recorder'?'recMicDeviceInfo':'remoteMicDeviceInfo');
    if(info)info.textContent='Le micro choisi n’est pas disponible : iOS utilise le micro système.';
  }
  const label=stream.getAudioTracks?.()[0]?.label||selectedLabel(kind)||'Micro système';
  if(kind==='recorder')lastRecorderLabel=label;else lastRemoteLabel=label;
  setTimeout(refreshAll,120);
  return stream;
}
function fillSelect(sel,devices,wanted){
  if(!sel)return;
  const keep=wanted||'';sel.innerHTML='';
  const a=document.createElement('option');a.value='';a.textContent='Automatique / micro système';sel.appendChild(a);
  devices.forEach((d,i)=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Micro ${i+1}`;sel.appendChild(o)});
  sel.value=devices.some(d=>d.deviceId===keep)?keep:'';
}
async function refreshAll(){
  const ds=await inputs();
  fillSelect($('remoteMicDevice'),ds,selectedId('remote'));
  fillSelect($('recMicDevice'),ds,selectedId('recorder'));
  const a=$('remoteMicDeviceInfo'),b=$('recMicDeviceInfo');
  if(a&&!a.textContent.includes('indisponible'))a.textContent=ds.length?'Ce micro sera utilisé pour le direct Remote. Coupe puis reconnecte pour changer de source.':'Autorise d’abord le micro, puis actualise.';
  if(b&&!b.textContent.includes('indisponible'))b.textContent=ds.length?'Ce choix est indépendant du micro direct Remote.':'Autorise d’abord le micro, puis actualise.';
}
function makeBox(kind){
  const isRec=kind==='recorder',id=isRec?'recMicDevice':'remoteMicDevice',refresh=isRec?'recMicDeviceRefresh':'remoteMicDeviceRefresh',info=isRec?'recMicDeviceInfo':'remoteMicDeviceInfo';
  const box=document.createElement('div');box.className='remote-mic-device-box';
  box.innerHTML=`<label for="${id}">${isRec?'MICRO CHRONIQUE':'MICRO À UTILISER'}</label><div class="remote-mic-device-row"><select id="${id}"><option value="">Automatique / micro système</option></select><button id="${refresh}" type="button">↻</button></div><div id="${info}" class="muted">Chargement des micros…</div>`;
  return box;
}
function installUi(){
  const toggle=$('remoteMicToggle'),micCard=document.querySelector('.mic-card');
  if(toggle&&micCard&&!$('remoteMicDevice'))toggle.parentNode.insertBefore(makeBox('remote'),toggle);
  const rec=document.querySelector('.recorder-card');
  if(rec&&!$('recMicDevice')){const p=rec.querySelector('p.muted');p?.insertAdjacentElement('afterend',makeBox('recorder'))}
  if(!document.getElementById('remoteMicDeviceStyle')){const st=document.createElement('style');st.id='remoteMicDeviceStyle';st.textContent='.remote-mic-device-box{margin:12px 0}.remote-mic-device-box>label{display:block;margin-bottom:6px;font-size:.72rem;font-weight:800;letter-spacing:.08em;color:#a9b7cf}.remote-mic-device-row{display:grid;grid-template-columns:minmax(0,1fr) 44px;gap:8px}.remote-mic-device-row select,.remote-mic-device-row button{min-height:44px;min-width:0}.remote-mic-device-row button{padding:0}.remote-mic-device-box .muted{margin-top:6px;font-size:.76rem}';document.head.appendChild(st)}
  $('remoteMicDevice')?.addEventListener('change',e=>{saveId('remote',String(e.target.value||''));const i=$('remoteMicDeviceInfo');if(i)i.textContent='Choix mémorisé. Coupe puis reconnecte le micro Remote.'});
  $('recMicDevice')?.addEventListener('change',e=>{saveId('recorder',String(e.target.value||''));const i=$('recMicDeviceInfo');if(i)i.textContent='Choix mémorisé pour les prochains enregistrements.'});
  $('remoteMicDeviceRefresh')?.addEventListener('click',refreshAll);
  $('recMicDeviceRefresh')?.addEventListener('click',refreshAll);
  void refreshAll();
}
function patchCapture(){
  if(!navigator.mediaDevices?.getUserMedia||originalGum)return;
  originalGum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async function(constraints){
    if(!constraints?.audio)return originalGum(constraints);
    /* Le direct Remote appelle getUserMedia directement : on lui applique toujours le choix Remote. */
    const base=constraints.audio===true?{}:{...(constraints.audio||{})};
    const stream=await acquire('remote',base);
    const src=$('remoteMicSource');if(src&&String($('remoteMicState')?.textContent||'').indexOf('COUPÉ')<0)src.textContent=`Source : ${stream.getAudioTracks?.()[0]?.label||selectedLabel('remote')}`;
    return stream;
  };
}
function patchRecorderApi(){
  const r=window.MSR_REMOTE;if(!r)return false;
  r.requestAudioOnly=()=>acquire('recorder',{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1});
  return true;
}
function init(){patchCapture();installUi();patchRecorderApi();setInterval(()=>{patchRecorderApi()},1200)}
window.MSR_REMOTE_MIC_DEVICES={refresh:refreshAll,acquireRemote:(base)=>acquire('remote',base),acquireRecorder:()=>acquire('recorder'),selectedId,selectedLabel,lastRemoteLabel:()=>lastRemoteLabel,lastRecorderLabel:()=>lastRecorderLabel};
navigator.mediaDevices?.addEventListener?.('devicechange',refreshAll);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.addEventListener('msr-remote-paired',()=>setTimeout(()=>{patchRecorderApi();refreshAll()},120));
