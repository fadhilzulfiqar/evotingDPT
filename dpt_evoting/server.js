const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const SESSION_TTL = 1000 * 60 * 60 * 8;
const sessions = new Map();
let mutationQueue = Promise.resolve();

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
ensureDir(DATA);

function readJSON(file, fallback){
  try { return JSON.parse(fs.readFileSync(path.join(DATA,file),'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data){
  const target = path.join(DATA,file);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data,null,2));
  fs.renameSync(tmp,target);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')){
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored){
  if(!stored || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  const hash = Buffer.from(hashHex,'hex');
  return hash.length === test.length && crypto.timingSafeEqual(hash,test);
}
function initData(){
  if(!fs.existsSync(path.join(DATA,'config.json'))){
    writeJSON('config.json',{
      title:'Pemilihan Ketua & Wakil Ketua DPT',
      institution:'Politeknik Agraria STPN',
      period:'2026–2027',
      tagline:'SATU SUARA, SATU PILIHAN, UNTUK DPT YANG LEBIH BAIK',
      status:'open',
      candidates:[
        {id:'01', ketua:'Nama Calon Ketua 01', wakil:'Nama Calon Wakil 01', visi:'Tuliskan visi Paslon 01 di sini.', misi:'1. Misi pertama\n2. Misi kedua\n3. Misi ketiga', slogan:'Bersama membawa DPT lebih baik.', photoKetua:'', photoWakil:''},
        {id:'02', ketua:'Nama Calon Ketua 02', wakil:'Nama Calon Wakil 02', visi:'Tuliskan visi Paslon 02 di sini.', misi:'1. Misi pertama\n2. Misi kedua\n3. Misi ketiga', slogan:'Bergerak bersama untuk kemajuan.', photoKetua:'', photoWakil:''}
      ]
    });
  }
  if(!fs.existsSync(path.join(DATA,'users.json'))){
    const demo = [
      ['Pemilih Demo 1','pemilih001','DPT001'],
      ['Pemilih Demo 2','pemilih002','DPT002'],
      ['Pemilih Demo 3','pemilih003','DPT003']
    ].map(([name,username,password],i)=>({id:String(i+1),name,username,passwordHash:hashPassword(password),hasVoted:false,votedAt:null}));
    writeJSON('users.json', demo);
  }
  if(!fs.existsSync(path.join(DATA,'votes.json'))){
    writeJSON('votes.json',{counts:{'01':0,'02':0},updatedAt:null});
  }
  if(!fs.existsSync(path.join(DATA,'admin.json'))){
    writeJSON('admin.json',{username:'admin_dpt',passwordHash:hashPassword('GantiPasswordAdmin2026!')});
  }
}
initData();

function cleanupSessions(){
  const now=Date.now();
  for(const [k,v] of sessions.entries()) if(now-v.createdAt>SESSION_TTL) sessions.delete(k);
}
setInterval(cleanupSessions, 30*60*1000).unref();

function parseCookies(req){
  const out={};
  (req.headers.cookie||'').split(';').forEach(part=>{ const i=part.indexOf('='); if(i>0) out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim()); });
  return out;
}
function createSession(kind, id){
  const token=crypto.randomBytes(32).toString('hex');
  sessions.set(token,{kind,id,createdAt:Date.now()});
  return token;
}
function session(req){ const t=parseCookies(req).sid; return t ? sessions.get(t) : null; }
function json(res,status,obj,headers={}){
  const body=JSON.stringify(obj);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
  res.end(body);
}
function text(res,status,body,type='text/plain; charset=utf-8'){
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'}); res.end(body);
}
function bodyJSON(req, max=8*1024*1024){
  return new Promise((resolve,reject)=>{ let data=''; req.on('data',c=>{data+=c;if(data.length>max){reject(new Error('Payload terlalu besar'));req.destroy();}}); req.on('end',()=>{try{resolve(data?JSON.parse(data):{});}catch(e){reject(new Error('JSON tidak valid'));}}); req.on('error',reject); });
}
function serializeConfig(){
  return readJSON('config.json',{});
}
function publicUsers(){
  return readJSON('users.json',[]).map(u=>({id:u.id,name:u.name,username:u.username,hasVoted:u.hasVoted,votedAt:u.votedAt}));
}
function adminStats(){
  const users=readJSON('users.json',[]); const votes=readJSON('votes.json',{counts:{'01':0,'02':0}}); const cfg=serializeConfig();
  const voted=users.filter(u=>u.hasVoted).length; const total=users.length; const remaining=total-voted;
  return {total,voted,remaining,participation:total?Math.round(voted/total*1000)/10:0,counts:votes.counts,users:publicUsers(),config:cfg,updatedAt:votes.updatedAt};
}
function requireAdmin(req,res){ const s=session(req); if(!s||s.kind!=='admin'){json(res,401,{error:'Unauthorized'});return null;} return s; }
function requireVoter(req,res){ const s=session(req); if(!s||s.kind!=='voter'){json(res,401,{error:'Unauthorized'});return null;} return s; }
function safePath(urlPath){
  const p = urlPath === '/' ? '/index.html' : urlPath;
  const clean=path.normalize(p).replace(/^([.][.][/\\])+/, '');
  const full=path.join(PUBLIC,clean);
  if(!full.startsWith(PUBLIC)) return null;
  return full;
}
function mime(file){ const ext=path.extname(file).toLowerCase(); return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'})[ext]||'application/octet-stream'; }

async function api(req,res,url){
  try{
    if(req.method==='GET' && url.pathname==='/api/election') return json(res,200,serializeConfig());
    if(req.method==='GET' && url.pathname==='/api/me'){
      const s=session(req); if(!s||s.kind!=='voter') return json(res,200,{loggedIn:false});
      const u=readJSON('users.json',[]).find(x=>x.id===s.id); if(!u) return json(res,200,{loggedIn:false});
      return json(res,200,{loggedIn:true,user:{name:u.name,username:u.username,hasVoted:u.hasVoted,votedAt:u.votedAt}});
    }
    if(req.method==='POST' && url.pathname==='/api/login'){
      const b=await bodyJSON(req); const users=readJSON('users.json',[]); const u=users.find(x=>x.username===String(b.username||'').trim());
      if(!u||!verifyPassword(String(b.password||''),u.passwordHash)) return json(res,401,{error:'Username atau password salah.'});
      const token=createSession('voter',u.id);
      return json(res,200,{ok:true,user:{name:u.name,username:u.username,hasVoted:u.hasVoted}}, {'Set-Cookie':`sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`});
    }
    if(req.method==='POST' && url.pathname==='/api/logout'){
      const c=parseCookies(req); if(c.sid) sessions.delete(c.sid);
      return json(res,200,{ok:true},{'Set-Cookie':'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
    }
    if(req.method==='POST' && url.pathname==='/api/vote'){
      const s=requireVoter(req,res); if(!s) return;
      const b=await bodyJSON(req); const candidateId=String(b.candidateId||'');
      return mutationQueue = mutationQueue.then(()=>{
        const cfg=serializeConfig(); if(cfg.status!=='open') return json(res,403,{error:'Pemungutan suara sedang tidak dibuka.'});
        if(!cfg.candidates.some(c=>c.id===candidateId)) return json(res,400,{error:'Paslon tidak valid.'});
        const users=readJSON('users.json',[]); const idx=users.findIndex(x=>x.id===s.id); if(idx<0) return json(res,401,{error:'Akun tidak ditemukan.'});
        if(users[idx].hasVoted) return json(res,409,{error:'Hak suara akun ini sudah digunakan.'});
        const votes=readJSON('votes.json',{counts:{'01':0,'02':0}});
        votes.counts[candidateId]=(votes.counts[candidateId]||0)+1; votes.updatedAt=new Date().toISOString();
        users[idx].hasVoted=true; users[idx].votedAt=new Date().toISOString();
        writeJSON('votes.json',votes); writeJSON('users.json',users);
        return json(res,200,{ok:true,message:'Suara berhasil direkam.'});
      });
    }
    if(req.method==='POST' && url.pathname==='/api/admin/login'){
      const b=await bodyJSON(req); const a=readJSON('admin.json',{});
      if(String(b.username||'')!==a.username || !verifyPassword(String(b.password||''),a.passwordHash)) return json(res,401,{error:'Login admin salah.'});
      const token=createSession('admin','admin');
      return json(res,200,{ok:true},{'Set-Cookie':`sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`});
    }
    if(req.method==='GET' && url.pathname==='/api/admin/stats'){
      if(!requireAdmin(req,res)) return; return json(res,200,adminStats());
    }
    if(req.method==='POST' && url.pathname==='/api/admin/config'){
      if(!requireAdmin(req,res)) return; const b=await bodyJSON(req); const current=serializeConfig();
      const allowedStatus=['open','closed','scheduled'];
      const next={...current,
        title:String(b.title??current.title).slice(0,160), institution:String(b.institution??current.institution).slice(0,160), period:String(b.period??current.period).slice(0,80), tagline:String(b.tagline??current.tagline).slice(0,220), status:allowedStatus.includes(b.status)?b.status:current.status,
        candidates:Array.isArray(b.candidates)?b.candidates.slice(0,2).map((c,i)=>({id:i===0?'01':'02',ketua:String(c.ketua||'').slice(0,120),wakil:String(c.wakil||'').slice(0,120),visi:String(c.visi||'').slice(0,1500),misi:String(c.misi||'').slice(0,2500),slogan:String(c.slogan||'').slice(0,300),photoKetua:String(c.photoKetua||'').slice(0,3_500_000),photoWakil:String(c.photoWakil||'').slice(0,3_500_000)})):current.candidates
      };
      writeJSON('config.json',next); return json(res,200,{ok:true,config:next});
    }
    if(req.method==='POST' && url.pathname==='/api/admin/users/add'){
      if(!requireAdmin(req,res)) return; const b=await bodyJSON(req); const name=String(b.name||'').trim(), username=String(b.username||'').trim(), password=String(b.password||'');
      if(!name||!username||password.length<4) return json(res,400,{error:'Nama, username, dan password minimal 4 karakter wajib diisi.'});
      return mutationQueue = mutationQueue.then(()=>{ const users=readJSON('users.json',[]); if(users.some(u=>u.username===username)) return json(res,409,{error:'Username sudah digunakan.'}); users.push({id:crypto.randomUUID(),name,username,passwordHash:hashPassword(password),hasVoted:false,votedAt:null}); writeJSON('users.json',users); return json(res,200,{ok:true}); });
    }
    if(req.method==='POST' && url.pathname==='/api/admin/users/bulk'){
      if(!requireAdmin(req,res)) return; const b=await bodyJSON(req); const rows=Array.isArray(b.rows)?b.rows:[];
      return mutationQueue = mutationQueue.then(()=>{ const users=readJSON('users.json',[]); const existing=new Set(users.map(u=>u.username)); let added=0; const skipped=[];
        for(const r of rows){ const name=String(r.name||'').trim(), username=String(r.username||'').trim(), password=String(r.password||''); if(!name||!username||password.length<4||existing.has(username)){skipped.push(username||'(kosong)');continue;} existing.add(username); users.push({id:crypto.randomUUID(),name,username,passwordHash:hashPassword(password),hasVoted:false,votedAt:null}); added++; }
        writeJSON('users.json',users); return json(res,200,{ok:true,added,skipped}); });
    }
    if(req.method==='POST' && url.pathname==='/api/admin/password'){
      if(!requireAdmin(req,res)) return; const b=await bodyJSON(req); const a=readJSON('admin.json',{});
      if(!verifyPassword(String(b.oldPassword||''),a.passwordHash)) return json(res,400,{error:'Password lama salah.'}); if(String(b.newPassword||'').length<8) return json(res,400,{error:'Password baru minimal 8 karakter.'});
      a.passwordHash=hashPassword(String(b.newPassword)); writeJSON('admin.json',a); return json(res,200,{ok:true});
    }
    if(req.method==='POST' && url.pathname==='/api/admin/logout'){
      const c=parseCookies(req); if(c.sid) sessions.delete(c.sid); return json(res,200,{ok:true},{'Set-Cookie':'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
    }
    return json(res,404,{error:'Endpoint tidak ditemukan.'});
  }catch(e){ console.error(e); if(!res.headersSent) return json(res,500,{error:e.message||'Terjadi kesalahan server.'}); }
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(url.pathname.startsWith('/api/')) return api(req,res,url);
  const file=safePath(url.pathname==='/admin' ? '/admin.html' : url.pathname);
  if(!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return text(res,404,'Not Found');
  res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':'no-cache'}); fs.createReadStream(file).pipe(res);
});
server.listen(PORT,()=>console.log(`DPT E-Voting berjalan di http://localhost:${PORT}`));
