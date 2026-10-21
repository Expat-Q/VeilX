use incrementalmerkletree::{frontier::CommitmentTree, witness::IncrementalWitness};
use orchard::tree::MerkleHashOrchard;
use veilx_wallet::orchard_wallet::{build_and_prove_orchard_spend, SpendNoteInput};
use veilx_wallet::tree_manager::GLOBAL_ORCHARD_TREE;

#[test]
fn test_live_mainnet_shielded_spend() {
    println!("============================================================");
    println!("Step 1: Setting up Tree State & Witness for Note 49bdafee...");
    println!("============================================================");

    // Tree state right before block 3522913 (block 3522912)
    let state_hex = "01f5bc16e4289f4b7d0426a841720a24d01cf42b97a12e90fb8bfec7716693da3a01b8c9f245c5c201c455211faeb82ca32be5942d99749c53458d511fac5bc1b23b1f0147b054809733307c9ec5a431fdb72d9674f74f2c0ed47b772b14a613e41092130000000001b9258823bd174d50467b9c199fd14b859cf0e5af92078c76be4bdf040caf0728000000000001ad927055ebc72a4ebaa0a2fdbdf848dcbde478c5814613e3142ec4f7dff45634000110690d8ea35cc47685a0f6d6d82a11d1ff22a36c410769570b518b3175227d27000000019844c931c19fb7c8170d8423ad63fc585c2e67ba92c8af9bf5706bef1bbd2505012c2dcb40357e27f39d1bae2f39a755c31f09814123d54c3056004fb3304c1526000000000000000000000000";
    let state_bytes = hex::decode(state_hex).unwrap();
    let mut offset = 0;

    let has_left = state_bytes[offset] == 1; offset += 1;
    let left = if has_left {
        let mut h = [0u8; 32]; h.copy_from_slice(&state_bytes[offset..offset + 32]); offset += 32;
        Some(MerkleHashOrchard::from_bytes(&h).into_option().unwrap())
    } else { None };

    let has_right = state_bytes[offset] == 1; offset += 1;
    let right = if has_right {
        let mut h = [0u8; 32]; h.copy_from_slice(&state_bytes[offset..offset + 32]); offset += 32;
        Some(MerkleHashOrchard::from_bytes(&h).into_option().unwrap())
    } else { None };

    let parents_len = state_bytes[offset] as usize; offset += 1;
    let mut parents = Vec::new();
    for _ in 0..parents_len {
        let has_p = state_bytes[offset] == 1; offset += 1;
        if has_p {
            let mut h = [0u8; 32]; h.copy_from_slice(&state_bytes[offset..offset + 32]); offset += 32;
            parents.push(Some(MerkleHashOrchard::from_bytes(&h).into_option().unwrap()));
        } else {
            parents.push(None);
        }
    }

    let mut tree: CommitmentTree<MerkleHashOrchard, 32> = CommitmentTree::from_parts(left, right, parents).unwrap();

    // Append our note's commitment leaf
    let cm1_bytes = hex::decode("5c5b552843c38933b7c2086bfe53aa022911e83e8cfa3d7a82fb628ea74c1f16").unwrap();
    let mut cm1_arr = [0u8; 32]; cm1_arr.copy_from_slice(&cm1_bytes);
    let cm1_leaf = MerkleHashOrchard::from_bytes(&cm1_arr).into_option().unwrap();
    tree.append(cm1_leaf).unwrap();

    // Create witness for our note
    let mut witness = IncrementalWitness::from_tree(tree.clone()).unwrap();

    // Append second commitment in block 3522913
    let cm2_bytes = hex::decode("65c7ba57b1934636afac31a6c6815c9fc9db7c713714aa809c11cf27ad377337").unwrap();
    let mut cm2_arr = [0u8; 32]; cm2_arr.copy_from_slice(&cm2_bytes);
    let cm2_leaf = MerkleHashOrchard::from_bytes(&cm2_arr).into_option().unwrap();
    tree.append(cm2_leaf.clone()).unwrap();
    witness.append(cm2_leaf).unwrap();

    let anchor_bytes = tree.root().to_bytes();

    // Inject into GLOBAL_ORCHARD_TREE
    {
        let mut guard = GLOBAL_ORCHARD_TREE.lock().unwrap();
        guard.tree = tree;
        guard.witnesses.insert(cm1_arr, witness);
    }

    println!("✓ Merkle Path and Anchor registered in GLOBAL_ORCHARD_TREE!");
    println!("  Anchor: {}", hex::encode(anchor_bytes));

    println!("============================================================");
    println!("Step 2: Proving & Signing via build_and_prove_orchard_spend");
    println!("============================================================");

    let spend_input = SpendNoteInput {
        spending_key_hex: "1f801ff6ed306fbd3680a5ff270bfe9d664dd2c2cc6fe1fe034648869725a4e9".to_string(),
        recipient_raw_address_hex: "d9e41871139f8292ec7e2e8b0f73db7c825b453757dc5f9f5185ef7189a63f8f87dd14ff183badb578ba2a".to_string(),
        value_zatoshis: 20_000,
        rho_hex: "d205f2822ecb8584596d0fb7d1fbaa6d730394a13f2d40cfb4c7b42a7498233f".to_string(),
        rseed_hex: "b9394ad71bc846ec6cf1d4e51e2a77092c7ade54d3bb7cc7d7d0c719f13584b5".to_string(),
        cmx_hex: "5c5b552843c38933b7c2086bfe53aa022911e83e8cfa3d7a82fb628ea74c1f16".to_string(),
        auth_path_hex: None,
        position: None,
    };

    let user_recip_bytes = hex::decode("a45dadff0b32a68f8b709edf9f25569f47abe78c20b8025226359b1850505b27c2c23daa77cc96b56f329c").unwrap();
    let mut user_recip_arr = [0u8; 43];
    user_recip_arr.copy_from_slice(&user_recip_bytes);

    let expiry_height = 3525850; // Future block height
    let consensus_branch_id = 0x37a5165b; // NU6

    let result = build_and_prove_orchard_spend(
        &[spend_input],
        Some(&user_recip_arr),
        10_000, // 0.0001 ZEC payout
        Some("VeilX Live Shielded Payout"),
        None,
        0,
        &anchor_bytes,
        None,
        Some(expiry_height),
        Some(consensus_branch_id),
        Some(0),
    ).expect("build_and_prove_orchard_spend succeeded!");

    println!("✓ Halo 2 Proof & Signatures generated and batch-validated!");
    println!("  TxId: {}", result.txid_hex);
    println!("  Sighash: {}", result.sighash_hex);
    println!("  Actions: {}", result.actions.len());

    // Serialize into V6 Consensus Wire format
    let mut raw = Vec::new();
    // 1. Header (0x80000006)
    raw.extend_from_slice(&0x80000006u32.to_le_bytes());
    // 2. VersionGroupId (0xd884b698)
    raw.extend_from_slice(&0xd884b698u32.to_le_bytes());
    // 3. ConsensusBranchId
    raw.extend_from_slice(&consensus_branch_id.to_le_bytes());
    // 4. LockTime (0)
    raw.extend_from_slice(&0u32.to_le_bytes());
    // 5. ExpiryHeight
    raw.extend_from_slice(&expiry_height.to_le_bytes());
    // 6. Transparent inputs (0)
    raw.push(0x00);
    // 7. Transparent outputs (0)
    raw.push(0x00);
    // 8. Sapling spends (0)
    raw.push(0x00);
    // 9. Sapling outputs (0)
    raw.push(0x00);
    // 10. Orchard actions count (0)
    raw.push(0x00);

    // 11. Ironwood actions count
    raw.push(result.actions.len() as u8);
    for act in &result.actions {
        raw.extend_from_slice(&hex::decode(&act.cv_net_hex).unwrap());
        raw.extend_from_slice(&hex::decode(&act.nullifier_hex).unwrap());
        raw.extend_from_slice(&hex::decode(&act.rk_hex).unwrap());
        raw.extend_from_slice(&hex::decode(&act.cmx_hex).unwrap());
        raw.extend_from_slice(&hex::decode(&act.epk_hex).unwrap());
        raw.extend_from_slice(&hex::decode(&act.enc_ciphertext_hex).unwrap());
        raw.extend_from_slice(&hex::decode(&act.out_ciphertext_hex).unwrap());
    }

    // 12. Flags
    raw.push(result.flags);
    // 13. ValueBalance (i64 LE)
    raw.extend_from_slice(&result.value_balance_zatoshis.to_le_bytes());
    // 14. Anchor
    raw.extend_from_slice(&hex::decode(&result.anchor_hex).unwrap());

    // 15. Proof (compact size + bytes)
    let proof_bytes = hex::decode(&result.proof_hex).unwrap();
    let proof_len = proof_bytes.len();
    if proof_len < 253 {
        raw.push(proof_len as u8);
    } else {
        raw.push(0xfd);
        raw.extend_from_slice(&(proof_len as u16).to_le_bytes());
    }
    raw.extend_from_slice(&proof_bytes);

    // 16. SpendAuthSigs
    for sig_hex in &result.spend_auth_sigs_hex {
        raw.extend_from_slice(&hex::decode(sig_hex).unwrap());
    }

    // 17. BindingSig
    raw.extend_from_slice(&hex::decode(&result.binding_sig_hex).unwrap());

    let raw_hex = hex::encode(raw);
    println!("============================================================");
    println!("RAW_TRANSACTION_HEX_START");
    println!("{}", raw_hex);
    println!("RAW_TRANSACTION_HEX_END");
    println!("============================================================");
}
