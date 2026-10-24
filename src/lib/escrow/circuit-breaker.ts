/**
 * VeilX Escrow Circuit Breaker
 * Provides circuit-breaker protection for outgoing shielded settlements and payouts.
 */

import {
  isPayoutsHalted,
  setPayoutsHalted,
  checkPayoutCircuitBreaker as checkGlobalCircuitBreaker,
} from "../payout-controls";

export { isPayoutsHalted, setPayoutsHalted };

/**
 * Validates payout against emergency kill switch and value bounds.
 * Throws an explicit error if payouts are halted or amount exceeds sanity threshold.
 *
 * @param netPayoutZec Net payout amount in ZEC (optional)
 */
export function checkPayoutCircuitBreaker(netPayoutZec?: number): void {
  // 1. Check global emergency kill switch
  checkGlobalCircuitBreaker();

  // 2. Validate payout amount threshold
  if (netPayoutZec !== undefined) {
    if (netPayoutZec <= 0) {
      throw new Error(`CIRCUIT_BREAKER_REJECT: Invalid payout amount ${netPayoutZec} ZEC`);
    }

    const MAX_SINGLE_PAYOUT_ZEC = Number(process.env.MAX_SINGLE_PAYOUT_ZEC) || 100;
    if (netPayoutZec > MAX_SINGLE_PAYOUT_ZEC) {
      console.warn(
        `[CIRCUIT_BREAKER] Outgoing payout of ${netPayoutZec} ZEC exceeds maximum threshold of ${MAX_SINGLE_PAYOUT_ZEC} ZEC`
      );
      throw new Error(
        `CIRCUIT_BREAKER_LIMIT_EXCEEDED: Payout amount (${netPayoutZec} ZEC) exceeds maximum single transaction limit (${MAX_SINGLE_PAYOUT_ZEC} ZEC). Settlement suspended.`
      );
    }
  }
}
