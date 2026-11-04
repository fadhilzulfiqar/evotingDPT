// API-level concurrency test for an isolated Netlify deploy preview.
// Usage:
// V2_BASE_URL=https://deploy-preview-123--SITE.netlify.app V2_ADMIN_PASSWORD=... node scripts/load-test-v2.mjs
// This script refuses the known production host. It creates 100 temporary test accounts.
import crypto from 'node:crypto';
const base = String(process.env.V2_BASE_URL || '').replace(/\/$/, '');
const adminPassword = String(process.env.V2_ADMIN_PASSWORD || '');
const count = Number(process.env.V2_TEST_USERS || 100);
if (!base || !adminPassword) throw new Error('Set V2_BASE_URL and V2_ADMIN_PASSWORD.');
const host = new URL(base).hostname;
if (host === 'evotedpt.netlify.app' || host === 'newevotingdpt.netlify.app' || !host.includes('deploy-preview-')) {
  throw new Error('Safety stop: load tests are permitted only on a Netlify deploy-preview hostname.');
}
if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('V2_TEST_USERS must be between 1 and 100.');
async function request(path, options = {}) {
  const response = await fetch(base + '/api-v2' + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
const admin = await request('/admin/login', { method: 'POST', body: JSON.stringify({ username: 'admin_dpt', password: adminPassword }) });
if (!admin.response.ok) throw new Error('Admin login failed: ' + (admin.body.error || admin.response.status));
const adminCookie = admin.response.headers.get('set-cookie')?.split(';')[0];
if (!adminCookie) throw new Error('Could not read admin session cookie.');
const election = await request('/election');
if (!election.response.ok || election.body.status !== 'open') throw new Error('Configure four candidates and open the preview election before load testing.');
const stamp = Date.now().toString(36);
const rows = Array.from({ length: count }, (_, i) => ({
  name: 'LOAD TEST ' + stamp + ' ' + String(i + 1).padStart(3, '0'),
  username: 'lt' + stamp + String(i + 1).padStart(3, '0'),
  password: crypto.randomBytes(6).toString('hex')
}));
const imported = await request('/admin/users/bulk', { method: 'POST', headers: { cookie: adminCookie }, body: JSON.stringify({ rows }) });
if (!imported.response.ok || imported.body.added !== count) throw new Error('Could not create all test accounts: ' + JSON.stringify(imported.body));
const loginStart = performance.now();
const logins = await Promise.all(rows.map(async row => {
  const r = await request('/login', { method: 'POST', body: JSON.stringify({ username: row.username, password: row.password }) });
  return { ok: r.response.ok, cookie: r.response.headers.get('set-cookie')?.split(';')[0], error: r.body.error };
}));
const loginMs = performance.now() - loginStart;
if (logins.some(x => !x.ok || !x.cookie)) throw new Error('At least one concurrent login failed: ' + JSON.stringify(logins.filter(x => !x.ok).slice(0, 5)));
const voteStart = performance.now();
const votes = await Promise.all(logins.map((x, i) => request('/vote', {
  method: 'POST',
  headers: { cookie: x.cookie },
  body: JSON.stringify({
    chairCandidateId: i % 2 ? 'K01' : 'K02',
    viceCandidateId: i % 2 ? 'W02' : 'W01'
  })
})));
const voteMs = performance.now() - voteStart;
const failed = votes.map((x, i) => ({ index: i, status: x.response.status, error: x.body.error })).filter(x => x.status !== 200);
const stats = await request('/admin/stats', { headers: { cookie: adminCookie } });
const expected = count;
const valid = votes.filter(x => x.response.status === 200).length;
const summary = {
  target: count,
  concurrentLogins: logins.length,
  loginFailures: logins.filter(x => !x.ok).length,
  loginElapsedMs: Math.round(loginMs),
  concurrentBallotSubmissions: votes.length,
  acceptedBallots: valid,
  failedBallots: failed,
  voteElapsedMs: Math.round(voteMs),
  adminStats: stats.body.ok === false ? null : {
    totalVoters: stats.body.total,
    voted: stats.body.voted,
    ballotTotal: stats.body.ballotTotal,
    chairCountTotal: Object.values(stats.body.chairCounts || {}).reduce((a, b) => a + Number(b || 0), 0),
    viceCountTotal: Object.values(stats.body.viceCounts || {}).reduce((a, b) => a + Number(b || 0), 0)
  }
};
console.log(JSON.stringify(summary, null, 2));
if (valid !== expected || !stats.response.ok || stats.body.ballotTotal < expected) process.exitCode = 1;
