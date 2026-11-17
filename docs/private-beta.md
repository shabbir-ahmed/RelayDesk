# Private beta

Each workspace has a generated sign-in code, one approved HTTPS destination, and its own delivery log. Signing in with the workspace slug and access code unlocks delivery history, test events, replay, and API key management. An administrator provisions each workspace from the deployment terminal.

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

## Send and replay

1. Open the configured `APP_ORIGIN`, sign in with the slug and access code, and open **Destination**.
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

The response includes the event and delivery IDs. Open `/deliveries/<deliveryId>` with a browser session in the same workspace to inspect it. To verify signatures, use the per-destination signing secret and the [signature format](architecture.md#request-signing). The signed receiver mode is always `SUCCEED` for private deliveries.

## Deployment boundaries

The beta uses one shared access code per workspace, one administrator-approved endpoint per workspace, and an in-memory sign-in rate limit per workspace on one web instance. Delivery payloads remain in the workspace’s database. The current worker delivers sequentially and uses the existing fixed retry and replay limits. Host the public demo separately with its own synthetic database and credentials.

`npm run verify` uses a disposable PostgreSQL database. The beta browser test signs into two workspaces, submits to a local TLS fixture, verifies signatures, replays a failed delivery, and checks cross-workspace access and API key revocation. OpenSSL generates the temporary test certificate.
