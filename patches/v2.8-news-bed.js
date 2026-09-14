/* MSR V2.8 — montage musique de fond sur Info/Météo, sans altérer la prise voix brute. */
const __v28BedKey=()=>`msr-news-bed-v28-${$('newsRecordType')?.value||'Info'}`;
function __v28BedRender(){
  const sel=$('newsBedTrack'),vol=$('newsBedVolume'),duck=$('newsBedDuck'),badge=$('newsBedVolumeVal');
  if(!sel||!vol||!duck)return;
  let cfg={};try{cfg=JSON.parse(localStorage.getItem(__v28BedKey())||'{}')||{}}catch{}
  const ms=tracks.filter(t=>trackCategory(t)==='Musique');
  sel.innerHTML='<option value="">Aucune musique de fond</option>'+ms.map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}${t.artist?' · '+escapeHtml(t.artist):''}</option>`).join('');
  if(ms.some(t=>t.id===cfg.id))sel.value=cfg.id;
  const v=Math.max(.02,Math.min(.40,Number(cfg.volume??.12)||.12));vol.value=String(v);duck.checked=cfg.duck!==false;
  if(badge)badge.textContent=`${Math.round(v*100)} %`;
}
function __v28BedCfg(){
  const c={id:$('newsBedTrack')?.value||'',volume:Math.max(.02,Math.min(.40,Number($('newsBedVolume')?.value||.12))),duck:$('newsBedDuck')?.checked!==false};
  try{localStorage.setItem(__v28BedKey(),JSON.stringify(c))}catch{}
  const badge=$('newsBedVolumeVal');if(badge)badge.textContent=`${Math.round(c.volume*100)} %`;
  return c;
}
function __v28VoiceRms(buffer,from,to){
  const n=Math.max(1,to-from);let sum=0;
  for(let c=0;c<buffer.numberOfChannels;c++){
    const d=buffer.getChannelData(c);let s=0;
    for(let i=from;i<to&&i<d.length;i++){const x=d[i]||0;s+=x*x;}
    sum+=Math.sqrt(s/n);
  }
  return sum/Math.max(1,buffer.numberOfChannels);
}
async function __v28RenderMix(raw){
  const jc=__v27JingleCfg(),bc=__v28BedCfg();
  const voice=await __v27Decode(raw);
  let jing=null,bed=null;
  if(jc.id&&jc.pos!=='none'){const t=await dbGet(jc.id);if(t?.blob)jing=await __v27Decode(t.blob);}
  if(bc.id){const t=await dbGet(bc.id);if(t?.blob)bed=await __v27Decode(t.blob);}
  if(!jing&&!bed)return{blob:raw,duration:voice.duration,mounted:false,bed:false,jingle:false};
  const before=!!jing&&(jc.pos==='before'||jc.pos==='both'),after=!!jing&&(jc.pos==='after'||jc.pos==='both'),gap=.06,sr=ctx.sampleRate;
  const voiceStart=before?jing.duration+gap:0;
  const total=voiceStart+voice.duration+(after?gap+jing.duration:0);
  const off=new OfflineAudioContext(2,Math.max(1,Math.ceil(total*sr)),sr);
  if(before){const s=off.createBufferSource(),g=off.createGain();s.buffer=jing;g.gain.value=.9;s.connect(g);g.connect(off.destination);s.start(0);}
  const vs=off.createBufferSource(),vg=off.createGain();vs.buffer=voice;vg.gain.value=1;vs.connect(vg);vg.connect(off.destination);vs.start(voiceStart);
  if(bed){
    const bg=off.createGain();bg.gain.value=bc.volume;bg.connect(off.destination);
    const step=.05,frames=Math.ceil(voice.duration/step);
    if(bc.duck){
      for(let k=0;k<=frames;k++){
        const t=Math.min(voice.duration,k*step),from=Math.floor(Math.max(0,t-step)*voice.sampleRate),to=Math.floor(Math.min(voice.duration,t)*voice.sampleRate);
        const rms=__v28VoiceRms(voice,from,to),factor=rms>.025?.48:1;
        bg.gain.setValueAtTime(bc.volume*factor,voiceStart+t);
      }
    }
    const fade=.22;
    bg.gain.setValueAtTime(0,voiceStart);
    bg.gain.linearRampToValueAtTime(bc.volume*(bc.duck?.48:1),voiceStart+Math.min(fade,voice.duration/3));
    const fadeOutAt=Math.max(voiceStart,voiceStart+voice.duration-fade);
    bg.gain.setValueAtTime(bc.volume*(bc.duck?.48:1),fadeOutAt);
    bg.gain.linearRampToValueAtTime(0,voiceStart+voice.duration);
    let at=voiceStart,remain=voice.duration;
    while(remain>.001){const bs=off.createBufferSource();bs.buffer=bed;bs.connect(bg);const play=Math.min(remain,bed.duration||remain);bs.start(at,0,play);at+=play;remain-=play;if(!bed.duration)break;}
  }
  if(after){const at=voiceStart+voice.duration+gap,s=off.createBufferSource(),g=off.createGain();s.buffer=jing;g.gain.value=.9;s.connect(g);g.connect(off.destination);s.start(at);}
  const rendered=await off.startRendering();
  return{blob:__v27Wav(rendered),duration:rendered.duration,mounted:true,bed:!!bed,jingle:!!jing};
}
__v27Mix=__v28RenderMix;
const __v28OldRender=__v27JingleRender;
__v27JingleRender=function(){__v28OldRender();__v28BedRender();};
__v27RemixPreview=async function(){
  if(!__v27NewsRaw)return;
  const token=++__v27MixSeq;$('newsRecStatus').textContent='Montage de la prise…';
  try{
    const r=await __v28RenderMix(__v27NewsRaw);if(token!==__v27MixSeq)return;
    if(newsRecordPreviewUrl)URL.revokeObjectURL(newsRecordPreviewUrl);newsRecordBlob=r.blob;newsRecordPreviewUrl=URL.createObjectURL(newsRecordBlob);$('newsRecPreview').src=newsRecordPreviewUrl;$('newsRecPreview').classList.remove('hidden');
    const parts=[];if(r.jingle)parts.push('jingle');if(r.bed)parts.push('musique de fond');
    $('newsRecStatus').textContent=`Prise voix conservée · ${parts.length?parts.join(' + ')+' monté'+(parts.length>1?'s':''):'sans habillage'} · ${fmt(r.duration)}`;$('newsRecSave').disabled=false;
  }catch(e){newsRecordBlob=__v27NewsRaw;$('newsRecStatus').textContent='Prise voix conservée · montage impossible';toast(`Montage : ${e.message}`,true);}
};
for(const id of['newsBedTrack','newsBedVolume','newsBedDuck'])$(id)?.addEventListener(id==='newsBedVolume'?'input':'change',()=>{__v28BedCfg();void __v27RemixPreview();});
