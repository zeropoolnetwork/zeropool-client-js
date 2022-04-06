import { IDBPDatabase } from 'idb';
export declare enum HistoryTransactionType {
    DepositAllow = 1,
    DepositPermit = 2,
    TransferIn = 3,
    TransferOut = 4,
    Withdrawal = 5
}
export declare class HistoryRecord {
    type: HistoryTransactionType;
    timestamp: number;
    from: string;
    to: string;
    amount: bigint;
    txHash: string;
    constructor(type: HistoryTransactionType, timestamp: number, from: string, to: string, amount: bigint, txHash: string);
}
export declare class HistoryStorage {
    private db;
    constructor(db: IDBPDatabase);
    static init(db_id: string): Promise<HistoryStorage>;
    put(index: number, data: HistoryRecord): Promise<HistoryRecord>;
    get(index: number): Promise<HistoryRecord | null>;
}
