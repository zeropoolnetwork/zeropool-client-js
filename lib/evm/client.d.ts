import { Output } from 'libzeropool-rs-wasm-web';
import { SnarkParams, Tokens } from '../config';
export interface RelayerInfo {
    root: string;
    deltaIndex: string;
}
export declare class ZeropoolClient {
    private zpStates;
    private worker;
    private web3;
    private snarkParams;
    private tokens;
    static create(sk: Uint8Array, tokens: Tokens, rpcUrl: string, snarkParams: SnarkParams, worker: any, networkName?: string): Promise<ZeropoolClient>;
    deposit(tokenAddress: string, amountWei: string, sign: (data: string) => Promise<string>, fee?: string): Promise<void>;
    transfer(tokenAddress: string, outsWei: Output[], fee?: string): Promise<void>;
    withdraw(tokenAddress: string, address: string, amountWei: string, fee?: string): Promise<void>;
    getTotalBalance(tokenAddress: string): string;
    /**
     * @returns [total, account, note]
     */
    getBalances(tokenAddress: string): [string, string, string];
    updateState(tokenAddress: string): Promise<void>;
    updateStateFromRelayer(tokenAddress: string): Promise<void>;
    updateStateFromNode(tokenAddress: string): Promise<void>;
    /**
     * Attempt to extract and save usable account/notes from transaction data.
     * @param raw hex-encoded transaction data
     */
    private cacheShieldedTx;
    free(): void;
}
