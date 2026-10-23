use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use incrementalmerkletree::Hashable;
use orchard::{
    builder::{Builder, BundleType},
    bundle::BundleVersion,
    circuit::ProvingKey,
    keys::{FullViewingKey, SpendAuthorizingKey, SpendingKey},
    note::{Note, NoteVersion, Rho, RandomSeed},
    tree::{Anchor, MerkleHashOrchard, MerklePath},
    value::NoteValue,
    Address,
};
use crate::orchard_wallet::{ORCHARD_PROVING_KEY, OrchardActionOutput};

/// Canonical ZIP-244 / ZIP-229 consensus sighash for V6 shielded Ironwood claim
pub fn compute_canonical_v6_sighash(
    consensus_branch_id: u32,
    expiry_height: u32,
    ironwood_commitment: [u8; 32],
) -> [u8; 32] {
    // 1. Header digest
    // ZTxIdHeadersHash: [header (0x80000006), version_group_id (0xd884b698), consensus_branch_id, lock_time (0), expiry_height]
    let mut header_data = [0u8; 20];
    header_data[0..4].copy_from_slice(&0x80000006u32.to_le_bytes());
    header_data[4..8].copy_from_slice(&0xd884b698u32.to_le_bytes());
    header_data[8..12].copy_from_slice(&consensus_branch_id.to_le_bytes());
    header_data[12..16].copy_from_slice(&0u32.to_le_bytes());
    header_data[16..20].copy_from_slice(&expiry_height.to_le_bytes());

    let header_digest = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(b"ZTxIdHeadersHash")
        .hash(&header_data);

    // 2. Empty transparent digest: ZTxIdTranspaHash on empty
    let transparent_digest = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(b"ZTxIdTranspaHash")
        .hash(&[]);

    // 3. Empty sapling digest: ZTxIdSaplingHash on empty
    let sapling_digest = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(b"ZTxIdSaplingHash")
        .hash(&[]);

    // 4. Empty orchard digest
    let empty_orchard = orchard::bundle::commitments::hash_bundle_txid_empty(
        orchard::ValuePool::Orchard,
        orchard::bundle::TxVersion::V6,
    )
    .expect("valid empty Orchard V6 commitment");

    // 5. to_hash_v6 personalization: "ZcashTxHash_" + consensus_branch_id (4 bytes LE)
    let mut personal = [0u8; 16];
    personal[..12].copy_from_slice(b"ZcashTxHash_");
    personal[12..].copy_from_slice(&consensus_branch_id.to_le_bytes());

    let mut state = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(&personal)
        .to_state();

    state.update(header_digest.as_bytes());
    state.update(transparent_digest.as_bytes());
    state.update(sapling_digest.as_bytes());
    state.update(empty_orchard.as_bytes());
    state.update(&ironwood_commitment);

    let res = state.finalize();
    let mut sighash = [0u8; 32];
    sighash.copy_from_slice(res.as_bytes());
    sighash
}

#[derive(Serialize, Deserialize, Debug, Clone)]
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClientProvedPcztResult {
    pub sighash_hex: String,
    pub proof_hex: String,
    pub actions: Vec<OrchardActionOutput>,
    pub anchor_hex: String,
    pub flags: u8,
    pub value_balance_zatoshis: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ServerFinalizeResult {
    pub raw_tx_hex: String,
    pub txid_hex: String,
    pub action_count: usize,
    pub status: String,
}

/// Helper function to build a PCZT bundle from parameters
fn build_pczt_bundle(params: &CreateEscrowPcztParams) -> Result<orchard::pczt::Bundle, String> {
    let mut rng = rand::rng();

    // 1. Decode escrow FVK
    let fvk_bytes = hex::decode(&params.escrow_fvk_hex)
        .map_err(|e| format!("Invalid FVK hex: {}", e))?;
    if fvk_bytes.len() != 96 {
        return Err("Escrow FVK must be 96 bytes".to_string());
    }
    let mut fvk_arr = [0u8; 96];
    fvk_arr.copy_from_slice(&fvk_bytes);
    let escrow_fvk = FullViewingKey::from_bytes(&fvk_arr)
        .ok_or_else(|| "Failed to parse FullViewingKey".to_string())?;

    // 2. Decode note recipient address
    let note_recip_bytes = hex::decode(&params.note_recipient_address_hex)
        .map_err(|e| format!("Invalid note recipient hex: {}", e))?;
    if note_recip_bytes.len() != 43 {
        return Err("Note recipient address must be 43 bytes".to_string());
    }
    let mut note_recip_arr = [0u8; 43];
    note_recip_arr.copy_from_slice(&note_recip_bytes);
    let note_recipient = Address::from_raw_address_bytes(&note_recip_arr)
        .into_option()
        .ok_or_else(|| "Invalid note recipient Address".to_string())?;

    // 3. Decode Rho and Rseed
    let rho_bytes = hex::decode(&params.note_rho_hex)
        .map_err(|e| format!("Invalid rho hex: {}", e))?;
    if rho_bytes.len() != 32 {
        return Err("Rho must be 32 bytes".to_string());
    }
    let mut rho_arr = [0u8; 32];
    rho_arr.copy_from_slice(&rho_bytes);
    let rho = Rho::from_bytes(&rho_arr)
        .into_option()
        .ok_or_else(|| "Invalid Rho bytes".to_string())?;

    let rseed_bytes = hex::decode(&params.note_rseed_hex)
        .map_err(|e| format!("Invalid rseed hex: {}", e))?;
    if rseed_bytes.len() != 32 {
        return Err("Rseed must be 32 bytes".to_string());
    }
    let mut rseed_arr = [0u8; 32];
    rseed_arr.copy_from_slice(&rseed_bytes);
    let rseed = RandomSeed::from_bytes(rseed_arr, &rho)
        .into_option()
        .ok_or_else(|| "Invalid RandomSeed bytes".to_string())?;

    // 4. Decode 32-level Merkle path
    let mut auth_path_arr = [MerkleHashOrchard::empty_leaf(); 32];
    for (i, hash_hex) in params.auth_path_hashes_hex.iter().enumerate().take(32) {
        let b = hex::decode(hash_hex)
            .map_err(|e| format!("Invalid auth path hash hex: {}", e))?;
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
        .map_err(|e| format!("Invalid anchor hex: {}", e))?;
    if anchor_bytes.len() != 32 {
        return Err("Anchor must be 32 bytes".to_string());
    }
    let mut anchor_arr = [0u8; 32];
    anchor_arr.copy_from_slice(&anchor_bytes);
    let anchor = Anchor::from_bytes(anchor_arr)
        .into_option()
        .ok_or_else(|| "Invalid Anchor bytes".to_string())?;

    // 6. Construct Note matching Anchor
    let note_value = NoteValue::from_raw(params.note_value_zatoshis);
    let note_v3 = Note::from_parts(note_recipient, note_value, rho, rseed, NoteVersion::V3).into_option();
    let note_v2 = Note::from_parts(note_recipient, note_value, rho, rseed, NoteVersion::V2).into_option();

    let note = match (note_v3, note_v2) {
        (Some(n3), Some(n2)) => {
            if &merkle_path.root(n3.commitment().into()) == &anchor {
                n3
            } else {
                n2
            }
        }
        (Some(n3), None) => n3,
        (None, Some(n2)) => n2,
        _ => return Err("Failed to construct Orchard Note".to_string()),
    };

    // 7. Build Ironwood PCZT bundle (NU6.3 canonical pool for cross-address payments)
    let bundle_version = BundleVersion::ironwood_v3();
    let flags = bundle_version.default_flags();
    let mut builder = Builder::new(BundleType::DEFAULT, bundle_version, flags, anchor)
        .map_err(|e| format!("Builder init failed: {:?}", e))?;

    builder
        .add_spend(escrow_fvk, note, merkle_path)
        .map_err(|e| format!("Failed to add spend note: {:?}", e))?;

    let payout_recip_bytes = hex::decode(&params.payout_recipient_address_hex)
        .map_err(|e| format!("Invalid payout recipient hex: {}", e))?;
    if payout_recip_bytes.len() != 43 {
        return Err("Payout recipient address must be 43 bytes".to_string());
    }
    let mut payout_recip_arr = [0u8; 43];
    payout_recip_arr.copy_from_slice(&payout_recip_bytes);
    let payout_recipient = Address::from_raw_address_bytes(&payout_recip_arr)
        .into_option()
        .ok_or_else(|| "Invalid payout recipient Address".to_string())?;

    let payout_value = NoteValue::from_raw(params.payout_value_zatoshis);
    let mut memo = [0u8; 512];
    if let Some(ref text) = params.memo_text {
        let b = text.as_bytes();
        let len = b.len().min(512);
        memo[..len].copy_from_slice(&b[..len]);
    }

    builder
        .add_output(None, payout_recipient, payout_value, memo)
        .map_err(|e| format!("Failed to add payout output: {:?}", e))?;

    let (pczt_bundle, _meta) = builder
        .build_for_pczt(&mut rng)
        .map_err(|e| format!("Failed to build for PCZT: {:?}", e))?;

    Ok(pczt_bundle)
}

/// Pre-warms the Orchard Halo 2 Proving Key into WASM memory.
/// Call this during idle time (e.g. dashboard load) so first proof generation is instantaneous.
#[wasm_bindgen]
pub fn client_prewarm_prover() -> bool {
    let _ = &*ORCHARD_PROVING_KEY;
    true
}

/// Step 1: Client Prover running inside Browser WebAssembly Web Worker.
/// Takes unsigned PCZT parameters, computes the Halo 2 Zero-Knowledge Proof.
#[wasm_bindgen]
pub fn client_prove_escrow_pczt(params_val: JsValue) -> Result<JsValue, JsValue> {
    let params: CreateEscrowPcztParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid params: {}", e)))?;

    let mut rng = rand::rng();
    let mut pczt_bundle = build_pczt_bundle(&params).map_err(|e| JsValue::from_str(&e))?;

    // Compute Halo 2 Zero-Knowledge Proof
    let pk: &ProvingKey = &*ORCHARD_PROVING_KEY;
    pczt_bundle
        .create_proof(pk, &mut rng)
        .map_err(|e| JsValue::from_str(&format!("Client Halo 2 proof generation failed: {:?}", e)))?;

    let proof = pczt_bundle
        .zkproof()
        .as_ref()
        .ok_or_else(|| JsValue::from_str("ZK proof missing after creation"))?;
    let proof_bytes = proof.as_ref();

    let bundle_version = BundleVersion::ironwood_v3();
    let flags = bundle_version.default_flags();
    let flag_byte = flags.to_byte(bundle_version).unwrap_or(7);

    let actions: Vec<OrchardActionOutput> = pczt_bundle
        .actions()
        .iter()
        .map(|a| OrchardActionOutput {
            cv_net_hex: hex::encode(a.cv_net().to_bytes()),
            nullifier_hex: hex::encode(a.spend().nullifier().to_bytes()),
            rk_hex: hex::encode(<[u8; 32]>::from(a.spend().rk())),
            cmx_hex: hex::encode(a.output().cmx().to_bytes()),
            epk_hex: hex::encode(a.output().encrypted_note().epk_bytes),
            enc_ciphertext_hex: hex::encode(&a.output().encrypted_note().enc_ciphertext.0[..]),
            out_ciphertext_hex: hex::encode(&a.output().encrypted_note().out_ciphertext[..]),
        })
        .collect();

    let result = ClientProvedPcztResult {
        sighash_hex: params.sighash_hex,
        proof_hex: hex::encode(proof_bytes),
        actions,
        anchor_hex: params.anchor_hex,
        flags: flag_byte,
        value_balance_zatoshis: 10_000,
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Step 2: Server receives parameters, computes proof & canonical ZIP-244 consensus sighash,
/// signs real spend action with platform escrow `ask`, freezes canonical V6 transaction,
/// and returns the consensus raw hex.
#[wasm_bindgen]
pub fn server_sign_and_finalize_pczt(
    params_val: JsValue,
    escrow_sk_hex: &str,
    expiry_height: u32,
    _consensus_branch_id: u32,
) -> Result<JsValue, JsValue> {
    let params: CreateEscrowPcztParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid params: {}", e)))?;

    let mut rng = rand::rng();

    // 1. Decode escrow spending key and derive ask
    let sk_bytes = hex::decode(escrow_sk_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid spending key hex: {}", e)))?;
    if sk_bytes.len() != 32 {
        return Err(JsValue::from_str("Spending key must be 32 bytes"));
    }
    let mut sk_arr = [0u8; 32];
    sk_arr.copy_from_slice(&sk_bytes);
    let escrow_sk = SpendingKey::from_bytes(sk_arr)
        .into_option()
        .ok_or_else(|| JsValue::from_str("Invalid SpendingKey bytes"))?;
    let escrow_ask = SpendAuthorizingKey::from(&escrow_sk);

    // 2. Build PCZT bundle
    let mut pczt_bundle = build_pczt_bundle(&params).map_err(|e| JsValue::from_str(&e))?;

    // 3. Create Halo 2 Zero-Knowledge Proof
    let pk: &ProvingKey = &*ORCHARD_PROVING_KEY;
    pczt_bundle
        .create_proof(pk, &mut rng)
        .map_err(|e| JsValue::from_str(&format!("Proof error: {:?}", e)))?;

    // 4. Extract effects to compute exact canonical ZIP-244 consensus sighash
    let ironwood_effects = pczt_bundle
        .extract_effects::<i64>()
        .map_err(|e| JsValue::from_str(&format!("Extract effects error: {:?}", e)))?
        .ok_or_else(|| JsValue::from_str("Failed to extract Ironwood effects"))?;

    let ironwood_comm: [u8; 32] = ironwood_effects
        .commitment(orchard::bundle::TxVersion::V6)
        .map_err(|e| JsValue::from_str(&format!("Commitment error: {:?}", e)))?
        .into();

    let canonical_sighash = compute_canonical_v6_sighash(
        0x37a5165b,
        expiry_height,
        ironwood_comm,
    );

    // 5. Finalize IO with the canonical consensus sighash
    pczt_bundle
        .finalize_io(canonical_sighash, &mut rng)
        .map_err(|e| JsValue::from_str(&format!("Finalize IO error: {:?}", e)))?;

    // 6. Sign the real spend action using platform escrow ask
    for action in pczt_bundle.actions_mut() {
        if action.spend().spend_auth_sig().is_none() {
            action
                .sign(canonical_sighash, &escrow_ask, &mut rng)
                .map_err(|e| JsValue::from_str(&format!("Action sign error: {:?}", e)))?;
        }
    }

    // 7. Extract bundle and apply binding signature over canonical consensus sighash
    let bundle = pczt_bundle
        .extract::<i64>()
        .map_err(|e| JsValue::from_str(&format!("Extract error: {:?}", e)))?
        .ok_or_else(|| JsValue::from_str("Bundle extraction returned None"))?;

    let authorized_bundle = bundle
        .apply_binding_signature(canonical_sighash, &mut rng)
        .ok_or_else(|| JsValue::from_str("Binding signature error"))?;

    // 8. Serialize authorized bundle into canonical V6 wire format transaction
    let mut raw = Vec::new();
    raw.extend_from_slice(&0x80000006u32.to_le_bytes()); // overwintered + v6
    raw.extend_from_slice(&0xd884b698u32.to_le_bytes()); // versionGroupId
    raw.extend_from_slice(&0x37a5165bu32.to_le_bytes()); // consensus_branch_id (NU6.3)
    raw.extend_from_slice(&0u32.to_le_bytes()); // lockTime
    raw.extend_from_slice(&expiry_height.to_le_bytes());
    raw.push(0x00); // transparent inputs (0)
    raw.push(0x00); // transparent outputs (0)
    raw.push(0x00); // sapling spends (0)
    raw.push(0x00); // sapling outputs (0)
    raw.push(0x00); // orchard actions (0)

    let ironwood_actions_len = authorized_bundle.actions().len();
    raw.push(ironwood_actions_len as u8);

    for act in authorized_bundle.actions() {
        raw.extend_from_slice(&act.cv_net().to_bytes());
        raw.extend_from_slice(&act.nullifier().to_bytes());
        raw.extend_from_slice(&<[u8; 32]>::from(act.rk()));
        raw.extend_from_slice(&act.cmx().to_bytes());
        raw.extend_from_slice(&act.encrypted_note().epk_bytes);
        raw.extend_from_slice(&act.encrypted_note().enc_ciphertext.0[..]);
        raw.extend_from_slice(&act.encrypted_note().out_ciphertext[..]);
    }

    raw.push(authorized_bundle.flag_byte());
    raw.extend_from_slice(&authorized_bundle.value_balance().to_le_bytes());
    raw.extend_from_slice(&authorized_bundle.anchor().to_bytes());

    let proof_bytes = authorized_bundle.authorization().proof().as_ref();
    let proof_len = proof_bytes.len();
    if proof_len < 253 {
        raw.push(proof_len as u8);
    } else {
        raw.push(0xfd);
        raw.extend_from_slice(&(proof_len as u16).to_le_bytes());
    }
    raw.extend_from_slice(proof_bytes);

    for act in authorized_bundle.actions() {
        raw.extend_from_slice(&<[u8; 64]>::from(act.authorization()));
    }
    raw.extend_from_slice(&<[u8; 64]>::from(authorized_bundle.authorization().binding_signature()));

    // Under ZIP-244 / ZIP-229, TxID is the byte-reversal of canonical shielded sighash
    let mut display_txid = canonical_sighash;
    display_txid.reverse();
    let txid_hex = hex::encode(display_txid);

    let result = ServerFinalizeResult {
        raw_tx_hex: hex::encode(raw),
        txid_hex,
        action_count: authorized_bundle.actions().len(),
        status: "AUTHORIZED_RAW_TX_EXTRACTED".to_string(),
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}
