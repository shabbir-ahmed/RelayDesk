# RelayDesk status

## M0 · Complete

- Read the complete development plan and inspected the empty workspace. Consulted official Next.js, Tailwind, Prisma, and PostgreSQL references.
- Added the pinned npm lockfile, strict TypeScript, app and worker bootstrap, environment validation, Compose PostgreSQL, Prisma schema and initial migration.
- `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run typecheck`, and `npm run lint` passed.
- Fresh PostgreSQL 15.13 database on port 55432 applied `20261117000100_initial`. An independent worker logged ready; web health returned `{"status":"ok","database":"reachable"}`.
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
