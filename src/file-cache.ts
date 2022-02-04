import { openDB, deleteDB, wrap, unwrap, IDBPDatabase, DBSchema } from 'idb';

const STORE_NAME = 'files';

export class FileCache {
  private db: IDBPDatabase;

  constructor(db: IDBPDatabase) {
    this.db = db;
  }

  static async init(): Promise<FileCache> {
    const db = await openDB('zp.file_cache', 1, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME);
      }
    });

    const cache = new FileCache(db);
    return cache;
  }

  public async getOrCache(path: string): Promise<ArrayBuffer> {
    let data = await this.get(path);
    if (!data) {
      console.log(`Caching ${path}`)
      data = await this.cache(path);
    } else {
      console.log(`File ${path} is present in cache, no need to fetch`);
    }

    return data;
  }

  public async cache(path: string): Promise<ArrayBuffer> {
    const data = await (await fetch(path)).arrayBuffer();
    await this.db.put(STORE_NAME, data, path);
    return data;
  }

  public async get(path: string): Promise<ArrayBuffer | null> {
    let data = await this.db.get(STORE_NAME, path);
    return data;
  }
}
