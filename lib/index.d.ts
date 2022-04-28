import { SnarkConfigParams, SnarkParams } from './config';
import { FileCache } from './file-cache';
export { ZeropoolClient } from './client';
export { HistoryRecord, HistoryTransactionType } from './history';
export declare class ZeroPoolLibState {
    fileCache: FileCache;
    worker: any;
    snarkParams: SnarkParams;
}
export declare function init(wasmPath: string, workerPath: string, snarkParams: SnarkConfigParams): Promise<ZeroPoolLibState>;
