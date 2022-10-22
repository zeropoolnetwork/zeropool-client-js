import { NetworkBackend, RelayerTx, TxData } from './network';
import { toCompactSignature, truncateHexPrefix } from '../utils';

export class PolkadotNetwork implements NetworkBackend {
  async getChainId(): Promise<number> {
    return 0;
  }

  async getDenominator(contractAddress: string): Promise<bigint> {
    return BigInt(1000);
  }

  async signNullifier(signFn: (data: string) => Promise<string>, nullifier: BigInt, address: string): Promise<string> {
    const dataToSign = '0x' + nullifier.toString(16).padStart(64, '0');
    const signature = truncateHexPrefix(await signFn(dataToSign));
    const addr = truncateHexPrefix(address);

    return addr + signature; // TODO: sign both address and nullifier? There is no ecrecover in polkadot.
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