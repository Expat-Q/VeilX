use std::fs;
use zcash_protocol::consensus::BranchId;
use zcash_primitives::transaction::Transaction;
use orchard::bundle::BatchValidator;
use veilx_wallet::orchard_wallet::ORCHARD_VERIFYING_KEY;

#[test]
fn test_verify_real_v6_tx_with_batch_validator() {
    let hex_str = fs::read_to_string("../../tests/real_v6_tx.hex").expect("reads hex");
    let raw_bytes = hex::decode(hex_str.trim()).expect("decodes hex");

    let branch_id = BranchId::Nu6_3;
    let mut reader = &raw_bytes[..];
    let tx = Transaction::read(&mut reader, branch_id).expect("reads Transaction from raw wire bytes");

    let txid_bytes = *tx.txid().as_ref();
    println!("TxID bytes: {}", hex::encode(txid_bytes));

    let ironwood_bundle = tx.ironwood_bundle().expect("ironwood bundle present");
    println!("Testing BatchValidator on real on-chain transaction bundle...");
    let mut validator = BatchValidator::new(&*ORCHARD_VERIFYING_KEY);
    validator.add_bundle(ironwood_bundle, txid_bytes).expect("adds bundle to validator");

    let mut rng = rand::rng();
    let is_valid = validator.validate(&mut rng);
    println!(">>> Real tx BatchValidator is_valid: {} <<<", is_valid);
    assert!(is_valid);
}
