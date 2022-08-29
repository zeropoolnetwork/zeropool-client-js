import { NetworkBackend } from './network';

export class NearNetwork implements NetworkBackend {
  getChainId(): Promise<number> {
    throw new Error('Method not implemented.');
  }

  poolLimits(contractAddress: string, address: string | undefined): Promise<any> {
    throw new Error('Method not implemented.');
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
