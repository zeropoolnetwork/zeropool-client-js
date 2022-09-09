import { NetworkBackend } from './network';
export declare class NearNetwork implements NetworkBackend {
    getChainId(): Promise<number>;
    poolLimits(contractAddress: string, address: string | undefined): Promise<any>;
    getDenominator(contractAddress: string): Promise<bigint>;
    isSignatureCompact(): boolean;
    defaultNetworkName(): string;
    getRpcUrl(): string;
}
