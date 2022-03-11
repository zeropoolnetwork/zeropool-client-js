import { Params, VK } from 'libzeropool-rs-wasm-web';
export interface Config {
    snarkParams: SnarkConfigParams;
    wasmPath: string;
    workerPath: string;
}
export interface SnarkConfigParams {
    transferParamsUrl: string;
    treeParamsUrl: string;
    transferVkUrl: string;
    treeVkUrl: string;
}
export interface SnarkParams {
    transferParams: Params;
    treeParams: Params;
    transferVk?: VK;
    treeVk?: VK;
}
export declare type Tokens = {
    [address: string]: Token;
};
export interface Token {
    poolAddress: string;
    relayerUrl: string;
    denominator: string;
}
