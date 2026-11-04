import { getStore } from '@netlify/blobs';
import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;
const ELECTION_ID = 'dpt-2026-2027-independent-v2';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9._@+-]{2,80}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 7000,
      allowExitOnIdle: true
    })
  : null;

const DEFAULT_CONFIG = {
  version: 2,
  title: 'Pemilihan Ketua dan Wakil Ketua DPT',
  institution: 'Politeknik Agraria STPN',
  period: '2026–2027',
  tagline: 'Pemimpin Parlemen DPT Periode 2026–2027',
  status: 'scheduled',
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

const STORE_PREFIX = process.env.CONTEXT === 'production' ? '' : 'v2-preview-';
const storeName = name => STORE_PREFIX + name;
const stores = {
  config: () => getStore(storeName('evoting-config')),
  users: () => getStore(storeName('evoting-users')),
  votes: () => getStore(storeName('evoting-votes')),
  admins: () => getStore(storeName('evoting-admins')),
  sessions: () => getStore(storeName('evoting-sessions')),
  legacyArchive: () => getStore(storeName('evoting-legacy-archive'))
};

let schemaPromise = null;

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

async function ensureSchema() {
  if (!pool) throw new Error('DATABASE_URL belum dikonfigurasi. Hubungkan PostgreSQL sebelum pemilihan dibuka.');
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ELECTION_ID + ':schema']);
        await client.query(
          'CREATE TABLE IF NOT EXISTS evoting_v2_schema_meta (schema_key TEXT PRIMARY KEY, version INTEGER NOT NULL)'
        );
        const meta = await client.query(
          'SELECT version FROM evoting_v2_schema_meta WHERE schema_key=$1 FOR UPDATE',
          [ELECTION_ID]
        );
        if (Number(meta.rows[0]?.version || 0) >= 2) {
          await client.query('COMMIT');
          return true;
        }

        const ddl =
          'CREATE TABLE IF NOT EXISTS evoting_v2_election_control (' +
          'election_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN (\'scheduled\',\'open\',\'closed\')), config_version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());\n' +
          'CREATE TABLE IF NOT EXISTS evoting_v2_eligibility (' +
          'election_id TEXT NOT NULL, voter_id TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (election_id, voter_id));\n' +
          'CREATE TABLE IF NOT EXISTS evoting_v2_participation (' +
          'election_id TEXT NOT NULL, voter_id TEXT NOT NULL, voted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (election_id, voter_id));\n' +
          'CREATE TABLE IF NOT EXISTS evoting_v2_ballots (' +
          'ballot_id UUID PRIMARY KEY, election_id TEXT NOT NULL, idempotency_key UUID NOT NULL, chair_candidate_id TEXT NOT NULL, vice_candidate_id TEXT NOT NULL, UNIQUE (election_id, idempotency_key));\n' +
          'CREATE INDEX IF NOT EXISTS evoting_v2_ballots_election_idx ON evoting_v2_ballots (election_id);\n' +
          'CREATE TABLE IF NOT EXISTS evoting_v2_ballot_archive (' +
          'archive_id UUID NOT NULL, election_id TEXT NOT NULL, ballot_id UUID NOT NULL, chair_candidate_id TEXT NOT NULL, vice_candidate_id TEXT NOT NULL, archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (archive_id, ballot_id));\n' +
          'CREATE TABLE IF NOT EXISTS evoting_v2_participation_archive (' +
          'archive_id UUID NOT NULL, election_id TEXT NOT NULL, voter_id TEXT NOT NULL, voted_at TIMESTAMPTZ NOT NULL, archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (archive_id, election_id, voter_id));\n' +
          'CREATE TABLE IF NOT EXISTS evoting_v2_admin_audit (' +
          'id BIGSERIAL PRIMARY KEY, election_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, details JSONB NOT NULL DEFAULT \'{}\'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());\n' +
          'INSERT INTO evoting_v2_election_control (election_id, status) VALUES (\'dpt-2026-2027-independent-v2\', \'scheduled\') ON CONFLICT (election_id) DO NOTHING;';
        await client.query(ddl);
        await client.query('ALTER TABLE evoting_v2_election_control ADD COLUMN IF NOT EXISTS config_version INTEGER NOT NULL DEFAULT 1');

        // Exact ballot timestamps could be correlated with voter participation timestamps.
        // Preserve the timestamp only in the identity/participation table, never on ballots.
        await client.query('ALTER TABLE evoting_v2_ballots DROP COLUMN IF EXISTS voted_at');
        await client.query('ALTER TABLE evoting_v2_ballot_archive DROP COLUMN IF EXISTS voted_at');

        const ballotConstraints = [
          {
            name: 'evoting_v2_ballots_chair_check',
            sql: "ALTER TABLE evoting_v2_ballots ADD CONSTRAINT evoting_v2_ballots_chair_check CHECK (chair_candidate_id IN ('K01','K02'))"
          },
          {
            name: 'evoting_v2_ballots_vice_check',
            sql: "ALTER TABLE evoting_v2_ballots ADD CONSTRAINT evoting_v2_ballots_vice_check CHECK (vice_candidate_id IN ('W01','W02'))"
          }
        ];
        const existingConstraints = await client.query(
          'SELECT conname FROM pg_constraint WHERE conrelid = \'evoting_v2_ballots\'::regclass AND conname = ANY($1::text[])',
          [ballotConstraints.map(item => item.name)]
        );
        const existingConstraintNames = new Set(existingConstraints.rows.map(row => row.conname));
        for (const constraint of ballotConstraints) {
          if (!existingConstraintNames.has(constraint.name)) await client.query(constraint.sql);
        }
        await client.query(
          'INSERT INTO evoting_v2_schema_meta (schema_key,version) VALUES ($1,2) ' +
          'ON CONFLICT (schema_key) DO UPDATE SET version=EXCLUDED.version',
          [ELECTION_ID]
        );
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
async function getControl() {
  await ensureSchema();
  const result = await pool.query(
    'SELECT status, config_version FROM evoting_v2_election_control WHERE election_id = $1',
    [ELECTION_ID]
  );
  return result.rows[0] || { status: 'scheduled', config_version: 1 };
}

async function getControlStatus() {
  return (await getControl()).status;
}

async function setControlStatus(status, client = pool, configVersion = 1) {
  await client.query(
    'INSERT INTO evoting_v2_election_control (election_id, status, config_version, updated_at) VALUES ($1, $2, $3, NOW()) ' +
    'ON CONFLICT (election_id) DO UPDATE SET status = EXCLUDED.status, config_version = EXCLUDED.config_version, updated_at = NOW()',
    [ELECTION_ID, status, configVersion]
  );
}

async function writeAudit(action, targetId = null, details = {}) {
  await ensureSchema();
  await pool.query(
    'INSERT INTO evoting_v2_admin_audit (election_id, actor, action, target_id, details) VALUES ($1,$2,$3,$4,$5::jsonb)',
    [ELECTION_ID, 'admin', action, targetId, JSON.stringify(details)]
  );
}

async function ensureAdmin() {
  const store = stores.admins();
  const existing = await store.get('main', { type: 'json', consistency: 'strong' });
  if (existing) return existing;

  const bootstrap = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.admin_dpt || process.env.ADMIN_DPT || '');
  if (bootstrap.length < 8) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD belum diatur atau kurang dari 8 karakter.');
  }
  const seed = {
    username: 'admin_dpt',
    passwordHash: await hashPassword(bootstrap),
    updatedAt: new Date().toISOString()
  };
  const result = await store.setJSON('main', seed, { onlyIfNew: true });
  if (result.modified) return seed;
  return await store.get('main', { type: 'json', consistency: 'strong' });
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
    if (pool) {
      await ensureSchema();
      await pool.query(
        'INSERT INTO evoting_v2_eligibility (election_id, voter_id, active) VALUES ($1,$2,TRUE) ON CONFLICT DO NOTHING',
        [ELECTION_ID, id]
      );
    }
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
  return items.map((item, index) => {
    const photo = String(item?.photo || '');
    if (photo.length > 1_250_000) throw new Error('Ukuran foto terlalu besar. Maksimal 900 KB per foto.');
    return {
      id: prefix + '0' + (index + 1),
      number: '0' + (index + 1),
      name: String(item?.name || '').trim().slice(0, 120),
      photo
    };
  });
}

function isCompleteCandidates(candidates) {
  return ['ketua', 'wakil'].every(role =>
    Array.isArray(candidates[role]) &&
    candidates[role].length === 2 &&
    candidates[role].every(candidate =>
      candidate.name.length > 1 &&
      candidate.photo.length <= 1_250_000 &&
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(candidate.photo)
    )
  );
}

async function getAdminStats() {
  const usersStore = stores.users();
  const userList = await usersStore.list({ prefix: 'user/' });
  const users = (await Promise.all(
    userList.blobs.map(blob => usersStore.get(blob.key, { type: 'json', consistency: 'strong' }))
  )).filter(Boolean);
  const config = await getV2Config();

  if (!pool) {
    return {
      setupRequired: true,
      total: users.length,
      activeTotal: users.filter(user => user.active !== false).length,
      voted: null,
      remaining: null,
      participation: null,
      chairCounts: { K01: 0, K02: 0 },
      viceCounts: { W01: 0, W02: 0 },
      totalBallots: 0,
      resultsVisible: true,
      users: users.map(user => ({
        id: user.id,
        name: user.name,
        username: user.username,
        active: user.active !== false,
        hasVoted: null,
        votedAt: null
      })).sort((a, b) => a.name.localeCompare(b.name, 'id')),
      config: { ...config, status: 'scheduled', configVersion: Number(config.configVersion || 1) },
      database: 'not-configured'
    };
  }

  await ensureSchema();
  if (users.length) {
    await pool.query(
      'INSERT INTO evoting_v2_eligibility (election_id,voter_id,active) ' +
      'SELECT $1, source.voter_id, source.active FROM UNNEST($2::text[],$3::boolean[]) AS source(voter_id,active) ' +
      'ON CONFLICT (election_id,voter_id) DO NOTHING',
      [ELECTION_ID, users.map(user => user.id), users.map(user => user.active !== false)]
    );
  }

  const [eligibilityResult, participationResult, countResult, controlResult] = await Promise.all([
    pool.query('SELECT voter_id, active FROM evoting_v2_eligibility WHERE election_id=$1', [ELECTION_ID]),
    pool.query('SELECT voter_id, voted_at FROM evoting_v2_participation WHERE election_id=$1', [ELECTION_ID]),
    pool.query(
      'SELECT \'ketua\' AS role, chair_candidate_id AS candidate_id, COUNT(*)::int AS total ' +
      'FROM evoting_v2_ballots WHERE election_id=$1 GROUP BY chair_candidate_id ' +
      'UNION ALL SELECT \'wakil\' AS role, vice_candidate_id AS candidate_id, COUNT(*)::int AS total ' +
      'FROM evoting_v2_ballots WHERE election_id=$1 GROUP BY vice_candidate_id',
      [ELECTION_ID]
    ),
    pool.query('SELECT status,config_version FROM evoting_v2_election_control WHERE election_id=$1', [ELECTION_ID])
  ]);

  const eligibility = new Map(eligibilityResult.rows.map(row => [row.voter_id, row.active]));
  const participation = new Map(participationResult.rows.map(row => [row.voter_id, row.voted_at]));
  const chairCounts = { K01: 0, K02: 0 };
  const viceCounts = { W01: 0, W02: 0 };
  for (const row of countResult.rows) {
    if (row.role === 'ketua' && Object.prototype.hasOwnProperty.call(chairCounts, row.candidate_id)) chairCounts[row.candidate_id] = Number(row.total);
    if (row.role === 'wakil' && Object.prototype.hasOwnProperty.call(viceCounts, row.candidate_id)) viceCounts[row.candidate_id] = Number(row.total);
  }

  const safeUsers = users.map(user => {
    const active = eligibility.has(user.id) ? eligibility.get(user.id) : user.active !== false;
    const votedAt = participation.get(user.id) || null;
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      active,
      hasVoted: Boolean(votedAt),
      votedAt: votedAt ? new Date(votedAt).toISOString() : null
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'id'));

  const activeTotal = safeUsers.filter(user => user.active).length;
  const voted = safeUsers.filter(user => user.active && user.hasVoted).length;
  const totalBallots = Object.values(chairCounts).reduce((sum, value) => sum + value, 0);
  const viceBallotTotal = Object.values(viceCounts).reduce((sum, value) => sum + value, 0);
  const participationTotal = participationResult.rows.length;
  const reconciliationOk = totalBallots === viceBallotTotal && totalBallots === participationTotal;
  const electionStatus = controlResult.rows[0]?.status || 'scheduled';
  const resultsVisible = electionStatus !== 'open';
  return {
    setupRequired: false,
    total: safeUsers.length,
    activeTotal,
    voted,
    remaining: Math.max(0, activeTotal - voted),
    participation: activeTotal ? Math.round(voted / activeTotal * 1000) / 10 : 0,
    chairCounts: resultsVisible ? chairCounts : null,
    viceCounts: resultsVisible ? viceCounts : null,
    totalBallots: resultsVisible ? totalBallots : null,
    resultsVisible,
    reconciliationOk,
    users: safeUsers,
    config: { ...config, status: electionStatus, configVersion: Math.max(Number(config.configVersion || 1), Number(controlResult.rows[0]?.config_version || 1)) },
    database: 'postgresql'
  };
}

async function verifyLegacyArchiveStillCurrent(manifest) {
  if (!manifest?.backupId || manifest.snapshotVerified !== true || manifest.archiveReadbackVerified !== true) return false;
  const configStore = stores.config();
  const votesStore = stores.votes();
  const archiveStore = stores.legacyArchive();
  const [currentConfig, voterEntries, ballotEntries, archivedEntries] = await Promise.all([
    configStore.get('main', { type: 'json', consistency: 'strong' }),
    votesStore.list({ prefix: 'voter/' }),
    votesStore.list({ prefix: 'ballot/' }),
    archiveStore.list({ prefix: manifest.backupId + '/votes/' })
  ]);
  if (currentConfig?.status === 'open') return false;
  const archivedConfig = await archiveStore.get(manifest.backupId + '/legacy-config', { type: 'json', consistency: 'strong' });
  if (JSON.stringify(currentConfig) !== JSON.stringify(archivedConfig)) return false;
  const currentVoterKeys = (voterEntries.blobs || []).map(entry => entry.key).sort();
  const currentBallotKeys = (ballotEntries.blobs || []).map(entry => entry.key).sort();
  const archivedVotePrefix = manifest.backupId + '/votes/';
  const archivedVoteKeys = (archivedEntries.blobs || []).map(entry => entry.key.slice(archivedVotePrefix.length)).sort();
  const expectedKeys = [...currentVoterKeys, ...currentBallotKeys].sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(archivedVoteKeys)) return false;
  if (currentVoterKeys.length !== Number(manifest.voterLockRecordsCopied)
      || currentBallotKeys.length !== Number(manifest.ballotRecordsCopied)) return false;
  const comparisons = await Promise.all(expectedKeys.map(async key => {
    const [current, archived] = await Promise.all([
      votesStore.get(key, { type: 'json', consistency: 'strong' }),
      archiveStore.get(archivedVotePrefix + key, { type: 'json', consistency: 'strong' })
    ]);
    return JSON.stringify(current) === JSON.stringify(archived);
  }));
  if (!comparisons.every(Boolean)) return false;
  const [finalConfig, finalVoters, finalBallots] = await Promise.all([
    configStore.get('main', { type: 'json', consistency: 'strong' }),
    votesStore.list({ prefix: 'voter/' }),
    votesStore.list({ prefix: 'ballot/' })
  ]);
  const sortedKeys = entries => (entries || []).map(entry => entry.key).sort();
  return JSON.stringify(finalConfig) === JSON.stringify(currentConfig)
    && JSON.stringify(sortedKeys(finalVoters.blobs)) === JSON.stringify(currentVoterKeys)
    && JSON.stringify(sortedKeys(finalBallots.blobs)) === JSON.stringify(currentBallotKeys);
}

async function getLatestLegacyArchiveManifest() {
  const archiveStore = stores.legacyArchive();
  const entries = await archiveStore.list({ prefix: 'legacy-trial-' });
  const manifestKeys = (entries.blobs || [])
    .map(entry => entry.key)
    .filter(key => key.endsWith('/manifest'))
    .sort()
    .reverse();
  for (const key of manifestKeys) {
    const manifest = await archiveStore.get(key, { type: 'json', consistency: 'strong' });
    if (manifest?.snapshotVerified === true && manifest?.archiveReadbackVerified === true
        && await verifyLegacyArchiveStillCurrent(manifest)) return manifest;
  }
  return null;
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

  const [voterKeysResult, ballotKeysResult, userKeysResult] = await Promise.all([
    votesStore.list({ prefix: 'voter/' }),
    votesStore.list({ prefix: 'ballot/' }),
    usersStore.list({ prefix: 'user/' })
  ]);
  const voterKeys = voterKeysResult.blobs || [];
  const ballotKeys = ballotKeysResult.blobs || [];
  const userAccountCount = (userKeysResult.blobs || []).length;
  const voterSnapshot = [];
  const ballotSnapshot = [];

  if (oldConfig) await archiveStore.setJSON(backupId + '/legacy-config', oldConfig, { onlyIfNew: true });

  for (const entry of voterKeys) {
    const value = await votesStore.get(entry.key, { type: 'json', consistency: 'strong' });
    if (value) {
      await archiveStore.setJSON(backupId + '/votes/' + entry.key, value, { onlyIfNew: true });
      voterSnapshot.push({ key: entry.key, value });
    }
  }
  for (const entry of ballotKeys) {
    const value = await votesStore.get(entry.key, { type: 'json', consistency: 'strong' });
    if (value) {
      await archiveStore.setJSON(backupId + '/votes/' + entry.key, value, { onlyIfNew: true });
      ballotSnapshot.push({ key: entry.key, value });
    }
  }

  const [configAfter, voterKeysAfter, ballotKeysAfter, userKeysAfter] = await Promise.all([
    configStore.get('main', { type: 'json', consistency: 'strong' }),
    votesStore.list({ prefix: 'voter/' }),
    votesStore.list({ prefix: 'ballot/' }),
    usersStore.list({ prefix: 'user/' })
  ]);
  const keySignature = entries => (entries || []).map(entry => entry.key).sort().join('|');
  let stable = JSON.stringify(configAfter) === JSON.stringify(oldConfig)
    && keySignature(voterKeysAfter.blobs) === keySignature(voterKeys)
    && keySignature(ballotKeysAfter.blobs) === keySignature(ballotKeys)
    && keySignature(userKeysAfter.blobs) === keySignature(userKeysResult.blobs);

  if (stable) {
    for (const item of voterSnapshot) {
      const current = await votesStore.get(item.key, { type: 'json', consistency: 'strong' });
      if (JSON.stringify(current) !== JSON.stringify(item.value)) { stable = false; break; }
    }
  }
  if (stable) {
    for (const item of ballotSnapshot) {
      const current = await votesStore.get(item.key, { type: 'json', consistency: 'strong' });
      if (JSON.stringify(current) !== JSON.stringify(item.value)) { stable = false; break; }
    }
  }
  if (!stable) {
    const error = new Error('Data trial berubah ketika backup berlangsung. Tutup sistem trial, tunggu transaksi selesai, lalu ulangi backup.');
    error.code = 'LEGACY_CHANGED_DURING_BACKUP';
    throw error;
  }

  // Read every copied object back from the archive store before marking the
  // backup verified. A source-stability check alone is not proof of a good copy.
  let archiveReadbackVerified = true;
  if (oldConfig) {
    const copiedConfig = await archiveStore.get(backupId + '/legacy-config', { type: 'json', consistency: 'strong' });
    archiveReadbackVerified = JSON.stringify(copiedConfig) === JSON.stringify(oldConfig);
  }
  if (archiveReadbackVerified) {
    for (const item of voterSnapshot) {
      const copied = await archiveStore.get(backupId + '/votes/' + item.key, { type: 'json', consistency: 'strong' });
      if (JSON.stringify(copied) !== JSON.stringify(item.value)) { archiveReadbackVerified = false; break; }
    }
  }
  if (archiveReadbackVerified) {
    for (const item of ballotSnapshot) {
      const copied = await archiveStore.get(backupId + '/votes/' + item.key, { type: 'json', consistency: 'strong' });
      if (JSON.stringify(copied) !== JSON.stringify(item.value)) { archiveReadbackVerified = false; break; }
    }
  }
  if (!archiveReadbackVerified) {
    const error = new Error('Salinan arsip tidak lolos verifikasi baca-ulang. Data sumber tetap dipertahankan; ulangi backup setelah memeriksa penyimpanan.');
    error.code = 'LEGACY_ARCHIVE_VERIFY_FAILED';
    throw error;
  }

  const manifest = {
    backupId,
    type: 'legacy-trial-preservation',
    createdAt: new Date().toISOString(),
    legacyConfigCopied: Boolean(oldConfig),
    voterLockRecordsCopied: voterSnapshot.length,
    ballotRecordsCopied: ballotSnapshot.length,
    legacyUserRecordsRetained: userAccountCount,
    snapshotVerified: true,
    archiveReadbackVerified: true,
    originalStoresRetained: true,
    voterAccountsRetainedInOriginalStore: true,
    note: 'Arsip privat untuk preservasi. Record voter-lock lama dapat memuat hubungan internal antara akun dan pilihan. Jangan tampilkan isi arsip pada dashboard atau ekspor publik.'
  };
  const manifestKey = backupId + '/manifest';
  await archiveStore.setJSON(manifestKey, manifest, { onlyIfNew: true });
  const manifestReadback = await archiveStore.get(manifestKey, { type: 'json', consistency: 'strong' });
  if (JSON.stringify(manifestReadback) !== JSON.stringify(manifest)) {
    const error = new Error('Manifest backup tidak dapat diverifikasi. Data sumber tetap dipertahankan.');
    error.code = 'LEGACY_MANIFEST_VERIFY_FAILED';
    throw error;
  }
  return manifest;
}
function isSameOriginRequest(event) {
  const origin = String(event.headers?.origin || '');
  if (!origin) return true; // Non-browser clients and local load-test runners.
  const host = String(event.headers?.['x-forwarded-host'] || event.headers?.host || '').toLowerCase();
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

async function handleEvent(event) {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  let route = event.path || '';
  route = route.replace(/^\/\.netlify\/functions\/api-v2/, '');
  route = route.replace(/^\/api\/v2/, '');
  route = route || '/';

  try {
    if (method !== 'GET' && method !== 'HEAD' && !isSameOriginRequest(event)) {
      return json(403, { error: 'Permintaan lintas origin ditolak.' });
    }

    if (method === 'GET' && route === '/health') {
      if (!pool) return json(503, { ok: false, database: 'not-configured', required: 'DATABASE_URL' });
      await ensureSchema();
      await pool.query('SELECT 1');
      return json(200, { ok: true, database: 'postgresql', storage: 'netlify-blobs', electionVersion: 2 });
    }

    if (method === 'GET' && route === '/election') {
      const config = await getV2Config();
      const control = pool ? await getControl() : { status: 'scheduled', config_version: Number(config.configVersion || 1) };
      return json(200, { ...config, status: control.status, configVersion: Math.max(Number(config.configVersion || 1), Number(control.config_version || 1)), setupRequired: !pool });
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
      if (!pool) return json(200, { loggedIn: true, setupRequired: true, user: { name: user.name, username: user.username, hasVoted: null } });
      await ensureSchema();
      const result = await pool.query(
        'SELECT voted_at FROM evoting_v2_participation WHERE election_id=$1 AND voter_id=$2',
        [ELECTION_ID, user.id]
      );
      return json(200, {
        loggedIn: true,
        user: {
          name: user.name,
          username: user.username,
          hasVoted: result.rows.length > 0,
          votedAt: result.rows[0]?.voted_at || null
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
      if (!pool) return json(503, { error: 'Database pemilihan belum terhubung. Suara belum dikirim.' });
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
      const validChair = config.candidates.ketua.some(candidate => candidate.id === chairCandidateId);
      const validVice = config.candidates.wakil.some(candidate => candidate.id === viceCandidateId);
      if (!validChair || !validVice) return json(400, { error: 'Pilih tepat satu calon Ketua dan satu calon Wakil.' });

      await ensureSchema();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const control = await client.query(
          'SELECT status,config_version FROM evoting_v2_election_control WHERE election_id=$1 FOR SHARE',
          [ELECTION_ID]
        );
        if (control.rows[0]?.status !== 'open') {
          await client.query('ROLLBACK');
          return json(403, { error: 'Pemungutan suara sedang tidak dibuka.' });
        }
        if (Number(control.rows[0]?.config_version) !== submittedConfigVersion || Number(config.configVersion || 1) !== submittedConfigVersion) {
          await client.query('ROLLBACK');
          return json(409, { error: 'Data calon telah diperbarui. Muat ulang halaman sebelum mengirim suara.' });
        }

        const previousRequest = await client.query(
          'SELECT 1 FROM evoting_v2_ballots WHERE election_id=$1 AND idempotency_key=$2',
          [ELECTION_ID, idempotencyKey]
        );
        if (previousRequest.rows.length) {
          await client.query('ROLLBACK');
          return json(409, { error: 'Permintaan dengan kunci ini sudah diproses. Periksa status hak pilih Anda.' });
        }

        await client.query(
          'INSERT INTO evoting_v2_eligibility (election_id,voter_id,active) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [ELECTION_ID, user.id, user.active !== false]
        );
        const eligibility = await client.query(
          'SELECT active FROM evoting_v2_eligibility WHERE election_id=$1 AND voter_id=$2 FOR UPDATE',
          [ELECTION_ID, user.id]
        );
        if (!eligibility.rows[0] || !eligibility.rows[0].active) {
          await client.query('ROLLBACK');
          return json(403, { error: 'Hak pilih akun ini telah dinonaktifkan panitia.' });
        }

        const participation = await client.query(
          'INSERT INTO evoting_v2_participation (election_id,voter_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING voter_id',
          [ELECTION_ID, user.id]
        );
        if (!participation.rows.length) {
          await client.query('ROLLBACK');
          return json(409, { error: 'Akun ini sudah menggunakan hak pilih.' });
        }

        await client.query(
          'INSERT INTO evoting_v2_ballots (ballot_id,election_id,idempotency_key,chair_candidate_id,vice_candidate_id) VALUES ($1,$2,$3,$4,$5)',
          [crypto.randomUUID(), ELECTION_ID, idempotencyKey, chairCandidateId, viceCandidateId]
        );
        await client.query('COMMIT');
        return json(200, { ok: true, message: 'Pilihan Ketua dan Wakil berhasil direkam.' });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') return json(409, { error: 'Akun ini sudah menggunakan hak pilih.' });
        throw error;
      } finally {
        client.release();
      }
    }

    if (method === 'POST' && route === '/admin/login') {
      const body = parseBody(event);
      const admin = await ensureAdmin();
      if (!admin || String(body.username || '') !== admin.username || !(await verifyPassword(body.password, admin.passwordHash))) {
        return json(401, { error: 'Username atau password admin salah.' });
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
      const current = await getV2Config();
      const currentControl = pool ? await getControl() : { status: 'scheduled', config_version: Number(current.configVersion || 1) };
      const currentStatus = currentControl.status;
      const currentVersion = Math.max(Number(currentControl.config_version || 1), Number(current.configVersion || 1));
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
      if (currentStatus === 'open' && candidatesChanged) {
        return json(409, { error: 'Data calon tidak dapat diubah ketika pemungutan suara sedang dibuka. Tutup pemilihan terlebih dahulu.' });
      }
      if (nextStatus === 'open') {
        if (!pool) return json(503, { error: 'DATABASE_URL belum dikonfigurasi. Pemilihan tidak dapat dibuka.' });
        if (!isCompleteCandidates(candidates)) {
          return json(400, { error: 'Lengkapi nama dan unggah foto untuk dua calon Ketua serta dua calon Wakil sebelum membuka pemilihan.' });
        }
        if (process.env.CONTEXT === 'production') {
          const legacyBackup = await getLatestLegacyArchiveManifest();
          if (!legacyBackup) {
            return json(409, { error: 'Sebelum membuka pemilihan V2 di production, buat dan verifikasi backup data trial V1 pada menu Keamanan & Arsip.' });
          }
        }
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

      if (pool) await setControlStatus(nextStatus === 'open' ? currentStatus : nextStatus, pool, nextVersion);
      await stores.config().setJSON('v2/main', next);
      if (pool && nextStatus === 'open') await setControlStatus('open', pool, nextVersion);
      if (pool) await writeAudit('election.config.updated', null, { status: nextStatus, candidatesChanged });
      return json(200, { ok: true, config: next, databaseConfigured: Boolean(pool) });
    }

    if (method === 'POST' && route === '/admin/users/add') {
      if (pool && await getControlStatus() === 'open') return json(409, { error: 'Akun baru tidak dapat ditambahkan ketika pemilihan sedang berlangsung.' });
      const result = await addUser(parseBody(event));
      if (!result.ok) return json(result.duplicate ? 409 : 400, { error: result.error });
      if (pool) await writeAudit('voter.created', result.id, {});
      return json(200, { ok: true, id: result.id });
    }

    if (method === 'POST' && route === '/admin/users/bulk') {
      if (pool && await getControlStatus() === 'open') return json(409, { error: 'Impor akun baru tidak dapat dilakukan ketika pemilihan sedang berlangsung.' });
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
      if (pool) await writeAudit('voter.bulk_import', null, { added, skipped: skipped.length });
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
      if (pool) await writeAudit('voter.updated', id, { nameChanged: name !== user.name, passwordChanged: Boolean(password) });
      return json(200, { ok: true });
    }

    if (method === 'POST' && (route === '/admin/users/deactivate' || route === '/admin/users/delete')) {
      const body = parseBody(event);
      const id = String(body.id || '');
      const user = await getUserById(id);
      if (!user) return json(404, { error: 'Pemilih tidak ditemukan.' });
      if (!pool) return json(503, { error: 'Database pemilihan belum terhubung; status hak pilih tidak dapat diverifikasi.' });
      await ensureSchema();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO evoting_v2_eligibility (election_id,voter_id,active) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [ELECTION_ID, id, user.active !== false]
        );
        await client.query(
          'SELECT active FROM evoting_v2_eligibility WHERE election_id=$1 AND voter_id=$2 FOR UPDATE',
          [ELECTION_ID, id]
        );
        const participation = await client.query(
          'SELECT voter_id FROM evoting_v2_participation WHERE election_id=$1 AND voter_id=$2',
          [ELECTION_ID, id]
        );
        if (participation.rows.length) {
          await client.query('ROLLBACK');
          return json(409, { error: 'Akun yang sudah memilih tidak dapat dinonaktifkan.' });
        }
        await client.query(
          'UPDATE evoting_v2_eligibility SET active=FALSE,updated_at=NOW() WHERE election_id=$1 AND voter_id=$2',
          [ELECTION_ID, id]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      await stores.users().setJSON('user/' + id, { ...user, active: false, deactivatedAt: new Date().toISOString() });
      await writeAudit('voter.deactivated', id, { username: user.username });
      return json(200, { ok: true, message: 'Akun dinonaktifkan; data akun tetap disimpan.' });
    }

    if (method === 'POST' && route === '/admin/users/activate') {
      if (pool && await getControlStatus() === 'open') return json(409, { error: 'Akun tidak dapat diaktifkan kembali ketika pemilihan sedang berlangsung.' });
      const body = parseBody(event);
      const id = String(body.id || '');
      const user = await getUserById(id);
      if (!user) return json(404, { error: 'Pemilih tidak ditemukan.' });
      if (!pool) return json(503, { error: 'Database pemilihan belum terhubung.' });
      await ensureSchema();
      await pool.query(
        'INSERT INTO evoting_v2_eligibility (election_id,voter_id,active) VALUES ($1,$2,TRUE) ' +
        'ON CONFLICT (election_id,voter_id) DO UPDATE SET active=TRUE,updated_at=NOW()',
        [ELECTION_ID, id]
      );
      await stores.users().setJSON('user/' + id, { ...user, active: true, reactivatedAt: new Date().toISOString() });
      await writeAudit('voter.activated', id, { username: user.username });
      return json(200, { ok: true });
    }

    if (method === 'GET' && route === '/admin/legacy-archive/status') {
      const manifest = await getLatestLegacyArchiveManifest();
      return json(200, {
        available: Boolean(manifest),
        manifest: manifest ? {
          backupId: manifest.backupId,
          createdAt: manifest.createdAt,
          voterLockRecordsCopied: manifest.voterLockRecordsCopied,
          ballotRecordsCopied: manifest.ballotRecordsCopied,
          legacyUserRecordsRetained: manifest.legacyUserRecordsRetained,
          snapshotVerified: manifest.snapshotVerified,
          archiveReadbackVerified: manifest.archiveReadbackVerified
        } : null
      });
    }

    if (method === 'POST' && route === '/admin/legacy-archive') {
      if (process.env.CONTEXT !== 'production') return json(409, { error: 'Arsip data produksi hanya dapat dijalankan pada deploy production setelah pemeriksaan admin.' });
      let manifest;
      try {
        manifest = await archiveLegacyData();
      } catch (error) {
        if (String(error.code || '').startsWith('LEGACY_')) {
          return json(409, { error: error.message });
        }
        throw error;
      }
      if (pool) await writeAudit('legacy_trial.archived', manifest.backupId, {
        voterLockRecordsCopied: manifest.voterLockRecordsCopied,
        ballotRecordsCopied: manifest.ballotRecordsCopied,
        archiveReadbackVerified: manifest.archiveReadbackVerified
      });
      return json(200, { ok: true, manifest });
    }

    if (method === 'POST' && route === '/admin/reset-practice') {
      if (!pool) return json(503, { error: 'Database pemilihan belum terhubung.' });
      await ensureSchema();
      const client = await pool.connect();
      const archiveId = crypto.randomUUID();
      try {
        await client.query('BEGIN');
        const control = await client.query(
          'SELECT status FROM evoting_v2_election_control WHERE election_id=$1 FOR UPDATE',
          [ELECTION_ID]
        );
        if (control.rows[0]?.status === 'open') {
          await client.query('ROLLBACK');
          return json(409, { error: 'Tutup pemilihan terlebih dahulu sebelum reset.' });
        }
        await client.query(
          'INSERT INTO evoting_v2_ballot_archive (archive_id,election_id,ballot_id,chair_candidate_id,vice_candidate_id) ' +
          'SELECT $1,election_id,ballot_id,chair_candidate_id,vice_candidate_id FROM evoting_v2_ballots WHERE election_id=$2',
          [archiveId, ELECTION_ID]
        );
        await client.query(
          'INSERT INTO evoting_v2_participation_archive (archive_id,election_id,voter_id,voted_at) ' +
          'SELECT $1,election_id,voter_id,voted_at FROM evoting_v2_participation WHERE election_id=$2',
          [archiveId, ELECTION_ID]
        );
        await client.query('DELETE FROM evoting_v2_ballots WHERE election_id=$1', [ELECTION_ID]);
        await client.query('DELETE FROM evoting_v2_participation WHERE election_id=$1', [ELECTION_ID]);
        await client.query(
          'UPDATE evoting_v2_election_control SET status=$1,updated_at=NOW() WHERE election_id=$2',
          ['scheduled', ELECTION_ID]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      const config = await getV2Config();
      await stores.config().setJSON('v2/main', { ...config, status: 'scheduled' });
      await writeAudit('election.reset_archived', archiveId, {});
      return json(200, { ok: true, archiveId, message: 'Data pemilihan v2 diarsipkan dan direset. Akun pemilih tetap tersimpan.' });
    }

    if (method === 'GET' && route === '/admin/audit') {
      if (!pool) return json(503, { error: 'Database pemilihan belum terhubung.' });
      await ensureSchema();
      const result = await pool.query(
        'SELECT id,actor,action,target_id,details,created_at FROM evoting_v2_admin_audit WHERE election_id=$1 ORDER BY id DESC LIMIT 150',
        [ELECTION_ID]
      );
      return json(200, { entries: result.rows });
    }

    if (method === 'POST' && route === '/admin/password') {
      const body = parseBody(event);
      const admin = await ensureAdmin();
      const oldPassword = String(body.oldPassword || '');
      const newPassword = String(body.newPassword || '');
      if (!(await verifyPassword(oldPassword, admin.passwordHash))) return json(403, { error: 'Password admin lama salah.' });
      if (newPassword.length < 8) return json(400, { error: 'Password admin baru minimal 8 karakter.' });
      const bootstrap = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.admin_dpt || process.env.ADMIN_DPT || '');
      const next = {
        ...admin,
        passwordHash: await hashPassword(newPassword),
        bootstrapFingerprint: bootstrap.length >= 8 ? crypto.createHash('sha256').update(bootstrap).digest('hex') : admin.bootstrapFingerprint,
        updatedAt: new Date().toISOString()
      };
      await stores.admins().setJSON('main', next);
      if (pool) await writeAudit('admin.password_changed', 'admin', {});
      await destroySession(event);
      return json(200, { ok: true }, { 'set-cookie': sessionCookie(event, '', 0) });
    }

    return json(404, { error: 'Endpoint tidak ditemukan.' });
  } catch (error) {
    console.error('E-Voting v2 API error:', error);
    return json(500, { error: 'Terjadi kesalahan server. Silakan coba kembali atau hubungi administrator.' });
  }
}

export const handler = async event => handleEvent(event);
