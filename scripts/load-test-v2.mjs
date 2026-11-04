import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const baseUrl = String(process.env.BASE_URL || '').replace(/\/$/, '');
const adminUsername = process.env.ADMIN_USERNAME || 'admin_dpt';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const count = Math.max(1, Math.min(200, Number(process.env.VU_COUNT || 100)));
const prefix = process.env.LOAD_TEST_PREFIX || ('lt' + Date.now().toString(36).slice(-6));

if (!baseUrl || !adminPassword) {
  throw new Error('Set BASE_URL and ADMIN_PASSWORD before running this test.');
}
const targetHost = new URL(baseUrl).hostname;
if (targetHost === 'evotedpt.netlify.app' && process.env.ALLOW_PRODUCTION_LOAD_TEST !== 'true') {
  throw new Error('Refusing to run load test on production. Use a Netlify deploy preview.');
}

async function request(path, options = {}) {
  return fetch(baseUrl + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
}

const healthResponse = await request('/api/v2/health');
const health = await healthResponse.json().catch(() => ({}));
if (!healthResponse.ok || health.storage !== 'netlify-blobs') {
  throw new Error('V2 storage health check failed: ' + JSON.stringify(health));
}

const adminLogin = await request('/api/v2/admin/login', {
  method: 'POST',
  body: JSON.stringify({ username: adminUsername, password: adminPassword })
});
if (!adminLogin.ok) throw new Error('Admin login failed: HTTP ' + adminLogin.status);
const adminCookie = (adminLogin.headers.get('set-cookie') || '').split(';')[0];
if (!adminCookie) throw new Error('Admin session cookie was not returned.');

const rows = Array.from({ length: count }, (_, index) => ({
  name: 'Load Test Voter ' + String(index + 1).padStart(3, '0'),
  username: prefix + String(index + 1).padStart(3, '0'),
  password: crypto.randomBytes(6).toString('hex')
}));

const importResponse = await request('/api/v2/admin/users/bulk', {
  method: 'POST',
  headers: { cookie: adminCookie },
  body: JSON.stringify({ rows })
});
const importResult = await importResponse.json();
if (!importResponse.ok || importResult.added !== count) {
  throw new Error('Could not create all load-test accounts: ' + JSON.stringify(importResult));
}

const electionResponse = await request('/api/v2/election');
const electionConfig = await electionResponse.json();
if (!electionResponse.ok || electionConfig.status !== 'open') throw new Error('Staging election must be open before load testing.');

const loginStarted = performance.now();
const sessions = await Promise.all(rows.map(async row => {
  const response = await request('/api/v2/login', {
    method: 'POST',
    body: JSON.stringify({ username: row.username, password: row.password })
  });
  const cookie = (response.headers.get('set-cookie') || '').split(';')[0];
  if (!response.ok || !cookie) throw new Error('Voter login failed for ' + row.username + ': HTTP ' + response.status);
  return { row, cookie };
}));
const loginMs = Math.round(performance.now() - loginStarted);

const voteStarted = performance.now();
const submissions = await Promise.allSettled(sessions.map(async (session, index) => {
  const response = await request('/api/v2/vote', {
    method: 'POST',
    headers: { cookie: session.cookie },
    body: JSON.stringify({
      chairCandidateId: index % 2 ? 'K01' : 'K02',
      viceCandidateId: index % 2 ? 'W02' : 'W01',
      idempotencyKey: crypto.randomUUID(),
      configVersion: Number(electionConfig.configVersion || 1)
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(session.row.username + ': HTTP ' + response.status + ' ' + (body.error || ''));
  return body;
}));
const voteMs = Math.round(performance.now() - voteStarted);
const succeeded = submissions.filter(result => result.status === 'fulfilled').length;
const failed = submissions.length - succeeded;

const duplicateResponse = await request('/api/v2/vote', {
  method: 'POST',
  headers: { cookie: sessions[0].cookie },
  body: JSON.stringify({
    chairCandidateId: 'K01',
    viceCandidateId: 'W01',
    idempotencyKey: crypto.randomUUID(),
    configVersion: Number(electionConfig.configVersion || 1)
  })
});
const duplicateGuardPassed = duplicateResponse.status === 409;

const statsResponse = await request('/api/v2/admin/stats', { headers: { cookie: adminCookie } });
const stats = await statsResponse.json().catch(() => ({}));
const testedUsers = Array.isArray(stats.users) ? stats.users.filter(user => String(user.username || '').startsWith(prefix)) : [];
const completedTestUsers = testedUsers.filter(user => user.hasVoted === true).length;
const pendingTestUsers = testedUsers.filter(user => user.votePending === true).length;
const participationReconciled = testedUsers.length === count && completedTestUsers === count && pendingTestUsers === 0;

const report = {
  target: baseUrl,
  storage: health.storage,
  virtualUsers: count,
  accountsCreated: importResult.added,
  successfulLogins: sessions.length,
  loginBatchMs: loginMs,
  successfulBallots: succeeded,
  failedBallots: failed,
  voteBatchMs: voteMs,
  duplicateVoteBlocked: duplicateGuardPassed,
  participationReconciled,
  completedTestUsers,
  pendingTestUsers,
  failedDetails: submissions.filter(result => result.status === 'rejected').map(result => String(result.reason)).slice(0, 20)
};
console.log(JSON.stringify(report, null, 2));
if (failed || !duplicateGuardPassed || !participationReconciled) process.exitCode = 1;
