import { NetworkBackend } from './network';

export class NearNetwork implements NetworkBackend {
  async getChainId(): Promise<number> {
    return 0;
  }

  async getDenominator(contractAddress: string): Promise<bigint> {
    return BigInt(1);
  }

  isSignatureCompact(): boolean {
    return true;
  }

  defaultNetworkName(): string {
    return 'near';
  }

  getRpcUrl(): string {
    return '';
  }
}
