
import * as zpSt from 'libzeropool-rs-wasm-web';
import * as zpMt from 'libzeropool-rs-wasm-web-mt';
import { wrap } from 'comlink';
import { threads } from 'wasm-feature-detect';

import { SnarkConfigParams, SnarkParams } from './config';
import { FileCache } from './file-cache';

const workerStPath = new URL('./workerSt.js', import.meta.url);
const workerMtPath = new URL('./workerMt.js', import.meta.url);
// TODO: Make it parcel-compatible
const wasmStPath = new URL('libzeropool-rs-wasm-web/libzeropool_rs_wasm_bg.wasm', import.meta.url);
const wasmMtPath = new URL('libzeropool-rs-wasm-web-mt/libzeropool_rs_wasm_bg.wasm', import.meta.url);

export let zp: any = zpSt;
export class ZeroPoolLibState {
    public fileCache: FileCache;
    public worker: any;
    public snarkParams: SnarkParams;
}

export async function init(snarkParams: SnarkConfigParams): Promise<ZeroPoolLibState> {
    const isMt = await threads();
    let workerPath = workerStPath;
    let wasmPath = wasmStPath;
    if (isMt) {
        console.log('Using multi-threaded version');
        zp = zpMt;
        workerPath = workerMtPath;
        wasmPath = wasmMtPath;
    } else {
        console.log('Using single-threaded version');
    }

    const fileCache = await FileCache.init();

    const _worker = await import(workerPath.href);
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
