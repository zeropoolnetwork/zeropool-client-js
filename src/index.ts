import { wrap } from 'comlink';
import { Params, default as initWasm } from 'libzkbob-rs-wasm-web';

import { SnarkConfigParams, SnarkParams } from './config';
import { FileCache } from './file-cache';

export { ZkBobClient, TxAmount, FeeAmount, PoolLimits } from './client';

export { TxType } from './tx';

export { HistoryRecord, HistoryTransactionType } from './history'

const WASM_PATH = new URL('libzkbob-rs-wasm-web/libzeropool_rs_wasm_bg.wasm', import.meta.url).href;

export class ZkBobLibState {
  public fileCache: FileCache;
  public worker: any;
  public snarkParams: SnarkParams;
}

export async function init(snarkParams: SnarkConfigParams): Promise<ZkBobLibState> {
  const fileCache = await FileCache.init();

  const worker: any = wrap(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  await worker.initWasm(WASM_PATH, {
    txParams: snarkParams.transferParamsUrl,
    treeParams: snarkParams.treeParamsUrl,
  });

  await initWasm(WASM_PATH);
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
