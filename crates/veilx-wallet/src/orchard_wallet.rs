use std::sync::Arc;
use ff::{Field, PrimeField};
use incrementalmerkletree::Hashable;
use sha2::{Digest, Sha256};
use ripemd::Ripemd160;
use pasta_curves::group::{Group, GroupEncoding};
use lazy_static::lazy_static;
use orchard::{
    builder::{Builder, BundleType},
    bundle::{Authorized, Bundle, BundleVersion, Flags},
    circuit::{OrchardCircuitVersion, ProvingKey},
    keys::{
        FullViewingKey, OutgoingViewingKey,
        Scope, SpendAuthorizingKey, SpendingKey,
    },
    note::{
        ExtractedNoteCommitment, Note, NoteVersion, Nullifier, RandomSeed, Rho,
        TransmittedNoteCiphertext,
    },
    note_encryption::{
        CompactAction, NoteBytesData,
        OrchardDomain, COMPACT_NOTE_SIZE, ENC_CIPHERTEXT_SIZE,
    },
    primitives::redpallas::{self, SpendAuth},
    tree::{Anchor, MerkleHashOrchard, MerklePath},
    value::{NoteValue, ValueCommitment},
    Action, Address,
};
use pasta_curves::pallas;
use serde::{Deserialize, Serialize};
use zip32::AccountId;
use zcash_note_encryption::{
    try_compact_note_decryption, try_note_decryption, try_output_recovery_with_ovk,
    EphemeralKeyBytes,
};

use crate::keys;
use crate::tree_manager::GLOBAL_ORCHARD_TREE;
use crate::unified_address;

lazy_static! {
    /// Cached Halo 2 proving key for the Orchard circuit.
    /// Built once lazily upon the first zero-knowledge proof generation.
    pub static ref ORCHARD_PROVING_KEY: Arc<ProvingKey> = {
        Arc::new(ProvingKey::build(OrchardCircuitVersion::FixedPostNu6_2))
    };
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardAccountInfo {
    pub account_index: u32,
    pub network: String,
    pub spending_key_hex: String,
    pub fvk_hex: String,
    pub orchard_raw_address_hex: String,
    pub unified_address: String,
    pub unified_full_viewing_key: String,
    pub transparent_address: String,
    pub transparent_pubkey_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardActionOutput {
    pub cv_net_hex: String,
    pub nullifier_hex: String,
    pub rk_hex: String,
    pub cmx_hex: String,
    pub epk_hex: String,
    pub enc_ciphertext_hex: String,
    pub out_ciphertext_hex: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardBundleResult {
    pub value_balance_zatoshis: i64,
    pub flags: u8,
    pub anchor_hex: String,
    pub actions: Vec<OrchardActionOutput>,
    pub proof_hex: String,
    pub binding_sig_hex: String,
    pub spend_auth_sigs_hex: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpendNoteInput {
    pub spending_key_hex: String,
    pub recipient_raw_address_hex: String,
    pub value_zatoshis: u64,
    pub rho_hex: String,
    pub rseed_hex: String,
    pub cmx_hex: String,
    pub auth_path_hex: Option<Vec<String>>,
    pub position: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DecryptedOrchardNote {
    pub recipient_address_hex: String,
    pub value_zatoshis: u64,
    pub memo_text: String,
    pub memo_hex: String,
    pub rho_hex: String,
    pub rseed_hex: String,
    pub is_change: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecoveredOutgoingNote {
    pub recipient_address_hex: String,
    pub value_zatoshis: u64,
    pub memo_text: String,
    pub memo_hex: String,
}

/// Derives transparent, Orchard, Unified Address, and Unified Full Viewing Key from mnemonic.
pub fn derive_orchard_account(
    mnemonic: &str,
    account_index: u32,
    network: &str,
) -> Result<OrchardAccountInfo, String> {
    let coin_type = match network.to_lowercase().as_str() {
        "mainnet" => 133u32,
        "testnet" => 1u32,
        "regtest" => 1u32,
        _ => return Err(format!("Unknown network: {}", network)),
    };

    let seed = keys::mnemonic_to_seed(mnemonic, "")
        .map_err(|e| format!("Seed generation error: {}", e))?;

    // 1. Derive Orchard spending key via ZIP-32
    let account = AccountId::try_from(account_index)
        .map_err(|e| format!("Invalid account index: {:?}", e))?;
    let sk = SpendingKey::from_zip32_seed(&seed, coin_type, account)
        .map_err(|e| format!("ZIP-32 Orchard key derivation error: {:?}", e))?;

    let fvk = FullViewingKey::from(&sk);
    let di = orchard::keys::DiversifierIndex::from(0u32);
    let raw_addr = fvk.address_at(di, Scope::External);
    let orchard_bytes = raw_addr.to_raw_address_bytes();

    // 2. Derive Transparent account via BIP-44
    let transparent_acc = keys::derive_account_from_seed(&seed, account_index, network)?;
    let p2pkh_hash160 = keys::transparent_address_to_hash160(&transparent_acc.address)?;

    // 3. Synthesize ZIP-316 Unified Address combining Transparent P2PKH (0x00) + Orchard (0x03)
    let ua = unified_address::encode_unified_address(
        network,
        Some(&p2pkh_hash160),
        Some(&orchard_bytes),
    )?;

    // 4. Synthesize ZIP-316 Unified Full Viewing Key (UFVK)
    let tfvk_bytes = keys::derive_transparent_fvk(&seed, account_index, network)?;
    let ofvk_bytes = fvk.to_bytes();
    let ufvk = unified_address::encode_unified_full_viewing_key(
        network,
        Some(&tfvk_bytes),
        Some(&ofvk_bytes),
    )?;

    let mut fvk_bytes = Vec::new();
    fvk.write(&mut fvk_bytes)
        .map_err(|e| format!("FVK serialization error: {}", e))?;

    Ok(OrchardAccountInfo {
        account_index,
        network: network.to_string(),
        spending_key_hex: hex::encode(sk.to_bytes()),
        fvk_hex: hex::encode(&fvk_bytes),
        orchard_raw_address_hex: hex::encode(&orchard_bytes),
        unified_address: ua,
        unified_full_viewing_key: ufvk,
        transparent_address: transparent_acc.address,
        transparent_pubkey_hex: transparent_acc.public_key,
    })
}

/// Derives a diversified Unified Address from a ZIP-316 Unified Full Viewing Key (UFVK).
pub fn derive_address_from_ufvk(
    ufvk: &str,
    diversifier_index: u32,
    network: &str,
) -> Result<String, String> {
    let decoded = unified_address::decode_unified_full_viewing_key(ufvk)?;

    let orchard_bytes = if let Some(ref ofvk_hex) = decoded.orchard_fvk_hex {
        let fvk_data = hex::decode(ofvk_hex).map_err(|e| format!("Invalid Orchard FVK hex: {}", e))?;
        let fvk = FullViewingKey::read(&fvk_data[..])
            .map_err(|e| format!("Failed to parse Orchard FVK: {}", e))?;
        let di = orchard::keys::DiversifierIndex::from(diversifier_index);
        let raw_addr = fvk.address_at(di, Scope::External);
        Some(raw_addr.to_raw_address_bytes())
    } else {
        None
    };

    let p2pkh_hash160 = if let Some(ref tfvk_hex) = decoded.transparent_fvk_hex {
        let tfvk_data = hex::decode(tfvk_hex).map_err(|e| format!("Invalid Transparent FVK hex: {}", e))?;
        if tfvk_data.len() == 65 {
            let mut pubkey = [0u8; 33];
            let mut chain_code = [0u8; 32];
            pubkey.copy_from_slice(&tfvk_data[0..33]);
            chain_code.copy_from_slice(&tfvk_data[33..65]);

            // Account level -> Change 0
            let (ch_pubkey, ch_chain) = keys::bip32_derive_public_normal(&pubkey, &chain_code, 0)?;
            // Change 0 -> Address index (diversifier_index)
            let (final_pubkey, _) = keys::bip32_derive_public_normal(&ch_pubkey, &ch_chain, diversifier_index)?;

            let sha = sha2::Sha256::digest(&final_pubkey);
            let h160 = ripemd::Ripemd160::digest(&sha);
            let mut arr = [0u8; 20];
            arr.copy_from_slice(&h160);
            Some(arr)
        } else {
            None
        }
    } else {
        None
    };

    unified_address::encode_unified_address(
        network,
        p2pkh_hash160.as_ref(),
        orchard_bytes.as_ref(),
    )
}

/// Builds, proves with Halo 2, and authorizes an output-only Orchard bundle (e.g. for shielding/deposits).
pub fn build_and_prove_orchard_bundle(
    spending_key_bytes: &[u8; 32],
    recipient_address_bytes: &[u8; 43],
    amount_zatoshis: u64,
    memo_text: Option<&str>,
    anchor_bytes: &[u8; 32],
    sighash_bytes: &[u8; 32],
) -> Result<OrchardBundleResult, String> {
    let mut rng = rand::rng();

    let sk = Option::from(SpendingKey::from_bytes(*spending_key_bytes))
        .ok_or("Invalid Orchard spending key bytes")?;
    let fvk = FullViewingKey::from(&sk);

    let recipient_addr = Option::from(Address::from_raw_address_bytes(recipient_address_bytes))
        .ok_or("Invalid recipient Orchard address")?;

    let anchor = if anchor_bytes == &[0u8; 32] {
        Anchor::empty_tree()
    } else {
        Option::from(Anchor::from_bytes(*anchor_bytes))
            .ok_or("Invalid anchor bytes")?
    };

    let bundle_version = BundleVersion::orchard_v2();
    let flags = Flags::ENABLED;

    let mut builder = Builder::new(BundleType::DEFAULT, bundle_version, flags, anchor)
        .map_err(|e| format!("Orchard Builder init error: {:?}", e))?;

    let mut memo = [0u8; 512];
    if let Some(text) = memo_text {
        let b = text.as_bytes();
        let len = b.len().min(512);
        memo[..len].copy_from_slice(&b[..len]);
    }

    let note_val = NoteValue::from_raw(amount_zatoshis);
    // Bind OVK for outgoing recovery
    let ovk = Some(fvk.to_ovk(Scope::External));

    builder
        .add_output(ovk, recipient_addr, note_val, memo)
        .map_err(|e| format!("Failed to add Orchard output: {:?}", e))?;

    let (unauth_bundle, _meta) = builder
        .build::<i64>(&mut rng)
        .map_err(|e| format!("Failed to build unauthorized bundle: {:?}", e))?
        .ok_or("Bundle was empty")?;

    let pk = &*ORCHARD_PROVING_KEY;
    let proven_bundle = unauth_bundle
        .create_proof(pk, &mut rng)
        .map_err(|e| format!("Halo 2 proof creation failed: {:?}", e))?;

    let ask = SpendAuthorizingKey::from(&sk);
    let authorized_bundle: Bundle<Authorized, i64> = proven_bundle
        .apply_signatures(&mut rng, *sighash_bytes, &[ask])
        .map_err(|e| format!("Signing Orchard bundle failed: {:?}", e))?;

    collect_bundle_result(&authorized_bundle, anchor_bytes)
}

/// Builds, proves with Halo 2, and authorizes an Orchard bundle that spends one or more
/// shielded notes with valid Merkle path witnesses, creating recipient and optional change outputs.
pub fn build_and_prove_orchard_spend(
    spends: &[SpendNoteInput],
    recipient_address_bytes: Option<&[u8; 43]>,
    amount_zatoshis: u64,
    memo_text: Option<&str>,
    change_address_bytes: Option<&[u8; 43]>,
    change_zatoshis: u64,
    anchor_bytes: &[u8; 32],
    sighash_bytes: &[u8; 32],
) -> Result<OrchardBundleResult, String> {
    if spends.is_empty() {
        return Err("At least one spend input is required".to_string());
    }

    let mut rng = rand::rng();

    let anchor = if anchor_bytes == &[0u8; 32] {
        Anchor::empty_tree()
    } else {
        Option::from(Anchor::from_bytes(*anchor_bytes))
            .ok_or("Invalid anchor bytes")?
    };

    let bundle_version = BundleVersion::orchard_v2();
    let flags = Flags::ENABLED;

    let mut builder = Builder::new(BundleType::DEFAULT, bundle_version, flags, anchor)
        .map_err(|e| format!("Orchard Builder init error: {:?}", e))?;

    let mut spend_authorizing_keys = Vec::new();

    // 1. Add all spend notes
    for spend_in in spends {
        let sk_bytes = hex::decode(&spend_in.spending_key_hex)
            .map_err(|e| format!("Invalid spending key hex: {}", e))?;
        if sk_bytes.len() != 32 {
            return Err("Spending key must be 32 bytes".to_string());
        }
        let mut sk_arr = [0u8; 32];
        sk_arr.copy_from_slice(&sk_bytes);
        let sk = Option::from(SpendingKey::from_bytes(sk_arr))
            .ok_or("Invalid SpendingKey")?;

        let fvk = FullViewingKey::from(&sk);
        let ask = SpendAuthorizingKey::from(&sk);
        spend_authorizing_keys.push(ask);

        let note_recip_bytes = hex::decode(&spend_in.recipient_raw_address_hex)
            .map_err(|e| format!("Invalid recipient address hex: {}", e))?;
        if note_recip_bytes.len() != 43 {
            return Err("Note recipient address must be 43 bytes".to_string());
        }
        let mut note_recip_arr = [0u8; 43];
        note_recip_arr.copy_from_slice(&note_recip_bytes);
        let note_recipient = Option::from(Address::from_raw_address_bytes(&note_recip_arr))
            .ok_or("Invalid recipient Address")?;

        let note_val = NoteValue::from_raw(spend_in.value_zatoshis);

        let rho_bytes = hex::decode(&spend_in.rho_hex)
            .map_err(|e| format!("Invalid rho hex: {}", e))?;
        if rho_bytes.len() != 32 {
            return Err("Rho must be 32 bytes".to_string());
        }
        let mut rho_arr = [0u8; 32];
        rho_arr.copy_from_slice(&rho_bytes);
        let rho = Option::from(Rho::from_bytes(&rho_arr))
            .ok_or("Invalid Rho")?;

        let rseed_bytes = hex::decode(&spend_in.rseed_hex)
            .map_err(|e| format!("Invalid rseed hex: {}", e))?;
        if rseed_bytes.len() != 32 {
            return Err("Rseed must be 32 bytes".to_string());
        }
        let mut rseed_arr = [0u8; 32];
        rseed_arr.copy_from_slice(&rseed_bytes);
        let rseed = Option::from(RandomSeed::from_bytes(rseed_arr, &rho))
            .ok_or("Invalid RandomSeed")?;

        let note = Option::from(Note::from_parts(note_recipient, note_val, rho, rseed, NoteVersion::V2))
            .ok_or("Invalid Note construction")?;

        // Obtain MerklePath: either from parameters or from GLOBAL_ORCHARD_TREE
        let merkle_path = if let (Some(auth_vec), Some(pos)) = (&spend_in.auth_path_hex, spend_in.position) {
            if auth_vec.len() != 32 {
                return Err("Explicit auth path must have 32 level elements".to_string());
            }
            let mut auth_elements = [MerkleHashOrchard::empty_leaf(); 32];
            for (i, h_hex) in auth_vec.iter().enumerate() {
                let b = hex::decode(h_hex).map_err(|e| format!("Invalid auth path leaf hex: {}", e))?;
                if b.len() != 32 {
                    return Err("Auth path leaf must be 32 bytes".to_string());
                }
                let mut leaf_arr = [0u8; 32];
                leaf_arr.copy_from_slice(&b);
                let opt: Option<MerkleHashOrchard> = MerkleHashOrchard::from_bytes(&leaf_arr).into();
                auth_elements[i] = opt.ok_or_else(|| "Invalid MerkleHashOrchard in auth path".to_string())?;
            }
            MerklePath::from_parts(pos, auth_elements)
        } else {
            let cm_bytes = hex::decode(&spend_in.cmx_hex)
                .map_err(|e| format!("Invalid cmx hex: {}", e))?;
            if cm_bytes.len() != 32 {
                return Err("cmx must be 32 bytes".to_string());
            }
            let mut cm_arr = [0u8; 32];
            cm_arr.copy_from_slice(&cm_bytes);

            let tree_guard = GLOBAL_ORCHARD_TREE.lock()
                .map_err(|_| "Failed to lock GLOBAL_ORCHARD_TREE".to_string())?;
            tree_guard.get_witness_for_note(&cm_arr)?
        };

        builder.add_spend(fvk, note, merkle_path)
            .map_err(|e| format!("Failed to add spend: {:?}", e))?;
    }

    // 2. Add recipient output note (if sending within shielded pool)
    if let (Some(recip_bytes), true) = (recipient_address_bytes, amount_zatoshis > 0) {
        let recip_addr = Option::from(Address::from_raw_address_bytes(recip_bytes))
            .ok_or("Invalid recipient Address")?;

        let mut memo = [0u8; 512];
        if let Some(text) = memo_text {
            let b = text.as_bytes();
            let len = b.len().min(512);
            memo[..len].copy_from_slice(&b[..len]);
        }

        // Use first spend's OVK for outgoing recovery
        let sk_bytes = hex::decode(&spends[0].spending_key_hex).unwrap();
        let mut sk_arr = [0u8; 32];
        sk_arr.copy_from_slice(&sk_bytes);
        let first_sk = SpendingKey::from_bytes(sk_arr).unwrap();
        let first_fvk = FullViewingKey::from(&first_sk);
        let ovk = Some(first_fvk.to_ovk(Scope::External));

        builder.add_output(ovk, recip_addr, NoteValue::from_raw(amount_zatoshis), memo)
            .map_err(|e| format!("Failed to add recipient output: {:?}", e))?;
    }

    // 3. Add change output (if remaining change > 0)
    if let (Some(change_bytes), true) = (change_address_bytes, change_zatoshis > 0) {
        let change_addr = Option::from(Address::from_raw_address_bytes(change_bytes))
            .ok_or("Invalid change Address")?;

        let sk_bytes = hex::decode(&spends[0].spending_key_hex).unwrap();
        let mut sk_arr = [0u8; 32];
        sk_arr.copy_from_slice(&sk_bytes);
        let first_sk = SpendingKey::from_bytes(sk_arr).unwrap();
        let first_fvk = FullViewingKey::from(&first_sk);
        let change_ovk = Some(first_fvk.to_ovk(Scope::Internal));

        builder.add_output(change_ovk, change_addr, NoteValue::from_raw(change_zatoshis), [0u8; 512])
            .map_err(|e| format!("Failed to add change output: {:?}", e))?;
    }

    // 4. Build bundle (automatically adds padding dummy actions if total actions < 2)
    let (unauth_bundle, _meta) = builder
        .build::<i64>(&mut rng)
        .map_err(|e| format!("Failed to build unauthorized spend bundle: {:?}", e))?
        .ok_or("Spend bundle was empty")?;

    // 5. Generate Halo 2 zero-knowledge proof
    let pk = &*ORCHARD_PROVING_KEY;
    let proven_bundle = unauth_bundle
        .create_proof(pk, &mut rng)
        .map_err(|e| format!("Halo 2 spend proof creation failed: {:?}", e))?;

    // 6. Sign spend authorization signatures and binding signature
    let authorized_bundle: Bundle<Authorized, i64> = proven_bundle
        .apply_signatures(&mut rng, *sighash_bytes, &spend_authorizing_keys)
        .map_err(|e| format!("Signing Orchard spend bundle failed: {:?}", e))?;

    collect_bundle_result(&authorized_bundle, anchor_bytes)
}

/// Trial decrypts an Orchard output note using an Incoming Viewing Key.
pub fn try_decrypt_orchard_output(
    fvk_hex: &str,
    nullifier_bytes: &[u8; 32],
    cmx_bytes: &[u8; 32],
    epk_bytes: &[u8; 32],
    enc_ciphertext: &[u8],
) -> Result<Option<DecryptedOrchardNote>, String> {
    let fvk_data = hex::decode(fvk_hex).map_err(|e| format!("Invalid FVK hex: {}", e))?;
    let fvk = FullViewingKey::read(&fvk_data[..])
        .map_err(|e| format!("Failed to parse FVK: {}", e))?;

    let nullifier: Option<Nullifier> = Nullifier::from_bytes(nullifier_bytes).into();
    let nullifier = nullifier.ok_or("Invalid nullifier")?;
    let cmx: Option<ExtractedNoteCommitment> = ExtractedNoteCommitment::from_bytes(cmx_bytes).into();
    let cmx = cmx.ok_or("Invalid cmx")?;
    let ephemeral_key = EphemeralKeyBytes(*epk_bytes);

    if enc_ciphertext.len() >= ENC_CIPHERTEXT_SIZE {
        let mut enc_arr = [0u8; ENC_CIPHERTEXT_SIZE];
        enc_arr.copy_from_slice(&enc_ciphertext[..ENC_CIPHERTEXT_SIZE]);
        let ciphertext = NoteBytesData(enc_arr);

        let ask_bytes: [u8; 32] = pallas::Scalar::ONE.to_repr();
        let ask = redpallas::SigningKey::<SpendAuth>::try_from(ask_bytes).unwrap();
        let dummy_rk: redpallas::VerificationKey<SpendAuth> = (&ask).into();
        let dummy_cv: Option<ValueCommitment> = ValueCommitment::from_bytes(&pallas::Point::generator().to_bytes()).into();
        let dummy_cv = dummy_cv.ok_or("Failed to create dummy ValueCommitment")?;

        let transmitted = TransmittedNoteCiphertext {
            epk_bytes: *epk_bytes,
            enc_ciphertext: ciphertext,
            out_ciphertext: [0u8; 80],
        };

        let action = Action::from_parts(nullifier, dummy_rk, cmx, transmitted, dummy_cv, ())
            .map_err(|e| format!("Action assembly error: {:?}", e))?;

        let domain = OrchardDomain::for_action(&action);

        // Try External Scope
        let ext_ivk = fvk.to_ivk(Scope::External).prepare();
        if let Some((note, recipient, memo)) = try_note_decryption(&domain, &ext_ivk, &action) {
            let memo_text = String::from_utf8(memo.to_vec())
                .unwrap_or_default()
                .trim_matches(char::from(0))
                .to_string();

            return Ok(Some(DecryptedOrchardNote {
                recipient_address_hex: hex::encode(recipient.to_raw_address_bytes()),
                value_zatoshis: note.value().inner(),
                memo_text,
                memo_hex: hex::encode(&memo[..]),
                rho_hex: hex::encode(note.rho().to_bytes()),
                rseed_hex: hex::encode(note.rseed().as_bytes()),
                is_change: false,
            }));
        }

        // Try Internal Scope (Change)
        let int_ivk = fvk.to_ivk(Scope::Internal).prepare();
        if let Some((note, recipient, memo)) = try_note_decryption(&domain, &int_ivk, &action) {
            let memo_text = String::from_utf8(memo.to_vec())
                .unwrap_or_default()
                .trim_matches(char::from(0))
                .to_string();

            return Ok(Some(DecryptedOrchardNote {
                recipient_address_hex: hex::encode(recipient.to_raw_address_bytes()),
                value_zatoshis: note.value().inner(),
                memo_text,
                memo_hex: hex::encode(&memo[..]),
                rho_hex: hex::encode(note.rho().to_bytes()),
                rseed_hex: hex::encode(note.rseed().as_bytes()),
                is_change: true,
            }));
        }
    } else if enc_ciphertext.len() >= COMPACT_NOTE_SIZE {
        let mut compact_arr = [0u8; COMPACT_NOTE_SIZE];
        compact_arr.copy_from_slice(&enc_ciphertext[..COMPACT_NOTE_SIZE]);
        let compact_action = CompactAction::from_parts(
            nullifier,
            cmx,
            ephemeral_key,
            compact_arr,
        );

        let domain = OrchardDomain::for_compact_action(&compact_action);

        let ext_ivk = fvk.to_ivk(Scope::External).prepare();
        if let Some((note, recipient)) = try_compact_note_decryption(&domain, &ext_ivk, &compact_action) {
            return Ok(Some(DecryptedOrchardNote {
                recipient_address_hex: hex::encode(recipient.to_raw_address_bytes()),
                value_zatoshis: note.value().inner(),
                memo_text: String::new(),
                memo_hex: String::new(),
                rho_hex: hex::encode(note.rho().to_bytes()),
                rseed_hex: hex::encode(note.rseed().as_bytes()),
                is_change: false,
            }));
        }

        let int_ivk = fvk.to_ivk(Scope::Internal).prepare();
        if let Some((note, recipient)) = try_compact_note_decryption(&domain, &int_ivk, &compact_action) {
            return Ok(Some(DecryptedOrchardNote {
                recipient_address_hex: hex::encode(recipient.to_raw_address_bytes()),
                value_zatoshis: note.value().inner(),
                memo_text: String::new(),
                memo_hex: String::new(),
                rho_hex: hex::encode(note.rho().to_bytes()),
                rseed_hex: hex::encode(note.rseed().as_bytes()),
                is_change: true,
            }));
        }
    }

    Ok(None)
}

/// Recovers a sent transaction's recipient, amount, and memo by decrypting with the Outgoing Viewing Key (OVK).
pub fn recover_outgoing_orchard_action(
    fvk_or_ovk_hex: &str,
    cv_net_bytes: &[u8; 32],
    cmx_bytes: &[u8; 32],
    epk_bytes: &[u8; 32],
    enc_ciphertext: &[u8; 580],
    out_ciphertext: &[u8; 80],
    nullifier_bytes: &[u8; 32],
) -> Result<Option<RecoveredOutgoingNote>, String> {
    let raw_key = hex::decode(fvk_or_ovk_hex).map_err(|e| format!("Invalid key hex: {}", e))?;

    let ovk = if raw_key.len() == 32 {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&raw_key);
        OutgoingViewingKey::from(arr)
    } else {
        let fvk = FullViewingKey::read(&raw_key[..])
            .map_err(|e| format!("Failed to parse FVK: {}", e))?;
        fvk.to_ovk(Scope::External)
    };

    let cv_net: Option<ValueCommitment> = ValueCommitment::from_bytes(cv_net_bytes).into();
    let cv_net = cv_net.ok_or("Invalid ValueCommitment cv_net bytes")?;

    let nullifier: Option<Nullifier> = Nullifier::from_bytes(nullifier_bytes).into();
    let nullifier = nullifier.ok_or("Invalid nullifier")?;

    let cmx: Option<ExtractedNoteCommitment> = ExtractedNoteCommitment::from_bytes(cmx_bytes).into();
    let cmx = cmx.ok_or("Invalid cmx")?;

    let ciphertext = NoteBytesData(*enc_ciphertext);
    let ask_bytes: [u8; 32] = pallas::Scalar::ONE.to_repr();
    let ask = redpallas::SigningKey::<SpendAuth>::try_from(ask_bytes).unwrap();
    let dummy_rk: redpallas::VerificationKey<SpendAuth> = (&ask).into();

    let transmitted = TransmittedNoteCiphertext {
        epk_bytes: *epk_bytes,
        enc_ciphertext: ciphertext,
        out_ciphertext: *out_ciphertext,
    };

    let action = Action::from_parts(nullifier, dummy_rk, cmx, transmitted, cv_net.clone(), ())
        .map_err(|e| format!("Action assembly error: {:?}", e))?;

    let domain = OrchardDomain::for_action(&action);

    if let Some((note, recipient, memo)) = try_output_recovery_with_ovk(&domain, &ovk, &action, &cv_net, out_ciphertext) {
        let memo_text = String::from_utf8(memo.to_vec())
            .unwrap_or_default()
            .trim_matches(char::from(0))
            .to_string();

        return Ok(Some(RecoveredOutgoingNote {
            recipient_address_hex: hex::encode(recipient.to_raw_address_bytes()),
            value_zatoshis: note.value().inner(),
            memo_text,
            memo_hex: hex::encode(&memo[..]),
        }));
    }

    Ok(None)
}

fn collect_bundle_result(
    authorized_bundle: &Bundle<Authorized, i64>,
    anchor_bytes: &[u8; 32],
) -> Result<OrchardBundleResult, String> {
    let actions: Vec<OrchardActionOutput> = authorized_bundle
        .actions()
        .iter()
        .map(|a| OrchardActionOutput {
            cv_net_hex: hex::encode(a.cv_net().to_bytes()),
            nullifier_hex: hex::encode(a.nullifier().to_bytes()),
            rk_hex: hex::encode(<[u8; 32]>::from(a.rk())),
            cmx_hex: hex::encode(a.cmx().to_bytes()),
            epk_hex: hex::encode(a.encrypted_note().epk_bytes),
            enc_ciphertext_hex: hex::encode(&a.encrypted_note().enc_ciphertext.0[..]),
            out_ciphertext_hex: hex::encode(&a.encrypted_note().out_ciphertext[..]),
        })
        .collect();

    let auth = authorized_bundle.authorization();
    let proof_bytes = auth.proof().as_ref();
    let binding_sig_bytes = <[u8; 64]>::from(auth.binding_signature());

    let spend_auth_sigs_hex = authorized_bundle
        .actions()
        .iter()
        .map(|a| hex::encode(<[u8; 64]>::from(a.authorization())))
        .collect();

    Ok(OrchardBundleResult {
        value_balance_zatoshis: *authorized_bundle.value_balance(),
        flags: authorized_bundle.flag_byte(),
        anchor_hex: hex::encode(anchor_bytes),
        actions,
        proof_hex: hex::encode(proof_bytes),
        binding_sig_hex: hex::encode(binding_sig_bytes),
        spend_auth_sigs_hex,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orchard_account_derivation() {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let acc = derive_orchard_account(mnemonic, 0, "testnet").unwrap();

        assert_eq!(acc.network, "testnet");
        assert!(acc.unified_address.starts_with("utest1"));
        assert!(acc.unified_full_viewing_key.starts_with("uviewtest1"));
        assert!(acc.transparent_address.starts_with("tm"));
        assert_eq!(acc.spending_key_hex.len(), 64);
        assert_eq!(acc.orchard_raw_address_hex.len(), 86);
    }
}
