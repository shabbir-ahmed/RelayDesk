# RelayDesk status

**COMPLETE_LOCAL_DEPLOYMENT_BLOCKED**

## M0 · Complete

- Read the complete development plan and inspected the empty workspace. Consulted official Next.js, Tailwind, Prisma, and PostgreSQL references.
- Added the pinned npm lockfile, strict TypeScript, app and worker bootstrap, environment validation, Compose PostgreSQL, Prisma schema and initial migration.
- `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run typecheck`, and `npm run lint` passed.
- Fresh PostgreSQL 15.13 database on port 55432 applied `20261117000100_initial`. An independent worker logged ready. Web health returned `{"status":"ok","database":"reachable"}`.
- Docker was absent. A disposable Lima VM is being provisioned for M5 packaging checks. No product blocker at M0.
- Next milestone: M1 first complete delivery.

## M1 · Complete

- Added stream-bounded submission, canonical event bodies and idempotent event/delivery transactions, the PostgreSQL one-row claim, the standalone sender, finalization, and database-backed list/detail views and APIs.
- `npm run typecheck` and `npm run lint` passed. M1 HTTP smoke returned 201 on initial submission, 200 with the same IDs on repeat, and 409 on conflicting input.
- Delivery `52f46120-5dd8-4ddc-90cd-640c89a99d15` persisted as DELIVERED with one SUCCEEDED attempt and HTTP 200. The detail page rendered that real attempt.
- No M1 exit defects. Next milestone: M2 failure and recovery.

## M2 · Complete

- Implemented HMAC over bounded metadata and exact body bytes, four receiver modes, fixed backoff, expired lease recovery, fenced finalization, and atomic failed-only replay.
- `npm run typecheck`, `npm run lint`, and 11 retry-policy unit cases passed.
- `npm run test:integration` migrated the separate PostgreSQL test database and passed three cases. FAIL_TWICE succeeded on attempt three, persistent failure exhausted the retry budget, stale workers could not update expired or superseded leases, and replay kept the original event and attempt history.
- Temporary Docker engine is running in an isolated Lima VM. Node and PostgreSQL base images pulled successfully for M5.
- No outstanding M2 defects. Next milestone: M3 access and finished UI.

## M3 · Complete

- Added encrypted four-hour operator cookies, bearer submission, origin checks, bounded sign-in throttling, replay routes, and the dashboard, detail, demo guide, and login UI.
- `npm run typecheck` and `npm run lint` passed. A real Chromium smoke verified viewer restrictions, operator sign-in and creation, three actual HTTP 503s, replay in SUCCEED mode, and successful HTTP 200 in cycle 2 with both cycles still visible.
- No M3 exit defects. Next milestone: M4 correctness verification.

## M4 · Complete

- Added coverage for T01–T14, including real PostgreSQL rollback and unique-key races, two independent claim clients, concurrent replay, streamed input, signed HTTP, session/origin checks, stable cursor pagination, and production-browser journeys.
- Fixed a T01 failure in which Prisma's JSON argument serializer dropped a valid nested key. A parameterized insert now passes canonical JSON text directly to PostgreSQL.
- `npm run test:unit` passed 12 cases. `npm run test:integration` passed 13 PostgreSQL/API cases. `npm run test:e2e` passed both Chromium cases (49.2 seconds total). Both database suites built the production application successfully.
- Manual crash smoke passed. Worker PID 30866 received SIGKILL after persisting a STARTED attempt for delivery `7a0309b2-e394-47e5-a19a-a57589e1ab84`. Restarted PID 30868 recorded the expired attempt as UNKNOWN and claimed attempt 2.
- Next milestone — M5 release packaging.

## M5 · Complete

- Added the multi-stage Dockerfile, database/migration/web/worker Compose services, 40 deterministic historical fixtures, the smoke script, GitHub Actions workflow, and release documentation.
- Fixed clean Docker prerendering without secrets by moving operator configuration behind the request-time cookie read. The image then built successfully with no runtime credentials.
- On Docker Engine 29.10.0 / Linux arm64 and Node 22.23.5, the fresh PostgreSQL 15.20 container became healthy, migration `20261117000100_initial` completed with exit 0, and separate web and worker containers used the same runtime image. Health returned HTTP 200 and reported reachable PostgreSQL.
- `npm run smoke` passed against Compose. Live delivery `a7f47cbc-86e2-49e4-8654-4730311a5b8b` recorded 503 → 503 → 200. Re-seeding kept all IDs and states unchanged across 40 historical and one live delivery, including eight terminal failures and eight replay fixtures.
- Next milestone — M6 release gate and handoff.

## M6 · Local release gate passed

- A clean clone installed the lockfile with `npm ci`, generated Prisma, applied migration `20261117000100_initial` to a fresh runtime and test database, and seeded 40 historical deliveries. PostgreSQL 15.13 ran the host test databases. PostgreSQL 15.20 ran in Compose.
- The clean release gate passed lint, strict type checking, 12 unit cases, and the production build. Its first integration pass hit a timestamp rounding issue in test fixtures. The fixture correction uses timestamps in the past and independent data per queue case. The clean-checkout recheck passed all 13 integration cases, both Chromium journeys (50.2 seconds), lint, type checking, and production builds. Together these cover T01–T14.
- The clean clone's exact `npm start` and `npm run worker` scripts ran separately. Native smoke delivery `ad9c5776-f8ca-4384-9087-304bedf24653` recorded one HTTP 200. The packaged worker also replayed failed fixture `d96bb826-de1f-8b59-a8e7-ee66a6d86551` successfully and kept both cycles visible in Chromium.
- Captured [dashboard](docs/screenshots/dashboard.png) and [retry history](docs/screenshots/retry-history.png) directly from the running Compose release. Visual review covered the desktop screenshots and a 390 px dashboard. Chromium checks verified both mobile layouts, clipboard ID copy, and token placeholders on the demo guide.
- `BLOCKED_EXTERNAL` for hosting. The missing inputs are access to an existing container project, its PostgreSQL connection, and its assigned HTTPS origin. [Deployment instructions](docs/deployment.md) name the job, services, and environment settings.
- Release gate closed. All mandatory local checks passed.

## Follow-up · Immediate delivery eligibility

- Reproduced the reported queue-test failures on Docker PostgreSQL 15.20. The original delivery default could round the due timestamp into the next millisecond. Migration `20261118000100_floor_delivery_due_time` truncates the timestamp before storage. The new regression failed before the migration and passed after it.
- `npm run verify` exited successfully on the Docker-backed test database. Lint, type checking, 12 unit tests, 14 integration tests, both Chromium journeys, and the production build passed.
- The migration also applied to the local runtime database on port 55432. Prisma reported no schema drift, and all 40 historical deliveries remained present.

## Private beta · Phase 1

- Private mode now provides workspace sign-in, one administrator-approved HTTPS destination per workspace, revocable API keys, signed test events, and session-scoped delivery history and replay. The isolated demo remains available in demo mode.
- `npm run verify` passed lint, type checking, the production build, 33 unit tests, 14 PostgreSQL integration tests, and three Chromium journeys. The beta journey used two workspaces and a local HTTPS receiver that verified signatures, rejected an initial test event, and accepted its replay. It also verified cross-workspace denials and API key revocation.
- Migration `20261118000200_private_beta` applied to the disposable test database and matched the Prisma schema. An isolated Docker stack verified fresh migrations, startup, compiled workspace provisioning, and private sign-in. The existing local Docker project was kept available.
- Local setup and credential requirements are in [Private beta](docs/private-beta.md).

## Private beta · Phase 2

- Added multiple approved destinations, exact and wildcard subscriptions, idempotent fan-out, delivery search, an in-app failure inbox, and a workspace audit log.
- `npm run verify` passed lint, type checking, the production build, 33 unit tests, 17 PostgreSQL integration tests, and three Chromium journeys against disposable native PostgreSQL. The private browser journey covered subscription changes, signed fan-out to multiple endpoints, search, replay and alert acknowledgment, and cross-workspace denials.
- A separate Phase 1 upgrade fixture retained existing deliveries and attempt history, kept the existing destination on its catch-all subscription, and backfilled its terminal failure alert. Prisma reported no schema drift. The compiled approval command also created a second destination and an audit entry on the disposable upgrade database.
- The [private beta guide](docs/private-beta.md) covers the schema upgrade, destination approval, and daily operations.
