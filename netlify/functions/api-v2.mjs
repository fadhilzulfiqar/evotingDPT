import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9._@+-]{2,80}$/;
const V2 = 'evoting-v2';
const stores = {
  config: () => getStore(V2 + '-config'),
  users: () => getStore(V2 + '-voters'),
  ballots: () => getStore(V2 + '-ballots'),
  admins: () => getStore(V2 + '-admins'),
  sessions: () => getStore(V2 + '-sessions'),
  audit: () => getStore(V2 + '-admin-audit'),
  archive: () => getStore(V2 + '-v1-archive')
};
const legacy = {
  config: () => getStore('evoting-config'),
  users: () => getStore('evoting-users'),
  votes: () => getStore('evoting-votes'),
  admins: () => getStore('evoting-admins')
};
const DEFAULT_CONFIG = {
  title: 'Pemilihan Ketua dan Wakil Ketua DPT',
  institution: 'Politeknik Agraria STPN',
  period: '2026–2027',
  tagline: 'Pemimpin Parlemen DPT Periode 2026–2027',
  status: 'scheduled',
  chairCandidates: [{ id: 'K01', number: '01', name: '', photo: '' }, { id: 'K02', number: '02', name: '', photo: '' }],
  viceCandidates: [{ id: 'W01', number: '01', name: '', photo: '' }, { id: 'W02', number: '02', name: '', photo: '' }]
};

function json(statusCode, body, headers = {}) {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }, body: JSON.stringify(body) };
}
function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw, 'utf8') > 5_000_000) throw new Error('Payload terlalu besar.');
  try { return JSON.parse(raw); } catch { throw new Error('JSON tidak valid.'); }
}
function normalizeUsername(v) { return String(v || '').trim().toLowerCase(); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hex] = stored.split(':');
  try {
    const a = crypto.scryptSync(String(password), salt, 64);
    const b = Buffer.from(hex, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
function cookieValue(event, name) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i >= 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function secureCookie(event, token, maxAge = 28800) {
  const https = String(event.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https';
  return 'sidv2=' + encodeURIComponent(token) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (https ? '; Secure' : '');
}
async function createSession(event, kind, id) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await stores.sessions().setJSON('token/' + token, { kind, id, createdAt: now, expiresAt: now + SESSION_TTL_MS }, { onlyIfNew: true });
  return secureCookie(event, token);
}
async function session(event) {
  const token = cookieValue(event, 'sidv2');
  if (!token) return null;
  const s = await stores.sessions().get('token/' + token, { type: 'json', consistency: 'strong' });
  if (!s) return null;
  if (!s.expiresAt || s.expiresAt < Date.now()) {
    await stores.sessions().delete('token/' + token).catch(() => {});
    return null;
  }
  return { ...s, token };
}
async function requireKind(event, kind) {
  const s = await session(event);
  return s?.kind === kind ? s : null;
}
async function logout(event) {
  const token = cookieValue(event, 'sidv2');
  if (token) await stores.sessions().delete('token/' + token).catch(() => {});
}
async function getConfig() {
  const store = stores.config();
  let cfg = await store.get('main', { type: 'json', consistency: 'strong' });
  if (!cfg) {
    await store.setJSON('main', DEFAULT_CONFIG, { onlyIfNew: true });
    cfg = await store.get('main', { type: 'json', consistency: 'strong' });
  }
  return cfg || DEFAULT_CONFIG;
}
async function ensureAdmin() {
  const store = stores.admins();
  let admin = await store.get('main', { type: 'json', consistency: 'strong' });
  const bootstrap = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.admin_dpt || process.env.ADMIN_DPT || '');
  if (bootstrap.length < 8) {
    if (admin) return admin;
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD belum diatur atau kurang dari 8 karakter.');
  }
  const fingerprint = crypto.createHash('sha256').update(bootstrap).digest('hex');
  if (!admin) {
    const seed = { username: 'admin_dpt', passwordHash: hashPassword(bootstrap), bootstrapFingerprint: fingerprint, updatedAt: new Date().toISOString() };
    const result = await store.setJSON('main', seed, { onlyIfNew: true });
    if (result.modified) return seed;
    admin = await store.get('main', { type: 'json', consistency: 'strong' });
  }
  if (admin && admin.bootstrapFingerprint !== fingerprint) {
    admin = { ...admin, username: 'admin_dpt', passwordHash: hashPassword(bootstrap), bootstrapFingerprint: fingerprint, updatedAt: new Date().toISOString() };
    await store.setJSON('main', admin);
  }
  return admin;
}
async function getUser(id) { return stores.users().get('user/' + id, { type: 'json', consistency: 'strong' }); }
async function getUserByUsername(username) {
  const key = normalizeUsername(username);
  const map = await stores.users().get('username/' + key, { type: 'json', consistency: 'strong' });
  return map?.id ? getUser(map.id) : null;
}
async function addUser(row) {
  const name = String(row?.name || '').trim();
  const username = String(row?.username || '').trim();
  const password = String(row?.password || '');
  const normalized = normalizeUsername(username);
  if (!name || !USERNAME_RE.test(username) || password.length < 4) return { ok: false, error: 'Nama, username valid, dan password minimal 4 karakter wajib diisi.' };
  const id = crypto.randomUUID();
  const users = stores.users();
  const map = await users.setJSON('username/' + normalized, { id }, { onlyIfNew: true });
  if (!map.modified) return { ok: false, duplicate: true, error: 'Username sudah digunakan.' };
  try {
    await users.setJSON('user/' + id, { id, name, username, usernameNormalized: normalized, passwordHash: hashPassword(password), active: true, createdAt: new Date().toISOString() }, { onlyIfNew: true });
    return { ok: true, id };
  } catch (e) {
    await users.delete('username/' + normalized).catch(() => {});
    throw e;
  }
}
async function writeAudit(adminId, action, detail = {}) {
  const id = Date.now() + '-' + crypto.randomBytes(5).toString('hex');
  await stores.audit().setJSON('event/' + id, { id, adminId, action, detail, at: new Date().toISOString() }, { onlyIfNew: true });
}
function publicConfig(cfg) {
  return {
    title: cfg.title, institution: cfg.institution, period: cfg.period, tagline: cfg.tagline, status: cfg.status,
    chairCandidates: (cfg.chairCandidates || []).map(({ id, number, name, photo }) => ({ id, number, name, photo })),
    viceCandidates: (cfg.viceCandidates || []).map(({ id, number, name, photo }) => ({ id, number, name, photo }))
  };
}
async function adminStats() {
  const [userList, lockList, ballotList, cfg] = await Promise.all([
    stores.users().list({ prefix: 'user/' }),
    stores.ballots().list({ prefix: 'voter/' }),
    stores.ballots().list({ prefix: 'ballot/' }),
    getConfig()
  ]);
  const users = (await Promise.all(userList.blobs.map(b => stores.users().get(b.key, { type: 'json', consistency: 'strong' })))).filter(Boolean);
  const locks = (await Promise.all(lockList.blobs.map(b => stores.ballots().get(b.key, { type: 'json', consistency: 'strong' })))).filter(Boolean);
  const ballots = (await Promise.all(ballotList.blobs.map(b => stores.ballots().get(b.key, { type: 'json', consistency: 'strong' })))).filter(Boolean);
  const lockByVoter = new Map(locks.map(x => [x.voterId, x]));
  const chairCounts = Object.fromEntries((cfg.chairCandidates || []).map(c => [c.id, 0]));
  const viceCounts = Object.fromEntries((cfg.viceCandidates || []).map(c => [c.id, 0]));
  let updatedAt = null;
  for (const b of ballots) {
    if (Object.hasOwn(chairCounts, b.chairCandidateId)) chairCounts[b.chairCandidateId]++;
    if (Object.hasOwn(viceCounts, b.viceCandidateId)) viceCounts[b.viceCandidateId]++;
    if (b.votedAt && (!updatedAt || b.votedAt > updatedAt)) updatedAt = b.votedAt;
  }
  const safeUsers = users.filter(u => u.active !== false).map(u => {
    const lock = lockByVoter.get(u.id);
    return { id: u.id, name: u.name, username: u.username, hasVoted: lock?.state === 'done', votedAt: lock?.votedAt || null };
  }).sort((a,b) => a.name.localeCompare(b.name, 'id'));
  const voted = safeUsers.filter(u => u.hasVoted).length;
  return {
    total: safeUsers.length, voted, remaining: safeUsers.length - voted,
    participation: safeUsers.length ? Math.round(voted / safeUsers.length * 1000) / 10 : 0,
    chairCounts, viceCounts, users: safeUsers, config: publicConfig(cfg), updatedAt,
    ballotTotal: ballots.length
  };
}
function route(event) {
  return (event.path || '').replace(/^\/\.netlify\/functions\/api-v2/, '').replace(/^\/api-v2/, '') || '/';
}
async function handle(event) {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  const path = route(event);
  try {
    if (method === 'GET' && path === '/health') return json(200, { ok: true, version: 2, storage: 'isolated-netlify-blobs' });
    if (method === 'GET' && path === '/election') return json(200, publicConfig(await getConfig()));
    if (method === 'GET' && path === '/me') {
      const s = await requireKind(event, 'voter');
      if (!s) return json(200, { loggedIn: false });
      const u = await getUser(s.id);
      if (!u || u.active === false) return json(200, { loggedIn: false });
      const lock = await stores.ballots().get('voter/' + u.id, { type: 'json', consistency: 'strong' });
      return json(200, { loggedIn: true, user: { name: u.name, username: u.username, hasVoted: lock?.state === 'done', votedAt: lock?.votedAt || null } });
    }
    if (method === 'POST' && path === '/login') {
      const body = parseBody(event);
      const user = await getUserByUsername(body.username);
      if (!user || user.active === false || !verifyPassword(body.password, user.passwordHash)) return json(401, { error: 'Username atau password salah.' });
      const lock = await stores.ballots().get('voter/' + user.id, { type: 'json', consistency: 'strong' });
      return json(200, { ok: true, user: { name: user.name, username: user.username, hasVoted: lock?.state === 'done' } }, { 'set-cookie': await createSession(event, 'voter', user.id) });
    }
    if (method === 'POST' && path === '/logout') {
      await logout(event);
      return json(200, { ok: true }, { 'set-cookie': secureCookie(event, '', 0) });
    }
    if (method === 'POST' && path === '/vote') {
      const s = await requireKind(event, 'voter');
      if (!s) return json(401, { error: 'Sesi pemilih tidak valid.' });
      const user = await getUser(s.id);
      if (!user || user.active === false) return json(401, { error: 'Akun pemilih tidak aktif.' });
      const body = parseBody(event);
      const chairId = String(body.chairCandidateId || '');
      const viceId = String(body.viceCandidateId || '');
      const cfg = await getConfig();
      if (cfg.status !== 'open') return json(403, { error: 'Pemungutan suara belum dibuka atau telah ditutup.' });
      if (!cfg.chairCandidates.some(c => c.id === chairId) || !cfg.viceCandidates.some(c => c.id === viceId)) return json(400, { error: 'Pilih tepat satu calon Ketua dan satu calon Wakil Ketua.' });
      const ballotStore = stores.ballots();
      const existing = await ballotStore.get('voter/' + user.id, { type: 'json', consistency: 'strong' });
      let ballotId, votedAt;
      if (existing?.state === 'done') return json(409, { error: 'Hak suara akun ini sudah digunakan.' });
      if (existing?.state === 'pending') {
        ballotId = existing.ballotId;
        votedAt = existing.votedAt;
      } else {
        ballotId = crypto.randomUUID();
        votedAt = new Date().toISOString();
        const claim = await ballotStore.setJSON('voter/' + user.id, { voterId: user.id, state: 'pending', ballotId, votedAt }, { onlyIfNew: true });
        if (!claim.modified) return json(409, { error: 'Permintaan suara lain sedang diproses. Muat ulang status akun.' });
      }
      const ballot = { chairCandidateId: chairId, viceCandidateId: viceId, votedAt };
      const saved = await ballotStore.setJSON('ballot/' + ballotId, ballot, { onlyIfNew: true });
      if (!saved.modified) {
        const prior = await ballotStore.get('ballot/' + ballotId, { type: 'json', consistency: 'strong' });
        if (!prior || prior.chairCandidateId !== chairId || prior.viceCandidateId !== viceId) return json(409, { error: 'Permintaan suara sebelumnya sedang diproses. Muat ulang dan hubungi panitia jika status tidak berubah.' });
      }
      await ballotStore.setJSON('voter/' + user.id, { voterId: user.id, state: 'done', votedAt });
      return json(200, { ok: true, votedAt, message: 'Pilihan Ketua dan Wakil berhasil direkam.' });
    }

    if (method === 'POST' && path === '/admin/login') {
      const body = parseBody(event);
      const admin = await ensureAdmin();
      if (String(body.username || '') !== admin.username || !verifyPassword(body.password, admin.passwordHash)) return json(401, { error: 'Login admin salah.' });
      return json(200, { ok: true }, { 'set-cookie': await createSession(event, 'admin', 'admin') });
    }
    if (method === 'POST' && path === '/admin/logout') {
      await logout(event);
      return json(200, { ok: true }, { 'set-cookie': secureCookie(event, '', 0) });
    }
    const admin = path.startsWith('/admin/') ? await requireKind(event, 'admin') : null;
    if (path.startsWith('/admin/') && !admin) return json(401, { error: 'Unauthorized' });

    if (method === 'GET' && path === '/admin/stats') return json(200, await adminStats());
    if (method === 'GET' && path === '/admin/migration-status') { const marker = await stores.archive().get('migration/complete', { type: 'json', consistency: 'strong' }); return json(200, { completed: Boolean(marker), migration: marker || null }); }
    if (method === 'POST' && path === '/admin/migrate') {
      if (process.env.CONTEXT !== 'production') return json(409, { error: 'Migrasi hanya dapat dijalankan pada deployment production setelah persetujuan cutover.' });
      const marker = await stores.archive().get('migration/complete', { type: 'json', consistency: 'strong' });
      if (marker) return json(409, { error: 'Migrasi sebelumnya sudah selesai.', migration: marker });
      const existingV2 = await stores.users().list({ prefix: 'user/' });
      if (existingV2.blobs.length) return json(409, { error: 'Database V2 sudah berisi akun. Migrasi otomatis dihentikan.' });
      const sourceStores = { config: legacy.config(), users: legacy.users(), votes: legacy.votes(), admins: legacy.admins() };
      const archiveId = new Date().toISOString().replace(/[:.]/g, '-');
      const backupCounts = {};
      for (const [name, source] of Object.entries(sourceStores)) {
        const listing = await source.list();
        backupCounts[name] = listing.blobs.length;
        for (const blob of listing.blobs) {
          const value = await source.get(blob.key, { type: 'json', consistency: 'strong' });
          if (value !== null && value !== undefined) { const checksum = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); await stores.archive().setJSON('backup/' + archiveId + '/' + name + '/' + blob.key, { checksum, value }, { onlyIfNew: true }); }
        }
      }
      const verify = {};
      for (const [name, count] of Object.entries(backupCounts)) {
        const listing = await stores.archive().list({ prefix: 'backup/' + archiveId + '/' + name + '/' });
        verify[name] = listing.blobs.length;
        if (verify[name] !== count) return json(500, { error: 'Verifikasi backup gagal untuk ' + name + '.', backupCounts, verify });
      }
      const oldUsers = await legacy.users().list({ prefix: 'user/' });
      let imported = 0;
      for (const blob of oldUsers.blobs) {
        const user = await legacy.users().get(blob.key, { type: 'json', consistency: 'strong' });
        if (!user?.id || !user?.passwordHash) continue;
        await stores.users().setJSON('user/' + user.id, { ...user, active: true, migratedFromV1: true }, { onlyIfNew: true });
        await stores.users().setJSON('username/' + normalizeUsername(user.username), { id: user.id }, { onlyIfNew: true });
        imported++;
      }
      const markerValue = { archiveId, backupCounts, verify, importedUsers: imported, completedAt: new Date().toISOString(), legacyTrialVotesArchivedNotImported: true };
      await stores.archive().setJSON('migration/complete', markerValue, { onlyIfNew: true });
      await writeAudit('admin', 'legacy-migration-complete', markerValue);
      return json(200, { ok: true, migration: markerValue });
    }
    if (method === 'POST' && path === '/admin/config') {
      const body = parseBody(event);
      const current = await getConfig();
      if (current.status === 'open' && (body.status !== 'closed')) return json(409, { error: 'Konfigurasi kandidat tidak dapat diubah saat pemilihan dibuka. Tutup pemilihan terlebih dahulu.' });
      const cleanGroup = (arr, prefix) => {
        if (!Array.isArray(arr) || arr.length !== 2) throw new Error('Setiap jabatan harus memiliki tepat dua calon.');
        return arr.map((c, i) => ({
          id: prefix + String(i + 1).padStart(2, '0'),
          number: String(i + 1).padStart(2, '0'),
          name: String(c.name || '').trim().slice(0, 120),
          photo: String(c.photo || '').slice(0, 1_200_000)
        }));
      };
      const chairCandidates = body.chairCandidates ? cleanGroup(body.chairCandidates, 'K') : current.chairCandidates;
      const viceCandidates = body.viceCandidates ? cleanGroup(body.viceCandidates, 'W') : current.viceCandidates;
      if (body.status === 'open' && [...chairCandidates, ...viceCandidates].some(c => !c.name || !c.photo)) return json(400, { error: 'Lengkapi nama dan foto keempat calon sebelum membuka pemilihan.' });
      const next = {
        ...current,
        title: String(body.title ?? current.title).slice(0, 160),
        institution: String(body.institution ?? current.institution).slice(0, 160),
        period: String(body.period ?? current.period).slice(0, 80),
        tagline: String(body.tagline ?? current.tagline).slice(0, 160),
        status: ['scheduled', 'open', 'closed'].includes(body.status) ? body.status : current.status,
        chairCandidates, viceCandidates
      };
      await stores.config().setJSON('main', next);
      await writeAudit('admin', 'config-updated', { status: next.status });
      return json(200, { ok: true, config: publicConfig(next) });
    }
    if (method === 'POST' && path === '/admin/users/add') {
      const result = await addUser(parseBody(event));
      if (!result.ok) return json(result.duplicate ? 409 : 400, { error: result.error });
      await writeAudit('admin', 'voter-added', { id: result.id });
      return json(200, result);
    }
    if (method === 'POST' && path === '/admin/users/bulk') {
      const body = parseBody(event);
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
      let added = 0; const skipped = [];
      for (const row of rows) {
        const r = await addUser(row);
        if (r.ok) added++; else skipped.push({ username: String(row?.username || ''), reason: r.error });
      }
      await writeAudit('admin', 'voters-bulk-added', { added, skipped: skipped.length });
      return json(200, { ok: true, added, skipped });
    }
    if (method === 'POST' && path === '/admin/users/delete') {
      const { id } = parseBody(event);
      const user = await getUser(String(id || ''));
      if (!user) return json(404, { error: 'Pemilih tidak ditemukan.' });
      const lock = await stores.ballots().get('voter/' + user.id, { type: 'json', consistency: 'strong' });
      if (lock) return json(409, { error: 'Akun yang sudah memilih tidak dapat dihapus.' });
      await Promise.all([stores.users().delete('user/' + user.id), stores.users().delete('username/' + normalizeUsername(user.username))]);
      await writeAudit('admin', 'voter-deleted', { id: user.id });
      return json(200, { ok: true });
    }
    if (method === 'POST' && path === '/admin/password') {
      const body = parseBody(event);
      const current = await ensureAdmin();
      if (!verifyPassword(body.oldPassword, current.passwordHash)) return json(403, { error: 'Password admin lama salah.' });
      if (String(body.newPassword || '').length < 8) return json(400, { error: 'Password minimal 8 karakter.' });
      await stores.admins().setJSON('main', { ...current, passwordHash: hashPassword(body.newPassword), updatedAt: new Date().toISOString() });
      await logout(event);
      return json(200, { ok: true, relogin: true }, { 'set-cookie': secureCookie(event, '', 0) });
    }
    if (method === 'POST' && path === '/admin/reset') {
      const cfg = await getConfig();
      if (cfg.status === 'open') return json(409, { error: 'Tutup pemilihan terlebih dahulu.' });
      const body = parseBody(event);
      if (body.confirm !== 'RESET V2') return json(400, { error: 'Konfirmasi reset tidak valid.' });
      const lockList = await stores.ballots().list({ prefix: 'voter/' });
      const ballotList = await stores.ballots().list({ prefix: 'ballot/' });
      for (const b of [...lockList.blobs, ...ballotList.blobs]) await stores.ballots().delete(b.key);
      await writeAudit('admin', 'v2-votes-reset', { locks: lockList.blobs.length, ballots: ballotList.blobs.length });
      return json(200, { ok: true });
    }
    if (method === 'GET' && path === '/admin/audit') {
      const list = await stores.audit().list({ prefix: 'event/' });
      const events = await Promise.all(list.blobs.map(b => stores.audit().get(b.key, { type: 'json' })));
      return json(200, events.filter(Boolean).sort((a,b) => b.at.localeCompare(a.at)).slice(0, 200));
    }
    return json(404, { error: 'Endpoint tidak ditemukan.' });
  } catch (e) {
    console.error('E-Voting V2 API error', e);
    return json(500, { error: e?.message?.includes('dua calon') || e?.message === 'Payload terlalu besar.' ? e.message : 'Terjadi kesalahan pada server V2.' });
  }
}
export default async function handler(request) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const event = { path: url.pathname, httpMethod: method, headers: Object.fromEntries(request.headers.entries()), body: method === 'GET' || method === 'HEAD' ? '' : await request.text(), isBase64Encoded: false };
  const result = await handle(event);
  return new Response(result.body || '', { status: result.statusCode || 200, headers: result.headers || {} });
}
