export interface NetworkBackend {
    getDenominator(contractAddress: string): Promise<bigint>;
    tokenTransferedAmount(tokenAddress: string, from: string, to: string): Promise<bigint>;
    poolLimits(contractAddress: string, address: string | undefined): Promise<any>;
    isSignatureCompact(): boolean;
    defaultNetworkName(): string;
    getRpcUrl(): string;
}