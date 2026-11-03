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
if (baseUrl.includes('evotedpt.netlify.app') && process.env.ALLOW_PRODUCTION_LOAD_TEST !== 'true') {
  throw new Error('Refusing to run load test on production. Use a Netlify deploy preview with a separate staging database.');
}

async function request(path, options = {}) {
  return fetch(baseUrl + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
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
    idempotencyKey: crypto.randomUUID()
  })
});
const duplicateGuardPassed = duplicateResponse.status === 409;

const report = {
  target: baseUrl,
  virtualUsers: count,
  accountsCreated: importResult.added,
  successfulLogins: sessions.length,
  loginBatchMs: loginMs,
  successfulBallots: succeeded,
  failedBallots: failed,
  voteBatchMs: voteMs,
  duplicateVoteBlocked: duplicateGuardPassed,
  failedDetails: submissions.filter(result => result.status === 'rejected').map(result => String(result.reason)).slice(0, 20)
};
console.log(JSON.stringify(report, null, 2));
if (failed || !duplicateGuardPassed) process.exitCode = 1;
