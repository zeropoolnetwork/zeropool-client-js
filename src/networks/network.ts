export interface NetworkBackend {
    getDenominator(contractAddress: string): Promise<bigint>;
    tokenTransferedAmount(tokenAddress: string, from: string, to: string): Promise<bigint>;
    isSignatureCompact(): boolean;
    defaultNetworkName(): string;
    getRpcUrl(): string;
}