# Two-minute demo

This walkthrough uses the isolated `RELAYDESK_MODE=demo` instance.

1. Open the dashboard and pick a sample row. Show the persisted status and attempt timeline.
2. Sign in as operator and create a **Fail twice** event. Keep the sample JSON or edit its synthetic reference. The next attempts become eligible 5 and 15 seconds after failure. Show two HTTP 503s followed by HTTP 200.
3. Return to the dashboard, filter for **Failed**, and open a failed sample. Choose **Replay delivery**, select **Succeed**, and queue it. The event ID stays the same and both cycles appear in the timeline.
4. Explain the crash window. An expired lease becomes UNKNOWN and the receiver might already have accepted that request. A retry can send it again. Point to [the concurrency, rollback and recovery tests](../tests/integration/queue.test.ts) and [the verification evidence](../STATUS.md).

## API

Set `APP_ORIGIN` to the target origin and `RELAYDESK_API_TOKEN` to the configured token in your shell.

```sh
curl -sS "$APP_ORIGIN/api/events" \
  -H "Authorization: Bearer $RELAYDESK_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"eventType":"order.created","payload":{"orderId":"demo-1042","synthetic":true},"idempotencyKey":"demo-order-1042","receiverMode":"FAIL_TWICE"}'

curl -sS "$APP_ORIGIN/api/deliveries/<delivery-id>"
curl -sS "$APP_ORIGIN/api/deliveries?status=FAILED"
```

The first submission returns HTTP 201. Repeat the same input with the same key for HTTP 200 and the original IDs, including after replay. Use a new key for a new event. Replay requires an operator session and can be demonstrated in the detail UI.

## Manual crash smoke

Run this on a disposable local Compose instance.

1. Create a **Timeout** event and open its public detail or poll `GET /api/deliveries/<delivery-id>` in a second terminal.
2. As soon as the attempt is `STARTED` and the delivery is `PROCESSING`, use `docker compose kill --signal SIGKILL worker`.
3. Start it again with `docker compose up -d worker`.
4. Around 30 seconds after the claim, the first attempt becomes `UNKNOWN`. After the additional retry delay, a fresh attempt appears. A timeout on that new attempt reflects the sender's deadline. The receiver may still have completed its simulation.

The automated PostgreSQL lease test also exercises old-token fencing and recovery at the final attempt limit.
