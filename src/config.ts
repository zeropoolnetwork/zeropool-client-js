export interface Config {
  snarkParams: SnarkConfigParams;
  wasmPath: string;
  workerPath: string;
}

export interface Groth16Params {
  plonk: false;
  transferParamsUrl: string;
}

export interface PlonkParams {
  plonk: true;
  plonkParamsUrl: string;
  transferPkUrl?: string;
}

export type SnarkConfigParams = Groth16Params | PlonkParams;

export type Tokens = {
  [address: string]: Token;
};

export interface Token {
  poolAddress: string;
  relayerUrl: string;
}
