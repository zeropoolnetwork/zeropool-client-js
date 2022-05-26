import { Output, DecryptedMemo } from 'libzkbob-rs-wasm-web';
import { SnarkParams, Tokens } from './config';
import { NetworkBackend } from './networks/network';
import { HistoryRecord } from './history';
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
    private updateStatePromise;
    static create(config: ClientConfig): Promise<ZeropoolClient>;
    generateAddress(tokenAddress: string): string;
    deposit(tokenAddress: string, amountWei: string, sign: (data: string) => Promise<string>, fromAddress?: string | null, fee?: string): Promise<string>;
    depositPermittable(tokenAddress: string, amountWei: string, signTypedData: (deadline: bigint, value: bigint) => Promise<string>, fromAddress?: string | null, fee?: string): Promise<string>;
    transfer(tokenAddress: string, outsWei: Output[], fee?: string): Promise<string>;
    withdraw(tokenAddress: string, address: string, amountWei: string, fee?: string): Promise<string>;
    waitJobCompleted(tokenAddress: string, jobId: string): Promise<string>;
    getTotalBalance(tokenAddress: string): Promise<string>;
    /**
     * @returns [total, account, note]
     */
    getBalances(tokenAddress: string): Promise<[string, string, string]>;
    rawState(tokenAddress: string): Promise<any>;
    getAllHistory(tokenAddress: string): Promise<HistoryRecord[]>;
    cleanState(tokenAddress: string): Promise<void>;
    updateState(tokenAddress: string): Promise<void>;
    private updateStateNewWorker;
    logStateSync(startIndex: number, endIndex: number, decryptedMemos: DecryptedMemo[]): Promise<void>;
    free(): void;
}
