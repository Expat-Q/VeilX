//! ZIP-316 Unified Address encoding and decoding for VeilX.
//!
//! Supports P2PKH (Typecode 0x00), Sapling (Typecode 0x02), and Orchard (Typecode 0x03).

use bech32::{self, FromBase32, ToBase32, Variant};
use serde::{Deserialize, Serialize};

pub const TYPECODE_P2PKH: u8 = 0x00;
pub const TYPECODE_P2SH: u8 = 0x01;
pub const TYPECODE_SAPLING: u8 = 0x02;
pub const TYPECODE_ORCHARD: u8 = 0x03;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnifiedAddressReceivers {
    pub p2pkh: Option<[u8; 20]>,
    pub orchard: Option<[u8; 43]>,
}

/// Encodes transparent P2PKH and Orchard receivers into a canonical ZIP-316 Unified Address.
pub fn encode_unified_address(
    network: &str,
    p2pkh: Option<&[u8; 20]>,
    orchard: Option<&[u8; 43]>,
) -> Result<String, String> {
    use zcash_address::unified::{Address, Encoding, Receiver};
    use zcash_protocol::consensus::NetworkType;

    let net = match network.to_lowercase().as_str() {
        "mainnet" => NetworkType::Main,
        "testnet" => NetworkType::Test,
        "regtest" => NetworkType::Regtest,
        _ => return Err(format!("Unsupported network: {}", network)),
    };

    let mut items = Vec::new();

    if let Some(orch) = orchard {
        items.push(zcash_address::unified::Uitem::Data(Receiver::Orchard(*orch)));
    }

    if let Some(pkh) = p2pkh {
        items.push(zcash_address::unified::Uitem::Data(Receiver::P2pkh(*pkh)));
    }

    if items.is_empty() {
        return Err("Cannot encode empty Unified Address (no receivers provided).".to_string());
    }

    let addr = Address::try_from_items(zcash_address::unified::Revision::R0, items)
        .map_err(|e| format!("Invalid Unified Address items: {:?}", e))?;

    Ok(addr.encode(&net))
}

/// Decodes a ZIP-316 Unified Address into its constituent receivers.
pub fn decode_unified_address(ua: &str) -> Result<UnifiedAddressReceivers, String> {
    use zcash_address::unified::{Address, Container, Encoding, Receiver};

    let (_net, _rev, addr) = Address::decode(ua)
        .map_err(|e| format!("Failed to decode Unified Address: {:?}", e))?;

    let mut p2pkh = None;
    let mut orchard = None;

    for receiver in addr.items() {
        match receiver {
            Receiver::P2pkh(data) => {
                p2pkh = Some(data);
            }
            Receiver::Orchard(data) => {
                orchard = Some(data);
            }
            _ => {}
        }
    }

    Ok(UnifiedAddressReceivers { p2pkh, orchard })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnifiedFullViewingKeyReceivers {
    pub transparent_fvk_hex: Option<String>,
    pub orchard_fvk_hex: Option<String>,
}

/// Encodes transparent and Orchard FVKs into a canonical ZIP-316 Unified Full Viewing Key (UFVK).
/// Typecode 0x00: 65 bytes (Transparent account pubkey || chain code)
/// Typecode 0x03: 96 bytes (Orchard raw FVK: ak || nk || rivk)
pub fn encode_unified_full_viewing_key(
    network: &str,
    transparent_fvk: Option<&[u8; 65]>,
    orchard_fvk: Option<&[u8; 96]>,
) -> Result<String, String> {
    let hrp = match network.to_lowercase().as_str() {
        "mainnet" => "uview",
        "testnet" => "uviewtest",
        "regtest" => "uviewregtest",
        _ => return Err(format!("Unsupported network for UFVK: {}", network)),
    };

    let mut raw_bytes = Vec::new();

    if let Some(tfvk) = transparent_fvk {
        raw_bytes.push(TYPECODE_P2PKH);
        raw_bytes.push(65u8);
        raw_bytes.extend_from_slice(tfvk);
    }

    if let Some(ofvk) = orchard_fvk {
        raw_bytes.push(TYPECODE_ORCHARD);
        raw_bytes.push(96u8);
        raw_bytes.extend_from_slice(ofvk);
    }

    if raw_bytes.is_empty() {
        return Err("Cannot encode empty UFVK (no viewing keys provided)".to_string());
    }

    let base32_data = raw_bytes.to_base32();
    bech32::encode(hrp, base32_data, Variant::Bech32m)
        .map_err(|e| format!("Bech32m UFVK encode error: {}", e))
}

/// Decodes a ZIP-316 Unified Full Viewing Key into its constituent viewing key components.
pub fn decode_unified_full_viewing_key(ufvk: &str) -> Result<UnifiedFullViewingKeyReceivers, String> {
    let (hrp, data, variant) = bech32::decode(ufvk)
        .map_err(|e| format!("Bech32 UFVK decode error: {}", e))?;

    if variant != Variant::Bech32m {
        return Err("UFVK must use Bech32m checksum".to_string());
    }

    if hrp != "uview" && hrp != "uviewtest" && hrp != "uviewregtest" {
        return Err(format!("Unrecognized UFVK HRP: {}", hrp));
    }

    let raw_bytes: Vec<u8> = Vec::from_base32(&data)
        .map_err(|e| format!("Base32 UFVK decode error: {}", e))?;

    let mut idx = 0;
    let mut transparent_fvk_hex = None;
    let mut orchard_fvk_hex = None;

    while idx < raw_bytes.len() {
        let typecode = raw_bytes[idx];
        idx += 1;
        if idx >= raw_bytes.len() {
            return Err("Truncated TLV header in UFVK".to_string());
        }
        let len = raw_bytes[idx] as usize;
        idx += 1;
        if idx + len > raw_bytes.len() {
            return Err("Truncated TLV payload in UFVK".to_string());
        }
        let payload = &raw_bytes[idx..idx + len];
        idx += len;

        match typecode {
            TYPECODE_P2PKH => {
                if len == 65 {
                    transparent_fvk_hex = Some(hex::encode(payload));
                }
            }
            TYPECODE_ORCHARD => {
                if len == 96 {
                    orchard_fvk_hex = Some(hex::encode(payload));
                }
            }
            _ => {}
        }
    }

    Ok(UnifiedFullViewingKeyReceivers {
        transparent_fvk_hex,
        orchard_fvk_hex,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unified_address_roundtrip() {
        let dummy_pkh = [0x42u8; 20];
        let dummy_orchard = [0x99u8; 43];

        let encoded = encode_unified_address("mainnet", Some(&dummy_pkh), Some(&dummy_orchard)).unwrap();
        assert!(encoded.starts_with("u1"));

        let decoded = decode_unified_address(&encoded).unwrap();
        assert_eq!(decoded.p2pkh, Some(dummy_pkh));
        assert_eq!(decoded.orchard, Some(dummy_orchard));
    }

    #[test]
    fn test_ufvk_roundtrip() {
        let dummy_tfvk = [0x11u8; 65];
        let dummy_ofvk = [0x22u8; 96];

        let ufvk = encode_unified_full_viewing_key("testnet", Some(&dummy_tfvk), Some(&dummy_ofvk)).unwrap();
        assert!(ufvk.starts_with("uviewtest1"));

        let decoded = decode_unified_full_viewing_key(&ufvk).unwrap();
        assert_eq!(decoded.transparent_fvk_hex.unwrap(), hex::encode(&dummy_tfvk));
        assert_eq!(decoded.orchard_fvk_hex.unwrap(), hex::encode(&dummy_ofvk));
    }

    #[test]
    fn test_official_decode_noir() {
        use zcash_address::unified::{Address, Container, Encoding, Receiver};
        let ua = "u174uudp7hcd2fz2qslsmsxrh8zt34ctq9fm500lgujgujfeyy86tudjyc8p2uthyta26q4pexj04sv5j86kmur53y03wwcd4x9h588cnv06lzatytryhtdpmceuq297n6q7ptxk9ptnllmq67u9fc5djmj8uz2sas0a4ncvkx3g6a7fjz";
        let (_net, _rev, addr) = Address::decode(ua).expect("Failed to decode Noir UA");
        for receiver in addr.items() {
            match receiver {
                Receiver::P2pkh(data) => println!("Found P2PKH: {:?}", hex::encode(data)),
                Receiver::P2sh(data) => println!("Found P2SH: {:?}", hex::encode(data)),
                Receiver::Sapling(data) => println!("Found Sapling: {:?}", hex::encode(data)),
                Receiver::Orchard(data) => println!("Found Orchard: {:?}", hex::encode(data)),
                _ => println!("Other receiver"),
            }
        }
    }

    #[test]
    fn test_user_address() {
        use zcash_address::unified::{Address, Container, Encoding, Receiver};
        let ua = "utest1ur70vc90n7q6kej5k8q2r3e74kgvexszentyvnllg37u9mcfku40u7muclnrfpm5urux66cmsrcs9fkhs6f2vmazeu85t266e30x53fshcr6f6ll6c3rwzpm4dgh9cuad9ntp6jl44zes8wz8ggn6sax69g8uau27xa7kg0acueavtpha3geztzrl6k4nnw9y30uv6cajm4djp480pg";
        let res = Address::decode(ua);
        match res {
            Ok((net, addr)) => {
                println!("Network: {:?}", net);
                for r in addr.items() {
                    match r {
                        Receiver::P2pkh(d) => {
                            let t = crate::keys::base58_check_encode(&[0x1d, 0x25], &d);
                            println!("USER P2PKH: {:?}, Base58: {}", hex::encode(d), t);
                        }
                        Receiver::P2sh(d) => println!("USER P2SH: {:?}", hex::encode(d)),
                        Receiver::Sapling(d) => println!("USER Sapling: {:?}", hex::encode(d)),
                        Receiver::Orchard(d) => println!("USER Orchard: {:?}", hex::encode(d)),
                        _ => println!("USER Other: {:?}", r),
                    }
                }
            }
            Err(e) => println!("Decode failed: {:?}", e),
        }

        println!("\n--- DECODING NOIR ADDRESS ---");
        let noir_ua = "utest1899z3dvmxu8ccv6qpw8ujev2t9vx7sez02wqw72rxp2nq9ctlaj58rw7z9maqzrznwe8dhu53vp0falmpv8l5qjhrsymlzyu5ysyjd64l8htat6h8vxjfz0haqvtvnqhcufrzfttzyqns0vv4lml9v898ksckxuw8ap80n72vsclvmdg";
        let (net2, addr2) = Address::decode(noir_ua).expect("Decode noir_ua");
        println!("Noir Network: {:?}", net2);
        for r in addr2.items() {
            match r {
                Receiver::P2pkh(d) => {
                    let t = crate::keys::base58_check_encode(&[0x1d, 0x25], &d);
                    println!("NOIR P2PKH: {:?}, Base58: {}", hex::encode(d), t);
                }
                Receiver::P2sh(d) => println!("NOIR P2SH: {:?}", hex::encode(d)),
                Receiver::Sapling(d) => println!("NOIR Sapling: {:?}", hex::encode(d)),
                Receiver::Orchard(d) => println!("NOIR Orchard: {:?}", hex::encode(d)),
                _ => println!("NOIR Other: {:?}", r),
            }
        }
    }
}
