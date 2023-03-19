import { NetworkBackend, RelayerTx, TxData } from './network';
import { truncateHexPrefix } from '../utils';
import { numberToHex, padLeft } from 'web3-utils';
import BN from 'bn.js';

export class PolkadotNetwork implements NetworkBackend {
  approveChangesBalance: boolean = false;

  async getChainId(): Promise<number> {
    return 0;
  }

  async getDenominator(contractAddress: string): Promise<BN> {
    return new BN(1000);
  }

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: BN, _fromAddress: string, _depositId: number | null): Promise<string> {
    const data = '0x' + padLeft(nullifier.toString('hex'), 64);
    return truncateHexPrefix(await signFn(data));
  }

  defaultNetworkName(): string {
    return 'polkadot';
  }

  getRpcUrl(): string {
    return '';
  }

  getTransaction(hash: string): Promise<TxData | null> {
    throw new Error('unimplemented');
  }

  disassembleRelayerTx(tx: string): RelayerTx {
    throw new Error('unimplemented');
  }

  addressToBuffer(address: string): Uint8Array {
    throw new Error('unimplemented');
  }
}
