// TODO: Find a better way to switch between PLONK and Groth16, single and multi-threaded.
import { expose } from 'comlink';
import type { IndexedTx, ParseTxsResult } from 'libzeropool-rs-wasm-web';
import { Proof as ProofGroth16, Params as ParamsGroth16, TxParser as TxParserGroth16, default as initGroth16, initThreadPool as initThreadPoolGroth16 } from 'libzeropool-rs-wasm-web-mt';
import { Proof as ProofPlonk, Params as ParamsPlonk, TxParser as TxParserPlonk, default as initPlonk, initThreadPool as initThreadPoolPlonk } from 'libzeropool-rs-wasm-plonk-web-mt';

import type { SnarkConfigParams } from './config';
import { FileCache } from './file-cache';

let Params: any;
let Proof: any;
let TxParser: any;

let txParams: any;
let txParser: any;

const obj = {
  async initWasm(config: SnarkConfigParams, wasmPath?: string) {
    if (config.plonk) {
      console.info('Initializing web worker for PLONK...');
      await initPlonk(wasmPath);
      Params = ParamsPlonk;
      Proof = ProofPlonk;
      TxParser = TxParserPlonk;
      await initThreadPoolPlonk(navigator.hardwareConcurrency);
    } else {
      console.info('Initializing web worker for Groth16...');
      await initGroth16(wasmPath);
      Params = ParamsGroth16;
      Proof = ProofGroth16;
      TxParser = TxParserGroth16;
      await initThreadPoolGroth16(navigator.hardwareConcurrency);
    }

    const cache = await FileCache.init();


    if (config.plonk) {
      const plonkParamsData = await cache.getOrCache(config.plonkParamsUrl);

      if (config.transferPkUrl) {
        const transferPkData = await cache.getOrCache(config.transferPkUrl);
        txParams = Params.fromBinaryWithPk(new Uint8Array(plonkParamsData!), new Uint8Array(transferPkData!));
      } else {
        txParams = Params.fromBinary(new Uint8Array(plonkParamsData!));
      }
    } else {
      const txParamsData = await cache.getOrCache(config.transferParamsUrl);
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
