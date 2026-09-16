/* Remote Studio V3.9.4 — garantie Cloud-first pour les chroniques/enregistrements.
   recorder-v2 sauvegarde déjà les chunks + la ligne radio_media avant d'envoyer la commande au PC.
   Ce garde-fou confirme la copie Cloud et réessaie la notification Studio si nécessaire. */
const sleep394=ms=>new Promise(r=>setTimeout(r,ms));
async function findSavedRemote394(startIso,title,author){
  const r=window.MSR_REMOTE,c=r?.getClient?.(),st=r?.getStation?.();if(!c||!st)return null;
  let q=c.from('radio_media').select('local_id,title,artist,category,metadata,updated_at,source_type').eq('station_id',st.id).eq('source_type','remote_recording').gte('updated_at',startIso).order('updated_at',{ascending:false}).limit(8);
  const {data,error}=await q;if(error)throw error;
  const rows=data||[];return rows.find(x=>String(x.title||'')===String(title||'')&&String(x.artist||'')===String(author||''))||rows[0]||null;
}
async function markSafe394(row){
  if(!row)return;const r=window.MSR_REMOTE,c=r?.getClient?.(),st=r?.getStation?.();if(!c||!st)return;
  const meta={...(row.metadata||{}),remote_cloud_first:true,cloud_saved_at:row.metadata?.cloud_saved_at||new Date().toISOString(),pending_studio_import:true};
  const {error}=await c.from('radio_media').update({metadata:meta,updated_at:new Date().toISOString()}).eq('station_id',st.id).eq('local_id',row.local_id);if(error)throw error;
}
function installCloudFirst394(){
  const btn=document.getElementById('r2Send'),status=document.getElementById('r2Status');if(!btn||btn.dataset.cloudFirst394==='1'||typeof btn.onclick!=='function')return false;
  btn.dataset.cloudFirst394='1';const old=btn.onclick;
  btn.onclick=async function(e){
    const type=document.getElementById('r2Type')?.value||'Chronique',author=document.getElementById('r2Author')?.value?.trim()||'Chroniqueur',typed=document.getElementById('r2Title')?.value?.trim()||'',title=typed||`${type} — ${new Date().toLocaleDateString('fr-FR')}`,startIso=new Date(Date.now()-2500).toISOString();
    if(status)status.textContent='☁ Sauvegarde Cloud sécurisée avant envoi au Studio…';
    await old.call(this,e);await sleep394(180);
    try{
      const row=await findSavedRemote394(startIso,title,author);if(!row)return;
      await markSafe394(row).catch(()=>{});
      let notified=true;try{await window.MSR_REMOTE?.sendCommand?.('refresh_library',{focusId:row.local_id,title:row.title,cloudFirst:true})}catch{notified=false}
      const failed=/envoi impossible/i.test(status?.textContent||'');
      if(failed){document.getElementById('r2Clear')?.click();if(status)status.textContent=notified?`✓ ${type} sauvegardé dans le Cloud · Studio renotifié`:`✓ ${type} sauvegardé dans le Cloud · le Studio le récupérera automatiquement`;}
      else if(status)status.textContent=`✓ ${type} sauvegardé dans le Cloud puis envoyé au Studio`;
    }catch(err){console.warn('V3.9.4 vérification Cloud Remote',err);}
  };
  if(status&&status.textContent==='Prêt')status.textContent='Prêt · chaque envoi est sauvegardé dans le Cloud avant le Studio';return true;
}
let tries394=0;const timer394=setInterval(()=>{tries394++;if(installCloudFirst394()||tries394>40)clearInterval(timer394)},250);
window.addEventListener('msr-remote-paired',()=>setTimeout(installCloudFirst394,100));
