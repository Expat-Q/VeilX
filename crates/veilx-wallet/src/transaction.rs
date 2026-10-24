//! Zcash ZIP-225 Version 5 Transaction Construction & ZIP-244 Sighash

use blake2b_simd::Params as Blake2bParams;
use k256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const TESTNET_IRONWOOD_BRANCH_ID: u32 = 0x37A5165B;
pub const TESTNET_NU7_BRANCH_ID: u32 = 0x77190AD9;
pub const MAINNET_NU5_BRANCH_ID: u32 = 0xC2D6D0B4;

pub const TX_VERSION_5_HEADER: [u8; 4] = [0x05, 0x00, 0x00, 0x80]; // v5 + overwintered
pub const VERSION_GROUP_ID_V5: [u8; 4] = [0x0A, 0x27, 0xA7, 0x26]; // 0x26A7270A LE

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UtxoInput {
    pub txid: String,
    pub vout: u32,
    pub amount_zatoshis: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedTransaction {
    pub txid: String,
    pub raw_hex: String,
    pub branch_id: u32,
    pub fee_zatoshis: u64,
}

fn blake2b_personal(personal: &[u8], data: &[u8]) -> [u8; 32] {
    let mut params = Blake2bParams::new();
    params.hash_length(32);
    params.personal(personal);
    let hash = params.hash(data);
    let mut out = [0u8; 32];
    out.copy_from_slice(hash.as_bytes());
    out
}

pub fn write_compact_size(val: usize) -> Vec<u8> {
    if val < 253 {
        vec![val as u8]
    } else if val <= 0xFFFF {
        let mut b = vec![253];
        b.extend_from_slice(&(val as u16).to_le_bytes());
        b
    } else if val <= 0xFFFF_FFFF {
        let mut b = vec![254];
        b.extend_from_slice(&(val as u32).to_le_bytes());
        b
    } else {
        let mut b = vec![255];
        b.extend_from_slice(&(val as u64).to_le_bytes());
        b
    }
}

/// Decodes base58 transparent address to extract 20-byte hash160.
pub fn decode_transparent_p2pkh(address: &str) -> Result<[u8; 20], String> {
    let decoded = bs58::decode(address)
        .into_vec()
        .map_err(|e| format!("Base58 decode error: {}", e))?;

    if decoded.len() != 26 {
        return Err(format!("Invalid address length: expected 26 bytes, got {}", decoded.len()));
    }

    // Verify double-SHA256 checksum
    let payload = &decoded[0..22];
    let checksum = &decoded[22..26];
    let hash1 = Sha256::digest(payload);
    let hash2 = Sha256::digest(&hash1);
    if &hash2[0..4] != checksum {
        return Err("Address checksum verification failed.".to_string());
    }

    let mut hash160 = [0u8; 20];
    hash160.copy_from_slice(&decoded[2..22]);
    Ok(hash160)
}

/// Constructs a standard P2PKH scriptPubKey: OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
pub fn p2pkh_script(hash160: &[u8; 20]) -> Vec<u8> {
    let mut script = Vec::with_capacity(25);
    script.push(0x76); // OP_DUP
    script.push(0xa9); // OP_HASH160
    script.push(0x14); // PUSH 20 bytes
    script.extend_from_slice(hash160);
    script.push(0x88); // OP_EQUALVERIFY
    script.push(0xac); // OP_CHECKSIG
    script
}

/// Builds and signs a complete Zcash Version 5 shielding transaction ($t \to z$) under ZIP-225.
///
/// Disburses payment from a transparent escrow UTXO to a shielded Orchard recipient address:
/// - 1 transparent input spending the deterministic escrow address UTXO, signed via secp256k1 ECDSA.
/// - EXACTLY 0 transparent outputs (`nOutputs = 0`). Under no circumstances is a transparent recipient output created!
/// - Orchard Action Bundle with at least 2 actions (1 real recipient action + 1 dummy padding action).
/// - flags = 0x01 (spendsDisabled = true, outputsEnabled = true).
/// - valueBalanceOrchard = -payoutZats.
/// - anchorOrchard = [0u8; 32] (Anchor::empty_tree(), never expires!).
/// - RedPallas binding signature over the ZIP-244 sighash.
pub fn build_v5_shielding_transaction(
    private_key_hex: &str,
    utxos: &[UtxoInput],
    to_orchard_address: &str,
    amount_zatoshis: u64,
    memo: Option<&str>,
    current_block_height: u32,
    consensus_branch_id: u32,
) -> Result<SignedTransaction, String> {
    if utxos.is_empty() {
        return Err("No UTXO inputs provided for shielding.".to_string());
    }

    let priv_key_bytes = hex::decode(private_key_hex)
        .map_err(|e| format!("Invalid private key hex: {}", e))?;
    let signing_key = SigningKey::from_slice(&priv_key_bytes)
        .map_err(|e| format!("Invalid signing key: {}", e))?;
    let pubkey_bytes = signing_key.verifying_key().to_sec1_bytes();

    let my_hash160: [u8; 20] = {
        let s = Sha256::digest(&pubkey_bytes);
        let mut h = [0u8; 20];
        h.copy_from_slice(&ripemd::Ripemd160::digest(&s));
        h
    };
    let my_script = p2pkh_script(&my_hash160);

    // Extract raw 43-byte Orchard address from pure UA, raw hex, or UA
    let recipient_bytes = if to_orchard_address.starts_with('u') {
        let ua = crate::unified_address::decode_unified_address(to_orchard_address)?;
        ua.orchard.ok_or_else(|| "Recipient Unified Address does not contain an Orchard receiver".to_string())?
    } else {
        let raw = hex::decode(to_orchard_address)
            .map_err(|e| format!("Invalid recipient Orchard hex: {}", e))?;
        if raw.len() != 43 {
            return Err(format!("Expected 43-byte Orchard address, got {} bytes", raw.len()));
        }
        let mut arr = [0u8; 43];
        arr.copy_from_slice(&raw);
        arr
    };

    let total_in: u64 = utxos.iter().map(|u| u.amount_zatoshis).sum();
    // Standard ZIP-317 fee: 1 transparent input + 2 Orchard actions = 10,000 zats
    let fee = 10_000u64;

    if total_in <= fee {
        return Err(format!("Insufficient input {} to cover fee {}", total_in, fee));
    }

    // Pure shielding invariant: zero transparent outputs. All net funds (total_in - fee)
    // are shielded into the Orchard pool for the recipient.
    let payout_zats = if amount_zatoshis > 0 && amount_zatoshis == total_in - fee {
        amount_zatoshis
    } else {
        total_in - fee
    };

    let expiry_height = current_block_height + 50;
    let lock_time = 0u32;

    // 1. Header Digest: BLAKE2b-256("ZTxIdHeadersHash", header || version_group || branch_id || lock_time || expiry)
    let mut header_data = Vec::with_capacity(20);
    header_data.extend_from_slice(&TX_VERSION_5_HEADER);
    header_data.extend_from_slice(&VERSION_GROUP_ID_V5);
    header_data.extend_from_slice(&consensus_branch_id.to_le_bytes());
    header_data.extend_from_slice(&lock_time.to_le_bytes());
    header_data.extend_from_slice(&expiry_height.to_le_bytes());
    let header_digest = blake2b_personal(b"ZTxIdHeadersHash", &header_data);

    // 2. Transparent Prevouts & Sequences
    let mut prevouts_data = Vec::with_capacity(utxos.len() * 36);
    let mut sequences_data = Vec::with_capacity(utxos.len() * 4);
    for u in utxos {
        let mut txid_bytes = hex::decode(&u.txid)
            .map_err(|e| format!("Invalid UTXO txid hex: {}", e))?;
        txid_bytes.reverse();
        prevouts_data.extend_from_slice(&txid_bytes);
        prevouts_data.extend_from_slice(&u.vout.to_le_bytes());
        sequences_data.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    }
    let prevouts_digest = blake2b_personal(b"ZTxIdPrevoutHash", &prevouts_data);
    let sequences_digest = blake2b_personal(b"ZTxIdSequencHash", &sequences_data);

    // 3. Transparent Outputs: EXACTLY 0 (Shielding Invariant: nOutputs = 0)
    let outputs_digest = blake2b_personal(b"ZTxIdOutputsHash", &[]);

    // 4. Transparent TxID digest: prevouts || sequences || outputs
    let mut trans_data = Vec::with_capacity(96);
    trans_data.extend_from_slice(&prevouts_digest);
    trans_data.extend_from_slice(&sequences_digest);
    trans_data.extend_from_slice(&outputs_digest);
    let transparent_txid_digest = blake2b_personal(b"ZTxIdTranspaHash", &trans_data);

    let sapling_digest = blake2b_personal(b"ZTxIdSaplingHash", &[]);

    // 5. Precompute Orchard Bundle and Commitment
    let anchor = orchard::tree::Anchor::empty_tree();
    let bundle_version = orchard::bundle::BundleVersion::orchard_v2();
    let flags = orchard::bundle::Flags::SPENDS_DISABLED;
    let mut builder = orchard::builder::Builder::new(
        orchard::builder::BundleType::DEFAULT,
        bundle_version,
        flags,
        anchor,
    )
    .map_err(|e| format!("Orchard builder init failed: {:?}", e))?;

    let mut memo_arr = [0u8; 512];
    if let Some(m) = memo {
        let b = m.as_bytes();
        let len = b.len().min(512);
        memo_arr[..len].copy_from_slice(&b[..len]);
    }

    let note_val = orchard::value::NoteValue::from_raw(payout_zats);
    let recip_addr = orchard::Address::from_raw_address_bytes(&recipient_bytes)
        .into_option()
        .ok_or_else(|| "Invalid recipient Address".to_string())?;

    builder
        .add_output(None, recip_addr, note_val, memo_arr)
        .map_err(|e| format!("Failed to add Orchard output: {:?}", e))?;

    let mut rng = rand::rng();
    let (unauth_bundle, _meta) = builder
        .build::<i64>(&mut rng)
        .map_err(|e| format!("Failed to build unauthorized bundle: {:?}", e))?
        .ok_or_else(|| "Bundle was empty".to_string())?;

    let orchard_bundle_commitment: [u8; 32] = unauth_bundle
        .commitment(orchard::bundle::TxVersion::V5)
        .map_err(|e| format!("Commitment error: {:?}", e))?
        .into();

    let orchard_digest = orchard_bundle_commitment;

    // 6. Precompute ZIP-244 S.2 digests for transparent inputs & shielded binding sig
    let mut amounts_data = Vec::with_capacity(utxos.len() * 8);
    let mut scripts_data = Vec::new();
    for u in utxos {
        amounts_data.extend_from_slice(&(u.amount_zatoshis as i64).to_le_bytes());
        scripts_data.extend_from_slice(&write_compact_size(my_script.len()));
        scripts_data.extend_from_slice(&my_script);
    }
    let amounts_sig_digest = blake2b_personal(b"ZTxTrAmountsHash", &amounts_data);
    let scriptpubkeys_sig_digest = blake2b_personal(b"ZTxTrScriptsHash", &scripts_data);

    let mut tx_personal = [0u8; 16];
    tx_personal[0..12].copy_from_slice(b"ZcashTxHash_");
    tx_personal[12..16].copy_from_slice(&consensus_branch_id.to_le_bytes());

    // Compute shielded sighash for Orchard binding signature
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

    // 7. Prove and authorize Orchard Action Bundle
    let (orchard_bundle, _) = crate::orchard_builder::build_and_prove_shielding_bundle(
        &recipient_bytes,
        payout_zats,
        memo.map(|s| s.as_bytes()),
        &sighash_shielded,
    )?;

    // 8. Sign each transparent input under ZIP-244 S.2
    let mut script_sigs = Vec::with_capacity(utxos.len());
    for u in utxos {
        let mut txid_bytes = hex::decode(&u.txid).unwrap();
        txid_bytes.reverse();

        let mut txin_data = Vec::new();
        txin_data.extend_from_slice(&txid_bytes);
        txin_data.extend_from_slice(&u.vout.to_le_bytes());
        txin_data.extend_from_slice(&(u.amount_zatoshis as i64).to_le_bytes());
        txin_data.extend_from_slice(&write_compact_size(my_script.len()));
        txin_data.extend_from_slice(&my_script);
        txin_data.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        let txin_sig_digest = blake2b_personal(b"Zcash___TxInHash", &txin_data);

        let mut transparent_sig_data = Vec::with_capacity(1 + 32 * 6);
        transparent_sig_data.push(0x01u8); // SIGHASH_ALL
        transparent_sig_data.extend_from_slice(&prevouts_digest);
        transparent_sig_data.extend_from_slice(&amounts_sig_digest);
        transparent_sig_data.extend_from_slice(&scriptpubkeys_sig_digest);
        transparent_sig_data.extend_from_slice(&sequences_digest);
        transparent_sig_data.extend_from_slice(&outputs_digest);
        transparent_sig_data.extend_from_slice(&txin_sig_digest);
        let transparent_sig_digest = blake2b_personal(b"ZTxIdTranspaHash", &transparent_sig_data);

        let mut sighash_preimage = Vec::with_capacity(128);
        sighash_preimage.extend_from_slice(&header_digest);
        sighash_preimage.extend_from_slice(&transparent_sig_digest);
        sighash_preimage.extend_from_slice(&sapling_digest);
        sighash_preimage.extend_from_slice(&orchard_digest);
        let sighash = blake2b_personal(&tx_personal, &sighash_preimage);

        let signature: Signature = signing_key.sign_prehash(&sighash)
            .map_err(|e| format!("ECDSA signing failed: {}", e))?;
        let low_s_sig = signature.normalize_s().unwrap_or(signature);
        let der = low_s_sig.to_der();

        let mut script_sig = Vec::new();
        script_sig.push((der.as_bytes().len() + 1) as u8);
        script_sig.extend_from_slice(der.as_bytes());
        script_sig.push(0x01); // SIGHASH_ALL
        script_sig.push(pubkey_bytes.len() as u8);
        script_sig.extend_from_slice(&pubkey_bytes);
        script_sigs.push(script_sig);
    }

    // 9. Compute TxID
    let mut txid_input = Vec::with_capacity(128);
    txid_input.extend_from_slice(&header_digest);
    txid_input.extend_from_slice(&transparent_txid_digest);
    txid_input.extend_from_slice(&sapling_digest);
    txid_input.extend_from_slice(&orchard_digest);
    let raw_txid_digest = blake2b_personal(&tx_personal, &txid_input);

    let mut display_txid_bytes = raw_txid_digest;
    display_txid_bytes.reverse();
    let txid_hex = hex::encode(display_txid_bytes);

    // 10. Serialize Full Version 5 Shielding Transaction
    let mut raw = Vec::new();
    raw.extend_from_slice(&TX_VERSION_5_HEADER);
    raw.extend_from_slice(&VERSION_GROUP_ID_V5);
    raw.extend_from_slice(&consensus_branch_id.to_le_bytes());
    raw.extend_from_slice(&lock_time.to_le_bytes());
    raw.extend_from_slice(&expiry_height.to_le_bytes());

    // Transparent inputs
    raw.extend_from_slice(&write_compact_size(utxos.len()));
    for (i, u) in utxos.iter().enumerate() {
        let mut txid_bytes = hex::decode(&u.txid).unwrap();
        txid_bytes.reverse();
        raw.extend_from_slice(&txid_bytes);
        raw.extend_from_slice(&u.vout.to_le_bytes());
        raw.extend_from_slice(&write_compact_size(script_sigs[i].len()));
        raw.extend_from_slice(&script_sigs[i]);
        raw.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    }

    // Transparent outputs: EXACTLY 0 (ZIP-225 Shielding invariant: nOutputs = 0)
    raw.extend_from_slice(&write_compact_size(0));

    // Sapling bundle: 0 spends, 0 outputs
    raw.push(0x00);
    raw.push(0x00);

    // Orchard bundle
    let raw_orchard = crate::orchard_builder::serialize_v5_orchard_bundle(&orchard_bundle)?;
    raw.extend_from_slice(&raw_orchard);

    Ok(SignedTransaction {
        txid: txid_hex,
        raw_hex: hex::encode(raw),
        branch_id: consensus_branch_id,
        fee_zatoshis: fee,
    })
}

/// Builds and signs a complete Zcash Version 5 transaction.
///
/// If `to_address` is a shielded Orchard address (Unified Address with Orchard receiver,
/// or raw 43-byte hex address), it automatically routes to `build_v5_shielding_transaction`
/// creating a genuine shielded transaction with 0 transparent outputs.
///
/// If `to_address` is a legacy transparent P2PKH address, it constructs a transparent transaction.
pub fn build_and_sign_v5_transaction(
    private_key_hex: &str,
    utxos: &[UtxoInput],
    to_address: &str,
    amount_zatoshis: u64,
    current_block_height: u32,
    consensus_branch_id: u32,
) -> Result<SignedTransaction, String> {
    if utxos.is_empty() {
        return Err("No UTXO inputs provided.".to_string());
    }

    // Check if recipient is a shielded Orchard address (pure UA or raw 43-byte hex)
    let is_orchard = if to_address.starts_with('u') {
        if let Ok(ua) = crate::unified_address::decode_unified_address(to_address) {
            ua.orchard.is_some()
        } else {
            false
        }
    } else if to_address.len() == 86 && hex::decode(to_address).map(|b| b.len() == 43).unwrap_or(false) {
        true
    } else {
        false
    };

    if is_orchard {
        return build_v5_shielding_transaction(
            private_key_hex,
            utxos,
            to_address,
            amount_zatoshis,
            None,
            current_block_height,
            consensus_branch_id,
        );
    }

    let priv_key_bytes = hex::decode(private_key_hex)
        .map_err(|e| format!("Invalid private key hex: {}", e))?;
    let signing_key = SigningKey::from_slice(&priv_key_bytes)
        .map_err(|e| format!("Invalid signing key: {}", e))?;
    let pubkey_bytes = signing_key.verifying_key().to_sec1_bytes();

    let my_hash160: [u8; 20] = {
        let s = Sha256::digest(&pubkey_bytes);
        let mut h = [0u8; 20];
        h.copy_from_slice(&ripemd::Ripemd160::digest(&s));
        h
    };
    let my_script = p2pkh_script(&my_hash160);

    let to_hash160 = if to_address.starts_with('u') {
        let ua = crate::unified_address::decode_unified_address(to_address)?;
        ua.p2pkh.ok_or_else(|| "Recipient Unified Address does not contain a transparent receiver".to_string())?
    } else {
        decode_transparent_p2pkh(to_address)?
    };
    let to_script = p2pkh_script(&to_hash160);

    let total_in: u64 = utxos.iter().map(|u| u.amount_zatoshis).sum();
    let fee = crate::fees::calculate_zip317_fee(utxos.len(), 2);

    if total_in < amount_zatoshis + fee {
        return Err(format!(
            "Insufficient funds: inputs total {} zats, required {} zats (amount: {}, fee: {})",
            total_in,
            amount_zatoshis + fee,
            amount_zatoshis,
            fee
        ));
    }

    let change_amount = total_in - (amount_zatoshis + fee);
    let expiry_height = current_block_height + 40;
    let lock_time = 0u32;

    // 1. Header Digest: BLAKE2b-256("ZTxIdHeadersHash", header || version_group || branch_id || lock_time || expiry)
    let mut header_data = Vec::with_capacity(20);
    header_data.extend_from_slice(&TX_VERSION_5_HEADER);
    header_data.extend_from_slice(&VERSION_GROUP_ID_V5);
    header_data.extend_from_slice(&consensus_branch_id.to_le_bytes());
    header_data.extend_from_slice(&lock_time.to_le_bytes());
    header_data.extend_from_slice(&expiry_height.to_le_bytes());
    let header_digest = blake2b_personal(b"ZTxIdHeadersHash", &header_data);

    // 2. Transparent Prevouts & Sequences
    let mut prevouts_data = Vec::with_capacity(utxos.len() * 36);
    let mut sequences_data = Vec::with_capacity(utxos.len() * 4);
    for u in utxos {
        let mut txid_bytes = hex::decode(&u.txid)
            .map_err(|e| format!("Invalid UTXO txid hex: {}", e))?;
        txid_bytes.reverse(); // Wire format is little-endian
        prevouts_data.extend_from_slice(&txid_bytes);
        prevouts_data.extend_from_slice(&u.vout.to_le_bytes());
        sequences_data.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    }
    let prevouts_digest = blake2b_personal(b"ZTxIdPrevoutHash", &prevouts_data);
    let sequences_digest = blake2b_personal(b"ZTxIdSequencHash", &sequences_data);

    // 3. Transparent Outputs
    let mut outputs_data = Vec::new();
    // Output 1: Recipient
    outputs_data.extend_from_slice(&amount_zatoshis.to_le_bytes());
    outputs_data.extend_from_slice(&write_compact_size(to_script.len()));
    outputs_data.extend_from_slice(&to_script);

    // Output 2: Change (if > 0)
    let output_count = if change_amount > 0 {
        outputs_data.extend_from_slice(&change_amount.to_le_bytes());
        outputs_data.extend_from_slice(&write_compact_size(my_script.len()));
        outputs_data.extend_from_slice(&my_script);
        2
    } else {
        1
    };
    let outputs_digest = blake2b_personal(b"ZTxIdOutputsHash", &outputs_data);

    // Transparent Digest: prevouts || sequences || outputs
    let mut trans_data = Vec::with_capacity(96);
    trans_data.extend_from_slice(&prevouts_digest);
    trans_data.extend_from_slice(&sequences_digest);
    trans_data.extend_from_slice(&outputs_digest);
    let transparent_digest = blake2b_personal(b"ZTxIdTranspaHash", &trans_data);

    let sapling_digest = blake2b_personal(b"ZTxIdSaplingHash", &[]);
    let orchard_digest = blake2b_personal(b"ZTxIdOrchardHash", &[]);

    // 4. Compute TxID
    let mut tx_personal = [0u8; 16];
    tx_personal[0..12].copy_from_slice(b"ZcashTxHash_");
    tx_personal[12..16].copy_from_slice(&consensus_branch_id.to_le_bytes());

    let mut txid_input = Vec::with_capacity(128);
    txid_input.extend_from_slice(&header_digest);
    txid_input.extend_from_slice(&transparent_digest);
    txid_input.extend_from_slice(&sapling_digest);
    txid_input.extend_from_slice(&orchard_digest);
    let raw_txid_digest = blake2b_personal(&tx_personal, &txid_input);

    let mut display_txid_bytes = raw_txid_digest;
    display_txid_bytes.reverse();
    let txid_hex = hex::encode(display_txid_bytes);

    // 5. Precompute ZIP-244 Section S.2 commitments for transparent signatures
    let mut amounts_data = Vec::with_capacity(utxos.len() * 8);
    let mut scripts_data = Vec::new();
    for u in utxos {
        amounts_data.extend_from_slice(&(u.amount_zatoshis as i64).to_le_bytes());
        scripts_data.extend_from_slice(&write_compact_size(my_script.len()));
        scripts_data.extend_from_slice(&my_script);
    }
    let amounts_sig_digest = blake2b_personal(b"ZTxTrAmountsHash", &amounts_data);
    let scriptpubkeys_sig_digest = blake2b_personal(b"ZTxTrScriptsHash", &scripts_data);

    // 6. Sign each transparent input under ZIP-244 S.2
    let mut script_sigs = Vec::with_capacity(utxos.len());
    for u in utxos.iter() {
        let mut txin_data = Vec::new();
        let mut txid_bytes = hex::decode(&u.txid)
            .map_err(|e| format!("Invalid UTXO txid hex: {}", e))?;
        txid_bytes.reverse();
        txin_data.extend_from_slice(&txid_bytes);
        txin_data.extend_from_slice(&u.vout.to_le_bytes());
        txin_data.extend_from_slice(&(u.amount_zatoshis as i64).to_le_bytes());
        txin_data.extend_from_slice(&write_compact_size(my_script.len()));
        txin_data.extend_from_slice(&my_script);
        txin_data.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());

        let txin_sig_digest = blake2b_personal(b"Zcash___TxInHash", &txin_data);

        let mut transparent_sig_data = Vec::with_capacity(1 + 32 * 6);
        transparent_sig_data.push(0x01u8); // S.2a: SIGHASH_ALL (0x01)
        transparent_sig_data.extend_from_slice(&prevouts_digest);
        transparent_sig_data.extend_from_slice(&amounts_sig_digest);
        transparent_sig_data.extend_from_slice(&scriptpubkeys_sig_digest);
        transparent_sig_data.extend_from_slice(&sequences_digest);
        transparent_sig_data.extend_from_slice(&outputs_digest);
        transparent_sig_data.extend_from_slice(&txin_sig_digest);

        let transparent_sig_digest = blake2b_personal(b"ZTxIdTranspaHash", &transparent_sig_data);

        let mut sighash_preimage = Vec::with_capacity(128);
        sighash_preimage.extend_from_slice(&header_digest);
        sighash_preimage.extend_from_slice(&transparent_sig_digest);
        sighash_preimage.extend_from_slice(&sapling_digest);
        sighash_preimage.extend_from_slice(&orchard_digest);

        let sighash = blake2b_personal(&tx_personal, &sighash_preimage);

        let signature: Signature = signing_key.sign_prehash(&sighash).map_err(|e| format!("ECDSA signing failed: {}", e))?;
        let low_s_sig = signature.normalize_s().unwrap_or(signature);
        let der = low_s_sig.to_der();

        let mut script_sig = Vec::new();
        script_sig.push((der.as_bytes().len() + 1) as u8);
        script_sig.extend_from_slice(der.as_bytes());
        script_sig.push(0x01); // SIGHASH_ALL
        script_sig.push(pubkey_bytes.len() as u8);
        script_sig.extend_from_slice(&pubkey_bytes);

        script_sigs.push(script_sig);
    }

    // 7. Serialize Full Version 5 Transaction
    let mut raw = Vec::new();
    raw.extend_from_slice(&TX_VERSION_5_HEADER);
    raw.extend_from_slice(&VERSION_GROUP_ID_V5);
    raw.extend_from_slice(&consensus_branch_id.to_le_bytes());
    raw.extend_from_slice(&lock_time.to_le_bytes());
    raw.extend_from_slice(&expiry_height.to_le_bytes());

    raw.extend_from_slice(&write_compact_size(utxos.len()));
    for (i, u) in utxos.iter().enumerate() {
        let mut txid_bytes = hex::decode(&u.txid).unwrap();
        txid_bytes.reverse();
        raw.extend_from_slice(&txid_bytes);
        raw.extend_from_slice(&u.vout.to_le_bytes());
        raw.extend_from_slice(&write_compact_size(script_sigs[i].len()));
        raw.extend_from_slice(&script_sigs[i]);
        raw.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    }

    raw.extend_from_slice(&write_compact_size(output_count));
    raw.extend_from_slice(&outputs_data);

    raw.push(0x00);
    raw.push(0x00);
    raw.push(0x00);

    Ok(SignedTransaction {
        txid: txid_hex,
        raw_hex: hex::encode(raw),
        branch_id: consensus_branch_id,
        fee_zatoshis: fee,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_v5_tx_signing() {
        let priv_hex = "0101010101010101010101010101010101010101010101010101010101010101";
        let utxos = vec![UtxoInput {
            txid: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff".to_string(),
            vout: 0,
            amount_zatoshis: 100_000_000, // 1 TAZ
        }];
        let to_addr = "tmF1xjfhsSzhy55dmhorzTnKjtHhZmPKzts"; // Testnet address

        let tx = build_and_sign_v5_transaction(
            priv_hex,
            &utxos,
            to_addr,
            10_000_000, // 0.1 TAZ
            4476800,
            TESTNET_IRONWOOD_BRANCH_ID,
        )
        .unwrap();

        assert_eq!(tx.txid.len(), 64);
        assert!(tx.raw_hex.starts_with("050000800a27a7265b16a537")); // v5 header + group + ironwood
        assert_eq!(tx.fee_zatoshis, 10000);
    }

    #[test]
    fn test_pure_orchard_shielding_v5_output() {
        let priv_hex = "0101010101010101010101010101010101010101010101010101010101010101";
        let utxos = vec![UtxoInput {
            txid: "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff".to_string(),
            vout: 0,
            amount_zatoshis: 100_000, // 100k zats
        }];

        // Generate a pure Orchard Unified Address (has Orchard receiver, NO transparent receiver!)
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let acc = crate::orchard_wallet::derive_orchard_account(mnemonic, 0, "mainnet").unwrap();
        let raw_orchard = hex::decode(&acc.orchard_raw_address_hex).unwrap();
        let mut raw_arr = [0u8; 43];
        raw_arr.copy_from_slice(&raw_orchard);

        let pure_orchard_ua = crate::unified_address::encode_unified_address(
            "mainnet",
            None, // NO transparent receiver!
            Some(&raw_arr),
        )
        .unwrap();

        assert!(pure_orchard_ua.starts_with("u1"), "Pure UA on mainnet starts with u1");

        // Building and signing with pure Orchard UA must succeed without throwing
        // "Recipient Unified Address does not contain a transparent receiver" error!
        let tx = build_and_sign_v5_transaction(
            priv_hex,
            &utxos,
            &pure_orchard_ua,
            90_000,
            2500000,
            MAINNET_NU5_BRANCH_ID,
        )
        .expect("Shielding to pure Orchard UA must succeed");

        assert_eq!(tx.txid.len(), 64);
        assert_eq!(tx.fee_zatoshis, 10_000);

        let raw_bytes = hex::decode(&tx.raw_hex).unwrap();
        // Header: 0x80000005 LE
        assert_eq!(&raw_bytes[0..4], &[0x05, 0x00, 0x00, 0x80]);
        // VersionGroupId: 0x26A7270A LE
        assert_eq!(&raw_bytes[4..8], &[0x0A, 0x27, 0xA7, 0x26]);

        // Find nOutputs index:
        // header (4) + version_group (4) + branch_id (4) + lock_time (4) + expiry (4) = 20
        // inputs count (1 byte = 0x01)
        // input 0: txid (32) + vout (4) + scriptSig length (compact size) + scriptSig + sequence (4)
        let mut cursor = 20;
        let n_inputs = raw_bytes[cursor];
        cursor += 1;
        assert_eq!(n_inputs, 1);
        cursor += 36; // txid (32) + vout (4)
        let script_len = raw_bytes[cursor] as usize;
        cursor += 1 + script_len + 4; // script + sequence

        // Transparent outputs count MUST BE 0!
        let n_outputs = raw_bytes[cursor];
        cursor += 1;
        assert_eq!(n_outputs, 0, "CRITICAL: nOutputs MUST BE 0 in pure shielding transaction!");

        // Sapling spends (1 byte = 0) and outputs (1 byte = 0)
        assert_eq!(raw_bytes[cursor], 0);
        assert_eq!(raw_bytes[cursor + 1], 0);
        cursor += 2;

        // Orchard actions count: at least 2
        let n_actions = raw_bytes[cursor];
        cursor += 1;
        assert_eq!(n_actions, 2, "Orchard bundle must contain at least 2 actions");

        // Skip 2 actions: 2 * 820 bytes = 1640 bytes
        cursor += 2 * 820;

        // Flags byte: 0x01
        let flags = raw_bytes[cursor];
        cursor += 1;
        assert_eq!(flags, 0x01, "Flags must be 0x01 (spendsDisabled=true, outputsEnabled=true)");

        // Value balance: -90,000 zats i64 LE
        let mut val_bytes = [0u8; 8];
        val_bytes.copy_from_slice(&raw_bytes[cursor..cursor + 8]);
        let val_balance = i64::from_le_bytes(val_bytes);
        cursor += 8;
        assert_eq!(val_balance, -90_000, "Value balance must be negative payout amount (-90000)");

        // Anchor: 32 zeros
        assert_eq!(&raw_bytes[cursor..cursor + 32], &[0u8; 32], "Anchor must be empty tree root (32 zeros)");
    }
}
