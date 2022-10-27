import { NetworkBackend, RelayerTx, TxData } from './network';
import { truncateHexPrefix } from '../utils';

export class PolkadotNetwork implements NetworkBackend {
  async getChainId(): Promise<number> {
    return 0;
  }

  async getDenominator(contractAddress: string): Promise<bigint> {
    return BigInt(1000);
  }

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: Uint8Array): Promise<string> {
    const dataToSign = '0x' + Buffer.from(nullifier).toString('hex');
    return truncateHexPrefix(await signFn(dataToSign));
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

  transactionVersion(): number {
    return 1;
  }
}