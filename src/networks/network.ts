import { TxType } from '../tx';

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
  signNullifier(signFn: (data: string) => Promise<string>, nullifier: BigInt, address: string): Promise<string>;
  defaultNetworkName(): string;
  getRpcUrl(): string;
  getTransaction(hash: string): Promise<TxData | null>;
}