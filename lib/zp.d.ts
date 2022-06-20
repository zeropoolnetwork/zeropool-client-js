import { SnarkConfigParams, SnarkParams } from './config';
import { FileCache } from './file-cache';
export declare let zp: any;
export declare class ZeroPoolLibState {
    fileCache: FileCache;
    worker: any;
    snarkParams: SnarkParams;
}
/**
 * Initialize the library.
 * @param snarkParams
 * @returns stuff needed for creating a ZeroPoolState
 */
export declare function init(snarkParams: SnarkConfigParams): Promise<ZeroPoolLibState>;
