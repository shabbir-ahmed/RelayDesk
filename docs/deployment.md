# Deployment

## Current status

`BLOCKED_EXTERNAL`. The local release passed on Docker Engine 29.10.0 for Linux arm64. Hosting is waiting on access to an existing container project, its PostgreSQL connection, and its assigned HTTPS web origin.

To unblock hosting, share access to one existing project with permissions to run a one-off migration job and launch two long-running services. Configure its PostgreSQL connection and RelayDesk settings in the host's secret store and supply the assigned web origin. A single project can supply the web, worker, and database.

## Containers

Build the common application image and the migration target from the same source revision. The runtime image packages the Next.js standalone server and the compiled TypeScript worker.

```sh
docker build --target runtime -t relaydesk:release .
docker build --target migration -t relaydesk-migration:release .
```

Run these commands in separate service definitions using a registry or the host's build integration.

| Service | Command | Configuration |
| --- | --- | --- |
| Migration job | `npm run db:migrate` | Run once per release before starting web and worker |
| Web | `node .next/standalone/server.js` | Listen on `0.0.0.0:3000` and expose via HTTPS |
| Worker | `node dist/src/worker/main.js` | Long-running internal process with automatic restart and 10 seconds to stop gracefully |
| Explicit seed job | `node dist/prisma/seed.js` | Run against the migrated database to initialize the demo workspace and history |

Start the worker after the web health probe passes. For a new database, run the seed before inviting operators to submit events. The seed adds the stable workspace and receiver and 40 synthetic records. It keeps operator-created work and prior replays on repeated runs.

## Environment

| Variable | Consumed by | Value |
| --- | --- | --- |
| `DATABASE_URL` | All processes | PostgreSQL connection string with a small pool, default four connections per process |
| `APP_ORIGIN` | Web, smoke CLI | Canonical public HTTPS origin without a path or trailing slash |
| `RECEIVER_BASE_URL` | Worker | Fixed web-service origin reachable from the worker, without a path or trailing slash |
| `RECEIVER_SECRET` | Web and worker | Same random 32–256 character HMAC secret on both services |
| `OPERATOR_CREDENTIAL` | Web | Random shared operator credential, 12–256 characters |
| `SESSION_SECRET` | Web | Random 32–256 character session secret |
| `API_TOKEN` | Web, smoke CLI | Independent random 32–256 character API credential |
| `PORT` and `HOSTNAME` | Web | Container defaults are port 3000 and all interfaces |

The worker appends `/api/demo/receiver` to the configured origin and processes the first HTTP status it gets. Use routing that reaches the route directly. Keep the dashboard and `GET /api/health` reachable through the HTTPS front end. Health returns HTTP 200 only when environment validation and a database probe pass. The browser uses the exact `APP_ORIGIN` for operator mutations.

After rollout, run the smoke from a trusted shell with `APP_ORIGIN` and `API_TOKEN` configured. Run the [demo walkthrough](demo.md) as an operator to verify sign-in and replay. Use the service logs for worker startup and stale-completion events.
