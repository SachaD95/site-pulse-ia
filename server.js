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

const SLIDE_COUNT = 5;

const interactionDefinitions = {
  associations: {
    type: 'text',
    question: 'What comes to mind when you think about AI?',
    placeholder: 'Type one word or short phrase...',
    maxLength: 80
  },
  timeSaved: {
    type: 'single',
    question: 'How many hours does AI save you per week?',
    options: [
      ['h1', '1 hour / week'],
      ['h2', '2 hours / week'],
      ['h4', '4 hours / week'],
      ['h8', '8 hours / week']
    ]
  },
  retrievalCheck: {
    type: 'single',
    question: 'Will the chat find the correct delivery date?',
    options: [
      ['yes', 'Yes, definitely'],
      ['no', 'No, not necessarily']
    ],
    correct: 'no'
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
  console.log(`\nAI Pulse ready.\nPresenter: http://localhost:${PORT}/?mode=presenter&session=${encodeURIComponent(s.id)}&key=${s.presenterKey}\nParticipant:  http://localhost:${PORT}/?mode=participant&session=${encodeURIComponent(s.id)}\n`);
} else {
  const s = Object.values(sessions)[0];
  console.log(`\nAI Pulse ready.\nPresenter: http://localhost:${PORT}/?mode=presenter&session=${encodeURIComponent(s.id)}&key=${s.presenterKey}\nParticipant:  http://localhost:${PORT}/?mode=participant&session=${encodeURIComponent(s.id)}\n`);
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
  const t = aggregateInteraction(session, 'timeSaved');
  const values = { h1:1, h2:2, h4:4, h8:8 };
  let totalHours = 0;
  for (const [key, value] of Object.entries(values)) totalHours += (t.counts[key] || 0) * value;
  const averageWeeklyHours = t.total ? totalHours / t.total : 0;
  const participantTotal = Object.keys(session.participants || {}).length;
  const responders = new Set();
  for (const answers of Object.values(session.responses || {})) {
    for (const id of Object.keys(answers || {})) responders.add(id);
  }
  const participationRate = participantTotal ? Math.min(100, Math.round((responders.size / participantTotal) * 100)) : 0;
  return { averageWeeklyHours, participantTotal, respondentTotal:responders.size, participationRate };
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
  const timeVals = ['h1','h2','h2','h4','h4','h8','h2'];
  return {
    associations: Object.fromEntries(ids.map((id,i) => [id, ['submitted']])),
    timeSaved: Object.fromEntries(ids.map((id,i) => [id, timeVals[i % timeVals.length]])),
    retrievalCheck: Object.fromEntries(ids.slice(0,24).map((id,i) => [id, i % 4 === 0 ? 'yes' : 'no']))
  };
}

function loadDemo(session) {
  session.responses = makeDemoResponses();
  const demoIds = Array.from({length:28}, (_,i) => `demo-${i+1}`);
  demoIds.forEach((id,i) => session.participants[id] = Date.now() - i*1000);
  const demoWords = ['time saving','writing','automation','research','curiosity','productivity','time savings','analysis','risk','quality','prompt','market intelligence','email','meeting note','automation','research'];
  session.ideas = demoWords.map((text, i) => ({ id:`idea-demo-${i+1}`, anonId:`demo-${i+1}`, text, createdAt:new Date().toISOString(), demo:true }));
  session.shortlistedIdeaIds = [];
  session.ideaVotes = {};
  session.demoLoaded = true;
}

function classifyIdeas(session) {
  const groups = [
    ['Meetings', /meeting|minutes|brief|appointment/i],
    ['Reporting', /report|excel|table|kpi|data|dashboard/i],
    ['Research', /research|search|document|procedure|monitoring/i],
    ['Communication', /email|mail|message|response|communication/i],
    ['Content creation', /presentation|slide|content|write|post|creation/i],
    ['Operational automation', /automat|task|workflow|contract|action|update/i]
  ];
  return groups.map(([label, re]) => ({
    label,
    ideas: session.ideas.filter(i => re.test(i.text)).map(i => i.id)
  })).filter(g => g.ideas.length);
}


function normalizeCloudPart(word) {
  let w = String(word || '').toLowerCase().trim().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  return w;
}

function normalizeCloudPhrase(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').split(' ').map(normalizeCloudPart).filter(Boolean).join(' ');
}

function cloudSummary(session) {
  const map = new Map();
  for (const idea of session.ideas || []) {
    const key = normalizeCloudPhrase(idea.text);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a,b) => b.count - a.count || a.label.localeCompare(b.label));
}

function toPdfAscii(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7E]/g, '?');
}
function pdfEscape(value) { return toPdfAscii(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)'); }

class PdfBuilder {
  constructor() { this.objects = []; }
  reserve() { this.objects.push(null); return this.objects.length; }
  set(id, data) { this.objects[id - 1] = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'binary'); }
  stream(dict, content) {
    const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'binary');
    return Buffer.concat([Buffer.from(`<< ${dict} /Length ${body.length} >>\nstream\n`, 'binary'), body, Buffer.from('\nendstream', 'binary')]);
  }
  finish(rootId) {
    const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
    const offsets = [0];
    let offset = parts[0].length;
    for (let i=0;i<this.objects.length;i++) {
      offsets.push(offset);
      const head = Buffer.from(`${i+1} 0 obj\n`, 'binary');
      const body = this.objects[i] || Buffer.from('<<>>', 'binary');
      const tail = Buffer.from('\nendobj\n', 'binary');
      parts.push(head, body, tail);
      offset += head.length + body.length + tail.length;
    }
    const xrefOffset = offset;
    let xref = `xref\n0 ${this.objects.length+1}\n0000000000 65535 f \n`;
    for (let i=1;i<offsets.length;i++) xref += `${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${this.objects.length+1} /Root ${rootId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'binary'));
    return Buffer.concat(parts);
  }
}

function pdfText(cmds, text, x, y, size=12, bold=false, color=[0.184,0.251,0.384]) {
  cmds.push(`${color[0]} ${color[1]} ${color[2]} rg BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfEscape(text)}) Tj ET`);
}
function pdfRect(cmds, x, y, w, h, fill) {
  cmds.push(`${fill[0]} ${fill[1]} ${fill[2]} rg ${x} ${y} ${w} ${h} re f`);
}
function pdfLine(cmds, x1, y1, x2, y2, stroke=[0.86,0.89,0.94], width=1) {
  cmds.push(`${stroke[0]} ${stroke[1]} ${stroke[2]} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
}

function liveResultsContent(session) {
  const cmds = [];
  const d = dashboard(session);
  const t = aggregateInteraction(session, 'timeSaved');
  const words = cloudSummary(session).slice(0, 18);
  const navy=[0.184,0.251,0.384], blue=[0.443,0.620,0.969], green=[0.216,0.745,0.416], orange=[1.0,0.353,0.122], gray=[0.39,0.44,0.52];
  const paleBlue=[0.93,0.95,1], paleGreen=[0.92,0.98,0.94], paleOrange=[1,0.95,0.92], paleYellow=[1,0.97,0.84], palePurple=[0.95,0.92,1], palePink=[1,0.92,0.95];
  pdfRect(cmds,0,0,612,792,[1,1,1]);
  pdfText(cmds,'AI PULSE - LIVE WORKSHOP RESULTS',48,738,11,true,blue);
  pdfText(cmds,'Removall & AI',48,700,28,true,navy);
  pdfText(cmds,'Live summary generated from the current workshop session.',48,676,12,false,gray);
  pdfLine(cmds,48,657,564,657,[0.87,0.90,0.94],1);

  // KPI cards
  pdfRect(cmds,48,575,155,60,paleBlue); pdfText(cmds,'Participation',62,613,10,true,gray); pdfText(cmds,`${d.participationRate}%`,62,587,24,true,navy); pdfRect(cmds,62,579,125,5,[0.84,0.88,0.96]); if(d.participationRate>0) pdfRect(cmds,62,579,125*(d.participationRate/100),5,blue);
  pdfRect(cmds,216,575,155,60,paleGreen); pdfText(cmds,'Respondents',230,613,10,true,gray); pdfText(cmds,`${d.respondentTotal}`,230,587,24,true,navy);
  pdfRect(cmds,384,575,180,60,paleOrange); pdfText(cmds,'Avg. time saved / week',398,613,10,true,gray); pdfText(cmds,`${d.averageWeeklyHours.toFixed(d.averageWeeklyHours%1?1:0)} h`,398,587,24,true,navy);

  // Time distribution
  pdfText(cmds,'Weekly time saved',48,535,16,true,navy);
  const options=[['h1','1 hour',blue],['h2','2 hours',green],['h4','4 hours',orange],['h8','8 hours',[0.95,0.74,0.23]]];
  let y=505;
  for(const [key,label,color] of options){
    const count=t.counts[key]||0, share=t.total?count/t.total:0;
    pdfText(cmds,label,48,y+4,10,false,navy);
    pdfRect(cmds,112,y,260,12,[0.92,0.94,0.97]);
    if(share>0) pdfRect(cmds,112,y,260*share,12,color);
    pdfText(cmds,`${Math.round(share*100)}%`,385,y+4,10,true,navy);
    y-=29;
  }

  // Word cloud area
  pdfText(cmds,'What comes to mind when you think about AI?',48,380,16,true,navy);
  pdfRect(cmds,48,115,516,245,[0.985,0.988,0.995]);
  const fills=[paleBlue,paleGreen,paleOrange,paleYellow,palePurple,palePink];
  let cx=62, cy=327, rowH=0;
  const max=words.length?Math.max(...words.map(w=>w.count)):1;
  if(!words.length){
    pdfText(cmds,'No word-cloud responses yet.',64,326,12,false,gray);
  } else {
    for(let i=0;i<words.length;i++){
      const item=words[i];
      const size=10+Math.round((item.count-1)/Math.max(1,max-1)*7);
      const shortLabel=item.label.length>24 ? item.label.slice(0,21)+'...' : item.label;
      const label=`${shortLabel}${item.count>1?`  x${item.count}`:''}`;
      const boxW=Math.min(150,Math.max(64,label.length*(size*0.52)+18));
      const boxH=size+14;
      if(cx+boxW>550){cx=62;cy-=Math.max(rowH,34)+8;rowH=0;}
      if(cy-boxH<130) break;
      pdfRect(cmds,cx,cy-boxH+4,boxW,boxH,fills[i%fills.length]);
      pdfText(cmds,label,cx+8,cy-boxH/2,size,item.count>1,navy);
      cx+=boxW+9; rowH=Math.max(rowH,boxH);
    }
  }
  pdfText(cmds,'Live data only: the remaining source-document pages are reproduced visually after this page.',48,78,9,false,gray);
  pdfText(cmds,'REMOVALL CARBON',48,45,8,true,navy);
  pdfText(cmds,'AI Pulse - live results',455,45,8,false,gray);
  return cmds.join('\n');
}

function buildLiveResultsPdf(session) {
  const sourceDir = path.join(PUBLIC_DIR,'docs','source_pages');
  const files = fs.readdirSync(sourceDir).filter(f => /\.jpg$/i.test(f)).sort();
  const pdf = new PdfBuilder();
  const catalogId=pdf.reserve(), pagesId=pdf.reserve(), f1=pdf.reserve(), f2=pdf.reserve();
  pdf.set(f1,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pdf.set(f2,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const kids=[];
  const addJpegPage=(jpegBuffer)=>{
    const imageId=pdf.reserve(), contentId=pdf.reserve(), pageId=pdf.reserve();
    pdf.set(imageId,pdf.stream('/Type /XObject /Subtype /Image /Width 935 /Height 1210 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',jpegBuffer));
    pdf.set(contentId,pdf.stream('',`q\n612 0 0 792 0 0 cm\n/Im0 Do\nQ`));
    pdf.set(pageId,`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(pageId);
  };
  const addResultsPage=()=>{
    const contentId=pdf.reserve(),pageId=pdf.reserve();
    pdf.set(contentId,pdf.stream('',liveResultsContent(session)));
    pdf.set(pageId,`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(pageId);
  };
  files.forEach((file,index)=>{
    addJpegPage(fs.readFileSync(path.join(sourceDir,file)));
    if(index===0) addResultsPage();
  });
  pdf.set(pagesId,`<< /Type /Pages /Kids [${kids.map(id=>`${id} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  pdf.set(catalogId,`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  return pdf.finish(catalogId);
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
    if (!text) return sendJson(res, 400, { error:'Missing QR text' });
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
    if (!session) return sendJson(res, 404, { error:'Session not found' });

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

    if (req.method === 'GET' && actionPath === 'live-results.pdf') {
      try {
        const pdf = buildLiveResultsPdf(session);
        res.writeHead(200, {
          'Content-Type':'application/pdf',
          'Content-Disposition':`inline; filename="${session.id}-AI-Pulse-Live.pdf"`,
          'Content-Length':pdf.length,
          'Cache-Control':'no-store'
        });
        return res.end(pdf);
      } catch (e) {
        console.error('Live PDF generation failed:', e);
        return sendJson(res, 500, { error:'Unable to generate live PDF' });
      }
    }

    if (req.method === 'GET' && actionPath === 'groups') {
      return sendJson(res, 200, classifyIdeas(session));
    }

    if (req.method === 'POST' && actionPath === 'heartbeat') {
      const body = await parseBody(req).catch(() => ({}));
      if (body.anonId && body.role !== 'presenter') {
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
      if (!def || !anonId) return sendJson(res, 400, { error:'Invalid response' });
      if (!session.interactionOpen || session.activeInteraction !== interactionId) return sendJson(res, 409, { error:'This interaction is closed' });
      session.responses[interactionId] ||= {};
      if (def.type === 'text') {
        const text = String(body.answer || '').trim().slice(0, Number(def.maxLength) || 80);
        if (!text) return sendJson(res, 400, { error:'Empty response' });
        session.ideas.push({ id: crypto.randomBytes(6).toString('hex'), anonId, text, createdAt:new Date().toISOString(), demo:false });
        session.responses[interactionId][anonId] ||= [];
        session.responses[interactionId][anonId].push(text);
      } else {
        const valid = new Set((def.options || []).map(x => x[0]));
        let answer = body.answer;
        if (def.type === 'multi') answer = Array.isArray(answer) ? answer.filter(v => valid.has(v)) : [];
        else if (!valid.has(answer)) return sendJson(res, 400, { error:'Invalid option' });
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
      if (!isPresenter(session,url,body)) return sendJson(res, 403, { error:'Presenter access required' });
      const type = body.type;
      if (type === 'setSlide') session.slideIndex = Math.max(0, Math.min(SLIDE_COUNT - 1, Number(body.slideIndex) || 0));
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
      if (!isPresenter(session,url)) return sendJson(res, 403, { error:'Presenter access required' });
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
  sendJson(res, 404, { error:'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Serveur sur http://${HOST}:${PORT}`);
  for (const origin of networkOrigins()) console.log(`Local network: ${origin}`);
});
