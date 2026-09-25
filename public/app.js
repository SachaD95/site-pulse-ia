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
let groupsCache = [];
let component = { flow:'context', promptLevel:0, noteTab:'Résumé', toolUse:'Chat' };
let submitted = {};
let selected = {};
let voteAllocation = {};
let anonId = null;

const slideInteraction = {
  2:'frequency', 3:'timeSaved', 4:'appetite', 5:'priorities', 9:'retrievalCheck', 14:'nextPriority'
};

const slideTitles = [
  'Introduction', 'Pourquoi sommes-nous ici ?', 'Fréquence d’usage', 'Temps gagné', 'Appétit pour l’automatisation', 'Priorités d’automatisation',
  'Dashboard collectif', 'Loupe · temps gagné', 'Comment fonctionne l’IA ?', 'L’IA verra-t-elle l’info ?', 'Prompt Lab avancé',
  'Quel outil IA pour quel besoin ?', 'Agents', 'Meeting Notes', 'Prochaines priorités', 'Conclusion', 'Le document source'
];

function getAnonId(sid){
  const storageKey=`aiPulseAnonId:${sid||'session'}`;
  let id = localStorage.getItem(storageKey);
  if(!id){ id = (crypto.randomUUID ? crypto.randomUUID() : 'anon-'+Math.random().toString(36).slice(2)); localStorage.setItem(storageKey, id); }
  return id;
}

function esc(v=''){ return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function pct(count,total){ return total ? Math.round(count/total*100) : 0; }
function publicOrigin(){
  const override=localStorage.getItem('aiPulsePublicBase');
  if(override) return override.replace(/\/$/,'');
  if(['localhost','127.0.0.1'].includes(location.hostname) && meta.networkOrigins?.length) return meta.networkOrigins[0];
  return location.origin;
}
function participantUrl(){ return `${publicOrigin()}/join/${encodeURIComponent(sessionId)}`; }
function presenterUrl(){ return `${location.origin}/?mode=presenter&session=${encodeURIComponent(sessionId)}&key=${encodeURIComponent(presenterKey)}`; }

async function api(path, options={}){
  const res = await fetch(path, { headers:{'Content-Type':'application/json',...(options.headers||{})}, ...options });
  if(!res.ok){ let msg='Erreur'; try{ msg=(await res.json()).error||msg; }catch{} throw new Error(msg); }
  const type=res.headers.get('content-type')||'';
  return type.includes('application/json') ? res.json() : res.text();
}

function toast(message){
  document.querySelector('.toast')?.remove();
  const el=document.createElement('div'); el.className='toast'; el.textContent=message; document.body.appendChild(el); setTimeout(()=>el.remove(),2200);
}

async function init(){
  if(!sessionId){
    const list = await api('/api/sessions').catch(()=>[]);
    sessionId = list[0]?.id || null;
  }
  if(!sessionId){ renderNoSession(); return; }
  anonId = getAnonId(sessionId);
  if(!mode){ renderRoleGate(); return; }
  meta = await api('/api/meta').catch(()=>({networkOrigins:[]}));
  definitions = await api(`/api/session/${encodeURIComponent(sessionId)}/definitions`);
  await refreshState();
  if(params.get('snapshot')!=='1') connectEvents();
  setInterval(heartbeat, 25000);
  heartbeat();
  if(mode==='presenter') bindKeyboard();
}

function renderRoleGate(){
  app.innerHTML=`<main class="app-shell"><section class="role-gate">
    <div class="eyebrow">AI Pulse · expérience interactive</div>
    <h1>Une présentation qui<br>fait participer la salle.</h1>
    <p>Choisissez l’expérience. Le mode présentateur pilote les slides et les interactions. Le mode participant affiche uniquement la question active.</p>
    <div class="role-actions">
      <button class="btn primary" id="joinParticipant">Rejoindre comme participant</button>
      <button class="btn secondary" id="joinPresenter">Ouvrir le mode présentateur</button>
    </div>
  </section></main>`;
  document.getElementById('joinParticipant').onclick=()=>location.href=`/?mode=participant&session=${encodeURIComponent(sessionId||'')}`;
  document.getElementById('joinPresenter').onclick=()=>{
    const key=prompt('Clé présentateur (affichée dans le terminal au démarrage) :');
    if(key) location.href=`/?mode=presenter&session=${encodeURIComponent(sessionId||'')}&key=${encodeURIComponent(key)}`;
  };
}

function renderNoSession(){
  app.innerHTML=`<main class="app-shell"><section class="role-gate"><div class="eyebrow">AI Pulse</div><h1>Aucune session active.</h1><p>Lancez le serveur puis créez une session.</p></section></main>`;
}

async function refreshState(){
  const keyQ = mode==='presenter' ? `?key=${encodeURIComponent(presenterKey)}` : '';
  state = await api(`/api/session/${encodeURIComponent(sessionId)}${keyQ}`);
  if(mode==='presenter' && !state.presenterKey){
    app.innerHTML=`<main class="app-shell"><section class="role-gate"><div class="eyebrow">Accès présentateur</div><h1>Clé présentateur requise.</h1><p>Utilisez l’URL présentateur affichée dans le terminal du serveur.</p></section></main>`;
    return;
  }
  render();
}

function connectEvents(){
  if(eventSource) eventSource.close();
  const keyQ=mode==='presenter'?`?key=${encodeURIComponent(presenterKey)}`:'';
  eventSource=new EventSource(`/api/session/${encodeURIComponent(sessionId)}/events${keyQ}`);
  eventSource.addEventListener('state',e=>{ state=JSON.parse(e.data); render(); });
  eventSource.addEventListener('presence',e=>{ if(state){ state.participantCount=JSON.parse(e.data).participantCount; renderLight(); } });
  eventSource.addEventListener('reaction',e=>{ if(mode==='presenter') showReaction(JSON.parse(e.data).emoji); });
  eventSource.onerror=()=>{};
}

function heartbeat(){
  if(!sessionId) return;
  api(`/api/session/${encodeURIComponent(sessionId)}/heartbeat`,{method:'POST',body:JSON.stringify({anonId})}).catch(()=>{});
}

function render(){
  if(!state) return;
  if(mode==='presenter') renderPresenter(); else renderParticipant();
}

function renderLight(){
  const el=document.querySelector('[data-participants]'); if(el) el.textContent=state.participantCount;
}

function bindKeyboard(){
  document.addEventListener('keydown',e=>{
    if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if(e.key==='ArrowRight' || e.key==='PageDown' || e.key===' ') { e.preventDefault(); changeSlide(1); }
    if(e.key==='ArrowLeft' || e.key==='PageUp') { e.preventDefault(); changeSlide(-1); }
    if(e.key.toLowerCase()==='f') toggleFullscreen();
  });
}

async function presenterAction(payload){
  try{
    await api(`/api/session/${encodeURIComponent(sessionId)}/action?key=${encodeURIComponent(presenterKey)}`,{method:'POST',body:JSON.stringify({...payload,key:presenterKey})});
  }catch(e){ toast(e.message); }
}
function changeSlide(delta){ presenterAction({type:'setSlide',slideIndex:state.slideIndex+delta}); }
function goSlide(i){ presenterAction({type:'setSlide',slideIndex:i}); }
function toggleFullscreen(){ if(!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); }

function renderPresenter(){
  app.innerHTML=`<main class="presenter-layout">
    <section class="stage-wrap">
      <div class="stage" id="stage">
        ${state.demoLoaded?'<div class="demo-banner">DONNÉES DE DÉMONSTRATION · FICTIVES</div>':''}
        ${renderTimer()}
        ${renderSlide(state.slideIndex)}
        <div class="stage-nav">
          <button class="btn icon" id="prevSlide" aria-label="Précédent">←</button>
          <button class="btn icon" id="nextSlide" aria-label="Suivant">→</button>
        </div>
        <div class="stage-footer"><span>${state.slideIndex+1}/${slideTitles.length}</span><div class="progress"><i style="width:${((state.slideIndex+1)/slideTitles.length)*100}%"></i></div><span>${esc(slideTitles[state.slideIndex])}</span></div>
      </div>
    </section>
    ${renderPresenterPanel()}
  </main>`;
  document.getElementById('prevSlide').onclick=()=>changeSlide(-1);
  document.getElementById('nextSlide').onclick=()=>changeSlide(1);
  bindSlideEvents();
  bindPanelEvents();
  setupQr();
  startTimerLoop();
}

function renderPresenterPanel(){
  const iid=slideInteraction[state.slideIndex];
  const isInteractive=Boolean(iid);
  const openForThis=state.activeInteraction===iid && state.interactionOpen;
  const resultsForThis=state.activeInteraction===iid && state.showResults;
  return `<aside class="presenter-panel">
    <div class="panel-head"><strong>Presenter controls</strong><span><i class="status-dot"></i>Live</span></div>
    <div class="panel-section">
      <div class="panel-label">Session</div>
      <div class="session-chip">${esc(sessionId)}</div>
      <div class="panel-metric"><span>Participants actifs</span><b data-participants>${state.participantCount}</b></div>
      <div class="panel-grid"><button class="btn small" id="copyJoin">Copier le lien</button><button class="btn small" id="configQr">URL QR</button></div>
    </div>
    <div class="panel-section">
      <div class="panel-label">Navigation</div>
      <div class="panel-grid"><button class="btn small" id="panelPrev">← Précédent</button><button class="btn small" id="panelNext">Suivant →</button></div>
      <div class="panel-grid" style="margin-top:8px"><button class="btn small" id="fullscreen">Plein écran</button><button class="btn small" id="openParticipant">Vue mobile</button></div>
    </div>
    <div class="panel-section">
      <div class="panel-label">Interaction de cette slide</div>
      ${isInteractive ? `
        <div class="panel-grid"><button class="btn ${openForThis?'secondary':'primary'} small" id="openInteraction">${openForThis?'Réouvrir / garder ouvert':'Ouvrir'}</button><button class="btn small" id="closeInteraction" ${!openForThis?'disabled':''}>Fermer</button></div>
        <button class="btn small" style="width:100%;margin-top:8px" id="toggleResults">${resultsForThis?'Masquer les résultats':'Afficher les résultats'}</button>
      `:'<p style="color:var(--muted);font-size:13px">Pas de réponse participant sur cette slide.</p>'}
    </div>
    <div class="panel-section">
      <div class="panel-label">Timer</div>
      <div class="panel-grid"><button class="btn small" data-timer="30">30 sec</button><button class="btn small" data-timer="60">60 sec</button></div>
      <button class="btn small" id="stopTimer" style="width:100%;margin-top:8px">Arrêter</button>
    </div>
    <div class="panel-section">
      <div class="panel-label">Données</div>
      <div class="panel-grid"><button class="btn small" id="demoData">Charger démo</button><button class="btn small" id="exportCsv">Exporter CSV</button></div>
      <button class="btn danger small" id="resetSession" style="width:100%;margin-top:8px">Réinitialiser la session</button>
      <button class="btn small" id="newSession" style="width:100%;margin-top:8px">Créer une nouvelle session</button>
    </div>
  </aside>`;
}

function bindPanelEvents(){
  const iid=slideInteraction[state.slideIndex];
  document.getElementById('panelPrev').onclick=()=>changeSlide(-1);
  document.getElementById('panelNext').onclick=()=>changeSlide(1);
  document.getElementById('fullscreen').onclick=toggleFullscreen;
  document.getElementById('copyJoin').onclick=async()=>{ await navigator.clipboard?.writeText(participantUrl()); toast('Lien participant copié'); };
  document.getElementById('configQr').onclick=()=>{ const value=prompt('Adresse publique / réseau à utiliser dans le QR code :',publicOrigin()); if(value){ localStorage.setItem('aiPulsePublicBase',value.trim().replace(/\/$/,'')); render(); toast('URL QR mise à jour'); } };
  document.getElementById('openParticipant').onclick=()=>window.open(participantUrl(),'_blank');
  document.getElementById('openInteraction')?.addEventListener('click',()=>presenterAction({type:'openInteraction',interactionId:iid}));
  document.getElementById('closeInteraction')?.addEventListener('click',()=>presenterAction({type:'closeInteraction'}));
  document.getElementById('toggleResults')?.addEventListener('click',()=>presenterAction({type:'toggleResults',show:!(state.activeInteraction===iid && state.showResults)}));
  document.querySelectorAll('[data-timer]').forEach(b=>b.onclick=()=>presenterAction({type:'startTimer',seconds:Number(b.dataset.timer)}));
  document.getElementById('stopTimer').onclick=()=>presenterAction({type:'stopTimer'});
  document.getElementById('demoData').onclick=()=>presenterAction({type:'loadDemo'});
  document.getElementById('exportCsv').onclick=()=>window.open(`/api/session/${encodeURIComponent(sessionId)}/export.csv?key=${encodeURIComponent(presenterKey)}`,'_blank');
  document.getElementById('resetSession').onclick=()=>{ if(confirm('Réinitialiser toutes les réponses de cette session ? Cette action est irréversible.')) presenterAction({type:'reset'}); };
  document.getElementById('newSession').onclick=createNewSession;
}

async function createNewSession(){
  try{
    const base=`AI-${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    const result=await api('/api/sessions',{method:'POST',body:JSON.stringify({id:base})});
    location.href=`/?mode=presenter&session=${encodeURIComponent(result.id)}&key=${encodeURIComponent(result.presenterKey)}`;
  }catch(e){toast(e.message)}
}

function renderTimer(){
  if(!state.timerEndsAt) return '';
  const sec=Math.max(0,Math.ceil((state.timerEndsAt-Date.now())/1000));
  return `<div class="timer-overlay" id="timerOverlay">${sec}s</div>`;
}
function startTimerLoop(){
  clearInterval(timerTick);
  if(!state.timerEndsAt) return;
  timerTick=setInterval(()=>{
    const el=document.getElementById('timerOverlay'); if(!el){clearInterval(timerTick);return;}
    const sec=Math.max(0,Math.ceil((state.timerEndsAt-Date.now())/1000)); el.textContent=`${sec}s`; if(sec<=0) clearInterval(timerTick);
  },250);
}

function renderSlide(i){
  const renderers=[slideIntro,slideObjectives,()=>slidePoll('frequency'),()=>slidePoll('timeSaved'),()=>slidePoll('appetite'),()=>slidePoll('priorities'),slideDashboard,slideTimeFocus,slideHowAI,slideRetrievalDemo,slidePromptLab,slideToolLandscape,slideAgents,slideMeeting,slideNextPriorities,slideFinal,slideSourceDocument];
  return renderers[i]?.() || '';
}

function brandMark(){
  return `<div class="brand-lockup"><img src="/assets/removall-mark.png" alt=""><span>Removall</span><small>CARBON</small></div>`;
}

function slideIntro(){
  return `<article class="slide brand-slide intro-v5"><div class="brand-top">${brandMark()}</div><div class="hero-grid hero-grid-v5"><div><div class="eyebrow">Petit dej IA · AI Pulse</div><h1>Removall & IA :<br><span>Pour avancer dans l'avenir</span></h1><p class="big-sub">Une expérience interactive pour mesurer, comprendre et choisir où l’IA peut réellement nous aider.</p><button class="btn primary" data-goto="1">Commencer →</button></div><div class="qr-card light-card"><div class="qr-box" id="qrcode"></div><strong>Scannez pour rejoindre</strong><small>Session ${esc(sessionId)}</small></div></div></article>`;
}
function slideObjectives(){
  const cards=[['01','Prendre le pouls','Comprendre comment l’équipe utilise déjà l’IA.'],['02','Apprendre','Découvrir les bonnes pratiques et les nouvelles possibilités.'],['03','Imaginer','Identifier ensemble les automatisations les plus intéressantes.']];
  return `<article class="slide"><div class="eyebrow">Pourquoi sommes-nous ici ?</div><h2>Trois objectifs, une session très concrète.</h2><div class="objective-grid">${cards.map((c,i)=>`<div class="feature-card objective-${i+1}"><div class="num">${c[0]}</div><h3>${c[1]}</h3><p>${c[2]}</p></div>`).join('')}</div></article>`;
}

function appetiteDonut(agg,compact=false){
  const total=agg.total||1;
  const vals=['no','some','more','allin'].map(k=>pct(agg.counts[k]||0,total));
  const c1=vals[0],c2=c1+vals[1],c3=c2+vals[2];
  const style=`background:conic-gradient(#C0C0C0 0 ${c1}%,#B7CBFF ${c1}% ${c2}%,#5F89F4 ${c2}% ${c3}%,#4BBA84 ${c3}% 100%)`;
  const labels=[
    ['Pas spécialement','#C0C0C0',vals[0],'Envie faible'],
    ['Quelques tâches','#B7CBFF',vals[1],'Premiers besoins'],
    ['Beaucoup plus','#5F89F4',vals[2],'Accélération'],
    ['Absolument','#4BBA84',vals[3],'Forte envie']
  ];
  return `<div class="appetite-viz ${compact?'compact':''}"><div class="donut gradient-donut" style="${style}"><div><strong>${state.dashboard.appetiteScore}%</strong><span>indice d’envie</span></div></div><div class="donut-legend appetite-legend">${labels.map(x=>`<div><i style="background:${x[1]}"></i><span>${x[0]}</span><small>${x[3]}</small><b>${x[2]}%</b></div>`).join('')}</div><div class="appetite-gradient-scale"><span>Faible</span><div></div><span>Fort</span></div></div>`;
}

function renderPollOptionPreview(def,id){
  const accents={
    frequency:['Rarement','1 fois / jour','5 fois / jour','10+ / jour'],
    timeSaved:['10 min','30 min','1 h','Plusieurs h'],
    appetite:['Pas spécialement','Quelques tâches','Beaucoup plus','Absolument'],
    priorities:['Réunions','Emails','Recherche','Excel','Slides','Documents','Chatbot','Prépa','Répétitif','Autre']
  };
  const palette=id==='appetite' ? ['#C0C0C0','#B7CBFF','#5F89F4','#4BBA84'] : ['#5F89F4','#6C91F5','#8DB0FB','#45D7FF','#4BBA84','#ABD3BD','#FE6930','#F5B297','#24304F','#DFEAFB'];
  const layout=id==='priorities'?'wide-grid':'';
  return `<div class="poll-option-preview ${layout}">${(def.options||[]).map(([key,label],i)=>`<div class="poll-option-card"><i style="background:${palette[i%palette.length]}"></i><div><strong>${esc(accents[id]?.[i]||label)}</strong><small>${esc(label)}</small></div></div>`).join('')}</div>`;
}

function slidePoll(id){
  const def=definitions[id]; const agg=state.aggregates[id]||{total:0,counts:{}}; const active=state.activeInteraction===id; const show=active&&state.showResults;
  const label=id==='frequency'?'AI Pulse':id==='timeSaved'?'Impact perçu':id==='appetite'?"Appétit pour l’automatisation":id==='priorities'?"Priorités collectives":"Interaction";
  let results='';
  if(id==='appetite' && show) results=appetiteDonut(agg);
  else if(show) results=renderBars(def,agg,id==='priorities');
  else results=`<div class="placeholder-results"><div><strong>${active&&state.interactionOpen?'Le vote est ouvert':'Prêt à lancer'}</strong><p>${active&&state.interactionOpen?'Les résultats restent masqués jusqu’à votre signal.':'Ouvrez l’interaction depuis les contrôles présentateur.'}</p></div></div>`;
  return `<article class="slide"><div class="poll-shell"><div><div class="live-badge"><i></i>${active&&state.interactionOpen?'LIVE · vote ouvert':'Interaction'}</div><div class="eyebrow" style="margin-top:18px">${label}</div><h2 class="poll-title">${esc(def.question)}</h2><div class="response-count">${agg.total} réponse${agg.total>1?'s':''} · <span data-participants>${state.participantCount}</span> connecté${state.participantCount>1?'s':''}</div>${renderPollOptionPreview(def,id)}</div><div>${results}</div></div></article>`;
}

function renderBars(def,agg,ranking=false){
  let opts=[...(def.options||[])]; if(ranking) opts.sort((a,b)=>(agg.counts[b[0]]||0)-(agg.counts[a[0]]||0));
  const max=ranking?Math.max(1,...opts.map(([id])=>agg.counts[id]||0)):agg.total||1;
  return `<div class="result-list">${opts.map(([id,label])=>{const n=agg.counts[id]||0; const width=ranking?Math.round(n/max*100):pct(n,agg.total); return `<div class="result-row"><label>${esc(label)}</label><div class="bar"><i style="width:${width}%"></i></div><b>${ranking?n:pct(n,agg.total)+'%'}</b></div>`}).join('')}</div>`;
}

function miniDistribution(def, agg){
  const total=agg.total||1;
  return `<div class="mini-dist">${(def.options||[]).map(([id,label])=>{const n=agg.counts[id]||0;return `<div><span>${esc(label)}</span><div class="mini-bar"><i style="width:${pct(n,total)}%"></i></div><b>${pct(n,total)}%</b></div>`}).join('')}</div>`;
}

function slideDashboard(){
  const d=state.dashboard, f=state.aggregates.frequency||{total:0,counts:{}}, t=state.aggregates.timeSaved||{total:0,counts:{}}, a=state.aggregates.appetite||{total:0,counts:{}};
  return `<article class="slide dashboard-slide"><div class="eyebrow">Synthèse live · vos réponses</div><h2>Voilà où nous en sommes.</h2><div class="dashboard-grid dashboard-v3">
    <div class="kpi"><span class="kpi-label">Usage quotidien</span><strong>${d.daily}%</strong><span>utilisent l’IA au moins quotidiennement</span>${miniDistribution(definitions.frequency,f)}</div>
    <button class="kpi focus-time zoom-card" data-goto="7"><div class="focus-head"><span class="focus-icon">⌕</span><div><b>LOUPE · TEMPS GAGNÉ</b><small>cliquer pour ouvrir l’analyse</small></div></div><strong>${d.avgMinutesSavedLabel}</strong><span>par jour en moyenne, d’après la salle</span>${miniDistribution(definitions.timeSaved,t)}<div class="annualized">≈ ${d.annualHoursSaved} h / personne / an*</div></button>
    <div class="kpi appetite-card"><span class="kpi-label">Appétit pour l’automatisation</span>${appetiteDonut(a,true)}</div>
    <div class="kpi top-list"><span class="kpi-label">Top 3 à automatiser</span>${d.top.length?d.top.map(x=>`<div class="rank-item no-rank"><span class="rank-dot"></span><span class="rank-label">${esc(x.label)}</span><b>${x.count}</b></div>`).join(''):'<span>En attente de réponses.</span>'}</div>
    <div class="kpi maturity-v3"><span class="kpi-label">Maturité IA de l’équipe</span><div class="maturity-score"><strong>${d.maturity}</strong><span>/100</span></div><div class="maturity-track"><i style="width:${d.maturity}%"></i></div><small>Indice combinant fréquence d’usage et appétit d’automatisation.</small></div>
  </div><small class="footnote">*Projection interne : moyenne pondérée de la question « temps gagné » × 220 jours ouvrés ; « plusieurs heures » est compté à 2 h/jour.</small></article>`;
}

function slideTimeFocus(){
  const d=state.dashboard, t=state.aggregates.timeSaved||{total:0,counts:{}};
  const studies=[
    ['POWER USERS','> 30 min / jour','Microsoft & LinkedIn','Work Trend Index · 8 mai 2024','31 000 personnes · 31 pays'],
    ['COPILOT','≈ 14 min / jour','Microsoft WorkLab','Premiers utilisateurs · 2023','Commerciaux Microsoft : ≈ 90 min / semaine déclarées'],
    ['E-MAIL','≈ 2 h / semaine','NBER','7 137 knowledge workers · 66 entreprises','Temps passé sur les e-mails chez les utilisateurs actifs'],
    ['VENTE','+3 à +5 %','McKinsey','Potentiel de productivité · 2023','Estimation économique, pas un nombre universel de minutes']
  ];
  return `<article class="slide time-focus-slide"><div class="eyebrow">Loupe · temps gagné</div><h2>Votre perception, puis les repères de la recherche.</h2><div class="focus-v5"><div class="focus-panel live-focus"><span class="panel-label">Dans cette salle · live</span><div class="focus-number">${d.avgMinutesSavedLabel}<small>/ jour</small></div>${miniDistribution(definitions.timeSaved,t)}<div class="annualized big">≈ ${d.annualHoursSaved} h / personne / an*</div></div><div class="research-visual-grid">${studies.map((s,i)=>`<div class="research-visual-card study-${i+1}"><span class="study-tag">${s[0]}</span><strong>${s[1]}</strong><b>${s[2]}</b><p>${s[3]}</p><small>${s[4]}</small></div>`).join('')}</div></div><div class="truth-band truth-v5"><strong>À retenir</strong><span>Il n’existe pas un nombre universel de minutes gagnées. Le résultat dépend de la tâche, de l’outil, du métier, du niveau d’adoption et du workflow. <b>C’est pour cela qu’il faut en avoir un usage intelligent.</b></span></div><small class="footnote">*Projection interne : moyenne pondérée × 220 jours ouvrés ; « plusieurs heures » est compté à 2 h/jour.</small></article>`;
}

const aiFlowItems={
  you:['Vous','Vous formulez le besoin : la question, le contexte métier et ce que vous attendez réellement.'],
  prompt:['Prompt','Le prompt traduit votre intention en consigne. Plus il est clair, plus vous réduisez l’ambiguïté.'],
  context:['Contexte / documents','Le modèle répond à partir de ce qu’il reçoit effectivement dans son contexte : votre demande, les extraits transmis et les documents disponibles à ce moment-là.'],
  model:['Modèle IA','Le modèle transforme ce contexte en une réponse probable. C’est ici que se trouve le réseau de neurones entraîné par machine learning.'],
  result:['Résultat','Le modèle produit une réponse qui semble cohérente avec votre demande. Cohérente ne veut pas dire automatiquement vraie, complète ou à jour.'],
  verify:['Vérification','Pour une information métier importante, on revient à la source : chiffres, dates, citations, règles, engagements et décisions.']
};
function slideHowAI(){
  const keys=Object.keys(aiFlowItems), activeKey=component.flow, active=aiFlowItems[activeKey]||aiFlowItems.context;
  const modelDetail=activeKey==='model' ? `<div class="model-deep-dive"><div class="model-arrow">↳</div><div class="model-blackbox"><span>MODÈLE IA</span><strong>Une « boîte noire » à vérifier</strong><p>Beaucoup de modèles privés sont utilisés comme des boîtes noires : on connaît l’entrée et la sortie, mais pas le raisonnement interne exact qui a produit chaque réponse.</p></div><div class="ml-card"><span>MACHINE LEARNING</span><strong>Il ne « trouve » pas une solution comme un humain.</strong><p>Un réseau de neurones a appris des régularités à partir d’énormes volumes d’exemples. Il génère ensuite la réponse qui a statistiquement le plus de chances de correspondre à votre demande et à son contexte.</p></div></div>` : '';
  return `<article class="slide ai-v5"><div class="eyebrow">Comment fonctionne l’IA ?</div><h2>De votre demande à une réponse… puis à sa vérification.</h2><div class="flow flow-v5">${keys.map((k,i)=>`${i?'<span class="flow-arrow">→</span>':''}<button class="flow-node ${activeKey===k?'active':''}" data-flow="${k}">${aiFlowItems[k][0]}</button>`).join('')}</div><div class="ai-v5-detail"><div><span class="panel-label">${active[0]}</span><h3>${active[1]}</h3></div><div class="verify-reminder"><b>${activeKey==='verify'?'Le dernier mot reste humain.':'Cliquez sur les étapes pour comprendre le chemin.'}</b><span>${activeKey==='model'?'Le modèle peut être puissant sans être explicable au niveau de chaque réponse.':'Une bonne réponse dépend autant du contexte transmis que du modèle utilisé.'}</span></div></div>${modelDetail}<div class="ai-bottom-rule"><span>Entrée</span><i></i><b>Réponse probabiliste</b><i></i><span>Contrôle humain</span></div></article>`;
}

function slideRetrievalDemo(){
  const id='retrievalCheck', def=definitions[id], agg=state.aggregates[id]||{total:0,counts:{}}, active=state.activeInteraction===id, show=active&&state.showResults;
  const total=agg.total||1, yes=pct(agg.counts.yes||0,total), no=pct(agg.counts.no||0,total);
  const donut=`<div class="mini-donut" style="background:conic-gradient(#F5B297 0 ${yes}%,#4BBA84 ${yes}% 100%)"><div><b>${agg.total}</b><span>réponses</span></div></div><div class="retrieval-legend"><span><i style="background:#F5B297"></i>Oui ${yes}%</span><span><i style="background:#4BBA84"></i>Non ${no}%</span></div>`;
  return `<article class="slide retrieval-demo carbon-demo"><div class="eyebrow">Démonstration documentaire</div><h2>Est-ce que l’IA va forcément voir cette information ?</h2><div class="doc-quiz-grid"><div class="fake-doc carbon-doc"><div class="doc-head"><b>CARBON CREDIT PROJECT · MONITORING REPORT V6</b><span>84 pages</span></div><div class="doc-meta"><span>Project ID · CK-2047</span><span>Period · 2025</span><span>Methodology · Cookstove</span></div><h3>5. Monitoring parameters and issuance calculation</h3><p>Emission reductions are calculated from monitored stove distribution, usage rates, fuel consumption and the approved baseline scenario. The project team reconciles field records with the monitoring database before issuance.</p><p class="doc-line">5.4 Data quality controls — sampling checks are performed quarterly and deviations above the internal threshold require investigation.</p><div class="muted-section carbon-annex"><h4>Annex 12 · Local implementation notes</h4><p>Field logistics, enumerator notes, replacement records and exceptional operating conditions.</p><p class="doc-line faint">12.7 Temporary deviations — villages with incomplete monitoring evidence remain visible in the operational dataset pending review.</p><div class="hidden-fact"><span>Information critique placée dans une annexe</span><b>Credits linked to households without complete monitoring evidence must be excluded from the issuance request until the evidence gap is resolved.</b></div></div><small class="doc-note">Exemple fictif construit pour l’atelier : l’information décisive existe bien dans le document, mais elle est éloignée de la section principale sur le calcul des crédits.</small></div><div class="quiz-side"><div class="live-badge"><i></i>${active&&state.interactionOpen?'QUESTION OUVERTE':'INTERACTION'}</div><p class="question-small">${esc(def.question)}</p>${show?donut:`<div class="placeholder-results compact-placeholder"><strong>${active&&state.interactionOpen?'Répondez sur votre téléphone':'Prêt à lancer'}</strong><p>Le résultat apparaîtra ici.</p></div>`}${show?`<div class="spoiler"><b>Non, pas forcément.</b><p>Dans un système RAG, le rapport peut être découpé en nombreux passages. Si la requête fait remonter la section « calcul d’émission » mais pas l’annexe 12, le modèle peut ne jamais recevoir la règle d’exclusion.</p><small>Nuance : certains systèmes injectent le document entier lorsque sa taille le permet. « Lost in the Middle » (2023) montre aussi que la position d’une information dans un contexte long peut affecter son utilisation.</small></div>`:''}</div></div></article>`;
}

const promptFreeform='Analyse ce rapport de projet carbone et dis-moi ce qui est important pour la direction.';
const promptBlocks=[
  ['Rôle','Tu es un analyste senior orienté décision.'],
  ['Contexte','Le lecteur est un directeur qui dispose de trois minutes et doit décider des prochaines actions.'],
  ['Détails','Fais ressortir les cinq informations clés, les risques, les dépendances et les points à vérifier.'],
  ['Format de sortie','Réponds sous forme de tableau puis termine par trois actions recommandées.'],
  ['Contraintes','N’invente rien. Signale toute incertitude et cite la section source.'],
  ['Structure du prompt','Réorganise maintenant la demande avec des rubriques explicites pour qu’elle soit immédiatement réutilisable.']
];
function promptForLevel(l){
  if(l<=0) return promptFreeform;
  const body=promptBlocks.slice(0,Math.min(l,5)).map(x=>x[1]).join(' ');
  if(l<6) return `${promptFreeform} ${body}`;
  return `RÔLE
${promptBlocks[0][1]}

OBJECTIF
Analyse le rapport de projet carbone pour préparer une décision.

CONTEXTE
${promptBlocks[1][1]}

DÉTAILS
${promptBlocks[2][1]}

FORMAT DE SORTIE
${promptBlocks[3][1]}

CONTRAINTES
${promptBlocks[4][1]}`;
}
function slidePromptLab(){
  return `<article class="slide prompt-lab-v5"><div class="eyebrow">Prompt Lab</div><h2>On peut parler naturellement à l’IA… puis structurer quand l’enjeu augmente.</h2><div class="prompt-free"><span class="panel-label">Point de départ · prompt écrit ou parlé</span><p>« ${promptFreeform} »</p></div><div class="prompt-v5-grid"><div class="prompt-structure prompt-steps-v5">${promptBlocks.map((x,i)=>`<button class="prompt-part ${component.promptLevel>=i+1?'on':''} ${i===5?'final-step':''}" data-prompt-level="${i+1}"><span>0${i+1}</span><div><b>${x[0]}</b><small>${x[1]}</small></div></button>`).join('')}</div><div class="prompt-card prompt-output-card"><div class="panel-label">${component.promptLevel===6?'Structure finale · réutilisable':'Prompt amélioré progressivement'}</div><pre class="prompt-output">${esc(promptForLevel(component.promptLevel))}</pre><div class="prompt-quality"><span>Spontané</span><div><i style="width:${Math.max(10,(component.promptLevel/6)*100)}%"></i></div><span>Structuré</span></div><div class="prompt-mini-tips"><span>Préciser le public</span><span>Définir le format</span><span>Demander les sources</span><span>Dire quoi exclure</span></div></div></div></article>`;
}

const toolUses={
  'Chat':['Question ponctuelle, brainstorming, reformulation, brouillon ou analyse rapide.','Moins adapté si le besoin doit conserver beaucoup de contexte sur la durée.'],
  'Recherche web':['Recherche, veille, comparaison de sources et investigation.','À éviter si l’analyse doit reposer exclusivement sur un corpus interne.'],
  'Espace de travail':['Projet suivi plusieurs semaines avec documents récurrents, contexte à conserver et travail continu.','Inutile pour une question unique très simple.'],
  'GPT':['Besoin récurrent avec les mêmes instructions, le même format de réponse et des connaissances spécifiques.','À éviter si le besoin change complètement à chaque demande.'],
  'Chatbot documentaire':['Interroger régulièrement un corpus interne et obtenir des réponses adossées aux documents.','Exemples : Supplier Quote · Méthodologie Cookstove. Nécessite des documents fiables et une gouvernance des sources.'],
  'Agent':['Besoin en plusieurs étapes : chercher → analyser → agir → vérifier.','À éviter pour une simple réponse textuelle ponctuelle.'],
  'Meeting Notes':['Transcription, compte rendu, décisions, responsables et deadlines.','À utiliser seulement lorsque les données de réunion peuvent être traitées.'],
  'Workflow':['Processus répétitif et suffisamment stable : nouveau document → analyse → extraction → création d’un fichier → notification.','À éviter tant que le processus change encore en permanence.']
};
function slideToolLandscape(){
  const current=component.toolUse||'Chat', info=toolUses[current];
  return `<article class="slide tool-v5"><div class="eyebrow">Quel outil IA pour quel besoin ?</div><h2>Quelle forme d’IA convient à mon besoin ?</h2><div class="tool-landscape tool-landscape-v5"><div class="tool-menu tool-menu-v5">${Object.keys(toolUses).map(k=>`<button class="${current===k?'active':''}" data-tool-use="${esc(k)}"><strong>${esc(k)}</strong></button>`).join('')}</div><div class="tool-detail tool-detail-v5"><span class="panel-label">${esc(current)}</span><h3>${esc(info[0])}</h3><p>${esc(info[1])}</p>${current==='Chatbot documentaire'?'<div class="example-pills big-pills"><span>Supplier Quote</span><span>Méthodologie Cookstove</span></div>':''}<div class="tool-note">Choisir l’outil après avoir défini le besoin, le niveau de risque, la durée du contexte et le degré d’automatisation attendu.</div></div></div></article>`;
}

function slideAgents(){
  const steps=['Demande','Recherche','Analyse','Action','Vérification','Résultat'];
  return `<article class="slide"><div class="eyebrow">Agents</div><h2>Un agent ne répond pas seulement : il enchaîne des étapes.</h2><div class="flow agent-flow">${steps.map((s,i)=>`${i?'<span class="flow-arrow">→</span>':''}<div class="flow-node">${s}</div>`).join('')}</div><div class="agent-example"><div class="glass-card"><div class="panel-label">Exemple</div><h3>« Prépare ma réunion client de demain. »</h3></div><div class="glass-card"><ol><li>Récupérer les informations pertinentes</li><li>Analyser les derniers échanges</li><li>Préparer un briefing</li><li>Identifier les points à traiter</li><li>Proposer les prochaines actions</li></ol></div></div></article>`;
}

const noteContent={
  'Résumé':['Le client veut accélérer le déploiement sur deux équipes.','Le principal frein reste la disponibilité des données.','Un pilote de 4 semaines est envisagé.'],
  'Actions':['Léa — envoyer la proposition de pilote — vendredi.','Marc — confirmer l’accès aux données — mardi.','Équipe projet — point de suivi — dans deux semaines.'],
  'Décisions':['Lancer un pilote limité à deux équipes.','Utiliser les données existantes sans migration initiale.','Mesurer gain de temps et qualité perçue.']
};
function slideMeeting(){
  return `<article class="slide"><div class="eyebrow">Meeting Notes</div><h2>45 minutes de réunion → une sortie exploitable.</h2><div class="meeting-demo"><div class="transcript"><div class="panel-label">Réunion · 45 min</div><p><b>09:04 — Léa :</b> Le client voudrait démarrer sur les équipes Nord et Grands Comptes…</p><p><b>09:12 — Marc :</b> Le point bloquant, c’est surtout l’accès aux données historiques…</p><p><b>09:27 — Sarah :</b> On pourrait proposer un pilote court, sans migration complète au départ…</p><p><b>09:41 — Léa :</b> Je prépare une proposition vendredi et on revalide dans deux semaines.</p></div><div class="ai-arrow">→ IA →</div><div class="notes-output"><div class="note-tabs">${Object.keys(noteContent).map(k=>`<button class="${component.noteTab===k?'active':''}" data-note="${k}">${k}</button>`).join('')}</div><div class="note-content"><ul>${noteContent[component.noteTab].map(x=>`<li>${x}</li>`).join('')}</ul></div></div></div></article>`;
}

function slideNextPriorities(){
  const id='nextPriority', def=definitions[id], agg=state.aggregates[id]||{total:0,counts:{}}, active=state.activeInteraction===id, show=active&&state.showResults;
  const all=(def.options||[]).map(([key,label],idx)=>({key,label,count:agg.counts[key]||0,idx}));
  const selectedTop=all.slice().sort((a,b)=>b.count-a.count).slice(0,3).sort((a,b)=>a.idx-b.idx);
  return `<article class="slide priorities-v5"><div class="eyebrow">Prochaines priorités</div><h2>${show?'Voici les trois pistes que nous retenons pour continuer à explorer.':'Quelles sont les pistes que nous voulons approfondir ?'}</h2>${show?`<div class="selected-projects-stage"><div class="selection-line"></div>${selectedTop.map((x,i)=>`<div class="selected-project project-${i+1}"><span>PRIORITÉ RETENUE</span><h3>${esc(x.label)}</h3><small>${x.count} vote${x.count>1?'s':''}</small></div>`).join('')}</div><p class="priority-footnote">Trois pistes, au même niveau. Pas de podium : l’objectif est de décider où poursuivre l’exploration.</p>`:`<p class="big-sub" style="font-size:18px">8 propositions · une personne = un choix.</p><div class="priority-orbit">${def.options.map(([k,l],i)=>`<div class="orbit-card orbit-${i+1}"><span>${String(i+1).padStart(2,'0')}</span><b>${esc(l)}</b></div>`).join('')}</div><div class="live-badge"><i></i>${active&&state.interactionOpen?'VOTE OUVERT':'Prêt à lancer'} · ${agg.total} réponse${agg.total>1?'s':''}</div>`}</article>`;
}

function slideFinal(){
  return `<article class="slide final-brand final-v5"><div class="eyebrow">Conclusion</div><h2>L’objectif n’est pas d’utiliser plus d’IA.</h2><div class="final-reveal">C’est de faciliter notre travail lorsque la tâche le permet.</div><p class="final-subtitle">L’IA à votre service au travail, mais pas l’inverse.</p><div class="loop-row"><span>Tester</span><span>→</span><span>Mesurer</span><span>→</span><span>Garder ce qui fonctionne</span><span>→</span><span>Automatiser</span></div><button class="btn primary" style="margin-top:28px;align-self:flex-start" data-goto="16">Voir le document source →</button></article>`;
}

function slideSourceDocument(){
  return `<article class="slide source-slide"><div class="eyebrow">Le document source</div><h2>Toute cette présentation a été construite à partir de ce document.</h2><div class="source-doc-grid"><div class="doc-preview"><img src="/docs/AI_Pulse_Cahier_Source_preview.png" alt="Aperçu du cahier source"></div><div class="source-copy"><span class="panel-label">Cahier de conception · v5</span><h3>Brief initial + objectifs + interactions + arbitrages + pédagogie + charte graphique + structure finale.</h3><p>Le document conserve aussi les demandes remplacées afin de garder la trace de l’élaboration. La version présentée applique les arbitrages les plus récents, y compris les dernières modifications demandées slide par slide.</p><div class="source-actions"><a class="btn primary" href="/docs/AI_Pulse_Cahier_Source.pdf" target="_blank">Ouvrir le PDF</a><a class="btn secondary" href="/docs/AI_Pulse_Cahier_Source.docx" target="_blank">Ouvrir le DOCX</a></div></div></div></article>`;
}

function bindSlideEvents(){
  document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>goSlide(Number(b.dataset.goto)));
  document.querySelectorAll('[data-flow]').forEach(b=>b.onclick=()=>{component.flow=b.dataset.flow;render();});
  document.querySelectorAll('[data-prompt-level]').forEach(b=>b.onclick=()=>{component.promptLevel=Number(b.dataset.promptLevel);render();});
      document.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>{component.noteTab=b.dataset.note;render();});
    document.querySelectorAll('[data-tool-use]').forEach(b=>b.onclick=()=>{component.toolUse=b.dataset.toolUse;render();});
}

function setupQr(){
  const box=document.getElementById('qrcode'); if(!box) return;
  const img=document.createElement('img');
  img.alt='QR code pour rejoindre la session';
  img.src=`/api/qr?text=${encodeURIComponent(participantUrl())}`;
  img.onerror=()=>{box.innerHTML='<div style="padding:16px;text-align:center">QR indisponible<br><small>Utilisez le lien ci-dessous</small></div>'};
  box.innerHTML=''; box.appendChild(img);
}

function showReaction(emoji){
  const stage=document.getElementById('stage'); if(!stage) return;
  const el=document.createElement('div'); el.className='reaction-float'; el.textContent=emoji; el.style.setProperty('--dx',`${Math.round((Math.random()-.5)*220)}px`); el.style.left=`${40+Math.random()*20}%`; stage.appendChild(el); setTimeout(()=>el.remove(),1600);
}

function renderParticipant(){
  const active=state.activeInteraction; const isOpen=state.interactionOpen;
  app.innerHTML=`<main class="participant-shell"><section class="participant-card"><div class="mobile-head"><div class="brand">AI Pulse</div><div class="session-mini">${esc(sessionId)}</div></div>${isOpen&&active?renderParticipantInteraction(active):renderWaiting()}<div class="privacy-note">Les réponses de cette session sont utilisées uniquement pour cet atelier interne. Aucune identité n’est associée aux réponses.</div>${renderReactionBar()}</section></main>`;
  bindParticipantEvents();
}
function renderWaiting(){
  return `<div class="mobile-panel waiting"><div class="wait-orb"></div><div class="eyebrow">Connecté à la session</div><h1>En attente de la prochaine interaction.</h1><p>La question apparaîtra automatiquement ici dès que le présentateur l’ouvrira.</p></div>`;
}

function renderParticipantInteraction(id){
  if(id==='ideaVote') return renderParticipantVote();
  const def=definitions[id]; if(!def) return renderWaiting();
  if(submitted[id] && def.type!=='multi') return renderSubmitted(id,def);
  const current=selected[id];
  let input='';
  if(def.type==='text') input=`<textarea class="mobile-textarea" id="ideaText" maxlength="200" placeholder="Une idée, en une phrase…">${esc(current||'')}</textarea><div class="char-count"><span id="charCount">${String(current||'').length}</span>/200</div>`;
  else input=`<div class="choice-list">${def.options.map(([key,label])=>{const isSel=def.type==='multi'?(current||[]).includes(key):current===key;return `<button class="choice ${isSel?'selected':''}" data-choice="${key}">${esc(label)}</button>`}).join('')}</div>`;
  return `<div class="mobile-panel"><div class="eyebrow">Question live</div><h1>${esc(def.question)}</h1>${input}<button class="btn primary mobile-submit" id="submitAnswer" ${!current || (Array.isArray(current)&&!current.length)?'disabled':''}>Envoyer ma réponse</button></div>`;
}

function renderSubmitted(id,def){
  const special=id==='retrievalCheck';
  return `<div class="mobile-panel waiting"><div class="success-mark">✓</div><div class="eyebrow">Réponse enregistrée</div><h1>Merci !</h1><p>${special?'Le débrief apparaîtra juste après sur l’écran principal : l’idée est de comprendre comment fonctionne la recherche documentaire, pas de faire un quiz.':'Vous pouvez modifier votre réponse tant que la question reste ouverte en rechargeant cette vue.'}</p>${state.showResults && def.type!=='text'?`<div style="margin-top:18px">${renderMobileBars(def,state.aggregates[id])}</div>`:''}</div>`;
}
function renderMobileBars(def,agg){
  return `<div class="result-list">${def.options.map(([id,label])=>`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px"><span>${esc(label)}</span><b>${pct(agg.counts[id]||0,agg.total)}%</b></div><div class="bar"><i style="width:${pct(agg.counts[id]||0,agg.total)}%"></i></div></div>`).join('')}</div>`;
}
function isQuiz(id){ return id==='retrievalCheck'; }

function renderParticipantVote(){
  const ideas=state.shortlistedIdeaIds.map(id=>state.ideas.find(x=>x.id===id)).filter(Boolean);
  const used=Object.values(voteAllocation).reduce((a,b)=>a+Number(b||0),0);
  return `<div class="mobile-panel"><div class="eyebrow">Vote collectif · 3 votes</div><h1>Où devons-nous investir notre énergie ?</h1><p>Répartissez jusqu’à trois votes entre les idées retenues.</p>${ideas.length?ideas.map(idea=>`<div class="vote-item"><p>${esc(idea.text)}</p><div class="vote-controls"><button data-vote-minus="${idea.id}">−</button><b>${voteAllocation[idea.id]||0}</b><button data-vote-plus="${idea.id}" ${used>=3?'disabled':''}>+</button></div></div>`).join(''):'<p>Aucune idée n’a encore été retenue pour le vote.</p>'}<button class="btn primary mobile-submit" id="submitVotes" ${used===0?'disabled':''}>Valider mes ${used} vote${used>1?'s':''}</button></div>`;
}

function renderReactionBar(){ return `<div class="reaction-bar">${['👍','❤️','💡','🤯'].map(e=>`<button data-reaction="${e}" aria-label="Réaction ${e}">${e}</button>`).join('')}</div>`; }

function bindParticipantEvents(){
  document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{
    const id=state.activeInteraction, def=definitions[id];
    if(def.type==='multi'){
      const set=new Set(selected[id]||[]); set.has(b.dataset.choice)?set.delete(b.dataset.choice):set.add(b.dataset.choice); selected[id]=[...set];
    }else selected[id]=b.dataset.choice;
    renderParticipant();
  });
  const txt=document.getElementById('ideaText');
  txt?.addEventListener('input',e=>{selected[state.activeInteraction]=e.target.value; document.getElementById('charCount').textContent=e.target.value.length; document.getElementById('submitAnswer').disabled=!e.target.value.trim();});
  document.getElementById('submitAnswer')?.addEventListener('click',submitAnswer);
  document.querySelectorAll('[data-reaction]').forEach(b=>b.onclick=()=>{ api(`/api/session/${encodeURIComponent(sessionId)}/reaction`,{method:'POST',body:JSON.stringify({emoji:b.dataset.reaction,anonId})}).catch(()=>{}); b.animate([{transform:'scale(1)'},{transform:'scale(1.25)'},{transform:'scale(1)'}],{duration:280}); });
  document.querySelectorAll('[data-vote-plus]').forEach(b=>b.onclick=()=>adjustVote(b.dataset.votePlus,1));
  document.querySelectorAll('[data-vote-minus]').forEach(b=>b.onclick=()=>adjustVote(b.dataset.voteMinus,-1));
  document.getElementById('submitVotes')?.addEventListener('click',submitVotes);
}
async function submitAnswer(){
  const id=state.activeInteraction; const answer=selected[id];
  try{ await api(`/api/session/${encodeURIComponent(sessionId)}/respond`,{method:'POST',body:JSON.stringify({interactionId:id,anonId,answer})}); submitted[id]=true; toast('Réponse enregistrée'); renderParticipant(); }catch(e){toast(e.message)}
}
function adjustVote(id,delta){
  const used=Object.values(voteAllocation).reduce((a,b)=>a+Number(b||0),0); const current=voteAllocation[id]||0;
  if(delta>0 && used>=3) return; voteAllocation[id]=Math.max(0,Math.min(3,current+delta)); renderParticipant();
}
async function submitVotes(){
  try{ await api(`/api/session/${encodeURIComponent(sessionId)}/vote`,{method:'POST',body:JSON.stringify({anonId,allocation:voteAllocation})}); submitted.ideaVote=true; toast('Votes enregistrés'); }catch(e){toast(e.message)}
}

init().catch(e=>{ app.innerHTML=`<main class="app-shell"><section class="role-gate"><div class="eyebrow">AI Pulse</div><h1>Impossible de charger la session.</h1><p>${esc(e.message)}</p></section></main>`; });
