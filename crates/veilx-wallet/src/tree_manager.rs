use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use lazy_static::lazy_static;
use incrementalmerkletree::{
    frontier::CommitmentTree,
    witness::IncrementalWitness,
};
use orchard::tree::{Anchor, MerkleHashOrchard, MerklePath};
use serde::{Deserialize, Serialize};

pub const ORCHARD_TREE_DEPTH: u8 = 32;

lazy_static! {
    /// Global Orchard Tree Manager in Wasm runtime memory.
    pub static ref GLOBAL_ORCHARD_TREE: Arc<Mutex<OrchardTreeManager>> = {
        Arc::new(Mutex::new(OrchardTreeManager::new()))
    };
}

/// Serializable representation of a CommitmentTree for IndexedDB storage.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SerializedCommitmentTree {
    pub left: Option<String>,
    pub right: Option<String>,
    pub parents: Vec<Option<String>>,
}

/// Serializable representation of an IncrementalWitness for IndexedDB storage.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SerializedWitness {
    pub tree: SerializedCommitmentTree,
    pub filled: Vec<String>,
    pub cursor: Option<SerializedCommitmentTree>,
}

/// Serializable representation of a TreeCheckpoint for IndexedDB storage.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SerializedCheckpoint {
    pub height: u32,
    pub block_hash_hex: String,
    pub tree: SerializedCommitmentTree,
}

/// Full serializable snapshot of the tree manager.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SerializedTreeManager {
    pub tree: SerializedCommitmentTree,
    pub witnesses: HashMap<String, SerializedWitness>,
    pub checkpoints: Vec<SerializedCheckpoint>,
}

/// Manages the Orchard note commitment tree and tracks authentication path witnesses
/// for spendable notes in WebAssembly.
pub struct OrchardTreeManager {
    pub tree: CommitmentTree<MerkleHashOrchard, 32>,
    pub witnesses: HashMap<[u8; 32], IncrementalWitness<MerkleHashOrchard, 32>>,
    pub checkpoints: Vec<TreeCheckpoint>,
}

#[derive(Clone)]
pub struct TreeCheckpoint {
    pub height: u32,
    pub block_hash: [u8; 32],
    pub tree: CommitmentTree<MerkleHashOrchard, 32>,
}

impl OrchardTreeManager {
    pub fn new() -> Self {
        Self {
            tree: CommitmentTree::empty(),
            witnesses: HashMap::new(),
            checkpoints: Vec::new(),
        }
    }

    /// Appends a slice of commitment leaves (each 32 bytes) to the tree and advances
    /// all active note witnesses.
    pub fn append_commitments(&mut self, commitments: &[[u8; 32]]) -> Result<[u8; 32], String> {
        for cm_bytes in commitments {
            let opt: Option<MerkleHashOrchard> = MerkleHashOrchard::from_bytes(cm_bytes).into();
            let leaf = opt.ok_or_else(|| format!("Invalid commitment leaf bytes: {}", hex::encode(cm_bytes)))?;

            self.tree.append(leaf.clone())
                .map_err(|_| "Orchard note commitment tree is full".to_string())?;

            for witness in self.witnesses.values_mut() {
                witness.append(leaf.clone())
                    .map_err(|_| "Failed to append leaf to witness".to_string())?;
            }
        }

        Ok(self.current_anchor())
    }

    /// Marks a specific note commitment for witness tracking.
    pub fn track_note(&mut self, cm_bytes: &[u8; 32]) -> Result<(), String> {
        if self.witnesses.contains_key(cm_bytes) {
            return Ok(());
        }

        let witness = IncrementalWitness::from_tree(self.tree.clone())
            .ok_or_else(|| "Cannot create witness from empty tree".to_string())?;

        self.witnesses.insert(*cm_bytes, witness);
        Ok(())
    }

    /// Retrieves the current 32-level Merkle authentication path for a tracked note commitment.
    pub fn get_witness_for_note(&self, cm_bytes: &[u8; 32]) -> Result<MerklePath, String> {
        let witness = self.witnesses.get(cm_bytes)
            .ok_or_else(|| format!("No witness tracked for commitment {}", hex::encode(cm_bytes)))?;

        let inc_path = witness.path()
            .ok_or_else(|| "Witness path could not be generated".to_string())?;

        Ok(MerklePath::from(inc_path))
    }

    /// Obtains the current anchor (32-byte root) of the Orchard tree.
    pub fn current_anchor(&self) -> [u8; 32] {
        if self.tree.is_empty() {
            Anchor::empty_tree().to_bytes()
        } else {
            let root = self.tree.root();
            Anchor::from(root).to_bytes()
        }
    }

    /// Records a checkpoint at a given block height and hash for reorg protection.
    pub fn create_checkpoint(&mut self, height: u32, block_hash: [u8; 32]) {
        if self.checkpoints.len() >= 100 {
            self.checkpoints.remove(0);
        }
        self.checkpoints.push(TreeCheckpoint {
            height,
            block_hash,
            tree: self.tree.clone(),
        });
    }

    /// Rewinds the tree to the specified block height if a reorg occurred.
    pub fn rewind_to_height(&mut self, target_height: u32) -> Result<[u8; 32], String> {
        let idx = self.checkpoints.iter().rposition(|cp| cp.height <= target_height)
            .ok_or_else(|| format!("Cannot rewind: no checkpoint found for height <= {}", target_height))?;

        let checkpoint = self.checkpoints[idx].clone();
        self.tree = checkpoint.tree;
        self.checkpoints.truncate(idx + 1);

        // Remove witnesses whose witnessed position exceeds the current tree size
        let current_size = self.tree.size();
        self.witnesses.retain(|_, w| {
            let pos: u64 = w.witnessed_position().into();
            pos < current_size as u64
        });

        Ok(self.current_anchor())
    }

    pub fn tree_size(&self) -> usize {
        self.tree.size()
    }

    /// Exports the full state to a serializable struct.
    pub fn export_state(&self) -> SerializedTreeManager {
        let tree = serialize_commitment_tree(&self.tree);

        let mut witnesses = HashMap::new();
        for (cm, w) in &self.witnesses {
            witnesses.insert(hex::encode(cm), serialize_witness(w));
        }

        let checkpoints = self.checkpoints.iter().map(|cp| {
            SerializedCheckpoint {
                height: cp.height,
                block_hash_hex: hex::encode(cp.block_hash),
                tree: serialize_commitment_tree(&cp.tree),
            }
        }).collect();

        SerializedTreeManager {
            tree,
            witnesses,
            checkpoints,
        }
    }

    /// Reconstructs the tree manager from serialized state.
    pub fn import_state(serialized: SerializedTreeManager) -> Result<Self, String> {
        let tree = deserialize_commitment_tree(&serialized.tree)?;

        let mut witnesses = HashMap::new();
        for (cm_hex, w_ser) in serialized.witnesses {
            let cm_vec = hex::decode(&cm_hex)
                .map_err(|e| format!("Invalid commitment hex: {}", e))?;
            if cm_vec.len() != 32 {
                return Err("Commitment must be 32 bytes".to_string());
            }
            let mut cm = [0u8; 32];
            cm.copy_from_slice(&cm_vec);

            let witness = deserialize_witness(&w_ser)?;
            witnesses.insert(cm, witness);
        }

        let mut checkpoints = Vec::new();
        for cp_ser in serialized.checkpoints {
            let hash_vec = hex::decode(&cp_ser.block_hash_hex)
                .map_err(|e| format!("Invalid block hash hex: {}", e))?;
            if hash_vec.len() != 32 {
                return Err("Block hash must be 32 bytes".to_string());
            }
            let mut block_hash = [0u8; 32];
            block_hash.copy_from_slice(&hash_vec);

            let cp_tree = deserialize_commitment_tree(&cp_ser.tree)?;
            checkpoints.push(TreeCheckpoint {
                height: cp_ser.height,
                block_hash,
                tree: cp_tree,
            });
        }

        Ok(Self {
            tree,
            witnesses,
            checkpoints,
        })
    }
}

impl Default for OrchardTreeManager {
    fn default() -> Self {
        Self::new()
    }
}

fn serialize_commitment_tree(tree: &CommitmentTree<MerkleHashOrchard, 32>) -> SerializedCommitmentTree {
    SerializedCommitmentTree {
        left: tree.left().as_ref().map(|h| hex::encode(h.to_bytes())),
        right: tree.right().as_ref().map(|h| hex::encode(h.to_bytes())),
        parents: tree.parents().iter().map(|opt| opt.as_ref().map(|h| hex::encode(h.to_bytes()))).collect(),
    }
}

fn deserialize_commitment_tree(ser: &SerializedCommitmentTree) -> Result<CommitmentTree<MerkleHashOrchard, 32>, String> {
    let left = match &ser.left {
        Some(h) => Some(parse_merkle_hash(h)?),
        None => None,
    };
    let right = match &ser.right {
        Some(h) => Some(parse_merkle_hash(h)?),
        None => None,
    };
    let mut parents = Vec::new();
    for p in &ser.parents {
        parents.push(match p {
            Some(h) => Some(parse_merkle_hash(h)?),
            None => None,
        });
    }

    CommitmentTree::from_parts(left, right, parents)
        .map_err(|_| "Invalid commitment tree structure".to_string())
}

fn serialize_witness(w: &IncrementalWitness<MerkleHashOrchard, 32>) -> SerializedWitness {
    SerializedWitness {
        tree: serialize_commitment_tree(w.tree()),
        filled: w.filled().iter().map(|h| hex::encode(h.to_bytes())).collect(),
        cursor: w.cursor().as_ref().map(serialize_commitment_tree),
    }
}

fn deserialize_witness(ser: &SerializedWitness) -> Result<IncrementalWitness<MerkleHashOrchard, 32>, String> {
    let tree = deserialize_commitment_tree(&ser.tree)?;
    let mut filled = Vec::new();
    for h in &ser.filled {
        filled.push(parse_merkle_hash(h)?);
    }
    let cursor = match &ser.cursor {
        Some(c) => Some(deserialize_commitment_tree(c)?),
        None => None,
    };

    IncrementalWitness::from_parts(tree, filled, cursor)
        .ok_or_else(|| "Invalid incremental witness parts".to_string())
}

fn parse_merkle_hash(hex_str: &str) -> Result<MerkleHashOrchard, String> {
    let bytes = hex::decode(hex_str)
        .map_err(|e| format!("Invalid hex hash: {}", e))?;
    if bytes.len() != 32 {
        return Err("Merkle hash must be 32 bytes".to_string());
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    let opt: Option<MerkleHashOrchard> = MerkleHashOrchard::from_bytes(&arr).into();
    opt.ok_or_else(|| "Invalid MerkleHashOrchard byte representation".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tree_append_and_witness() {
        let mut mgr = OrchardTreeManager::new();
        assert_eq!(mgr.tree_size(), 0);

        let mut leaves = Vec::new();
        for i in 1..=10u8 {
            let mut leaf = [0u8; 32];
            leaf[0] = i;
            leaves.push(leaf);
        }

        // Append 5 leaves
        let anchor1 = mgr.append_commitments(&leaves[..5]).unwrap();
        assert_ne!(anchor1, [0u8; 32]);
        assert_eq!(mgr.tree_size(), 5);

        // Track leaf 5
        mgr.track_note(&leaves[4]).unwrap();

        // Append next 5 leaves
        let anchor2 = mgr.append_commitments(&leaves[5..]).unwrap();
        assert_ne!(anchor2, anchor1);
        assert_eq!(mgr.tree_size(), 10);

        // Get witness for leaf 5
        let _path = mgr.get_witness_for_note(&leaves[4]).unwrap();

        // Check serialization and deserialization
        let exported = mgr.export_state();
        let restored = OrchardTreeManager::import_state(exported).unwrap();
        assert_eq!(restored.tree_size(), 10);
        assert_eq!(restored.current_anchor(), anchor2);
        let _restored_path = restored.get_witness_for_note(&leaves[4]).unwrap();

        // Check checkpoint & rewind
        mgr.create_checkpoint(100, [0xaa; 32]);
        let next_leaves = vec![[11u8; 32], [12u8; 32]];
        mgr.append_commitments(&next_leaves).unwrap();
        assert_eq!(mgr.tree_size(), 12);

        mgr.rewind_to_height(100).unwrap();
        assert_eq!(mgr.tree_size(), 10);
        assert_eq!(mgr.current_anchor(), anchor2);
    }
}
