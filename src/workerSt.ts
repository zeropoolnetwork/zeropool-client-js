import { expose } from 'comlink';
import { Proof, Params, TxParser, IndexedTx, ParseTxsResult, default as init } from 'libzeropool-rs-wasm-web';

import type { SnarkConfigParams } from './config';
import { FileCache } from './file-cache';

let txParams: Params;
let txParser: TxParser;

const obj = {
  async initWasm(paramUrls: SnarkConfigParams, wasmPath?: string) {
    if (paramUrls.plonk) {
      throw new Error('PLONK is not supported in single-threaded mode');
    }

    console.info('Initializing web worker...');
    await init(wasmPath);

    const cache = await FileCache.init();

    const txParamsData = await cache.getOrCache(paramUrls.transferParamsUrl);
    txParams = Params.fromBinaryExtended(new Uint8Array(txParamsData!), false, false);

    txParser = TxParser._new()
    console.info('Web worker init complete.');
  },

  async proveTx(pub, sec) {
    return Proof.tx(txParams, pub, sec);
  },

  async parseTxs(sk: Uint8Array, txs: IndexedTx[]): Promise<ParseTxsResult> {
    const result = txParser.parseTxs(sk, txs)
    sk.fill(0);
    return result;
  },
};

expose(obj);
