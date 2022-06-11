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
    return new Promise(async resolve => {
      console.debug('Web worker: proveTx');
      const result = Proof.tx(txParams, pub, sec);
      resolve(result);
    });
  },

  async proveTree(pub, sec) {
    return new Promise(async resolve => {
      console.debug('Web worker: proveTree');
      const result = Proof.tree(treeParams, pub, sec);
      resolve(result);
    });
  },
};

expose(obj);
