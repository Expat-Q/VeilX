use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use incrementalmerkletree::Hashable;
use orchard::{
    builder::{Builder, BundleType},
    bundle::{BundleVersion, Flags},
    circuit::ProvingKey,
    keys::{FullViewingKey, SpendAuthorizingKey, SpendingKey},
    note::{Note, NoteVersion, Rho, RandomSeed},
    tree::{Anchor, MerkleHashOrchard, MerklePath},
    value::NoteValue,
    Address,
};
use crate::orchard_wallet::{ORCHARD_PROVING_KEY, ORCHARD_VERIFYING_KEY};

#[derive(Serialize, Deserialize, Debug)]
pub struct CreateEscrowPcztParams {
    pub escrow_fvk_hex: String,
    pub note_recipient_address_hex: String,
    pub note_value_zatoshis: u64,
    pub note_rho_hex: String,
    pub note_rseed_hex: String,
    pub auth_path_hashes_hex: Vec<String>,
    pub auth_path_position: u32,
    pub anchor_hex: String,
    pub payout_recipient_address_hex: String,
    pub payout_value_zatoshis: u64,
    pub memo_text: Option<String>,
    pub sighash_hex: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PcztBundleJson {
    pub sighash_hex: String,
    pub action_count: usize,
    pub has_proof: bool,
    pub status: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FinalizePcztResult {
    pub action_count: usize,
    pub is_authorized: bool,
    pub status: String,
}

/// Step 1: Server constructs the PCZT bundle skeleton without exposing the private spending key.
#[wasm_bindgen]
pub fn create_escrow_pczt(params_val: JsValue) -> Result<JsValue, JsValue> {
    let params: CreateEscrowPcztParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid params: {}", e)))?;

    let mut rng = rand::rng();

    // 1. Decode escrow FVK
    let fvk_bytes = hex::decode(&params.escrow_fvk_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid FVK hex: {}", e)))?;
    if fvk_bytes.len() != 96 {
        return Err(JsValue::from_str("Escrow FVK must be 96 bytes"));
    }
    let mut fvk_arr = [0u8; 96];
    fvk_arr.copy_from_slice(&fvk_bytes);
    let escrow_fvk = FullViewingKey::from_bytes(&fvk_arr)
        .ok_or_else(|| JsValue::from_str("Failed to parse FullViewingKey"))?;

    // 2. Decode note recipient address
    let note_recip_bytes = hex::decode(&params.note_recipient_address_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid note recipient hex: {}", e)))?;
    if note_recip_bytes.len() != 43 {
        return Err(JsValue::from_str("Note recipient address must be 43 bytes"));
    }
    let mut note_recip_arr = [0u8; 43];
    note_recip_arr.copy_from_slice(&note_recip_bytes);
    let note_recipient = Address::from_raw_address_bytes(&note_recip_arr)
        .into_option()
        .ok_or_else(|| JsValue::from_str("Invalid note recipient Address"))?;

    // 3. Decode Rho and Rseed
    let rho_bytes = hex::decode(&params.note_rho_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid rho hex: {}", e)))?;
    if rho_bytes.len() != 32 {
        return Err(JsValue::from_str("Rho must be 32 bytes"));
    }
    let mut rho_arr = [0u8; 32];
    rho_arr.copy_from_slice(&rho_bytes);
    let rho = Rho::from_bytes(&rho_arr)
        .into_option()
        .ok_or_else(|| JsValue::from_str("Invalid Rho bytes"))?;

    let rseed_bytes = hex::decode(&params.note_rseed_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid rseed hex: {}", e)))?;
    if rseed_bytes.len() != 32 {
        return Err(JsValue::from_str("Rseed must be 32 bytes"));
    }
    let mut rseed_arr = [0u8; 32];
    rseed_arr.copy_from_slice(&rseed_bytes);
    let rseed = RandomSeed::from_bytes(rseed_arr, &rho)
        .into_option()
        .ok_or_else(|| JsValue::from_str("Invalid RandomSeed bytes"))?;

    let note_value = NoteValue::from_raw(params.note_value_zatoshis);
    let note = Note::from_parts(note_recipient, note_value, rho, rseed, NoteVersion::V3)
        .into_option()
        .ok_or_else(|| JsValue::from_str("Failed to construct Orchard Note"))?;

    // 4. Decode 32-level Merkle path
    let mut auth_path_arr = [MerkleHashOrchard::empty_leaf(); 32];
    for (i, hash_hex) in params.auth_path_hashes_hex.iter().enumerate().take(32) {
        let b = hex::decode(hash_hex)
            .map_err(|e| JsValue::from_str(&format!("Invalid auth path hash hex: {}", e)))?;
        if b.len() == 32 {
            let mut h_arr = [0u8; 32];
            h_arr.copy_from_slice(&b);
            let opt: Option<MerkleHashOrchard> = MerkleHashOrchard::from_bytes(&h_arr).into();
            if let Some(h) = opt {
                auth_path_arr[i] = h;
            }
        }
    }
    let merkle_path = MerklePath::from_parts(params.auth_path_position, auth_path_arr);

    // 5. Decode Anchor
    let anchor_bytes = hex::decode(&params.anchor_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid anchor hex: {}", e)))?;
    if anchor_bytes.len() != 32 {
        return Err(JsValue::from_str("Anchor must be 32 bytes"));
    }
    let mut anchor_arr = [0u8; 32];
    anchor_arr.copy_from_slice(&anchor_bytes);
    let anchor = Anchor::from_bytes(anchor_arr)
        .into_option()
        .ok_or_else(|| JsValue::from_str("Invalid Anchor bytes"))?;

    // 6. Build Orchard PCZT bundle
    let bundle_version = BundleVersion::ironwood_v3();
    let flags = Flags::ENABLED;
    let mut builder = Builder::new(BundleType::DEFAULT, bundle_version, flags, anchor)
        .map_err(|e| JsValue::from_str(&format!("Builder init failed: {:?}", e)))?;

    // Spend added WITHOUT private spending key
    builder
        .add_spend(escrow_fvk, note, merkle_path)
        .map_err(|e| JsValue::from_str(&format!("Failed to add spend note: {:?}", e)))?;

    // Decode payout recipient
    let payout_recip_bytes = hex::decode(&params.payout_recipient_address_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid payout recipient hex: {}", e)))?;
    if payout_recip_bytes.len() != 43 {
        return Err(JsValue::from_str("Payout recipient address must be 43 bytes"));
    }
    let mut payout_recip_arr = [0u8; 43];
    payout_recip_arr.copy_from_slice(&payout_recip_bytes);
    let payout_recipient = Address::from_raw_address_bytes(&payout_recip_arr)
        .into_option()
        .ok_or_else(|| JsValue::from_str("Invalid payout recipient Address"))?;

    let payout_value = NoteValue::from_raw(params.payout_value_zatoshis);
    let mut memo = [0u8; 512];
    if let Some(ref text) = params.memo_text {
        let b = text.as_bytes();
        let len = b.len().min(512);
        memo[..len].copy_from_slice(&b[..len]);
    }

    builder
        .add_output(None, payout_recipient, payout_value, memo)
        .map_err(|e| JsValue::from_str(&format!("Failed to add payout output: {:?}", e)))?;

    let (mut pczt_bundle, _meta) = builder
        .build_for_pczt(&mut rng)
        .map_err(|e| JsValue::from_str(&format!("Failed to build for PCZT: {:?}", e)))?;

    let sighash_bytes = hex::decode(&params.sighash_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid sighash hex: {}", e)))?;
    if sighash_bytes.len() != 32 {
        return Err(JsValue::from_str("Sighash must be 32 bytes"));
    }
    let mut sighash_arr = [0u8; 32];
    sighash_arr.copy_from_slice(&sighash_bytes);

    pczt_bundle
        .finalize_io(sighash_arr, &mut rng)
        .map_err(|e| JsValue::from_str(&format!("Failed to finalize IO: {:?}", e)))?;

    let result = PcztBundleJson {
        sighash_hex: hex::encode(&sighash_arr),
        action_count: pczt_bundle.actions().len(),
        has_proof: pczt_bundle.zkproof().is_some(),
        status: "PCZT_CREATED_AWAITING_CLIENT_PROOF".to_string(),
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}
