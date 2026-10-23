use std::fs;
use incrementalmerkletree::Hashable;
use orchard::{
    builder::{Builder, BundleType},
    bundle::{BatchValidator, BundleVersion},
    circuit::ProvingKey,
    keys::{FullViewingKey, SpendAuthorizingKey, SpendingKey},
    note::{Note, NoteVersion, RandomSeed, Rho},
    tree::{Anchor, MerkleHashOrchard, MerklePath},
    value::NoteValue,
    Address,
};
use veilx_wallet::{
    orchard_wallet::{ORCHARD_PROVING_KEY, ORCHARD_VERIFYING_KEY},
    pczt_escrow::CreateEscrowPcztParams,
};
use zcash_protocol::{
    consensus::{BlockHeight, BranchId},
    value::ZatBalance,
};
use zcash_primitives::transaction::sighash::{PrecomputedSighashData, SignableInput};

#[test]
fn test_perfect_v6_flow() {
    let json_str = fs::read_to_string("tests/pczt_params.json").expect("reads params");
    let params: CreateEscrowPcztParams = serde_json::from_str(&json_str).expect("parses params");

    let mut rng = rand::rng();

    // 1. Decode escrow FVK
    let fvk_bytes = hex::decode(&params.escrow_fvk_hex).unwrap();
    let mut fvk_arr = [0u8; 96];
    fvk_arr.copy_from_slice(&fvk_bytes);
    let escrow_fvk = FullViewingKey::from_bytes(&fvk_arr).unwrap();

    // 2. Decode note recipient address
    let note_recip_bytes = hex::decode(&params.note_recipient_address_hex).unwrap();
    let mut note_recip_arr = [0u8; 43];
    note_recip_arr.copy_from_slice(&note_recip_bytes);
    let note_recipient = Address::from_raw_address_bytes(&note_recip_arr).into_option().unwrap();

    // 3. Decode Rho and Rseed
    let rho_bytes = hex::decode(&params.note_rho_hex).unwrap();
    let mut rho_arr = [0u8; 32];
    rho_arr.copy_from_slice(&rho_bytes);
    let rho = Rho::from_bytes(&rho_arr).into_option().unwrap();

    let rseed_bytes = hex::decode(&params.note_rseed_hex).unwrap();
    let mut rseed_arr = [0u8; 32];
    rseed_arr.copy_from_slice(&rseed_bytes);
    let rseed = RandomSeed::from_bytes(rseed_arr, &rho).into_option().unwrap();

    // 4. Decode 32-level Merkle path
    let mut auth_path_arr = [MerkleHashOrchard::empty_leaf(); 32];
    for (i, hash_hex) in params.auth_path_hashes_hex.iter().enumerate().take(32) {
        let b = hex::decode(hash_hex).unwrap();
        let mut h_arr = [0u8; 32];
        h_arr.copy_from_slice(&b);
        let opt: Option<MerkleHashOrchard> = MerkleHashOrchard::from_bytes(&h_arr).into();
        auth_path_arr[i] = opt.unwrap();
    }
    let merkle_path = MerklePath::from_parts(params.auth_path_position, auth_path_arr);

    // 5. Decode Anchor
    let anchor_bytes = hex::decode(&params.anchor_hex).unwrap();
    let mut anchor_arr = [0u8; 32];
    anchor_arr.copy_from_slice(&anchor_bytes);
    let anchor = Anchor::from_bytes(anchor_arr).into_option().unwrap();

    // 6. Construct Note
    let note_value = NoteValue::from_raw(params.note_value_zatoshis);
    let note = Note::from_parts(note_recipient, note_value, rho, rseed, NoteVersion::V3).into_option().unwrap();

    // 7. Builder
    let bundle_version = BundleVersion::ironwood_v3();
    let flags = bundle_version.default_flags();
    let mut builder = Builder::new(BundleType::DEFAULT, bundle_version, flags, anchor).unwrap();

    builder.add_spend(escrow_fvk, note, merkle_path).unwrap();

    let payout_recip_bytes = hex::decode(&params.payout_recipient_address_hex).unwrap();
    let mut payout_recip_arr = [0u8; 43];
    payout_recip_arr.copy_from_slice(&payout_recip_bytes);
    let payout_recipient = Address::from_raw_address_bytes(&payout_recip_arr).into_option().unwrap();
    let payout_value = NoteValue::from_raw(params.payout_value_zatoshis);
    let mut memo = [0u8; 512];
    memo[..10].copy_from_slice(b"test memo!");

    builder.add_output(None, payout_recipient, payout_value, memo).unwrap();

    let (mut pczt_bundle, _meta) = builder.build_for_pczt(&mut rng).unwrap();

    // Proof creation
    let pk: &ProvingKey = &*ORCHARD_PROVING_KEY;
    pczt_bundle.create_proof(pk, &mut rng).unwrap();

    // Extract effects to compute canonical consensus sighash!
    let expiry_height: u32 = 3526662;
    let ironwood_effects = pczt_bundle.extract_effects::<ZatBalance>().unwrap().unwrap();
    let ironwood_comm: [u8; 32] = ironwood_effects.commitment(orchard::bundle::TxVersion::V6).unwrap().into();

    let mut header_data = Vec::with_capacity(20);
    header_data.extend_from_slice(&0x80000006u32.to_le_bytes());
    header_data.extend_from_slice(&0xd884b698u32.to_le_bytes());
    header_data.extend_from_slice(&0x37a5165bu32.to_le_bytes());
    header_data.extend_from_slice(&0u32.to_le_bytes());
    header_data.extend_from_slice(&expiry_height.to_le_bytes());
    let header_digest = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(b"ZTxIdHeadersHash")
        .hash(&header_data);

    let transparent_digest = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(b"ZTxIdTranspaHash")
        .hash(&[]);

    let sapling_digest = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(b"ZTxIdSaplingHash")
        .hash(&[]);

    let empty_orchard = orchard::bundle::commitments::hash_bundle_txid_empty(
        orchard::ValuePool::Orchard,
        orchard::bundle::TxVersion::V6,
    ).unwrap();

    let mut personal = [0u8; 16];
    personal[..12].copy_from_slice(b"ZcashTxHash_");
    personal[12..].copy_from_slice(&0x37a5165bu32.to_le_bytes());

    let mut state = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(&personal)
        .to_state();

    state.update(header_digest.as_bytes());
    state.update(transparent_digest.as_bytes());
    state.update(sapling_digest.as_bytes());
    state.update(empty_orchard.as_bytes());
    state.update(&ironwood_comm);

    let res = state.finalize();
    let canonical_sighash: [u8; 32] = res.as_bytes().try_into().unwrap();
    println!(">>> Canonical consensus sighash computed: {} <<<", hex::encode(canonical_sighash));

    // Finalize IO and sign with escrow ask for canonical_sighash!
    pczt_bundle.finalize_io(canonical_sighash, &mut rng).unwrap();

    let sk_hex = "1f801ff6ed306fbd3680a5ff270bfe9d664dd2c2cc6fe1fe034648869725a4e9";
    let sk_bytes = hex::decode(sk_hex).unwrap();
    let mut sk_arr = [0u8; 32];
    sk_arr.copy_from_slice(&sk_bytes);
    let escrow_sk = SpendingKey::from_bytes(sk_arr).into_option().unwrap();
    let escrow_ask = SpendAuthorizingKey::from(&escrow_sk);

    for action in pczt_bundle.actions_mut() {
        if action.spend().spend_auth_sig().is_none() {
            action.sign(canonical_sighash, &escrow_ask, &mut rng).unwrap();
        }
    }

    let bundle = pczt_bundle.extract::<ZatBalance>().unwrap().unwrap();
    let authorized_bundle = bundle.apply_binding_signature(canonical_sighash, &mut rng).unwrap();

    // Batch validate with the canonical sighash!
    println!("Validating with BatchValidator against canonical sighash...");
    let mut validator = BatchValidator::new(&*ORCHARD_VERIFYING_KEY);
    validator.add_bundle(&authorized_bundle, canonical_sighash).unwrap();
    let is_valid = validator.validate(&mut rng);
    println!(">>> BatchValidator against canonical sighash is_valid: {} <<<", is_valid);
    assert!(is_valid);

    // Freeze authorized transaction data into canonical Transaction & wire bytes
    let auth_tx_data: zcash_primitives::transaction::TransactionData<zcash_primitives::transaction::Authorized> =
        zcash_primitives::transaction::TransactionData::from_parts_v6(
            BranchId::Nu6_3,
            0, // lock_time
            BlockHeight::from_u32(expiry_height),
            None,
            None,
            None,
            Some(authorized_bundle),
        );
    let tx = auth_tx_data.freeze().unwrap();
    let mut raw_bytes = Vec::new();
    tx.write(&mut raw_bytes).unwrap();
    println!(">>> Canonical raw transaction wire length: {} bytes <<<", raw_bytes.len());
    println!(">>> Canonical txid: {} <<<", tx.txid());

    // Compare with wire serialization logic
    let mut manual_raw = Vec::new();
    manual_raw.extend_from_slice(&0x80000006u32.to_le_bytes()); // overwintered + v6
    manual_raw.extend_from_slice(&0xd884b698u32.to_le_bytes()); // versionGroupId
    manual_raw.extend_from_slice(&0x37a5165bu32.to_le_bytes()); // consensus_branch_id
    manual_raw.extend_from_slice(&0u32.to_le_bytes()); // lockTime
    manual_raw.extend_from_slice(&expiry_height.to_le_bytes());
    manual_raw.push(0x00); // transparent inputs (0)
    manual_raw.push(0x00); // transparent outputs (0)
    manual_raw.push(0x00); // sapling spends (0)
    manual_raw.push(0x00); // sapling outputs (0)
    manual_raw.push(0x00); // orchard actions (0)

    let ironwood_actions_len = tx.ironwood_bundle().unwrap().actions().len();
    manual_raw.push(ironwood_actions_len as u8);

    for act in tx.ironwood_bundle().unwrap().actions() {
        manual_raw.extend_from_slice(&act.cv_net().to_bytes());
        manual_raw.extend_from_slice(&act.nullifier().to_bytes());
        manual_raw.extend_from_slice(&<[u8; 32]>::from(act.rk()));
        manual_raw.extend_from_slice(&act.cmx().to_bytes());
        manual_raw.extend_from_slice(&act.encrypted_note().epk_bytes);
        manual_raw.extend_from_slice(&act.encrypted_note().enc_ciphertext.0[..]);
        manual_raw.extend_from_slice(&act.encrypted_note().out_ciphertext[..]);
    }

    manual_raw.push(tx.ironwood_bundle().unwrap().flag_byte());
    manual_raw.extend_from_slice(&tx.ironwood_bundle().unwrap().value_balance().to_i64_le_bytes());
    manual_raw.extend_from_slice(&tx.ironwood_bundle().unwrap().anchor().to_bytes());

    let proof_bytes = tx.ironwood_bundle().unwrap().authorization().proof().as_ref();
    let proof_len = proof_bytes.len();
    if proof_len < 253 {
        manual_raw.push(proof_len as u8);
    } else {
        manual_raw.push(0xfd);
        manual_raw.extend_from_slice(&(proof_len as u16).to_le_bytes());
    }
    manual_raw.extend_from_slice(proof_bytes);

    for act in tx.ironwood_bundle().unwrap().actions() {
        manual_raw.extend_from_slice(&<[u8; 64]>::from(act.authorization()));
    }
    manual_raw.extend_from_slice(&<[u8; 64]>::from(tx.ironwood_bundle().unwrap().authorization().binding_signature()));

    println!(">>> Manual wire length: {} bytes <<<", manual_raw.len());
    assert_eq!(manual_raw, raw_bytes);
    println!(">>> MANUAL WIRE FORMAT 100% BYTE-FOR-BYTE IDENTICAL TO CANONICAL V6 TRANSACTION! <<<");
}
