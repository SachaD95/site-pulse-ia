const app = document.getElementById('app');
const params = new URLSearchParams(location.search);
let mode = params.get('mode');
let sessionId = params.get('session');
let presenterKey = params.get('key') || '';
let definitions = {};
let state = null;
let meta = { networkOrigins: [] };
let eventSource = null;
let timerTick = null;
let selected = {};
let submitted = {};
let anonId = null;
let seenCloudKeys = new Set();
let cloudResizeBound = false;
let activeSessionSource = null;
let switchingActiveSession = false;

const slideTitles = [
  'Removall & AI',
  'What comes to mind when you think about AI?',
  'Weekly time saved with AI',
  'Will AI find the right delivery date?',
  'This presentation was generated with AI'
];

const slideInteraction = {
  1: 'associations',
  2: 'timeSaved',
  3: 'retrievalCheck'
};

function esc(v='') {
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function pct(count,total){ return total ? Math.round((count/total)*100) : 0; }
function getAnonId(sid){
  const key=`aiPulseAnonId:${sid||'session'}`;
  let id=localStorage.getItem(key);
  if(!id){ id=crypto.randomUUID ? crypto.randomUUID() : `anon-${Math.random().toString(36).slice(2)}`; localStorage.setItem(key,id); }
  return id;
}
function publicOrigin(){
  const override=localStorage.getItem('aiPulsePublicBase');
  if(override) return override.replace(/\/$/,'');
  if(['localhost','127.0.0.1'].includes(location.hostname) && meta.networkOrigins?.length) return meta.networkOrigins[0];
  return location.origin;
}
function participantUrl(){ return `${publicOrigin()}/join/${encodeURIComponent(sessionId)}`; }
function displayUrl(){ return `${publicOrigin()}/?mode=display`; }
async function api(path,options={}){
  const res=await fetch(path,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  if(!res.ok){ let msg='Request failed'; try{msg=(await res.json()).error||msg;}catch{} throw new Error(msg); }
  const type=res.headers.get('content-type')||'';
  return type.includes('application/json') ? res.json() : res.text();
}
function toast(message){
  document.querySelector('.toast')?.remove();
  const el=document.createElement('div'); el.className='toast'; el.textContent=message; document.body.appendChild(el); setTimeout(()=>el.remove(),2200);
}

async function init(){
  meta=await api('/api/meta').catch(()=>({networkOrigins:[]}));
  // Display is intentionally session-agnostic: it always follows the presenter session
  // currently marked active by the server, even if an old ?session=... remains in the URL.
  if(mode==='display'){
    const active=await api('/api/active-session').catch(()=>({id:null}));
    sessionId=active.id||null;
  } else if(!sessionId){
    const list=await api('/api/sessions').catch(()=>[]);
    sessionId=list[0]?.id||null;
  }
  if(!sessionId){ renderNoSession(); if(mode==='display') connectActiveSessionEvents(); return; }
  anonId=getAnonId(sessionId);
  if(!mode){ renderRoleGate(); return; }
  definitions=await api(`/api/session/${encodeURIComponent(sessionId)}/definitions`);
  await refreshState();
  if(params.get('snapshot')!=='1') connectEvents();
  if(mode==='display') connectActiveSessionEvents();
  setInterval(heartbeat,25000);
  heartbeat();
  if(mode==='presenter') bindKeyboard();
  if(mode==='display') bindDisplayKeyboard();
}

async function switchToActiveSession(nextId){
  if(!nextId || nextId===sessionId || switchingActiveSession) return;
  switchingActiveSession=true;
  try{
    eventSource?.close();
    sessionId=nextId;
    anonId=getAnonId(sessionId);
    definitions=await api(`/api/session/${encodeURIComponent(sessionId)}/definitions`);
    await refreshState();
    connectEvents();
  }catch(e){ console.warn('Unable to switch display session',e); }
  finally{ switchingActiveSession=false; }
}
function connectActiveSessionEvents(){
  if(activeSessionSource) activeSessionSource.close();
  activeSessionSource=new EventSource('/api/active-events');
  activeSessionSource.addEventListener('active',e=>{
    const data=JSON.parse(e.data||'{}');
    if(data.id) switchToActiveSession(data.id);
  });
}

function renderRoleGate(){
  app.innerHTML=`<main class="app-shell"><section class="role-gate corporate-role-gate">
    <div class="eyebrow">AI Pulse · Interactive workshop</div>
    <h1>A presentation designed<br>to involve the room.</h1>
    <p>Choose your view. Presenter mode controls the workshop, participant mode shows the active question, and display mode mirrors the live presentation without controls.</p>
    <div class="role-actions three-role-actions">
      <button class="btn primary" id="joinParticipant">Join as participant</button>
      <button class="btn secondary" id="joinPresenter">Open presenter mode</button>
      <button class="btn secondary" id="joinDisplay">Open display mode</button>
    </div>
  </section></main>`;
  document.getElementById('joinParticipant').onclick=()=>location.href=`/?mode=participant&session=${encodeURIComponent(sessionId)}`;
  document.getElementById('joinDisplay').onclick=()=>location.href='/?mode=display';
  document.getElementById('joinPresenter').onclick=()=>{
    const key=prompt('Presenter key (shown in the server terminal):');
    if(key) location.href=`/?mode=presenter&session=${encodeURIComponent(sessionId)}&key=${encodeURIComponent(key)}`;
  };
}
function renderNoSession(){
  app.innerHTML=`<main class="app-shell"><section class="role-gate"><div class="eyebrow">AI Pulse</div><h1>No active session.</h1><p>Start the server and create a session first.</p></section></main>`;
}
async function refreshState(){
  const q=mode==='presenter'?`?key=${encodeURIComponent(presenterKey)}`:'';
  state=await api(`/api/session/${encodeURIComponent(sessionId)}${q}`);
  if(mode==='presenter' && !state.presenterKey){
    app.innerHTML=`<main class="app-shell"><section class="role-gate"><div class="eyebrow">Presenter access</div><h1>Presenter key required.</h1><p>Use the presenter URL printed by the server.</p></section></main>`;
    return;
  }
  render();
}
function connectEvents(){
  if(eventSource) eventSource.close();
  const q=mode==='presenter'?`?key=${encodeURIComponent(presenterKey)}`:'';
  eventSource=new EventSource(`/api/session/${encodeURIComponent(sessionId)}/events${q}`);
  eventSource.addEventListener('state',e=>{state=JSON.parse(e.data);render();});
  eventSource.addEventListener('presence',e=>{if(state){state.participantCount=JSON.parse(e.data).participantCount;renderLight();}});
  eventSource.addEventListener('reaction',e=>{if(mode==='presenter'||mode==='display') showReaction(JSON.parse(e.data).emoji);});
}
function heartbeat(){
  if(!sessionId) return;
  api(`/api/session/${encodeURIComponent(sessionId)}/heartbeat`,{method:'POST',body:JSON.stringify({anonId,role:mode,key:mode==='presenter'?presenterKey:''})}).catch(()=>{});
}
function render(){ if(!state) return; if(mode==='presenter') renderPresenter(); else if(mode==='display') renderDisplay(); else renderParticipant(); }
function renderLight(){ const el=document.querySelector('[data-participants]'); if(el) el.textContent=state.participantCount; }
function bindKeyboard(){
  document.addEventListener('keydown',e=>{
    if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){e.preventDefault();changeSlide(1);}
    if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();changeSlide(-1);}
    if(e.key.toLowerCase()==='f') toggleFullscreen();
  });
}
async function presenterAction(payload){
  try{ await api(`/api/session/${encodeURIComponent(sessionId)}/action?key=${encodeURIComponent(presenterKey)}`,{method:'POST',body:JSON.stringify({...payload,key:presenterKey})}); }
  catch(e){toast(e.message);}
}
function changeSlide(delta){presenterAction({type:'setSlide',slideIndex:state.slideIndex+delta});}
function goSlide(i){presenterAction({type:'setSlide',slideIndex:i});}
function toggleFullscreen(){if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.();}
function bindDisplayKeyboard(){
  document.addEventListener('keydown',e=>{
    if(e.key.toLowerCase()==='f') toggleFullscreen();
  });
}
function renderDisplay(){
  app.innerHTML=`<main class="display-layout"><section class="display-stage-wrap"><div class="stage display-stage" id="stage">
    ${state.demoLoaded?'<div class="demo-banner">DEMO DATA · FICTIONAL</div>':''}
    ${renderTimer()}
    ${renderSlide(state.slideIndex)}
    <div class="stage-footer"><span>${state.slideIndex+1}/${slideTitles.length}</span><div class="progress"><i style="width:${((state.slideIndex+1)/slideTitles.length)*100}%"></i></div><span>${esc(slideTitles[state.slideIndex])}</span></div>
  </div></section></main>`;
  setupQr(); startTimerLoop(); requestAnimationFrame(layoutWordCloud);
}

function renderPresenter(){
  app.innerHTML=`<main class="presenter-layout">
    <section class="stage-wrap"><div class="stage" id="stage">
      ${state.demoLoaded?'<div class="demo-banner">DEMO DATA · FICTIONAL</div>':''}
      ${renderTimer()}
      ${renderSlide(state.slideIndex)}
      <div class="stage-nav"><button class="btn icon" id="prevSlide" aria-label="Previous">←</button><button class="btn icon" id="nextSlide" aria-label="Next">→</button></div>
      <div class="stage-footer"><span>${state.slideIndex+1}/${slideTitles.length}</span><div class="progress"><i style="width:${((state.slideIndex+1)/slideTitles.length)*100}%"></i></div><span>${esc(slideTitles[state.slideIndex])}</span></div>
    </div></section>
    ${renderPresenterPanel()}
  </main>`;
  document.getElementById('prevSlide').onclick=()=>changeSlide(-1);
  document.getElementById('nextSlide').onclick=()=>changeSlide(1);
  bindSlideEvents(); bindPanelEvents(); setupQr(); startTimerLoop(); requestAnimationFrame(layoutWordCloud);
}
function renderPresenterPanel(){
  const iid=slideInteraction[state.slideIndex];
  const interactive=Boolean(iid);
  const open=state.activeInteraction===iid&&state.interactionOpen;
  const results=state.activeInteraction===iid&&state.showResults;
  return `<aside class="presenter-panel">
    <div class="panel-head"><strong>Presenter controls</strong><span><i class="status-dot"></i>Live</span></div>
    <div class="panel-section"><div class="panel-label">Session</div><div class="session-chip">${esc(sessionId)}</div><div class="panel-metric"><span>Active participants</span><b data-participants>${state.participantCount}</b></div><div class="panel-grid"><button class="btn small" id="copyJoin">Copy join link</button><button class="btn small" id="configQr">QR URL</button></div></div>
    <div class="panel-section"><div class="panel-label">Navigation</div><div class="panel-grid"><button class="btn small" id="panelPrev">← Previous</button><button class="btn small" id="panelNext">Next →</button></div><div class="panel-grid" style="margin-top:8px"><button class="btn small" id="fullscreen">Fullscreen</button><button class="btn small" id="openParticipant">Mobile view</button></div><button class="btn small" id="openDisplay" style="width:100%;margin-top:8px">Open display view</button></div>
    <div class="panel-section"><div class="panel-label">Slide interaction</div>${interactive?`<div class="panel-grid"><button class="btn ${open?'secondary':'primary'} small" id="openInteraction">${open?'Keep open':'Open'}</button><button class="btn small" id="closeInteraction" ${!open?'disabled':''}>Close</button></div><button class="btn small" style="width:100%;margin-top:8px" id="toggleResults">${results?'Hide results':'Show results'}</button>`:'<p style="color:var(--muted);font-size:13px">No participant input on this slide.</p>'}</div>
    <div class="panel-section"><div class="panel-label">Timer</div><div class="panel-grid"><button class="btn small" data-timer="30">30 sec</button><button class="btn small" data-timer="60">60 sec</button></div><button class="btn small" id="stopTimer" style="width:100%;margin-top:8px">Stop</button></div>
    <div class="panel-section"><div class="panel-label">Data</div><div class="panel-grid"><button class="btn small" id="demoData">Load demo</button><button class="btn small" id="exportCsv">Export CSV</button></div><button class="btn danger small" id="resetSession" style="width:100%;margin-top:8px">Reset session</button><button class="btn small" id="newSession" style="width:100%;margin-top:8px">Create new session</button></div>
  </aside>`;
}
function bindPanelEvents(){
  const iid=slideInteraction[state.slideIndex];
  document.getElementById('panelPrev').onclick=()=>changeSlide(-1);
  document.getElementById('panelNext').onclick=()=>changeSlide(1);
  document.getElementById('fullscreen').onclick=toggleFullscreen;
  document.getElementById('copyJoin').onclick=async()=>{await navigator.clipboard?.writeText(participantUrl());toast('Participant link copied');};
  document.getElementById('configQr').onclick=()=>{const value=prompt('Public/network address to use in the QR code:',publicOrigin());if(value){localStorage.setItem('aiPulsePublicBase',value.trim().replace(/\/$/,''));render();toast('QR URL updated');}};
  document.getElementById('openParticipant').onclick=()=>window.open(participantUrl(),'_blank');
  document.getElementById('openDisplay').onclick=()=>window.open(displayUrl(),'_blank');
  document.getElementById('openInteraction')?.addEventListener('click',()=>presenterAction({type:'openInteraction',interactionId:iid}));
  document.getElementById('closeInteraction')?.addEventListener('click',()=>presenterAction({type:'closeInteraction'}));
  document.getElementById('toggleResults')?.addEventListener('click',()=>presenterAction({type:'toggleResults',show:!(state.activeInteraction===iid&&state.showResults)}));
  document.querySelectorAll('[data-timer]').forEach(b=>b.onclick=()=>presenterAction({type:'startTimer',seconds:Number(b.dataset.timer)}));
  document.getElementById('stopTimer').onclick=()=>presenterAction({type:'stopTimer'});
  document.getElementById('demoData').onclick=()=>presenterAction({type:'loadDemo'});
  document.getElementById('exportCsv').onclick=()=>window.open(`/api/session/${encodeURIComponent(sessionId)}/export.csv?key=${encodeURIComponent(presenterKey)}`,'_blank');
  document.getElementById('resetSession').onclick=()=>{if(confirm('Reset every response in this session?'))presenterAction({type:'reset'});};
  document.getElementById('newSession').onclick=createNewSession;
}
async function createNewSession(){
  try{const base=`AI-${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;const r=await api('/api/sessions',{method:'POST',body:JSON.stringify({id:base})});location.href=`/?mode=presenter&session=${encodeURIComponent(r.id)}&key=${encodeURIComponent(r.presenterKey)}`;}catch(e){toast(e.message);}
}
function renderTimer(){if(!state.timerEndsAt)return'';const sec=Math.max(0,Math.ceil((state.timerEndsAt-Date.now())/1000));return`<div class="timer-overlay" id="timerOverlay">${sec}s</div>`;}
function startTimerLoop(){clearInterval(timerTick);if(!state.timerEndsAt)return;timerTick=setInterval(()=>{const el=document.getElementById('timerOverlay');if(!el){clearInterval(timerTick);return;}const sec=Math.max(0,Math.ceil((state.timerEndsAt-Date.now())/1000));el.textContent=`${sec}s`;if(sec<=0)clearInterval(timerTick);},250);}

function renderSlide(i){
  const renderers=[slideIntro,slideWordCloud,slideWeeklyTime,slideRetrieval,slideSourceDocument];
  return renderers[i]?.()||'';
}
function brandMark(){return`<div class="brand-lockup brand-lockup-v12"><img src="/assets/removall-logo.png" alt="Removall Carbon"></div>`;}
function slideIntro(){
  return `<article class="slide title-slide-v11"><div class="brand-top">${brandMark()}</div><div class="hero-grid title-hero-v11"><div><div class="eyebrow">AI BREAKFAST - Pôle Inno</div><h1>Removall & AI:<br><span>Moving forward</span></h1><div class="title-pill-row"><span>Discussion</span><span>Strategy</span><span>Training</span></div></div><div class="qr-card light-card"><div class="qr-box" id="qrcode"></div><strong>Join the session</strong><small>${esc(sessionId)}</small><div class="hero-mini-tags"><span>Live</span><span>Interactive</span><span>AI</span></div></div></div></article>`;
}

function normalizeWordPart(word){
  let w=String(word||'').toLowerCase().trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g,'');
  if(w.length>4 && w.endsWith('ies')) w=w.slice(0,-3)+'y';
  else if(w.length>3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w=w.slice(0,-1);
  return w;
}
function normalizeCloudPhrase(value){
  return String(value||'').trim().toLowerCase().replace(/\s+/g,' ').split(' ').map(normalizeWordPart).filter(Boolean).join(' ');
}
function titleCasePhrase(value){return String(value||'').replace(/\b\w/g,c=>c.toUpperCase());}
function cloudData(){
  const map=new Map();
  for(const idea of state.ideas||[]){
    const key=normalizeCloudPhrase(idea.text);
    if(!key)continue;
    const current=map.get(key)||{key,label:key,count:0};
    current.count+=1; map.set(key,current);
  }
  return [...map.values()].sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));
}
const cloudPalette=['#DCE7FF','#DDF6E8','#FFE6D8','#FFF1B8','#EADFFF','#DFF7F4','#FDE2ED','#E9F0FF','#E3F6D9','#FFEAD0'];
function cloudColor(key){let h=0;for(const c of key)h=((h<<5)-h+c.charCodeAt(0))|0;return cloudPalette[Math.abs(h)%cloudPalette.length];}
function renderWordCloud(){
  const items=cloudData();
  if(!items.length)return'<div class="word-cloud-live empty"><div class="cloud-empty-copy">Waiting for the first word…</div></div>';
  return `<div class="word-cloud-live">${items.map(item=>{
    // Logical font size. layoutWordCloud scales it with the cloud canvas, so browser zoom
    // changes the whole composition instead of changing the relative geometry.
    const logicalSize=22+Math.min(40,Math.max(0,item.count-1)*6);
    const isNew=!seenCloudKeys.has(item.key);
    seenCloudKeys.add(item.key);
    return `<span class="word-bubble ${isNew?'new-word':''}" data-cloud-key="${esc(item.key)}" data-count="${item.count}" data-logical-size="${logicalSize}" style="--bubble:${cloudColor(item.key)};">${esc(item.label)}${item.count>1?`<b class="word-count">×${item.count}</b>`:''}</span>`;
  }).join('')}</div>`;
}
function cloudHash(value){let h=2166136261;for(const ch of String(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function layoutWordCloud(){
  const cloud=document.querySelector('.word-cloud-live');
  if(!cloud||cloud.classList.contains('empty'))return;
  const bubbles=[...cloud.querySelectorAll('.word-bubble')];
  if(!bubbles.length)return;
  const rect=cloud.getBoundingClientRect();
  if(rect.width<80||rect.height<80)return;

  // Fixed logical canvas = stable composition at 67%, 80%, 100% or fullscreen.
  const VW=1000, VH=430;
  const sx=rect.width/VW, sy=rect.height/VH;
  const scale=Math.min(sx,sy);
  const placed=[];

  // Larger / repeated terms are placed first, then alphabetical key for deterministic layout.
  bubbles.sort((a,b)=>(Number(b.dataset.count)-Number(a.dataset.count))||a.dataset.cloudKey.localeCompare(b.dataset.cloudKey));
  bubbles.forEach((el,idx)=>{
    const logicalSize=Number(el.dataset.logicalSize)||22;
    el.style.fontSize=`${Math.max(12,logicalSize*scale)}px`;
    el.style.left='0px'; el.style.top='0px'; el.style.visibility='hidden';
    el.style.position='absolute'; el.style.transform='none';
    const w=el.offsetWidth/sx, h=el.offsetHeight/sy;
    const seed=cloudHash(el.dataset.cloudKey);
    const phase=((seed%360)/180)*Math.PI;
    let chosen=null;
    const cx=VW/2, cy=VH/2;
    // Elliptical golden-angle spiral gives a much more cloud-like distribution than rows.
    for(let step=0;step<1400;step++){
      const angle=phase+step*2.399963229728653;
      const radius=4.0*Math.sqrt(step);
      const x=cx+Math.cos(angle)*radius*1.75-w/2;
      const y=cy+Math.sin(angle)*radius*.88-h/2;
      const box={x,y,w,h};
      const marginX=8, marginY=7;
      const inBounds=x>=5&&y>=5&&x+w<=VW-5&&y+h<=VH-5;
      if(!inBounds)continue;
      const overlaps=placed.some(p=>!(box.x+box.w+marginX<p.x||p.x+p.w+marginX<box.x||box.y+box.h+marginY<p.y||p.y+p.h+marginY<box.y));
      if(!overlaps){chosen=box;break;}
    }
    // Never stack words if the cloud is saturated: progressively shrink this word and retry.
    if(!chosen){
      for(let shrink=.9;shrink>=.58&&!chosen;shrink-=.08){
        el.style.fontSize=`${Math.max(10,logicalSize*scale*shrink)}px`;
        const sw=el.offsetWidth/sx, sh=el.offsetHeight/sy;
        for(let step=0;step<1600;step++){
          const angle=phase+step*2.399963229728653;
          const radius=4.1*Math.sqrt(step);
          const x=cx+Math.cos(angle)*radius*1.78-sw/2;
          const y=cy+Math.sin(angle)*radius*.9-sh/2;
          const box={x,y,w:sw,h:sh};
          if(x<5||y<5||x+sw>VW-5||y+sh>VH-5)continue;
          const overlaps=placed.some(p=>!(box.x+box.w+6<p.x||p.x+p.w+6<box.x||box.y+box.h+5<p.y||p.y+p.h+5<box.y));
          if(!overlaps){chosen=box;break;}
        }
      }
    }
    if(!chosen){el.style.display='none';return;}
    placed.push(chosen);
    el.style.display='inline-flex';
    el.style.left=`${chosen.x*sx}px`;
    el.style.top=`${chosen.y*sy}px`;
    el.style.visibility='visible';
    const rot=((seed%7)-3)*.7;
    el.style.setProperty('--rotate',`${rot}deg`);
  });
  if(!cloudResizeBound){
    cloudResizeBound=true;
    window.addEventListener('resize',()=>{clearTimeout(window.__cloudResizeTimer);window.__cloudResizeTimer=setTimeout(layoutWordCloud,100);});
  }
}
function slideWordCloud(){
  return `<article class="slide word-cloud-slide-v11"><div class="cloud-title-block"><div class="live-badge cloud-live-badge"><i></i>INTERACTION · WORD CLOUD</div><h2>What comes to mind when you think about AI?</h2><p class="cloud-subtitle-v13">Feelings, ideas, opportunities or concerns — share the first thing that comes to mind.</p></div><div class="cloud-frame-v11">${renderWordCloud()}</div></article>`;
}

function renderBars(def,agg){
  return `<div class="result-list">${(def.options||[]).map(([id,label])=>{const n=agg.counts[id]||0;return`<div class="result-row"><label>${esc(label)}</label><div class="bar"><i style="width:${pct(n,agg.total)}%"></i></div><b>${pct(n,agg.total)}%</b></div>`;}).join('')}</div>`;
}
function weeklyAverage(agg){
  const values={h1:1,h2:2,h4:4,h8:8};
  if(!agg?.total)return 0;
  let sum=0;for(const [key,v] of Object.entries(values))sum+=(agg.counts[key]||0)*v;
  return sum/agg.total;
}
function slideWeeklyTime(){
  const id='timeSaved',def=definitions[id],agg=state.aggregates[id]||{total:0,counts:{}},active=state.activeInteraction===id,show=active&&state.showResults,avg=weeklyAverage(agg);
  const results=show?`<div class="time-results-v11"><div class="average-card-v11"><span>Estimated average</span><strong>${avg.toFixed(avg%1?1:0)} h</strong><small>saved per person / week</small></div>${renderBars(def,agg)}</div>`:`<div class="placeholder-results"><div><strong>${active&&state.interactionOpen?'Voting is open':'Ready to launch'}</strong><p>${active&&state.interactionOpen?'Results remain hidden until you reveal them.':'Waiting for responses.'}</p></div></div>`;
  return `<article class="slide"><div class="poll-shell weekly-poll-v11"><div><div class="live-badge"><i></i>${active&&state.interactionOpen?'LIVE · vote open':'Interaction'}</div><div class="eyebrow" style="margin-top:18px">Time saved</div><h2 class="poll-title">${esc(def.question)}</h2><div class="response-count">${agg.total} response${agg.total===1?'':'s'} · <span data-participants>${state.participantCount}</span> connected</div><div class="poll-option-preview">${def.options.map(([key,label],i)=>`<div class="poll-option-card"><i style="background:${cloudPalette[i]}"></i><div><strong>${esc(label)}</strong></div></div>`).join('')}</div></div><div>${results}</div></div></article>`;
}

function slideRetrieval(){
  const id='retrievalCheck',def=definitions[id],agg=state.aggregates[id]||{total:0,counts:{}},active=state.activeInteraction===id,show=active&&state.showResults;
  const total=agg.total||1,yes=pct(agg.counts.yes||0,total),no=pct(agg.counts.no||0,total);
  const pollResults=`<div class="retrieval-poll-results-v12"><div class="mini-donut retrieval-donut-v12" style="background:conic-gradient(#719EF7 0 ${yes}%,#37BE6A ${yes}% 100%)"><div><b>${agg.total}</b><span>responses</span></div></div><div class="retrieval-legend retrieval-legend-v12"><span><i style="background:#719EF7"></i>Yes ${yes}%</span><span><i style="background:#37BE6A"></i>No ${no}%</span></div></div>`;
  return `<article class="slide retrieval-v11"><div class="eyebrow">Document retrieval</div><h2>Will AI find the right delivery date?</h2><div class="retrieval-grid-v11"><div class="fake-doc carbon-doc-v11"><div class="doc-head"><b>FORWARD CARBON CREDIT PURCHASE AGREEMENT</b><span>extract · 12 pages</span></div><div class="doc-copy-v11"><p><b>Project:</b> Delta Mangrove Restoration Programme</p><p><b>Standard:</b> Verra VCS + CCB label under review</p><p><b>Volume:</b> 120,000 tCO2e, split into two delivery tranches</p><p><b>Buyer:</b> Removall Carbon</p><p><b>Commercial target:</b> secure Q4 2026 retirements for key clients</p><div class="date-callout-v11 visible-date"><span>Easy-to-find date</span><strong>First issuance expected by <em>30 September 2026</em></strong></div><p><b>Payment terms:</b> Net 30 after issuance and transfer confirmation</p><p><b>Registry note:</b> serial numbers released only after verifier sign-off</p><p><b>Monitoring package:</b> includes field samples, satellite imagery and leakage memo</p><p><b>Operational note:</b> if CCB review slips, pricing stays unchanged for tranche 1</p><p><b>Annex reference:</b> Appendix B covers verifier sampling escalation</p></div><div class="date-callout-v11 hidden-date"><span>Critical date hidden in Appendix B</span><strong>If verifier sampling exceeds 15%, first delivery moves to <em>14 October 2026</em>.</strong></div></div><div class="retrieval-side-v11"><div class="live-badge"><i></i>${active&&state.interactionOpen?'QUESTION OPEN':'Interaction'}</div><p class="question-small">${esc(def.question)}</p>${show?`${pollResults}<div class="retrieval-answer-v11"><h3>Answer: not necessarily.</h3><div class="tips-v11"><span>Rename documents clearly</span><span>Create a document reference table</span><span>Explicitly require the model to read a specific document</span><span>When sources conflict, specify which document takes precedence</span></div></div>`:`<div class="placeholder-results compact-placeholder"><strong>${active&&state.interactionOpen?'Responses are coming in':'Ready'}</strong><p>Reveal the answer when you want to debrief.</p></div>`}</div></div></article>`;
}

function slideSourceDocument(){
  const livePdf=`/api/session/${encodeURIComponent(sessionId)}/live-results.pdf`;
  return `<article class="slide source-slide source-v11"><div class="eyebrow">Built with AI</div><h2>This presentation was generated with AI.</h2><p class="source-subtitle-v13">Here are the resources in the format you want:</p><div class="source-v11-grid"><div class="source-preview-v11"><div class="doc-preview"><img src="/docs/AI_Pulse_Cahier_Source_preview.png" alt="Petit dej IA source document preview"></div><div class="source-actions"><a class="btn primary" href="${livePdf}" target="_blank">Petit dej IA.pdf</a><a class="btn secondary" href="/docs/Petit_dej_IA.docx" target="_blank">Petit dej IA.docx</a></div><small>The PDF adds a live workshop-results page while the rest of the source document remains visually unchanged.</small></div><div class="fake-prompt-v11"><span class="panel-label">Example prompt summary</span><pre>ROLE
You are an AI workshop designer and facilitator.

OBJECTIVE
Build a short, interactive session for Removall Carbon.

RULES
- Keep the Removall visual identity.
- Use live audience responses.
- Make the learning points concrete.
- Never invent a source or a critical date.

OUTPUT
A 5-slide interactive presentation plus a live results page in the source PDF.</pre><div class="prompt-note-v11">The live PDF currently includes participation, the word cloud and estimated weekly time saved.</div></div></div></article>`;
}

function bindSlideEvents(){document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>goSlide(Number(b.dataset.goto)));}
function setupQr(){
  const box=document.getElementById('qrcode');if(!box)return;
  const img=document.createElement('img');img.alt='QR code to join the session';img.src=`/api/qr?text=${encodeURIComponent(participantUrl())}`;box.innerHTML='';box.appendChild(img);
}
function showReaction(emoji){const stage=document.getElementById('stage');if(!stage)return;const el=document.createElement('div');el.className='reaction-float';el.textContent=emoji;el.style.setProperty('--dx',`${Math.round((Math.random()-.5)*220)}px`);el.style.left=`${40+Math.random()*20}%`;stage.appendChild(el);setTimeout(()=>el.remove(),1600);}

function renderParticipant(){
  const active=state.activeInteraction,isOpen=state.interactionOpen;
  app.innerHTML=`<main class="participant-shell"><section class="participant-card"><div class="mobile-head"><div class="brand">AI Pulse</div><div class="session-mini">${esc(sessionId)}</div></div>${isOpen&&active?renderParticipantInteraction(active):renderWaiting()}<div class="privacy-note">Responses are used only for this internal workshop. No identity is attached to the answers.</div>${renderReactionBar()}</section></main>`;
  bindParticipantEvents();
}
function renderWaiting(){return`<div class="mobile-panel waiting"><div class="wait-orb"></div><div class="eyebrow">Connected to the session</div><h1>Waiting for the next interaction.</h1><p>The question will appear here automatically when the presenter opens it.</p></div>`;}
function renderParticipantInteraction(id){
  const def=definitions[id];if(!def)return renderWaiting();
  if(id!=='associations' && submitted[id])return renderSubmitted(id,def);
  const current=selected[id]||'';
  let input='';
  if(def.type==='text') input=`<textarea class="mobile-textarea" id="ideaText" maxlength="${Number(def.maxLength)||80}" placeholder="${esc(def.placeholder||'Type one word or short phrase…')}">${esc(current)}</textarea><div class="char-count"><span id="charCount">${String(current).length}</span>/${Number(def.maxLength)||80}</div>${submitted[id]?'<div class="repeat-hint-v11">✓ Added. You can submit another word or short phrase.</div>':''}`;
  else input=`<div class="choice-list">${def.options.map(([key,label])=>`<button class="choice ${selected[id]===key?'selected':''}" data-choice="${key}">${esc(label)}</button>`).join('')}</div>`;
  return `<div class="mobile-panel"><div class="eyebrow">Live question</div><h1>${esc(def.question)}</h1>${input}<button class="btn primary mobile-submit" id="submitAnswer" ${!current?'disabled':''}>${id==='associations'?'Add to the word cloud':'Submit answer'}</button></div>`;
}
function renderSubmitted(id,def){
  return `<div class="mobile-panel waiting"><div class="success-mark">✓</div><div class="eyebrow">Answer recorded</div><h1>Thank you.</h1><p>${id==='retrievalCheck'?'The debrief will appear on the main screen.':'Your answer has been saved.'}</p>${state.showResults?`<div style="margin-top:18px">${renderMobileBars(def,state.aggregates[id])}</div>`:''}</div>`;
}
function renderMobileBars(def,agg){return`<div class="result-list">${def.options.map(([id,label])=>`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px"><span>${esc(label)}</span><b>${pct(agg.counts[id]||0,agg.total)}%</b></div><div class="bar"><i style="width:${pct(agg.counts[id]||0,agg.total)}%"></i></div></div>`).join('')}</div>`;}
function renderReactionBar(){return`<div class="reaction-bar">${['👍','❤️','💡','🤯'].map(e=>`<button data-reaction="${e}" aria-label="Reaction ${e}">${e}</button>`).join('')}</div>`;}
function bindParticipantEvents(){
  document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{selected[state.activeInteraction]=b.dataset.choice;renderParticipant();});
  const txt=document.getElementById('ideaText');
  txt?.addEventListener('input',e=>{selected[state.activeInteraction]=e.target.value;document.getElementById('charCount').textContent=e.target.value.length;document.getElementById('submitAnswer').disabled=!e.target.value.trim();});
  document.getElementById('submitAnswer')?.addEventListener('click',submitAnswer);
  document.querySelectorAll('[data-reaction]').forEach(b=>b.onclick=()=>{api(`/api/session/${encodeURIComponent(sessionId)}/reaction`,{method:'POST',body:JSON.stringify({emoji:b.dataset.reaction,anonId})}).catch(()=>{});b.animate([{transform:'scale(1)'},{transform:'scale(1.25)'},{transform:'scale(1)'}],{duration:280});});
}
async function submitAnswer(){
  const id=state.activeInteraction,answer=selected[id];
  try{
    await api(`/api/session/${encodeURIComponent(sessionId)}/respond`,{method:'POST',body:JSON.stringify({interactionId:id,anonId,answer})});
    submitted[id]=true;
    if(id==='associations') selected[id]='';
    toast(id==='associations'?'Added to the word cloud':'Answer recorded');
    renderParticipant();
  }catch(e){toast(e.message);}
}

init().catch(e=>{app.innerHTML=`<main class="app-shell"><section class="role-gate"><div class="eyebrow">AI Pulse</div><h1>Unable to load the session.</h1><p>${esc(e.message)}</p></section></main>`;});
