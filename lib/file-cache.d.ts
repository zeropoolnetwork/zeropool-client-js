import { IDBPDatabase } from 'idb';
export declare class FileCache {
    private db;
    constructor(db: IDBPDatabase);
    static init(): Promise<FileCache>;
    getOrCache(path: string): Promise<ArrayBuffer>;
    cache(path: string): Promise<ArrayBuffer>;
    get(path: string): Promise<ArrayBuffer | null>;
}
