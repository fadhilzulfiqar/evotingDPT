import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';

const BASE_URL = String(__ENV.BASE_URL || '').replace(/\/+$/, '');
const SOURCE_URL = String(__ENV.SOURCE_URL || 'https://evotingdpt.netlify.app').replace(/\/+$/, '');
const ADMIN_PASSWORD = String(__ENV.ADMIN_BOOTSTRAP_PASSWORD || '');
const VUS = Number(__ENV.VUS || 100);
const USER_PREFIX = String(__ENV.USER_PREFIX || 'loadtest');

if (!BASE_URL) fail('BASE_URL wajib diisi dengan URL Netlify staging.');
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) fail('ADMIN_BOOTSTRAP_PASSWORD wajib diisi (minimal 8 karakter).');
if (!Number.isInteger(VUS) || VUS < 1 || VUS > 100) fail('VUS harus berupa bilangan bulat 1–100.');

const targetHost = new URL(BASE_URL).host.toLowerCase();
const sourceHost = new URL(SOURCE_URL).host.toLowerCase();
if (targetHost === sourceHost || targetHost === 'evotingdpt.netlify.app') {
  fail('DIBATALKAN: pengujian menolak target produksi. Gunakan URL Netlify staging yang berbeda.');
}

const loginSuccess = new Rate('login_success');
const voteSuccess = new Rate('vote_success');
const voteLatency = new Trend('vote_latency_ms', true);
const voteAttempts = new Counter('vote_attempts');

export const options = {
  scenarios: {
    simultaneous_voting: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '3m',
      gracefulStop: '20s'
    }
  },
  thresholds: {
    login_success: ['rate==1'],
    vote_success: ['rate==1'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{stage:login}': ['p(95)<15000'],
    'http_req_duration{stage:vote}': ['p(95)<15000']
  }
};

function jsonParams(extraHeaders = {}, stage = 'setup') {
  return {
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    timeout: '120s',
    tags: { stage }
  };
}

function sidFrom(response) {
  const values = response.cookies && response.cookies.sid;
  return values && values.length ? values[0].value : null;
}

function adminPost(path, body, sid) {
  return http.post(
    BASE_URL + path,
    JSON.stringify(body),
    jsonParams({ Cookie: 'sid=' + sid }, 'admin')
  );
}

function adminLogin() {
  const response = http.post(
    BASE_URL + '/api/admin/login',
    JSON.stringify({ username: 'admin_dpt', password: ADMIN_PASSWORD }),
    jsonParams({}, 'admin-login')
  );
  const sid = sidFrom(response);
  if (response.status !== 200 || !sid) {
    fail('Login admin staging gagal (HTTP ' + response.status + '). Periksa ADMIN_BOOTSTRAP_PASSWORD di Netlify staging.');
  }
  return sid;
}

export function setup() {
  // Read-only access to production: only candidate/configuration data is copied.
  const sourceResponse = http.get(SOURCE_URL + '/api/election', {
    timeout: '60s',
    tags: { stage: 'source-read-only' }
  });
  if (sourceResponse.status !== 200) {
    fail('Gagal membaca konfigurasi publik sumber (HTTP ' + sourceResponse.status + ').');
  }

  let sourceConfig;
  try {
    sourceConfig = sourceResponse.json();
  } catch (_) {
    fail('Respons konfigurasi sumber bukan JSON yang valid.');
  }
  if (!sourceConfig || !Array.isArray(sourceConfig.candidates) || sourceConfig.candidates.length !== 2) {
    fail('Konfigurasi sumber harus memiliki tepat dua pasangan calon.');
  }

  const adminSid = adminLogin();

  // All state-changing requests below target BASE_URL (the staging site) only.
  const closedConfig = { ...sourceConfig, status: 'closed' };
  const closeResponse = adminPost('/api/admin/config', closedConfig, adminSid);
  if (closeResponse.status !== 200) fail('Gagal menutup pemilihan staging (HTTP ' + closeResponse.status + ').');

  const resetResponse = adminPost('/api/admin/reset-practice', {}, adminSid);
  if (resetResponse.status !== 200) fail('Gagal membersihkan suara lama di staging (HTTP ' + resetResponse.status + ').');

  const accounts = Array.from({ length: VUS }, (_, index) => {
    const number = String(index + 1).padStart(3, '0');
    return {
      index,
      name: 'LOAD TEST ' + number,
      username: USER_PREFIX + '-' + number,
      password: 'DptLoadTest!2026-' + number
    };
  });

  const bulkResponse = adminPost('/api/admin/users/bulk', { rows: accounts }, adminSid);
  if (bulkResponse.status !== 200) {
    fail('Gagal membuat akun dummy di staging (HTTP ' + bulkResponse.status + ').');
  }

  let bulkResult;
  try {
    bulkResult = bulkResponse.json();
  } catch (_) {
    fail('Respons pembuatan akun dummy bukan JSON yang valid.');
  }
  const skippedForNonDuplicate = (bulkResult.skipped || []).filter(item =>
    !String(item.reason || '').toLowerCase().includes('sudah digunakan')
  );
  if (!bulkResult.ok || skippedForNonDuplicate.length > 0) {
    fail('Pembuatan akun staging tidak lengkap. Ditambahkan: ' + (bulkResult.added || 0) + '; dilewati: ' + (bulkResult.skipped || []).length + '.');
  }

  const openConfig = { ...sourceConfig, status: 'open' };
  const openResponse = adminPost('/api/admin/config', openConfig, adminSid);
  if (openResponse.status !== 200) fail('Gagal membuka pemilihan staging (HTTP ' + openResponse.status + ').');

  console.log('STAGING READY: ' + VUS + ' akun dummy tersedia. Target voting: ' + BASE_URL);
  console.log('PRODUCTION SAFETY: sumber hanya dibaca melalui GET /api/election; tidak ada login, admin write, atau vote ke produksi.');

  return {
    accounts,
    candidateIds: sourceConfig.candidates.map(candidate => String(candidate.id)),
    expectedVotes: VUS
  };
}

export default function (data) {
  const account = data.accounts[__VU - 1];
  if (!account) {
    loginSuccess.add(false);
    voteSuccess.add(false);
    return;
  }

  const loginResponse = http.post(
    BASE_URL + '/api/login',
    JSON.stringify({ username: account.username, password: account.password }),
    jsonParams({}, 'login')
  );

  const voterSid = sidFrom(loginResponse);
  const loggedIn = loginResponse.status === 200 && Boolean(voterSid);
  loginSuccess.add(loggedIn);
  check(loginResponse, {
    'voter login returns HTTP 200': response => response.status === 200,
    'voter login issues a session cookie': () => Boolean(voterSid)
  });

  if (!loggedIn) {
    voteSuccess.add(false);
    return;
  }

  const candidateId = account.index % 2 === 0 ? data.candidateIds[0] : data.candidateIds[1];
  voteAttempts.add(1);

  const start = Date.now();
  const voteResponse = http.post(
    BASE_URL + '/api/vote',
    JSON.stringify({ candidateId }),
    jsonParams({ Cookie: 'sid=' + voterSid }, 'vote')
  );
  voteLatency.add(Date.now() - start);

  let voteBody = {};
  try {
    voteBody = voteResponse.json();
  } catch (_) {
    voteBody = {};
  }

  const voted = voteResponse.status === 200 && voteBody.ok === true;
  voteSuccess.add(voted);
  check(voteResponse, {
    'vote returns HTTP 200': response => response.status === 200,
    'vote is acknowledged by backend': () => voteBody.ok === true
  });
}

export function teardown() {
  const adminSid = adminLogin();

  // Close staging before reading the final tally and clearing the test ballots.
  const sourceResponse = http.get(SOURCE_URL + '/api/election', {
    timeout: '60s',
    tags: { stage: 'source-read-only' }
  });
  if (sourceResponse.status !== 200) fail('Tidak dapat membaca konfigurasi sumber untuk menutup staging.');
  const sourceConfig = sourceResponse.json();

  const closeResponse = adminPost('/api/admin/config', { ...sourceConfig, status: 'closed' }, adminSid);
  if (closeResponse.status !== 200) fail('Gagal menutup pemilihan staging setelah tes (HTTP ' + closeResponse.status + ').');

  const statsResponse = http.get(BASE_URL + '/api/admin/stats', {
    headers: { Cookie: 'sid=' + adminSid },
    timeout: '120s',
    tags: { stage: 'reconciliation' }
  });
  if (statsResponse.status !== 200) fail('Gagal membaca rekap staging (HTTP ' + statsResponse.status + ').');

  const stats = statsResponse.json();
  const testUsers = (stats.users || []).filter(user => String(user.username || '').startsWith(USER_PREFIX + '-'));
  const votedTestUsers = testUsers.filter(user => user.hasVoted).length;
  const ballotCount = Object.values(stats.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const reconciliationPassed =
    testUsers.length === VUS &&
    votedTestUsers === VUS &&
    ballotCount === VUS;

  console.log(JSON.stringify({
    result: reconciliationPassed ? 'PASS' : 'FAIL',
    expectedTestAccounts: VUS,
    foundTestAccounts: testUsers.length,
    testAccountsMarkedVoted: votedTestUsers,
    anonymousBallotsInTally: ballotCount,
    candidateCounts: stats.counts || {}
  }));

  // Leave staging closed and clear only staging votes/locks after the report.
  const resetResponse = adminPost('/api/admin/reset-practice', {}, adminSid);
  if (resetResponse.status !== 200) {
    console.error('PERINGATAN: gagal membersihkan suara staging setelah tes (HTTP ' + resetResponse.status + ').');
  }

  if (!reconciliationPassed) {
    fail('Rekonsiliasi gagal: jumlah akun uji, status pemilih, dan jumlah surat suara tidak sama.');
  }
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
    'load-test-summary.json': JSON.stringify(data, null, 2)
  };
}
