import { TxType } from '../tx';

export interface RelayerTx {
  mined: boolean,
  commitment: string,
  hash: string,
  memo: string,
}

export interface TxData {
  timestamp: number;
  txType: TxType,
  fee: bigint,
  depositAddress: string | null,
  withdrawAddress: string | null,
  tokenAmount: bigint,
}

export interface NetworkBackend {
  getChainId(): Promise<number>;
  getDenominator(contractAddress: string): Promise<bigint>;
  signNullifier(signFn: (data: string) => Promise<string>, nullifier: string, fromAddress: string, depositId: number | null): Promise<string>;
  defaultNetworkName(): string;
  getRpcUrl(): string;
  getTransaction(hash: string): Promise<TxData | null>;
  disassembleRelayerTx(tx: string): RelayerTx;
  addressToBuffer(address: string): Uint8Array;
}