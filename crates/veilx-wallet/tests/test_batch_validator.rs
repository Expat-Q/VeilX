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

#[test]
fn test_validate_local_bundle() {
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

    let sighash_bytes = hex::decode(&params.sighash_hex).unwrap();
    let mut sighash_arr = [0u8; 32];
    sighash_arr.copy_from_slice(&sighash_bytes);

    pczt_bundle.finalize_io(sighash_arr, &mut rng).unwrap();

    let pk: &ProvingKey = &*ORCHARD_PROVING_KEY;
    pczt_bundle.create_proof(pk, &mut rng).unwrap();

    let sk_hex = "1f801ff6ed306fbd3680a5ff270bfe9d664dd2c2cc6fe1fe034648869725a4e9";
    let sk_bytes = hex::decode(sk_hex).unwrap();
    let mut sk_arr = [0u8; 32];
    sk_arr.copy_from_slice(&sk_bytes);
    let escrow_sk = SpendingKey::from_bytes(sk_arr).into_option().unwrap();
    let escrow_ask = SpendAuthorizingKey::from(&escrow_sk);

    for action in pczt_bundle.actions_mut() {
        if action.spend().spend_auth_sig().is_none() {
            action.sign(sighash_arr, &escrow_ask, &mut rng).unwrap();
        }
    }

    let bundle = pczt_bundle.extract::<i64>().unwrap().unwrap();
    let authorized_bundle = bundle.apply_binding_signature(sighash_arr, &mut rng).unwrap();

    println!("Testing BatchValidator with PostNu6_3 verifying key...");
    let mut validator = BatchValidator::new(&*ORCHARD_VERIFYING_KEY);
    validator.add_bundle(&authorized_bundle, sighash_arr).expect("adds bundle cleanly");
    let is_valid = validator.validate(&mut rng);
    println!(">>> BatchValidator is_valid: {} <<<", is_valid);
    assert!(is_valid);
}
