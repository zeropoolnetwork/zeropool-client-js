import { expose } from 'comlink';
import { Proof, Params, default as init, initThreadPool } from 'libzeropool-rs-wasm-web-mt';

import { FileCache } from './file-cache';

const wasmPath = new URL('libzeropool-rs-wasm-web-mt/libzeropool_rs_wasm_bg.wasm', import.meta.url);

let txParams;
let treeParams;

const obj = {
  async initWasm(paramUrls) {
    console.info('Initializing web worker...');
    await init(wasmPath);
    await initThreadPool(navigator.hardwareConcurrency);

    const cache = await FileCache.init();

    const txParamsData = await cache.getOrCache(paramUrls.txParams);
    txParams = Params.fromBinary(new Uint8Array(txParamsData));
    const treeParamsData = await cache.getOrCache(paramUrls.treeParams);
    treeParams = Params.fromBinary(new Uint8Array(treeParamsData));

    console.info('Web worker init complete.');
  },

  async proveTx(pub, sec) {
    console.debug('Web worker: proveTx');
    const proof = Proof.tx(txParams, pub, sec);
    console.debug('Web worker: proveTx complete');
    return proof
  },

  async proveTree(pub, sec) {
    console.debug('Web worker: proveTree');
    const proof = Proof.tree(treeParams, pub, sec);
    console.debug('Web worker: proveTree complete');
    return proof
  },
};

expose(obj);
