export const timing = {
  pollMs: 1_000,
  leaseMs: 30_000,
  timeoutMs: 3_000,
  receiverTimeoutMs: 4_000,
  retryMs: [5_000, 15_000] as const,
  recoveryBatch: 20,
}
export const maxAttempts = 3
export const maxReplayCycles = 3
