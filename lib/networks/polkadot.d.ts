import { NetworkBackend } from './network';
export declare class PolkadotNetwork implements NetworkBackend {
    getDenominator(contractAddress: string): Promise<string>;
    isSignatureCompact(): boolean;
    defaultNetworkName(): string;
}
