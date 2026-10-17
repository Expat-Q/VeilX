//! ZIP-317 Marginal Fee Accounting for Zcash Transactions

pub const GRACE_ACTIONS: u64 = 2;
pub const MARGINAL_FEE_ZATOSHIS: u64 = 5000;
pub const STANDARD_DEFAULT_FEE: u64 = 10000; // 0.0001 TAZ/ZEC

/// Calculates the required fee in zatoshis under ZIP-317 rules.
///
/// Under ZIP-317:
/// logical_actions = max(inputs, outputs)
/// billable_actions = max(GRACE_ACTIONS, logical_actions)
/// fee = billable_actions * MARGINAL_FEE_ZATOSHIS
pub fn calculate_zip317_fee(input_count: usize, output_count: usize) -> u64 {
    let logical_actions = (input_count.max(output_count)) as u64;
    let billable_actions = logical_actions.max(GRACE_ACTIONS);
    billable_actions * MARGINAL_FEE_ZATOSHIS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zip317_standard_fee() {
        // Standard 1-in 2-out transaction -> max(1, 2) = 2 -> 2 * 5000 = 10,000 zats (0.0001)
        assert_eq!(calculate_zip317_fee(1, 2), 10000);
        assert_eq!(calculate_zip317_fee(1, 1), 10000);
        assert_eq!(calculate_zip317_fee(2, 2), 10000);
    }

    #[test]
    fn test_zip317_many_inputs() {
        // 5 inputs, 2 outputs -> max(5, 2) = 5 actions -> 5 * 5000 = 25,000 zats
        assert_eq!(calculate_zip317_fee(5, 2), 25000);
    }
}
