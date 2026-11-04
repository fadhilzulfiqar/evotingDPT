import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const baseUrl = String(process.env.BASE_URL || '').replace(/\/$/, '');
const adminUsername = process.env.ADMIN_USERNAME || 'admin_dpt';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const count = Math.max(2, Math.min(100, Number(process.env.VU_COUNT || 100)));
const prefix = process.env.LOAD_TEST_PREFIX || ('lt' + Date.now().toString(36).slice(-6));

if (!baseUrl || !adminPassword) {
  throw new Error('Set BASE_URL and ADMIN_PASSWORD before running this test.');
}
if (!/deploy-preview-\d+--/i.test(new URL(baseUrl).hostname) && process.env.ALLOW_NON_PREVIEW_STAGING !== 'true') {
  throw new Error('Safety stop: run this test only against a Netlify Deploy Preview with a separate staging database. For a verified non-production staging host, set ALLOW_NON_PREVIEW_STAGING=true.');
}

async function request(path, options = {}) {
  return fetch(baseUrl + path, {
    cache: 'no-store',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
}

function cookieFrom(response) {
  const all = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  return String(all[0] || '').split(';')[0];
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

function latencyPercentiles(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const at = p => sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]) : null;
  return { p50: at(0.50), p95: at(0.95), p99: at(0.99) };
}

let adminCookie = '';
let electionConfig = null;
let electionClosed = false;

async function closeStagingElection() {
  if (!adminCookie || !electionConfig || electionConfig.status !== 'open' || electionClosed) return;
  const response = await request('/api/v2/admin/config', {
    method: 'POST',
    headers: { cookie: adminCookie },
    body: JSON.stringify({ ...electionConfig, status: 'closed' })
  });
  if (!response.ok) {
    const body = await readJson(response);
    throw new Error('Could not close staging election: HTTP ' + response.status + ' ' + (body.error || ''));
  }
  electionClosed = true;
}

try {
  const adminLogin = await request('/api/v2/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: adminUsername, password: adminPassword })
  });
  if (!adminLogin.ok) throw new Error('Admin login failed: HTTP ' + adminLogin.status);
  adminCookie = cookieFrom(adminLogin);
  if (!adminCookie) throw new Error('Admin session cookie was not returned.');

  const beforeResponse = await request('/api/v2/admin/stats', { headers: { cookie: adminCookie } });
  const beforeStats = await readJson(beforeResponse);
  if (!beforeResponse.ok || beforeStats.setupRequired) {
    throw new Error('PostgreSQL is not ready on this staging deployment.');
  }
  const baselineVoted = Number(beforeStats.voted || 0);
  if (beforeStats.reconciliationOk !== true || Number(beforeStats.totalBallots) !== baselineVoted) {
    throw new Error('Staging database is not reconciled. Archive/reset the V2 trial before load testing.');
  }

  const electionResponse = await request('/api/v2/election');
  electionConfig = await readJson(electionResponse);
  if (!electionResponse.ok || electionConfig.setupRequired || !['scheduled', 'closed'].includes(electionConfig.status)) {
    throw new Error('Close the staging election first. The test creates accounts before opening it.');
  }

  const rows = Array.from({ length: count }, (_, index) => ({
    name: index === count - 1 ? 'Load Test Race Voter' : 'Load Test Voter ' + String(index + 1).padStart(3, '0'),
    username: prefix + String(index + 1).padStart(3, '0'),
    password: crypto.randomBytes(8).toString('hex')
  }));

  const importResponse = await request('/api/v2/admin/users/bulk', {
    method: 'POST',
    headers: { cookie: adminCookie },
    body: JSON.stringify({ rows })
  });
  const importResult = await readJson(importResponse);
  if (!importResponse.ok || importResult.added !== rows.length) {
    throw new Error('Could not create all load-test accounts: ' + JSON.stringify(importResult));
  }

  const openResponse = await request('/api/v2/admin/config', {
    method: 'POST',
    headers: { cookie: adminCookie },
    body: JSON.stringify({ ...electionConfig, status: 'open' })
  });
  const openResult = await readJson(openResponse);
  if (!openResponse.ok || !openResult.config) {
    throw new Error('Could not open the staging election after account import: ' + (openResult.error || openResponse.status));
  }
  electionConfig = openResult.config;

  const loginStarted = performance.now();
  const sessions = await Promise.all(rows.map(async row => {
    const started = performance.now();
    const response = await request('/api/v2/login', {
      method: 'POST',
      body: JSON.stringify({ username: row.username, password: row.password })
    });
    const durationMs = Math.round(performance.now() - started);
    const cookie = cookieFrom(response);
    if (!response.ok || !cookie) throw new Error('Voter login failed for ' + row.username + ': HTTP ' + response.status);
    return { row, cookie, loginDurationMs: durationMs };
  }));
  const loginMs = Math.round(performance.now() - loginStarted);

  async function cast(session, chairCandidateId, viceCandidateId, idempotencyKey) {
    const started = performance.now();
    const response = await request('/api/v2/vote', {
      method: 'POST',
      headers: { cookie: session.cookie },
      body: JSON.stringify({
        chairCandidateId,
        viceCandidateId,
        idempotencyKey,
        configVersion: Number(electionConfig.configVersion || 1)
      })
    });
    const durationMs = Math.round(performance.now() - started);
    return { status: response.status, body: await readJson(response), durationMs };
  }

  const voteStarted = performance.now();
  const mainSessions = sessions.slice(0, count - 1);
  const mainBallots = mainSessions.map((session, index) => ({
    session,
    chair: index % 2 ? 'K01' : 'K02',
    vice: Math.floor(index / 2) % 2 ? 'W02' : 'W01',
    key: crypto.randomUUID()
  }));
  const raceSession = sessions[count - 1];
  const raceKeys = [crypto.randomUUID(), crypto.randomUUID()];
  const simultaneousResults = await Promise.all([
    ...mainBallots.map(ballot => cast(ballot.session, ballot.chair, ballot.vice, ballot.key)),
    cast(raceSession, 'K01', 'W01', raceKeys[0]),
    cast(raceSession, 'K02', 'W02', raceKeys[1])
  ]);
  const voteMs = Math.round(performance.now() - voteStarted);
  const submissions = simultaneousResults.slice(0, mainBallots.length);
  const raceStarted = simultaneousResults.slice(mainBallots.length);
  const successfulBallots = submissions.filter(result => result.status === 200).length;
  const failedBallots = submissions.filter(result => result.status !== 200);
  const raceSuccesses = raceStarted.filter(result => result.status === 200).length;
  const raceConflicts = raceStarted.filter(result => result.status === 409).length;
  const concurrentDuplicateGuardPassed = raceSuccesses === 1 && raceConflicts === 1;

  const retry = await cast(mainBallots[0].session, mainBallots[0].chair, mainBallots[0].vice, mainBallots[0].key);
  const retryMeResponse = await request('/api/v2/me', { headers: { cookie: mainBallots[0].session.cookie } });
  const retryMe = await readJson(retryMeResponse);
  const sameRequestRetryPassed = retry.status === 409 && retryMe.user?.hasVoted === true;

  const conflictingRetry = await cast(
    mainBallots[0].session,
    mainBallots[0].chair === 'K01' ? 'K02' : 'K01',
    mainBallots[0].vice,
    mainBallots[0].key
  );
  const conflictingRetryBlocked = conflictingRetry.status === 409;

  const secondVote = await cast(mainBallots[0].session, 'K01', 'W01', crypto.randomUUID());
  const secondVoteBlocked = secondVote.status === 409;

  await closeStagingElection();

  const afterResponse = await request('/api/v2/admin/stats', { headers: { cookie: adminCookie } });
  const afterStats = await readJson(afterResponse);
  if (!afterResponse.ok) throw new Error('Could not read post-test admin statistics.');
  const expectedNewBallots = count;
  const expectedTotal = baselineVoted + expectedNewBallots;
  const chairTotal = Object.values(afterStats.chairCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const viceTotal = Object.values(afterStats.viceCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const reconciled = afterStats.reconciliationOk === true
    && Number(afterStats.voted) === expectedTotal
    && Number(afterStats.totalBallots) === expectedTotal
    && chairTotal === expectedTotal
    && viceTotal === expectedTotal;

  const report = {
    target: baseUrl,
    virtualUsers: count,
    accountsCreated: importResult.added,
    successfulLogins: sessions.length,
    loginBatchMs: loginMs,
    loginLatencyMs: latencyPercentiles(sessions.map(session => session.loginDurationMs)),
    successfulConcurrentBallots: successfulBallots,
    acceptedBallotsIncludingDuplicateRace: successfulBallots + raceSuccesses,
    failedConcurrentBallots: failedBallots,
    voteBatchMs: voteMs,
    voteRequestCount: simultaneousResults.length,
    voteLatencyMs: latencyPercentiles(simultaneousResults.map(result => result.durationMs)),
    duplicateRace: { successes: raceSuccesses, conflicts: raceConflicts, passed: concurrentDuplicateGuardPassed },
    sameRequestRetryPassed,
    conflictingRetryBlocked,
    secondVoteBlocked,
    expectedNewBallots,
    baselineParticipation: baselineVoted,
    finalParticipation: afterStats.voted,
    finalTotalBallots: afterStats.totalBallots,
    chairTotal,
    viceTotal,
    reconciliationPassed: reconciled,
    stagingElectionClosed: electionClosed,
    failedDetails: failedBallots.map(result => result.body?.error || 'HTTP ' + result.status).slice(0, 20)
  };
  console.log(JSON.stringify(report, null, 2));

  if (successfulBallots !== count - 1 || !concurrentDuplicateGuardPassed || !sameRequestRetryPassed
      || !conflictingRetryBlocked || !secondVoteBlocked || !reconciled) {
    process.exitCode = 1;
  }
} finally {
  if (!electionClosed) {
    try { await closeStagingElection(); }
    catch (error) { console.error('WARNING: staging election could not be closed automatically:', error.message); }
  }
}
