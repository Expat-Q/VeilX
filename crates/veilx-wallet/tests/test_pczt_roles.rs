use pczt::{roles::creator::Creator, roles::signer::Signer, Pczt};

#[test]
fn test_creator_and_signer_sighash() {
    let consensus_branch_id = 0x37a5165b;
    let expiry_height = 3526662;
    let coin_type = 133; // Zcash mainnet

    let creator = Creator::new(consensus_branch_id, expiry_height, coin_type, None, None).unwrap();
    let pczt: Pczt = creator.build().unwrap();

    let bytes = pczt.serialize().unwrap();
    let pczt_parsed = Pczt::parse(&bytes).unwrap();
    println!("PCZT serialized len: {}", bytes.len());

    let signer = Signer::new(pczt_parsed).unwrap();
    let sighash = signer.shielded_sighash();
    println!("Empty PCZT shielded sighash: {}", hex::encode(sighash));
}
