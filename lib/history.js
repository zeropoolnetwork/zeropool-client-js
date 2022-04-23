"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryStorage = exports.TxHashIdx = exports.HistoryRecordIdx = exports.HistoryRecord = exports.HistoryTransactionType = void 0;
const idb_1 = require("idb");
const web3_1 = __importDefault(require("web3"));
const libzeropool_rs_wasm_web_1 = require("libzeropool-rs-wasm-web");
const tx_1 = require("./tx");
const utils_1 = require("./utils");
const constants_1 = require("./constants");
var HistoryTransactionType;
(function (HistoryTransactionType) {
    HistoryTransactionType[HistoryTransactionType["Deposit"] = 1] = "Deposit";
    HistoryTransactionType[HistoryTransactionType["TransferIn"] = 2] = "TransferIn";
    HistoryTransactionType[HistoryTransactionType["TransferOut"] = 3] = "TransferOut";
    HistoryTransactionType[HistoryTransactionType["Withdrawal"] = 4] = "Withdrawal";
})(HistoryTransactionType = exports.HistoryTransactionType || (exports.HistoryTransactionType = {}));
class HistoryRecord {
    constructor(type, timestamp, from, to, amount, fee, txHash) {
        this.type = type;
        this.timestamp = timestamp;
        this.from = from;
        this.to = to;
        this.amount = amount;
        this.fee = fee;
        this.txHash = txHash;
    }
    toJson() {
        return JSON.stringify(this, (_, v) => typeof v === 'bigint' ? `${v}n` : v)
            .replace(/"(-?\d+)n"/g, (_, a) => a);
    }
}
exports.HistoryRecord = HistoryRecord;
class HistoryRecordIdx {
    static create(record, index) {
        let result = new HistoryRecordIdx();
        result.index = index;
        result.record = record;
        return result;
    }
}
exports.HistoryRecordIdx = HistoryRecordIdx;
class TxHashIdx {
    static create(txHash, index) {
        let result = new TxHashIdx();
        result.index = index;
        result.txHash = txHash;
        return result;
    }
}
exports.TxHashIdx = TxHashIdx;
const TX_TABLE = 'TX_STORE';
const DECRYPTED_MEMO_TABLE = 'DECRYPTED_MEMO';
const HISTORY_STATE_TABLE = 'HISTORY_STATE';
// History storage holds the parsed history records corresponding to the current account
// and transaction hashes (on the native chain) which are needed for the history retrieving
class HistoryStorage {
    constructor(db, rpcUrl) {
        this.syncIndex = -1;
        this.unparsedMemo = new Map(); // local decrypted memos cache
        this.currentHistory = new Map(); // local history cache
        this.db = db;
        this.web3 = new web3_1.default(rpcUrl);
    }
    static async init(db_id, rpcUrl) {
        const db = await (0, idb_1.openDB)(`zeropool.${db_id}.history`, 2, {
            upgrade(db) {
                db.createObjectStore(TX_TABLE); // table holds parsed history transactions
                db.createObjectStore(DECRYPTED_MEMO_TABLE); // holds memo blocks decrypted in the updateState process
                db.createObjectStore(HISTORY_STATE_TABLE);
            }
        });
        const storage = new HistoryStorage(db, rpcUrl);
        await storage.preloadCache();
        return storage;
    }
    async preloadCache() {
        let syncIndex = await this.db.get(HISTORY_STATE_TABLE, 'sync_index');
        if (syncIndex) {
            this.syncIndex = syncIndex;
        }
        // getting unprocessed memo array
        let allUnprocessedMemos = await this.db.getAll(DECRYPTED_MEMO_TABLE, IDBKeyRange.lowerBound(this.syncIndex + 1));
        for (let oneMemo of allUnprocessedMemos) {
            this.unparsedMemo.set(oneMemo.index, oneMemo);
        }
        // getting saved history records
        let cursor = await this.db.transaction(TX_TABLE).store.openCursor();
        while (cursor) {
            this.currentHistory.set(Number(cursor.primaryKey), cursor.value);
            cursor = await cursor.continue();
        }
        console.log(`HistoryStorage: preload ${this.currentHistory.size} history records and ${this.unparsedMemo.size} unparsed memos (from index ${this.syncIndex + 1})`);
    }
    async getAllHistory() {
        if (this.syncHistoryPromise == undefined) {
            this.syncHistoryPromise = this.syncHistory().finally(() => {
                this.syncHistoryPromise = undefined;
            });
        }
        await this.syncHistoryPromise;
        let recordsArray = Array.from(this.currentHistory.values());
        return recordsArray.sort((rec1, rec2) => 0 - (rec1.timestamp > rec2.timestamp ? -1 : 1));
    }
    async saveDecryptedMemo(memo) {
        const mask = (-1) << constants_1.CONSTANTS.OUTLOG;
        const memoIndex = memo.index & mask;
        if (memo.index > this.syncIndex) {
            this.unparsedMemo.set(memoIndex, memo);
        }
        await this.db.put(DECRYPTED_MEMO_TABLE, memo, memoIndex);
        return memo;
    }
    async getDecryptedMemo(index) {
        const mask = (-1) << constants_1.CONSTANTS.OUTLOG;
        const memoIndex = index & mask;
        let memo = await this.db.get(DECRYPTED_MEMO_TABLE, memoIndex);
        return memo;
    }
    // ------- Private rouutines --------
    async syncHistory() {
        const startTime = Date.now();
        if (this.unparsedMemo.size > 0) {
            console.log(`Starting memo synchronizing from the index ${this.syncIndex + 1} (${this.unparsedMemo.size} unprocessed memos)`);
            let historyPromises = [];
            let processedIndexes = [];
            for (let oneMemo of this.unparsedMemo.values()) {
                let hist = this.convertToHistory(oneMemo);
                historyPromises.push(hist);
                processedIndexes.push(oneMemo.index);
            }
            let historyRedords = await Promise.all(historyPromises);
            let newSyncIndex = this.syncIndex;
            for (let oneSet of historyRedords) {
                for (let oneRec of oneSet) {
                    console.log(`History record @${oneRec.index} has been created`);
                    this.currentHistory.set(oneRec.index, oneRec.record);
                    this.put(oneRec.index, oneRec.record);
                    newSyncIndex = oneRec.index;
                }
            }
            for (let oneIndex of processedIndexes) {
                this.unparsedMemo.delete(oneIndex);
            }
            this.syncIndex = newSyncIndex;
            this.db.put(HISTORY_STATE_TABLE, this.syncIndex, 'sync_index');
            const timeMs = Date.now() - startTime;
            console.log(`History has been synced up to index ${this.syncIndex} in ${timeMs} msec`);
        }
        else {
            console.log(`Memo sync is not required: already up-to-date (on index ${this.syncIndex + 1})`);
        }
    }
    async put(index, data) {
        await this.db.put(TX_TABLE, data, index);
        return data;
    }
    async get(index) {
        let data = await this.db.get(TX_TABLE, index);
        return data;
    }
    async convertToHistory(memo) {
        let txHash = memo.txHash;
        if (txHash) {
            const txData = await this.web3.eth.getTransaction(txHash);
            if (txData && txData.blockNumber && txData.input) {
                const block = await this.web3.eth.getBlock(txData.blockNumber);
                if (block) {
                    let ts = 0;
                    if (typeof block.timestamp === "number") {
                        ts = block.timestamp;
                    }
                    else if (typeof block.timestamp === "string") {
                        ts = Number(block.timestamp);
                    }
                    // Decode transaction data
                    try {
                        const tx = tx_1.ShieldedTx.decode(txData.input);
                        const feeAmount = BigInt('0x' + tx.memo.substr(0, 16));
                        if (tx.selector.toLowerCase() == "af989083") {
                            // All data is collected here. Let's analyze it
                            let allRecords = [];
                            if (tx.txType == tx_1.TxType.Deposit) {
                                // here is a deposit transaction (approvable method)
                                // source address are recovered from the signature
                                if (tx.extra && tx.extra.length >= 128) {
                                    const fullSig = (0, utils_1.toCanonicalSignature)(tx.extra.substr(0, 128));
                                    const nullifier = '0x' + tx.nullifier.toString(16).padStart(64, '0');
                                    const depositHolderAddr = await this.web3.eth.accounts.recover(nullifier, fullSig);
                                    let rec = new HistoryRecord(HistoryTransactionType.Deposit, ts, depositHolderAddr, "", tx.tokenAmount - feeAmount, feeAmount, txHash);
                                    allRecords.push(HistoryRecordIdx.create(rec, memo.index));
                                }
                                else {
                                    //incorrect signature
                                    throw new Error(`no signature for approvable deposit`);
                                }
                            }
                            else if (tx.txType == tx_1.TxType.BridgeDeposit) {
                                // here is a deposit transaction (permittable token)
                                // source address in the memo block (20 bytes, starts from 16 bytes offset)
                                const depositHolderAddr = '0x' + tx.memo.substr(32, 40); // TODO: Check it!
                                let rec = new HistoryRecord(HistoryTransactionType.Deposit, ts, depositHolderAddr, "", tx.tokenAmount, feeAmount, txHash);
                                allRecords.push(HistoryRecordIdx.create(rec, memo.index));
                            }
                            else if (tx.txType == tx_1.TxType.Transfer) {
                                // there are 2 cases: 
                                if (memo.acc) {
                                    // 1. we initiated it => outcoming tx(s)
                                    for (let { note, index } of memo.outNotes) {
                                        const destAddr = (0, libzeropool_rs_wasm_web_1.assembleAddress)(note.d, note.p_d);
                                        let rec = new HistoryRecord(HistoryTransactionType.TransferOut, ts, "", destAddr, BigInt(note.b), feeAmount / BigInt(memo.outNotes.length), txHash);
                                        allRecords.push(HistoryRecordIdx.create(rec, index));
                                    }
                                }
                                // 2. somebody (including this acc) initiated it => incoming tx(s)
                                for (let { note, index } of memo.inNotes) {
                                    const destAddr = (0, libzeropool_rs_wasm_web_1.assembleAddress)(note.d, note.p_d);
                                    let rec = new HistoryRecord(HistoryTransactionType.TransferIn, ts, "", destAddr, BigInt(note.b), BigInt(0), txHash);
                                    allRecords.push(HistoryRecordIdx.create(rec, index));
                                }
                            }
                            else if (tx.txType == tx_1.TxType.Withdraw) {
                                // withdrawal transaction (destination address in the memoblock)
                                const withdrawDestAddr = '0x' + tx.memo.substr(32, 40);
                                let rec = new HistoryRecord(HistoryTransactionType.Withdrawal, ts, "", withdrawDestAddr, (-tx.tokenAmount - feeAmount), feeAmount, txHash);
                                allRecords.push(HistoryRecordIdx.create(rec, memo.index));
                            }
                            return allRecords;
                        }
                        else {
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
        throw new Error(`Cannot find txHash for memo at index ${memo.index}`);
    }
}
exports.HistoryStorage = HistoryStorage;
//# sourceMappingURL=history.js.map