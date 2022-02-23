import { wrap } from 'comlink';
import * as libzeropool from 'libzeropool-rs-wasm-web';

import { SnarkConfigParams, SnarkParams } from './config';
import { FileCache } from './file-cache';
export { ZeropoolClient as EvmZeropoolClient } from './evm/client';

export class ZeroPoolLibState {
  public fileCache: FileCache;
  public worker: any;
  public snarkParams: SnarkParams;
}

export async function init(wasmPath: string, workerPath: string, snarkParams: SnarkConfigParams): Promise<ZeroPoolLibState> {
  const fileCache = await FileCache.init();

  const worker: any = wrap(new Worker(workerPath));
  await worker.initWasm(wasmPath, {
    txParams: snarkParams.transferParamsUrl,
    treeParams: snarkParams.treeParamsUrl,
  });

  const txParamsData = await fileCache.getOrCache(snarkParams.transferParamsUrl);
  const transferParams = libzeropool.Params.fromBinary(new Uint8Array(txParamsData));
  const treeParamsData = await fileCache.getOrCache(snarkParams.treeParamsUrl);
  const treeParams = libzeropool.Params.fromBinary(new Uint8Array(treeParamsData));
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
