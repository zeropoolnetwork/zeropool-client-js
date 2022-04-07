import { openDB, IDBPDatabase } from 'idb';
import Web3 from 'web3';
import { Account, Note } from 'libzeropool-rs-wasm-web';
import { ShieldedTx, TxType } from './tx';
import { truncateHexPrefix } from './utils';

export enum HistoryTransactionType {
	Deposit = 1,
	TransferIn,
  TransferOut,
	Withdrawal,
}

export interface DecryptedMemo {
  index: number;
  acc: Account | undefined;
  inNotes:  { note: Note, index: number }[];
  outNotes: { note: Note, index: number }[];
}

export class HistoryRecord {
  constructor(
    public type: HistoryTransactionType,
    public timestamp: number,
    public from: string,
    public to: string,
    public amount: bigint,
    public fee: bigint,
    public txHash: string,
  ) {}

  public toJson(): string {
    return JSON.stringify(this, (_, v) => typeof v === 'bigint' ? `${v}n` : v)
        .replace(/"(-?\d+)n"/g, (_, a) => a);
  }
}

export class HistoryRecordIdx {
  index: number;
  record: HistoryRecord;

  public static create(record: HistoryRecord, index: number): HistoryRecordIdx {
    let result = new HistoryRecordIdx();
    result.index = index;
    result.record = record;

    return result;
  }
}

export async function convertToHistory(memo: DecryptedMemo, txHash: string, rpcUrl: string): Promise<HistoryRecordIdx[]> {
    const web3 = new Web3(rpcUrl);
    const txData = await web3.eth.getTransaction(txHash);
    if (txData && txData.blockNumber && txData.input) {
        const block = await web3.eth.getBlock(txData.blockNumber);
        if (block) {
            let ts: number = 0;
            if (typeof block.timestamp === "number" ) {
                ts = block.timestamp;
            } else if (typeof block.timestamp === "string" ) {
                ts = Number(block.timestamp);
            }

            // Decode transaction data
            try {
              const tx = ShieldedTx.decode(txData.input);

              if (tx.selector.toLowerCase() == "af989083") {
                // All data is collected here. Let's analyze it

                let allRecords: HistoryRecordIdx[] = [];
                if (tx.txType == TxType.Deposit) {
                  // here is a deposit transaction (approvable method)
                  // source address are recovered from the signature
                  if (tx.extra.length >= 64) {
                    const sig = tx.extra.substr(0, 64);
                    
                  } else {
                    //incorrect signature
                  }

                } else if (tx.txType == TxType.BridgeDeposit) {
                  // here is a deposit transaction (permittable token)
                  // source address in the memo block

                } else if (tx.txType == TxType.Transfer) {
                  // there are 2 cases: 
                  if (memo.acc) {
                    // 1. we initiated it => outcoming tx(s)

                  } else {
                    // 2. somebody initiated it => incoming tx(s)

                  }
                } else if (tx.txType == TxType.Withdraw) {
                  // withdrawal transaction (destination address in the memoblock)

                }

                let txType = HistoryTransactionType.TransferIn;
                let from = ``;
                let to = ``;
                let amount = BigInt(0);

                let record = new HistoryRecord( txType, ts, from, to, amount, BigInt(0), txHash);
                let idxRec = HistoryRecordIdx.create(record, memo.index);

                allRecords.push(idxRec);

                return allRecords;

              } else {
                throw new Error(`Cannot decode calldata for tx ${txHash}: incorrect selector ${tx.selector}`);
              }
            }
            catch (e) {
              throw new Error(`Cannot decode calldata for tx ${txHash}: ${e}`);
            }
        }

        throw new Error(`Unable to get timestamp for block ${txData.blockNumber}`);
    }

    throw new Error(`Unable to get transaction details (${txHash})`);
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
