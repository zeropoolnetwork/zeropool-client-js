import BN from 'bn.js';
import { CONSTANTS } from './constants';

// Sizes in bytes
const MEMO_META_SIZE: number = 8; // fee (u64)
const MEMO_META_WITHDRAW_SIZE: number = 8 + 8 + 20; // fee (u64) + amount + address (u160)

export class InvalidNumberOfOutputs extends Error {
  public numOutputs: number;
  constructor(numOutputs: number) {
    super(`Invalid transaction: invalid number of outputs ${numOutputs}`);
    this.numOutputs = numOutputs;
  }
}

export enum TxType {
  Deposit = '0000',
  Transfer = '0001',
  Withdraw = '0002',
}

export function txTypeToString(txType: TxType): string {
  switch (txType) {
    case TxType.Deposit: return 'deposit';
    case TxType.Transfer: return 'transfer';
    case TxType.Withdraw: return 'withdraw';
  }
}

/** The universal transaction data format used on most networks. */
export class ShieldedTx {
  public nullifier: BN;
  public outCommit: BN;
  public transferIndex: BN;
  public energyAmount: BN;
  public tokenAmount: BN;
  public transactProof: BN[];
  public rootAfter: BN;
  public treeProof: BN[];
  public txType: TxType;
  public memo: Buffer;
  public extra: Buffer | null;
}
