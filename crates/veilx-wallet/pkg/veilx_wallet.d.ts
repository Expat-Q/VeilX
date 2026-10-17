/* tslint:disable */
/* eslint-disable */

export function build_and_prove_orchard_bundle(params_val: any): any;

export function build_and_prove_orchard_spend(params_val: any): any;

export function build_and_sign_transaction(params_val: any): any;

export function calculate_zip317_fee(input_count: number, output_count: number): bigint;

export function decode_unified_address(ua: string): any;

export function decode_unified_full_viewing_key(ufvk: string): any;

export function derive_account(mnemonic: string, account_index: number, network: string): any;

export function derive_address_from_ufvk(ufvk: string, diversifier_index: number, network: string): string;

export function derive_orchard_account(mnemonic: string, account_index: number, network: string): any;

export function export_unified_full_viewing_key(mnemonic: string, account_index: number, network: string): string;

export function generate_seed_phrase(word_count: number): string;

export function get_active_branch_ids(): any;

export function recover_outgoing_orchard_output(params_val: any): any;

export function tree_append_commitments(commitments_hex: string[]): string;

export function tree_create_checkpoint(height: number, block_hash_hex: string): void;

export function tree_export_state(): any;

export function tree_get_anchor(): string;

export function tree_import_state(state_val: any): void;

export function tree_rewind_to_height(target_height: number): string;

export function tree_track_note(cm_hex: string): void;

export function try_decrypt_orchard_output(params_val: any): any;

export function validate_seed_phrase(phrase: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly build_and_prove_orchard_bundle: (a: any) => [number, number, number];
    readonly build_and_prove_orchard_spend: (a: any) => [number, number, number];
    readonly build_and_sign_transaction: (a: any) => [number, number, number];
    readonly calculate_zip317_fee: (a: number, b: number) => bigint;
    readonly decode_unified_address: (a: number, b: number) => [number, number, number];
    readonly decode_unified_full_viewing_key: (a: number, b: number) => [number, number, number];
    readonly derive_account: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly derive_address_from_ufvk: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly derive_orchard_account: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly export_unified_full_viewing_key: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly generate_seed_phrase: (a: number) => [number, number, number, number];
    readonly get_active_branch_ids: () => any;
    readonly recover_outgoing_orchard_output: (a: any) => [number, number, number];
    readonly tree_append_commitments: (a: number, b: number) => [number, number, number, number];
    readonly tree_create_checkpoint: (a: number, b: number, c: number) => [number, number];
    readonly tree_export_state: () => [number, number, number];
    readonly tree_get_anchor: () => [number, number, number, number];
    readonly tree_import_state: (a: any) => [number, number];
    readonly tree_rewind_to_height: (a: number) => [number, number, number, number];
    readonly tree_track_note: (a: number, b: number) => [number, number];
    readonly try_decrypt_orchard_output: (a: any) => [number, number, number];
    readonly validate_seed_phrase: (a: number, b: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
