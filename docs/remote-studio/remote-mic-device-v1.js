/* Manu Stream Remote Studio — choix du micro de la Remote.
   N'altère pas le Studio PC. Le périphérique choisi est appliqué au prochain
   getUserMedia déclenché par le bouton Micro à distance. */
const MSR_REMOTE_MIC_DEVICE_KEY='msr-remote-mic-device-v1';
let msrForceNextRemoteMic=false;
let msrOriginalGetUserMedia=null;

const byId=id=>document.getElementById(id);

function selectedDeviceId(){
  return String(localStorage.getItem(MSR_REMOTE_MIC_DEVICE_KEY)||'').trim();
}

async function refreshRemoteMicDevices(){
  const sel=byId('remoteMicDevice');
  if(!sel||!navigator.mediaDevices?.enumerateDevices)return;
  const wanted=selectedDeviceId();
  let devices=[];
  try{devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput')}catch(e){console.warn('Liste micros Remote',e)}
  const current=devices.find(d=>d.deviceId===wanted);
  sel.innerHTML='';
  const auto=document.createElement('option');
  auto.value='';auto.textContent='Automatique / micro système';sel.appendChild(auto);
  devices.forEach((d,i)=>{
    const o=document.createElement('option');
    o.value=d.deviceId;
    o.textContent=d.label||`Micro ${i+1}`;
    sel.appendChild(o);
  });
  sel.value=current?wanted:'';
  const info=byId('remoteMicDeviceInfo');
  if(info){
    if(!devices.length)info.textContent='Aucun micro listé pour le moment. Autorise le micro puis actualise.';
    else if(wanted&&!current)info.textContent='Le micro mémorisé n’est plus disponible : mode automatique utilisé.';
    else info.textContent='Le choix sera utilisé à la prochaine connexion du micro Remote.';
  }
}

function installRemoteMicSelector(){
  const card=document.querySelector('.mic-card');
  const toggle=byId('remoteMicToggle');
  if(!card||!toggle||byId('remoteMicDevice'))return;
  const box=document.createElement('div');
  box.className='remote-mic-device-box';
  box.innerHTML=`<label for="remoteMicDevice">MICRO À UTILISER</label><div class="remote-mic-device-row"><select id="remoteMicDevice"><option value="">Automatique / micro système</option></select><button id="remoteMicDeviceRefresh" type="button">↻</button></div><div id="remoteMicDeviceInfo" class="muted">Choisis le micro du téléphone ou un micro Bluetooth s’il est proposé par iOS.</div>`;
  toggle.parentNode.insertBefore(box,toggle);
  const style=document.createElement('style');
  style.textContent='.remote-mic-device-box{margin:12px 0}.remote-mic-device-box>label{display:block;margin-bottom:6px;font-size:.72rem;font-weight:800;letter-spacing:.08em;color:#a9b7cf}.remote-mic-device-row{display:grid;grid-template-columns:1fr 44px;gap:8px}.remote-mic-device-row select,.remote-mic-device-row button{min-height:44px}.remote-mic-device-row button{padding:0}.remote-mic-device-box .muted{margin-top:6px;font-size:.76rem}';
  document.head.appendChild(style);
  byId('remoteMicDevice').addEventListener('change',e=>{
    const v=String(e.target.value||'');
    if(v)localStorage.setItem(MSR_REMOTE_MIC_DEVICE_KEY,v);else localStorage.removeItem(MSR_REMOTE_MIC_DEVICE_KEY);
    const info=byId('remoteMicDeviceInfo');
    if(info)info.textContent='Choix mémorisé. Coupe puis reconnecte le micro Remote s’il est déjà actif.';
  });
  byId('remoteMicDeviceRefresh').addEventListener('click',()=>refreshRemoteMicDevices());
  void refreshRemoteMicDevices();
}

function wrapGetUserMedia(){
  if(!navigator.mediaDevices?.getUserMedia||msrOriginalGetUserMedia)return;
  msrOriginalGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async function(constraints){
    let c=constraints;
    if(msrForceNextRemoteMic&&constraints?.audio){
      msrForceNextRemoteMic=false;
      const id=selectedDeviceId();
      if(id){
        const base=constraints.audio===true?{}:{...(constraints.audio||{})};
        c={...constraints,audio:{...base,deviceId:{exact:id}}};
      }
    }
    const stream=await msrOriginalGetUserMedia(c);
    setTimeout(()=>refreshRemoteMicDevices(),150);
    return stream;
  };
}

document.addEventListener('click',e=>{
  const b=e.target?.closest?.('#remoteMicToggle');
  if(!b)return;
  const state=String(byId('remoteMicState')?.textContent||'');
  if(state.includes('COUPÉ'))msrForceNextRemoteMic=true;
},true);

navigator.mediaDevices?.addEventListener?.('devicechange',()=>refreshRemoteMicDevices());
wrapGetUserMedia();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installRemoteMicSelector,{once:true});else installRemoteMicSelector();
window.addEventListener('msr-remote-paired',()=>setTimeout(refreshRemoteMicDevices,100));
