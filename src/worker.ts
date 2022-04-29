import { expose } from 'comlink';
import { Proof, Params, default as init } from 'libzeropool-rs-wasm-web';

import { FileCache } from './file-cache';

let txParams: Params;
let treeParams: Params;

const obj = {
  async initWasm(url: string, paramUrls: { txParams: string; treeParams: string }) {
    console.info('Initializing web worker...');
    await init(url);

    const cache = await FileCache.init();

    let txParamsData = await cache.get(paramUrls.txParams);
    if (!txParamsData) {
      console.log(`Caching ${paramUrls.txParams}`)
      txParamsData = await cache.cache(paramUrls.txParams);
      txParams = Params.fromBinary(new Uint8Array(txParamsData!), true, true);
    } else {
      console.log(`File ${paramUrls.txParams} is present in cache, no need to fetch`);
      txParams = Params.fromBinary(new Uint8Array(txParamsData!), false, false);
    }
    
    let treeParamsData = await cache.get(paramUrls.treeParams);
    if (!treeParamsData) {
      console.log(`Caching ${paramUrls.treeParams}`)
      treeParamsData = await cache.cache(paramUrls.treeParams);
      treeParams = Params.fromBinary(new Uint8Array(treeParamsData!), true, true);
    } else {
      console.log(`File ${paramUrls.treeParams} is present in cache, no need to fetch`);
      treeParams = Params.fromBinary(new Uint8Array(treeParamsData!), false, false);
    }

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
