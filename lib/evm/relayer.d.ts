import Web3 from 'web3';
import { Output } from 'libzeropool-rs-wasm-web';
import { SnarkParams, Tokens } from '../config';
import { ZeroPoolState } from '../state';
export interface RelayerInfo {
    root: string;
    deltaIndex: string;
}
export declare class RelayerBackend {
    private zpState;
    private worker;
    private tokenContract;
    private web3;
    private snarkParams;
    private tokens;
    constructor(tokens: Tokens, web3: Web3, state: ZeroPoolState, snarkParams: SnarkParams, worker: any);
    getTokenBalance(address: string, tokenAddress: string): Promise<any>;
    deposit(tokenAddress: string, address: string, amountWei: string, fee?: string): Promise<void>;
    transfer(tokenAddress: string, outsWei: Output[], fee?: string): Promise<void>;
    withdraw(tokenAddress: string, address: string, amountWei: string, fee?: string): Promise<void>;
    getTotalBalance(): string;
    /**
     * @returns [total, account, note]
     */
    getBalances(): [string, string, string];
    fetchTransactionsFromRelayer(tokenAddress: string): Promise<void>;
    updateState(tokenAddress: string): Promise<void>;
    /**
     * Attempt to extract and save usable account/notes from transaction data.
     * @param raw hex-encoded transaction data
     */
    private cacheShieldedTx;
    free(): void;
}
