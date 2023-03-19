import type { VK } from 'libzeropool-rs-wasm-web';

export interface Config {
  snarkParams: SnarkConfigParams;
  wasmPath: string;
  workerPath: string;
}

export interface SnarkConfigParams {
  transferParamsUrl: string;
  transferVkUrl: string;
}

export interface SnarkParams {
  transferVk?: VK;
}

export type Tokens = {
  [address: string]: Token;
};

export interface Token {
  poolAddress: string;
  relayerUrl: string;
}
