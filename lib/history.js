"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryStorage = exports.convertToHistory = exports.HistoryRecordIdx = exports.HistoryRecord = exports.HistoryTransactionType = void 0;
const idb_1 = require("idb");
const web3_1 = __importDefault(require("web3"));
const tx_1 = require("./tx");
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
                if (tx.selector.toLowerCase() == "af989083") {
                    // All data is collected here. Let's analyze it
                    let allRecords = [];
                    if (tx.txType == tx_1.TxType.Deposit) {
                        // here is a deposit transaction (approvable method)
                        // source address are recovered from the signature
                        if (tx.extra.length >= 64) {
                            const sig = tx.extra.substr(0, 64);
                        }
                        else {
                            //incorrect signature
                        }
                    }
                    else if (tx.txType == tx_1.TxType.BridgeDeposit) {
                        // here is a deposit transaction (permittable token)
                        // source address in the memo block
                    }
                    else if (tx.txType == tx_1.TxType.Transfer) {
                        // there are 2 cases: 
                        if (memo.acc) {
                            // 1. we initiated it => outcoming tx(s)
                        }
                        else {
                            // 2. somebody initiated it => incoming tx(s)
                        }
                    }
                    else if (tx.txType == tx_1.TxType.Withdraw) {
                        // withdrawal transaction (destination address in the memoblock)
                    }
                    let txType = HistoryTransactionType.TransferIn;
                    let from = ``;
                    let to = ``;
                    let amount = BigInt(0);
                    let record = new HistoryRecord(txType, ts, from, to, amount, BigInt(0), txHash);
                    let idxRec = HistoryRecordIdx.create(record, memo.index);
                    allRecords.push(idxRec);
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