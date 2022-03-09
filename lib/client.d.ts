import { Output } from 'libzeropool-rs-wasm-web';
import { SnarkParams, Tokens } from './config';
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
    networkName: string;
    /** Should the signature be compact (for EVM based blockchains)  */
    compactSignature: boolean;
}
export declare class ZeropoolClient {
    private zpStates;
    private worker;
    private snarkParams;
    private tokens;
    private config;
    static create(config: ClientConfig): Promise<ZeropoolClient>;
    deposit(tokenAddress: string, amountWei: string, sign: (data: string) => Promise<string>, fromAddress?: string | null, fee?: string): Promise<void>;
    transfer(tokenAddress: string, outsWei: Output[], fee?: string): Promise<void>;
    withdraw(tokenAddress: string, address: string, amountWei: string, fee?: string): Promise<void>;
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
