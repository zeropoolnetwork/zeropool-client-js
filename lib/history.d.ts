import { IDBPDatabase } from 'idb';
import { Account, Note } from 'libzeropool-rs-wasm-web';
export declare enum HistoryTransactionType {
    Deposit = 1,
    TransferIn = 2,
    TransferOut = 3,
    Withdrawal = 4,
    TransferLoopback = 5
}
export interface DecryptedMemo {
    index: number;
    acc: Account | undefined;
    inNotes: {
        note: Note;
        index: number;
    }[];
    outNotes: {
        note: Note;
        index: number;
    }[];
    txHash: string | undefined;
}
export declare class HistoryRecord {
    type: HistoryTransactionType;
    timestamp: number;
    from: string;
    to: string;
    amount: bigint;
    fee: bigint;
    txHash: string;
    constructor(type: HistoryTransactionType, timestamp: number, from: string, to: string, amount: bigint, fee: bigint, txHash: string);
    toJson(): string;
}
export declare class HistoryRecordIdx {
    index: number;
    record: HistoryRecord;
    static create(record: HistoryRecord, index: number): HistoryRecordIdx;
}
export declare class TxHashIdx {
    index: number;
    txHash: string;
    static create(txHash: string, index: number): TxHashIdx;
}
export declare class HistoryStorage {
    private db;
    private syncIndex;
    private unparsedMemo;
    private currentHistory;
    private syncHistoryPromise;
    private web3;
    constructor(db: IDBPDatabase, rpcUrl: string);
    static init(db_id: string, rpcUrl: string): Promise<HistoryStorage>;
    preloadCache(): Promise<void>;
    getAllHistory(): Promise<HistoryRecord[]>;
    saveDecryptedMemo(memo: DecryptedMemo): Promise<DecryptedMemo>;
    getDecryptedMemo(index: number): Promise<DecryptedMemo | null>;
    cleanHistory(): Promise<void>;
    private syncHistory;
    private put;
    private get;
    private convertToHistory;
}
