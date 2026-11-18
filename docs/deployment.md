# Deployment

## Current status

Hosted staging is `BLOCKED_EXTERNAL`. The staging operator needs access to a container project and image registry with permission to deploy the web and worker services, run a migration job, manage secrets and network rules, and configure health checks. The project needs a PostgreSQL connection with backup and restore access, an assigned HTTPS origin, an approved HTTPS smoke receiver that can exercise failure and success, and access to a monitoring collector and operator notification destination.

Use independent databases, secret-store entries, and origins for staging and production. Keep PostgreSQL and the worker private. The worker needs DNS and outbound HTTPS to approved public destinations. Block worker egress to internal networks and cloud metadata addresses, allowing the private database and required DNS on their service ports. Serve the web app over TLS.

See the [production pilot runbook](production-pilot.md) for the release gate, alerts, recovery drills, and key rotation.

## Containers

Build the common application image and the migration target from the same source revision. CI runs `npm run verify` and builds both targets. Tag deployment images by commit and record the image digests. The runtime image packages the Next.js standalone server and the compiled TypeScript worker.

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
| Explicit seed job | `node dist/prisma/seed.js` | Run against the migrated demo database to initialize the synthetic workspace and history |

Start the worker after the web health probe passes. Provision private workspaces with the [workspace setup command](private-beta.md). Run the seed in isolated demo mode to add the synthetic workspace, receiver, and sample history.

## Environment

| Variable | Consumed by | Value |
| --- | --- | --- |
| `DATABASE_URL` | All processes | PostgreSQL connection string with a small pool, default four connections per process |
| `APP_ORIGIN` | Web, smoke CLI | Canonical public HTTPS origin without a path or trailing slash |
| `RELAYDESK_MODE` | Web and worker | `private` by default or `demo` for a separate synthetic database |
| `DESTINATION_SIGNING_KEY` | Private worker and provisioning command | Stable 32-byte hex key used to derive per-destination signing secrets |
| `RECEIVER_BASE_URL` | Demo worker | Fixed web-service origin reachable from the worker, without a path or trailing slash |
| `RECEIVER_SECRET` | Demo web and worker | Same random 32–256 character HMAC secret on both services |
| `OPERATOR_CREDENTIAL` | Demo web | Random shared operator credential, 12–256 characters |
| `OPS_METRICS_TOKEN` | Web, monitoring collector | Separate 32-byte hex key used to scrape `/api/ops/metrics` |
| `SESSION_SECRET` | Web | Random 32-byte hex key in private mode, or a 32–256 character secret in demo mode |
| `API_TOKEN` | Demo web, demo smoke CLI | Independent random 32–256 character API credential |
| `PORT` and `HOSTNAME` | Web | Container defaults are port 3000 and all interfaces |

The private worker needs outbound HTTPS access to approved public destinations and DNS resolution. Apply a host-level egress policy that blocks internal networks. The demo worker appends `/api/demo/receiver` to its configured origin and needs direct routing to that route. Keep the dashboard and `GET /api/health` reachable through the HTTPS front end. Health returns HTTP 200 only when environment validation and a database probe pass. The browser uses the exact `APP_ORIGIN` for operator mutations.

After private rollout, sign in and send a test event to the approved destination. For a demo rollout, run the smoke from a trusted shell with `APP_ORIGIN` and `API_TOKEN` configured. Use the service logs for worker startup and stale-completion events.
