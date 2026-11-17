-- Truncate before storing at millisecond precision so new work is due immediately.
ALTER TABLE "Delivery"
ALTER COLUMN "nextAttemptAt" SET DEFAULT date_trunc('milliseconds', CURRENT_TIMESTAMP);
