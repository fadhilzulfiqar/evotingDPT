# E-Voting DPT v2 — Migration and Verification Plan

## Decision record

- Existing election data is classified by the owner as trial data.
- The owner explicitly requested **preserve**: do not delete, reset, overwrite, or migrate the current v1 blobs in place.
- Target production domain is `evotedpt.netlify.app`. Its latest identified deployment came from `netlify-redesign` at commit `425e8a9`; the site is currently deployed through Netlify Drop. V2 source work is based on `netlify-redesign` and remains isolated until the target Netlify project is connected to GitHub.
- No production deployment or merge to `main` is authorized by this preparation step.
- The current v1 application uses Netlify Functions and Netlify Blobs. Existing stores include `evoting-config`, `evoting-users`, `evoting-votes`, `evoting-admins`, and `evoting-sessions`.

## V2 ballot model

A single authenticated voter submits exactly two selections in one request:

- `chairCandidateId`: one of the two chair candidates.
- `viceCandidateId`: one of the two vice-chair candidates.

The UI presents two independent candidate groups, each with two candidate cards. Each card contains photo, ballot number, and full name only. There are no vision/mission/slogan fields in the voter ballot UI.

The server validates both candidate IDs against the active configuration. The voter lock is created with an atomic create-if-absent operation. A completed ballot is written once under a random ballot ID. The ballot contains the two selected candidate IDs and a timestamp, but no voter ID, username, or name. The voter participation lock contains voter ID, completion state, timestamp, and a random receipt reference, but no candidate IDs. This preserves the separation between identity/participation and ballot content.

Both selections must be committed as one logical ballot. A request with either selection missing or invalid is rejected. Retries must be idempotent and must not create a second ballot. A partially written transaction must be recoverable without accepting a different selection.

## Admin requirements

1. Overview: total eligible voters, completed voters, pending voters, participation percentage, election status.
2. Voter register: search, add, bulk import, edit name/username, deactivate/delete only under safe rules, and show participation status/time.
3. Candidate management: exactly two chair candidates and two vice-chair candidates; each has a ballot number, full name, and photo.
4. Separate results: independent totals and percentages for chair and vice-chair.
5. Election controls: scheduled/open/closed; emergency close; prevent candidate/config changes while voting is open.
6. Audit log: administrator actions, account changes, configuration changes, opening/closing, exports, and resets.
7. Export: separate participation register and anonymous ballot aggregate/raw ballot export. Exports must not contain a voter-to-choice mapping.
8. Reset: disabled while open, requires a second confirmation, records the actor/reason, and creates a backup snapshot first.
9. Voter deletion: do not silently erase a completed ballot. Prefer deactivation. If an account is deleted before voting, record the administrative action.

## Data preservation and migration

- Do not use the v1 `/admin/reset-practice` endpoint.
- Do not overwrite the v1 config or vote stores.
- Keep v1 stores under their existing names and create isolated v2 stores, e.g. `evoting-v2-config`, `evoting-v2-voters`, `evoting-v2-ballots`, `evoting-v2-admin-audit`, and `evoting-v2-sessions`.
- Before any production cutover, produce and verify a backup/export of v1 config, voter records, participation locks, and anonymous ballots. Store the backup outside the live write path with restricted access.
- Confirm the backup can be read and reconciled before enabling v2.
- Keep the existing production deployment serving v1 until v2 passes staging and acceptance tests.
- Cutover should be a controlled configuration/deployment change with a rollback path to v1. No v1 data conversion is required for trial data.

## Security and privacy constraints

- Admin may see who has or has not voted and when participation was recorded.
- Admin must not see which named voter selected which candidate. A feature that exposes this mapping is intentionally excluded because it compromises ballot secrecy and can facilitate coercion or retaliation.
- Do not put voter identifiers in ballot keys or ballot payloads.
- Do not expose raw ballot records alongside voter records in the same admin response.
- Use authenticated, HttpOnly, SameSite cookies; enforce authorization server-side on every admin endpoint.
- Validate and limit image uploads; prefer optimized image files and object/blob storage over oversized base64 payloads in config.
- Avoid logging passwords, session tokens, or ballot choices alongside voter identity.

## Load and concurrency acceptance criteria

A claim of 100 simultaneous voters is made only after repeatable tests against a staging deployment with production-equivalent Netlify configuration and storage.

Minimum tests:
- 100 distinct accounts log in concurrently.
- 100 distinct accounts submit both selections within a short synchronized window.
- Duplicate concurrent submit from one account: exactly one accepted ballot.
- Same account submitting conflicting choices concurrently: at most one ballot, with deterministic rejection/retry response.
- Network timeout/retry: no duplicate ballot and no changed selections.
- Missing/invalid chair or vice-chair ID: request rejected without marking voter as completed.
- Reconcile: completed participation count equals valid ballot count; chair totals and vice-chair totals each sum to valid ballot count.
- Run repeated load tests and inspect HTTP error rate, p50/p95/p99 latency, function errors, and Blobs operation behavior.
- Test admin dashboard refresh and export during voting without blocking ballot submissions.

Netlify Blobs is key/value object storage, not a relational database or transactional SQL engine. Concurrency safety must be designed around conditional writes and tested under actual deployment conditions. If required atomicity or throughput cannot be demonstrated, move ballot storage to a transactional database before the official election.

## Acceptance checklist before production

- [ ] v1 data export completed, checksum/record counts verified, and backup retained.
- [ ] v1 production remains unchanged until sign-off.
- [ ] V2 UI reviewed on desktop and mobile.
- [ ] Two independent candidate groups and mandatory selections verified.
- [ ] Admin functions and audit logs verified.
- [ ] Ballot secrecy reviewed; no voter-choice mapping endpoint exists.
- [ ] 100-user concurrency test passes and results are recorded.
- [ ] Reconciliation and recovery tests pass.
- [ ] Rollback procedure tested.
- [ ] Owner explicitly approves production cutover.
