#!/usr/bin/env python3
"""Build Manu Stream Radio V2.7 from the approved V2.6 Windows EXE.

Usage:
  python build_v27_from_v26.py Manu-Stream-Radio.exe Manu-Stream-Radio-V2.7.exe

The script keeps the V2.6 Go backend intact and only adds a new .msr27 PE
section containing the patched HTML/CSS/JS assets. The Go embed string
metadata is redirected to the new section, exactly like previous MSR patch
builds.
"""
from pathlib import Path
import argparse, hashlib, re, struct

APP_META=0x3ffd58
INDEX_META=0x3ffd88
STYLE_META=0x3ffde8
EXPECTED_V26_SHA256='3228ab782d9fe1bd7eec159ba3f9f124508d1a97c9734cd3a5b48e6a290d1638'

def align(v,a): return (v+a-1)//a*a

def pe_info(data):
    pe=struct.unpack_from('<I',data,0x3c)[0]
    if data[pe:pe+4]!=b'PE\0\0': raise ValueError('Not a PE executable')
    coff=pe+4; nsec=struct.unpack_from('<H',data,coff+2)[0]; opt_size=struct.unpack_from('<H',data,coff+16)[0]; opt=coff+20
    if struct.unpack_from('<H',data,opt)[0]!=0x20b: raise ValueError('Expected PE32+')
    image_base=struct.unpack_from('<Q',data,opt+24)[0]; sec_align=struct.unpack_from('<I',data,opt+32)[0]; file_align=struct.unpack_from('<I',data,opt+36)[0]; size_headers=struct.unpack_from('<I',data,opt+60)[0]; table=opt+opt_size
    sections=[]
    for i in range(nsec):
        o=table+i*40; name=bytes(data[o:o+8]).rstrip(b'\0').decode('ascii','replace'); vs,rva,rs,raw=struct.unpack_from('<IIII',data,o+8); sections.append((name,vs,rva,rs,raw))
    return pe,coff,opt,table,nsec,image_base,sec_align,file_align,size_headers,sections

def ptr_to_raw(ptr,image_base,sections):
    rva=ptr-image_base
    for name,vs,srva,rs,raw in sections:
        if srva<=rva<srva+max(vs,rs): return raw+(rva-srva)
    raise ValueError(f'Pointer {ptr:#x} not in a PE section')

def embedded(data,meta_off,image_base,sections):
    ptr,n=struct.unpack_from('<QQ',data,meta_off); raw=ptr_to_raw(ptr,image_base,sections); return bytes(data[raw:raw+n]).rstrip(b'\0')

def patch_assets(style,index,js):
    style=style.decode('utf-8').rstrip('\x00')
    index=index.decode('utf-8').rstrip('\x00')
    js=js.decode('utf-8').rstrip('\x00')
    if 'Manu Stream Radio V2.6' not in index: raise ValueError('The selected EXE is not the expected V2.6 UI')

    index=index.replace('Manu Stream Radio V2.6','Manu Stream Radio V2.7')
    index=index.replace('RÉGIE V2.6 ·','RÉGIE V2.7 ·')
    index=index.replace('/style.css?v=2.6','/style.css?v=2.7')
    index=index.replace('/app.js?v=2.2','/app.js?v=2.7')
    index=index.replace('Mélanger les rotations musicales','Aléatoire intelligent · anti-répétition 2 h')
    old='<label class="recorder-wide">TITRE<input class="input" id="newsRecordTitle"/></label>\n</div>'
    new='<label class="recorder-wide">TITRE<input class="input" id="newsRecordTitle"/></label>\n<label class="recorder-wide">JINGLE<select class="input" id="newsJingleTrack"><option value="">Aucun jingle</option></select></label>\n<label>POSITION<select class="input" id="newsJinglePosition"><option value="before">Avant ma voix</option><option value="after">Après ma voix</option><option value="both">Avant + après</option><option value="none">Aucun</option></select></label>\n</div>'
    if old not in index: raise ValueError('Recorder markup not found in V2.6')
    index=index.replace(old,new,1)
    index=index.replace('<section><span class="step">7</span><h3>Mises à jour automatiques</h3><p>À partir de la V1.8, lance toujours <b>Manu-Stream-Radio.exe</b>. Le lanceur vérifie GitHub au démarrage, télécharge une nouvelle version si elle existe puis ouvre la régie. Tes données restent dans le profil local de la régie.</p></section>','<section><span class="step">7</span><h3>Mises à jour</h3><p><b>Aucune mise à jour automatique.</b> Les nouvelles versions seront fournies en ZIP et remplacées manuellement.</p></section>',1)
    index=index.replace('<section><span class="step">8</span><h3>Auto 24H</h3><p>Prépare les heures fixes et la rotation musicale, coche <b>Activer l’automation 24H</b> puis clique sur <b>ARMER / APPLIQUER</b>. Laisse l’application et le PC allumés ; les programmes fixes coupent la rotation puis celle-ci reprend automatiquement.</p></section>','<section><span class="step">8</span><h3>Auto 24H</h3><p>Les rotations utilisent un ordre aléatoire différent et évitent, si possible, toute musique déjà jouée dans les <b>2 dernières heures</b>. S’il n’existe plus d’autre choix, la régie reprend d’abord le titre joué depuis le plus longtemps.</p></section>',1)
    index=re.sub(r'>\s+<','><',index); index=re.sub(r'\n\s*','',index)
    style=re.sub(r'/\*.*?\*/','',style,flags=re.S); style=re.sub(r'\s*\n\s*','',style)
    js=js.replace("document.title='Manu Stream Radio V2.6 — Programmation 7J/24H'","document.title='Manu Stream Radio V2.7 — Programmation 7J/24H'")

    patch=r''';const __v27RotKey='msr-smart-rotation-v27';let __v27Rot={bags:{},history:[],lastOrder:[]};try{__v27Rot={...__v27Rot,...JSON.parse(localStorage.getItem(__v27RotKey)||'{}')}}catch{}if(!__v27Rot.bags||typeof __v27Rot.bags!=='object')__v27Rot.bags={};if(!Array.isArray(__v27Rot.history))__v27Rot.history=[];if(!Array.isArray(__v27Rot.lastOrder))__v27Rot.lastOrder=[];function __v27RotSave(){try{localStorage.setItem(__v27RotKey,JSON.stringify(__v27Rot))}catch{}}function __v27RotPrune(){const n=Date.now(),cut=n-7200000;__v27Rot.history=__v27Rot.history.filter(x=>x&&x.id&&Number(x.at)>cut);const day=auto24DayKey();for(const k of Object.keys(__v27Rot.bags))if(!k.startsWith(day+'|'))delete __v27Rot.bags[k]}function __v27Mark(id){if(!id)return;__v27RotPrune();__v27Rot.history.push({id,at:Date.now()});if(__v27Rot.history.length>500)__v27Rot.history=__v27Rot.history.slice(-500);__v27RotSave()}function __v27Shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}function __v27Pick(it,list){__v27RotPrune();const recent=new Set(__v27Rot.history.map(x=>x.id));let pool=list.filter(t=>!recent.has(t.id));if(!pool.length){const last={};for(const h of __v27Rot.history)last[h.id]=h.at;pool=list.filter(t=>t.id!==auto24LastTrack);if(!pool.length)pool=[...list];pool.sort((a,b)=>(last[a.id]||0)-(last[b.id]||0))}if(auto24Cfg.shuffle===false)return pool[0];const key=auto24DayKey()+'|'+(it?.id||'rotation'),ok=new Set(pool.map(t=>t.id));let bag=Array.isArray(__v27Rot.bags[key])?__v27Rot.bags[key].filter(id=>ok.has(id)):[];if(!bag.length){bag=__v27Shuffle(pool.map(t=>t.id));if(bag.length>1&&bag.join('|')===__v27Rot.lastOrder.join('|'))bag.push(bag.shift());if(bag.length>1&&bag[0]===auto24LastTrack)[bag[0],bag[1]]=[bag[1],bag[0]];__v27Rot.lastOrder=[...bag]}const id=bag.shift();__v27Rot.bags[key]=bag;__v27RotSave();return list.find(t=>t.id===id)||pool[0]}auto24PlayRotation=async function(it=null){if(!auto24Armed)return;const list=auto24RotationTracks();if(!list.length){toast('Programmation : aucune musique de rotation.',true);return}const t=__v27Pick(it,list);if(!t)return;auto24LastTrack=t.id;__v27Mark(t.id);auto24Mode='rotation';rundownIndex=null;await playProgram(t);auto24ShowNow(t,'ROTATION · ALÉATOIRE 2H',it);await setOverlayArtwork(t.artwork);await syncSceneForType('Musique')};const __v27Fixed=auto24PlayFixed;auto24PlayFixed=async function(it,offsetSeconds=0){const r=await __v27Fixed(it,offsetSeconds);if(it?.kind==='track'&&it.trackId)__v27Mark(it.trackId);return r};let __v27NewsRaw=null,__v27MixSeq=0;const __v27Reset=resetNewsTake;resetNewsTake=function(){__v27NewsRaw=null;return __v27Reset()};function __v27JingleKey(){return'msr-news-jingle-v27-'+($('newsRecordType')?.value||'Info')}function __v27JingleRender(){const sel=$('newsJingleTrack'),pos=$('newsJinglePosition');if(!sel||!pos)return;const cfg=(()=>{try{return JSON.parse(localStorage.getItem(__v27JingleKey())||'{}')}catch{return{}}})();const list=tracks.filter(t=>trackCategory(t)==='Jingle');sel.innerHTML='<option value="">Aucun jingle</option>'+list.map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}${t.artist?' · '+escapeHtml(t.artist):''}</option>`).join('');if(list.some(t=>t.id===cfg.id))sel.value=cfg.id;pos.value=['before','after','both','none'].includes(cfg.pos)?cfg.pos:(sel.value?'before':'none')}function __v27JingleCfg(){const c={id:$('newsJingleTrack')?.value||'',pos:$('newsJinglePosition')?.value||'none'};try{localStorage.setItem(__v27JingleKey(),JSON.stringify(c))}catch{}return c}async function __v27Decode(blob){ensureAudio();return ctx.decodeAudioData((await blob.arrayBuffer()).slice(0))}function __v27Wav(b){const ch=Math.min(2,b.numberOfChannels),n=b.length,rate=b.sampleRate,ba=ch*2,ab=new ArrayBuffer(44+n*ba),v=new DataView(ab);let p=0;const w=s=>{for(let i=0;i<s.length;i++)v.setUint8(p++,s.charCodeAt(i))};w('RIFF');v.setUint32(p,36+n*ba,true);p+=4;w('WAVE');w('fmt ');v.setUint32(p,16,true);p+=4;v.setUint16(p,1,true);p+=2;v.setUint16(p,ch,true);p+=2;v.setUint32(p,rate,true);p+=4;v.setUint32(p,rate*ba,true);p+=4;v.setUint16(p,ba,true);p+=2;v.setUint16(p,16,true);p+=2;w('data');v.setUint32(p,n*ba,true);p+=4;const a=[];for(let c=0;c<ch;c++)a.push(b.getChannelData(c));for(let i=0;i<n;i++)for(let c=0;c<ch;c++){let x=Math.max(-1,Math.min(1,a[c][i]||0));v.setInt16(p,x<0?x*32768:x*32767,true);p+=2}return new Blob([ab],{type:'audio/wav'})}async function __v27Mix(raw){const c=__v27JingleCfg();if(!c.id||c.pos==='none')return{blob:raw,duration:await mediaDuration(raw),mounted:false};const t=await dbGet(c.id);if(!t?.blob)return{blob:raw,duration:await mediaDuration(raw),mounted:false};const [voice,jing]=await Promise.all([__v27Decode(raw),__v27Decode(t.blob)]),seq=c.pos==='before'?[jing,voice]:c.pos==='after'?[voice,jing]:[jing,voice,jing],gap=.06,sr=ctx.sampleRate,total=seq.reduce((n,x)=>n+x.duration,0)+gap*(seq.length-1),off=new OfflineAudioContext(2,Math.ceil(total*sr),sr);let at=0;for(const x of seq){const s=off.createBufferSource(),gain=off.createGain();s.buffer=x;gain.gain.value=x===jing?.9:1;s.connect(gain);gain.connect(off.destination);s.start(at);at+=x.duration+gap}const r=await off.startRendering();return{blob:__v27Wav(r),duration:r.duration,mounted:true}}async function __v27RemixPreview(){if(!__v27NewsRaw)return;const token=++__v27MixSeq;$('newsRecStatus').textContent='Montage du jingle…';try{const r=await __v27Mix(__v27NewsRaw);if(token!==__v27MixSeq)return;if(newsRecordPreviewUrl)URL.revokeObjectURL(newsRecordPreviewUrl);newsRecordBlob=r.blob;newsRecordPreviewUrl=URL.createObjectURL(newsRecordBlob);$('newsRecPreview').src=newsRecordPreviewUrl;$('newsRecPreview').classList.remove('hidden');$('newsRecStatus').textContent=`Prise prête${r.mounted?' · jingle monté':''} · ${fmt(r.duration)}`;$('newsRecSave').disabled=false}catch(e){newsRecordBlob=__v27NewsRaw;$('newsRecStatus').textContent='Prise prête · montage impossible';toast(`Montage jingle : ${e.message}`,true)}}const __v27Start=startNewsRecording;startNewsRecording=async function(){await __v27Start();if(newsRecorder){const old=newsRecorder.onstop;newsRecorder.onstop=async e=>{await old?.call(newsRecorder,e);__v27NewsRaw=newsRecordBlob;await __v27RemixPreview()}}};saveNewsRecording=async function(){if(!newsRecordBlob)return;const category=$('newsRecordType').value,title=$('newsRecordTitle').value.trim()||defaultNewsTitle(category),duration=await mediaDuration(newsRecordBlob),now=Date.now(),wav=newsRecordBlob.type==='audio/wav';await dbPut({id:uid(),name:`${category}-${now}.${wav?'wav':'webm'}`,title,artist:'Manu Stream Radio',duration,size:newsRecordBlob.size,added:now,recordedAt:now,recordedDay:localDayKey(new Date(now)),blob:newsRecordBlob,artwork:null,category});rememberCategory(category);$('newsRecorderDialog').close();resetNewsTake();await reloadLibrary();toast(`${category} enregistré${wav?' avec jingle monté':''} dans la bibliothèque.`)};const __v27OpenNews=$('recordNewsBtn').onclick;$('recordNewsBtn').onclick=async function(e){await __v27OpenNews?.call(this,e);__v27JingleRender()};const __v27Type=$('newsRecordType').onchange;$('newsRecordType').onchange=function(e){__v27Type?.call(this,e);__v27JingleRender()};for(const id of['newsJingleTrack','newsJinglePosition'])$(id)?.addEventListener('change',()=>{__v27JingleCfg();void __v27RemixPreview()});'''
    marker='})();})();'; pos=js.rfind(marker)
    if pos<0: raise ValueError('V2.6 outer JS closure not found')
    js=js[:pos+5]+patch+js[pos+5:]
    return style.encode(),index.encode(),js.encode()

def build(src,dst):
    data=bytearray(Path(src).read_bytes()); digest=hashlib.sha256(data).hexdigest(); print('Input SHA256:',digest)
    if digest!=EXPECTED_V26_SHA256: raise ValueError('Input EXE does not match the approved V2.6 binary')
    pe,coff,opt,table,nsec,image_base,sec_align,file_align,size_headers,sections=pe_info(data)
    style,index,js=patch_assets(embedded(data,STYLE_META,image_base,sections),embedded(data,INDEX_META,image_base,sections),embedded(data,APP_META,image_base,sections))
    assets=[('style',style+b'\n',STYLE_META),('index',index+b'\n',INDEX_META),('app',js+b' ',APP_META)]
    new_header=table+nsec*40
    if new_header+40>size_headers: raise ValueError('No room for another PE section header')
    raw_ptr=align(len(data),file_align)
    if raw_ptr>len(data): data+=b'\0'*(raw_ptr-len(data))
    new_rva=align(struct.unpack_from('<I',data,opt+56)[0],sec_align)
    payload=bytearray(); meta=[]
    for name,blob,off in assets:
        rel=align(len(payload),16)
        if rel>len(payload): payload+=b'\0'*(rel-len(payload))
        payload+=blob; meta.append((name,rel,len(blob),off))
    virt=len(payload); raw_size=align(virt,file_align); data+=payload
    if raw_size>virt: data+=b'\0'*(raw_size-virt)
    hdr=struct.pack('<8sIIIIIIHHI',b'.msr27\0\0',virt,new_rva,raw_size,raw_ptr,0,0,0,0,0x40000040)
    data[new_header:new_header+40]=hdr; struct.pack_into('<H',data,coff+2,nsec+1); struct.pack_into('<I',data,opt+56,align(new_rva+virt,sec_align))
    for name,rel,n,off in meta:
        struct.pack_into('<Q',data,off,image_base+new_rva+rel); struct.pack_into('<Q',data,off+8,n)
    Path(dst).write_bytes(data); print('Output SHA256:',hashlib.sha256(data).hexdigest()); print('Built',dst)

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('v26_exe'); ap.add_argument('v27_exe'); a=ap.parse_args(); build(a.v26_exe,a.v27_exe)
