
import * as zpSt from 'libzeropool-rs-wasm-web';
import * as zpMt from 'libzeropool-rs-wasm-web-mt';
import { wrap } from 'comlink';
import { threads } from 'wasm-feature-detect';

import { SnarkConfigParams, SnarkParams } from './config';
import { FileCache } from './file-cache';

export let zp: any = zpSt;

export class ZeroPoolLibState {
    public fileCache: FileCache;
    public worker: any;
    public snarkParams: SnarkParams;
}

export interface Paths {
    wasmMtPath: string;
    wasmStPath: string;
    workerStPath: string;
    workerMtPath: string;
}

export async function init(paths: Paths, snarkParams: SnarkConfigParams): Promise<ZeroPoolLibState> {
    const isMt = await threads();
    let workerPath = paths.workerStPath;
    let wasmPath = paths.wasmStPath;
    if (isMt) {
        console.log('Using multi-threaded version');
        zp = zpMt;
        workerPath = paths.workerMtPath;
        wasmPath = paths.wasmMtPath;
    } else {
        console.log('Using single-threaded version');
    }

    const fileCache = await FileCache.init();

    const worker: any = wrap(new Worker(workerPath));
    await worker.initWasm(wasmPath, {
        txParams: snarkParams.transferParamsUrl,
        treeParams: snarkParams.treeParamsUrl,
    });

    await zp.default(wasmPath);

    const txParamsData = await fileCache.getOrCache(snarkParams.transferParamsUrl);
    const transferParams = zp.Params.fromBinary(new Uint8Array(txParamsData));
    const treeParamsData = await fileCache.getOrCache(snarkParams.treeParamsUrl);
    const treeParams = zp.Params.fromBinary(new Uint8Array(treeParamsData));
    const transferVk = await (await fetch(snarkParams.transferVkUrl)).json();
    const treeVk = await (await fetch(snarkParams.treeVkUrl)).json();

    return {
        fileCache,
        worker,
        snarkParams: {
            transferParams,
            treeParams,
            transferVk,
            treeVk,
        }
    };
}
