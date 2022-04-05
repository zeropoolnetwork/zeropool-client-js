import { openDB, IDBPDatabase } from 'idb';

export enum HistoryTransactionType {
	Deposit = 1,
	Transfer,
	Withdrawal,
	BridgeDeposit,
}

export interface HistoryRecord {
	type: HistoryTransactionType,
	timestamp: bigint,
	from: string,
	to: string,
	amount: bigint,
	txHash: string,
}

const TX_TABLE = 'TX_STORE';

export class HistoryStorage {
  private db: IDBPDatabase;

  constructor(db: IDBPDatabase) {
    this.db = db;
  }

  static async init(db_id: string): Promise<HistoryStorage> {
    const db = await openDB(`zeropool.${db_id}.history`, 1, {
      upgrade(db) {
        db.createObjectStore(TX_TABLE);
      }
    });

    const cache = new HistoryStorage(db);
    return cache;
  }

  /*public async getAllHistory(): Promise<Array | null> {
      return null;
  }*/

  public async put(index: bigint, data: HistoryRecord): Promise<HistoryRecord> {
    await this.db.put(TX_TABLE, data, index.toString());
    return data;
  }

  public async get(index: bigint): Promise<HistoryRecord | null> {
    let data = await this.db.get(TX_TABLE, index.toString());
    return data;
  }
}
