import { Output } from 'libzeropool-rs-wasm-web';
import { SnarkParams, Tokens } from './config';
import { NetworkBackend } from './networks/network';
export interface RelayerInfo {
    root: string;
    deltaIndex: string;
}
export interface ClientConfig {
    /** Spending key. */
    sk: Uint8Array;
    /** A map of supported tokens (token address => token params). */
    tokens: Tokens;
    /** Loaded zkSNARK paramaterers. */
    snarkParams: SnarkParams;
    /** A worker instance acquired through init() function of this package. */
    worker: any;
    /** The name of the network is only used for storage. */
    networkName: string | undefined;
    network: NetworkBackend;
}
export declare class ZeropoolClient {
    private zpStates;
    private worker;
    private snarkParams;
    private tokens;
    private config;
    static create(config: ClientConfig): Promise<ZeropoolClient>;
    generateAddress(tokenAddress: string): string;
    deposit(tokenAddress: string, amountWei: string, sign: (data: string) => Promise<string>, fromAddress?: string | null, fee?: string): Promise<string>;
    transfer(tokenAddress: string, outsWei: Output[], fee?: string): Promise<string>;
    withdraw(tokenAddress: string, address: string, amountWei: string, fee?: string): Promise<string>;
    waitJobCompleted(tokenAddress: string, jobId: string): Promise<string>;
    getTotalBalance(tokenAddress: string): Promise<string>;
    /**
     * @returns [total, account, note]
     */
    getBalances(tokenAddress: string): Promise<[string, string, string]>;
    updateState(tokenAddress: string): Promise<void>;
    /**
     * Attempt to extract and save usable account/notes from transaction data.
     * @param raw hex-encoded transaction data
     */
    private cacheShieldedTx;
    free(): void;
}
