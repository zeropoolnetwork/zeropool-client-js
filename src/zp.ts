
import { wrap } from 'comlink';
import * as zpSt from 'libzeropool-rs-wasm-web';
import * as zpMt from 'libzeropool-rs-wasm-web-mt';
import { threads } from 'wasm-feature-detect';

import { SnarkConfigParams, SnarkParams } from './config';
import { FileCache } from './file-cache';


export const defaultPaths = {
  wasmMt: 'node_modules/libzeropool-rs-wasm-web-mt/libzeropool_rs_wasm_mt.wasm',
  wasmSt: 'node_modules/libzeropool-rs-wasm-web/libzeropool_rs_wasm.wasm',
}

export let zp: any = zpSt;

export class ZeroPoolLibState {
  public fileCache: FileCache;
  public worker: any;
  public snarkParams: SnarkParams;
}

export type Paths = {
  workerMt: string,
  workerSt: string,
  wasmMt?: string,
  wasmSt?: string,
};

/**
 * Initialize the library.
 * @param snarkParams
 * @param paths optional paths to wasm and worker files
 * @returns stuff needed for creating a ZeroPoolState
 */
export async function init(snarkParams: SnarkConfigParams, paths: Paths): Promise<ZeroPoolLibState> {
  const isMt = await threads();
  let wasmPath = paths.wasmSt;
  if (isMt) {
    console.log('Using multi-threaded version');
    zp = zpMt;
    wasmPath = paths.wasmMt;
  } else {
    console.log('Using single-threaded version. Proof generation will be significantly slower.');
  }

  const fileCache = await FileCache.init();

  let worker: any;
  if (isMt) {
    worker = wrap(new Worker(new URL(paths.workerMt)));
  } else {
    worker = wrap(new Worker(paths.workerSt));
  }

  await worker.initWasm({
    txParams: snarkParams.transferParamsUrl,
  }, wasmPath);

  await zp.default(wasmPath);

  const transferVk = await (await fetch(snarkParams.transferVkUrl)).json();

  return {
    fileCache,
    worker,
    snarkParams: {
      transferVk,
    }
  };
}
