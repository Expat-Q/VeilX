//! Integration Test: Pure Shielded Outflow (t -> z) under ZIP-225
//!
//! Verifies:
//! 1. `build_v5_shielding_transaction` with pure Orchard recipient produces valid V5 tx with 0 transparent outputs.
//! 2. Orchard bundle contains expected value balance, empty tree anchor, and >= 2 actions.
//! 3. Prover and finalizer PCZT workflow:
//!    - Client proves shielding parameters with Halo 2
//!    - Server finalizes transaction using transparent signature and client proof bundle

use veilx_wallet::{
    orchard_builder::EMPTY_TREE_ANCHOR_HEX,
    pczt::{
        finalize_shielding_transaction_native, prove_shielding_pczt_native, ShieldingPcztParams,
        TransparentUtxoInfo,
    },
    transaction::{
        build_and_sign_v5_transaction, build_v5_shielding_transaction, UtxoInput,
        MAINNET_NU5_BRANCH_ID, TESTNET_IRONWOOD_BRANCH_ID,
    },
    unified_address::{decode_unified_address, encode_unified_address},
};

#[test]
fn test_shielding_v5_pure_orchard_direct() {
    let priv_hex = "1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a";
    let utxos = vec![UtxoInput {
        txid: "99887766554433221100ffeeddccbbaa99887766554433221100ffeeddccbbaa".to_string(),
        vout: 0,
        amount_zatoshis: 250_000, // 0.0025 ZEC
    }];

    // Derive testnet Orchard account to get valid 43-byte raw receiver
    let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let acc = veilx_wallet::orchard_wallet::derive_orchard_account(mnemonic, 0, "testnet").unwrap();
    let raw_orchard = hex::decode(&acc.orchard_raw_address_hex).unwrap();
    let mut raw_arr = [0u8; 43];
    raw_arr.copy_from_slice(&raw_orchard);

    // Create a pure Orchard Unified Address (no transparent receiver!)
    let pure_ua = encode_unified_address("testnet", None, Some(&raw_arr)).unwrap();
    let decoded = decode_unified_address(&pure_ua).unwrap();
    assert!(decoded.p2pkh.is_none(), "Must have no transparent receiver");
    assert!(decoded.orchard.is_some(), "Must have Orchard receiver");

    let fee = 10_000u64;
    let expected_payout = 240_000u64;

    // Build shielding transaction directly
    let tx = build_v5_shielding_transaction(
        priv_hex,
        &utxos,
        &pure_ua,
        expected_payout,
        Some("VeilX Direct Shielding Integration"),
        4500000,
        MAINNET_NU5_BRANCH_ID,
        None,
    )
    .expect("Shielding transaction build must succeed");

    assert_eq!(tx.txid.len(), 64);
    assert_eq!(tx.fee_zatoshis, fee);

    let raw = hex::decode(&tx.raw_hex).unwrap();

    // Verify V5 header (0x80000005) and group ID (0x26A7270A)
    assert_eq!(&raw[0..4], &[0x05, 0x00, 0x00, 0x80]);
    assert_eq!(&raw[4..8], &[0x0A, 0x27, 0xA7, 0x26]);

    // Inspect components to confirm 0 transparent outputs
    let mut offset = 20; // 4*5 header fields
    let n_inputs = raw[offset];
    offset += 1;
    assert_eq!(n_inputs, 1);
    offset += 36; // txid + vout
    let script_len = raw[offset] as usize;
    offset += 1 + script_len + 4; // script + sequence

    let n_outputs = raw[offset];
    offset += 1;
    assert_eq!(n_outputs, 0, "Transparent outputs MUST BE 0!");

    let sapling_spends = raw[offset];
    let sapling_outputs = raw[offset + 1];
    offset += 2;
    assert_eq!(sapling_spends, 0);
    assert_eq!(sapling_outputs, 0);

    let n_actions = raw[offset];
    offset += 1;
    assert_eq!(n_actions, 2, "Must contain at least 2 actions");

    // Skip actions: 2 * 820 = 1640
    offset += 2 * 820;

    let flags = raw[offset];
    offset += 1;
    assert_eq!(flags, 0x02, "Flags must be 0x02");

    let mut val_bytes = [0u8; 8];
    val_bytes.copy_from_slice(&raw[offset..offset + 8]);
    let val_bal = i64::from_le_bytes(val_bytes);
    offset += 8;
    assert_eq!(val_bal, -(expected_payout as i64), "Value balance must equal -payout");

    let anchor = &raw[offset..offset + 32];
    assert_eq!(anchor, &[0u8; 32], "Anchor must be empty tree root");
}

#[test]
fn test_build_and_sign_v5_routes_pure_orchard() {
    let priv_hex = "1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a";
    let utxos = vec![UtxoInput {
        txid: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899".to_string(),
        vout: 1,
        amount_zatoshis: 100_000,
    }];

    let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let acc = veilx_wallet::orchard_wallet::derive_orchard_account(mnemonic, 0, "mainnet").unwrap();
    let raw_orchard = hex::decode(&acc.orchard_raw_address_hex).unwrap();
    let mut raw_arr = [0u8; 43];
    raw_arr.copy_from_slice(&raw_orchard);

    let pure_ua = encode_unified_address("mainnet", None, Some(&raw_arr)).unwrap();

    // build_and_sign_v5_transaction should automatically route pure Orchard UA to shielding transaction
    let tx = build_and_sign_v5_transaction(
        priv_hex,
        &utxos,
        &pure_ua,
        90_000,
        2800000,
        MAINNET_NU5_BRANCH_ID,
        None,
    )
    .expect("Must route pure UA without throwing missing transparent receiver error");

    assert_eq!(tx.txid.len(), 64);
    assert_eq!(tx.fee_zatoshis, 10_000);

    let raw = hex::decode(&tx.raw_hex).unwrap();
    // Verify nOutputs is 0
    let mut offset = 20 + 1 + 36;
    let script_len = raw[offset] as usize;
    offset += 1 + script_len + 4;
    assert_eq!(raw[offset], 0, "Must have 0 transparent outputs");
}

#[test]
fn test_pczt_shielding_prover_and_finalize_flow() {
    let priv_hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    // Deterministic escrow address derivation from priv_hex
    let signing_key = k256::ecdsa::SigningKey::from_slice(&hex::decode(priv_hex).unwrap()).unwrap();
    let pubkey_bytes = signing_key.verifying_key().to_sec1_bytes();
    let h160: [u8; 20] = {
        use sha2::{Digest, Sha256};
        let s = Sha256::digest(&pubkey_bytes);
        let mut h = [0u8; 20];
        h.copy_from_slice(&ripemd::Ripemd160::digest(&s));
        h
    };
    let escrow_script = veilx_wallet::transaction::p2pkh_script(&h160);
    let escrow_addr = bs58::encode({
        let mut b = vec![0x1d, 0x25]; // Testnet t2 prefix or testnet p2pkh
        b.extend_from_slice(&h160);
        b
    }).with_check().into_string();

    let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let acc = veilx_wallet::orchard_wallet::derive_orchard_account(mnemonic, 0, "testnet").unwrap();

    let params = ShieldingPcztParams {
        item_type: "tip".to_string(),
        item_id: "tip_integration_test_123".to_string(),
        transparent_utxo: TransparentUtxoInfo {
            txid: "554433221100aabbccddeeff554433221100aabbccddeeff554433221100aabb".to_string(),
            vout: 0,
            amount_zats: 200_000,
            script_pubkey_hex: hex::encode(&escrow_script),
            escrow_address: escrow_addr,
        },
        payout_value_zats: 190_000,
        fee_zats: 10_000,
        recipient_raw_orchard_hex: acc.orchard_raw_address_hex.clone(),
        memo_hex: hex::encode(b"VeilX PCZT Worker Proving Flow"),
        expiry_height: 4400000,
        network: "testnet".to_string(),
        consensus_branch_id: Some(TESTNET_IRONWOOD_BRANCH_ID),
        anchor_hex: None,
    };

    // 1. Client proves shielding parameters in Web Worker
    let prover_output = prove_shielding_pczt_native(&params).expect("Client proving must succeed");

    assert_eq!(prover_output.msg_type, "SUCCESS");
    let bundle = &prover_output.orchard_action_bundle;
    assert_eq!(bundle.flags, 1);
    assert_eq!(bundle.value_balance_zats, -190_000);
    assert_eq!(bundle.anchor_hex, EMPTY_TREE_ANCHOR_HEX);
    assert_eq!(bundle.actions.len(), 2);
    assert!(!bundle.proof_hex.is_empty());
    assert!(!bundle.binding_sig_hex.is_empty());

    // 2. Server finalizes shielding transaction
    let final_res = finalize_shielding_transaction_native(&params, bundle, priv_hex)
        .expect("Server finalization must succeed");

    assert_eq!(final_res.status, "SETTLED");
    assert_eq!(final_res.txid_hex.len(), 64);
    assert_eq!(final_res.fee_zatoshis, 10_000);
    assert_eq!(final_res.payout_zatoshis, 190_000);

    let raw_tx = hex::decode(&final_res.raw_tx_hex).unwrap();
    assert_eq!(&raw_tx[0..4], &[0x05, 0x00, 0x00, 0x80]); // V5 header
}
