const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const SESSION_TTL = 1000 * 60 * 60 * 8;
const sessions = new Map();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  const hash = Buffer.from(hashHex, 'hex');
  return hash.length === test.length && crypto.timingSafeEqual(hash, test);
}

const DEFAULT_CONFIG = {
  title: 'Pemilihan Ketua & Wakil Ketua DPT',
  institution: 'Politeknik Agraria STPN',
  period: '2026–2027',
  tagline: 'SATU SUARA, SATU PILIHAN, UNTUK DPT YANG LEBIH BAIK',
  status: 'open',
  candidates: [
    { id: '01', ketua: 'Nama Calon Ketua 01', wakil: 'Nama Calon Wakil 01', visi: 'Tuliskan visi Paslon 01 di sini.', misi: '1. Misi pertama\n2. Misi kedua\n3. Misi ketiga', slogan: 'Bersama membawa DPT lebih baik.', photoKetua: '', photoWakil: '' },
    { id: '02', ketua: 'Nama Calon Ketua 02', wakil: 'Nama Calon Wakil 02', visi: 'Tuliskan visi Paslon 02 di sini.', misi: '1. Misi pertama\n2. Misi kedua\n3. Misi ketiga', slogan: 'Bergerak bersama untuk kemajuan.', photoKetua: '', photoWakil: '' }
  ]
};
const DEFAULT_ADMIN_HASH = '0e9dea76c15a242e64fd6701cf1680d7:27838ded0eb058e9ba8ed810f01ab6537cd32261ffeab5084ab9d56bf2c8cd09df18454f2d8677f78300ad6084f7ee018543d5225dc9962eb805d9d4a152dfd6';

async function initDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diatur.');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_config (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS voters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      has_voted BOOLEAN NOT NULL DEFAULT FALSE,
      voted_at TIMESTAMPTZ NULL
    );
    CREATE TABLE IF NOT EXISTS vote_counts (
      candidate_id TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NULL
    );
    CREATE TABLE IF NOT EXISTS admin_user (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
  `);
  await pool.query('INSERT INTO app_config(id,data) VALUES(1,$1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(DEFAULT_CONFIG)]);
  await pool.query("INSERT INTO vote_counts(candidate_id,count) VALUES('01',0),('02',0) ON CONFLICT (candidate_id) DO NOTHING");
  await pool.query('INSERT INTO admin_user(id,username,password_hash) VALUES(1,$1,$2) ON CONFLICT (id) DO NOTHING', ['admin_dpt', DEFAULT_ADMIN_HASH]);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions.entries()) if (now - v.createdAt > SESSION_TTL) sessions.delete(k);
}, 30 * 60 * 1000).unref();

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function createSession(kind, id) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { kind, id, createdAt: Date.now() });
  return token;
}
function session(req) {
  const t = parseCookies(req).sid;
  return t ? sessions.get(t) : null;
}
function cookieSecurity(req) {
  return String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https' ? '; Secure' : '';
}
function json(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function bodyJSON(req, max = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > max) { reject(new Error('Payload terlalu besar')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON tidak valid')); } });
    req.on('error', reject);
  });
}
function requireAdmin(req, res) {
  const s = session(req);
  if (!s || s.kind !== 'admin') { json(res, 401, { error: 'Unauthorized' }); return null; }
  return s;
}
function requireVoter(req, res) {
  const s = session(req);
  if (!s || s.kind !== 'voter') { json(res, 401, { error: 'Unauthorized' }); return null; }
  return s;
}
function safePath(urlPath) {
  const p = urlPath === '/' ? '/index.html' : urlPath;
  const clean = path.normalize(p).replace(/^([.][.][/\\])+/,'');
  const full = path.join(PUBLIC, clean);
  if (!full.startsWith(PUBLIC)) return null;
  return full;
}
function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' })[ext] || 'application/octet-stream';
}
async function getConfig(client = pool) {
  const r = await client.query('SELECT data FROM app_config WHERE id=1');
  return r.rows[0]?.data || DEFAULT_CONFIG;
}
async function getAdminStats() {
  const [usersR, countsR, cfg] = await Promise.all([
    pool.query('SELECT id,name,username,has_voted AS "hasVoted",voted_at AS "votedAt" FROM voters ORDER BY name ASC'),
    pool.query('SELECT candidate_id, count, updated_at FROM vote_counts ORDER BY candidate_id'),
    getConfig()
  ]);
  const users = usersR.rows;
  const counts = { '01': 0, '02': 0 };
  let updatedAt = null;
  for (const row of countsR.rows) {
    counts[row.candidate_id] = Number(row.count || 0);
    if (row.updated_at && (!updatedAt || row.updated_at > updatedAt)) updatedAt = row.updated_at;
  }
  const voted = users.filter(u => u.hasVoted).length;
  const total = users.length;
  return { total, voted, remaining: total - voted, participation: total ? Math.round(voted / total * 1000) / 10 : 0, counts, users, config: cfg, updatedAt };
}

async function api(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/election') return json(res, 200, await getConfig());
    if (req.method === 'GET' && url.pathname === '/api/me') {
      const s = session(req);
      if (!s || s.kind !== 'voter') return json(res, 200, { loggedIn: false });
      const r = await pool.query('SELECT name,username,has_voted AS "hasVoted",voted_at AS "votedAt" FROM voters WHERE id=$1', [s.id]);
      const u = r.rows[0];
      if (!u) return json(res, 200, { loggedIn: false });
      return json(res, 200, { loggedIn: true, user: u });
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const b = await bodyJSON(req);
      const r = await pool.query('SELECT id,name,username,password_hash,has_voted AS "hasVoted" FROM voters WHERE username=$1', [String(b.username || '').trim()]);
      const u = r.rows[0];
      if (!u || !verifyPassword(String(b.password || ''), u.password_hash)) return json(res, 401, { error: 'Username atau password salah.' });
      const token = createSession('voter', u.id);
      return json(res, 200, { ok: true, user: { name: u.name, username: u.username, hasVoted: u.hasVoted } }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${cookieSecurity(req)}` });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const c = parseCookies(req); if (c.sid) sessions.delete(c.sid);
      return json(res, 200, { ok: true }, { 'Set-Cookie': `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${cookieSecurity(req)}` });
    }
    if (req.method === 'POST' && url.pathname === '/api/vote') {
      const s = requireVoter(req, res); if (!s) return;
      const b = await bodyJSON(req); const candidateId = String(b.candidateId || '');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cfg = await getConfig(client);
        if (cfg.status !== 'open') { await client.query('ROLLBACK'); return json(res, 403, { error: 'Pemungutan suara sedang tidak dibuka.' }); }
        if (!cfg.candidates.some(c => c.id === candidateId)) { await client.query('ROLLBACK'); return json(res, 400, { error: 'Paslon tidak valid.' }); }
        const ur = await client.query('SELECT has_voted FROM voters WHERE id=$1 FOR UPDATE', [s.id]);
        if (!ur.rows.length) { await client.query('ROLLBACK'); return json(res, 401, { error: 'Akun tidak ditemukan.' }); }
        if (ur.rows[0].has_voted) { await client.query('ROLLBACK'); return json(res, 409, { error: 'Hak suara akun ini sudah digunakan.' }); }
        await client.query('UPDATE voters SET has_voted=TRUE,voted_at=NOW() WHERE id=$1', [s.id]);
        await client.query(`INSERT INTO vote_counts(candidate_id,count,updated_at) VALUES($1,1,NOW())
          ON CONFLICT(candidate_id) DO UPDATE SET count=vote_counts.count+1, updated_at=NOW()`, [candidateId]);
        await client.query('COMMIT');
        return json(res, 200, { ok: true, message: 'Suara berhasil direkam.' });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {}); throw e;
      } finally { client.release(); }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const b = await bodyJSON(req);
      const r = await pool.query('SELECT username,password_hash FROM admin_user WHERE id=1');
      const a = r.rows[0];
      if (!a || String(b.username || '') !== a.username || !verifyPassword(String(b.password || ''), a.password_hash)) return json(res, 401, { error: 'Login admin salah.' });
      const token = createSession('admin', 'admin');
      return json(res, 200, { ok: true }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${cookieSecurity(req)}` });
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/stats') {
      if (!requireAdmin(req, res)) return;
      return json(res, 200, await getAdminStats());
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/config') {
      if (!requireAdmin(req, res)) return;
      const b = await bodyJSON(req); const current = await getConfig(); const allowedStatus = ['open', 'closed', 'scheduled'];
      const next = {
        ...current,
        title: String(b.title ?? current.title).slice(0,160), institution: String(b.institution ?? current.institution).slice(0,160),
        period: String(b.period ?? current.period).slice(0,80), tagline: String(b.tagline ?? current.tagline).slice(0,220),
        status: allowedStatus.includes(b.status) ? b.status : current.status,
        candidates: Array.isArray(b.candidates) ? b.candidates.slice(0,2).map((c,i) => ({
          id: i === 0 ? '01' : '02', ketua: String(c.ketua || '').slice(0,120), wakil: String(c.wakil || '').slice(0,120),
          visi: String(c.visi || '').slice(0,1500), misi: String(c.misi || '').slice(0,2500), slogan: String(c.slogan || '').slice(0,300),
          photoKetua: String(c.photoKetua || '').slice(0,2000000), photoWakil: String(c.photoWakil || '').slice(0,2000000)
        })) : current.candidates
      };
      await pool.query('UPDATE app_config SET data=$1::jsonb WHERE id=1', [JSON.stringify(next)]);
      return json(res, 200, { ok: true, config: next });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/users/add') {
      if (!requireAdmin(req, res)) return;
      const b = await bodyJSON(req), name = String(b.name || '').trim(), username = String(b.username || '').trim(), password = String(b.password || '');
      if (!name || !username || password.length < 4) return json(res, 400, { error: 'Nama, username, dan password minimal 4 karakter wajib diisi.' });
      try {
        await pool.query('INSERT INTO voters(id,name,username,password_hash) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), name, username, hashPassword(password)]);
        return json(res, 200, { ok: true });
      } catch (e) {
        if (e.code === '23505') return json(res, 409, { error: 'Username sudah digunakan.' });
        throw e;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/users/bulk') {
      if (!requireAdmin(req, res)) return;
      const b = await bodyJSON(req), rows = Array.isArray(b.rows) ? b.rows : [];
      const client = await pool.connect(); let added = 0; const skipped = [];
      try {
        await client.query('BEGIN');
        for (const row of rows) {
          const name = String(row.name || '').trim(), username = String(row.username || '').trim(), password = String(row.password || '');
          if (!name || !username || password.length < 4) { skipped.push(username || '(kosong)'); continue; }
          try {
            await client.query('INSERT INTO voters(id,name,username,password_hash) VALUES($1,$2,$3,$4)', [crypto.randomUUID(), name, username, hashPassword(password)]);
            added++;
          } catch (e) {
            if (e.code === '23505') skipped.push(username); else throw e;
          }
        }
        await client.query('COMMIT');
        return json(res, 200, { ok: true, added, skipped });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {}); throw e;
      } finally { client.release(); }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/users/delete') {
      if (!requireAdmin(req, res)) return;
      const b = await bodyJSON(req), id = String(b.id || '');
      const r = await pool.query('DELETE FROM voters WHERE id=$1 AND has_voted=FALSE RETURNING id', [id]);
      if (!r.rows.length) return json(res, 409, { error: 'Pemilih tidak ditemukan atau sudah memilih. Gunakan Reset Latihan bila ingin menghapus setelah simulasi.' });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/reset-practice') {
      if (!requireAdmin(req, res)) return;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE voters SET has_voted=FALSE, voted_at=NULL');
        await client.query('UPDATE vote_counts SET count=0, updated_at=NOW()');
        await client.query('COMMIT');
        return json(res, 200, { ok: true });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {}); throw e;
      } finally { client.release(); }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/password') {
      if (!requireAdmin(req, res)) return;
      const b = await bodyJSON(req);
      const r = await pool.query('SELECT password_hash FROM admin_user WHERE id=1');
      if (!r.rows[0] || !verifyPassword(String(b.oldPassword || ''), r.rows[0].password_hash)) return json(res, 400, { error: 'Password lama salah.' });
      if (String(b.newPassword || '').length < 8) return json(res, 400, { error: 'Password baru minimal 8 karakter.' });
      await pool.query('UPDATE admin_user SET password_hash=$1 WHERE id=1', [hashPassword(String(b.newPassword))]);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
      const c = parseCookies(req); if (c.sid) sessions.delete(c.sid);
      return json(res, 200, { ok: true }, { 'Set-Cookie': `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${cookieSecurity(req)}` });
    }
    return json(res, 404, { error: 'Endpoint tidak ditemukan.' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) return json(res, 500, { error: e.message || 'Terjadi kesalahan server.' });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  const file = safePath(url.pathname === '/admin' ? '/admin.html' : url.pathname);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return text(res, 404, 'Not Found');
  res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

initDb().then(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`EvotingDPT online di port ${PORT}`));
}).catch(err => {
  console.error('Gagal inisialisasi database:', err);
  process.exit(1);
});
