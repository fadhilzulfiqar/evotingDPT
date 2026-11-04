import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9._@+-]{2,80}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_CONFIG = {
  version: 2,
  title: 'Pemilihan Ketua dan Wakil Ketua DPT',
  institution: 'Politeknik Agraria STPN',
  period: '2026–2027',
  tagline: 'SATU SUARA UNTUK MASA DEPAN DPT',
  status: 'scheduled',
  configVersion: 1,
  candidates: {
    ketua: [
      { id: 'K01', number: '01', name: '', photo: '' },
      { id: 'K02', number: '02', name: '', photo: '' }
    ],
    wakil: [
      { id: 'W01', number: '01', name: '', photo: '' },
      { id: 'W02', number: '02', name: '', photo: '' }
    ]
  }
};

const STORE_PREFIX = process.env.CONTEXT === 'production'
  ? 'evotingdpt-fresh-prod-'
  : 'evotingdpt-fresh-preview-';
const storeName = name => STORE_PREFIX + name;
const stores = {
  config: () => getStore(storeName('config')),
  users: () => getStore(storeName('users')),
  votes: () => getStore(storeName('votes')),
  admins: () => getStore(storeName('admins')),
  sessions: () => getStore(storeName('sessions')),
  legacyArchive: () => getStore(storeName('archive'))
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
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

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, 64, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
  });
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derivedKey = await scryptAsync(password, salt);
  return salt + ':' + derivedKey.toString('hex');
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const parts = stored.split(':');
  try {
    const test = await scryptAsync(password, parts[0]);
    const hash = Buffer.from(parts[1], 'hex');
    return hash.length === test.length && crypto.timingSafeEqual(hash, test);
  } catch {
    return false;
  }
}

// Support both the canonical Netlify variable and the legacy mixed-case
// AdminDPT variable. Netlify environment variable names are case-sensitive.
function configuredAdminBootstrapPasswords() {
  return [...new Set([
    process.env.ADMIN_BOOTSTRAP_PASSWORD,
    process.env.AdminDPT,
    process.env.admin_dpt,
    process.env.ADMIN_DPT
  ].map(value => String(value || '')).filter(value => value.length >= 8))];
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function verifyAdminPassword(password, admin) {
  const submitted = String(password ?? '');
  const attempts = [...new Set([
    submitted,
    submitted.trim(),
    submitted.normalize('NFC'),
    submitted.trim().normalize('NFC')
  ])];
  for (const attempt of attempts) {
    if (await verifyPassword(attempt, admin?.passwordHash)) return true;
  }
  return false;
}

function getCookie(event, name) {
  const cookie = event.headers?.cookie || event.headers?.Cookie || '';
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); }
      catch { return null; }
    }
  }
  return null;
}

function isHttps(event) {
  const proto = String(event.headers?.['x-forwarded-proto'] || '').toLowerCase();
  const host = String(event.headers?.host || '');
  return proto === 'https' || (!host.includes('localhost') && !host.startsWith('127.0.0.1'));
}

function sessionCookie(event, token, maxAge = 28800) {
  return 'sid=' + encodeURIComponent(token) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (isHttps(event) ? '; Secure' : '');
}

async function createSession(event, kind, id) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await stores.sessions().setJSON('token/' + token, {
    kind,
    id,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS
  }, { onlyIfNew: true });
  return sessionCookie(event, token);
}

async function getSession(event) {
  const token = getCookie(event, 'sid');
  if (!token) return null;
  const store = stores.sessions();
  const session = await store.get('token/' + token, { type: 'json', consistency: 'strong' });
  if (!session) return null;
  if (!session.expiresAt || session.expiresAt < Date.now()) {
    await store.delete('token/' + token).catch(() => {});
    return null;
  }
  return { ...session, token };
}

async function destroySession(event) {
  const token = getCookie(event, 'sid');
  if (token) await stores.sessions().delete('token/' + token).catch(() => {});
}

async function requireSession(event, kind) {
  const session = await getSession(event);
  return session && session.kind === kind ? session : null;
}

async function getV2Config() {
  const store = stores.config();
  let config = await store.get('v2/main', { type: 'json', consistency: 'strong' });
  if (!config) {
    const result = await store.setJSON('v2/main', DEFAULT_CONFIG, { onlyIfNew: true });
    config = result.modified ? DEFAULT_CONFIG : await store.get('v2/main', { type: 'json', consistency: 'strong' });
  }
  return config || DEFAULT_CONFIG;
}

async function writeAudit(action, targetId = null, details = {}) {
  const store = stores.votes();
  const createdAt = new Date().toISOString();
  const id = Date.now() + '-' + crypto.randomUUID();
  await store.setJSON('v2/audit/' + id, {
    id,
    actor: 'admin',
    action,
    target_id: targetId,
    details,
    created_at: createdAt
  }, { onlyIfNew: true });
}

async function getParticipationEntry(userId) {
  return await stores.votes().getWithMetadata('v2/participation/' + userId, {
    type: 'json',
    consistency: 'strong'
  });
}

async function finalizePendingVote(userId) {
  const votes = stores.votes();
  const participationKey = 'v2/participation/' + userId;
  const lockEntry = await votes.getWithMetadata(participationKey, {
    type: 'json',
    consistency: 'strong'
  });
  if (!lockEntry?.data) return { state: 'none' };
  if (lockEntry.data.state === 'done') {
    return { state: 'done', votedAt: lockEntry.data.votedAt || null };
  }

  const requestId = String(lockEntry.data.requestId || '');
  if (lockEntry.data.state !== 'pending' || !UUID_RE.test(requestId)) {
    return { state: 'pending' };
  }

  const pendingKey = 'v2/pending/' + requestId;
  const pending = await votes.get(pendingKey, { type: 'json', consistency: 'strong' });
  if (!pending) return { state: 'pending' };

  const config = await getV2Config();
  const validChair = config.candidates?.ketua?.some(candidate => candidate.id === pending.chairCandidateId);
  const validVice = config.candidates?.wakil?.some(candidate => candidate.id === pending.viceCandidateId);
  if (
    Number(pending.configVersion) !== Number(config.configVersion || 1) ||
    !validChair ||
    !validVice
  ) {
    return { state: 'conflict' };
  }

  const ballotKey = 'v2/ballot/' + requestId;
  const ballotValue = {
    ballotVersion: 2,
    chairCandidateId: pending.chairCandidateId,
    viceCandidateId: pending.viceCandidateId,
    votedAt: pending.votedAt,
    configVersion: pending.configVersion
  };
  const ballotWrite = await votes.setJSON(ballotKey, ballotValue, { onlyIfNew: true });
  const storedBallot = await votes.get(ballotKey, { type: 'json', consistency: 'strong' });
  if (
    !storedBallot ||
    storedBallot.chairCandidateId !== ballotValue.chairCandidateId ||
    storedBallot.viceCandidateId !== ballotValue.viceCandidateId ||
    storedBallot.configVersion !== ballotValue.configVersion
  ) {
    return { state: 'pending' };
  }

  const latestLock = await votes.getWithMetadata(participationKey, {
    type: 'json',
    consistency: 'strong'
  });
  if (!latestLock?.data) return { state: 'pending' };
  if (latestLock.data.state === 'done') {
    await votes.delete(pendingKey).catch(() => {});
    return { state: 'done', votedAt: latestLock.data.votedAt || ballotValue.votedAt };
  }
  if (latestLock.data.requestId !== requestId || !latestLock.etag) {
    return { state: 'conflict' };
  }

  const doneWrite = await votes.setJSON(participationKey, {
    state: 'done',
    votedAt: ballotValue.votedAt
  }, { onlyIfMatch: latestLock.etag });

  const confirmed = await votes.get(participationKey, { type: 'json', consistency: 'strong' });
  if (confirmed?.state !== 'done') return { state: 'pending' };

  // Once the participation record is finalized, its temporary request token is removed.
  // The accepted ballot contains no voter ID and has no permanent join key to the voter.
  await votes.delete(pendingKey).catch(() => {});
  return { state: 'done', votedAt: ballotValue.votedAt };
}

async function recoverPendingVotes() {
  const votes = stores.votes();
  const prefix = 'v2/participation/';
  const listing = await votes.list({ prefix });
  let recovered = 0;
  const unresolved = [];

  for (const item of listing.blobs || []) {
    const lock = await votes.get(item.key, { type: 'json', consistency: 'strong' });
    if (lock?.state !== 'pending') continue;
    const userId = item.key.slice(prefix.length);
    const result = await finalizePendingVote(userId);
    if (result.state === 'done') recovered += 1;
    else unresolved.push(userId);
  }
  return { recovered, unresolved };
}

async function archiveAndResetElection() {
  const configStore = stores.config();
  const votesStore = stores.votes();
  const archiveStore = stores.legacyArchive();
  const config = await getV2Config();
  if (config.status === 'open' || config.status === 'closing') {
    throw new Error('Tutup pemilihan terlebih dahulu sebelum reset.');
  }

  const recovery = await recoverPendingVotes();
  if (recovery.unresolved.length) {
    throw new Error('Ada ' + recovery.unresolved.length + ' transaksi suara yang belum selesai. Minta pemilih terkait mengirim ulang sebelum reset.');
  }

  const [ballotList, participationList, pendingList] = await Promise.all([
    votesStore.list({ prefix: 'v2/ballot/' }),
    votesStore.list({ prefix: 'v2/participation/' }),
    votesStore.list({ prefix: 'v2/pending/' })
  ]);
  const archiveId = 'v2-reset-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
  const snapshots = { ballots: [], participation: [], pending: [] };

  const copyGroup = async (items, group, sourcePrefix) => {
    for (const item of items || []) {
      const value = await votesStore.get(item.key, { type: 'json', consistency: 'strong' });
      if (!value) throw new Error('Data pemilihan berubah saat proses arsip. Reset dibatalkan.');
      const suffix = item.key.slice(sourcePrefix.length);
      const archiveKey = archiveId + '/' + group + '/' + suffix;
      const result = await archiveStore.setJSON(archiveKey, value, { onlyIfNew: true });
      if (!result.modified) {
        const existing = await archiveStore.get(archiveKey, { type: 'json', consistency: 'strong' });
        if (JSON.stringify(existing) !== JSON.stringify(value)) {
          throw new Error('Verifikasi arsip gagal. Data aktif tidak dihapus.');
        }
      }
      snapshots[group].push({ key: item.key, archiveKey, value });
    }
  };

  await copyGroup(ballotList.blobs, 'ballots', 'v2/ballot/');
  await copyGroup(participationList.blobs, 'participation', 'v2/participation/');
  await copyGroup(pendingList.blobs, 'pending', 'v2/pending/');

  const [ballotsAfter, participationAfter, pendingAfter] = await Promise.all([
    votesStore.list({ prefix: 'v2/ballot/' }),
    votesStore.list({ prefix: 'v2/participation/' }),
    votesStore.list({ prefix: 'v2/pending/' })
  ]);
  const signature = items => (items || []).map(item => item.key).sort().join('|');
  if (
    signature(ballotsAfter.blobs) !== signature(ballotList.blobs) ||
    signature(participationAfter.blobs) !== signature(participationList.blobs) ||
    signature(pendingAfter.blobs) !== signature(pendingList.blobs)
  ) {
    throw new Error('Data pemilihan berubah selama backup. Tidak ada data aktif yang dihapus.');
  }

  for (const group of ['ballots', 'participation', 'pending']) {
    for (const item of snapshots[group]) {
      const sourceValue = await votesStore.get(item.key, { type: 'json', consistency: 'strong' });
      const archiveValue = await archiveStore.get(item.archiveKey, { type: 'json', consistency: 'strong' });
      if (JSON.stringify(sourceValue) !== JSON.stringify(item.value) || JSON.stringify(archiveValue) !== JSON.stringify(item.value)) {
        throw new Error('Checksum arsip tidak cocok. Tidak ada data aktif yang dihapus.');
      }
    }
  }

  const checksumItems = [
    ...snapshots.ballots.map(item => ({ store: 'ballots', key: item.key, value: item.value })),
    ...snapshots.participation.map(item => ({ store: 'participation', key: item.key, value: item.value })),
    ...snapshots.pending.map(item => ({ store: 'pending', key: item.key, value: item.value }))
  ].sort((a, b) => (a.store + '/' + a.key).localeCompare(b.store + '/' + b.key));
  const sha256 = crypto.createHash('sha256').update(JSON.stringify(checksumItems)).digest('hex');
  const manifest = {
    archiveId,
    type: 'v2-election-reset',
    createdAt: new Date().toISOString(),
    ballotRecordsCopied: snapshots.ballots.length,
    participationRecordsCopied: snapshots.participation.length,
    pendingRecordsCopied: snapshots.pending.length,
    snapshotVerified: true,
    sha256,
    note: 'Arsip surat suara dan partisipasi disimpan terpisah. Arsip tidak menyimpan hubungan antara identitas pemilih dan pilihan.'
  };
  await archiveStore.setJSON(archiveId + '/manifest', manifest, { onlyIfNew: true });

  const latestConfig = await getV2Config();
  if (latestConfig.status === 'open' || latestConfig.status === 'closing') {
    throw new Error('Status pemilihan berubah. Reset dibatalkan sebelum penghapusan data.');
  }

  for (const item of snapshots.ballots) await votesStore.delete(item.key);
  for (const item of snapshots.participation) await votesStore.delete(item.key);
  for (const item of snapshots.pending) await votesStore.delete(item.key);

  await configStore.setJSON('v2/main', {
    ...latestConfig,
    status: 'scheduled',
    configVersion: Number(latestConfig.configVersion || 1) + 1
  });
  await writeAudit('election.reset_archived', archiveId, {
    ballotRecordsCopied: snapshots.ballots.length,
    participationRecordsCopied: snapshots.participation.length,
    pendingRecordsCopied: snapshots.pending.length,
    sha256
  });
  return {
    archiveId,
    ballotRecordsCopied: snapshots.ballots.length,
    participationRecordsCopied: snapshots.participation.length,
    pendingRecordsCopied: snapshots.pending.length,
    sha256
  };
}

async function ensureAdmin() {
  const store = stores.admins();
  let admin = await store.get('main', { type: 'json', consistency: 'strong' });
  const bootstrap = configuredAdminBootstrapPasswords()[0] || '';

  // Restore the proven legacy behavior: Netlify bootstrap is the source of
  // truth for first-time setup and deliberate password rotation.
  if (bootstrap.length < 8) {
    if (admin) return admin;
    return null;
  }

  const bootstrapFingerprint = crypto.createHash('sha256').update(bootstrap).digest('hex');

  if (!admin) {
    const seed = {
      username: 'admin_dpt',
      passwordHash: await hashPassword(bootstrap),
      bootstrapFingerprint,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const result = await store.setJSON('main', seed, { onlyIfNew: true });
    if (result.modified) return seed;
    admin = await store.get('main', { type: 'json', consistency: 'strong' });
  }

  // Rotate the password when the Netlify bootstrap value changes, as in the
  // previous working application. Voter, ballot and election stores are untouched.
  if (admin && admin.bootstrapFingerprint !== bootstrapFingerprint) {
    admin = {
      ...admin,
      username: 'admin_dpt',
      passwordHash: await hashPassword(bootstrap),
      bootstrapFingerprint,
      updatedAt: new Date().toISOString()
    };
    await store.setJSON('main', admin);
  }

  return admin;
}

async function getUserById(id) {
  return await stores.users().get('user/' + id, { type: 'json', consistency: 'strong' });
}

async function getUserByUsername(username) {
  const key = normalizeUsername(username);
  if (!key) return null;
  const mapping = await stores.users().get('username/' + key, { type: 'json', consistency: 'strong' });
  if (!mapping?.id) return null;
  return await getUserById(mapping.id);
}

async function addUser(input) {
  const name = String(input?.name || '').trim();
  const username = String(input?.username || '').trim();
  const password = String(input?.password || '');
  const normalized = normalizeUsername(username);
  if (!name || !USERNAME_RE.test(username) || password.length < 4) {
    return { ok: false, error: 'Nama, username valid, dan password minimal 4 karakter wajib diisi.' };
  }
  const users = stores.users();
  const id = crypto.randomUUID();
  const mapping = await users.setJSON('username/' + normalized, { id }, { onlyIfNew: true });
  if (!mapping.modified) return { ok: false, duplicate: true, error: 'Username sudah digunakan.' };
  try {
    await users.setJSON('user/' + id, {
      id,
      name,
      username,
      usernameNormalized: normalized,
      passwordHash: await hashPassword(password),
      active: true,
      createdAt: new Date().toISOString()
    }, { onlyIfNew: true });
    return { ok: true, id };
  } catch (error) {
    await users.delete('user/' + id).catch(() => {});
    await users.delete('username/' + normalized).catch(() => {});
    throw error;
  }
}

function normalizeCandidateGroup(items, prefix) {
  if (!Array.isArray(items) || items.length !== 2) {
    throw new Error('Setiap jabatan harus memiliki tepat dua calon.');
  }
  return items.map((item, index) => ({
    id: prefix + '0' + (index + 1),
    number: '0' + (index + 1),
    name: String(item?.name || '').trim().slice(0, 120),
    photo: String(item?.photo || '').slice(0, 1_250_000)
  }));
}

function isCompleteCandidates(candidates) {
  return ['ketua', 'wakil'].every(role =>
    Array.isArray(candidates[role]) &&
    candidates[role].length === 2 &&
    candidates[role].every(candidate =>
      candidate.name.length > 1 &&
      /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(candidate.photo)
    )
  );
}

async function getAdminStats() {
  const usersStore = stores.users();
  const votesStore = stores.votes();
  const [userList, participationList, ballotList, config] = await Promise.all([
    usersStore.list({ prefix: 'user/' }),
    votesStore.list({ prefix: 'v2/participation/' }),
    votesStore.list({ prefix: 'v2/ballot/' }),
    getV2Config()
  ]);

  const users = (await Promise.all(
    userList.blobs.map(blob => usersStore.get(blob.key, { type: 'json', consistency: 'strong' }))
  )).filter(Boolean);
  const participationEntries = await Promise.all(
    participationList.blobs.map(async blob => ({
      userId: blob.key.slice('v2/participation/'.length),
      record: await votesStore.get(blob.key, { type: 'json', consistency: 'strong' })
    }))
  );
  const ballots = (await Promise.all(
    ballotList.blobs.map(blob => votesStore.get(blob.key, { type: 'json', consistency: 'strong' }))
  )).filter(Boolean);

  const participationByUser = new Map(
    participationEntries.filter(entry => entry.record).map(entry => [entry.userId, entry.record])
  );

  const chairCounts = { K01: 0, K02: 0 };
  const viceCounts = { W01: 0, W02: 0 };
  let updatedAt = null;
  for (const ballot of ballots) {
    if (Object.prototype.hasOwnProperty.call(chairCounts, ballot.chairCandidateId)) chairCounts[ballot.chairCandidateId] += 1;
    if (Object.prototype.hasOwnProperty.call(viceCounts, ballot.viceCandidateId)) viceCounts[ballot.viceCandidateId] += 1;
    if (ballot.votedAt && (!updatedAt || ballot.votedAt > updatedAt)) updatedAt = ballot.votedAt;
  }

  const safeUsers = users.map(user => {
    const participation = participationByUser.get(user.id);
    const pending = participation?.state === 'pending';
    const done = participation?.state === 'done';
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      active: user.active !== false,
      hasVoted: done,
      votePending: pending,
      votedAt: done ? participation.votedAt || null : null
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'id'));

  const activeTotal = safeUsers.filter(user => user.active).length;
  const voted = safeUsers.filter(user => user.active && user.hasVoted).length;
  const pending = safeUsers.filter(user => user.active && user.votePending).length;
  const remaining = Math.max(0, activeTotal - voted);

  return {
    setupRequired: false,
    total: safeUsers.length,
    activeTotal,
    voted,
    pending,
    remaining,
    participation: activeTotal ? Math.round(voted / activeTotal * 1000) / 10 : 0,
    chairCounts: config.status === 'open' || config.status === 'closing' || pending > 0 ? null : chairCounts,
    viceCounts: config.status === 'open' || config.status === 'closing' || pending > 0 ? null : viceCounts,
    totalBallots: config.status === 'open' || config.status === 'closing' || pending > 0 ? null : ballots.length,
    resultsVisible: config.status !== 'open' && config.status !== 'closing' && pending === 0,
    users: safeUsers,
    config: { ...config, configVersion: Number(config.configVersion || 1) },
    database: 'netlify-blobs',
    storage: 'netlify-blobs',
    updatedAt,
    recoveryRequired: pending > 0
  };
}

async function archiveLegacyData() {
  const configStore = stores.config();
  const usersStore = stores.users();
  const votesStore = stores.votes();
  const archiveStore = stores.legacyArchive();
  const backupId = 'legacy-trial-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex');
  const oldConfig = await configStore.get('main', { type: 'json', consistency: 'strong' });
  if (oldConfig?.status === 'open') {
    const error = new Error('Tutup pemungutan suara trial lama melalui dashboard admin lama sebelum membuat backup.');
    error.code = 'LEGACY_ELECTION_OPEN';
    throw error;
  }

  const [voterKeys, usernameKeys, lockKeys, ballotKeys] = await Promise.all([
    usersStore.list({ prefix: 'user/' }),
    usersStore.list({ prefix: 'username/' }),
    votesStore.list({ prefix: 'voter/' }),
    votesStore.list({ prefix: 'ballot/' })
  ]);
  const snapshots = {
    users: [],
    usernames: [],
    voterLocks: [],
    ballots: []
  };

  if (oldConfig) await archiveStore.setJSON(backupId + '/legacy-config', oldConfig, { onlyIfNew: true });

  const copyGroup = async (entries, sourceStore, destinationPrefix, snapshotGroup) => {
    for (const entry of (entries.blobs || [])) {
      const value = await sourceStore.get(entry.key, { type: 'json', consistency: 'strong' });
      if (value) {
        await archiveStore.setJSON(backupId + '/' + destinationPrefix + entry.key, value, { onlyIfNew: true });
        snapshots[snapshotGroup].push({ key: entry.key, value });
      }
    }
  };

  await copyGroup(voterKeys, usersStore, 'users/', 'users');
  await copyGroup(usernameKeys, usersStore, 'users/', 'usernames');
  await copyGroup(lockKeys, votesStore, 'votes/', 'voterLocks');
  await copyGroup(ballotKeys, votesStore, 'votes/', 'ballots');

  const [configAfter, userKeysAfter, usernameKeysAfter, lockKeysAfter, ballotKeysAfter] = await Promise.all([
    configStore.get('main', { type: 'json', consistency: 'strong' }),
    usersStore.list({ prefix: 'user/' }),
    usersStore.list({ prefix: 'username/' }),
    votesStore.list({ prefix: 'voter/' }),
    votesStore.list({ prefix: 'ballot/' })
  ]);
  const keySignature = entries => (entries || []).map(entry => entry.key).sort().join('|');
  let stable = JSON.stringify(configAfter) === JSON.stringify(oldConfig)
    && keySignature(userKeysAfter.blobs) === keySignature(userKeys.blobs)
    && keySignature(usernameKeysAfter.blobs) === keySignature(usernameKeys.blobs)
    && keySignature(lockKeysAfter.blobs) === keySignature(lockKeys.blobs)
    && keySignature(ballotKeysAfter.blobs) === keySignature(ballotKeys.blobs);

  const verifyGroup = async (items, sourceStore) => {
    for (const item of items) {
      const current = await sourceStore.get(item.key, { type: 'json', consistency: 'strong' });
      if (JSON.stringify(current) !== JSON.stringify(item.value)) return false;
    }
    return true;
  };
  if (stable) stable = await verifyGroup(snapshots.users, usersStore);
  if (stable) stable = await verifyGroup(snapshots.usernames, usersStore);
  if (stable) stable = await verifyGroup(snapshots.voterLocks, votesStore);
  if (stable) stable = await verifyGroup(snapshots.ballots, votesStore);

  if (!stable) {
    const error = new Error('Data trial berubah ketika backup berlangsung. Tutup sistem trial, tunggu transaksi selesai, lalu ulangi backup.');
    error.code = 'LEGACY_CHANGED_DURING_BACKUP';
    throw error;
  }

  const checksumItems = [
    ...(oldConfig ? [{ store: 'config', key: 'main', value: oldConfig }] : []),
    ...snapshots.users.map(item => ({ store: 'users', key: item.key, value: item.value })),
    ...snapshots.usernames.map(item => ({ store: 'usernames', key: item.key, value: item.value })),
    ...snapshots.voterLocks.map(item => ({ store: 'voter-locks', key: item.key, value: item.value })),
    ...snapshots.ballots.map(item => ({ store: 'ballots', key: item.key, value: item.value }))
  ].sort((a, b) => (a.store + '/' + a.key).localeCompare(b.store + '/' + b.key));
  const checksum = crypto.createHash('sha256').update(JSON.stringify(checksumItems)).digest('hex');

  const manifest = {
    backupId,
    type: 'legacy-trial-preservation',
    createdAt: new Date().toISOString(),
    legacyConfigCopied: Boolean(oldConfig),
    userRecordsCopied: snapshots.users.length,
    usernameMappingsCopied: snapshots.usernames.length,
    voterLockRecordsCopied: snapshots.voterLocks.length,
    ballotRecordsCopied: snapshots.ballots.length,
    snapshotVerified: true,
    sha256: checksum,
    originalStoresRetained: true,
    voterAccountsRetainedInOriginalStore: true,
    note: 'Arsip privat berisi data akun (termasuk password hash), konfigurasi, voter-lock, dan ballot lama. Jangan tampilkan isi arsip pada dashboard atau ekspor publik.'
  };
  await archiveStore.setJSON(backupId + '/manifest', manifest, { onlyIfNew: true });
  return manifest;
}

async function handleEvent(event) {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  let route = event.path || '';
  route = route.replace(/^\/\.netlify\/functions\/api-v2/, '');
  route = route.replace(/^\/api\/v2/, '');
  route = route || '/';

  try {
    if (method === 'GET' && route === '/health') {
      await getV2Config();
      await stores.votes().list({ prefix: 'v2/' });
      return json(200, { ok: true, storage: 'netlify-blobs', electionVersion: 2 });
    }

    if (method === 'GET' && route === '/election') {
      const config = await getV2Config();
      return json(200, { ...config, configVersion: Number(config.configVersion || 1), setupRequired: false });
    }

    if (method === 'POST' && route === '/login') {
      const body = parseBody(event);
      const user = await getUserByUsername(body.username);
      if (!user || !(await verifyPassword(body.password, user.passwordHash))) return json(401, { error: 'Username atau password salah.' });
      if (user.active === false) return json(403, { error: 'Akun pemilih telah dinonaktifkan oleh panitia.' });
      const cookie = await createSession(event, 'voter', user.id);
      return json(200, { ok: true, user: { name: user.name, username: user.username } }, { 'set-cookie': cookie });
    }

    if (method === 'GET' && route === '/me') {
      const session = await requireSession(event, 'voter');
      if (!session) return json(200, { loggedIn: false });
      const user = await getUserById(session.id);
      if (!user || user.active === false) return json(200, { loggedIn: false });
      let participation = await getParticipationEntry(user.id);
      if (participation?.data?.state === 'pending') {
        await finalizePendingVote(user.id);
        participation = await getParticipationEntry(user.id);
      }
      return json(200, {
        loggedIn: true,
        user: {
          name: user.name,
          username: user.username,
          hasVoted: participation?.data?.state === 'done',
          votePending: participation?.data?.state === 'pending',
          votedAt: participation?.data?.state === 'done' ? participation.data.votedAt || null : null
        }
      });
    }

    if (method === 'POST' && route === '/logout') {
      await destroySession(event);
      return json(200, { ok: true }, { 'set-cookie': sessionCookie(event, '', 0) });
    }

    if (method === 'POST' && route === '/vote') {
      const session = await requireSession(event, 'voter');
      if (!session) return json(401, { error: 'Sesi pemilih tidak valid. Silakan login kembali.' });
      const user = await getUserById(session.id);
      if (!user || user.active === false) return json(403, { error: 'Akun pemilih tidak aktif.' });

      const body = parseBody(event);
      const chairCandidateId = String(body.chairCandidateId || '');
      const viceCandidateId = String(body.viceCandidateId || '');
      const idempotencyKey = String(body.idempotencyKey || '');
      const submittedConfigVersion = Number(body.configVersion);
      if (!Number.isInteger(submittedConfigVersion) || submittedConfigVersion < 1) return json(400, { error: 'Versi daftar calon tidak valid. Muat ulang halaman.' });
      if (!UUID_RE.test(idempotencyKey)) return json(400, { error: 'Kunci transaksi tidak valid. Muat ulang halaman.' });

      const config = await getV2Config();
      if (config.status !== 'open') return json(403, { error: 'Pemungutan suara sedang tidak dibuka.' });
      if (Number(config.configVersion || 1) !== submittedConfigVersion) {
        return json(409, { error: 'Data calon telah diperbarui. Muat ulang halaman sebelum mengirim suara.' });
      }

      const validChair = config.candidates.ketua.some(candidate => candidate.id === chairCandidateId);
      const validVice = config.candidates.wakil.some(candidate => candidate.id === viceCandidateId);
      if (!validChair || !validVice) return json(400, { error: 'Pilih tepat satu calon Ketua dan satu calon Wakil.' });

      const votes = stores.votes();
      const participationKey = 'v2/participation/' + user.id;
      let lock = await votes.getWithMetadata(participationKey, { type: 'json', consistency: 'strong' });
      if (lock?.data?.state === 'done') {
        return json(409, { error: 'Akun ini sudah menggunakan hak pilih.' });
      }

      if (!lock?.data) {
        const requestId = crypto.randomUUID();
        await votes.setJSON(participationKey, {
          state: 'pending',
          requestId,
          startedAt: new Date().toISOString()
        }, { onlyIfNew: true });
        lock = await votes.getWithMetadata(participationKey, { type: 'json', consistency: 'strong' });
      }

      if (!lock?.data || lock.data.state !== 'pending' || !UUID_RE.test(String(lock.data.requestId || ''))) {
        return json(503, { error: 'Status hak pilih sedang diproses. Muat ulang halaman dan coba kembali.' });
      }

      const requestId = lock.data.requestId;
      const pendingKey = 'v2/pending/' + requestId;
      let pending = await votes.get(pendingKey, { type: 'json', consistency: 'strong' });
      if (!pending) {
        const proposed = {
          chairCandidateId,
          viceCandidateId,
          configVersion: submittedConfigVersion,
          votedAt: new Date().toISOString()
        };
        await votes.setJSON(pendingKey, proposed, { onlyIfNew: true });
        pending = await votes.get(pendingKey, { type: 'json', consistency: 'strong' });
      }

      if (!pending) return json(503, { error: 'Transaksi suara belum tersimpan sempurna. Silakan kirim ulang pilihan.' });
      const pendingChairValid = config.candidates.ketua.some(candidate => candidate.id === pending.chairCandidateId);
      const pendingViceValid = config.candidates.wakil.some(candidate => candidate.id === pending.viceCandidateId);
      if (
        Number(pending.configVersion) !== Number(config.configVersion || 1) ||
        !pendingChairValid ||
        !pendingViceValid
      ) {
        return json(409, { error: 'Transaksi sebelumnya perlu pemeriksaan panitia. Suara belum dihitung.' });
      }

      const result = await finalizePendingVote(user.id);
      if (result.state !== 'done') {
        return json(503, { error: 'Suara sedang diproses. Jangan mengirim pilihan dari akun lain; muat ulang halaman untuk memeriksa status.' });
      }
      return json(200, {
        ok: true,
        message: 'Pilihan Ketua dan Wakil berhasil direkam.',
        votedAt: result.votedAt
      });
    }

    if (method === 'GET' && route === '/admin/setup-status') {
      const admin = await stores.admins().get('main', { type: 'json', consistency: 'strong' });
      return json(200, {
        setupRequired: !admin,
        bootstrapConfigured: configuredAdminBootstrapPasswords().length > 0,
        authMode: 'legacy-bootstrap-sync-v1'
      });
    }

    if (method === 'POST' && route === '/admin/recover') {
      const body = parseBody(event);
      const bootstraps = configuredAdminBootstrapPasswords();
      if (!bootstraps.some(value => timingSafeTextEqual(body.bootstrapPassword, value))) {
        return json(403, { error: 'Kode pemulihan admin tidak cocok.' });
      }
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 12) return json(400, { error: 'Password baru minimal 12 karakter.' });
      const admin = await stores.admins().get('main', { type: 'json', consistency: 'strong' });
      const bootstrap = configuredAdminBootstrapPasswords()[0] || '';
      const next = {
        username: admin?.username || 'admin_dpt',
        passwordHash: await hashPassword(newPassword),
        bootstrapFingerprint: bootstrap.length >= 8
          ? crypto.createHash('sha256').update(bootstrap).digest('hex')
          : admin?.bootstrapFingerprint || '',
        createdAt: admin?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await stores.admins().setJSON('main', next);
      await writeAudit('admin.password_recovered', 'admin', {});
      await destroySession(event);
      return json(200, { ok: true }, { 'set-cookie': sessionCookie(event, '', 0) });
    }

    if (method === 'POST' && route === '/admin/login') {
      const body = parseBody(event);
      const admin = await ensureAdmin();
      if (!admin) return json(503, { error: 'Akun admin belum disiapkan. Periksa ADMIN_BOOTSTRAP_PASSWORD pada Environment variables Netlify.' });
      if (normalizeUsername(body.username) !== normalizeUsername(admin.username) || !(await verifyAdminPassword(body.password, admin))) {
        return json(401, { error: 'Username atau password admin tidak cocok.' });
      }
      const cookie = await createSession(event, 'admin', 'admin');
      return json(200, { ok: true }, { 'set-cookie': cookie });
    }

    if (method === 'POST' && route === '/admin/logout') {
      await destroySession(event);
      return json(200, { ok: true }, { 'set-cookie': sessionCookie(event, '', 0) });
    }

    const adminSession = route.startsWith('/admin/') ? await requireSession(event, 'admin') : null;
    if (route.startsWith('/admin/') && !adminSession) return json(401, { error: 'Akses admin tidak valid.' });

    if (method === 'GET' && route === '/admin/stats') return json(200, await getAdminStats());

    if (method === 'POST' && route === '/admin/config') {
      const body = parseBody(event);
      const configStore = stores.config();
      const currentEntry = await configStore.getWithMetadata('v2/main', { type: 'json', consistency: 'strong' });
      const current = currentEntry?.data || await getV2Config();
      const currentStatus = current.status || 'scheduled';
      const currentVersion = Number(current.configVersion || 1);
      const allowedStatus = ['scheduled', 'open', 'closed'];
      const nextStatus = allowedStatus.includes(body.status) ? body.status : currentStatus;
      let candidates;
      try {
        candidates = {
          ketua: normalizeCandidateGroup(body.candidates?.ketua ?? current.candidates.ketua, 'K'),
          wakil: normalizeCandidateGroup(body.candidates?.wakil ?? current.candidates.wakil, 'W')
        };
      } catch (error) {
        return json(400, { error: error.message });
      }

      const candidatesChanged = JSON.stringify(candidates) !== JSON.stringify(current.candidates);
      if ((currentStatus === 'open' || currentStatus === 'closing') && candidatesChanged) {
        return json(409, { error: 'Data calon tidak dapat diubah ketika pemungutan suara sedang berlangsung atau ada transaksi yang belum selesai.' });
      }

      if (nextStatus === 'open' && !isCompleteCandidates(candidates)) {
        return json(400, { error: 'Lengkapi nama dan unggah foto untuk dua calon Ketua serta dua calon Wakil sebelum membuka pemilihan.' });
      }

      if ((currentStatus === 'open' && nextStatus !== 'open') || (currentStatus === 'closing' && nextStatus !== 'open')) {
        const closing = { ...current, status: 'closing' };
        const closeWrite = currentEntry?.etag
          ? await configStore.setJSON('v2/main', closing, { onlyIfMatch: currentEntry.etag })
          : { modified: false };
        if (!closeWrite.modified) {
          return json(409, { error: 'Konfigurasi berubah bersamaan. Muat ulang dashboard dan ulangi.' });
        }
        const recovery = await recoverPendingVotes();
        if (recovery.unresolved.length) {
          await configStore.setJSON('v2/main', { ...closing, status: 'open' });
          return json(409, {
            error: 'Ada ' + recovery.unresolved.length + ' transaksi yang belum dapat dipulihkan. Minta pemilih terkait mengirim ulang sebelum menutup pemilihan.'
          });
        }
      }

      if (nextStatus === 'open') {
        // A voter with a pending claim but no stored selection must be allowed to retry.
        // Existing recoverable transactions are completed before the election is reopened.
        await recoverPendingVotes();
      }

      const nextVersion = candidatesChanged ? currentVersion + 1 : currentVersion;
      const next = {
        ...current,
        configVersion: nextVersion,
        title: String(body.title ?? current.title).slice(0, 160),
        institution: String(body.institution ?? current.institution).slice(0, 160),
        period: String(body.period ?? current.period).slice(0, 80),
        tagline: String(body.tagline ?? current.tagline).slice(0, 220),
        candidates,
        status: nextStatus
      };

      await configStore.setJSON('v2/main', next);
      await writeAudit('election.config.updated', null, { status: nextStatus, candidatesChanged });
      return json(200, { ok: true, config: next, storageConfigured: true });
    }

    if (method === 'POST' && route === '/admin/users/add') {
      const result = await addUser(parseBody(event));
      if (!result.ok) return json(result.duplicate ? 409 : 400, { error: result.error });
      await writeAudit('voter.created', result.id, {});
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
      await writeAudit('voter.bulk_import', null, { added, skipped: skipped.length });
      return json(200, { ok: true, added, skipped });
    }

    if (method === 'POST' && route === '/admin/users/update') {
      const body = parseBody(event);
      const id = String(body.id || '');
      const user = await getUserById(id);
      if (!user) return json(404, { error: 'Pemilih tidak ditemukan.' });
      const name = String(body.name || '').trim();
      const password = String(body.password || '');
      if (!name) return json(400, { error: 'Nama lengkap tidak boleh kosong.' });
      if (password && password.length < 4) return json(400, { error: 'Password minimal 4 karakter.' });
      const next = { ...user, name, updatedAt: new Date().toISOString() };
      if (password) next.passwordHash = await hashPassword(password);
      await stores.users().setJSON('user/' + id, next);
      await writeAudit('voter.updated', id, { nameChanged: name !== user.name, passwordChanged: Boolean(password) });
      return json(200, { ok: true });
    }

    if (method === 'POST' && (route === '/admin/users/deactivate' || route === '/admin/users/delete')) {
      const body = parseBody(event);
      const id = String(body.id || '');
      const user = await getUserById(id);
      if (!user) return json(404, { error: 'Pemilih tidak ditemukan.' });
      const participation = await getParticipationEntry(id);
      if (participation?.data) return json(409, { error: 'Akun yang sudah memilih atau sedang memproses suara tidak dapat dinonaktifkan.' });
      const next = { ...user, active: false, deactivatedAt: new Date().toISOString() };
      await stores.users().setJSON('user/' + id, next);
      await writeAudit('voter.deactivated', id, { username: user.username });
      return json(200, { ok: true, message: 'Akun dinonaktifkan; data akun tetap disimpan.' });
    }

    if (method === 'POST' && route === '/admin/users/activate') {
      const body = parseBody(event);
      const id = String(body.id || '');
      const user = await getUserById(id);
      if (!user) return json(404, { error: 'Pemilih tidak ditemukan.' });
      await stores.users().setJSON('user/' + id, { ...user, active: true, reactivatedAt: new Date().toISOString() });
      await writeAudit('voter.activated', id, { username: user.username });
      return json(200, { ok: true });
    }

    if (method === 'POST' && route === '/admin/legacy-archive') {
      if (process.env.CONTEXT !== 'production') return json(409, { error: 'Arsip data produksi hanya dapat dijalankan pada deploy production setelah pemeriksaan admin.' });
      let manifest;
      try {
        manifest = await archiveLegacyData();
      } catch (error) {
        if (error.code === 'LEGACY_ELECTION_OPEN' || error.code === 'LEGACY_CHANGED_DURING_BACKUP') {
          return json(409, { error: error.message });
        }
        throw error;
      }
      await writeAudit('legacy_trial.archived', manifest.backupId, {
        voterLockRecordsCopied: manifest.voterLockRecordsCopied,
        ballotRecordsCopied: manifest.ballotRecordsCopied
      });
      return json(200, { ok: true, manifest });
    }

    if (method === 'POST' && route === '/admin/reset-practice') {
      if (process.env.CONTEXT !== 'production') {
        return json(409, { error: 'Reset data produksi hanya dapat dijalankan pada deploy production.' });
      }
      try {
        const result = await archiveAndResetElection();
        return json(200, {
          ok: true,
          ...result,
          message: 'Data pemilihan v2 diarsipkan dan direset. Akun pemilih serta konfigurasi calon tetap tersimpan.'
        });
      } catch (error) {
        return json(409, { error: error.message || 'Reset gagal. Data aktif tidak dihapus.' });
      }
    }

    if (method === 'GET' && route === '/admin/audit') {
      const store = stores.votes();
      const listing = await store.list({ prefix: 'v2/audit/' });
      const entries = (await Promise.all(
        listing.blobs.map(blob => store.get(blob.key, { type: 'json', consistency: 'strong' }))
      )).filter(Boolean).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 150);
      return json(200, { entries });
    }

    if (method === 'POST' && route === '/admin/password') {
      const body = parseBody(event);
      const admin = await ensureAdmin();
      const oldPassword = String(body.oldPassword || '');
      const newPassword = String(body.newPassword || '');
      if (!admin || !(await verifyPassword(oldPassword, admin.passwordHash))) return json(403, { error: 'Password admin lama salah.' });
      if (newPassword.length < 8) return json(400, { error: 'Password admin baru minimal 8 karakter.' });
      const next = { ...admin, passwordHash: await hashPassword(newPassword), updatedAt: new Date().toISOString() };
      await stores.admins().setJSON('main', next);
      await writeAudit('admin.password_changed', 'admin', {});
      await destroySession(event);
      return json(200, { ok: true }, { 'set-cookie': sessionCookie(event, '', 0) });
    }

    return json(404, { error: 'Endpoint tidak ditemukan.' });
  } catch (error) {
    console.error('E-Voting v2 API error:', error);
    return json(500, { error: 'Terjadi kesalahan server. Silakan coba kembali atau hubungi administrator.' });
  }
}

export default async (request, context) => {
  // Use the modern Netlify Functions 2.0 Request/Response interface.
  // Netlify injects the Blobs execution context automatically in this mode.
  const url = new URL(request.url);
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? null
    : await request.text();
  const event = {
    path: url.pathname,
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body,
    isBase64Encoded: false
  };
  const result = await handleEvent(event);
  return new Response(result.body || null, {
    status: result.statusCode || 200,
    headers: result.headers || { 'cache-control': 'no-store' }
  });
};
