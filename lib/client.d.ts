import { Output } from 'libzeropool-rs-wasm-web';
import { SnarkParams, Tokens } from './config';
import { NetworkBackend } from './networks/network';
import { HistoryRecord } from './history';
export interface RelayerInfo {
    /** The current merkle tree root */
    root: string;
    /** Current transaction index in the pool */
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
    private updateStatePromise;
    static create(config: ClientConfig): Promise<ZeropoolClient>;
    generateAddress(tokenAddress: string): string;
    /**
     * Create and send a deposit transaction to the relayer.
     * @param tokenAddress address of the token smart contract
     * @param amountWei non-denominated amount
     * @param sign general signature function
     * @param fromAddress address of the sender
     * @param fee relayer fee
     * @param isBridge
     * @returns transaction hash
     */
    deposit(tokenAddress: string, amountWei: string, sign: (data: string) => Promise<string>, fromAddress?: string | null, fee?: string, isBridge?: boolean): Promise<string>;
    /**
     * Create and send a transfer transaction to the relayer.
     * @param tokenAddress address of the token smart contract
     * @param outsWei one or multiple outputs of the transaction
     * @param fee relayer fee
     * @returns transaction hash
     */
    transfer(tokenAddress: string, outsWei: Output[], fee?: string): Promise<string>;
    /**
     * Create and send a withdraw transaction to the relayer.
     * @param tokenAddress address of the token smart contract
     * @param address withdraw recipient address
     * @param amountWei non-denominated amount
     * @param fee relayer fee
     * @returns transaction hash
     */
    withdraw(tokenAddress: string, address: string, amountWei: string, fee?: string): Promise<string>;
    waitJobCompleted(tokenAddress: string, jobId: string): Promise<string>;
    /**
     * Get the user's total pool balance (account + notes).
     * @param tokenAddress
     * @returns non-denominated balance
     */
    getTotalBalance(tokenAddress: string): Promise<string>;
    /**
     * Get the user's account balances.
     * @returns [total, account, note]
     */
    getBalances(tokenAddress: string): Promise<[string, string, string]>;
    /** Returns an object representation of the inner state for debug purposes.  */
    rawState(tokenAddress: string): Promise<any>;
    getAllHistory(tokenAddress: string): Promise<HistoryRecord[]>;
    /** Synchronize the inner state with the relayer */
    updateState(tokenAddress: string): Promise<void>;
    private updateStateWorker;
    private updateStateNewWorker;
    /**
     * Attempt to extract and save usable account/notes from transaction data.
     * Return decrypted account and notes to proceed history restoring
     * @param raw hex-encoded transaction data
     */
    private cacheShieldedTx;
    free(): void;
}
