//! Shielded PCZT & Halo 2 Prover Module for Client-Side Proving
//!
//! Implements client-side Halo 2 proof generation for genuine t -> z shielding transactions,
//! precomputes ZIP-244 digests, and finalizes signed Version 5 transactions.

use blake2b_simd::Params as Blake2bParams;
use k256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
use orchard::{
    builder::{Builder, BundleType},
    bundle::{BundleVersion, Flags, TxVersion},
    tree::Anchor,
    value::NoteValue,
    Address,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

use crate::orchard_builder::{
    build_and_prove_shielding_bundle, serialize_v5_orchard_bundle, write_compact_size,
    ShieldingOrchardBundle, EMPTY_TREE_ANCHOR_HEX,
};
use crate::transaction::{
    p2pkh_script, MAINNET_NU5_BRANCH_ID, TESTNET_IRONWOOD_BRANCH_ID,
    TX_VERSION_5_HEADER, VERSION_GROUP_ID_V5,
};

fn blake2b_personal(personal: &[u8], data: &[u8]) -> [u8; 32] {
    let mut params = Blake2bParams::new();
    params.hash_length(32);
    params.personal(personal);
    let hash = params.hash(data);
    let mut out = [0u8; 32];
    out.copy_from_slice(hash.as_bytes());
    out
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TransparentUtxoInfo {
    pub txid: String,
    pub vout: u32,
    #[serde(rename = "amountZats")]
    pub amount_zats: u64,
    #[serde(rename = "scriptPubKeyHex", default)]
    pub script_pubkey_hex: String,
    #[serde(rename = "escrowAddress", default)]
    pub escrow_address: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShieldingPcztParams {
    #[serde(rename = "itemType", default)]
    pub item_type: String,
    #[serde(rename = "itemId", default)]
    pub item_id: String,
    #[serde(rename = "transparentUtxo")]
    pub transparent_utxo: TransparentUtxoInfo,
    #[serde(rename = "payoutValueZats")]
    pub payout_value_zats: u64,
    #[serde(rename = "feeZats")]
    pub fee_zats: u64,
    #[serde(rename = "recipientRawOrchardHex")]
    pub recipient_raw_orchard_hex: String,
    #[serde(rename = "memoHex", default)]
    pub memo_hex: String,
    #[serde(rename = "expiryHeight")]
    pub expiry_height: u32,
    #[serde(rename = "network", default)]
    pub network: String,
    #[serde(rename = "consensusBranchId")]
    pub consensus_branch_id: Option<u32>,
    #[serde(rename = "anchorHex", default)]
    pub anchor_hex: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProverWorkerSuccessOutput {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(rename = "orchardActionBundle")]
    pub orchard_action_bundle: ShieldingOrchardBundle,
    #[serde(rename = "pcztSignedHex", default)]
    pub pczt_signed_hex: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ShieldingFinalizeResult {
    pub raw_tx_hex: String,
    pub txid_hex: String,
    pub fee_zatoshis: u64,
    pub payout_zatoshis: u64,
    pub status: String,
}

/// Helper function to parse recipient Orchard address from hex or unified address.
pub fn parse_recipient_orchard_bytes(addr_str: &str) -> Result<[u8; 43], String> {
    if addr_str.starts_with('u') {
        let receivers = crate::unified_address::decode_unified_address(addr_str)?;
        let orchard_bytes = receivers
            .orchard
            .ok_or_else(|| "Recipient Unified Address contains no Orchard receiver".to_string())?;
        Ok(orchard_bytes)
    } else {
        let raw = hex::decode(addr_str)
            .map_err(|e| format!("Invalid recipient hex string: {}", e))?;
        if raw.len() != 43 {
            return Err(format!(
                "Recipient Orchard address must be exactly 43 bytes (86 hex chars), got {} bytes",
                raw.len()
            ));
        }
        let mut arr = [0u8; 43];
        arr.copy_from_slice(&raw);
        Ok(arr)
    }
}

/// Resolves consensus branch ID based on network or explicit parameter.
pub fn resolve_consensus_branch_id(network: &str, explicit_branch: Option<u32>) -> u32 {
    if let Some(id) = explicit_branch {
        return id;
    }
    match network.to_lowercase().as_str() {
        "mainnet" => MAINNET_NU5_BRANCH_ID,
        _ => TESTNET_IRONWOOD_BRANCH_ID,
    }
}

/// Precomputes ZIP-244 digests and sighashes for a shielding transaction.
pub fn precompute_shielding_digests(
    utxo: &TransparentUtxoInfo,
    script_pubkey: &[u8],
    expiry_height: u32,
    consensus_branch_id: u32,
    orchard_bundle_commitment: &[u8; 32],
) -> Result<([u8; 32], [u8; 32], [u8; 32]), String> {
    let lock_time = 0u32;

    // 1. Header Digest: BLAKE2b-256("ZTxIdHeadersHash", header || version_group || branch_id || lock_time || expiry)
    let mut header_data = Vec::with_capacity(20);
    header_data.extend_from_slice(&TX_VERSION_5_HEADER);
    header_data.extend_from_slice(&VERSION_GROUP_ID_V5);
    header_data.extend_from_slice(&consensus_branch_id.to_le_bytes());
    header_data.extend_from_slice(&lock_time.to_le_bytes());
    header_data.extend_from_slice(&expiry_height.to_le_bytes());
    let header_digest = blake2b_personal(b"ZTxIdHeadersHash", &header_data);

    // 2. Transparent Prevouts & Sequences (1 input)
    let mut txid_bytes = hex::decode(&utxo.txid)
        .map_err(|e| format!("Invalid UTXO txid hex: {}", e))?;
    if txid_bytes.len() != 32 {
        return Err("UTXO txid must be 32 bytes".to_string());
    }
    txid_bytes.reverse(); // Wire format is little-endian

    let mut prevouts_data = Vec::with_capacity(36);
    prevouts_data.extend_from_slice(&txid_bytes);
    prevouts_data.extend_from_slice(&utxo.vout.to_le_bytes());
    let prevouts_digest = blake2b_personal(b"ZTxIdPrevoutHash", &prevouts_data);

    let sequences_digest = blake2b_personal(b"ZTxIdSequencHash", &0xFFFF_FFFFu32.to_le_bytes());

    // 3. Transparent Outputs: EXACTLY 0 (Shielding Invariant: zero transparent outputs)
    let outputs_digest = blake2b_personal(b"ZTxIdOutputsHash", &[]);

    // 4. Transparent TxID digest: prevouts || sequences || outputs
    let mut trans_txid_data = Vec::with_capacity(96);
    trans_txid_data.extend_from_slice(&prevouts_digest);
    trans_txid_data.extend_from_slice(&sequences_digest);
    trans_txid_data.extend_from_slice(&outputs_digest);
    let transparent_txid_digest = blake2b_personal(b"ZTxIdTranspaHash", &trans_txid_data);

    let sapling_digest = blake2b_personal(b"ZTxIdSaplingHash", &[]);
    let orchard_digest = *orchard_bundle_commitment;

    // 5. TxID computation
    let mut tx_personal = [0u8; 16];
    tx_personal[0..12].copy_from_slice(b"ZcashTxHash_");
    tx_personal[12..16].copy_from_slice(&consensus_branch_id.to_le_bytes());

    let mut txid_input = Vec::with_capacity(128);
    txid_input.extend_from_slice(&header_digest);
    txid_input.extend_from_slice(&transparent_txid_digest);
    txid_input.extend_from_slice(&sapling_digest);
    txid_input.extend_from_slice(&orchard_digest);
    let raw_txid = blake2b_personal(&tx_personal, &txid_input);

    // 6. Precompute Transparent Signature Digest (ZIP-244 Section S.2)
    let amounts_sig_digest = blake2b_personal(
        b"ZTxTrAmountsHash",
        &(utxo.amount_zats as i64).to_le_bytes(),
    );

    let mut scripts_data = Vec::new();
    scripts_data.extend_from_slice(&write_compact_size(script_pubkey.len()));
    scripts_data.extend_from_slice(script_pubkey);
    let scriptpubkeys_sig_digest = blake2b_personal(b"ZTxTrScriptsHash", &scripts_data);

    // S.2g: txin_sig_digest for the transparent input
    let mut txin_data = Vec::new();
    txin_data.extend_from_slice(&txid_bytes);
    txin_data.extend_from_slice(&utxo.vout.to_le_bytes());
    txin_data.extend_from_slice(&(utxo.amount_zats as i64).to_le_bytes());
    txin_data.extend_from_slice(&write_compact_size(script_pubkey.len()));
    txin_data.extend_from_slice(script_pubkey);
    txin_data.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    let txin_sig_digest = blake2b_personal(b"Zcash___TxInHash", &txin_data);

    // Transparent sig digest for transparent input
    let mut trans_sig_data = Vec::with_capacity(1 + 32 * 6);
    trans_sig_data.push(0x01u8); // SIGHASH_ALL
    trans_sig_data.extend_from_slice(&prevouts_digest);
    trans_sig_data.extend_from_slice(&amounts_sig_digest);
    trans_sig_data.extend_from_slice(&scriptpubkeys_sig_digest);
    trans_sig_data.extend_from_slice(&sequences_digest);
    trans_sig_data.extend_from_slice(&outputs_digest);
    trans_sig_data.extend_from_slice(&txin_sig_digest);
    let transparent_sig_digest = blake2b_personal(b"ZTxIdTranspaHash", &trans_sig_data);

    let mut sighash_transparent_preimage = Vec::with_capacity(128);
    sighash_transparent_preimage.extend_from_slice(&header_digest);
    sighash_transparent_preimage.extend_from_slice(&transparent_sig_digest);
    sighash_transparent_preimage.extend_from_slice(&sapling_digest);
    sighash_transparent_preimage.extend_from_slice(&orchard_digest);
    let sighash_transparent = blake2b_personal(&tx_personal, &sighash_transparent_preimage);

    // Transparent sig digest for shielded binding signature (txin_sig_digest is empty hash)
    let empty_txin_sig_digest = blake2b_personal(b"Zcash___TxInHash", &[]);
    let mut shielded_trans_sig_data = Vec::with_capacity(1 + 32 * 6);
    shielded_trans_sig_data.push(0x01u8); // SIGHASH_ALL
    shielded_trans_sig_data.extend_from_slice(&prevouts_digest);
    shielded_trans_sig_data.extend_from_slice(&amounts_sig_digest);
    shielded_trans_sig_data.extend_from_slice(&scriptpubkeys_sig_digest);
    shielded_trans_sig_data.extend_from_slice(&sequences_digest);
    shielded_trans_sig_data.extend_from_slice(&outputs_digest);
    shielded_trans_sig_data.extend_from_slice(&empty_txin_sig_digest);
    let shielded_trans_sig_digest = blake2b_personal(b"ZTxIdTranspaHash", &shielded_trans_sig_data);

    let mut sighash_shielded_preimage = Vec::with_capacity(128);
    sighash_shielded_preimage.extend_from_slice(&header_digest);
    sighash_shielded_preimage.extend_from_slice(&shielded_trans_sig_digest);
    sighash_shielded_preimage.extend_from_slice(&sapling_digest);
    sighash_shielded_preimage.extend_from_slice(&orchard_digest);
    let sighash_shielded = blake2b_personal(&tx_personal, &sighash_shielded_preimage);

    Ok((sighash_transparent, sighash_shielded, raw_txid))
}

/// Step 1: Pre-warm prover in Web Worker
#[wasm_bindgen]
pub fn prewarm_shielding_prover() -> bool {
    let _ = &*crate::orchard_builder::V5_PROVING_KEY;
    true
}

/// Native implementation of client-side Halo 2 Zero-Knowledge Prover for shielding transactions.
pub fn prove_shielding_pczt_native(params: &ShieldingPcztParams) -> Result<ProverWorkerSuccessOutput, String> {
    let recip_bytes = parse_recipient_orchard_bytes(&params.recipient_raw_orchard_hex)?;
    let branch_id = resolve_consensus_branch_id(&params.network, params.consensus_branch_id);

    let memo_bytes = if !params.memo_hex.is_empty() {
        hex::decode(&params.memo_hex).ok()
    } else {
        None
    };

    // Calculate scriptPubKey
    let script_pubkey = if !params.transparent_utxo.script_pubkey_hex.is_empty() {
        hex::decode(&params.transparent_utxo.script_pubkey_hex)
            .map_err(|e| format!("Invalid scriptPubKeyHex: {}", e))?
    } else if !params.transparent_utxo.escrow_address.is_empty() {
        let h160 = crate::transaction::decode_transparent_p2pkh(&params.transparent_utxo.escrow_address)?;
        p2pkh_script(&h160)
    } else {
        return Err("Missing scriptPubKeyHex or escrowAddress in transparentUtxo".to_string());
    };

    // Construct unproven bundle to extract canonical V5 bundle commitment
    let anchor = Anchor::empty_tree();
    let bundle_version = BundleVersion::orchard_v2();
    let flags = Flags::SPENDS_DISABLED;
    let mut builder = Builder::new(BundleType::DEFAULT, bundle_version, flags, anchor)
        .map_err(|e| format!("Builder init failed: {:?}", e))?;

    let mut memo = [0u8; 512];
    if let Some(ref m) = memo_bytes {
        let len = m.len().min(512);
        memo[..len].copy_from_slice(&m[..len]);
    }

    let note_val = NoteValue::from_raw(params.payout_value_zats);
    let recipient_addr = Address::from_raw_address_bytes(&recip_bytes)
        .into_option()
        .ok_or_else(|| "Invalid recipient address".to_string())?;

    builder
        .add_output(None, recipient_addr, note_val, memo)
        .map_err(|e| format!("Add output failed: {:?}", e))?;

    let mut rng = rand::rng();
    let (unauth_bundle, _meta) = builder
        .build::<i64>(&mut rng)
        .map_err(|e| format!("Build unauthorized failed: {:?}", e))?
        .ok_or_else(|| "Bundle was empty".to_string())?;

    let bundle_commitment: [u8; 32] = unauth_bundle
        .commitment(TxVersion::V5)
        .map_err(|e| format!("Bundle commitment error: {:?}", e))?
        .into();

    let (_sighash_trans, sighash_shielded, _raw_txid) = precompute_shielding_digests(
        &params.transparent_utxo,
        &script_pubkey,
        params.expiry_height,
        branch_id,
        &bundle_commitment,
    )?;

    let is_ironwood = branch_id == TESTNET_IRONWOOD_BRANCH_ID;
    let (bundle, _comm) = build_and_prove_shielding_bundle(
        &recip_bytes,
        params.payout_value_zats,
        memo_bytes.as_deref(),
        &sighash_shielded,
        params.anchor_hex.as_deref(),
        is_ironwood,
    )?;

    Ok(ProverWorkerSuccessOutput {
        msg_type: "SUCCESS".to_string(),
        orchard_action_bundle: bundle,
        pczt_signed_hex: "".to_string(),
    })
}

/// Step 2: Client-side Halo 2 Zero-Knowledge Prover for shielding transactions.
/// Runs inside Dedicated Web Worker (`pczt-prover.worker.js`).
#[wasm_bindgen]
pub fn prove_shielding_pczt(params_val: JsValue) -> Result<JsValue, JsValue> {
    let params: ShieldingPcztParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid ShieldingPcztParams: {}", e)))?;

    let output = prove_shielding_pczt_native(&params).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&output).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Native implementation of server transaction finalization.
pub fn finalize_shielding_transaction_native(
    params: &ShieldingPcztParams,
    bundle: &ShieldingOrchardBundle,
    escrow_private_key_hex: &str,
) -> Result<ShieldingFinalizeResult, String> {
    // Anti-tamper invariant checks
    if bundle.actions.len() < 2 {
        return Err("Invalid bundle: minimum 2 actions required".to_string());
    }
    if bundle.flags != 0x02 && bundle.flags != 0x01 {
        return Err("Invalid bundle: outputs must be enabled (flags must have bit 1 set: 0x02)".to_string());
    }
    if bundle.value_balance_zats != -(params.payout_value_zats as i64) {
        return Err(format!(
            "Value balance tampering detected: expected {}, got {}",
            -(params.payout_value_zats as i64),
            bundle.value_balance_zats
        ));
    }
    if bundle.anchor_hex != EMPTY_TREE_ANCHOR_HEX {
        return Err("Invalid anchor: must be empty tree root".to_string());
    }

    // Derive transparent key and scriptPubKey
    let priv_bytes = hex::decode(escrow_private_key_hex)
        .map_err(|e| format!("Invalid private key hex: {}", e))?;
    let signing_key = SigningKey::from_slice(&priv_bytes)
        .map_err(|e| format!("Invalid signing key: {}", e))?;
    let pubkey_bytes = signing_key.verifying_key().to_sec1_bytes();

    let my_hash160: [u8; 20] = {
        let s = Sha256::digest(&pubkey_bytes);
        let mut h = [0u8; 20];
        h.copy_from_slice(&ripemd::Ripemd160::digest(&s));
        h
    };
    let script_pubkey = p2pkh_script(&my_hash160);

    let branch_id = resolve_consensus_branch_id(&params.network, params.consensus_branch_id);

    // Compute bundle commitment from client bundle actions
    let recip_bytes = parse_recipient_orchard_bytes(&params.recipient_raw_orchard_hex)?;
    let anchor = Anchor::empty_tree();
    let bundle_version = BundleVersion::orchard_v2();
    let flags = Flags::SPENDS_DISABLED;
    let mut builder = Builder::new(BundleType::DEFAULT, bundle_version, flags, anchor)
        .map_err(|e| format!("Builder init failed: {:?}", e))?;

    let memo_bytes = if !params.memo_hex.is_empty() {
        hex::decode(&params.memo_hex).ok()
    } else {
        None
    };
    let mut memo = [0u8; 512];
    if let Some(ref m) = memo_bytes {
        let len = m.len().min(512);
        memo[..len].copy_from_slice(&m[..len]);
    }
    let note_val = NoteValue::from_raw(params.payout_value_zats);
    let recipient_addr = Address::from_raw_address_bytes(&recip_bytes)
        .into_option()
        .ok_or_else(|| "Invalid recipient address".to_string())?;

    builder
        .add_output(None, recipient_addr, note_val, memo)
        .map_err(|e| format!("Add output failed: {:?}", e))?;

    let mut rng = rand::rng();
    let (unauth_bundle, _meta) = builder
        .build::<i64>(&mut rng)
        .map_err(|e| format!("Build unauth bundle failed: {:?}", e))?
        .ok_or_else(|| "Bundle empty".to_string())?;

    let bundle_commitment: [u8; 32] = unauth_bundle
        .commitment(TxVersion::V5)
        .map_err(|e| format!("Commitment failed: {:?}", e))?
        .into();

    let (sighash_transparent, _sighash_shielded, raw_txid) = precompute_shielding_digests(
        &params.transparent_utxo,
        &script_pubkey,
        params.expiry_height,
        branch_id,
        &bundle_commitment,
    )?;

    // Sign transparent input with secp256k1 ECDSA
    let signature: Signature = signing_key
        .sign_prehash(&sighash_transparent)
        .map_err(|e| format!("ECDSA signing failed: {}", e))?;
    let low_s_sig = signature.normalize_s().unwrap_or(signature);
    let der = low_s_sig.to_der();

    let mut script_sig = Vec::new();
    script_sig.push((der.as_bytes().len() + 1) as u8); // +1 for SIGHASH_ALL
    script_sig.extend_from_slice(der.as_bytes());
    script_sig.push(0x01); // SIGHASH_ALL
    script_sig.push(pubkey_bytes.len() as u8);
    script_sig.extend_from_slice(&pubkey_bytes);

    // Serialize full Version 5 transaction
    let mut raw = Vec::new();
    raw.extend_from_slice(&TX_VERSION_5_HEADER);
    raw.extend_from_slice(&VERSION_GROUP_ID_V5);
    raw.extend_from_slice(&branch_id.to_le_bytes());
    raw.extend_from_slice(&0u32.to_le_bytes()); // lockTime
    raw.extend_from_slice(&params.expiry_height.to_le_bytes());

    // 1 transparent input
    raw.extend_from_slice(&write_compact_size(1));
    let mut txid_bytes = hex::decode(&params.transparent_utxo.txid)
        .map_err(|e| format!("Invalid txid hex: {}", e))?;
    txid_bytes.reverse();
    raw.extend_from_slice(&txid_bytes);
    raw.extend_from_slice(&params.transparent_utxo.vout.to_le_bytes());
    raw.extend_from_slice(&write_compact_size(script_sig.len()));
    raw.extend_from_slice(&script_sig);
    raw.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());

    // 0 transparent outputs
    raw.extend_from_slice(&write_compact_size(0));
    // 0 sapling spends, 0 sapling outputs
    raw.push(0x00);
    raw.push(0x00);

    // Orchard bundle with canonical 0x02 flag byte (outputs enabled, spends disabled)
    let mut normalized_bundle = bundle.clone();
    normalized_bundle.flags = 0x02;
    let raw_orchard = serialize_v5_orchard_bundle(&normalized_bundle)?;
    raw.extend_from_slice(&raw_orchard);

    let mut display_txid = raw_txid;
    display_txid.reverse();
    let txid_hex = hex::encode(display_txid);

    Ok(ShieldingFinalizeResult {
        raw_tx_hex: hex::encode(raw),
        txid_hex,
        fee_zatoshis: params.fee_zats,
        payout_zatoshis: params.payout_value_zats,
        status: "SETTLED".to_string(),
    })
}

/// Step 3: Server combines client-generated Orchard proof bundle with server-signed transparent input
/// to assemble the complete Version 5 transaction.
#[wasm_bindgen]
pub fn finalize_shielding_transaction(
    params_val: JsValue,
    proof_bundle_val: JsValue,
    escrow_private_key_hex: &str,
) -> Result<JsValue, JsValue> {
    let params: ShieldingPcztParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid ShieldingPcztParams: {}", e)))?;

    let bundle: ShieldingOrchardBundle = serde_wasm_bindgen::from_value(proof_bundle_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid ShieldingOrchardBundle: {}", e)))?;

    let result = finalize_shielding_transaction_native(&params, &bundle, escrow_private_key_hex)
        .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}
