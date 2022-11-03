import { NetworkBackend, RelayerTx, TxData } from './network';
import { truncateHexPrefix } from '../utils';

export class PolkadotNetwork implements NetworkBackend {
  approveChangesBalance: boolean = false;

  async getChainId(): Promise<number> {
    return 0;
  }

  async getDenominator(contractAddress: string): Promise<bigint> {
    return BigInt(1000);
  }

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: string, _fromAddress: string, _depositId: number | null): Promise<string> {
    if (nullifier.slice(0, 2) != '0x') {
      nullifier = '0x' + nullifier;
    }

    return truncateHexPrefix(await signFn(nullifier));
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