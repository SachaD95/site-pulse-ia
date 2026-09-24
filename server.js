const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');
const QRCode = require('./lib/qrcode');
const QRErrorCorrectLevel = require('./lib/qrcode/QRErrorCorrectLevel');

const PORT = process.env.PORT || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'sessions.json');
const sseClients = new Map();

const interactionDefinitions = {
  frequency: {
    type: 'single',
    question: "À quelle fréquence utilisez-vous l’IA ?",
    options: [
      ['rarely', 'Rarement'],
      ['daily1', 'Environ 1 fois par jour'],
      ['daily5', 'Environ 5 fois par jour'],
      ['daily10', 'Plus de 10 fois par jour']
    ]
  },
  timeSaved: {
    type: 'single',
    question: "Combien de temps avez-vous l’impression que l’IA vous fait gagner chaque jour ?",
    options: [
      ['min10', 'Environ 10 min / jour'],
      ['min30', 'Environ 30 min / jour'],
      ['hour1', 'Environ 1 h / jour'],
      ['hours', 'Plusieurs heures / jour']
    ]
  },
  appetite: {
    type: 'single',
    question: "J’aimerais automatiser davantage certaines tâches avec l’IA.",
    options: [
      ['no', 'Pas spécialement'],
      ['some', 'Oui, quelques tâches'],
      ['more', 'Beaucoup plus'],
      ['allin', 'Absolument 🚀']
    ]
  },
  priorities: {
    type: 'multi',
    question: "Qu’aimeriez-vous automatiser en priorité ?",
    options: [
      ['meetings', 'Comptes-rendus de réunions'],
      ['emails', 'Emails'],
      ['research', 'Recherche documentaire'],
      ['excel', 'Excel / reporting'],
      ['slides', 'Création de présentations'],
      ['docs', 'Analyse de documents'],
      ['chatbot', 'Chatbot interne'],
      ['prep', 'Préparation de réunions'],
      ['repetitive', 'Tâches répétitives'],
      ['other', 'Autre']
    ]
  },
  retrievalCheck: {
    type: 'single',
    question: "Dans un assistant documentaire basé sur la recherche de passages, cette information sera-t-elle forcément retrouvée ?",
    options: [
      ['yes', 'Oui, forcément'],
      ['no', 'Non, pas forcément']
    ],
    correct: 'no'
  },
  nextPriority: {
    type: 'single',
    question: "Quelle priorité IA devrions-nous approfondir ensuite ?",
    options: [
      ['supplierQuote', 'Supplier Quote'],
      ['cookstove', 'Assistant méthodologie cookstove'],
      ['meetingNotes', 'Meeting Notes automatiques'],
      ['docSearch', 'Recherche documentaire interne'],
      ['reporting', 'Reporting / Excel'],
      ['meetingPrep', 'Préparation de réunions / rendez-vous'],
      ['emails', 'Brouillons d’e-mails / communications'],
      ['workflow', 'Workflow opérationnel répétitif']
    ]
  }
};

function readSessions() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '{}'); }
  catch { return {}; }
}

let sessions = readSessions();

function persist() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(sessions, null, 2));
}

function defaultSessionId() {
  const d = new Date();
  return `AI-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function networkOrigins() {
  const origins = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const n of entries || []) {
      if (n.family === 'IPv4' && !n.internal) origins.push(`http://${n.address}:${PORT}`);
    }
  }
  return origins;
}

function newSession(id = defaultSessionId()) {
  const uniqueId = sessions[id] ? `${id}-${crypto.randomBytes(2).toString('hex').toUpperCase()}` : id;
  const presenterKey = crypto.randomBytes(8).toString('hex');
  const session = {
    id: uniqueId,
    presenterKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slideIndex: 0,
    activeInteraction: null,
    interactionOpen: false,
    showResults: false,
    timerEndsAt: null,
    responses: {},
    participants: {},
    ideas: [],
    shortlistedIdeaIds: [],
    ideaVotes: {},
    demoLoaded: false
  };
  sessions[uniqueId] = session;
  persist();
  return session;
}

if (!Object.keys(sessions).length) {
  const s = newSession();
  console.log(`\nAI Pulse prêt.\nPrésentateur: http://localhost:${PORT}/?mode=presenter&session=${encodeURIComponent(s.id)}&key=${s.presenterKey}\nParticipant:  http://localhost:${PORT}/?mode=participant&session=${encodeURIComponent(s.id)}\n`);
} else {
  const s = Object.values(sessions)[0];
  console.log(`\nAI Pulse prêt.\nPrésentateur: http://localhost:${PORT}/?mode=presenter&session=${encodeURIComponent(s.id)}&key=${s.presenterKey}\nParticipant:  http://localhost:${PORT}/?mode=participant&session=${encodeURIComponent(s.id)}\n`);
}

function touch(session) {
  session.updatedAt = new Date().toISOString();
  persist();
  broadcast(session.id, 'state', publicState(session, true));
}

function isPresenter(session, url, body = {}) {
  const key = body.key || url.searchParams.get('key') || '';
  return key && key === session.presenterKey;
}

function participantCount(session) {
  const now = Date.now();
  const live = Object.values(session.participants || {}).filter(ts => now - ts < 90_000).length;
  return session.demoLoaded ? Math.max(28, live) : live;
}

function aggregateInteraction(session, id) {
  const def = interactionDefinitions[id];
  const res = session.responses[id] || {};
  if (!def) return { total: 0, counts: {} };
  const counts = {};
  (def.options || []).forEach(([key]) => counts[key] = 0);
  let total = 0;
  for (const answer of Object.values(res)) {
    total += 1;
    if (Array.isArray(answer)) answer.forEach(v => { if (counts[v] !== undefined) counts[v] += 1; });
    else if (counts[answer] !== undefined) counts[answer] += 1;
  }
  return { total, counts };
}

function dashboard(session) {
  const f = aggregateInteraction(session, 'frequency');
  const t = aggregateInteraction(session, 'timeSaved');
  const a = aggregateInteraction(session, 'appetite');
  const p = aggregateInteraction(session, 'priorities');
  const daily = f.total ? Math.round(((f.counts.daily1 + f.counts.daily5 + f.counts.daily10) / f.total) * 100) : 0;
  const wantsAuto = a.total ? Math.round(((a.counts.some + a.counts.more + a.counts.allin) / a.total) * 100) : 0;
  const appetiteScore = a.total ? Math.round(((a.counts.some * 33 + a.counts.more * 67 + a.counts.allin * 100) / a.total)) : 0;
  const freqScore = f.total ? Math.round(((f.counts.daily1 * 35 + f.counts.daily5 * 70 + f.counts.daily10 * 100) / f.total)) : 0;
  const maturity = Math.round(freqScore * 0.6 + appetiteScore * 0.4);
  const savedMinutes = t.total ? Math.round((t.counts.min10 * 10 + t.counts.min30 * 30 + t.counts.hour1 * 60 + t.counts.hours * 120) / t.total) : 0;
  const avgMinutesSavedLabel = savedMinutes >= 60 ? `${(savedMinutes/60).toFixed(savedMinutes%60?1:0).replace('.',',')} h` : `${savedMinutes} min`;
  const annualHoursSaved = Math.round(savedMinutes * 220 / 60);
  const labels = Object.fromEntries((interactionDefinitions.priorities.options || []).map(([k, v]) => [k, v]));
  const top = Object.entries(p.counts).sort((x,y) => y[1] - x[1]).slice(0,3).map(([id, count]) => ({ id, label: labels[id], count }));
  return { daily, wantsAuto, appetiteScore, freqScore, maturity, top, savedMinutes, avgMinutesSavedLabel, annualHoursSaved };
}

function publicState(session, presenter = false) {
  const aggregates = {};
  for (const id of Object.keys(interactionDefinitions)) aggregates[id] = aggregateInteraction(session, id);
  const base = {
    id: session.id,
    slideIndex: session.slideIndex,
    activeInteraction: session.activeInteraction,
    interactionOpen: session.interactionOpen,
    showResults: session.showResults,
    timerEndsAt: session.timerEndsAt,
    participantCount: participantCount(session),
    aggregates,
    dashboard: dashboard(session),
    ideas: session.ideas.map(({ id, text, createdAt, demo }) => ({ id, text, createdAt, demo })),
    shortlistedIdeaIds: session.shortlistedIdeaIds,
    ideaVoteTotals: voteTotals(session),
    demoLoaded: session.demoLoaded
  };
  if (presenter) base.presenterKey = session.presenterKey;
  return base;
}

function voteTotals(session) {
  const totals = {};
  session.shortlistedIdeaIds.forEach(id => totals[id] = 0);
  for (const allocation of Object.values(session.ideaVotes || {})) {
    for (const [id, count] of Object.entries(allocation || {})) totals[id] = (totals[id] || 0) + Number(count || 0);
  }
  return totals;
}

function qrSvg(text) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(String(text).slice(0, 512));
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const size = n + quiet * 2;
  let pathData = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        const x = c + quiet, y = r + quiet;
        pathData += `M${x} ${y}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${pathData}" fill="#06101c"/></svg>`;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
  });
}

function broadcast(sessionId, event, data) {
  const set = sseClients.get(sessionId);
  if (!set) return;
  const packet = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(packet);
}

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  file = path.normalize(file).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(PUBLIC_DIR, file);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json; charset=utf-8', '.pdf':'application/pdf', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function makeDemoResponses() {
  const ids = Array.from({length: 28}, (_,i) => `demo-${i+1}`);
  const frequencyVals = ['rarely','daily1','daily1','daily5','daily5','daily5','daily10'];
  const timeSavedVals = ['min10','min30','min30','hour1','hour1','hours','min30'];
  const appetiteVals = ['no','some','some','more','more','allin','allin'];
  const priorityVals = [
    ['meetings','emails','prep'], ['excel','repetitive'], ['docs','research'], ['meetings','slides'],
    ['emails','repetitive'], ['excel','docs','research'], ['meetings','prep','repetitive']
  ];
  const nextVals = ['supplierQuote','cookstove','meetingNotes','docSearch','reporting','meetingPrep','emails','workflow'];
  return {
    frequency: Object.fromEntries(ids.map((id,i) => [id, frequencyVals[i % frequencyVals.length]])),
    timeSaved: Object.fromEntries(ids.map((id,i) => [id, timeSavedVals[i % timeSavedVals.length]])),
    appetite: Object.fromEntries(ids.map((id,i) => [id, appetiteVals[i % appetiteVals.length]])),
    priorities: Object.fromEntries(ids.map((id,i) => [id, priorityVals[i % priorityVals.length]])),
    retrievalCheck: Object.fromEntries(ids.slice(0,24).map((id,i) => [id, i % 4 === 0 ? 'yes' : 'no'])),
    nextPriority: Object.fromEntries(ids.slice(0,26).map((id,i) => [id, nextVals[(i*i + i) % nextVals.length]]))
  };
}

function loadDemo(session) {
  session.responses = makeDemoResponses();
  const demoIds = Array.from({length:28}, (_,i) => `demo-${i+1}`);
  demoIds.forEach((id,i) => session.participants[id] = Date.now() - i*1000);
  session.ideas = [];
  session.shortlistedIdeaIds = [];
  session.ideaVotes = {};
  session.demoLoaded = true;
}

function classifyIdeas(session) {
  const groups = [
    ['Réunions', /réunion|meeting|compte.?rendu|brief|rendez-vous|rdv/i],
    ['Reporting', /report|excel|tableau|kpi|donnée|dashboard/i],
    ['Recherche', /recherche|chercher|document|procédure|veille/i],
    ['Communication', /email|mail|message|réponse|communication/i],
    ['Création de contenu', /présentation|slide|contenu|rédig|post|création/i],
    ['Automatisation opérationnelle', /automatis|tâche|workflow|contrat|action|mise à jour/i]
  ];
  return groups.map(([label, re]) => ({
    label,
    ideas: session.ideas.filter(i => re.test(i.text)).map(i => i.id)
  })).filter(g => g.ideas.length);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  const joinMatch = pathname.match(/^\/join\/([^/]+)$/);
  if ((req.method === 'GET' || req.method === 'HEAD') && joinMatch) {
    const target = `/?mode=participant&session=${encodeURIComponent(joinMatch[1])}`;
    res.writeHead(302, { Location: target, 'Cache-Control':'no-store' });
    return res.end();
  }

  if (req.method === 'GET' && pathname === '/api/meta') {
    return sendJson(res, 200, { networkOrigins: networkOrigins() });
  }

  if (req.method === 'GET' && pathname === '/api/qr') {
    const text = url.searchParams.get('text') || '';
    if (!text) return sendJson(res, 400, { error:'Texte QR manquant' });
    const svg = qrSvg(text);
    res.writeHead(200, { 'Content-Type':'image/svg+xml; charset=utf-8', 'Cache-Control':'no-store' });
    return res.end(svg);
  }

  if (req.method === 'GET' && pathname === '/api/sessions') {
    const list = Object.values(sessions).map(s => ({ id:s.id, createdAt:s.createdAt, updatedAt:s.updatedAt }));
    return sendJson(res, 200, list);
  }

  if (req.method === 'POST' && pathname === '/api/sessions') {
    const body = await parseBody(req).catch(() => ({}));
    const s = newSession((body.id || defaultSessionId()).replace(/[^A-Za-z0-9_-]/g,'').slice(0,32) || defaultSessionId());
    return sendJson(res, 201, { id:s.id, presenterKey:s.presenterKey });
  }

  const match = pathname.match(/^\/api\/session\/([^/]+)(?:\/(.*))?$/);
  if (match) {
    const id = match[1];
    const actionPath = match[2] || '';
    const session = sessions[id];
    if (!session) return sendJson(res, 404, { error:'Session introuvable' });

    if (req.method === 'GET' && actionPath === 'events') {
      res.writeHead(200, {
        'Content-Type':'text/event-stream',
        'Cache-Control':'no-cache',
        'Connection':'keep-alive',
        'Access-Control-Allow-Origin':'*'
      });
      res.write(`event: state\ndata: ${JSON.stringify(publicState(session, isPresenter(session,url)))}\n\n`);
      if (!sseClients.has(id)) sseClients.set(id, new Set());
      sseClients.get(id).add(res);
      req.on('close', () => sseClients.get(id)?.delete(res));
      return;
    }

    if (req.method === 'GET' && actionPath === '') {
      return sendJson(res, 200, publicState(session, isPresenter(session,url)));
    }

    if (req.method === 'GET' && actionPath === 'definitions') {
      return sendJson(res, 200, interactionDefinitions);
    }

    if (req.method === 'GET' && actionPath === 'groups') {
      return sendJson(res, 200, classifyIdeas(session));
    }

    if (req.method === 'POST' && actionPath === 'heartbeat') {
      const body = await parseBody(req).catch(() => ({}));
      if (body.anonId) {
        session.participants[String(body.anonId).slice(0,80)] = Date.now();
        session.updatedAt = new Date().toISOString();
        persist();
        broadcast(id, 'presence', { participantCount: participantCount(session) });
      }
      return sendJson(res, 200, { ok:true, participantCount: participantCount(session) });
    }

    if (req.method === 'POST' && actionPath === 'respond') {
      const body = await parseBody(req).catch(() => ({}));
      const interactionId = body.interactionId;
      const anonId = String(body.anonId || '').slice(0,80);
      const def = interactionDefinitions[interactionId];
      if (!def || !anonId) return sendJson(res, 400, { error:'Réponse invalide' });
      if (!session.interactionOpen || session.activeInteraction !== interactionId) return sendJson(res, 409, { error:'Cette interaction est fermée' });
      session.responses[interactionId] ||= {};
      if (def.type === 'text') {
        const text = String(body.answer || '').trim().slice(0,200);
        if (!text) return sendJson(res, 400, { error:'Réponse vide' });
        const existing = session.ideas.find(i => i.anonId === anonId);
        if (existing) existing.text = text;
        else session.ideas.push({ id: crypto.randomBytes(6).toString('hex'), anonId, text, createdAt:new Date().toISOString(), demo:false });
        session.responses[interactionId][anonId] = 'submitted';
      } else {
        const valid = new Set((def.options || []).map(x => x[0]));
        let answer = body.answer;
        if (def.type === 'multi') answer = Array.isArray(answer) ? answer.filter(v => valid.has(v)) : [];
        else if (!valid.has(answer)) return sendJson(res, 400, { error:'Option invalide' });
        session.responses[interactionId][anonId] = answer;
      }
      session.participants[anonId] = Date.now();
      touch(session);
      return sendJson(res, 200, { ok:true, aggregate:aggregateInteraction(session,interactionId) });
    }

    if (req.method === 'POST' && actionPath === 'vote') {
      const body = await parseBody(req).catch(() => ({}));
      const anonId = String(body.anonId || '').slice(0,80);
      const allocation = body.allocation || {};
      const allowed = new Set(session.shortlistedIdeaIds);
      let total = 0;
      const clean = {};
      for (const [ideaId, raw] of Object.entries(allocation)) {
        if (!allowed.has(ideaId)) continue;
        const count = Math.max(0, Math.min(3, Number(raw) || 0));
        total += count;
        clean[ideaId] = count;
      }
      if (!anonId || total > 3) return sendJson(res, 400, { error:'Maximum 3 votes' });
      session.ideaVotes[anonId] = clean;
      touch(session);
      return sendJson(res, 200, { ok:true, totals:voteTotals(session) });
    }

    if (req.method === 'POST' && actionPath === 'reaction') {
      const body = await parseBody(req).catch(() => ({}));
      const allowed = new Set(['👍','❤️','💡','🤯']);
      if (allowed.has(body.emoji)) broadcast(id, 'reaction', { emoji:body.emoji, at:Date.now() });
      return sendJson(res, 200, { ok:true });
    }

    if (req.method === 'POST' && actionPath === 'action') {
      const body = await parseBody(req).catch(() => ({}));
      if (!isPresenter(session,url,body)) return sendJson(res, 403, { error:'Accès présentateur requis' });
      const type = body.type;
      if (type === 'setSlide') session.slideIndex = Math.max(0, Math.min(16, Number(body.slideIndex) || 0));
      if (type === 'openInteraction') {
        session.activeInteraction = body.interactionId || null;
        session.interactionOpen = Boolean(body.interactionId);
        session.showResults = false;
      }
      if (type === 'closeInteraction') session.interactionOpen = false;
      if (type === 'toggleResults') session.showResults = Boolean(body.show);
      if (type === 'startTimer') session.timerEndsAt = Date.now() + Math.max(5, Math.min(600, Number(body.seconds) || 30)) * 1000;
      if (type === 'stopTimer') session.timerEndsAt = null;
      if (type === 'toggleShortlist') {
        const ideaId = body.ideaId;
        if (session.ideas.some(i => i.id === ideaId)) {
          const set = new Set(session.shortlistedIdeaIds);
          set.has(ideaId) ? set.delete(ideaId) : set.add(ideaId);
          session.shortlistedIdeaIds = [...set].slice(0,8);
        }
      }
      if (type === 'loadDemo') loadDemo(session);
      if (type === 'reset') {
        session.slideIndex = 0;
        session.activeInteraction = null;
        session.interactionOpen = false;
        session.showResults = false;
        session.timerEndsAt = null;
        session.responses = {};
        session.participants = {};
        session.ideas = [];
        session.shortlistedIdeaIds = [];
        session.ideaVotes = {};
        session.demoLoaded = false;
      }
      touch(session);
      return sendJson(res, 200, publicState(session,true));
    }

    if (req.method === 'GET' && actionPath === 'export.csv') {
      if (!isPresenter(session,url)) return sendJson(res, 403, { error:'Accès présentateur requis' });
      const rows = [['type','interaction','participant_anonyme','valeur']];
      for (const [iid, answers] of Object.entries(session.responses)) {
        for (const [anon, answer] of Object.entries(answers)) rows.push(['response',iid,anon,Array.isArray(answer)?answer.join('|'):answer]);
      }
      for (const idea of session.ideas) rows.push(['idea','ideaWall',idea.anonId || 'demo',idea.text]);
      for (const [anon, alloc] of Object.entries(session.ideaVotes)) rows.push(['vote','ideas',anon,Object.entries(alloc).map(([id,n])=>`${id}:${n}`).join('|')]);
      const csv = rows.map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
      res.writeHead(200, {'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${session.id}-export.csv"`});
      return res.end('\ufeff' + csv);
    }
  }

  if (req.method === 'GET' && serveStatic(req,res,pathname)) return;
  sendJson(res, 404, { error:'Introuvable' });
});

server.listen(PORT, HOST, () => {
  console.log(`Serveur sur http://${HOST}:${PORT}`);
  for (const origin of networkOrigins()) console.log(`Réseau local: ${origin}`);
});
