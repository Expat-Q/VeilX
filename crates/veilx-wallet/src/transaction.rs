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

fn write_compact_size(val: usize) -> Vec<u8> {
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

/// Builds and signs a complete Zcash Version 5 transparent transaction.
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
    for (_i, u) in utxos.iter().enumerate() {
        // S.2g: txin_sig_digest (prevout || value || scriptPubKey || nSequence)
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

        // S.2: transparent_sig_digest
        let mut transparent_sig_data = Vec::with_capacity(1 + 32 * 6);
        transparent_sig_data.push(0x01u8); // S.2a: SIGHASH_ALL (0x01)
        transparent_sig_data.extend_from_slice(&prevouts_digest);
        transparent_sig_data.extend_from_slice(&amounts_sig_digest);
        transparent_sig_data.extend_from_slice(&scriptpubkeys_sig_digest);
        transparent_sig_data.extend_from_slice(&sequences_digest);
        transparent_sig_data.extend_from_slice(&outputs_digest);
        transparent_sig_data.extend_from_slice(&txin_sig_digest);

        let transparent_sig_digest = blake2b_personal(b"ZTxIdTranspaHash", &transparent_sig_data);

        // Signature digest
        let mut sighash_preimage = Vec::with_capacity(128);
        sighash_preimage.extend_from_slice(&header_digest);
        sighash_preimage.extend_from_slice(&transparent_sig_digest);
        sighash_preimage.extend_from_slice(&sapling_digest);
        sighash_preimage.extend_from_slice(&orchard_digest);

        let sighash = blake2b_personal(&tx_personal, &sighash_preimage);

        // Sign sighash with secp256k1
        let signature: Signature = signing_key.sign_prehash(&sighash).map_err(|e| format!("ECDSA signing failed: {}", e))?;
        // Normalize to canonical low-S
        let low_s_sig = signature.normalize_s().unwrap_or(signature);
        let der = low_s_sig.to_der();

        let mut script_sig = Vec::new();
        script_sig.push((der.as_bytes().len() + 1) as u8); // +1 for SIGHASH_ALL
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

    // Transparent inputs count
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

    // Transparent outputs count
    raw.extend_from_slice(&write_compact_size(output_count));
    raw.extend_from_slice(&outputs_data);

    // Sapling bundle (ZIP-225: nSpendsSapling = 0, nOutputsSapling = 0)
    raw.push(0x00);
    raw.push(0x00);
    // Orchard bundle (ZIP-225: nActionsOrchard = 0)
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
}
