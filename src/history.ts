import { openDB, IDBPDatabase } from 'idb';

export enum HistoryTransactionType {
	DepositAllow = 1,
  DepositPermit,
	TransferIn,
  TransferOut,
	Withdrawal,
}

export class HistoryRecord {
  constructor(
    public type: HistoryTransactionType,
    public timestamp: number,
    public from: string,
    public to: string,
    public amount: bigint,
    public txHash: string,
  ) {}
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

  public async put(index: number, data: HistoryRecord): Promise<HistoryRecord> {
    await this.db.put(TX_TABLE, data, index);
    return data;
  }

  public async get(index: number): Promise<HistoryRecord | null> {
    let data = await this.db.get(TX_TABLE, index);
    return data;
  }
}
