import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9._@+-]{2,80}$/;
const OLD_ADMIN_HASH = '0e9dea76c15a242e64fd6701cf1680d7:27838ded0eb058e9ba8ed810f01ab6537cd32261ffeab5084ab9d56bf2c8cd09df18454f2d8677f78300ad6084f7ee018543d5225dc9962eb805d9d4a152dfd6';

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

const stores = {
  config: () => getStore('evoting-config'),
  users: () => getStore('evoting-users'),
  votes: () => getStore('evoting-votes'),
  admins: () => getStore('evoting-admins'),
  sessions: () => getStore('evoting-sessions')
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw, 'utf8') > 5_500_000) throw new Error('Payload terlalu besar.');
  try { return JSON.parse(raw); }
  catch { throw new Error('JSON tidak valid.'); }
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  try {
    const test = crypto.scryptSync(String(password), salt, 64);
    const hash = Buffer.from(hashHex, 'hex');
    return hash.length === test.length && crypto.timingSafeEqual(hash, test);
  } catch {
    return false;
  }
}

function getCookie(event, name) {
  const cookie = event.headers?.cookie || event.headers?.Cookie || '';
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function isHttps(event) {
  const proto = String(event.headers?.['x-forwarded-proto'] || '').toLowerCase();
  const host = String(event.headers?.host || '');
  return proto === 'https' || (!host.includes('localhost') && !host.startsWith('127.0.0.1'));
}

function sessionCookie(event, token, maxAge = 28800) {
  return `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isHttps(event) ? '; Secure' : ''}`;
}

async function createSession(event, kind, id) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await stores.sessions().setJSON(`token/${token}`, { kind, id, createdAt: now, expiresAt: now + SESSION_TTL_MS }, { onlyIfNew: true });
  return sessionCookie(event, token);
}

async function getSession(event) {
  const token = getCookie(event, 'sid');
  if (!token) return null;
  const store = stores.sessions();
  const s = await store.get(`token/${token}`, { type: 'json', consistency: 'strong' });
  if (!s) return null;
  if (!s.expiresAt || s.expiresAt < Date.now()) {
    await store.delete(`token/${token}`).catch(() => {});
    return null;
  }
  return { ...s, token };
}

async function destroySession(event) {
  const token = getCookie(event, 'sid');
  if (token) await stores.sessions().delete(`token/${token}`).catch(() => {});
}

async function requireSession(event, kind) {
  const s = await getSession(event);
  return s && s.kind === kind ? s : null;
}

async function getConfig() {
  const store = stores.config();
  let cfg = await store.get('main', { type: 'json', consistency: 'strong' });
  if (!cfg) {
    const result = await store.setJSON('main', DEFAULT_CONFIG, { onlyIfNew: true });
    cfg = result.modified ? DEFAULT_CONFIG : await store.get('main', { type: 'json', consistency: 'strong' });
  }
  return cfg || DEFAULT_CONFIG;
}

async function ensureAdmin() {
  const store = stores.admins();
  let admin = await store.get('main', { type: 'json', consistency: 'strong' });
  if (admin) return admin;
  const bootstrap = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '');
  const passwordHash = bootstrap.length >= 8 ? hashPassword(bootstrap) : OLD_ADMIN_HASH;
  const seed = { username: 'admin_dpt', passwordHash, updatedAt: new Date().toISOString() };
  const result = await store.setJSON('main', seed, { onlyIfNew: true });
  if (result.modified) return seed;
  return await store.get('main', { type: 'json', consistency: 'strong' });
}

async function getUserById(id) {
  return await stores.users().get(`user/${id}`, { type: 'json', consistency: 'strong' });
}

async function getUserByUsername(username) {
  const key = normalizeUsername(username);
  if (!key) return null;
  const map = await stores.users().get(`username/${key}`, { type: 'json', consistency: 'strong' });
  if (!map?.id) return null;
  return await getUserById(map.id);
}

async function getVoteForUser(id) {
  return await stores.votes().get(`voter/${id}`, { type: 'json', consistency: 'strong' });
}

async function addUser({ name, username, password }) {
  name = String(name || '').trim();
  username = String(username || '').trim();
  password = String(password || '');
  const normalized = normalizeUsername(username);
  if (!name || !USERNAME_RE.test(username) || password.length < 4) {
    return { ok: false, error: 'Nama, username/NIT valid, dan password minimal 4 karakter wajib diisi.' };
  }
  const users = stores.users();
  const id = crypto.randomUUID();
  const mapResult = await users.setJSON(`username/${normalized}`, { id }, { onlyIfNew: true });
  if (!mapResult.modified) return { ok: false, duplicate: true, error: 'Username/NIT sudah digunakan.' };
  try {
    await users.setJSON(`user/${id}`, {
      id,
      name,
      username,
      usernameNormalized: normalized,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    }, { onlyIfNew: true });
    return { ok: true, id };
  } catch (e) {
    await users.delete(`username/${normalized}`).catch(() => {});
    throw e;
  }
}

async function getAdminStats() {
  const usersStore = stores.users();
  const votesStore = stores.votes();
  const [userList, voteList, cfg] = await Promise.all([
    usersStore.list({ prefix: 'user/' }),
    votesStore.list({ prefix: 'voter/' }),
    getConfig()
  ]);

  const users = (await Promise.all(userList.blobs.map(b => usersStore.get(b.key, { type: 'json' })))).filter(Boolean);
  const votes = (await Promise.all(voteList.blobs.map(b => votesStore.get(b.key, { type: 'json', consistency: 'strong' })))).filter(Boolean);
  const voteByVoter = new Map(votes.map(v => [v.voterId, v]));
  const counts = Object.fromEntries(cfg.candidates.map(c => [c.id, 0]));
  let updatedAt = null;
  for (const v of votes) {
    if (Object.prototype.hasOwnProperty.call(counts, v.candidateId)) counts[v.candidateId] += 1;
    if (v.votedAt && (!updatedAt || v.votedAt > updatedAt)) updatedAt = v.votedAt;
  }
  const safeUsers = users
    .map(u => {
      const v = voteByVoter.get(u.id);
      return { id: u.id, name: u.name, username: u.username, hasVoted: Boolean(v), votedAt: v?.votedAt || null };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));
  const voted = safeUsers.filter(u => u.hasVoted).length;
  const total = safeUsers.length;
  return {
    total,
    voted,
    remaining: total - voted,
    participation: total ? Math.round(voted / total * 1000) / 10 : 0,
    counts,
    users: safeUsers,
    config: cfg,
    updatedAt
  };
}

function routeFromEvent(event) {
  let p = event.path || '';
  p = p.replace(/^\/\.netlify\/functions\/api/, '');
  p = p.replace(/^\/api/, '');
  return p || '/';
}

export async function handler(event) {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  const route = routeFromEvent(event);

  try {
    if (method === 'GET' && route === '/health') return json(200, { ok: true, storage: 'netlify-blobs' });

    if (method === 'GET' && route === '/election') return json(200, await getConfig());

    if (method === 'GET' && route === '/me') {
      const s = await requireSession(event, 'voter');
      if (!s) return json(200, { loggedIn: false });
      const user = await getUserById(s.id);
      if (!user) return json(200, { loggedIn: false });
      const vote = await getVoteForUser(user.id);
      return json(200, { loggedIn: true, user: { name: user.name, username: user.username, hasVoted: Boolean(vote), votedAt: vote?.votedAt || null } });
    }

    if (method === 'POST' && route === '/login') {
      const body = parseBody(event);
      const user = await getUserByUsername(body.username);
      if (!user || !verifyPassword(body.password, user.passwordHash)) return json(401, { error: 'NIT/username atau password salah.' });
      const vote = await getVoteForUser(user.id);
      const cookie = await createSession(event, 'voter', user.id);
      return json(200, { ok: true, user: { name: user.name, username: user.username, hasVoted: Boolean(vote) } }, { 'set-cookie': cookie });
    }

    if (method === 'POST' && route === '/logout') {
      await destroySession(event);
      return json(200, { ok: true }, { 'set-cookie': sessionCookie(event, '', 0) });
    }

    if (method === 'POST' && route === '/vote') {
      const s = await requireSession(event, 'voter');
      if (!s) return json(401, { error: 'Unauthorized' });
      const user = await getUserById(s.id);
      if (!user) return json(401, { error: 'Akun pemilih tidak ditemukan.' });
      const body = parseBody(event);
      const candidateId = String(body.candidateId || '');
      const cfg = await getConfig();
      if (cfg.status !== 'open') return json(403, { error: 'Pemungutan suara sedang tidak dibuka.' });
      if (!cfg.candidates.some(c => c.id === candidateId)) return json(400, { error: 'Paslon tidak valid.' });
      const votedAt = new Date().toISOString();
      const result = await stores.votes().setJSON(`voter/${user.id}`, { voterId: user.id, candidateId, votedAt }, { onlyIfNew: true });
      if (!result.modified) return json(409, { error: 'Hak suara akun ini sudah digunakan.' });
      return json(200, { ok: true, message: 'Suara berhasil direkam.', votedAt });
    }

    if (method === 'POST' && route === '/admin/login') {
      const body = parseBody(event);
      const admin = await ensureAdmin();
      if (!admin || String(body.username || '') !== admin.username || !verifyPassword(body.password, admin.passwordHash)) return json(401, { error: 'Login admin salah.' });
      const cookie = await createSession(event, 'admin', 'admin');
      return json(200, { ok: true }, { 'set-cookie': cookie });
    }

    if (method === 'POST' && route === '/admin/logout') {
      await destroySession(event);
      return json(200, { ok: true }, { 'set-cookie': sessionCookie(event, '', 0) });
    }

    const adminSession = route.startsWith('/admin/') ? await requireSession(event, 'admin') : null;
    if (route.startsWith('/admin/') && !adminSession) return json(401, { error: 'Unauthorized' });

    if (method === 'GET' && route === '/admin/stats') return json(200, await getAdminStats());

    if (method === 'POST' && route === '/admin/config') {
      const body = parseBody(event);
      const current = await getConfig();
      const allowedStatus = ['open', 'closed', 'scheduled'];
      const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 2).map((c, i) => ({
        id: i === 0 ? '01' : '02',
        ketua: String(c.ketua || '').slice(0, 120),
        wakil: String(c.wakil || '').slice(0, 120),
        visi: String(c.visi || '').slice(0, 1500),
        misi: String(c.misi || '').slice(0, 2500),
        slogan: String(c.slogan || '').slice(0, 300),
        photoKetua: String(c.photoKetua || '').slice(0, 1_800_000),
        photoWakil: String(c.photoWakil || '').slice(0, 1_800_000)
      })) : current.candidates;
      if (candidates.length !== 2) return json(400, { error: 'Konfigurasi harus memiliki tepat 2 paslon.' });
      const next = {
        ...current,
        title: String(body.title ?? current.title).slice(0, 160),
        institution: String(body.institution ?? current.institution).slice(0, 160),
        period: String(body.period ?? current.period).slice(0, 80),
        tagline: String(body.tagline ?? current.tagline).slice(0, 220),
        status: allowedStatus.includes(body.status) ? body.status : current.status,
        candidates
      };
      await stores.config().setJSON('main', next);
      return json(200, { ok: true, config: next });
    }

    if (method === 'POST' && route === '/admin/users/add') {
      const result = await addUser(parseBody(event));
      if (!result.ok) return json(result.duplicate ? 409 : 400, { error: result.error });
      return json(200, { ok: true, id: result.id });
    }

    if (method === 'POST' && route === '/admin/users/bulk') {
      const body = parseBody(event);
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
      let added = 0;
      const skipped = [];
      for (const row of rows) {
        try {
          const result = await addUser(row || {});
          if (result.ok) added += 1;
          else skipped.push({ username: String(row?.username || ''), reason: result.error });
        } catch {
          skipped.push({ username: String(row?.username || ''), reason: 'Gagal menyimpan.' });
        }
      }
      return json(200, { ok: true, added, skipped });
    }

    if (method === 'POST' && route === '/admin/users/delete') {
      const body = parseBody(event);
      const id = String(body.id || '');
      const user = await getUserById(id);
      if (!user) return json(404, { error: 'Pemilih tidak ditemukan.' });
      if (await getVoteForUser(id)) return json(409, { error: 'Pemilih yang sudah menggunakan hak suara tidak dapat dihapus.' });
      const users = stores.users();
      await Promise.all([
        users.delete(`user/${id}`),
        users.delete(`username/${user.usernameNormalized || normalizeUsername(user.username)}`)
      ]);
      return json(200, { ok: true });
    }

    if (method === 'POST' && route === '/admin/reset-practice') {
      await stores.votes().deleteAll();
      return json(200, { ok: true });
    }

    if (method === 'POST' && route === '/admin/password') {
      const body = parseBody(event);
      const admin = await ensureAdmin();
      const oldPassword = String(body.oldPassword || '');
      const newPassword = String(body.newPassword || '');
      if (!verifyPassword(oldPassword, admin.passwordHash)) return json(403, { error: 'Password admin lama salah.' });
      if (newPassword.length < 8) return json(400, { error: 'Password admin baru minimal 8 karakter.' });
      const next = { ...admin, passwordHash: hashPassword(newPassword), updatedAt: new Date().toISOString() };
      await stores.admins().setJSON('main', next);
      await destroySession(event);
      return json(200, { ok: true, relogin: true }, { 'set-cookie': sessionCookie(event, '', 0) });
    }

    return json(404, { error: 'Endpoint tidak ditemukan.' });
  } catch (error) {
    console.error('Evoting API error', error);
    const message = error?.message === 'Payload terlalu besar.' || error?.message === 'JSON tidak valid.' ? error.message : 'Terjadi kesalahan pada server.';
    return json(error?.message === 'Payload terlalu besar.' ? 413 : 500, { error: message });
  }
}
