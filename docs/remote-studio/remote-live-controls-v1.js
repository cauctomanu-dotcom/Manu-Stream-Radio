/* Manu Stream Remote Studio — commandes directes Remote / micros Studio.
   Ajoute des commandes visibles près du micro Remote sans modifier le Studio PC. */
const L$=id=>document.getElementById(id);
const LR=()=>window.MSR_REMOTE||null;
const LS=()=>LR()?.getState?.()||{};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
let lastChannelsKey='';

function normalTransport(v){
  const x=String(v||'').trim().toLowerCase().replace(/[_\s]+/g,'-');
  if(x.includes('cloud')&&x.includes('pcm'))return'Secours Cloud PCM';
  if(x.includes('webrtc'))return'WebRTC direct';
  if(x&&x!=='none'&&x!=='waiting'&&x!=='en-attente')return String(v);
  const fb=String(L$('v3917Fallback')?.textContent||'').toLowerCase();
  if(fb.includes('actif'))return'Secours Cloud PCM';
  return'En attente';
}
function micActive(){return !String(L$('remoteMicState')?.textContent||'').includes('COUPÉ')}
function setStatus(t,err=false){const e=L$('remoteLiveControlStatus');if(e){e.textContent=t;e.style.color=err?'#ff9a9a':''}}
async function send(action,payload={}){
  const r=LR();if(!r?.sendCommand)throw new Error('Remote non appairée.');
  return r.sendCommand(action,payload);
}
function install(){
  const card=document.querySelector('.mic-card');if(!card||L$('remoteLiveControlCard'))return false;
  const box=document.createElement('section');box.id='remoteLiveControlCard';box.className='remote-live-control-box';
  box.innerHTML=`<div class="remote-live-route"><div><b>REMOTE → ANTENNE</b><span id="remoteAirState">OFF</span></div><button id="remoteAirToggle" class="primary">METTRE À L’ANTENNE</button></div><div class="remote-live-sub">MICROS DU STUDIO</div><div id="remoteStudioMicList" class="remote-studio-mic-list"><div class="muted">Chargement…</div></div><div id="remoteLiveControlStatus" class="muted"></div>`;
  card.appendChild(box);
  const st=document.createElement('style');st.textContent='.remote-live-control-box{margin-top:12px;padding:10px;border:1px solid #314567;border-radius:12px;background:#08111f}.remote-live-route{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}.remote-live-route>div{display:grid;gap:2px}.remote-live-route span{font-size:.76rem;color:var(--muted)}.remote-live-sub{margin-top:12px;margin-bottom:6px;font-size:.72rem;font-weight:800;letter-spacing:.08em;color:#a9b7cf}.remote-studio-mic-list{display:grid;gap:6px}.remote-studio-mic-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid #26344f;border-radius:9px;padding:7px}.remote-studio-mic-row small{display:block;color:var(--muted);margin-top:2px}.remote-studio-mic-row button{min-height:36px;padding:5px 9px}.remote-live-control-box #remoteLiveControlStatus{margin-top:8px;font-size:.76rem}@media(max-width:430px){.remote-live-route{grid-template-columns:1fr}.remote-live-route button{width:100%}}';document.head.appendChild(st);
  L$('remoteAirToggle').onclick=()=>{const on=!!LS()?.runtime?.remoteAir;setStatus('Envoi de la commande…');send('remote_air_toggle',{on:!on}).then(()=>setStatus('Commande envoyée au Studio.')).catch(e=>setStatus(e?.message||String(e),true))};
  L$('remoteStudioMicList').onclick=e=>{const b=e.target.closest('button[data-mic-id]');if(!b)return;setStatus('Commande micro envoyée…');send('channel_toggle',{id:b.dataset.micId}).then(()=>setStatus('Micro Studio mis à jour.')).catch(x=>setStatus(x?.message||String(x),true))};
  return true;
}
function render(){
  const rt=LS()?.runtime||{};
  const t=L$('v3917Transport');if(t)t.textContent=normalTransport(rt.remoteTransport);
  const air=!!rt.remoteAir,as=L$('remoteAirState'),ab=L$('remoteAirToggle');
  if(as)as.textContent=air?'ON · envoyé au programme':'OFF · reçu au Master Remote seulement';
  if(ab){ab.textContent=air?'COUPER DE L’ANTENNE':'METTRE À L’ANTENNE';ab.classList.toggle('danger',air);ab.classList.toggle('primary',!air)}
  const channels=(Array.isArray(rt.channels)?rt.channels:[]).filter(c=>String(c.kind||'').toLowerCase()==='mic');
  const key=JSON.stringify(channels.map(c=>[c.id,c.name,c.label,c.on,c.gain]));
  const list=L$('remoteStudioMicList');
  if(list&&key!==lastChannelsKey){lastChannelsKey=key;list.innerHTML=channels.length?channels.map(c=>`<div class="remote-studio-mic-row"><div><b>${esc(c.name||c.label||'Micro Studio')}</b><small>${c.on?'OUVERT À L’ANTENNE':'FERMÉ'}</small></div><button data-mic-id="${esc(c.id)}" class="${c.on?'danger':'primary'}">${c.on?'FERMER':'OUVRIR'}</button></div>`).join(''):'<div class="muted">Aucun micro Studio déclaré.</div>'}
  /* Pendant un direct Remote, on coupe le retour iPhone pour éviter la boucle/écho. */
  const ret=L$('v3917ReturnAudio');
  if(micActive()&&ret&&!ret.paused){try{ret.pause()}catch{}}
  const rb=L$('v3917ReturnToggle');if(rb){rb.disabled=micActive();if(micActive())rb.title='Retour désactivé pendant le micro Remote pour éviter l’écho.';else rb.title=''}
  /* Stabilise l’étiquette source sur le périphérique réellement ouvert par notre sélecteur. */
  if(micActive()){
    const api=window.MSR_REMOTE_MIC_DEVICES,label=api?.lastRemoteLabel?.()||api?.selectedLabel?.('remote');
    if(label&&label!=='Automatique / micro système'){const s=L$('remoteMicSource');if(s)s.textContent=`Source : ${label}`}
  }
}
function init(){install();render();setInterval(()=>{install();render()},350)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.addEventListener('msr-remote-paired',()=>setTimeout(()=>{install();render()},120));
