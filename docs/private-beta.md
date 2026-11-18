# Private beta

Create a workspace and a named owner account from the sign-in page. Each workspace has separate Test and Live destinations, API keys, delivery history, alerts, and usage. Workspace owners request outbound HTTPS destinations in the dashboard. Administrators review requests from the deployment terminal.

## Start with Docker

Keep your existing `.env` and database port settings. If this is a new checkout, copy `.env.example` to `.env` first. Set `RELAYDESK_MODE=private` and set `APP_ORIGIN` to the web origin you will use. Generate a separate secret for `SESSION_SECRET` and `DESTINATION_SIGNING_KEY`. Run this command once for each key and put its output in `.env`.

```sh
openssl rand -hex 32
```

Start the web service, worker, and PostgreSQL. Compose applies migrations when it starts.

```sh
docker compose up --build -d --wait
```

For a new workspace, open the configured `APP_ORIGIN` and choose **Create a workspace**. Use the workspace slug and your username when signing in again. Named accounts start in Test. Existing workspaces can still sign in with their original workspace access code by leaving the username blank.

The administrator can also provision a legacy workspace with a generated access code and an initial Live destination. Replace the example URL with the partner endpoint you have approved. The endpoint must have a public DNS name and serve HTTPS on port 443. RelayDesk accepts a path and blocks credentials, query strings, fragments, IP literals, and private or reserved addresses.

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

Before upgrading an existing Docker installation, stop the web and worker so the old processes finish before the schema changes. Start them again with the updated image.

```sh
docker compose stop web worker
docker compose up --build -d --wait
```

The self-service migration retains existing destinations, subscriptions, API keys, and delivery history in Live. It also counts events already accepted that UTC day.

In **Destinations**, an owner selects **Request destination** and enters a name and public HTTPS URL. The request stays in the selected Test or Live environment. Check **Destination requests** for the review status and any rejection reason. An owner can submit the URL again after rejection.

From a trusted deployment terminal, list pending requests and approve or reject a request by ID. The list shows up to 100 pending requests, oldest first, with their workspace, environment, and URL. Review ownership and the intended environment before approving.

```sh
npm run destination:requests -- list
npm run destination:requests -- approve <request-id>
npm run destination:requests -- reject <request-id> 'Confirm that your team controls this endpoint.'
```

Build first when running from source. In Docker, replace `npm run destination:requests --` with `docker compose run --rm --no-deps worker node dist/scripts/review-destination.js`. Approval checks DNS with the existing outbound policy and prints a signing secret. Share the secret privately with the receiver operator. The owner can refresh the requests list to see the decision.

Administrators can also approve a destination directly. Direct approval resolves any pending request for the same URL, workspace, and environment.

```sh
docker compose run --rm --no-deps worker node dist/scripts/approve-destination.js \
  pilot 'Billing sandbox' 'https://billing.example.com/webhooks' test
```

For native installs, run `npm run destination:approve -- pilot 'Billing sandbox' 'https://billing.example.com/webhooks' test`. Pass `live` to approve a Live destination. Omitting the environment keeps the earlier CLI behavior of approving it in Live. Share the returned signing secret with that endpoint's recipient. Additional destinations begin with an empty subscription list. In **Destinations**, enter one exact event type per line or enter `*` for all event types. A test event can still be sent directly to any approved destination.

## Send and replay

1. Sign in, select **Test** from the environment menu, and open **Destinations**.
2. Select **Send test event** and submit the sample payload. RelayDesk sends it to the approved destination with a signed `"test": true` property in the event envelope. The recipient can use this property to avoid real side effects.
3. Inspect the attempt timeline. If the delivery fails, select **Replay delivery**. Replay keeps the same event ID and body and creates a new cycle. Receivers should deduplicate business effects by the stable event ID.
4. Open **API keys** in the environment where you want your application to submit events, then create a key. Save the full value when it is shown. If you revoke a key, subsequent requests with it receive HTTP 401.

A bearer key can submit events only in its workspace and environment. All Test events include the signed `"test": true` flag. Idempotency keys are unique within a workspace and environment. Use the same key and payload when retrying a submission. Generate a fresh key for each distinct event.

```sh
curl --fail-with-body "$APP_ORIGIN/api/events" \
  -H "Authorization: Bearer $RELAYDESK_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"eventType":"invoice.paid","payload":{"invoiceId":"INV-1042"},"idempotencyKey":"invoice-1042-paid"}'
```

The response includes `eventId`, `deliveryIds` for all destinations selected at submission time, and `deliveryId` for existing single-destination clients. An event with no matching subscriptions has an empty `deliveryIds` array and a null `deliveryId`. An idempotent retry returns the same receipt even after a subscription changes. Open `/deliveries/<deliveryId>` with a browser session in the same workspace to inspect a delivery. To verify signatures, use the per-destination signing secret and the [signature format](architecture.md#request-signing). The signed receiver mode is always `SUCCEED` for private deliveries.

## Invite your team

A workspace owner can create, copy, or revoke an invitation in **Team**. Share the link privately. An invitation can be used once within 48 hours. The recipient can use their existing username and password or choose credentials for a new account.

Invited members can operate the workspace’s Test and Live environments. Owners manage invitations. To access a different workspace you belong to, sign in with that workspace’s slug and your account credentials. A legacy access code can continue to manage an upgraded workspace as its owner.

## Usage limits

**Deliveries** shows daily event usage for the selected environment. Each workspace has 100 Test events and 1,000 Live events per UTC day. Each newly accepted event counts once, even when it fans out across destinations or has no matching subscription. Retries, replays, and idempotent repeats of a submission use the original allowance. When you reach the limit, a new submission returns HTTP 429 until the next UTC day.

## Find failures and review changes

Search **Deliveries** by event type, full event ID, or full delivery ID. Combine search with the status and destination filters.

Open **Operations** for failure alerts and the audit log. A terminal failure opens an in-app alert once per delivery cycle. Acknowledging it keeps the entry available under **All alerts**. The audit log records destination requests and decisions, subscription changes, manual replays, API key changes, and team invitations. Named accounts appear by username in relevant audit entries.

## Deployment boundaries

The beta uses one web instance for in-memory sign-in and registration rate limits. It supports named accounts and retains access codes for earlier pilot workspaces. Delivery payloads remain in the workspace’s database. The current worker delivers sequentially and uses the existing fixed retry and replay limits. Host the public demo separately with its own synthetic database and credentials.

`npm run verify` uses a disposable PostgreSQL database. The beta browser test signs into two workspaces, submits to a local TLS fixture, verifies signatures, replays a failed delivery, and checks fan-out, signup, single-use invitations, environment separation, quota enforcement, and the existing delivery workflows. OpenSSL generates the temporary test certificate.
