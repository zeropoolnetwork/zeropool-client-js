import { NetworkBackend, RelayerTx, TxData } from './network';
import { truncateHexPrefix } from '../utils';
import { numberToHex, padLeft } from 'web3-utils';

export class PolkadotNetwork implements NetworkBackend {
  approveChangesBalance: boolean = false;

  async getChainId(): Promise<number> {
    return 0;
  }

  async getDenominator(contractAddress: string): Promise<bigint> {
    return BigInt(1000);
  }

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: BigInt, _fromAddress: string, _depositId: number | null): Promise<string> {
    const data = '0x' + padLeft(numberToHex(nullifier.toString()).slice(2), 64);
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
