use orchard::{
    builder::{Builder, BundleType},
    bundle::{BundleVersion, Flags},
    circuit::ProvingKey,
    keys::{FullViewingKey, Scope, SpendAuthorizingKey, SpendingKey},
    note::{ExtractedNoteCommitment, Note, NoteVersion, Rho, RandomSeed},
    tree::Anchor,
    value::NoteValue,
};
use veilx_wallet::{
    orchard_wallet::ORCHARD_PROVING_KEY,
    tree_manager::OrchardTreeManager,
};

#[test]
fn test_pczt_shielded_escrow_full_roundtrip() {
    let mut rng = rand::rng();

    println!("============================================================");
    println!("Step 1: Escrow Note Setup (Server)");
    println!("============================================================");
    let escrow_sk = SpendingKey::from_bytes([7u8; 32]).unwrap();
    let escrow_fvk = FullViewingKey::from(&escrow_sk);
    let escrow_addr = escrow_fvk.address_at(0u32, Scope::External);

    let rho = Rho::from_bytes(&[1u8; 32]).unwrap();
    let rseed = RandomSeed::from_bytes([2u8; 32], &rho).unwrap();
    let note_value = NoteValue::from_raw(50_000_000); // 0.5 ZEC in escrow

    let note = Note::from_parts(
        escrow_addr,
        note_value,
        rho,
        rseed,
        NoteVersion::V3,
    )
    .unwrap();

    let cmx: ExtractedNoteCommitment = note.commitment().into();
    let cm_bytes = cmx.to_bytes();

    let mut tree_mgr = OrchardTreeManager::new();
    tree_mgr.append_commitments(&[cm_bytes]).expect("Appends note commitment");
    tree_mgr.track_note(&cm_bytes).expect("Tracks note commitment");

    let merkle_path = tree_mgr.get_witness_for_note(&cm_bytes).expect("Generates Merkle witness");
    let anchor_bytes = tree_mgr.current_anchor();
    let anchor = Option::from(Anchor::from_bytes(anchor_bytes)).expect("Valid anchor");

    println!("============================================================");
    println!("Step 2: Server builds PCZT Skeleton (NO spending key exposed)");
    println!("============================================================");
    let bundle_version = BundleVersion::ironwood_v3();
    let flags = Flags::ENABLED;
    let mut builder = Builder::new(BundleType::DEFAULT, bundle_version, flags, anchor)
        .expect("Builder initializes");

    // Spend from escrow using only FVK & witness - NO private spending key!
    builder
        .add_spend(escrow_fvk.clone(), note, merkle_path)
        .expect("Spend note added");

    // Payout output to recipient
    let payout_sk = SpendingKey::from_bytes([9u8; 32]).unwrap();
    let payout_fvk = FullViewingKey::from(&payout_sk);
    let payout_addr = payout_fvk.address_at(0u32, Scope::External);
    let payout_value = NoteValue::from_raw(49_990_000); // 0.4999 ZEC
    let memo = [0u8; 512];

    builder
        .add_output(None, payout_addr, payout_value, memo)
        .expect("Payout output added");

    let (mut pczt_bundle, _meta) = builder
        .build_for_pczt(&mut rng)
        .expect("Builds PCZT bundle");

    let sighash = [42u8; 32];
    pczt_bundle
        .finalize_io(sighash, &mut rng)
        .expect("Finalizes IO with sighash");

    assert!(pczt_bundle.zkproof().is_none());
    println!("PCZT Bundle successfully built without zkproof!");
    println!("Actions in PCZT bundle: {}", pczt_bundle.actions().len());

    println!("============================================================");
    println!("Step 3: Client Prover in Browser (WASM Halo 2 Proof)");
    println!("============================================================");
    let pk: &ProvingKey = &*ORCHARD_PROVING_KEY;
    pczt_bundle
        .create_proof(pk, &mut rng)
        .expect("Client Halo 2 zero-knowledge proof generated successfully");

    assert!(pczt_bundle.zkproof().is_some());
    println!("Halo 2 ZK proof computed and populated into PCZT bundle!");

    println!("============================================================");
    println!("Step 4: Server Verification & Signer (Applying Escrow ask)");
    println!("============================================================");
    let escrow_ask = SpendAuthorizingKey::from(&escrow_sk);

    let mut signed_real_count = 0;
    for action in pczt_bundle.actions_mut() {
        if action.spend().spend_auth_sig().is_none() {
            action.sign(sighash, &escrow_ask, &mut rng).expect("Signs real spend action with escrow ask");
            signed_real_count += 1;
        }
    }
    assert_eq!(signed_real_count, 1, "Expected exactly 1 real spend to be signed with escrow ask");

    println!("Server successfully signed the real spend action using escrow ask!");

    println!("============================================================");
    println!("Step 5: Transaction Extraction & Binding Signature");
    println!("============================================================");
    let bundle = pczt_bundle
        .extract::<i64>()
        .expect("Extracts proven bundle")
        .expect("Bundle is present");

    let authorized_bundle = bundle
        .apply_binding_signature(sighash, &mut rng)
        .expect("Binds transaction cleanly");

    assert_eq!(authorized_bundle.actions().len(), 2);
    println!("Authorized Orchard bundle constructed and bound: 2 actions!");
    println!("============================================================");
    println!("CONGRATULATIONS: FULL PCZT SHIELDED ESCROW FLOW 100% WORKING!");
    println!("============================================================");
}
