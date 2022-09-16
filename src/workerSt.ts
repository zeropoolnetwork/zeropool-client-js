import { expose } from 'comlink';
import { Proof, Params, TxParser, IndexedTx, ParseTxsResult, default as init } from 'libzeropool-rs-wasm-web';

import { FileCache } from './file-cache';

const WASM_PATH = new URL('libzeropool-rs-wasm-web/libzeropool_rs_wasm_bg.wasm', import.meta.url);

let txParams: Params;
let treeParams: Params;
let txParser: TxParser;

const obj = {
  async initWasm(paramUrls: { txParams: string; treeParams: string }, wasmPath?: string) {
    console.info('Initializing web worker...');
    await init(wasmPath || WASM_PATH);

    const cache = await FileCache.init();

    let txParamsData = await cache.get(paramUrls.txParams);
    if (!txParamsData) {
      console.log(`Caching ${paramUrls.txParams}`)
      txParamsData = await cache.cache(paramUrls.txParams);
      txParams = Params.fromBinary(new Uint8Array(txParamsData!));
    } else {
      console.log(`File ${paramUrls.txParams} is present in cache, no need to fetch`);
      txParams = Params.fromBinaryExtended(new Uint8Array(txParamsData!), false, false);
    }

    let treeParamsData = await cache.get(paramUrls.treeParams);
    if (!treeParamsData) {
      console.log(`Caching ${paramUrls.treeParams}`)
      treeParamsData = await cache.cache(paramUrls.treeParams);
      treeParams = Params.fromBinary(new Uint8Array(treeParamsData!));
    } else {
      console.log(`File ${paramUrls.treeParams} is present in cache, no need to fetch`);
      treeParams = Params.fromBinaryExtended(new Uint8Array(treeParamsData!), false, false);
    }

    txParser = TxParser.new()
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

  async parseTxs(sk: Uint8Array, txs: IndexedTx[]): Promise<ParseTxsResult> {
    return new Promise(async resolve => {
      console.debug('Web worker: parseTxs');
      const result = txParser.parseTxs(sk, txs)
      sk.fill(0)
      resolve(result);
    });
  },
};

expose(obj);