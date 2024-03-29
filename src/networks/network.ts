import BN from 'bn.js';
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
  fee: BN,
  depositAddress: string | null,
  withdrawAddress: string | null,
  tokenAmount: BN,
}

export interface NetworkBackend {
  approveChangesBalance: boolean;

  getChainId(): Promise<number>;
  getDenominator(contractAddress: string): Promise<BN>;
  signNullifier(signFn: (data: string) => Promise<string>, nullifier: BN, fromAddress: string, depositId: number | null): Promise<string>;
  defaultNetworkName(): string;
  getRpcUrl(): string;
  getTransaction(hash: string): Promise<TxData | null>;
  disassembleRelayerTx(tx: string): RelayerTx;
  addressToBuffer(address: string): Uint8Array;
}
