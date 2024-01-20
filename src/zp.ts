
import { wrap } from 'comlink';
import * as zpSt from 'libzeropool-rs-wasm-web';
import * as zpMt from 'libzeropool-rs-wasm-web-mt';
import * as zpMtPlonk from 'libzeropool-rs-wasm-plonk-web-mt';
import { threads } from 'wasm-feature-detect';

import { SnarkConfigParams } from './config';
import { FileCache } from './file-cache';


export const defaultPaths = {
  wasmMt: 'node_modules/libzeropool-rs-wasm-web-mt/libzeropool_rs_wasm_mt.wasm',
  wasmSt: 'node_modules/libzeropool-rs-wasm-web/libzeropool_rs_wasm.wasm',
  wasmMtPlonk: 'node_modules/libzeropool-rs-wasm-plonk-web-mt/libzeropool_rs_wasm_plonk_mt.wasm',
  wasmStPlonk: 'node_modules/libzeropool-rs-wasm-plonk-web/libzeropool_rs_wasm_plonk.wasm',
}

export let zp: any;

export class ZeroPoolLibState {
  public fileCache: FileCache;
  public worker: any;
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

    if (snarkParams.plonk) {
      zp = zpMtPlonk;
    } else {
      zp = zpMt;
    }

    wasmPath = paths.wasmMt;
  } else {
    console.log('Using single-threaded version. Proof generation will be significantly slower.');

    if (snarkParams.plonk) {
      throw new Error('PLONK is not supported in single-threaded mode');
    } else {
      zp = zpSt;
    }
  }

  const fileCache = await FileCache.init();

  let worker: any;
  if (isMt) {
    worker = wrap(new Worker(paths.workerMt));
  } else {
    worker = wrap(new Worker(paths.workerSt));
  }

  await worker.initWasm(snarkParams, wasmPath);

  await zp.default(wasmPath);

  return {
    fileCache,
    worker,
  };
}
