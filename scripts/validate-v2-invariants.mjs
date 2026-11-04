import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [api, voterPage, voterApp, adminApp, loadTest] = await Promise.all([
  read('netlify/functions/api-v2.mjs'),
  read('public/v2.html'),
  read('public/v2.js'),
  read('public/admin-v2.js'),
  read('scripts/load-test-v2.mjs')
]);

function tableDefinition(source, tableName) {
  const marker = "'CREATE TABLE IF NOT EXISTS " + tableName + " ('";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'Missing table definition: ' + tableName);
  const end = source.indexOf(");\\n' +", start);
  assert.notEqual(end, -1, 'Could not locate end of table definition: ' + tableName);
  return source.slice(start, end + 2);
}

const participation = tableDefinition(api, 'evoting_v2_participation');
const ballots = tableDefinition(api, 'evoting_v2_ballots');
assert.match(participation, /voter_id/);
assert.match(participation, /voted_at/);
assert.doesNotMatch(participation, /chair_candidate_id|vice_candidate_id|ballot_id/);
assert.match(ballots, /chair_candidate_id/);
assert.match(ballots, /vice_candidate_id/);
assert.doesNotMatch(ballots, /voter_id|username|voted_at|foreign key/i);

const voteStart = api.indexOf("if (method === 'POST' && route === '/vote')");
const voteEnd = api.indexOf("if (method === 'POST' && route === '/admin/login')", voteStart);
assert.ok(voteStart >= 0 && voteEnd > voteStart, 'Vote route must exist');
const voteRoute = api.slice(voteStart, voteEnd);
for (const token of ["'BEGIN'", "FOR SHARE", "FOR UPDATE", "INSERT INTO evoting_v2_participation", "INSERT INTO evoting_v2_ballots", "'COMMIT'"]) {
  assert.ok(voteRoute.includes(token), 'Vote transaction missing: ' + token);
}
assert.ok(voteRoute.indexOf('INSERT INTO evoting_v2_participation') < voteRoute.indexOf('INSERT INTO evoting_v2_ballots'));
assert.match(api, /PRIMARY KEY \(election_id, voter_id\)/);
assert.match(api, /reconciliationOk/);
assert.match(api, /archiveReadbackVerified/);
assert.match(api, /verifyLegacyArchiveStillCurrent/);
assert.match(api, /resultsVisible = electionStatus !== 'open'/);
assert.doesNotMatch(api, /route === '\/admin\/users\/choices'/);

assert.match(voterPage, /Pemimpin Parlemen/);
assert.match(voterPage, /DPT Periode 2026–2027/);
assert.match(voterPage, /submissionOverlay/);
assert.match(voterApp, /chairCandidateId: selectedChair/);
assert.match(voterApp, /viceCandidateId: selectedVice/);
assert.match(voterApp, /if \(!selectedChair \|\| !selectedVice\)/);
assert.match(adminApp, /reconciliationOk/);
assert.match(adminApp, /legacy-archive\/status/);
assert.doesNotMatch(adminApp, /pilihan per pemilih|pilihan setiap akun/i);

assert.match(loadTest, /deploy-preview-\d+--/);
assert.match(loadTest, /concurrentDuplicateGuardPassed/);
assert.match(loadTest, /sameRequestRetryPassed/);
assert.match(loadTest, /reconciliationPassed/);

console.log('V2 invariant checks passed: ballot privacy, one-transaction vote, mandatory two-role selection, backup freshness, and load-test safeguards.');
