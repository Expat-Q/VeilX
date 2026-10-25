//! VeilX Shielded & Transparent Zcash NU7/Ironwood WebAssembly Engine
//!
//! Exposes zero-eval, Manifest V3-compliant cryptographic primitives for the VeilX Chrome Extension.

pub mod fees;
pub mod keys;
pub mod orchard_wallet;
pub mod transaction;
pub mod tree_manager;
pub mod unified_address;
pub mod pczt_escrow;
pub mod orchard_builder;
pub mod pczt;

// Export init_thread_pool from wasm_bindgen_rayon for browser multithreading
pub use wasm_bindgen_rayon::init_thread_pool;

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize)]
pub struct SignTxParams {
    pub private_key_hex: String,
    pub utxos: Vec<transaction::UtxoInput>,
    pub to_address: String,
    pub amount_zatoshis: u64,
    pub current_block_height: u32,
    pub consensus_branch_id: Option<u32>,
    pub anchor_hex: Option<String>,
}

#[wasm_bindgen]
pub fn generate_seed_phrase(word_count: usize) -> Result<String, JsValue> {
    keys::generate_mnemonic(word_count).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn validate_seed_phrase(phrase: &str) -> bool {
    keys::validate_mnemonic(phrase)
}

#[wasm_bindgen]
pub fn derive_account(mnemonic: &str, account_index: u32, network: &str) -> Result<JsValue, JsValue> {
    let seed = keys::mnemonic_to_seed(mnemonic, "").map_err(|e| JsValue::from_str(&e))?;
    let account = keys::derive_account_from_seed(&seed, account_index, network)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&account).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn calculate_zip317_fee(input_count: usize, output_count: usize) -> u64 {
    fees::calculate_zip317_fee(input_count, output_count)
}

#[wasm_bindgen]
pub fn build_and_sign_transaction(params_val: JsValue) -> Result<JsValue, JsValue> {
    let params: SignTxParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid transaction parameters: {}", e)))?;

    let branch_id = params
        .consensus_branch_id
        .unwrap_or(transaction::TESTNET_IRONWOOD_BRANCH_ID);

    let signed = transaction::build_and_sign_v5_transaction(
        &params.private_key_hex,
        &params.utxos,
        &params.to_address,
        params.amount_zatoshis,
        params.current_block_height,
        branch_id,
        params.anchor_hex.as_deref(),
    )
    .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&signed).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[derive(Serialize, Deserialize)]
pub struct ShieldingTxParams {
    pub private_key_hex: String,
    pub utxos: Vec<transaction::UtxoInput>,
    pub to_orchard_address: String,
    pub amount_zatoshis: u64,
    pub memo: Option<String>,
    pub current_block_height: u32,
    pub consensus_branch_id: Option<u32>,
    pub anchor_hex: Option<String>,
}

#[wasm_bindgen]
pub fn build_v5_shielding_transaction(params_val: JsValue) -> Result<JsValue, JsValue> {
    let params: ShieldingTxParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid shielding parameters: {}", e)))?;

    let branch_id = params
        .consensus_branch_id
        .unwrap_or(transaction::MAINNET_NU5_BRANCH_ID);

    let signed = transaction::build_v5_shielding_transaction(
        &params.private_key_hex,
        &params.utxos,
        &params.to_orchard_address,
        params.amount_zatoshis,
        params.memo.as_deref(),
        params.current_block_height,
        branch_id,
        params.anchor_hex.as_deref(),
    )
    .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&signed).map_err(|e| JsValue::from_str(&e.to_string()))
}


#[wasm_bindgen]
pub fn derive_orchard_account(mnemonic: &str, account_index: u32, network: &str) -> Result<JsValue, JsValue> {
    let account = orchard_wallet::derive_orchard_account(mnemonic, account_index, network)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&account).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[derive(Serialize, Deserialize)]
pub struct OrchardBundleParams {
    pub spending_key_hex: String,
    pub recipient_address: String, // raw 43 bytes hex, or unified address
    pub amount_zatoshis: u64,
    pub memo: Option<String>,
    pub anchor_hex: String,
    pub sighash_hex: String,
}

#[wasm_bindgen]
pub fn build_and_prove_orchard_bundle(params_val: JsValue) -> Result<JsValue, JsValue> {
    let params: OrchardBundleParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid orchard parameters: {}", e)))?;

    let sk_bytes = hex::decode(&params.spending_key_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid spending key hex: {}", e)))?;
    if sk_bytes.len() != 32 {
        return Err(JsValue::from_str("Spending key must be 32 bytes"));
    }
    let mut sk_arr = [0u8; 32];
    sk_arr.copy_from_slice(&sk_bytes);

    let recip_bytes = if params.recipient_address.starts_with('u') {
        let receivers = unified_address::decode_unified_address(&params.recipient_address)
            .map_err(|e| JsValue::from_str(&format!("Invalid recipient unified address: {}", e)))?;
        receivers.orchard.ok_or_else(|| JsValue::from_str("Recipient unified address contains no Orchard receiver"))?
    } else {
        let raw = hex::decode(&params.recipient_address)
            .map_err(|e| JsValue::from_str(&format!("Invalid recipient hex: {}", e)))?;
        if raw.len() != 43 {
            return Err(JsValue::from_str("Recipient orchard address must be 43 bytes"));
        }
        let mut r = [0u8; 43];
        r.copy_from_slice(&raw);
        r
    };

    let anchor_bytes = hex::decode(&params.anchor_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid anchor hex: {}", e)))?;
    if anchor_bytes.len() != 32 {
        return Err(JsValue::from_str("Anchor must be 32 bytes"));
    }
    let mut anchor_arr = [0u8; 32];
    anchor_arr.copy_from_slice(&anchor_bytes);

    let sighash_bytes = hex::decode(&params.sighash_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid sighash hex: {}", e)))?;
    if sighash_bytes.len() != 32 {
        return Err(JsValue::from_str("Sighash must be 32 bytes"));
    }
    let mut sighash_arr = [0u8; 32];
    sighash_arr.copy_from_slice(&sighash_bytes);

    let bundle = orchard_wallet::build_and_prove_orchard_bundle(
        &sk_arr,
        &recip_bytes,
        params.amount_zatoshis,
        params.memo.as_deref(),
        &anchor_arr,
        &sighash_arr,
    )
    .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&bundle).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn decode_unified_address(ua: &str) -> Result<JsValue, JsValue> {
    #[derive(Serialize)]
    struct UaOutput {
        p2pkh_hex: Option<String>,
        orchard_raw_hex: Option<String>,
    }

    let receivers = unified_address::decode_unified_address(ua)
        .map_err(|e| JsValue::from_str(&e))?;

    let out = UaOutput {
        p2pkh_hex: receivers.p2pkh.map(|p| hex::encode(p)),
        orchard_raw_hex: receivers.orchard.map(|o| hex::encode(o)),
    };

    serde_wasm_bindgen::to_value(&out).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn export_unified_full_viewing_key(mnemonic: &str, account_index: u32, network: &str) -> Result<String, JsValue> {
    let acc = orchard_wallet::derive_orchard_account(mnemonic, account_index, network)
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(acc.unified_full_viewing_key)
}

#[wasm_bindgen]
pub fn decode_unified_full_viewing_key(ufvk: &str) -> Result<JsValue, JsValue> {
    let decoded = unified_address::decode_unified_full_viewing_key(ufvk)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&decoded).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn derive_address_from_ufvk(ufvk: &str, diversifier_index: u32, network: &str) -> Result<String, JsValue> {
    orchard_wallet::derive_address_from_ufvk(ufvk, diversifier_index, network)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn tree_append_commitments(commitments_hex: Vec<String>) -> Result<String, JsValue> {
    let mut leaves = Vec::with_capacity(commitments_hex.len());
    for s in commitments_hex {
        let b = hex::decode(&s).map_err(|e| JsValue::from_str(&format!("Invalid commitment hex: {}", e)))?;
        if b.len() != 32 {
            return Err(JsValue::from_str("Commitment leaf must be 32 bytes"));
        }
        let mut leaf = [0u8; 32];
        leaf.copy_from_slice(&b);
        leaves.push(leaf);
    }

    let mut tree_guard = tree_manager::GLOBAL_ORCHARD_TREE.lock()
        .map_err(|_| JsValue::from_str("Failed to lock global Orchard tree"))?;
    let anchor = tree_guard.append_commitments(&leaves)
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(hex::encode(anchor))
}

#[wasm_bindgen]
pub fn tree_track_note(cm_hex: &str) -> Result<(), JsValue> {
    let b = hex::decode(cm_hex).map_err(|e| JsValue::from_str(&format!("Invalid cmx hex: {}", e)))?;
    if b.len() != 32 {
        return Err(JsValue::from_str("Commitment must be 32 bytes"));
    }
    let mut cm = [0u8; 32];
    cm.copy_from_slice(&b);

    let mut tree_guard = tree_manager::GLOBAL_ORCHARD_TREE.lock()
        .map_err(|_| JsValue::from_str("Failed to lock global Orchard tree"))?;
    tree_guard.track_note(&cm).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn tree_get_witness_for_note(cm_hex: &str) -> Result<JsValue, JsValue> {
    #[derive(Serialize)]
    struct MerklePathOutput {
        position: u32,
        auth_path_hashes_hex: Vec<String>,
        root_hex: String,
    }

    let b = hex::decode(cm_hex).map_err(|e| JsValue::from_str(&format!("Invalid cmx hex: {}", e)))?;
    if b.len() != 32 {
        return Err(JsValue::from_str("Commitment must be 32 bytes"));
    }
    let mut cm = [0u8; 32];
    cm.copy_from_slice(&b);

    let tree_guard = tree_manager::GLOBAL_ORCHARD_TREE.lock()
        .map_err(|_| JsValue::from_str("Failed to lock global Orchard tree"))?;

    let merkle_path = tree_guard.get_witness_for_note(&cm).map_err(|e| JsValue::from_str(&e))?;
    let position = merkle_path.position();
    let auth_path_hashes_hex: Vec<String> = merkle_path.auth_path()
        .iter()
        .map(|h| hex::encode(h.to_bytes()))
        .collect();

    let opt_cmx: Option<orchard::note::ExtractedNoteCommitment> = orchard::note::ExtractedNoteCommitment::from_bytes(&cm).into();
    let cmx = opt_cmx.ok_or_else(|| JsValue::from_str("Failed to parse extracted commitment"))?;
    let root = merkle_path.root(cmx);
    let root_hex = hex::encode(root.to_bytes());

    let out = MerklePathOutput {
        position,
        auth_path_hashes_hex,
        root_hex,
    };

    serde_wasm_bindgen::to_value(&out).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn tree_get_anchor() -> Result<String, JsValue> {
    let tree_guard = tree_manager::GLOBAL_ORCHARD_TREE.lock()
        .map_err(|_| JsValue::from_str("Failed to lock global Orchard tree"))?;
    Ok(hex::encode(tree_guard.current_anchor()))
}

#[wasm_bindgen]
pub fn tree_create_checkpoint(height: u32, block_hash_hex: &str) -> Result<(), JsValue> {
    let b = hex::decode(block_hash_hex).map_err(|e| JsValue::from_str(&format!("Invalid block hash hex: {}", e)))?;
    if b.len() != 32 {
        return Err(JsValue::from_str("Block hash must be 32 bytes"));
    }
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&b);

    let mut tree_guard = tree_manager::GLOBAL_ORCHARD_TREE.lock()
        .map_err(|_| JsValue::from_str("Failed to lock global Orchard tree"))?;
    tree_guard.create_checkpoint(height, hash);
    Ok(())
}

#[wasm_bindgen]
pub fn tree_rewind_to_height(target_height: u32) -> Result<String, JsValue> {
    let mut tree_guard = tree_manager::GLOBAL_ORCHARD_TREE.lock()
        .map_err(|_| JsValue::from_str("Failed to lock global Orchard tree"))?;
    let anchor = tree_guard.rewind_to_height(target_height)
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(hex::encode(anchor))
}

#[wasm_bindgen]
pub fn tree_export_state() -> Result<JsValue, JsValue> {
    let tree_guard = tree_manager::GLOBAL_ORCHARD_TREE.lock()
        .map_err(|_| JsValue::from_str("Failed to lock global Orchard tree"))?;
    let state = tree_guard.export_state();
    serde_wasm_bindgen::to_value(&state).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn tree_import_state(state_val: JsValue) -> Result<(), JsValue> {
    let ser: tree_manager::SerializedTreeManager = serde_wasm_bindgen::from_value(state_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid tree state: {}", e)))?;
    let manager = tree_manager::OrchardTreeManager::import_state(ser)
        .map_err(|e| JsValue::from_str(&e))?;
    let mut tree_guard = tree_manager::GLOBAL_ORCHARD_TREE.lock()
        .map_err(|_| JsValue::from_str("Failed to lock global Orchard tree"))?;
    *tree_guard = manager;
    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct SpendBundleParams {
    pub spends: Vec<orchard_wallet::SpendNoteInput>,
    pub recipient_address: Option<String>,
    pub amount_zatoshis: u64,
    pub memo: Option<String>,
    pub change_address: Option<String>,
    pub change_zatoshis: u64,
    pub anchor_hex: String,
    pub sighash_hex: Option<String>,
    pub expiry_height: Option<u32>,
    pub consensus_branch_id: Option<u32>,
    pub lock_time: Option<u32>,
}

#[wasm_bindgen]
pub fn build_and_prove_orchard_spend(params_val: JsValue) -> Result<JsValue, JsValue> {
    let params: SpendBundleParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid spend parameters: {}", e)))?;

    let recip_bytes = if let Some(ref addr) = params.recipient_address {
        if addr.starts_with('u') {
            let receivers = unified_address::decode_unified_address(addr)
                .map_err(|e| JsValue::from_str(&format!("Invalid recipient unified address: {}", e)))?;
            receivers.orchard
        } else {
            let raw = hex::decode(addr)
                .map_err(|e| JsValue::from_str(&format!("Invalid recipient hex: {}", e)))?;
            if raw.len() != 43 {
                return Err(JsValue::from_str("Recipient address must be 43 bytes"));
            }
            let mut r = [0u8; 43];
            r.copy_from_slice(&raw);
            Some(r)
        }
    } else {
        None
    };

    let change_bytes = if let Some(ref addr) = params.change_address {
        if addr.starts_with('u') {
            let receivers = unified_address::decode_unified_address(addr)
                .map_err(|e| JsValue::from_str(&format!("Invalid change unified address: {}", e)))?;
            receivers.orchard
        } else {
            let raw = hex::decode(addr)
                .map_err(|e| JsValue::from_str(&format!("Invalid change hex: {}", e)))?;
            if raw.len() != 43 {
                return Err(JsValue::from_str("Change address must be 43 bytes"));
            }
            let mut r = [0u8; 43];
            r.copy_from_slice(&raw);
            Some(r)
        }
    } else {
        None
    };

    let anchor_bytes = hex::decode(&params.anchor_hex)
        .map_err(|e| JsValue::from_str(&format!("Invalid anchor hex: {}", e)))?;
    if anchor_bytes.len() != 32 {
        return Err(JsValue::from_str("Anchor must be 32 bytes"));
    }
    let mut anchor_arr = [0u8; 32];
    anchor_arr.copy_from_slice(&anchor_bytes);

    let sighash_arr = if let Some(ref sh_hex) = params.sighash_hex {
        if let Ok(b) = hex::decode(sh_hex) {
            if b.len() == 32 {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&b);
                Some(arr)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let bundle = orchard_wallet::build_and_prove_orchard_spend(
        &params.spends,
        recip_bytes.as_ref(),
        params.amount_zatoshis,
        params.memo.as_deref(),
        change_bytes.as_ref(),
        params.change_zatoshis,
        &anchor_arr,
        sighash_arr.as_ref(),
        params.expiry_height,
        params.consensus_branch_id,
        params.lock_time,
    )
    .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&bundle).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[derive(Serialize, Deserialize)]
pub struct DecryptNoteParams {
    pub fvk_hex: String,
    pub nullifier_hex: String,
    pub cmx_hex: String,
    pub epk_hex: String,
    pub enc_ciphertext_hex: String,
}

#[wasm_bindgen]
pub fn try_decrypt_orchard_output(params_val: JsValue) -> Result<JsValue, JsValue> {
    let params: DecryptNoteParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid decrypt parameters: {}", e)))?;

    let nf_vec = hex::decode(&params.nullifier_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let cmx_vec = hex::decode(&params.cmx_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let epk_vec = hex::decode(&params.epk_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let enc_vec = hex::decode(&params.enc_ciphertext_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;

    if nf_vec.len() != 32 || cmx_vec.len() != 32 || epk_vec.len() != 32 {
        return Err(JsValue::from_str("nullifier, cmx, and epk must be 32 bytes"));
    }

    let mut nf = [0u8; 32];
    nf.copy_from_slice(&nf_vec);
    let mut cmx = [0u8; 32];
    cmx.copy_from_slice(&cmx_vec);
    let mut epk = [0u8; 32];
    epk.copy_from_slice(&epk_vec);

    let res = orchard_wallet::try_decrypt_orchard_output(&params.fvk_hex, &nf, &cmx, &epk, &enc_vec)
        .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&res).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[derive(Serialize, Deserialize)]
pub struct RecoverOvkParams {
    pub fvk_or_ovk_hex: String,
    pub cv_net_hex: String,
    pub cmx_hex: String,
    pub epk_hex: String,
    pub enc_ciphertext_hex: String,
    pub out_ciphertext_hex: String,
    pub nullifier_hex: String,
}

#[wasm_bindgen]
pub fn recover_outgoing_orchard_output(params_val: JsValue) -> Result<JsValue, JsValue> {
    let params: RecoverOvkParams = serde_wasm_bindgen::from_value(params_val)
        .map_err(|e| JsValue::from_str(&format!("Invalid recovery parameters: {}", e)))?;

    let cv_vec = hex::decode(&params.cv_net_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let cmx_vec = hex::decode(&params.cmx_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let epk_vec = hex::decode(&params.epk_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let enc_vec = hex::decode(&params.enc_ciphertext_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let out_vec = hex::decode(&params.out_ciphertext_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let nf_vec = hex::decode(&params.nullifier_hex).map_err(|e| JsValue::from_str(&e.to_string()))?;

    if cv_vec.len() != 32 || cmx_vec.len() != 32 || epk_vec.len() != 32 || nf_vec.len() != 32 {
        return Err(JsValue::from_str("cv_net, cmx, epk, and nullifier must be 32 bytes"));
    }
    if enc_vec.len() != 580 {
        return Err(JsValue::from_str("enc_ciphertext must be 580 bytes"));
    }
    if out_vec.len() != 80 {
        return Err(JsValue::from_str("out_ciphertext must be 80 bytes"));
    }

    let mut cv = [0u8; 32];
    cv.copy_from_slice(&cv_vec);
    let mut cmx = [0u8; 32];
    cmx.copy_from_slice(&cmx_vec);
    let mut epk = [0u8; 32];
    epk.copy_from_slice(&epk_vec);
    let mut enc = [0u8; 580];
    enc.copy_from_slice(&enc_vec);
    let mut out = [0u8; 80];
    out.copy_from_slice(&out_vec);
    let mut nf = [0u8; 32];
    nf.copy_from_slice(&nf_vec);

    let res = orchard_wallet::recover_outgoing_orchard_action(
        &params.fvk_or_ovk_hex,
        &cv,
        &cmx,
        &epk,
        &enc,
        &out,
        &nf,
    )
    .map_err(|e| JsValue::from_str(&e))?;

    serde_wasm_bindgen::to_value(&res).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn get_active_branch_ids() -> JsValue {
    #[derive(Serialize)]
    struct BranchIds {
        ironwood_testnet: String,
        nu7_testnet: String,
        nu5_mainnet: String,
    }

    let ids = BranchIds {
        ironwood_testnet: format!("0x{:08x}", transaction::TESTNET_IRONWOOD_BRANCH_ID),
        nu7_testnet: format!("0x{:08x}", transaction::TESTNET_NU7_BRANCH_ID),
        nu5_mainnet: format!("0x{:08x}", transaction::MAINNET_NU5_BRANCH_ID),
    };

    serde_wasm_bindgen::to_value(&ids).unwrap_or(JsValue::NULL)
}
