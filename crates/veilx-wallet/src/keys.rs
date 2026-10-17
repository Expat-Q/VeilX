//! Key Derivation, BIP-39, BIP-44, and Zcash Address Formats

use bip39::Mnemonic;
use hmac::{Hmac, Mac};
use k256::ecdsa::SigningKey;
use k256::elliptic_curve::PrimeField;
use k256::Scalar;
use ripemd::Ripemd160;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha512};

type HmacSha512 = Hmac<Sha512>;

pub const TESTNET_TRANSPARENT_PREFIX: [u8; 2] = [0x1D, 0x25]; // tm...
pub const MAINNET_TRANSPARENT_PREFIX: [u8; 2] = [0x1C, 0xB8]; // t1...
pub const TESTNET_WIF_PREFIX: u8 = 0xEF;
pub const MAINNET_WIF_PREFIX: u8 = 0x80;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DerivedAccount {
    pub address: String,
    pub public_key: String,
    pub private_key: String,
    pub wif: String,
    pub path: String,
    pub network: String,
}

/// Normalizes a seed phrase (trims whitespace, converts to lowercase, replaces multiple spaces).
pub fn normalize_mnemonic(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Generates a new BIP-39 mnemonic phrase.
pub fn generate_mnemonic(word_count: usize) -> Result<String, String> {
    let entropy_len = match word_count {
        12 => 16,
        24 => 32,
        _ => return Err("Word count must be 12 or 24.".to_string()),
    };

    let mut entropy = vec![0u8; entropy_len];
    getrandom::getrandom(&mut entropy).map_err(|e| format!("Entropy generation failed: {}", e))?;

    let mnemonic = Mnemonic::from_entropy(&entropy).map_err(|e| format!("Mnemonic error: {}", e))?;
    Ok(mnemonic.to_string())
}

/// Validates whether a seed phrase is valid English BIP-39.
pub fn validate_mnemonic(phrase: &str) -> bool {
    let normalized = normalize_mnemonic(phrase);
    Mnemonic::parse_normalized(&normalized).is_ok()
}

/// Derives a 64-byte binary seed from a BIP-39 mnemonic.
pub fn mnemonic_to_seed(phrase: &str, passphrase: &str) -> Result<[u8; 64], String> {
    let normalized = normalize_mnemonic(phrase);
    let mnemonic = Mnemonic::parse_normalized(&normalized)
        .map_err(|e| format!("Invalid seed phrase: {}", e))?;
    Ok(mnemonic.to_seed_normalized(passphrase))
}

/// Performs BIP-32 master key derivation from a 64-byte seed.
fn bip32_master_key(seed: &[u8]) -> Result<([u8; 32], [u8; 32]), String> {
    let mut mac = HmacSha512::new_from_slice(b"Bitcoin seed")
        .map_err(|e| format!("HMAC init error: {}", e))?;
    mac.update(seed);
    let result = mac.finalize().into_bytes();

    let mut key = [0u8; 32];
    let mut chain_code = [0u8; 32];
    key.copy_from_slice(&result[0..32]);
    chain_code.copy_from_slice(&result[32..64]);
    Ok((key, chain_code))
}

fn add_bip32_scalars(il: &[u8], parent: &[u8; 32]) -> Result<[u8; 32], String> {
    use k256::elliptic_curve::ops::Reduce;
    use k256::U256;
    let il_u256 = U256::from_be_slice(&il[0..32]);
    let parent_u256 = U256::from_be_slice(parent);
    let il_scalar = <Scalar as Reduce<U256>>::reduce(il_u256);
    let parent_scalar = <Scalar as Reduce<U256>>::reduce(parent_u256);
    let child_scalar = il_scalar + parent_scalar;
    let out: [u8; 32] = child_scalar.to_bytes().into();
    Ok(out)
}

/// Derives a hardened child key: index | 0x80000000.
fn bip32_derive_hardened(parent_key: &[u8; 32], parent_chain: &[u8; 32], index: u32) -> Result<([u8; 32], [u8; 32]), String> {
    let mut data = Vec::with_capacity(37);
    data.push(0x00);
    data.extend_from_slice(parent_key);
    data.extend_from_slice(&(index | 0x8000_0000).to_be_bytes());

    let mut mac = HmacSha512::new_from_slice(parent_chain)
        .map_err(|e| format!("HMAC init error: {}", e))?;
    mac.update(&data);
    let result = mac.finalize().into_bytes();

    let child_key = add_bip32_scalars(&result[0..32], parent_key)?;
    let mut child_chain = [0u8; 32];
    child_chain.copy_from_slice(&result[32..64]);
    Ok((child_key, child_chain))
}

/// Derives a standard non-hardened child key.
fn bip32_derive_normal(parent_key: &[u8; 32], parent_chain: &[u8; 32], index: u32) -> Result<([u8; 32], [u8; 32]), String> {
    let signing_key = SigningKey::from_slice(parent_key)
        .map_err(|e| format!("Invalid signing key: {}", e))?;
    let pubkey_bytes = signing_key.verifying_key().to_sec1_bytes();

    let mut data = Vec::with_capacity(37);
    data.extend_from_slice(&pubkey_bytes);
    data.extend_from_slice(&index.to_be_bytes());

    let mut mac = HmacSha512::new_from_slice(parent_chain)
        .map_err(|e| format!("HMAC init error: {}", e))?;
    mac.update(&data);
    let result = mac.finalize().into_bytes();

    let child_key = add_bip32_scalars(&result[0..32], parent_key)?;
    let mut child_chain = [0u8; 32];
    child_chain.copy_from_slice(&result[32..64]);
    Ok((child_key, child_chain))
}

/// Encodes binary payload with Base58Check including version prefix and double-SHA256 checksum.
pub fn base58_check_encode(prefix: &[u8], payload: &[u8]) -> String {
    let mut combined = Vec::with_capacity(prefix.len() + payload.len() + 4);
    combined.extend_from_slice(prefix);
    combined.extend_from_slice(payload);

    let first = Sha256::digest(&combined);
    let second = Sha256::digest(&first);
    let checksum = &second[0..4];

    combined.extend_from_slice(checksum);
    bs58::encode(combined).into_string()
}

/// Decodes a transparent P2PKH address and extracts the 20-byte hash160.
pub fn transparent_address_to_hash160(address: &str) -> Result<[u8; 20], String> {
    let decoded = bs58::decode(address)
        .into_vec()
        .map_err(|e| format!("Base58 decode error: {}", e))?;

    if decoded.len() != 26 {
        return Err(format!("Invalid address length: expected 26 bytes, got {}", decoded.len()));
    }

    let payload = &decoded[0..22];
    let checksum = &decoded[22..26];
    let hash1 = Sha256::digest(payload);
    let hash2 = Sha256::digest(&hash1);
    if &hash2[0..4] != checksum {
        return Err("Address checksum verification failed.".to_string());
    }

    let mut hash160 = [0u8; 20];
    hash160.copy_from_slice(&decoded[2..22]);
    Ok(hash160)
}

/// Derives a complete BIP-44 Zcash account from a seed.
/// Path: m/44'/coin_type'/account'/0/0
/// coin_type: 1 for Testnet, 133 for Mainnet
pub fn derive_account_from_seed(
    seed: &[u8; 64],
    account_index: u32,
    network: &str,
) -> Result<DerivedAccount, String> {
    let (coin_type, addr_prefix, wif_prefix) = if network.to_lowercase() == "mainnet" {
        (133u32, MAINNET_TRANSPARENT_PREFIX.as_ref(), MAINNET_WIF_PREFIX)
    } else {
        (1u32, TESTNET_TRANSPARENT_PREFIX.as_ref(), TESTNET_WIF_PREFIX)
    };

    // 1. Master key
    let (master_k, master_c) = bip32_master_key(seed)?;

    // 2. Purpose 44'
    let (k44, c44) = bip32_derive_hardened(&master_k, &master_c, 44)?;

    // 3. Coin type (1' or 133')
    let (k_coin, c_coin) = bip32_derive_hardened(&k44, &c44, coin_type)?;

    // 4. Account index'
    let (k_acc, c_acc) = bip32_derive_hardened(&k_coin, &c_coin, account_index)?;

    // 5. Change 0
    let (k_change, c_change) = bip32_derive_normal(&k_acc, &c_acc, 0)?;

    // 6. Address index 0
    let (final_priv_key, _) = bip32_derive_normal(&k_change, &c_change, 0)?;

    // Compute compressed public key
    let signing_key = SigningKey::from_slice(&final_priv_key)
        .map_err(|e| format!("Signing key generation error: {}", e))?;
    let pubkey_bytes = signing_key.verifying_key().to_sec1_bytes();

    // Compute P2PKH hash160 = RIPEMD160(SHA256(pubkey))
    let sha256 = Sha256::digest(&pubkey_bytes);
    let hash160 = Ripemd160::digest(&sha256);

    // Encode transparent address
    let address = base58_check_encode(addr_prefix, &hash160);

    // Encode WIF with 0x01 compressed flag
    let mut wif_payload = Vec::with_capacity(33);
    wif_payload.extend_from_slice(&final_priv_key);
    wif_payload.push(0x01);
    let wif = base58_check_encode(&[wif_prefix], &wif_payload);

    let path = format!("m/44'/{}'/{}'/0/0", coin_type, account_index);

    Ok(DerivedAccount {
        address,
        public_key: hex::encode(&pubkey_bytes),
        private_key: hex::encode(&final_priv_key),
        wif,
        path,
        network: network.to_string(),
    })
}

/// Derives the 65-byte Transparent Account Extended Public Key (FVK) for ZIP-316.
/// Encoded as: 33-byte compressed secp256k1 public key || 32-byte BIP-32 chain code.
pub fn derive_transparent_fvk(
    seed: &[u8; 64],
    account_index: u32,
    network: &str,
) -> Result<[u8; 65], String> {
    let coin_type = if network.to_lowercase() == "mainnet" { 133u32 } else { 1u32 };
    let (master_k, master_c) = bip32_master_key(seed)?;
    let (k44, c44) = bip32_derive_hardened(&master_k, &master_c, 44)?;
    let (k_coin, c_coin) = bip32_derive_hardened(&k44, &c44, coin_type)?;
    let (k_acc, c_acc) = bip32_derive_hardened(&k_coin, &c_coin, account_index)?;

    let signing_key = SigningKey::from_slice(&k_acc)
        .map_err(|e| format!("Account signing key error: {}", e))?;
    let pubkey_bytes = signing_key.verifying_key().to_sec1_bytes();

    let mut tfvk = [0u8; 65];
    tfvk[..33].copy_from_slice(&pubkey_bytes);
    tfvk[33..].copy_from_slice(&c_acc);
    Ok(tfvk)
}

/// Derives a child public key from an extended public key (non-hardened BIP-32).
pub fn bip32_derive_public_normal(
    parent_pubkey: &[u8; 33],
    parent_chain: &[u8; 32],
    index: u32,
) -> Result<([u8; 33], [u8; 32]), String> {
    use k256::elliptic_curve::ops::Reduce;
    use k256::elliptic_curve::sec1::ToEncodedPoint;
    use k256::{AffinePoint, ProjectivePoint, PublicKey, Scalar, U256};

    let mut data = Vec::with_capacity(37);
    data.extend_from_slice(parent_pubkey);
    data.extend_from_slice(&index.to_be_bytes());

    let mut mac = HmacSha512::new_from_slice(parent_chain)
        .map_err(|e| format!("HMAC init error: {}", e))?;
    mac.update(&data);
    let result = mac.finalize().into_bytes();

    let il_u256 = U256::from_be_slice(&result[0..32]);
    let il_scalar = <Scalar as Reduce<U256>>::reduce(il_u256);

    let parent_pk = PublicKey::from_sec1_bytes(parent_pubkey)
        .map_err(|e| format!("Invalid parent pubkey: {}", e))?;
    let parent_proj = ProjectivePoint::from(parent_pk.to_projective());

    let child_proj = (ProjectivePoint::GENERATOR * il_scalar) + parent_proj;
    let child_affine = AffinePoint::from(child_proj);
    let child_pk = PublicKey::try_from(child_affine)
        .map_err(|e| format!("Invalid child point: {:?}", e))?;
    let encoded = child_pk.to_encoded_point(true);

    let mut child_pubkey = [0u8; 33];
    child_pubkey.copy_from_slice(encoded.as_bytes());

    let mut child_chain = [0u8; 32];
    child_chain.copy_from_slice(&result[32..64]);

    Ok((child_pubkey, child_chain))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mnemonic_generation_and_validation() {
        let m12 = generate_mnemonic(12).unwrap();
        assert_eq!(m12.split_whitespace().count(), 12);
        assert!(validate_mnemonic(&m12));

        let m24 = generate_mnemonic(24).unwrap();
        assert_eq!(m24.split_whitespace().count(), 24);
        assert!(validate_mnemonic(&m24));
    }

    #[test]
    fn test_bip44_testnet_derivation() {
        // Standard test vector
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let seed = mnemonic_to_seed(phrase, "").unwrap();
        let account = derive_account_from_seed(&seed, 0, "testnet").unwrap();

        assert!(account.address.starts_with("tm"));
        assert_eq!(account.path, "m/44'/1'/0'/0/0");
        assert_eq!(account.public_key.len(), 66); // 33 bytes compressed hex
        assert_eq!(account.private_key.len(), 64); // 32 bytes hex
    }

    #[test]
    fn test_noir_derivation() {
        let phrase = "unit cute catalog boat diary boring either prefer scorpion prison acoustic road profit believe glove permit march dog beyond clarify thumb obvious galaxy upgrade";
        let seed = mnemonic_to_seed(phrase, "").unwrap();
        let account = derive_account_from_seed(&seed, 0, "mainnet").unwrap();
        println!("Fixed BIP-44 Derived Address: {}", account.address);
        println!("Noir Target Address:         t1TqKnx7kqRU1f8bmZU568m91JLuD7t9rpq");
        assert_eq!(account.address, "t1TqKnx7kqRU1f8bmZU568m91JLuD7t9rpq");
    }
}
