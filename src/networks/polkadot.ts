import { NetworkBackend } from './network';

export class PolkadotNetwork implements NetworkBackend {
    async getChainId(): Promise<number> {
        return 0; // FIXME
    }

    async getDenominator(contractAddress: string): Promise<bigint> {
        return BigInt(1000); // FIXME
    }

    isSignatureCompact(): boolean {
        return false;
    }

    defaultNetworkName(): string {
        return 'polkadot';
    }

    getRpcUrl(): string {
        return '';
    }
}