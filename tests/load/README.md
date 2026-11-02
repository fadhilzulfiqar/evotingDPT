# E-Voting DPT — 100-account staging load test

This test is designed to run **only against a separate Netlify staging site**. It refuses to run when `BASE_URL` is the same host as `SOURCE_URL` or `evotingdpt.netlify.app`.

## What the test does

1. Reads the public candidate configuration from `SOURCE_URL` using GET only.
2. Logs in as `admin_dpt` on `BASE_URL` (staging).
3. Closes the staging election, clears old staging ballots/locks, and copies the candidate configuration to staging.
4. Creates or reuses up to 100 dummy users named `loadtest-001` through `loadtest-100`.
5. Opens the staging election.
6. Starts 100 virtual users, each logging in and submitting one vote in the same test window. Choices are split 50/50 across the two candidates.
7. Closes staging, verifies that all test users are marked as voted and that the anonymous ballot tally equals the expected number of votes.
8. Clears staging ballots/locks again and leaves the staging election closed.

The script never sends login, admin-write, reset, or vote requests to production. Production is used only to read `/api/election`.

## Create the staging site

1. In Netlify, create a **new site** from the GitHub repository `fadhilzulfiqar/evotingDPT`.
2. Select branch `load-test-staging`.
3. Do not attach the production custom domain and do not reuse the production site's Netlify site ID.
4. Confirm the build settings are inherited from `netlify.toml` (`publish = public`, Functions directory `netlify/functions`).
5. In the new staging site's environment variables, set:
   - `ADMIN_BOOTSTRAP_PASSWORD` = a new staging-only password with at least 8 characters.
6. Trigger a deploy and wait until it succeeds.
7. Open `https://<your-staging-site>.netlify.app/api/health` and confirm it returns `{"ok":true,"storage":"netlify-blobs"}`.

Netlify Blobs are scoped to the new site. Do not copy production Blobs data or production secrets into staging. The script copies only the public election configuration.

## Run the test

Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) on a workstation or run it from the included GitHub Actions workflow.

Example environment variables:

    export BASE_URL="https://YOUR-STAGING-SITE.netlify.app"
    export SOURCE_URL="https://evotingdpt.netlify.app"
    export ADMIN_BOOTSTRAP_PASSWORD="YOUR_STAGING_ONLY_ADMIN_PASSWORD"
    export VUS="100"
    k6 run tests/load/k6-vote.js

The test produces `load-test-summary.json` and prints a reconciliation result. A pass requires:

- 100/100 voter logins succeed.
- 100/100 vote submissions return HTTP 200 and `{ "ok": true }`.
- Exactly 100 test accounts exist.
- Exactly 100 test accounts are marked as voted.
- The anonymous ballot tally totals exactly 100.

The test closes the staging election and clears staging ballots/locks after reconciliation. The 100 dummy accounts remain in staging so the test can be repeated; they are not production accounts.

## Important scope

This is an API/backend concurrency test with 100 simultaneous virtual users. It does not emulate 100 physical phones, mobile radio networks, or full browser rendering. Run a separate browser/device test after the backend passes.

Do not run this script against production. The safety guard is intentional.
