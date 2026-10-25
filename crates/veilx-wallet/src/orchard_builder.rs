//! Orchard Shielding Action Bundle Builder for ZIP-225 (NU5) Transactions
//!
//! Constructs genuine t -> z shielding Orchard bundles containing:
//! - 1 real recipient output action
//! - 1 dummy padding action (satisfies Orchard circuit minimum of 2 actions)
//! - flags = 0x02 (spendsDisabled = true, outputsEnabled = true)
//! - valueBalanceOrchard = -payoutZats
//! - anchorOrchard = [0u8; 32] (Anchor::empty_tree(), never expires)
//! - Halo 2 Zero-Knowledge Proof generated client-side
//! - RedPallas binding signature over the ZIP-244 transaction signature digest

use std::sync::Arc;
use lazy_static::lazy_static;
use orchard::{
    builder::{Builder, BundleType},
    bundle::{Authorized, Bundle, BundleVersion, Flags, TxVersion},
    circuit::{OrchardCircuitVersion, ProvingKey},
    tree::Anchor,
    value::NoteValue,
    Address,
};
use serde::{Deserialize, Serialize};

lazy_static! {
    /// Cached Halo 2 proving key for Version 5 (NU5 / Post-NU6.2) Orchard circuit.
    pub static ref V5_PROVING_KEY: Arc<ProvingKey> = {
        Arc::new(ProvingKey::build(OrchardCircuitVersion::FixedPostNu6_2))
    };
}

pub const EMPTY_TREE_ANCHOR_HEX: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

/// Encodes an integer as Bitcoin / Zcash CompactSize.
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

/// Represents an individual Orchard Action in serialized hex format.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShieldingAction {
    pub cv: String,
    pub nullifier: String,
    pub rk: String,
    pub cmx: String,
    #[serde(rename = "ephemeralKey", alias = "epk")]
    pub ephemeral_key: String,
    #[serde(rename = "encCiphertext")]
    pub enc_ciphertext: String,
    #[serde(rename = "outCiphertext")]
    pub out_ciphertext: String,
}

/// Fully serialized Orchard Action Bundle for client-server JSON exchange and wire serialization.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShieldingOrchardBundle {
    pub actions: Vec<ShieldingAction>,
    pub flags: u8,
    #[serde(rename = "valueBalanceZats")]
    pub value_balance_zats: i64,
    #[serde(rename = "anchorHex")]
    pub anchor_hex: String,
    #[serde(rename = "proofHex")]
    pub proof_hex: String,
    #[serde(rename = "spendAuthSigs", default)]
    pub spend_auth_sigs: Vec<String>,
    #[serde(rename = "bindingSigHex")]
    pub binding_sig_hex: String,
}

/// Builds, proves with Halo 2, and authorizes a shielding Orchard or Ironwood bundle.
///
/// Output bundle contains:
/// - Exactly 2 actions: 1 real recipient output + 1 dummy padding output
/// - valueBalance = -(payout_zatoshis as i64)
/// - flags = 0x02 (spendsDisabled = true, outputsEnabled = true)
/// - Halo 2 proof verifying the actions
/// - RedPallas binding signature over `sighash_bytes`
pub fn build_and_prove_shielding_bundle(
    recipient_address_bytes: &[u8; 43],
    payout_zatoshis: u64,
    memo_bytes: Option<&[u8]>,
    sighash_bytes: &[u8; 32],
    anchor_hex: Option<&str>,
    is_ironwood: bool,
) -> Result<(ShieldingOrchardBundle, [u8; 32]), String> {
    let mut rng = rand::rng();

    let recipient_addr = Address::from_raw_address_bytes(recipient_address_bytes)
        .into_option()
        .ok_or_else(|| "Invalid recipient Orchard address: failed to parse 43 raw bytes".to_string())?;

    let (bundle_version, anchor, tx_version, pk, bundle_anchor_hex) = if is_ironwood {
        let anchor_str = anchor_hex.ok_or_else(|| "Live anchor hex is required for Ironwood shielding bundle".to_string())?;
        let anchor_raw = hex::decode(anchor_str).map_err(|e| format!("Invalid anchor hex: {}", e))?;
        if anchor_raw.len() != 32 {
            return Err(format!("Anchor must be 32 bytes, got {}", anchor_raw.len()));
        }
        let mut anchor_bytes = [0u8; 32];
        anchor_bytes.copy_from_slice(&anchor_raw);
        let anc = Anchor::from_bytes(anchor_bytes).into_option()
            .ok_or_else(|| "Invalid anchor: failed to deserialize Merkle tree root".to_string())?;

        (
            BundleVersion::ironwood_v3(),
            anc,
            TxVersion::V6,
            &*crate::orchard_wallet::ORCHARD_PROVING_KEY,
            anchor_str.to_string(),
        )
    } else {
        (
            BundleVersion::orchard_v2(),
            Anchor::empty_tree(),
            TxVersion::V5,
            &*V5_PROVING_KEY,
            EMPTY_TREE_ANCHOR_HEX.to_string(),
        )
    };

    let flags = Flags::SPENDS_DISABLED;

    let mut builder = Builder::new(BundleType::DEFAULT, bundle_version, flags, anchor)
        .map_err(|e| format!("Orchard Builder initialization failed: {:?}", e))?;

    let mut memo = [0u8; 512];
    if let Some(m) = memo_bytes {
        let copy_len = m.len().min(512);
        memo[..copy_len].copy_from_slice(&m[..copy_len]);
    }

    let note_val = NoteValue::from_raw(payout_zatoshis);
    builder
        .add_output(None, recipient_addr, note_val, memo)
        .map_err(|e| format!("Failed to add recipient output to Orchard builder: {:?}", e))?;

    // Build unauthorized bundle. BundleType::DEFAULT automatically pads with 1 dummy action if actions < 2.
    let (unauth_bundle, _meta) = builder
        .build::<i64>(&mut rng)
        .map_err(|e| format!("Failed to build unauthorized bundle: {:?}", e))?
        .ok_or_else(|| "Orchard unauthorized bundle was empty".to_string())?;

    if unauth_bundle.actions().len() < 2 {
        return Err(format!(
            "Orchard bundle invariant violated: expected at least 2 actions, found {}",
            unauth_bundle.actions().len()
        ));
    }

    // Compute bundle commitment for sighash & txid
    let bundle_commitment: [u8; 32] = unauth_bundle
        .commitment(tx_version)
        .map_err(|e| format!("Failed to compute bundle commitment: {:?}", e))?
        .into();

    // Create client-side Halo 2 Zero-Knowledge Proof
    let proven_bundle = unauth_bundle
        .create_proof(pk, &mut rng)
        .map_err(|e| format!("Halo 2 proof creation failed: {:?}", e))?;

    // Apply RedPallas binding signature over sighash. Since spends are disabled, signing_keys is empty.
    let authorized_bundle: Bundle<Authorized, i64> = proven_bundle
        .apply_signatures(&mut rng, *sighash_bytes, &[])
        .map_err(|e| format!("Failed to sign Orchard binding signature: {:?}", e))?;

    let actions: Vec<ShieldingAction> = authorized_bundle
        .actions()
        .iter()
        .map(|a| ShieldingAction {
            cv: hex::encode(a.cv_net().to_bytes()),
            nullifier: hex::encode(a.nullifier().to_bytes()),
            rk: hex::encode(<[u8; 32]>::from(a.rk())),
            cmx: hex::encode(a.cmx().to_bytes()),
            ephemeral_key: hex::encode(a.encrypted_note().epk_bytes),
            enc_ciphertext: hex::encode(&a.encrypted_note().enc_ciphertext.0[..]),
            out_ciphertext: hex::encode(&a.encrypted_note().out_ciphertext[..]),
        })
        .collect();

    let proof_bytes = authorized_bundle.authorization().proof().as_ref();
    let binding_sig_bytes = <[u8; 64]>::from(authorized_bundle.authorization().binding_signature());

    let spend_auth_sigs: Vec<String> = authorized_bundle
        .actions()
        .iter()
        .map(|a| hex::encode(<[u8; 64]>::from(a.authorization())))
        .collect();

    let bundle = ShieldingOrchardBundle {
        actions,
        // In accordance with ZIP-225 Section 7.1: bit 0 = enableSpends, bit 1 = enableOutputs.
        // For pure shielding (t -> z), spends are disabled and outputs are enabled: 0b00000010 = 0x02
        flags: 0x02,
        value_balance_zats: -(payout_zatoshis as i64),
        anchor_hex: bundle_anchor_hex,
        proof_hex: hex::encode(proof_bytes),
        spend_auth_sigs,
        binding_sig_hex: hex::encode(binding_sig_bytes),
    };

    Ok((bundle, bundle_commitment))
}

/// Serializes an authorized Orchard Action Bundle into raw wire format bytes under ZIP-225.
pub fn serialize_v5_orchard_bundle(bundle: &ShieldingOrchardBundle) -> Result<Vec<u8>, String> {
    let mut raw = Vec::new();

    // 1. nActionsOrchard (compact size)
    raw.extend_from_slice(&write_compact_size(bundle.actions.len()));

    // 2. Action descriptions without auth
    for act in &bundle.actions {
        let cv = hex::decode(&act.cv).map_err(|e| format!("Invalid cv hex: {}", e))?;
        let nf = hex::decode(&act.nullifier).map_err(|e| format!("Invalid nullifier hex: {}", e))?;
        let rk = hex::decode(&act.rk).map_err(|e| format!("Invalid rk hex: {}", e))?;
        let cmx = hex::decode(&act.cmx).map_err(|e| format!("Invalid cmx hex: {}", e))?;
        let epk = hex::decode(&act.ephemeral_key).map_err(|e| format!("Invalid ephemeralKey hex: {}", e))?;
        let enc = hex::decode(&act.enc_ciphertext).map_err(|e| format!("Invalid encCiphertext hex: {}", e))?;
        let out = hex::decode(&act.out_ciphertext).map_err(|e| format!("Invalid outCiphertext hex: {}", e))?;

        if cv.len() != 32 || nf.len() != 32 || rk.len() != 32 || cmx.len() != 32 || epk.len() != 32 {
            return Err("Action element must be 32 bytes".to_string());
        }
        if enc.len() != 580 {
            return Err(format!("encCiphertext must be 580 bytes, got {}", enc.len()));
        }
        if out.len() != 80 {
            return Err(format!("outCiphertext must be 80 bytes, got {}", out.len()));
        }

        raw.extend_from_slice(&cv);
        raw.extend_from_slice(&nf);
        raw.extend_from_slice(&rk);
        raw.extend_from_slice(&cmx);
        raw.extend_from_slice(&epk);
        raw.extend_from_slice(&enc);
        raw.extend_from_slice(&out);
    }

    // 3. Flags: 1 byte
    raw.push(bundle.flags);

    // 4. ValueBalanceOrchard: 8 bytes i64 LE
    raw.extend_from_slice(&bundle.value_balance_zats.to_le_bytes());

    // 5. AnchorOrchard: 32 bytes
    let anchor_bytes = hex::decode(&bundle.anchor_hex)
        .map_err(|e| format!("Invalid anchor hex: {}", e))?;
    if anchor_bytes.len() != 32 {
        return Err("Anchor must be 32 bytes".to_string());
    }
    raw.extend_from_slice(&anchor_bytes);

    // 6. sizeProofsOrchard: compact size + proof bytes
    let proof_bytes = hex::decode(&bundle.proof_hex)
        .map_err(|e| format!("Invalid proof hex: {}", e))?;
    raw.extend_from_slice(&write_compact_size(proof_bytes.len()));
    raw.extend_from_slice(&proof_bytes);

    // 7. vSpendAuthSigsOrchard: 64 bytes per action
    for sig_hex in &bundle.spend_auth_sigs {
        let sig = hex::decode(sig_hex).map_err(|e| format!("Invalid spend auth sig hex: {}", e))?;
        if sig.len() != 64 {
            return Err("Spend auth sig must be 64 bytes".to_string());
        }
        raw.extend_from_slice(&sig);
    }

    // 8. bindingSigOrchard: 64 bytes
    let binding_sig = hex::decode(&bundle.binding_sig_hex)
        .map_err(|e| format!("Invalid binding sig hex: {}", e))?;
    if binding_sig.len() != 64 {
        return Err("Binding signature must be 64 bytes".to_string());
    }
    raw.extend_from_slice(&binding_sig);

    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orchard_bundle_construction() {
        // Derive valid testnet Orchard recipient address
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let acc = crate::orchard_wallet::derive_orchard_account(mnemonic, 0, "testnet").unwrap();
        let recip_raw = hex::decode(&acc.orchard_raw_address_hex).unwrap();
        let mut recip_arr = [0u8; 43];
        recip_arr.copy_from_slice(&recip_raw);

        let payout_zats = 90_000u64;
        let sighash = [42u8; 32];
        let memo = b"VeilX Payout Shielding Test";

        let (bundle, commitment) = build_and_prove_shielding_bundle(
            &recip_arr,
            payout_zats,
            Some(memo),
            &sighash,
            None,
            false,
        )
        .expect("Bundle creation and proving must succeed");

        assert_eq!(bundle.actions.len(), 2, "Must contain exactly 2 actions (1 real + 1 dummy)");
        assert_eq!(bundle.flags, 0x02, "Flags must be 0x02 (spendsDisabled=true, outputsEnabled=true)");
        assert_eq!(bundle.value_balance_zats, -90_000, "Value balance must be negative payoutZats");
        assert_eq!(bundle.anchor_hex, EMPTY_TREE_ANCHOR_HEX, "Anchor must be empty tree root (64 zeros)");
        assert!(!bundle.proof_hex.is_empty(), "Proof must be generated");
        assert_eq!(bundle.binding_sig_hex.len(), 128, "Binding sig must be 64 bytes hex");
        assert_ne!(commitment, [0u8; 32], "Bundle commitment must be non-zero");

        // Verify wire serialization
        let raw_bundle = serialize_v5_orchard_bundle(&bundle).expect("Serialization must succeed");
        assert!(raw_bundle.len() > 1800, "Serialized bundle with proof should exceed 1.8 KB");
        assert_eq!(raw_bundle[0], 2, "First byte must be CompactSize(2) for action count");
    }
}
