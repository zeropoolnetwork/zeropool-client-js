import { NetworkBackend } from './network';
export declare class PolkadotNetwork implements NetworkBackend {
    getChainId(): Promise<number>;
    getDenominator(contractAddress: string): Promise<bigint>;
    poolLimits(contractAddress: string, address: string | undefined): Promise<any>;
    isSignatureCompact(): boolean;
    defaultNetworkName(): string;
    getRpcUrl(): string;
}
