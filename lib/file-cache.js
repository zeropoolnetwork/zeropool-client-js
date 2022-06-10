import { openDB } from 'idb';
const STORE_NAME = 'files';
export class FileCache {
    constructor(db) {
        this.db = db;
    }
    static async init() {
        const db = await openDB('zp.file_cache', 1, {
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
//# sourceMappingURL=file-cache.js.map