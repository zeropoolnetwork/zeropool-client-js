"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryStorage = exports.HistoryRecord = exports.HistoryTransactionType = void 0;
const idb_1 = require("idb");
var HistoryTransactionType;
(function (HistoryTransactionType) {
    HistoryTransactionType[HistoryTransactionType["DepositAllow"] = 1] = "DepositAllow";
    HistoryTransactionType[HistoryTransactionType["DepositPermit"] = 2] = "DepositPermit";
    HistoryTransactionType[HistoryTransactionType["TransferIn"] = 3] = "TransferIn";
    HistoryTransactionType[HistoryTransactionType["TransferOut"] = 4] = "TransferOut";
    HistoryTransactionType[HistoryTransactionType["Withdrawal"] = 5] = "Withdrawal";
})(HistoryTransactionType = exports.HistoryTransactionType || (exports.HistoryTransactionType = {}));
class HistoryRecord {
    constructor(type, timestamp, from, to, amount, txHash) {
        this.type = type;
        this.timestamp = timestamp;
        this.from = from;
        this.to = to;
        this.amount = amount;
        this.txHash = txHash;
    }
}
exports.HistoryRecord = HistoryRecord;
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