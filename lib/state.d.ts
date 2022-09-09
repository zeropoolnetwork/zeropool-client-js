import { UserAccount } from 'libzeropool-rs-wasm-web';
import { HistoryStorage } from './history';
export declare class ZeroPoolState {
    denominator: bigint;
    account: UserAccount;
    history: HistoryStorage;
    static create(sk: Uint8Array, networkName: string, rpcUrl: string, denominator: bigint): Promise<ZeroPoolState>;
    getTotalBalance(): bigint;
    getBalances(): [bigint, bigint, bigint];
    accountBalance(): bigint;
    usableNotes(): any[];
    isOwnAddress(shieldedAddress: string): boolean;
    rawState(): any;
    clean(): Promise<void>;
    free(): void;
}
