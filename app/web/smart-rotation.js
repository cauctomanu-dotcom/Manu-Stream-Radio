(()=>{
'use strict';
/*
  Smart rotation guard for the legacy V1.7 automation engine.
  The current engine selects one random candidate at every track change. This guard
  keeps a persistent shuffle bag so a new rotation does not restart with the same
  few titles in the same order. It is intentionally isolated from app.js so the
  legacy source can later be replaced without a risky full-file patch.
*/
const nativeFilter=Array.prototype.filter;
const nativeRandom=Math.random;
const key='msr-smart-rotation-bag-v1';
let state={queue:[],lastPicked:'',cycle:0};
try{state={...state,...JSON.parse(localStorage.getItem(key)||'{}')};if(!Array.isArray(state.queue))state.queue=[];}catch{}
function save(){try{localStorage.setItem(key,JSON.stringify(state));}catch{}}
function shuffled(ids){
  const a=[...ids];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(nativeRandom()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  if(a.length>1&&a[0]===state.lastPicked){const j=1+Math.floor(nativeRandom()*(a.length-1));[a[0],a[j]]=[a[j],a[0]];}
  return a;
}
function directRotationCaller(){
  const stack=String(new Error().stack||'');
  return stack.includes('auto24PlayRotation')&&!stack.includes('auto24RotationTracks');
}
Array.prototype.filter=function(...args){
  const result=nativeFilter.apply(this,args);
  if(!directRotationCaller()||result.length<2||!result.every(x=>x&&typeof x==='object'&&typeof x.id==='string'))return result;
  const ids=result.map(x=>x.id),allowed=new Set(ids);
  state.queue=nativeFilter.call(state.queue,id=>allowed.has(id));
  const missing=nativeFilter.call(ids,id=>!state.queue.includes(id));
  if(!state.queue.length){state.queue=shuffled(ids);state.cycle=(state.cycle||0)+1;}
  else if(missing.length){state.queue.push(...shuffled(missing));}
  const nextId=state.queue.find(id=>allowed.has(id));
  if(!nextId)return result;
  state.queue=nativeFilter.call(state.queue,id=>id!==nextId);state.lastPicked=nextId;save();
  const first=result.find(x=>x.id===nextId),rest=nativeFilter.call(result,x=>x.id!==nextId);
  return first?[first,...rest]:result;
};
Math.random=function(){
  if(directRotationCaller())return 0;
  return nativeRandom();
};
window.addEventListener('storage',e=>{if(e.key===key&&e.newValue){try{const n=JSON.parse(e.newValue);if(Array.isArray(n.queue))state=n;}catch{}}});
})();
