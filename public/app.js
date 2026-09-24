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
let component = { flow:'prompt', promptLevel:0, role:'Commercial', noteTab:'Résumé', decision:null };
let submitted = {};
let selected = {};
let voteAllocation = {};
let anonId = null;

const slideInteraction = {
  2:'frequency', 3:'timeSaved', 4:'appetite', 5:'priorities', 13:'ideaWall', 15:'ideaVote', 16:'quizPrompt', 17:'quizAgent', 19:'finalTest'
};

const slideTitles = [
  'Introduction', 'Pourquoi sommes-nous ici ?', 'Fréquence d’usage', 'Temps gagné', 'Appétit pour l’automatisation', 'Priorités d’automatisation',
  'Dashboard collectif', 'Comment fonctionne l’IA ?', 'Prompt Lab', 'Folder / espace de travail', 'GPT spécialisé',
  'Agents', 'Meeting Notes', 'Mur des idées IA', 'Regroupement des idées', 'Vote sur les idées',
  'Mini quiz — Prompt', 'Mini quiz — Agent', 'Quel outil IA ?', 'Après cette session', 'Conclusion'
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
  const renderers=[slideIntro,slideObjectives,()=>slidePoll('frequency'),()=>slidePoll('timeSaved'),()=>slidePoll('appetite'),()=>slidePoll('priorities'),slideDashboard,slideHowAI,slidePromptLab,slideWorkspace,slideSpecialized,slideAgents,slideMeeting,slideIdeas,slideGrouping,slideIdeaVote,()=>slideQuiz('quizPrompt'),()=>slideQuiz('quizAgent'),slideDecision,()=>slidePoll('finalTest'),slideFinal];
  return renderers[i]?.() || '';
}

function slideIntro(){
  return `<article class="slide"><div class="hero-grid"><div><div class="eyebrow">Petit dej IA · AI Pulse</div><h1 class="glow-text">L’IA chez nous : où en sommes-nous et jusqu’où peut-on aller ?</h1><p class="big-sub">Une session interactive pour comprendre, tester et imaginer.</p><button class="btn primary" data-goto="1">Commencer →</button></div><div class="qr-card"><div class="qr-box" id="qrcode"></div><strong>Scannez pour rejoindre</strong><small>${esc(participantUrl())}</small></div></div></article>`;
}
function slideObjectives(){
  const cards=[['01','Prendre le pouls','Comprendre comment l’équipe utilise déjà l’IA.'],['02','Apprendre','Découvrir les bonnes pratiques et les nouvelles possibilités.'],['03','Imaginer','Identifier ensemble les automatisations les plus intéressantes.']];
  return `<article class="slide"><div class="eyebrow">Pourquoi sommes-nous ici ?</div><h2>Trois objectifs, une session très concrète.</h2><div class="objective-grid">${cards.map(c=>`<div class="feature-card"><div class="num">${c[0]}</div><h3>${c[1]}</h3><p>${c[2]}</p></div>`).join('')}</div></article>`;
}

function slidePoll(id){
  const def=definitions[id]; const agg=state.aggregates[id]||{total:0,counts:{}}; const active=state.activeInteraction===id; const show=active&&state.showResults;
  const label=id==='frequency'?'AI Pulse':id==='timeSaved'?'Impact perçu':id==='appetite'?"Appétit pour l’automatisation":id==='priorities'?"Priorités collectives":"Dernière interaction";
  let results='';
  if(id==='appetite' && show){ results=`<div class="gauge-wrap"><div class="gauge" style="--pct:${state.dashboard.appetiteScore}"><strong>${state.dashboard.appetiteScore}%</strong><span>appétit collectif</span></div></div>`; }
  else if(show) results=renderBars(def,agg,id==='priorities');
  else results=`<div class="placeholder-results"><div><strong>${active&&state.interactionOpen?'Le vote est ouvert':'Prêt à lancer'}</strong><p>${active&&state.interactionOpen?'Les résultats restent masqués jusqu’à votre signal.':'Ouvrez l’interaction depuis les contrôles présentateur.'}</p></div></div>`;
  return `<article class="slide"><div class="poll-shell"><div><div class="live-badge"><i></i>${active&&state.interactionOpen?'LIVE · vote ouvert':'Interaction'}</div><div class="eyebrow" style="margin-top:18px">${label}</div><h2 class="poll-title">${esc(def.question)}</h2><div class="response-count">${agg.total} réponse${agg.total>1?'s':''} · <span data-participants>${state.participantCount}</span> connecté${state.participantCount>1?'s':''}</div></div><div>${results}</div></div></article>`;
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
  const d=state.dashboard;
  const f=state.aggregates.frequency||{total:0,counts:{}};
  const t=state.aggregates.timeSaved||{total:0,counts:{}};
  const a=state.aggregates.appetite||{total:0,counts:{}};
  return `<article class="slide dashboard-slide"><div class="eyebrow">Synthèse live · vos réponses</div><h2>Voilà où nous en sommes.</h2><div class="dashboard-grid dashboard-rich">
    <div class="kpi"><strong>${d.daily}%</strong><span>utilisent l’IA au moins quotidiennement</span>${miniDistribution(definitions.frequency,f)}</div>
    <div class="kpi focus-time"><div class="focus-head"><span class="focus-icon">⌕</span><div><b>LOUPE · TEMPS GAGNÉ</b><small>estimation collective</small></div></div><strong>${d.avgMinutesSavedLabel}</strong><span>gagnées par jour en moyenne, d’après les réponses</span>${miniDistribution(definitions.timeSaved,t)}<div class="annualized">≈ ${d.annualHoursSaved} h / personne / an*</div></div>
    <div class="kpi"><strong>${d.wantsAuto}%</strong><span>souhaitent davantage d’automatisation</span><div class="gauge-line"><i style="width:${d.appetiteScore}%"></i></div><small>Indice d’appétit : ${d.appetiteScore}/100</small></div>
    <div class="kpi top-list"><strong style="font-size:18px;margin-bottom:8px">Top 3 des tâches à automatiser</strong>${d.top.length?d.top.map((x,i)=>`<div class="rank-item"><span class="rank">${i+1}</span><span class="rank-label">${esc(x.label)}</span><b>${x.count}</b></div>`).join(''):'<span>En attente de réponses.</span>'}</div>
    <div class="kpi research-card"><div class="panel-label">Ce que dit la recherche</div><h3>Le bon ordre de grandeur : des dizaines de minutes, pas un chiffre universel.</h3><div class="research-facts"><p><b>&gt; 30 min/jour</b> — les “power users” IA interrogés par Microsoft & LinkedIn déclarent dépasser ce seuil. <em>Work Trend Index, mai 2024.</em></p><p><b>≈ 2 h/semaine</b> — baisse du temps passé sur les e-mails chez les utilisateurs actifs dans une expérimentation sur 7 137 employés. <em>NBER, révision nov. 2025.</em></p><p><b>≈ 25% plus vite</b> — sur des tâches adaptées à l’IA chez 758 consultants BCG. <em>Harvard/BCG, 2023.</em></p></div></div>
    <div class="kpi role-bench"><div class="panel-label">Commercial / gestion de projet</div><p><b>Commercial :</b> la recherche McKinsey décrit surtout un déplacement du temps des tâches back-office vers le client ; son estimation porte sur <b>+3 à 5% de productivité commerciale</b>, pas sur un nombre de minutes universel.</p><p><b>Gestion de projet :</b> le repère le plus solide est celui des knowledge workers : e-mails, réunions, recherche et rédaction sont les postes où les gains ont été mesurés.</p><small>*Projection interne : moyenne pondérée de la question “temps gagné” × 220 jours ouvrés. “Plusieurs heures” est compté prudemment à 2 h/jour.</small></div>
  </div></article>`;
}

function slideHowAI(){
  const items=[['you','Vous','Vous formulez un objectif ou une question.'],['prompt','Prompt','La consigne précise ce que vous attendez.'],['context','Contexte / documents','Les informations utiles réduisent les ambiguïtés.'],['model','Modèle IA','Le modèle interprète, raisonne et génère une réponse.'],['result','Résultat','Vous vérifiez, corrigez et réutilisez le résultat.']];
  return `<article class="slide"><div class="eyebrow">Comprendre en 20 secondes</div><h2>Comment fonctionne l’IA ?</h2><div class="flow">${items.map((x,i)=>`${i?'<span class="flow-arrow">→</span>':''}<button class="flow-node ${component.flow===x[0]?'active':''}" data-flow="${x[0]}">${x[1]}</button>`).join('')}</div><div class="explain-box">${items.find(x=>x[0]===component.flow)?.[2]||items[0][2]}</div></article>`;
}

function promptForLevel(l){
  return [
    'Fais-moi un résumé.',
    'Résume ce document en faisant ressortir les informations importantes.',
    'Analyse ce document pour un directeur commercial et résume les 5 informations les plus importantes.',
    'Analyse ce document pour un directeur commercial. Résume les 5 informations les plus importantes et indique les risques.',
    'Analyse ce document pour un directeur commercial. Résume les 5 informations les plus importantes, indique les risques et termine par 3 actions recommandées. Réponds sous forme de tableau.'
  ][l];
}
function slidePromptLab(){
  const chips=['Objectif','Contexte','Format attendu','Contraintes'];
  return `<article class="slide"><div class="eyebrow">Training · Prompt Lab</div><h2>Un bon prompt réduit l’espace d’interprétation.</h2><div class="prompt-lab"><div class="prompt-card"><div class="panel-label">Construction</div><div class="block-row">${chips.map((c,i)=>`<span class="block-chip ${component.promptLevel>i?'on':''}">${c}</span>`).join('')}</div><input class="prompt-meter" id="promptRange" type="range" min="0" max="4" value="${component.promptLevel}"><p>Prompt vague ← → Prompt efficace</p></div><div class="prompt-card"><div class="panel-label">Prompt résultant</div><div class="prompt-output">${esc(promptForLevel(component.promptLevel))}</div></div></div></article>`;
}

function slideWorkspace(){
  const items={Instructions:'Définissent les règles permanentes de travail de l’espace.',Contexte:'Apporte les informations métier, objectifs et références utiles.',Documents:'Fournissent des sources à analyser et réutiliser.',Conversations:'Conservent la continuité du travail sur la durée.'};
  const active=component.workspace||'Instructions';
  return `<article class="slide"><div class="eyebrow">Training · Folder / Project</div><h2>Un espace de travail IA spécialisé garde le contexte.</h2><div class="workspace"><div class="stack">${Object.keys(items).map(k=>`<button class="stack-item" data-workspace="${k}">${k}</button>`).join('')}</div><div class="flow-arrow">→</div><div class="workspace-core"><div class="eyebrow">Espace spécialisé</div><h3 style="margin:10px 0">${active}</h3><p>${items[active]}</p></div></div></article>`;
}

const roleExamples={
  Commercial:['Préparer un briefing client','Rédiger une relance personnalisée','Analyser un pipeline'],
  Marketing:['Décliner une campagne','Synthétiser une veille','Préparer un brief créatif'],
  RH:['Préparer un entretien','Synthétiser des retours','Structurer une fiche de poste'],
  Finance:['Commenter un écart budget','Analyser un reporting','Préparer une note de synthèse'],
  Opérations:['Documenter un process','Identifier les irritants','Préparer un plan d’actions']
};
function slideSpecialized(){
  return `<article class="slide"><div class="eyebrow">Training · GPT / assistant spécialisé</div><h2>Le même moteur, mais avec un métier et des règles.</h2><div class="role-tabs">${Object.keys(roleExamples).map(r=>`<button class="role-tab ${component.role===r?'active':''}" data-role="${r}">${r}</button>`).join('')}</div><div class="compare-grid"><div class="compare-card"><div class="panel-label">Chat générique</div><h3>Part de zéro à chaque demande</h3><p>Vous devez redonner le contexte, le format et les règles importantes.</p></div><div class="compare-card specialized"><div class="panel-label">Assistant spécialisé · ${component.role}</div><h3>Préconfiguré pour un usage récurrent</h3><ul class="example-list">${roleExamples[component.role].map(x=>`<li>${x}</li>`).join('')}</ul></div></div></article>`;
}

function slideAgents(){
  const steps=['Demande','Recherche','Analyse','Action','Vérification','Résultat'];
  return `<article class="slide"><div class="eyebrow">Training · Agents</div><h2>Un agent enchaîne des étapes pour atteindre un objectif.</h2><div class="flow agent-flow">${steps.map((s,i)=>`${i?'<span class="flow-arrow">→</span>':''}<div class="flow-node">${s}</div>`).join('')}</div><div class="agent-example"><div class="glass-card"><div class="panel-label">Exemple</div><h3>« Prépare ma réunion client de demain. »</h3></div><div class="glass-card"><ol style="margin:0;padding-left:20px;line-height:1.65;color:#dce9f6"><li>Récupérer les informations pertinentes</li><li>Analyser les derniers échanges</li><li>Préparer un briefing</li><li>Identifier les points à traiter</li><li>Proposer les prochaines actions</li></ol></div></div></article>`;
}

const noteContent={
  'Résumé':['Le client veut accélérer le déploiement sur deux équipes.','Le principal frein reste la disponibilité des données.','Un pilote de 4 semaines est envisagé.'],
  'Actions':['Léa envoie la proposition de pilote vendredi.','Marc confirme l’accès aux données mardi.','Prévoir un point de suivi dans deux semaines.'],
  'Décisions':['Lancer un pilote limité à deux équipes.','Utiliser les données existantes sans migration initiale.','Mesurer gain de temps et qualité perçue.']
};
function slideMeeting(){
  return `<article class="slide"><div class="eyebrow">Training · Meeting Notes</div><h2>45 minutes de réunion → une sortie exploitable.</h2><div class="meeting-demo"><div class="transcript"><div class="panel-label">Réunion · 45 min</div><p><b>09:04 — Léa :</b> Le client voudrait démarrer sur les équipes Nord et Grands Comptes…</p><p><b>09:12 — Marc :</b> Le point bloquant, c’est surtout l’accès aux données historiques…</p><p><b>09:27 — Sarah :</b> On pourrait proposer un pilote court, sans migration complète au départ…</p><p><b>09:41 — Léa :</b> Je prépare une proposition vendredi et on revalide dans deux semaines.</p></div><div class="ai-arrow">→ IA →</div><div class="notes-output"><div class="note-tabs">${Object.keys(noteContent).map(k=>`<button class="${component.noteTab===k?'active':''}" data-note="${k}">${k}</button>`).join('')}</div><div class="note-content"><ul>${noteContent[component.noteTab].map(x=>`<li>${x}</li>`).join('')}</ul></div></div></div></article>`;
}

function slideIdeas(){
  const active=state.activeInteraction==='ideaWall'&&state.interactionOpen;
  return `<article class="slide"><div class="eyebrow">Interaction · Mur des idées IA</div><h2>Si tu pouvais automatiser UNE chose demain avec l’IA, ce serait quoi ?</h2><div class="live-badge"><i></i>${active?'Collecte ouverte':'Collecte fermée'} · ${state.ideas.length} idée${state.ideas.length>1?'s':''}</div><div class="idea-grid">${state.ideas.length?state.ideas.map((idea,i)=>`<div class="idea-card ${idea.demo?'demo':''}" style="animation-delay:${Math.min(i,12)*25}ms"><p>${esc(idea.text)}</p><button class="shortlist-btn ${state.shortlistedIdeaIds.includes(idea.id)?'on':''}" data-shortlist="${idea.id}" title="Retenir pour le vote">★</button></div>`).join(''):'<div class="placeholder-results" style="grid-column:1/-1">Les idées apparaîtront ici en direct.</div>'}</div></article>`;
}

function wordCloud(){
  const stop=new Set('avec dans pour une les des que qui sur aux ces cette mon mes notre votre leur plus tout tous faire fait être avoir est sont de du la le et à au un en ce ça se si ou par comme demain ia automatiser automatisation automatiquement'.split(' '));
  const counts={};
  for(const idea of state.ideas){
    const words=idea.text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]{4,}/g)||[];
    for(const w of words){ if(!stop.has(w)) counts[w]=(counts[w]||0)+1; }
  }
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,18);
  const max=Math.max(1,...top.map(x=>x[1]));
  return top.map(([w,n],i)=>`<span style="font-size:${14+Math.round(n/max*18)}px;opacity:${.55+n/max*.45};margin:5px 8px;display:inline-block">${esc(w)}</span>`).join('');
}

function slideGrouping(){
  if(!groupsCache.length) fetchGroups();
  return `<article class="slide"><div class="eyebrow">Regroupement assisté</div><h2>Faire émerger les thèmes sans simuler une analyse IA.</h2><p class="big-sub" style="font-size:18px">Le MVP utilise un regroupement déterministe par mots-clés. Il peut être remplacé plus tard par un modèle IA validé.</p><div class="group-grid">${groupsCache.length?groupsCache.map(g=>`<div class="group-card"><strong>${esc(g.label)}</strong><span>${g.ideas.length} idée${g.ideas.length>1?'s':''}</span></div>`).join(''):'<div class="placeholder-results" style="grid-column:1/-1">Analyse des thèmes…</div>'}</div><div class="glass-card" style="margin-top:14px;min-height:110px"><div class="panel-label">Nuage de mots</div><div style="text-align:center;line-height:1.15">${wordCloud()||'<span style="color:var(--muted)">En attente de suffisamment d’idées.</span>'}</div></div></article>`;
}
async function fetchGroups(){
  try{ groupsCache=await api(`/api/session/${encodeURIComponent(sessionId)}/groups`); if(state.slideIndex===13) render(); }catch{}
}

function slideIdeaVote(){
  const ideas=state.shortlistedIdeaIds.map(id=>state.ideas.find(x=>x.id===id)).filter(Boolean);
  const ranked=[...ideas].sort((a,b)=>(state.ideaVoteTotals[b.id]||0)-(state.ideaVoteTotals[a.id]||0));
  const medals=['🥇','🥈','🥉'];
  return `<article class="slide"><div class="eyebrow">Vote collectif</div><h2>Où devons-nous investir notre énergie ?</h2><div class="medal-list">${ranked.length?ranked.map((idea,i)=>`<div class="medal-row"><span class="medal">${medals[i]||'•'}</span><span>${esc(idea.text)}</span><b>${state.ideaVoteTotals[idea.id]||0}</b></div>`).join(''):'<div class="placeholder-results">Sélectionnez d’abord des idées avec ★ sur le mur.</div>'}</div></article>`;
}

function slideQuiz(id){
  const def=definitions[id], agg=state.aggregates[id]; const show=state.activeInteraction===id&&state.showResults;
  return `<article class="slide"><div class="eyebrow">Mini quiz</div><h2>${esc(def.question)}</h2><div style="margin-top:14px">${show?renderBars(def,agg,false):`<div class="placeholder-results"><div><strong>${state.activeInteraction===id&&state.interactionOpen?'Question ouverte sur les téléphones':'Prêt à lancer'}</strong><p>Après réponse, chaque participant voit immédiatement l’explication.</p></div></div>`}</div><div class="quiz-reveal"><b>Idée clé :</b> ${id==='quizPrompt'?'Le contexte utile compte davantage que la longueur ou le jargon.':'Un agent devient pertinent quand il doit enchaîner plusieurs étapes, outils ou vérifications.'}</div></article>`;
}

const decisionMap={
  'Poser une question ponctuelle':['Chat','Idéal pour une demande isolée et rapide.'],
  'Travailler sur un sujet pendant plusieurs semaines':['Folder / Project','Gardez documents, contexte et conversations au même endroit.'],
  'Créer un assistant réutilisable':['GPT / assistant spécialisé','Préconfigurez instructions, connaissances et format de réponse.'],
  'Automatiser plusieurs étapes':['Agent','Enchaînez recherche, analyse, action et vérification.'],
  'Exploiter des notes de réunion':['Meeting Notes','Transformez une réunion en résumé, décisions et actions.']
};
function slideDecision(){
  const current=component.decision||Object.keys(decisionMap)[0]; const reco=decisionMap[current];
  return `<article class="slide"><div class="eyebrow">Quel outil IA pour mon besoin ?</div><h2>Commencez par le type de travail à accomplir.</h2><div class="decision-grid"><div class="decision-options">${Object.keys(decisionMap).map(k=>`<button class="${current===k?'active':''}" data-decision="${esc(k)}">${esc(k)}</button>`).join('')}</div><div class="reco-box"><div class="panel-label">À privilégier</div><div class="tool">${reco[0]}</div><p>${reco[1]}</p></div></div></article>`;
}

function slideFinal(){
  return `<article class="slide"><div class="eyebrow">Conclusion</div><h2>L’objectif n’est pas d’utiliser plus d’IA.</h2><div class="final-reveal glow-text">C’est de supprimer davantage de travail sans valeur.</div><div class="loop-row"><span>Tester</span><span>→</span><span>Mesurer</span><span>→</span><span>Garder ce qui fonctionne</span><span>→</span><span>Automatiser</span></div><button class="btn primary" style="margin-top:28px;align-self:flex-start" data-goto="13">Proposer une idée IA</button></article>`;
}

function bindSlideEvents(){
  document.querySelectorAll('[data-goto]').forEach(b=>b.onclick=()=>goSlide(Number(b.dataset.goto)));
  document.querySelectorAll('[data-flow]').forEach(b=>b.onclick=()=>{component.flow=b.dataset.flow;render();});
  document.getElementById('promptRange')?.addEventListener('input',e=>{component.promptLevel=Number(e.target.value);render();});
  document.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=()=>{component.workspace=b.dataset.workspace;render();});
  document.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>{component.role=b.dataset.role;render();});
  document.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>{component.noteTab=b.dataset.note;render();});
  document.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>{component.decision=b.dataset.decision;render();});
  document.querySelectorAll('[data-shortlist]').forEach(b=>b.onclick=()=>presenterAction({type:'toggleShortlist',ideaId:b.dataset.shortlist}));
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
  return `<div class="mobile-panel"><div class="eyebrow">Question live</div><h1>${esc(def.question)}</h1>${input}<button class="btn primary mobile-submit" id="submitAnswer" ${!current || (Array.isArray(current)&&!current.length)?'disabled':''}>Envoyer ma réponse</button>${isQuiz(id)?'<p style="font-size:12px">La bonne explication sera révélée juste après votre réponse.</p>':''}</div>`;
}

function renderSubmitted(id,def){
  const isQ=isQuiz(id); const answer=selected[id]; const correct=isQ?answer===def.correct:null;
  return `<div class="mobile-panel waiting"><div class="success-mark">${isQ?(correct?'✓':'→'):'✓'}</div><div class="eyebrow">Réponse enregistrée</div><h1>${isQ?(correct?'Bonne réponse.':'Merci — voici le point clé.'):'Merci !'}</h1><p>${isQ?(id==='quizPrompt'?'Donner du contexte utile est généralement plus important que rallonger le prompt ou employer du jargon.':'Un agent est surtout utile lorsqu’une demande nécessite plusieurs étapes successives, parfois avec des outils et des vérifications.'):'Vous pouvez modifier votre réponse tant que la question reste ouverte en rechargeant cette vue.'}</p>${state.showResults && def.type!=='text'?`<div style="margin-top:18px">${renderMobileBars(def,state.aggregates[id])}</div>`:''}</div>`;
}
function renderMobileBars(def,agg){
  return `<div class="result-list">${def.options.map(([id,label])=>`<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px"><span>${esc(label)}</span><b>${pct(agg.counts[id]||0,agg.total)}%</b></div><div class="bar"><i style="width:${pct(agg.counts[id]||0,agg.total)}%"></i></div></div>`).join('')}</div>`;
}
function isQuiz(id){ return id==='quizPrompt'||id==='quizAgent'; }

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
