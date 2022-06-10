import { SnarkConfigParams, SnarkParams } from './config';
import { FileCache } from './file-cache';
export declare let zp: any;
export declare class ZeroPoolLibState {
    fileCache: FileCache;
    worker: any;
    snarkParams: SnarkParams;
}
export interface Paths {
    wasmMtPath: string;
    wasmStPath: string;
    workerStPath: string;
    workerMtPath: string;
}
export declare function init(paths: Paths, snarkParams: SnarkConfigParams): Promise<ZeroPoolLibState>;
