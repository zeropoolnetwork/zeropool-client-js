import { expose } from 'comlink';
import { Proof, Params, TxParser, IndexedTx, ParseTxsResult, default as init, initThreadPool } from 'libzeropool-rs-wasm-web-mt';

import { FileCache } from './file-cache';

let txParams: Params;
let txParser: TxParser;

const obj = {
  async initWasm(paramUrls: { txParams: string; }, wasmPath?: string) {
    console.info('Initializing web worker...');
    await init(wasmPath);
    console.info('Initializing thread pool...')
    await initThreadPool(navigator.hardwareConcurrency);

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

    txParser = TxParser._new()
    console.info('Web worker init complete.');
  },

  async proveTx(pub, sec) {
    console.log('Web worker: proveTx');
    const res = Proof.tx(txParams, pub, sec);
    console.log('Web worker: proveTx done');
    return res;
  },

  async parseTxs(sk: Uint8Array, txs: IndexedTx[]): Promise<ParseTxsResult> {
    console.log('Web worker: parseTxs');
    const result = txParser.parseTxs(sk, txs);
    console.log('Web worker: parseTxs done');
    sk.fill(0);
    return result;
  },
};

expose(obj);
