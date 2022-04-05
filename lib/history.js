"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryStorage = exports.HistoryTransactionType = void 0;
const idb_1 = require("idb");
var HistoryTransactionType;
(function (HistoryTransactionType) {
    HistoryTransactionType[HistoryTransactionType["Deposit"] = 1] = "Deposit";
    HistoryTransactionType[HistoryTransactionType["Transfer"] = 2] = "Transfer";
    HistoryTransactionType[HistoryTransactionType["Withdrawal"] = 3] = "Withdrawal";
    HistoryTransactionType[HistoryTransactionType["BridgeDeposit"] = 4] = "BridgeDeposit";
})(HistoryTransactionType = exports.HistoryTransactionType || (exports.HistoryTransactionType = {}));
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
        await this.db.put(TX_TABLE, data, index.toString());
        return data;
    }
    async get(index) {
        let data = await this.db.get(TX_TABLE, index.toString());
        return data;
    }
}
exports.HistoryStorage = HistoryStorage;
//# sourceMappingURL=history.js.map