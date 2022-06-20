import { UserAccount } from 'libzeropool-rs-wasm-web';
import { HistoryStorage } from './history';
export declare class ZeroPoolState {
    denominator: bigint;
    account: UserAccount;
    history: HistoryStorage;
    /**
     * Initialize ZeroPoolState for the specified user account (spending key).
     * @param sk spending key
     * @param networkName network name (ethereum, kovan, etc.)
     * @param rpcUrl node RPC url
     * @param denominator pool currency denominator
     * @returns {ZeroPoolState}
     */
    static create(sk: Uint8Array, networkName: string, rpcUrl: string, denominator: bigint): Promise<ZeroPoolState>;
    getTotalBalance(): string;
    getBalances(): [string, string, string];
    rawState(): any;
    free(): void;
}
