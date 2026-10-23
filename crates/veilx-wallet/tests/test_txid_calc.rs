use std::fs;
use zcash_protocol::consensus::BranchId;
use zcash_primitives::transaction::{
    Transaction,
    txid::TxIdDigester,
};

#[test]
fn test_txid_digest_calculation() {
    let hex_str = fs::read_to_string("../../tests/real_v6_tx.hex").expect("reads hex");
    let raw_bytes = hex::decode(hex_str.trim()).expect("decodes hex");

    let branch_id = BranchId::Nu6_3;
    let mut reader = &raw_bytes[..];
    let tx = Transaction::read(&mut reader, branch_id).expect("reads Transaction from raw wire bytes");

    let digester_parts = tx.digest(TxIdDigester);
    println!("TxID from method: {:?}", tx.txid());
}
