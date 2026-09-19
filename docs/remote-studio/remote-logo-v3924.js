/* Remote Studio V3.9.24 — identité visuelle de station pour favicon / icône iPhone. */
const R=()=>window.MSR_REMOTE||null;
let lastLogo='';
function setLink(rel,href,type=''){
  let el=document.querySelector(`link[rel="${rel}"]`);
  if(!el){el=document.createElement('link');el.rel=rel;document.head.appendChild(el)}
  if(type)el.type=type;el.href=href;
}
async function applyStationLogo(){
  const c=R()?.getClient?.(),st=R()?.getStation?.();if(!c||!st)return;
  try{
    const{data,error}=await c.from('radio_station_profile').select('station_name,logo_data_url').eq('station_id',st.id).maybeSingle();if(error)throw error;
    const logo=String(data?.logo_data_url||'').trim();if(!logo||logo===lastLogo)return;lastLogo=logo;
    setLink('icon',logo,'image/png');setLink('apple-touch-icon',logo,'image/png');
    const title=String(data?.station_name||st.name||'Manu Stream Radio').trim();document.title=`${title} — Remote Studio`;
    const h=document.querySelector('.topbar h1');if(h)h.textContent=`${title} · Remote`;
    let mark=document.getElementById('stationRemoteLogo');if(!mark){mark=document.createElement('img');mark.id='stationRemoteLogo';mark.alt='Logo de la station';mark.style.cssText='width:42px;height:42px;object-fit:contain;border-radius:10px;margin-right:10px;vertical-align:middle;background:#07101e;border:1px solid #2b3c58;padding:3px';const box=document.querySelector('.topbar>div:first-child');box?.prepend(mark)}mark.src=logo;
  }catch(e){console.warn('Logo Remote',e)}
}
window.addEventListener('msr-remote-paired',()=>setTimeout(applyStationLogo,150));
setInterval(()=>{if(R()?.getStation?.())void applyStationLogo()},5000);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(applyStationLogo,500),{once:true});else setTimeout(applyStationLogo,500);
void import('./remote-mic-device-v1.js?v=1').catch(e=>console.warn('Sélecteur micro Remote',e));
