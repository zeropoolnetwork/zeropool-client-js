import { NetworkBackend } from './network';

export class PolkadotNetwork implements NetworkBackend {
    async getDenominator(contractAddress: string): Promise<string> {
        return '1000'; // FIXME
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