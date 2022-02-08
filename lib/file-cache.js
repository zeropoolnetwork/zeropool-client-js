"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileCache = void 0;
const idb_1 = require("idb");
const STORE_NAME = 'files';
class FileCache {
    constructor(db) {
        this.db = db;
    }
    static async init() {
        const db = await (0, idb_1.openDB)('zp.file_cache', 1, {
            upgrade(db) {
                db.createObjectStore(STORE_NAME);
            }
        });
        const cache = new FileCache(db);
        return cache;
    }
    async getOrCache(path) {
        let data = await this.get(path);
        if (!data) {
            console.log(`Caching ${path}`);
            data = await this.cache(path);
        }
        else {
            console.log(`File ${path} is present in cache, no need to fetch`);
        }
        return data;
    }
    async cache(path) {
        const data = await (await fetch(path)).arrayBuffer();
        await this.db.put(STORE_NAME, data, path);
        return data;
    }
    async get(path) {
        let data = await this.db.get(STORE_NAME, path);
        return data;
    }
}
exports.FileCache = FileCache;
//# sourceMappingURL=file-cache.js.map