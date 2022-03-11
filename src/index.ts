import { wrap } from 'comlink';
import { Params, default as initWasm } from 'libzeropool-rs-wasm-web';

import { SnarkConfigParams, SnarkParams } from './config';
import { FileCache } from './file-cache';

export { ZeropoolClient } from './client';

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

  initWasm(wasmPath);

  const txParamsData = await fileCache.getOrCache(snarkParams.transferParamsUrl);
  const transferParams = Params.fromBinary(new Uint8Array(txParamsData));
  const treeParamsData = await fileCache.getOrCache(snarkParams.treeParamsUrl);
  const treeParams = Params.fromBinary(new Uint8Array(treeParamsData));
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
