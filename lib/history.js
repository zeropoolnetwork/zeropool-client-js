"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryStorage = exports.convertToHistory = exports.HistoryRecordIdx = exports.HistoryRecord = exports.HistoryTransactionType = void 0;
const idb_1 = require("idb");
const web3_1 = __importDefault(require("web3"));
const libzeropool_rs_wasm_web_1 = require("libzeropool-rs-wasm-web");
const tx_1 = require("./tx");
const utils_1 = require("./utils");
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
async function convertToHistory(memo, txHash, rpcUrl) {
    const web3 = new web3_1.default(rpcUrl);
    const txData = await web3.eth.getTransaction(txHash);
    if (txData && txData.blockNumber && txData.input) {
        const block = await web3.eth.getBlock(txData.blockNumber);
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
                    //if (tx.transferIndex == memo.index) {
                    // All data is collected here. Let's analyze it
                    let allRecords = [];
                    if (tx.txType == tx_1.TxType.Deposit) {
                        // here is a deposit transaction (approvable method)
                        // source address are recovered from the signature
                        if (tx.extra && tx.extra.length >= 128) {
                            const fullSig = (0, utils_1.toCanonicalSignature)(tx.extra.substr(0, 128));
                            const nullifier = '0x' + tx.nullifier.toString(16).padStart(64, '0');
                            const depositHolderAddr = await web3.eth.accounts.recover(nullifier, fullSig);
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
                        else {
                            // 2. somebody initiated it => incoming tx(s)
                            for (let { note, index } of memo.inNotes) {
                                const destAddr = (0, libzeropool_rs_wasm_web_1.assembleAddress)(note.d, note.p_d);
                                let rec = new HistoryRecord(HistoryTransactionType.TransferIn, ts, destAddr, "", BigInt(note.b), BigInt(0), txHash);
                                allRecords.push(HistoryRecordIdx.create(rec, index));
                            }
                        }
                    }
                    else if (tx.txType == tx_1.TxType.Withdraw) {
                        // withdrawal transaction (destination address in the memoblock)
                        const withdrawDestAddr = '0x' + tx.memo.substr(32, 40);
                        let rec = new HistoryRecord(HistoryTransactionType.Withdrawal, ts, "", withdrawDestAddr, (-tx.tokenAmount - feeAmount), feeAmount, txHash);
                        allRecords.push(HistoryRecordIdx.create(rec, memo.index));
                    }
                    return allRecords;
                    //} else {
                    //  throw new Error(`Transaction ${txHash} doesn't corresponds to the memo! (tx index ${tx.transferIndex} != memo index ${memo.index}`);
                    //}
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
exports.convertToHistory = convertToHistory;
const TX_TABLE = 'TX_STORE';
class HistoryStorage {
    constructor(db) {
        this.db = db;
    }
    static async init(db_id) {
        const db = await (0, idb_1.openDB)(`zeropool.${db_id}.history`, 1, {
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
    async put(index, data) {
        await this.db.put(TX_TABLE, data, index);
        return data;
    }
    async get(index) {
        let data = await this.db.get(TX_TABLE, index);
        return data;
    }
}
exports.HistoryStorage = HistoryStorage;
//# sourceMappingURL=history.js.map