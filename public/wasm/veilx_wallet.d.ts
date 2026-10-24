/* tslint:disable */
/* eslint-disable */

export function build_and_prove_orchard_bundle(params_val: any): any;

export function build_and_prove_orchard_spend(params_val: any): any;

export function build_and_sign_transaction(params_val: any): any;

export function build_v5_shielding_transaction(params_val: any): any;

export function calculate_zip317_fee(input_count: number, output_count: number): bigint;

/**
 * Pre-warms the Orchard Halo 2 Proving Key into WASM memory.
 * Call this during idle time (e.g. dashboard load) so first proof generation is instantaneous.
 */
export function client_prewarm_prover(): boolean;

/**
 * Step 1: Client Prover running inside Browser WebAssembly Web Worker.
 * Takes unsigned PCZT parameters, computes the Halo 2 Zero-Knowledge Proof.
 */
export function client_prove_escrow_pczt(params_val: any): any;

export function decode_unified_address(ua: string): any;

export function decode_unified_full_viewing_key(ufvk: string): any;

export function derive_account(mnemonic: string, account_index: number, network: string): any;

export function derive_address_from_ufvk(ufvk: string, diversifier_index: number, network: string): string;

export function derive_orchard_account(mnemonic: string, account_index: number, network: string): any;

export function export_unified_full_viewing_key(mnemonic: string, account_index: number, network: string): string;

/**
 * Step 3: Server combines client-generated Orchard proof bundle with server-signed transparent input
 * to assemble the complete Version 5 transaction.
 */
export function finalize_shielding_transaction(params_val: any, proof_bundle_val: any, escrow_private_key_hex: string): any;

export function generate_seed_phrase(word_count: number): string;

export function get_active_branch_ids(): any;

export function initThreadPool(num_threads: number): Promise<any>;

/**
 * Step 1: Pre-warm prover in Web Worker
 */
export function prewarm_shielding_prover(): boolean;

/**
 * Step 2: Client-side Halo 2 Zero-Knowledge Prover for shielding transactions.
 * Runs inside Dedicated Web Worker (`pczt-prover.worker.js`).
 */
export function prove_shielding_pczt(params_val: any): any;

export function recover_outgoing_orchard_output(params_val: any): any;

/**
 * Step 2: Server receives parameters, computes proof & canonical ZIP-244 consensus sighash,
 * signs real spend action with platform escrow `ask`, freezes canonical V6 transaction,
 * and returns the consensus raw hex.
 */
export function server_sign_and_finalize_pczt(params_val: any, escrow_sk_hex: string, expiry_height: number, _consensus_branch_id: number): any;

export function tree_append_commitments(commitments_hex: string[]): string;

export function tree_create_checkpoint(height: number, block_hash_hex: string): void;

export function tree_export_state(): any;

export function tree_get_anchor(): string;

export function tree_get_witness_for_note(cm_hex: string): any;

export function tree_import_state(state_val: any): void;

export function tree_rewind_to_height(target_height: number): string;

export function tree_track_note(cm_hex: string): void;

export function try_decrypt_orchard_output(params_val: any): any;

export function validate_seed_phrase(phrase: string): boolean;

export class wbg_rayon_PoolBuilder {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    build(): void;
    numThreads(): number;
    receiver(): number;
}

export function wbg_rayon_start_worker(receiver: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
    readonly build_and_prove_orchard_bundle: (a: any) => [number, number, number];
    readonly build_and_prove_orchard_spend: (a: any) => [number, number, number];
    readonly build_and_sign_transaction: (a: any) => [number, number, number];
    readonly build_v5_shielding_transaction: (a: any) => [number, number, number];
    readonly calculate_zip317_fee: (a: number, b: number) => bigint;
    readonly client_prewarm_prover: () => number;
    readonly client_prove_escrow_pczt: (a: any) => [number, number, number];
    readonly decode_unified_address: (a: number, b: number) => [number, number, number];
    readonly decode_unified_full_viewing_key: (a: number, b: number) => [number, number, number];
    readonly derive_account: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly derive_address_from_ufvk: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly derive_orchard_account: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly export_unified_full_viewing_key: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly finalize_shielding_transaction: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly generate_seed_phrase: (a: number) => [number, number, number, number];
    readonly get_active_branch_ids: () => any;
    readonly initThreadPool: (a: number) => any;
    readonly prewarm_shielding_prover: () => number;
    readonly prove_shielding_pczt: (a: any) => [number, number, number];
    readonly recover_outgoing_orchard_output: (a: any) => [number, number, number];
    readonly server_sign_and_finalize_pczt: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly tree_append_commitments: (a: number, b: number) => [number, number, number, number];
    readonly tree_create_checkpoint: (a: number, b: number, c: number) => [number, number];
    readonly tree_export_state: () => [number, number, number];
    readonly tree_get_anchor: () => [number, number, number, number];
    readonly tree_get_witness_for_note: (a: number, b: number) => [number, number, number];
    readonly tree_import_state: (a: any) => [number, number];
    readonly tree_rewind_to_height: (a: number) => [number, number, number, number];
    readonly tree_track_note: (a: number, b: number) => [number, number];
    readonly try_decrypt_orchard_output: (a: any) => [number, number, number];
    readonly validate_seed_phrase: (a: number, b: number) => number;
    readonly wbg_rayon_poolbuilder_build: (a: number) => void;
    readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
    readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
    readonly wbg_rayon_start_worker: (a: number) => void;
    readonly memory: WebAssembly.Memory;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
    readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
