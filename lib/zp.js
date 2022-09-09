import { wrap } from 'comlink';
import * as zpSt from 'libzeropool-rs-wasm-web';
import * as zpMt from 'libzeropool-rs-wasm-web-mt';
import { threads } from 'wasm-feature-detect';
import { FileCache } from './file-cache';
const WASM_ST_PATH = new URL('libzeropool-rs-wasm-web/libzeropool_rs_wasm_bg.wasm', import.meta.url).href;
const WASM_MT_PATH = new URL('libzeropool-rs-wasm-web-mt/libzeropool_rs_wasm_bg.wasm', import.meta.url).href;
export let zp = zpSt;
export class ZeroPoolLibState {
}
/**
 * Initialize the library.
 * @param snarkParams
 * @returns stuff needed for creating a ZeroPoolState
 */
export async function init(snarkParams) {
    // Safari doesn't support spawning Workers from inside other Workers yet.
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isMt = await threads() && !isSafari;
    let wasmPath = WASM_ST_PATH;
    if (isMt) {
        console.log('Using multi-threaded version');
        zp = zpMt;
        wasmPath = WASM_MT_PATH;
    }
    else {
        console.log('Using single-threaded version. Proof generation will be significantly slower.');
    }
    const fileCache = await FileCache.init();
    let worker;
    if (isMt) {
        worker = wrap(new Worker(new URL('./workerMt.js', import.meta.url), { type: 'module' }));
    }
    else {
        worker = wrap(new Worker(new URL('./workerSt.js', import.meta.url), { type: 'module' }));
    }
    await worker.initWasm({
        txParams: snarkParams.transferParamsUrl,
        treeParams: snarkParams.treeParamsUrl,
    });
    await zp.default(wasmPath);
    const transferVk = await (await fetch(snarkParams.transferVkUrl)).json();
    const treeVk = await (await fetch(snarkParams.treeVkUrl)).json();
    return {
        fileCache,
        worker,
        snarkParams: {
            transferVk,
            treeVk,
        }
    };
}
//# sourceMappingURL=zp.js.map