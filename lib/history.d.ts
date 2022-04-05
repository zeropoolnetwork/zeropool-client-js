import { IDBPDatabase } from 'idb';
export declare enum HistoryTransactionType {
    Deposit = 1,
    Transfer = 2,
    Withdrawal = 3,
    BridgeDeposit = 4
}
export interface HistoryRecord {
    type: HistoryTransactionType;
    timestamp: bigint;
    from: string;
    to: string;
    amount: bigint;
    txHash: string;
}
export declare class HistoryStorage {
    private db;
    constructor(db: IDBPDatabase);
    static init(db_id: string): Promise<HistoryStorage>;
    put(index: bigint, data: HistoryRecord): Promise<HistoryRecord>;
    get(index: bigint): Promise<HistoryRecord | null>;
}
