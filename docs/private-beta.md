# Private beta

Each workspace has a generated sign-in code, approved HTTPS destinations, and its own delivery log. Signing in with the workspace slug and access code unlocks delivery history, test events, replay, API key management, failure alerts, and the audit log. An administrator provisions each workspace from the deployment terminal.

## Start with Docker

Keep your existing `.env` and database port settings. If this is a new checkout, copy `.env.example` to `.env` first. Set `RELAYDESK_MODE=private` and set `APP_ORIGIN` to the web origin you will use. Generate a separate secret for `SESSION_SECRET` and `DESTINATION_SIGNING_KEY`. Run this command once for each key and put its output in `.env`.

```sh
openssl rand -hex 32
```

Start the web service, worker, and PostgreSQL. Compose applies migrations when it starts.

```sh
docker compose up --build -d --wait
```

Replace the example URL with the partner endpoint you have approved. The endpoint must have a public DNS name and serve HTTPS on port 443. RelayDesk accepts a path and blocks credentials, query strings, fragments, IP literals, and private or reserved addresses.

```sh
docker compose run --rm --no-deps worker node dist/scripts/provision-workspace.js \
  pilot 'Pilot Workspace' 'https://hooks.example.com/relaydesk'
```

The command prints the workspace slug, its sign-in code, and the destination’s signing secret. Give the sign-in code to the workspace operator and share the signing secret with the recipient through your secret-sharing channel. Keep `DESTINATION_SIGNING_KEY` stable because it derives all destination signing secrets.

For a native install, apply migrations with `npm run db:migrate` and run the same provisioning command through npm.

```sh
npm run workspace:create -- pilot 'Pilot Workspace' 'https://hooks.example.com/relaydesk'
```

## Add a destination and configure subscriptions

Before upgrading an existing Phase 1 Docker installation, stop the web and worker so the old processes finish before the schema changes. Start them again with the updated image.

```sh
docker compose stop web worker
docker compose up --build -d --wait
```

The upgrade keeps existing destinations subscribed to all event types and creates alerts for currently failed private deliveries. To approve an additional destination, use its own URL and name.

```sh
docker compose run --rm --no-deps worker node dist/scripts/approve-destination.js \
  pilot 'Billing system' 'https://billing.example.com/webhooks'
```

For native installs, run `npm run destination:approve -- pilot 'Billing system' 'https://billing.example.com/webhooks'`. Share the returned signing secret with that endpoint's recipient. Additional destinations begin with an empty subscription list. In **Destinations**, enter one exact event type per line or enter `*` for all event types. A test event can still be sent directly to any approved destination.

## Send and replay

1. Open the configured `APP_ORIGIN`, sign in with the slug and access code, and open **Destinations**.
2. Select **Send test event** and submit the sample payload. RelayDesk sends it to the approved destination with a signed `"test": true` property in the event envelope. The recipient can use this property to avoid real side effects.
3. Inspect the attempt timeline. If the delivery fails, select **Replay delivery**. Replay keeps the same event ID and body and creates a new cycle. Receivers should deduplicate business effects by the stable event ID.
4. Open **API keys** and create a key for your application. Save the full value when it is shown. If you revoke a key, subsequent requests with it receive HTTP 401.

A bearer key can submit events for its workspace. Idempotency keys are unique within a workspace. Use the same key and payload when retrying a submission. Generate a fresh key for each distinct event.

```sh
curl --fail-with-body "$APP_ORIGIN/api/events" \
  -H "Authorization: Bearer $RELAYDESK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"eventType":"invoice.paid","payload":{"invoiceId":"INV-1042"},"idempotencyKey":"invoice-1042-paid"}'
```

The response includes `eventId`, `deliveryIds` for all destinations selected at submission time, and `deliveryId` for existing single-destination clients. An event with no matching subscriptions has an empty `deliveryIds` array and a null `deliveryId`. An idempotent retry returns the same receipt even after a subscription changes. Open `/deliveries/<deliveryId>` with a browser session in the same workspace to inspect a delivery. To verify signatures, use the per-destination signing secret and the [signature format](architecture.md#request-signing). The signed receiver mode is always `SUCCEED` for private deliveries.

## Find failures and review changes

Search **Deliveries** by event type, full event ID, or full delivery ID. Combine search with the status and destination filters.

Open **Operations** for failure alerts and the audit log. A terminal failure opens an in-app alert once per delivery cycle. Acknowledging it keeps the entry available under **All alerts**. The audit log records destination approvals, subscription changes, manual replays, and API key creation and revocation. Audit entries identify the actor as an administrator or workspace operator.

## Deployment boundaries

The beta uses one shared access code per workspace, and an in-memory sign-in rate limit per workspace on one web instance. Delivery payloads remain in the workspace’s database. The current worker delivers sequentially and uses the existing fixed retry and replay limits. Host the public demo separately with its own synthetic database and credentials.

`npm run verify` uses a disposable PostgreSQL database. The beta browser test signs into two workspaces, submits to a local TLS fixture, verifies signatures, replays a failed delivery, and checks fan-out, search, alerts, audit entries, cross-workspace access, and API key revocation. OpenSSL generates the temporary test certificate.
