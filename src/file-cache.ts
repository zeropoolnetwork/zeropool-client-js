import { openDB, IDBPDatabase } from 'idb';

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
    const res = await fetch(path);

    if (!res.ok) {
      throw new Error(`Failed to fetch file ${path}: ${res.statusText}`);
    }

    if (res.headers.get('content-type') === 'text/html') {
      throw new Error(`File ${path} is not a binary file`)
    }

    const data = await res.arrayBuffer();

    try {
      await this.db.put(STORE_NAME, data, path);
    } catch (e) {
      console.error(`Failed to cache ${path}: ${e}`);
    }

    return data;
  }

  public async get(path: string): Promise<ArrayBuffer | null> {
    let data = await this.db.get(STORE_NAME, path);
    return data;
  }
}
