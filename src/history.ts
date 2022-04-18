import { openDB, IDBPDatabase } from 'idb';
import Web3 from 'web3';
import Personal from 'web3-eth-personal';
import { Account, Note, assembleAddress } from 'libzeropool-rs-wasm-web';
import { ShieldedTx, TxType } from './tx';
import { truncateHexPrefix, addHexPrefix, toCanonicalSignature, parseCompactSignature } from './utils';
import { CONSTANTS } from './constants';

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

export class TxHashIdx {
  index: number;
  txHash: string;

  public static create(txHash: string, index: number): TxHashIdx {
    let result = new TxHashIdx();
    result.index = index;
    result.txHash = txHash;

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
              const feeAmount = BigInt('0x' + tx.memo.substr(0, 16))

              if (tx.selector.toLowerCase() == "af989083") {
                  // All data is collected here. Let's analyze it

                  let allRecords: HistoryRecordIdx[] = [];
                  if (tx.txType == TxType.Deposit) {
                    // here is a deposit transaction (approvable method)
                    // source address are recovered from the signature
                    if (tx.extra && tx.extra.length >= 128) {
                      const fullSig = toCanonicalSignature(tx.extra.substr(0, 128));
                      const nullifier = '0x' + tx.nullifier.toString(16).padStart(64, '0');
                      const depositHolderAddr = await web3.eth.accounts.recover(nullifier, fullSig);

                      let rec = new HistoryRecord(HistoryTransactionType.Deposit, ts, depositHolderAddr, "", tx.tokenAmount - feeAmount, feeAmount, txHash);
                      allRecords.push(HistoryRecordIdx.create(rec, memo.index));
                      
                    } else {
                      //incorrect signature
                      throw new Error(`no signature for approvable deposit`);
                    }

                  } else if (tx.txType == TxType.BridgeDeposit) {
                    // here is a deposit transaction (permittable token)
                    // source address in the memo block (20 bytes, starts from 16 bytes offset)
                    const depositHolderAddr = '0x' + tx.memo.substr(32, 40);  // TODO: Check it!

                    let rec = new HistoryRecord(HistoryTransactionType.Deposit, ts, depositHolderAddr, "", tx.tokenAmount, feeAmount, txHash);
                    allRecords.push(HistoryRecordIdx.create(rec, memo.index));

                  } else if (tx.txType == TxType.Transfer) {
                    // there are 2 cases: 
                    if (memo.acc) {
                      // 1. we initiated it => outcoming tx(s)
                      for (let {note, index} of memo.outNotes) {
                        const destAddr = assembleAddress(note.d, note.p_d);
                        let rec = new HistoryRecord(HistoryTransactionType.TransferOut, ts, "", destAddr, BigInt(note.b), feeAmount / BigInt(memo.outNotes.length), txHash);
                        allRecords.push(HistoryRecordIdx.create(rec, index));
                      }
                    }

                    // 2. somebody (including this acc) initiated it => incoming tx(s)
                    for (let {note, index} of memo.inNotes) {
                      const destAddr = assembleAddress(note.d, note.p_d);
                      let rec = new HistoryRecord(HistoryTransactionType.TransferIn, ts, "", destAddr, BigInt(note.b), BigInt(0), txHash);
                      allRecords.push(HistoryRecordIdx.create(rec, index));
                    }
                  } else if (tx.txType == TxType.Withdraw) {
                    // withdrawal transaction (destination address in the memoblock)
                    const withdrawDestAddr = '0x' + tx.memo.substr(32, 40);

                    let rec = new HistoryRecord(HistoryTransactionType.Withdrawal, ts, "", withdrawDestAddr, (-tx.tokenAmount - feeAmount), feeAmount, txHash);
                    allRecords.push(HistoryRecordIdx.create(rec, memo.index));
                  }

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
const NATIVE_TX_TABLE = 'NATIVE_TX';
const DECRYPTED_MEMO_TABLE = 'DECRYPTED_MEMO';

// History storage holds the parsed history records corresponding to the current account
// and transaction hashes (on the native chain) which are needed for the history retrieving

export class HistoryStorage {
  private db: IDBPDatabase;

  constructor(db: IDBPDatabase) {
    this.db = db;
  }

  static async init(db_id: string): Promise<HistoryStorage> {
    const db = await openDB(`zeropool.${db_id}.history`, 2, {
      upgrade(db) {
        db.createObjectStore(TX_TABLE);   // table holds parsed history transactions
        db.createObjectStore(NATIVE_TX_TABLE);  // holds txHashes on the native chain
                                                // corresponded to the index
                                                // (index should be multiple 128)
        db.createObjectStore(DECRYPTED_MEMO_TABLE);  // holds memo blocks decrypted in the updateState process
      }
    });

    const cache = new HistoryStorage(db);
    return cache;
  }

  public async getAllHistory(): Promise<HistoryRecord[]> {
    let allRecords: HistoryRecord[] = await this.db.getAll(TX_TABLE);

    return allRecords;
  }

  public async put(index: number, data: HistoryRecord): Promise<HistoryRecord> {
    await this.db.put(TX_TABLE, data, index);
    return data;
  }

  public async get(index: number): Promise<HistoryRecord | null> {
    let data = await this.db.get(TX_TABLE, index);
    return data;
  }


  public async saveNativeTxHash(index: number, txHash: string): Promise<string> {
    const mask = (-1) << CONSTANTS.OUTLOG;
    await this.db.put(NATIVE_TX_TABLE, txHash, index & mask);
    return txHash;
  }

  public async getNativeTxHash(index: number): Promise<string | null> {
    const mask = (-1) << CONSTANTS.OUTLOG;
    let txHash = await this.db.get(NATIVE_TX_TABLE, index & mask);
    return txHash;
  }

  public async saveDecryptedMemo(index: number, memo: DecryptedMemo): Promise<DecryptedMemo> {
    const mask = (-1) << CONSTANTS.OUTLOG;
    await this.db.put(DECRYPTED_MEMO_TABLE, memo, index & mask);
    return memo;
  }

  public async getDecryptedMemo(index: number): Promise<DecryptedMemo | null> {
    const mask = (-1) << CONSTANTS.OUTLOG;
    let memo = await this.db.get(DECRYPTED_MEMO_TABLE, index & mask);
    return memo;
  }
}
