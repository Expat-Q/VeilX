/**
 * Emergency Payout Circuit Breaker & Operations Control
 * Provides an operator-controlled mechanism to halt new outgoing payouts
 * across all instances and workers while keeping non-financial UI,
 * incoming deposits, and diagnostic tools operational.
 */

declare global {
  // eslint-disable-next-line no-var
  var __EMERGENCY_PAYOUTS_DISABLED: boolean | undefined;
}

export function isPayoutsHalted(): boolean {
  // 1. Process environment variable flag
  if (process.env.DISABLE_PAYOUTS === "true") {
    return true;
  }
  // 2. Dynamic runtime circuit breaker
  if (globalThis.__EMERGENCY_PAYOUTS_DISABLED === true) {
    return true;
  }
  return false;
}

export function setPayoutsHalted(halted: boolean, operator = "system"): void {
  globalThis.__EMERGENCY_PAYOUTS_DISABLED = halted;
  console.warn(
    `[SECURITY_AUDIT] Emergency payout circuit breaker state changed to: ${
      halted ? "HALTED" : "ACTIVE"
    } by operator: ${operator} at ${new Date().toISOString()}`
  );
}

export function checkPayoutCircuitBreaker(): void {
  if (isPayoutsHalted()) {
    console.warn(
      `[SECURITY_AUDIT] Outgoing payout blocked by emergency circuit breaker at ${new Date().toISOString()}`
    );
    throw new Error(
      "PAYOUTS_HALTED: Emergency payout circuit breaker is ACTIVE. Outgoing payouts are temporarily suspended for security."
    );
  }
}
